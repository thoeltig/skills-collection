/**
 * Turns step outcomes into the few lines an agent reads: one headline per step, then findings
 * grouped so a code repeated across files is one line. Bounded at `MAX_LINES` finding lines.
 */
import { isAbsolute } from 'node:path';
import { collapseRanges, oneLine, projectRelative, type Finding } from '../skills/negative-space-programming/scripts/contract.ts';
import type { StepOutcome } from './checks.ts';

export const MAX_LINES = 15;
const MAX_FILES_PER_GROUP = 4;
const DETAIL_LENGTH = 110;
const NAMES_PER_GROUP = 2;

/**
 * What makes two findings the same problem across runs. Never the line: an edit above a
 * pre-existing error moves it, and it must not read as new. A test is identified by name alone,
 * since its message may carry values that change per run.
 */
export function identity(tool: string, finding: Finding): string {
  if (finding.test !== undefined) return `${tool}|test|${finding.test}`;
  return `${tool}|${finding.file}|${finding.code}|${finding.detail}`;
}

function label(step: StepOutcome, steps: readonly StepOutcome[]): string {
  const name = step.kind === 'build' ? 'Build' : 'Tests';
  const sameKind = steps.filter((other) => other.kind === step.kind).length;
  return sameKind > 1 ? `${name} (${step.tool})` : name;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function stateHeadline(name: string, step: StepOutcome): string {
  const { result } = step;
  if (!result.ok) return `${name} not run: ${result.reason} — ${oneLine(result.detail.split('\n')[0] ?? '', DETAIL_LENGTH)}`;
  const { checked, skipped = 0, findings } = result.report;
  const skippedText = skipped === 0 ? '' : `, ${skipped} skipped`;
  if (step.kind === 'build') return findings.length === 0 ? `${name} green` : `${name} red: ${plural(findings.length, 'problem')}`;
  if (findings.length === 0) return `${name} ${checked}/${checked} green${skippedText}`;
  return `${name} red: ${findings.length} of ${checked} failing${skippedText}`;
}

/** msbuild names project-level diagnostics by absolute path; inside the root they read relative. */
function shownPath(root: string, file: string): string {
  return isAbsolute(file) ? (projectRelative(root, file) ?? file) : file;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups.values()];
}

function groupLines(findings: readonly Finding[], root: string): string[] {
  return groupBy(findings, (finding) => finding.code).map((members) => {
    const code = members[0]?.code ?? '';
    const lines = new Map<string, number[]>();
    for (const member of members) {
      const file = shownPath(root, member.file);
      lines.set(file, [...(lines.get(file) ?? []), member.line]);
    }
    const files = [...lines.entries()].map(([file, numbers]) => {
      const located = numbers.filter((number) => number > 0);
      return located.length === 0 ? file : `${file}:${collapseRanges(located)}`;
    });
    const shownFiles = files.slice(0, MAX_FILES_PER_GROUP).join(' · ');
    const moreFiles = files.length > MAX_FILES_PER_GROUP ? ` · +${files.length - MAX_FILES_PER_GROUP} files` : '';
    const count = members.length > 1 ? ` ×${members.length}` : '';
    return `  ${code}${count}: ${oneLine(members[0]?.detail ?? '', DETAIL_LENGTH)} — ${shownFiles}${moreFiles}`;
  });
}

/** `Namespace.Class.Method(arg: "a.b")` as `Class.Method(arg: "a.b")`: the namespace repeats the path. */
function shortName(test: string): string {
  const base = test.split('(')[0] ?? test;
  return `${base.split('.').slice(-2).join('.')}${test.slice(base.length)}`;
}

/** Tests failing with the same message at the same line share a cause, so they are one line. */
function testLines(findings: readonly Finding[], root: string): string[] {
  const groups = groupBy(findings, (finding) => `${finding.file}|${finding.line}|${finding.detail}`);
  return groups.map((members) => {
    const first = members[0] as Finding;
    const location = first.line > 0 ? ` (${shownPath(root, first.file)}:${first.line})` : '';
    const cause = `${oneLine(first.detail, DETAIL_LENGTH)}${location}`;
    if (members.length === 1) return `  ✖ ${shortName(first.test ?? first.file)} — ${cause}`;
    const names = members.slice(0, NAMES_PER_GROUP).map((member) => shortName(member.test ?? member.file));
    const more = members.length > NAMES_PER_GROUP ? `, +${members.length - NAMES_PER_GROUP}` : '';
    return `  ✖ ${members.length} tests — ${cause}: ${names.join(', ')}${more}`;
  });
}

function findingLines(step: StepOutcome, findings: readonly Finding[], root: string): string[] {
  return step.kind === 'test' ? testLines(findings, root) : groupLines(findings, root);
}

function capped(lines: readonly string[]): string[] {
  if (lines.length <= MAX_LINES) return [...lines];
  return [...lines.slice(0, MAX_LINES), `  +${lines.length - MAX_LINES} more`];
}

function findingsOf(step: StepOutcome): readonly Finding[] {
  return step.result.ok ? step.result.report.findings : [];
}

/** The full state: one line when everything is green, else headlines with their findings. */
export function describeState(steps: readonly StepOutcome[], root: string): string {
  const headlines = steps.map((step) => stateHeadline(label(step, steps), step));
  const details = steps.map((step) => findingLines(step, findingsOf(step), root));
  if (details.every((lines) => lines.length === 0) && steps.every((step) => step.result.ok)) return headlines.join(' · ');
  return steps.flatMap((_, index) => [headlines[index] as string, ...capped(details[index] ?? [])]).join('\n');
}

export interface Regressions {
  readonly text: string;
  /** Sorted identities of everything new; equal keys on two stops mean the agent made no progress. */
  readonly keys: readonly string[];
}

function baselineFor(step: StepOutcome, index: number, baseline: readonly StepOutcome[]): StepOutcome | undefined {
  const sameIndex = baseline[index];
  return sameIndex?.tool === step.tool ? sameIndex : baseline.find((other) => other.tool === step.tool);
}

/** What is worse than the baseline: steps that stopped running, and findings the baseline did not have. */
export function findRegressions(baseline: readonly StepOutcome[], current: readonly StepOutcome[], root: string): Regressions | undefined {
  const lines: string[] = [];
  const keys: string[] = [];
  for (const [index, step] of current.entries()) {
    const name = label(step, current);
    const before = baselineFor(step, index, baseline);
    if (!step.result.ok) {
      if (before?.result.ok === false) continue;
      lines.push(stateHeadline(name, step));
      keys.push(`${step.tool}|not-run|${step.result.reason}`);
      continue;
    }
    const known = new Set(before === undefined ? [] : findingsOf(before).map((finding) => identity(before.tool, finding)));
    const added = step.result.report.findings.filter((finding) => !known.has(identity(step.tool, finding)));
    if (added.length === 0) continue;
    const noun = step.kind === 'test' ? 'new failing test' : 'new problem';
    lines.push(`${name} red: ${plural(added.length, noun)}`, ...capped(findingLines(step, added, root)));
    keys.push(...added.map((finding) => identity(step.tool, finding)));
  }
  if (lines.length === 0) return undefined;
  return { text: lines.join('\n'), keys: keys.sort() };
}
