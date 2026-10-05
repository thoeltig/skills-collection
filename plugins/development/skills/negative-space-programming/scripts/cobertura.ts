/**
 * Cobertura reading shared by `coverage.ts` and `crap.ts`.
 *
 * One report exists per test project and target framework, and each covers only what that run
 * executed. Reports are therefore merged before anything is judged: a line counts as covered when
 * any report hit it. Judging each report alone lists the same gap once per framework, and flags a
 * line as uncovered whenever one test project happens not to reach it.
 *
 * Emitters: `Microsoft.Testing.Extensions.CodeCoverage` (C#, writes per-method `complexity`) and
 * c8/istanbul (TypeScript, no `complexity`).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { assert } from './contract.ts';

export interface CoberturaSource {
  readonly source: string;
  readonly xml: string;
}

export interface ParsedMethod {
  readonly name: string;
  readonly signature: string;
  readonly complexity: number;
  /** line number -> hits */
  readonly lines: ReadonlyMap<number, number>;
}

export interface ParsedClass {
  /** Declaring class: compiler-generated nested classes are folded into it. */
  readonly name: string;
  readonly file: string;
  readonly lines: ReadonlyMap<number, number>;
  readonly methods: readonly ParsedMethod[];
}

export interface MergedClass {
  readonly name: string;
  readonly file: string;
  readonly lines: ReadonlyMap<number, number>;
}

