/**
 * Cobertura coverage filter. Reports WHERE tests are missing, never a percentage.
 *
 * Cobertura is emitted by coverlet (`dotnet test --collect:"XPlat Code Coverage"`) and by
 * c8/istanbul (`--reporter=cobertura`), so one parser serves C# and TypeScript.
 *
 * Read the output as a locator for X + Y floor violations: every uncovered line is either a logic
 * step with no test or an assertion that has never been tripped. A percentage is deliberately not
 * reported — it cannot be acted on and it invites gaming.
 *
 *   node coverage.js <coverage.cobertura.xml> [more.xml ...]
 */

import { readFileSync } from 'node:fs';

import {
  assert,
  collapseRanges,
  exitCode,
  isEntryPoint,
  render,
  type Finding,
  type ToolReport,
} from './contract.js';

/** Classes with more uncovered lines than this are reported as a count, not a line list. */
const MAX_LINES_LISTED = 20;

interface CoveredClass {
  readonly name: string;
  readonly file: string;
  readonly uncoveredLines: readonly number[];
}

/**
 * Cobertura has a fixed, shallow shape, so a targeted scan beats a dependency. This is NOT a
 * general XML parser and does not pretend to be: it asserts it found the structure it expects, so
 * a format change fails loudly instead of silently reporting a clean run.
 */
function parseCobertura(xml: string, source: string): readonly CoveredClass[] {
  assert(xml.length > 0, `coverage file is empty: ${source}`);
  assert(xml.includes('<coverage'), `not a Cobertura report, no <coverage> element: ${source}`);

  const classes: CoveredClass[] = [];
  const classPattern = /<class\b([^>]*)>/g;

  for (let match = classPattern.exec(xml); match !== null; match = classPattern.exec(xml)) {
    const attributes = match[1] ?? '';
    const end = xml.indexOf('</class>', match.index);
    assert(end > match.index, `unterminated <class> element at offset ${match.index} in ${source}`);

    const body = xml.slice(match.index, end);
    const name = attributeOf(attributes, 'name') ?? '(unnamed)';
    const file = attributeOf(attributes, 'filename') ?? '(unknown)';

    const uncoveredLines: number[] = [];
    const linePattern = /<line\b([^>]*)\/?>/g;
    for (let line = linePattern.exec(body); line !== null; line = linePattern.exec(body)) {
      const lineAttributes = line[1] ?? '';
      const hits = Number(attributeOf(lineAttributes, 'hits') ?? '0');
      const number = Number(attributeOf(lineAttributes, 'number') ?? '0');
      if (hits === 0 && number > 0) uncoveredLines.push(number);
    }

    if (uncoveredLines.length > 0) classes.push({ name, file, uncoveredLines });
  }

  return classes;
}

function attributeOf(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1];
}

function toFinding(covered: CoveredClass): Finding {
  const count = covered.uncoveredLines.length;
  const detail =
    count > MAX_LINES_LISTED
      ? `${count} uncovered lines in ${covered.name}`
      : `uncovered: ${collapseRanges(covered.uncoveredLines)} (${covered.name})`;

  return {
    file: covered.file,
    line: Math.min(...covered.uncoveredLines),
    code: 'uncovered',
    detail,
  };
}

function main(paths: readonly string[]): number {
  assert(paths.length > 0, 'coverage filter needs at least one Cobertura report path');

  const classes: CoveredClass[] = [];
  let checked = 0;

  for (const path of paths) {
    // Unreadable input is a failure of the run, never a silently skipped file: a coverage report
    // that quietly drops an assembly looks exactly like an assembly with full coverage.
    let xml: string;
    try {
      xml = readFileSync(path, 'utf8');
    } catch (error: unknown) {
      process.stderr.write(`✖ coverage: cannot read ${path}: ${String(error)}\n`);
      return 2;
    }

    const parsed = parseCobertura(xml, path);
    checked += countClasses(xml);
    classes.push(...parsed);
  }

  assert(checked > 0, `no <class> elements found across ${paths.length} report(s) — wrong format?`);

  const report: ToolReport = {
    tool: 'coverage',
    checked,
    findings: classes.map(toFinding),
  };

  process.stdout.write(render(report));
  return exitCode(report);
}

function countClasses(xml: string): number {
  return (xml.match(/<class\b/g) ?? []).length;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
