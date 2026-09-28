/**
 * CRAP filter — Change Risk Anti-Patterns.
 *
 *   CRAP(m) = complexity(m)^2 * (1 - coverage(m))^3 + complexity(m)
 *
 * Reads the same merged Cobertura reports as `coverage.ts`: the C# emitter
 * (`Microsoft.Testing.Extensions.CodeCoverage`) writes a `complexity` attribute on each <method>,
 * and per-line hits give the coverage. istanbul/c8 do not emit complexity.
 *
 * This is an instrument pointed at the function-shape rule in SKILL.md, not a new rule. A method
 * over the threshold is usually telling you it owns more than one decision — the default fix is to
 * split it, not to bolt tests onto it. Advisory: never wire this as a merge gate, because gating
 * rewards whichever of the two fixes is cheaper, which is the wrong one.
 *
 *   node crap.ts <report.cobertura.xml | directory> [more ...]
 */

import { assert, isEntryPoint, render, type Finding, type ToolReport } from './contract.ts';
import { mergeMethods, parseCobertura, readReports, type CoberturaSource, type MergedMethod } from './cobertura.ts';

/** The conventional critical line. Complexity 5 with zero coverage lands exactly here. */
const CRAP_THRESHOLD = 30;

export function crapScore(complexity: number, coverage: number): number {
  assert(complexity >= 0, `complexity must be >= 0, got ${complexity}`);
  assert(coverage >= 0 && coverage <= 1, `coverage must be in [0, 1], got ${coverage}`);

  const uncovered = 1 - coverage;
  return complexity * complexity * uncovered * uncovered * uncovered + complexity;
}

function coverageOf(method: MergedMethod): number {
  const hit = [...method.lines.values()].filter((hits) => hits > 0).length;
  return hit / method.lines.size;
}

function toFinding(method: MergedMethod, coverage: number, score: number): Finding {
  return {
    file: method.file,
    line: Math.min(...method.lines.keys()),
    code: 'CRAP',
    detail:
      `${Math.round(score)} for ${method.name} ` +
      `(complexity ${method.complexity}, coverage ${Math.round(coverage * 100)}%) — prefer splitting over adding tests`,
  };
}

export type CrapResult =
  | { readonly ok: true; readonly report: ToolReport }
  | { readonly ok: false; readonly reason: 'NoComplexity'; readonly methods: number };

export function analyze(reports: readonly CoberturaSource[]): CrapResult {
  const methods = mergeMethods(reports.flatMap((report) => parseCobertura(report))).filter(
    (method) => method.lines.size > 0,
  );
  assert(methods.length > 0, `no <method> elements with lines across ${reports.length} report(s)`);

  // Without complexity every score collapses to 0 and the run reports a clean bill of health that
  // means nothing. A silent no-op here is indistinguishable from success, so it is a named fault.
  if (methods.every((method) => method.complexity === 0)) {
    return { ok: false, reason: 'NoComplexity', methods: methods.length };
  }

  const findings: Finding[] = [];
  for (const method of methods) {
    const coverage = coverageOf(method);
    const score = crapScore(method.complexity, coverage);
    if (score > CRAP_THRESHOLD) findings.push(toFinding(method, coverage, score));
  }

  return { ok: true, report: { tool: 'crap', checked: methods.length, findings } };
}

function main(paths: readonly string[]): number {
  let reports: readonly CoberturaSource[];
  try {
    reports = readReports(paths);
  } catch (error: unknown) {
    process.stderr.write(`✖ crap: cannot read reports: ${String(error)}\n`);
    return 2;
  }

  const result = analyze(reports);
  if (!result.ok) {
    process.stderr.write(
      `✖ crap: no complexity data in ${result.methods} methods — the report cannot produce a score. ` +
        `The C# emitter writes it; istanbul/c8 do not (take complexity from the ESLint rule instead).\n`,
    );
    return 2;
  }

  process.stdout.write(render(result.report));
  // Advisory by design: this filter reports and never gates, so the exit code is always 0.
  // Gating on CRAP rewards whichever fix is cheaper, which is adding tests to a bloated method.
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