export interface MergedMethod {
  readonly className: string;
  readonly name: string;
  readonly file: string;
  readonly complexity: number;
  readonly lines: ReadonlyMap<number, number>;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * `Ns.Type.<>c__DisplayClass3_0` (lambda closure) and `Ns.Type/<Run>d__5` (async state machine)
 * belong to `Ns.Type`. Reporting them separately lists one gap under several unreadable names.
 * Generic parameters are dropped too: the C# emitter names `Ns.Type<T>` but its state machines
 * `Ns.Type/<Run>d__5`, so keeping `<T>` would split one class in two.
 */
export function declaringClassName(name: string): string {
  const generated = /[./]</.exec(name);
  const declaring = generated === null ? name : name.slice(0, generated.index);
  const genericStart = declaring.indexOf('<');
  return genericStart === -1 ? declaring : declaring.slice(0, genericStart);
}

/** `MoveNext` of `<SendAsync>d__5` → `SendAsync (state machine)`; `<Send>b__3_0` → `lambda in Send`. */
export function readableMethodName(className: string, methodName: string): string {
  const stateMachine = /[./]<([^>]+)>d__\d+(?:<.*>)?$/.exec(className);
  if (stateMachine !== null && methodName === 'MoveNext') return `${stateMachine[1]} (state machine)`;
  const lambda = /^<([^>]+)>b__\w+$/.exec(methodName);
  if (lambda !== null) return `lambda in ${lambda[1]}`;
  return methodName;
}

function attributeOf(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
}

function parseLines(body: string): Map<number, number> {
  const lines = new Map<number, number>();
  const linePattern = /<line\b([^>]*?)\/?>/g;
  for (let line = linePattern.exec(body); line !== null; line = linePattern.exec(body)) {
    const attributes = line[1] ?? '';
    const number = Number(attributeOf(attributes, 'number') ?? '0');
    if (number <= 0) continue;
    const hits = Number(attributeOf(attributes, 'hits') ?? '0');
    lines.set(number, Math.max(lines.get(number) ?? 0, hits));
  }
  return lines;
}

function parseMethods(classBody: string, className: string, source: string): ParsedMethod[] {
  const methods: ParsedMethod[] = [];
  const methodPattern = /<method\b([^>]*)>/g;
  for (let met = methodPattern.exec(classBody); met !== null; met = methodPattern.exec(classBody)) {
    const end = classBody.indexOf('</method>', met.index);
    assert(end > met.index, `unterminated <method> at offset ${met.index} in ${source}`);
    const attributes = met[1] ?? '';
    methods.push({
      name: readableMethodName(className, attributeOf(attributes, 'name') ?? '(unnamed)'),
      signature: attributeOf(attributes, 'signature') ?? '',
      complexity: Number(attributeOf(attributes, 'complexity') ?? '0'),
      lines: parseLines(classBody.slice(met.index, end)),
    });
  }
  return methods;
}

/**
 * Cobertura has a fixed, shallow shape, so a targeted scan beats a dependency. This is NOT a
 * general XML parser: it asserts the structure it expects, so a format change fails loudly instead
 * of silently reporting a clean run.
 */
export function parseCobertura({ source, xml }: CoberturaSource): readonly ParsedClass[] {
  assert(xml.length > 0, `coverage file is empty: ${source}`);
  assert(xml.includes('<coverage'), `not a Cobertura report, no <coverage> element: ${source}`);

  const classes: ParsedClass[] = [];
  const classPattern = /<class\b([^>]*)>/g;
  for (let cls = classPattern.exec(xml); cls !== null; cls = classPattern.exec(xml)) {
    const end = xml.indexOf('</class>', cls.index);
    assert(end > cls.index, `unterminated <class> at offset ${cls.index} in ${source}`);

    const attributes = cls[1] ?? '';
    const body = xml.slice(cls.index, end);
    const methodsEnd = body.lastIndexOf('</methods>');
    const className = attributeOf(attributes, 'name') ?? '(unnamed)';
    classes.push({
      name: declaringClassName(className),
      file: attributeOf(attributes, 'filename') ?? '(unknown)',
      // Class-level <lines> follow <methods>; scanning past it avoids counting method lines twice.
      lines: parseLines(methodsEnd === -1 ? body : body.slice(methodsEnd)),
      methods: parseMethods(body, className, source),
    });
  }

  assert(classes.length > 0, `no <class> elements in ${source} — wrong format?`);
  return classes;
}

function mergeLines(target: Map<number, number>, lines: ReadonlyMap<number, number>): void {
  for (const [number, hits] of lines) target.set(number, Math.max(target.get(number) ?? 0, hits));
}

/** One entry per (file, declaring class); a line keeps the highest hit count of any report. */
export function mergeClasses(classes: readonly ParsedClass[]): readonly MergedClass[] {
  const merged = new Map<string, { name: string; file: string; lines: Map<number, number> }>();
  for (const cls of classes) {
    const key = `${cls.file}\u0000${cls.name}`;
    const entry = merged.get(key) ?? { name: cls.name, file: cls.file, lines: new Map() };
    mergeLines(entry.lines, cls.lines);
    merged.set(key, entry);
  }
  return [...merged.values()];
}

/** One entry per (file, declaring class, method, signature). */
export function mergeMethods(classes: readonly ParsedClass[]): readonly MergedMethod[] {
  const merged = new Map<string, { className: string; name: string; file: string; complexity: number; lines: Map<number, number> }>();
  for (const cls of classes) {
    for (const method of cls.methods) {
      const key = `${cls.file}\u0000${cls.name}\u0000${method.name}\u0000${method.signature}`;
      const entry = merged.get(key) ?? { className: cls.name, name: method.name, file: cls.file, complexity: 0, lines: new Map() };
      entry.complexity = Math.max(entry.complexity, method.complexity);
      mergeLines(entry.lines, method.lines);
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

function collectReports(path: string, found: string[]): void {
  if (!statSync(path).isDirectory()) {
    found.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) collectReports(child, found);
    else if (isCoberturaFileName(entry.name)) found.push(child);
  }
}

/** MTP writes `<guid>.cobertura.xml`, c8/istanbul `cobertura-coverage.xml`. */
export function isCoberturaFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.xml') && lower.includes('cobertura');
}

/**
 * Files are taken as given; directories are searched recursively for Cobertura file names.
 * Neither cmd nor PowerShell expand a `*.xml` glob for node, and MTP names reports by GUID.
 */
export function readReports(paths: readonly string[]): readonly CoberturaSource[] {
  assert(paths.length > 0, 'needs at least one Cobertura report or directory path');
  const files: string[] = [];
  for (const path of paths) collectReports(path, files);
  assert(files.length > 0, `no Cobertura report (*cobertura*.xml) found in: ${paths.join(', ')}`);
  return files.sort().map((source) => ({ source, xml: readFileSync(source, 'utf8') }));
}
