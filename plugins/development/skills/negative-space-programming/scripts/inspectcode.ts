/**
 * ReSharper `jb inspectcode` filter.
 *
 * This is the ONLY channel that reports JetBrains annotation violations - they produce no compiler
 * diagnostic at all (see csharp.md). Without this filter wired into CI, every JetBrains attribute in
 * the codebase has the enforcement power of a comment.
 *
 * Reads SARIF, which has been InspectCode's default output since 2024.1. The XML format is
 * documented as heading for deprecation, so it is deliberately not supported here.
 *
 * Severity is an override, not a property of the issue: a result carries `level` only when it
 * differs from its rule's `defaultConfiguration.level`, so the rule table is read first and joined
 * by `ruleId`. JetBrains documents the same rule for the XML `Severity` attribute.
 *
 * Install: dotnet tool install --global JetBrains.ReSharper.GlobalTools
 *
 *   node inspectcode.js <Solution.sln> [--no-build]
 *
 * NOT YET VERIFIED against real jb output. Written to the documented SARIF contract and exercised
 * against a synthetic sample; confirm the shape on first run in the container.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exitCode, isEntryPoint, render, type Finding, type ToolReport } from './contract.js';
import { reportRunFailure, runTool } from './run.js';

/** SARIF levels worth a reader's attention. "note" maps to SUGGESTION and below. */
const REPORTED_LEVELS = new Set(['error', 'warning']);

/** SARIF's documented default when neither the result nor its rule states a level. */
const DEFAULT_LEVEL = 'warning';

export type InspectParse =
  | { readonly ok: true; readonly findings: readonly Finding[]; readonly checked: number }
  | { readonly ok: false; readonly detail: string };

function text(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const message = (value as { text?: unknown }).text;
  return typeof message === 'string' ? message : undefined;
}

/** Foreign data: validated into findings, never asserted. A malformed report is a failure. */
export function parseInspectCode(json: string): InspectParse {
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch (error: unknown) {
    return { ok: false, detail: `report is not JSON: ${String(error)}` };
  }

  if (typeof document !== 'object' || document === null) {
    return { ok: false, detail: 'report root is not an object' };
  }

  const runs = (document as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return { ok: false, detail: 'report has no `runs` array - not SARIF' };

  const findings: Finding[] = [];
  let inspections = 0;

  for (const run of runs as readonly Record<string, unknown>[]) {
    const driver = (run['tool'] as { driver?: Record<string, unknown> } | undefined)?.driver;
    const rules = Array.isArray(driver?.['rules']) ? (driver['rules'] as readonly unknown[]) : [];
    inspections += rules.length;

    const levelByRuleId = new Map<string, string>();
    for (const rule of rules as readonly Record<string, unknown>[]) {
      const id = rule['id'];
      const level = (rule['defaultConfiguration'] as { level?: unknown } | undefined)?.level;
      if (typeof id === 'string' && typeof level === 'string') levelByRuleId.set(id, level);
    }

    const results = Array.isArray(run['results']) ? (run['results'] as readonly unknown[]) : [];
    for (const result of results as readonly Record<string, unknown>[]) {
      const ruleId = typeof result['ruleId'] === 'string' ? result['ruleId'] : '(unknown)';
      const own = typeof result['level'] === 'string' ? result['level'] : undefined;
      const level = own ?? levelByRuleId.get(ruleId) ?? DEFAULT_LEVEL;
      if (!REPORTED_LEVELS.has(level)) continue;

      const locations = Array.isArray(result['locations']) ? result['locations'] : [];
      const physical = (locations[0] as { physicalLocation?: Record<string, unknown> } | undefined)
        ?.physicalLocation;
      const uri = (physical?.['artifactLocation'] as { uri?: unknown } | undefined)?.uri;
      const region = physical?.['region'] as { startLine?: unknown; startColumn?: unknown } | undefined;

      const finding: Finding = {
        // Paths are relative to the solution file unless jb was given --absolute-paths.
        file: typeof uri === 'string' ? uri : '(unknown)',
        line: typeof region?.startLine === 'number' ? region.startLine : 0,
        code: ruleId,
        detail: text(result['message']) ?? '(no message)',
      };
      const column = region?.startColumn;
      findings.push(typeof column === 'number' ? { ...finding, column } : finding);
    }
  }

  // `checked` counts the inspections the run advertised. It is NOT asserted above zero: whether a
  // clean solution still emits the full rule catalogue is unconfirmed, and a false alarm on a clean
  // run would be worse than the missing signal. The `runs` check above is the structural guard.
  return { ok: true, findings, checked: inspections };
}

function main(argv: readonly string[]): number {
  const solution = argv[0];
  if (solution === undefined) {
    process.stderr.write('✖ inspectcode: a solution or project path is required\n');
    return 2;
  }

  const directory = mkdtempSync(join(tmpdir(), 'inspectcode-'));
  const output = join(directory, 'report.json');

  try {
    // InspectCode restores and builds the solution by default; stating --build explicitly silences
    // the warning about it. Pass --no-build when the pipeline has already built, which is the usual
    // case here since dotnet-build.ts runs first.
    const build = argv.includes('--no-build') ? '--no-build' : '--build';
    const run = runTool('jb', [
      'inspectcode',
      solution,
      `-o=${output}`,
      '-e=WARNING',
      '--verbosity=ERROR',
      build,
    ]);
    if (!run.ok) return reportRunFailure('inspectcode', run);

    let json: string;
    try {
      json = readFileSync(output, 'utf8');
    } catch (error: unknown) {
      process.stderr.write(
        `✖ inspectcode: no report written (exit ${run.status}): ${String(error)}\n`,
      );
      return 2;
    }

    const parsed = parseInspectCode(json);
    if (!parsed.ok) {
      process.stderr.write(`✖ inspectcode: ${parsed.detail}\n`);
      return 2;
    }

    const report: ToolReport = {
      tool: 'inspectcode',
      checked: parsed.checked,
      findings: parsed.findings,
    };
    process.stdout.write(render(report));
    return exitCode(report);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
