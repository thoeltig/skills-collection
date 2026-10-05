/**
 * Cobertura coverage filter. Reports WHERE tests are missing, never a percentage.
 *
 * Cobertura is emitted by `Microsoft.Testing.Extensions.CodeCoverage` (C#) and by c8/istanbul
 * (TypeScript), so one parser serves both. All reports are merged first (see `cobertura.ts`).
 *
 * Read the output as a locator for X + Y floor violations: every uncovered line is either a logic
 * step with no test or an assertion that has never been tripped. A percentage is deliberately not
 * reported — it cannot be acted on and it invites gaming.
 *
 *   node coverage.ts <report.cobertura.xml | directory> [more ...]
 */

import {
  collapseRanges,
  exitCode,
  isEntryPoint,
  render,
  type Finding,
  type ToolReport,
} from './contract.ts';
import { mergeClasses, parseCobertura, readReports, type CoberturaSource, type MergedClass } from './cobertura.ts';

/** Classes with more uncovered lines than this are reported as a count, not a line list. */
const MAX_LINES_LISTED = 20;

function toFinding(cls: MergedClass, uncoveredLines: readonly number[]): Finding {
  const count = uncoveredLines.length;
  const detail =
    count > MAX_LINES_LISTED
      ? `${count} uncovered lines in ${cls.name}`
      : `uncovered: ${collapseRanges(uncoveredLines)} (${cls.name})`;

  return { file: cls.file, line: Math.min(...uncoveredLines), code: 'uncovered', detail };
}

export function analyze(reports: readonly CoberturaSource[]): ToolReport {
  const classes = mergeClasses(reports.flatMap((report) => parseCobertura(report)));
  const findings: Finding[] = [];

  for (const cls of classes) {
    const uncovered = [...cls.lines].filter(([, hits]) => hits === 0).map(([number]) => number);
    if (uncovered.length > 0) findings.push(toFinding(cls, uncovered));
  }

  return { tool: 'coverage', checked: classes.length, findings };
}

function main(paths: readonly string[]): number {
  // Unreadable input is a failure of the run, never a silently skipped file: a coverage report
  // that quietly drops an assembly looks exactly like an assembly with full coverage.
  let reports: readonly CoberturaSource[];
  try {
    reports = readReports(paths);
  } catch (error: unknown) {
    process.stderr.write(`✖ coverage: cannot read reports: ${String(error)}\n`);
    return 2;
  }

  const report = analyze(reports);
  process.stdout.write(render(report));
  return exitCode(report);
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
