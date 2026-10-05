/** Minimal Cobertura reports in the shapes the real emitters write, for the filter tests. */

import type { CoberturaSource } from './cobertura.ts';

export interface SampleMethod {
  readonly name: string;
  readonly complexity?: number;
  /** [line number, hits] */
  readonly lines: readonly (readonly [number, number])[];
}

export interface SampleClass {
  readonly name: string;
  readonly file: string;
  readonly methods: readonly SampleMethod[];
}

function lineXml([number, hits]: readonly [number, number]): string {
  return `<line number="${number}" hits="${hits}" branch="False" />`;
}

function methodXml(method: SampleMethod): string {
  const complexity = method.complexity === undefined ? '' : ` complexity="${method.complexity}"`;
  return (
    `<method name="${method.name}" signature="()" line-rate="0"${complexity}>` +
    `<lines>${method.lines.map(lineXml).join('')}</lines></method>`
  );
}

/** Class names are XML-escaped the way the emitters write them (`&lt;&gt;c__DisplayClass3_0`). */
function classXml(cls: SampleClass): string {
  const name = cls.name.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const classLines = cls.methods.flatMap((method) => method.lines);
  return (
    `<class name="${name}" filename="${cls.file}" line-rate="0" complexity="1">` +
    `<methods>${cls.methods.map(methodXml).join('')}</methods>` +
    `<lines>${classLines.map(lineXml).join('')}</lines></class>`
  );
}

export function report(source: string, classes: readonly SampleClass[]): CoberturaSource {
  const xml =
    `<?xml version="1.0" encoding="utf-8"?><coverage line-rate="0" version="1.9">` +
    `<packages><package name="Sample" line-rate="0"><classes>${classes.map(classXml).join('')}</classes></package></packages>` +
    `</coverage>`;
  return { source, xml };
}
