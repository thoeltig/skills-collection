/**
 * CRAP filter — Change Risk Anti-Patterns.
 *
 *   CRAP(m) = complexity(m)^2 * (1 - coverage(m))^3 + complexity(m)
 *
 * Reads the same Cobertura report as `coverage.ts`: coverlet writes a `complexity` attribute on
 * each <method>, and per-line hits give the coverage.
 *
 * This is an instrument pointed at the function-shape rule in SKILL.md, not a new rule. A method
 * over the threshold is usually telling you it owns more than one decision — the default fix is to
 * split it, not to bolt tests onto it. Advisory: never wire this as a merge gate, because gating
 * rewards whichever of the two fixes is cheaper, which is the wrong one.
 *
 *   node crap.js <coverage.cobertura.xml> [more.xml ...]
 */

import { readFileSync } from 'node:fs';

import { assert, isEntryPoint, render, type Finding, type ToolReport } from './contract.js';

/** The conventional critical line. Complexity 5 with zero coverage lands exactly here. */
const CRAP_THRESHOLD = 30;

interface MethodMetrics {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly complexity: number;
  readonly coverage: number;
}

function attributeOf(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1];
}

export function crapScore(complexity: number, coverage: number): number {
  assert(complexity >= 0, `complexity must be >= 0, got ${complexity}`);
  assert(coverage >= 0 && coverage <= 1, `coverage must be in [0, 1], got ${coverage}`);

  const uncovered = 1 - coverage;
  return complexity * complexity * uncovered * uncovered * uncovered + complexity;
}

function parseMethods(xml: string, source: string): readonly MethodMetrics[] {
  assert(xml.includes('<coverage'), `not a Cobertura report, no <coverage> element: ${source}`);

  const methods: MethodMetrics[] = [];
  const classPattern = /<class\b([^>]*)>/g;

  for (let cls = classPattern.exec(xml); cls !== null; cls = classPattern.exec(xml)) {
    const classEnd = xml.indexOf('</class>', cls.index);
    assert(classEnd > cls.index, `unterminated <class> at offset ${cls.index} in ${source}`);

    const file = attributeOf(cls[1] ?? '', 'filename') ?? '(unknown)';
    const classBody = xml.slice(cls.index, classEnd);
    const methodPattern = /<method\b([^>]*)>/g;

    for (let met = methodPattern.exec(classBody); met !== null; met = methodPattern.exec(classBody)) {
      const methodEnd = classBody.indexOf('</method>', met.index);
      assert(methodEnd > met.index, `unterminated <method> at offset ${met.index} in ${source}`);

      const attributes = met[1] ?? '';
      const body = classBody.slice(met.index, methodEnd);

      let hit = 0;
      let total = 0;
      let firstLine = 0;
      const linePattern = /<line\b([^>]*)\/?>/g;
      for (let line = linePattern.exec(body); line !== null; line = linePattern.exec(body)) {
        const lineAttributes = line[1] ?? '';
        const number = Number(attributeOf(lineAttributes, 'number') ?? '0');
        if (number <= 0) continue;
        if (firstLine === 0 || number < firstLine) firstLine = number;
        total++;
        if (Number(attributeOf(lineAttributes, 'hits') ?? '0') > 0) hit++;
      }

      if (total === 0) continue;

      methods.push({
        name: attributeOf(attributes, 'name') ?? '(unnamed)',
        file,
        line: firstLine,
        complexity: Number(attributeOf(attributes, 'complexity') ?? '0'),
        coverage: hit / total,
      });
    }
  }

  return methods;
}

function toFinding(method: MethodMetrics, score: number): Finding {
  const percent = Math.round(method.coverage * 100);
  return {
    file: method.file,
    line: method.line,
    code: 'CRAP',
    detail:
      `${Math.round(score)} for ${method.name} ` +
      `(complexity ${method.complexity}, coverage ${percent}%) — prefer splitting over adding tests`,
  };
}

function main(paths: readonly string[]): number {
  assert(paths.length > 0, 'crap filter needs at least one Cobertura report path');

  const methods: MethodMetrics[] = [];

  for (const path of paths) {
    let xml: string;
    try {
      xml = readFileSync(path, 'utf8');
    } catch (error: unknown) {
      process.stderr.write(`✖ crap: cannot read ${path}: ${String(error)}\n`);
      return 2;
    }
    methods.push(...parseMethods(xml, path));
  }

  assert(methods.length > 0, `no <method> elements found across ${paths.length} report(s)`);

  // Without complexity every score collapses to 0 and the run reports a clean bill of health that
  // means nothing. istanbul/c8 do not emit complexity; take it from the ESLint `complexity` rule
  // instead. A silent no-op here is indistinguishable from success, so it is reported as a fault.
  if (methods.every((method) => method.complexity === 0)) {
    process.stderr.write(
      `✖ crap: no complexity data in ${methods.length} methods — the report cannot produce a score. ` +
        `coverlet emits it; istanbul/c8 do not.\n`,
    );
    return 2;
  }

  const findings = methods
    .map((method) => ({ method, score: crapScore(method.complexity, method.coverage) }))
    .filter(({ score }) => score > CRAP_THRESHOLD)
    .map(({ method, score }) => toFinding(method, score));

  const report: ToolReport = { tool: 'crap', checked: methods.length, findings };
  process.stdout.write(render(report));

  // Advisory by design: this filter reports and never gates, so the exit code is always 0.
  // Gating on CRAP rewards whichever fix is cheaper, which is adding tests to a bloated method.
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
