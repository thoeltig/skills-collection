/**
 * .NET test filter for xUnit v3 on Microsoft.Testing.Platform. Runs `dotnet test` with xUnit's own
 * TRX report into a temporary directory and reports each failed test at the source line it failed.
 *
 * TRX rather than console output: the console is localized (a German SDK prints "fehlgeschlagen"),
 * the TRX schema is not. `--report-xunit-trx` ships with xunit.v3; the generic `--report-trx` needs
 * the Microsoft.Testing.Extensions.TrxReport package and fails with exit code 5 without it.
 * Requires `global.json` with `{"test":{"runner":"Microsoft.Testing.Platform"}}`: on the .NET 10 SDK
 * the VSTest path refuses xUnit v3 projects outright.
 *
 *   node dotnet-test.ts [dotnet test args, e.g. --solution App.sln]
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assert,
  exitCode,
  isEntryPoint,
  oneLine,
  projectRelative,
  render,
  reportCheckFailure,
  type CheckResult,
  type Finding,
} from './contract.ts';
import { DEFAULT_TIMEOUT_MS, runTool } from './run.ts';

const TOOL = 'dotnet-test';

/** One TRX file per test application and target framework; a solution beyond this is a wrong results directory. */
const MAX_REPORTS = 500;

const RESULT = /<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
const COUNTERS = /<Counters\b([^>]*?)\/>/;
const MESSAGE = /<Message>([\s\S]*?)<\/Message>/;
const STACK_TRACE = /<StackTrace>([\s\S]*?)<\/StackTrace>/;
// `at X in C:\src\A.cs:line 20`; a runtime with German resources prints `bei X in …:Zeile 20`.
const FRAME = /\sin\s(.+?):(?:line|Zeile)\s(\d+)\s*$/;
const FAILED_OUTCOMES = new Set(['Failed', 'Error', 'Timeout', 'Aborted']);

export interface TrxParse {
  readonly executed: number;
  readonly skipped: number;
  readonly findings: readonly Finding[];
}

export type TrxResult = { readonly ok: true; readonly value: TrxParse } | { readonly ok: false; readonly reason: string };

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match === null ? undefined : decodeXml(match[1] as string);
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The innermost stack frame inside the project: where a helper threw, or the asserting test line. */
function failureLocation(stackTrace: string, cwd: string): { file: string; line: number } | undefined {
  for (const frame of stackTrace.split('\n')) {
    const match = FRAME.exec(frame.trimEnd());
    if (match === null) continue;
    const file = projectRelative(cwd, match[1] as string);
    if (file !== undefined && !file.includes('/obj/')) return { file, line: Number(match[2]) };
  }
  return undefined;
}

function toFinding(test: string, body: string, cwd: string): Finding {
  const message = decodeXml(MESSAGE.exec(body)?.[1] ?? '');
  const stackTrace = decodeXml(STACK_TRACE.exec(body)?.[1] ?? '');
  const location = failureLocation(stackTrace, cwd);
  const detail = oneLine(message);
  if (location === undefined) return { file: test, line: 0, code: 'TEST', detail, test };
  return { file: location.file, line: location.line, code: 'TEST', detail, test };
}

/** Parses one TRX document. Its own `Counters` must reconcile with the results read, or the parse is not trusted. */
export function parseTrx(xml: string, cwd: string): TrxResult {
  const findings: Finding[] = [];
  let total = 0;
  let skipped = 0;
  for (const match of xml.matchAll(RESULT)) {
    const attributes = match[1] as string;
    const outcome = attribute(attributes, 'outcome');
    const test = attribute(attributes, 'testName');
    if (outcome === undefined || test === undefined) return { ok: false, reason: `UnitTestResult without outcome or testName: ${attributes.slice(0, 200)}` };
    total += 1;
    if (outcome === 'NotExecuted') skipped += 1;
    if (FAILED_OUTCOMES.has(outcome)) findings.push(toFinding(test, match[2] ?? '', cwd));
  }

  const counters = COUNTERS.exec(xml)?.[1];
  if (counters === undefined) return { ok: false, reason: 'TRX has no Counters element' };
  const counted = Number(attribute(counters, 'total'));
  if (counted !== total) return { ok: false, reason: `TRX Counters total=${counted} but ${total} UnitTestResult elements were read` };
  return { ok: true, value: { executed: total - skipped, skipped, findings } };
}

function trxFiles(directory: string): string[] {
  const files = readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.trx'))
    .map((name) => join(directory, name));
  assert(files.length <= MAX_REPORTS, `dotnet test wrote ${files.length} TRX files, more than ${MAX_REPORTS}`);
  return files;
}

/** The same test failing the same way in several target frameworks is one finding. */
function distinct(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.test ?? ''}|${finding.file}|${finding.line}|${finding.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lastLines(text: string, count: number): string {
  return text.trimEnd().split('\n').slice(-count).join('\n');
}

export function readReports(resultsDirectory: string, status: number, stdout: string, cwd: string): CheckResult {
  const files = trxFiles(resultsDirectory);
  if (files.length === 0) {
    const detail = `exited ${status} without a TRX report\n${lastLines(stdout, 20)}`;
    return { ok: false, tool: TOOL, reason: 'NoTrxReport', detail };
  }
  let checked = 0;
  let skipped = 0;
  const findings: Finding[] = [];
  for (const file of files) {
    const parsed = parseTrx(readFileSync(file, 'utf8'), cwd);
    if (!parsed.ok) return { ok: false, tool: TOOL, reason: 'UnreadableTrx', detail: `${file}: ${parsed.reason}` };
    checked += parsed.value.executed;
    skipped += parsed.value.skipped;
    findings.push(...parsed.value.findings);
  }
  return { ok: true, report: { tool: TOOL, checked, skipped, findings: distinct(findings) } };
}

export function checkDotnetTest(
  args: readonly string[],
  cwd: string = process.cwd(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): CheckResult {
  const resultsDirectory = mkdtempSync(join(tmpdir(), 'dotnet-test-'));
  try {
    const testArgs = ['test', ...args, '--results-directory', resultsDirectory, '--report-xunit-trx'];
    const run = runTool('dotnet', testArgs, timeoutMs, cwd);
    if (!run.ok) return { ok: false, tool: TOOL, reason: run.reason, detail: run.detail };
    return readReports(resultsDirectory, run.status, `${run.stdout}\n${run.stderr}`, cwd);
  } finally {
    rmSync(resultsDirectory, { recursive: true, force: true });
  }
}

function main(argv: readonly string[]): number {
  const result = checkDotnetTest(argv);
  if (!result.ok) return reportCheckFailure(result);
  process.stdout.write(render(result.report));
  return exitCode(result.report);
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
