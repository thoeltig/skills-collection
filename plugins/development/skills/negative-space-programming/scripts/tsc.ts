/**
 * TypeScript compiler filter.
 *
 * Runs `tsc --noEmit --pretty false --listFiles`. `--pretty false` is required: the default
 * pretty output is multi-line and ANSI-coloured, and cannot be parsed reliably. `--listFiles`
 * supplies the checked count, which is what makes the wrong-include-glob failure visible —
 * a tsconfig that matches nothing exits 0 and looks identical to a clean run.
 *
 *   node tsc.ts [tsconfig.json]
 */

import {
  assert,
  exitCode,
  isEntryPoint,
  render,
  reportCheckFailure,
  type CheckResult,
  type Finding,
} from './contract.ts';
import { DEFAULT_TIMEOUT_MS, runNodeTool } from './run.ts';

const TOOL = 'tsc';

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.*)$/;
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;

export interface TscParse {
  readonly findings: readonly Finding[];
  readonly checked: number;
}

export function parseTsc(output: string): TscParse {
  const findings: Finding[] = [];
  const checkedFiles = new Set<string>();

  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const match = DIAGNOSTIC.exec(line);
    if (match !== null) {
      const [, file, lineNumber, column, code, detail] = match;
      assert(file !== undefined && lineNumber !== undefined, `malformed tsc diagnostic: ${line}`);
      findings.push({
        file,
        line: Number(lineNumber),
        column: Number(column ?? '0'),
        code: code ?? 'TS',
        detail: (detail ?? '').trim(),
      });
      continue;
    }

    // --listFiles emits one path per line. Library and dependency declarations are not ours.
    if (SOURCE_FILE.test(line) && !line.includes('node_modules')) checkedFiles.add(line);
  }

  return { findings, checked: checkedFiles.size };
}

export function checkTsc(
  project: string | undefined,
  cwd: string = process.cwd(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): CheckResult {
  const args = ['--noEmit', '--pretty', 'false', '--listFiles'];
  if (project !== undefined) args.push('-p', project);

  const run = runNodeTool('typescript', 'tsc', args, timeoutMs, cwd);
  if (!run.ok) return { ok: false, tool: TOOL, reason: run.reason, detail: run.detail };

  const { findings, checked } = parseTsc(`${run.stdout}\n${run.stderr}`);

  // tsc exits non-zero with no parseable diagnostic only when the invocation itself was wrong
  // (a bad flag, a missing tsconfig). That is a run failure, not a clean codebase.
  if (run.status !== 0 && findings.length === 0) {
    const detail = `exited ${run.status} with no diagnostics\n${run.stdout.slice(0, 2000)}`;
    return { ok: false, tool: TOOL, reason: 'NoDiagnostics', detail };
  }

  assert(checked > 0, 'tsc checked 0 source files — the include glob matches nothing');
  return { ok: true, report: { tool: TOOL, checked, findings } };
}

function main(argv: readonly string[]): number {
  const result = checkTsc(argv[0]);
  if (!result.ok) return reportCheckFailure(result);
  process.stdout.write(render(result.report));
  return exitCode(result.report);
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
