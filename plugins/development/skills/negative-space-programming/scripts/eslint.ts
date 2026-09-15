/**
 * ESLint filter. Runs `eslint --format=json` and reports findings only.
 *
 * ESLint exits 1 when it finds errors, so a non-zero status is expected and the JSON on stdout is
 * still authoritative. Only a status with unparseable stdout is a run failure.
 *
 * The checked count is the number of files linted. Zero means the config matched nothing, which
 * otherwise exits 0 and looks exactly like a clean codebase.
 *
 *   node eslint.js [target]
 */

import { assert, exitCode, isEntryPoint, render, type Finding, type ToolReport } from './contract.js';
import { reportRunFailure, runNodeTool } from './run.js';

/** Shape of one entry in ESLint's JSON formatter output. Foreign data: validated, never asserted. */
interface EslintResult {
  readonly filePath?: unknown;
  readonly messages?: unknown;
}

interface EslintMessage {
  readonly ruleId?: unknown;
  readonly severity?: unknown;
  readonly line?: unknown;
  readonly column?: unknown;
  readonly message?: unknown;
}

export type EslintParse =
  | { readonly ok: true; readonly findings: readonly Finding[]; readonly checked: number }
  | { readonly ok: false; readonly detail: string };

export function parseEslint(json: string): EslintParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error: unknown) {
    return { ok: false, detail: `stdout is not JSON: ${String(error)}` };
  }

  if (!Array.isArray(parsed)) return { ok: false, detail: 'expected a JSON array of file results' };

  const findings: Finding[] = [];

  for (const entry of parsed as readonly EslintResult[]) {
    const filePath = typeof entry.filePath === 'string' ? entry.filePath : '(unknown)';
    const messages = Array.isArray(entry.messages) ? (entry.messages as readonly EslintMessage[]) : [];

    for (const message of messages) {
      // severity 1 is a warning, 2 an error. Both are findings: a warning nobody acts on is noise,
      // so the required config sets every rule that matters to 'error' in the first place.
      const severity = typeof message.severity === 'number' ? message.severity : 0;
      if (severity < 1) continue;

      findings.push({
        file: filePath,
        line: typeof message.line === 'number' ? message.line : 0,
        column: typeof message.column === 'number' ? message.column : 0,
        code: typeof message.ruleId === 'string' ? message.ruleId : 'eslint',
        detail: typeof message.message === 'string' ? message.message.trim() : '(no message)',
      });
    }
  }

  return { ok: true, findings, checked: parsed.length };
}

function main(argv: readonly string[]): number {
  const target = argv[0] ?? '.';
  const run = runNodeTool('eslint', 'eslint', [target, '--format=json']);
  if (!run.ok) return reportRunFailure('eslint', run);

  const parsed = parseEslint(run.stdout);
  if (!parsed.ok) {
    process.stderr.write(`✖ eslint: ${parsed.detail}\n${run.stderr.slice(0, 2000)}\n`);
    return 2;
  }

  assert(parsed.checked > 0, 'eslint linted 0 files — the config or target matches nothing');

  const report: ToolReport = { tool: 'eslint', checked: parsed.checked, findings: parsed.findings };
  process.stdout.write(render(report));
  return exitCode(report);
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
