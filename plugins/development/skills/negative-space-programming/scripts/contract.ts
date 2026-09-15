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
  readonly line: number;
  readonly column?: number;
  readonly code: string;
  readonly detail: string;
}

export interface ToolReport {
  readonly tool: string;
  /** Units examined — files, classes, methods, tests. Reported so a silent no-op is visible. */
  readonly checked: number;
  readonly findings: readonly Finding[];
}

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
  const tally =
    total === 0
      ? `✓ ${report.tool}: ${report.checked} checked, 0 findings`
      : `✖ ${report.tool}: ${report.checked} checked, ${total} findings`;

  if (total === 0) return `${tally}\n`;

  const ordered = [...report.findings].sort(compareFindings);
  const shown = ordered.slice(0, MAX_FINDINGS);
  const lines = shown.map((finding) => {
    const column = finding.column === undefined ? '' : `-${finding.column}`;
    return `  ${finding.file}:${finding.line}${column}  [${finding.code}] ${finding.detail}`;
  });

  const dropped = total - shown.length;
  if (dropped > 0) lines.push(`  …and ${dropped} more (cap ${MAX_FINDINGS})`);

  return `${tally}\n${lines.join('\n')}\n`;
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
