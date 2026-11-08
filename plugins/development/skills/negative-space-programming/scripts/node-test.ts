/**
 * node:test filter. Runs `node --test` with `node-test-reporter.ts`, which writes one JSON line per
 * failed test and one for the run summary; this module turns those lines into a report.
 *
 * A suite is not a test: a `describe` whose children failed emits its own `test:fail` with failureType
 * `subtestsFailed`, which would count every failure twice. A suite failing for its own reason (a
 * `before` hook) is kept, since no child reports it.
 *
 *   node node-test.ts [node --test args, e.g. "src/**\/*.test.ts"]
 */
import { fileURLToPath } from 'node:url';
import {
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

const TOOL = 'node-test';
const REPORTER = new URL('./node-test-reporter.ts', import.meta.url).href;
/** Stack text kept per failure; the innermost project frame sits near the top. */
const MAX_STACK = 4000;
// `at fn (file:///C:/src/a.ts:4:34)`, `at file:///src/a.ts:9:31`, `at fn (C:\src\a.js:4:3)`
const FRAME = /(?:\(|at )((?:file:\/\/|[A-Za-z]:\\|\/)[^\s()]+?):(\d+):(\d+)\)?\s*$/;

/** The event shape node:test hands a custom reporter; only the fields read here are typed. */
export interface TestEvent {
  readonly type: string;
  readonly data: unknown;
}

export type ReporterRecord =
  | {
      readonly kind: 'fail';
      readonly test: string;
      readonly file: string;
      readonly line: number;
      readonly column: number;
      readonly detail: string;
      readonly stack: string;
    }
  | {
      readonly kind: 'summary';
      readonly tests: number;
      readonly failed: number;
      readonly cancelled: number;
      readonly skipped: number;
      readonly todo: number;
    };

type Fields = Readonly<Record<string, unknown>>;

function fields(value: unknown): Fields {
  return typeof value === 'object' && value !== null ? (value as Fields) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function failRecord(data: Fields): ReporterRecord | undefined {
  const details = fields(data['details']);
  const error = fields(details['error']);
  if (error['failureType'] === 'subtestsFailed') return undefined;
  const cause = error['cause'];
  const causeFields = fields(cause);
  const message = text(causeFields['message']) || (typeof cause === 'string' ? cause : text(error['message']));
  const name = text(data['name']);
  const suite = text(data['classname']);
  return {
    kind: 'fail',
    test: suite === '' ? name : `${suite} > ${name}`,
    file: text(data['file']),
    line: count(data['line']),
    column: count(data['column']),
    detail: oneLine(message),
    stack: text(causeFields['stack']).slice(0, MAX_STACK),
  };
}

/** Maps one reporter event to the line the filter reads; undefined for every event it ignores. */
export function toRecord(event: TestEvent): ReporterRecord | undefined {
  const data = fields(event.data);
  if (event.type === 'test:fail') return failRecord(data);
  // Each file gets its own summary; the run's summary is the one without a file.
  if (event.type !== 'test:summary' || data['file'] !== undefined) return undefined;
  const counts = fields(data['counts']);
  return {
    kind: 'summary',
    tests: count(counts['tests']),
    failed: count(counts['failed']),
    cancelled: count(counts['cancelled']),
    skipped: count(counts['skipped']),
    todo: count(counts['todo']),
  };
}

function framePath(raw: string): string {
  return raw.startsWith('file://') ? fileURLToPath(raw) : raw;
}

/** The innermost stack frame inside the project, else the test's own declaration. */
function toFinding(record: Extract<ReporterRecord, { kind: 'fail' }>, cwd: string): Finding {
  for (const frame of record.stack.split('\n')) {
    const match = FRAME.exec(frame);
    if (match === null) continue;
    const file = projectRelative(cwd, framePath(match[1] as string));
    if (file === undefined || file.includes('node_modules/')) continue;
    return { file, line: Number(match[2]), column: Number(match[3]), code: 'TEST', detail: record.detail, test: record.test };
  }
  const file = record.file === '' ? undefined : projectRelative(cwd, framePath(record.file));
  if (file === undefined) return { file: record.test, line: 0, code: 'TEST', detail: record.detail, test: record.test };
  return { file, line: record.line, column: record.column, code: 'TEST', detail: record.detail, test: record.test };
}

export type NodeTestParse =
  | { readonly ok: true; readonly checked: number; readonly skipped: number; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly reason: string };

export function parseRecords(output: string, cwd: string): NodeTestParse {
  const findings: Finding[] = [];
  let summary: Extract<ReporterRecord, { kind: 'summary' }> | undefined;
  for (const line of output.split('\n')) {
    if (!line.startsWith('{"kind":')) continue;
    const record = JSON.parse(line) as ReporterRecord;
    if (record.kind === 'summary') summary = record;
    else findings.push(toFinding(record, cwd));
  }
  if (summary === undefined) return { ok: false, reason: 'the reporter wrote no run summary' };
  // Suite-level failures add records the summary does not count, so only a shortfall is a lost failure.
  const expected = summary.failed + summary.cancelled;
  if (findings.length < expected) {
    return { ok: false, reason: `summary counts ${expected} failed tests but ${findings.length} were reported` };
  }
  const skipped = summary.skipped + summary.todo;
  return { ok: true, checked: summary.tests - skipped, skipped, findings };
}

export function checkNodeTest(
  args: readonly string[],
  cwd: string = process.cwd(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): CheckResult {
  const nodeArgs = ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout', ...args];
  const run = runTool(process.execPath, nodeArgs, timeoutMs, cwd);
  if (!run.ok) return { ok: false, tool: TOOL, reason: run.reason, detail: run.detail };
  const parsed = parseRecords(run.stdout, cwd);
  if (!parsed.ok) {
    const detail = `${parsed.reason}; exited ${run.status}\n${run.stderr.slice(0, 2000)}`;
    return { ok: false, tool: TOOL, reason: 'NoReport', detail };
  }
  const { checked, skipped, findings } = parsed;
  return { ok: true, report: { tool: TOOL, checked, skipped, findings } };
}

function main(argv: readonly string[]): number {
  const result = checkNodeTest(argv);
  if (!result.ok) return reportCheckFailure(result);
  process.stdout.write(render(result.report));
  return exitCode(result.report);
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
