import { isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Shared output contract for every tool filter in this folder.
 *
 * One tally line, then findings only. A clean run prints the tally and nothing else, because a
 * reader given "point 1 ok / point 2 ok / point 3 fail" has to find point 3, and a reader given
 * only point 3 is already working.
 */

// If the project already has an assert module, delete this block and import from it instead.
export class InvariantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolation';
  }
}

export function assert(condition: boolean, message: string): asserts condition {
  if (condition) return;
  const violation = new InvariantViolation(message);
  Error.captureStackTrace?.(violation, assert);
  throw violation;
}

/** A single actionable problem. `detail` is the one distinguishing fact, already trimmed. */
export interface Finding {
  readonly file: string;
  /** 0 when the tool reports no position (project-level diagnostics); rendered without `:line`. */
  readonly line: number;
  readonly column?: number;
  readonly code: string;
  readonly detail: string;
  /** Full name of the failed test; set only by test filters. Its identity across runs, as lines and messages shift. */
  readonly test?: string;
}

export interface ToolReport {
  readonly tool: string;
  /** Units examined — files, classes, methods, tests. Reported so a silent no-op is visible. */
  readonly checked: number;
  /** Units found but not run (skipped, todo). Absent for tools without that notion. */
  readonly skipped?: number;
  readonly findings: readonly Finding[];
}

/** A filter's outcome: its report, or why the tool could not produce one. Distinct from "ran and found problems". */
export type CheckResult =
  | { readonly ok: true; readonly report: ToolReport }
  | { readonly ok: false; readonly tool: string; readonly reason: string; readonly detail: string };

/**
 * Output bound. A first run on an untested codebase can produce thousands of findings; the cap
 * keeps that readable and the overflow count keeps it honest.
 */
export const MAX_FINDINGS = 100;

/**
 * Deterministic order: file, then line, then code. Two runs over unchanged input produce
 * byte-identical output, so a diff in the report means the code changed.
 */
function compareFindings(left: Finding, right: Finding): number {
  if (left.file !== right.file) return left.file < right.file ? -1 : 1;
  if (left.line !== right.line) return left.line - right.line;
  if (left.code !== right.code) return left.code < right.code ? -1 : 1;
  return 0;
}

export function render(report: ToolReport): string {
  assert(report.tool.length > 0, 'report.tool must be a non-empty tool name');
  assert(report.checked >= 0, `report.checked must be >= 0, got ${report.checked}`);

  const total = report.findings.length;
  const skipped = report.skipped === undefined || report.skipped === 0 ? '' : `, ${report.skipped} skipped`;
  const tally =
    total === 0
      ? `✓ ${report.tool}: ${report.checked} checked${skipped}, 0 findings`
      : `✖ ${report.tool}: ${report.checked} checked${skipped}, ${total} findings`;

  if (total === 0) return `${tally}\n`;

  const ordered = [...report.findings].sort(compareFindings);
  const shown = ordered.slice(0, MAX_FINDINGS);
  const lines = shown.map((finding) => {
    const column = finding.column === undefined ? '' : `-${finding.column}`;
    const location = finding.line > 0 ? `${finding.file}:${finding.line}${column}` : finding.file;
    const test = finding.test === undefined ? '' : `${finding.test}: `;
    return `  ${location}  [${finding.code}] ${test}${finding.detail}`;
  });

  const dropped = total - shown.length;
  if (dropped > 0) lines.push(`  …and ${dropped} more (cap ${MAX_FINDINGS})`);

  return `${tally}\n${lines.join('\n')}\n`;
}

/** Uniform exit for a tool that could not produce a report. Exit 2, distinct from "ran and found problems". */
export function reportCheckFailure(failure: Extract<CheckResult, { ok: false }>): number {
  process.stderr.write(`✖ ${failure.tool}: ${failure.reason} — ${failure.detail}\n`);
  return 2;
}

/** The filter is the gate, not a viewer: any finding fails the step. */
export function exitCode(report: ToolReport): number {
  return report.findings.length === 0 ? 0 : 1;
}

/**
 * True only when this module was launched directly. Every filter guards its `main` with it, so the
 * parsers can be imported by a test without spawning the tool and setting a process exit code.
 */
export function isEntryPoint(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return moduleUrl === pathToFileURL(entry).href;
}

/**
 * A path relative to the checked project with forward slashes, or undefined when it lies outside it
 * (a framework frame, another drive). Lets a test filter pick the stack frame that is ours.
 */
export function projectRelative(cwd: string, file: string): string | undefined {
  const path = relative(cwd, file);
  if (path.length === 0 || path.startsWith('..') || isAbsolute(path)) return undefined;
  return path.replaceAll('\\', '/');
}

/** A multi-line tool message as one line: non-empty lines joined, whitespace collapsed, capped at `max` characters. */
export function oneLine(text: string, max: number = 200): string {
  assert(max > 1, `oneLine max must be > 1, got ${max}`);
  const joined = text
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join(' · ');
  return joined.length <= max ? joined : `${joined.slice(0, max - 1)}…`;
}

/** Collapses [12,13,14,88] to "12-14, 88". Keeps long runs from filling the line. */
export function collapseRanges(numbers: readonly number[]): string {
  assert(numbers.length > 0, 'collapseRanges needs at least one line number');

  const sorted = [...numbers].sort((left, right) => left - right);
  const parts: string[] = [];
  let start = sorted[0] as number;
  let previous = start;

  for (const current of sorted.slice(1)) {
    if (current === previous || current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  parts.push(start === previous ? `${start}` : `${start}-${previous}`);

  return parts.join(', ');
}
