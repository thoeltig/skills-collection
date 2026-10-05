import { test } from 'node:test';
import expect from 'node:assert/strict';

import { analyze } from './coverage.ts';
import { report } from './cobertura-samples.ts';

const gap = { name: 'Ns.A', file: 'a.cs', methods: [{ name: 'M', lines: [[1, 1], [2, 0], [3, 0]] as const }] };

test('reports a gap present in every framework report once, not once per report', () => {
  const result = analyze([report('net8.xml', [gap]), report('net9.xml', [gap]), report('net10.xml', [gap])]);

  expect.equal(result.checked, 1);
  expect.deepEqual(result.findings, [{ file: 'a.cs', line: 2, code: 'uncovered', detail: 'uncovered: 2-3 (Ns.A)' }]);
});

test('a line covered by another test project is not a finding', () => {
  const other = { name: 'Ns.A', file: 'a.cs', methods: [{ name: 'M', lines: [[2, 1], [3, 5]] as const }] };

  const result = analyze([report('integration.xml', [other]), report('unit.xml', [gap])]);

  expect.equal(result.checked, 1);
  expect.deepEqual(result.findings, []);
});

test('names a gap in a lambda after its declaring class, decoded', () => {
  const lambda = { name: 'Ns.A.<>c__DisplayClass3_0', file: 'a.cs', methods: [{ name: '<M>b__0', lines: [[7, 0]] as const }] };

  const result = analyze([report('a.xml', [lambda])]);

  expect.equal(result.findings[0]?.detail, 'uncovered: 7 (Ns.A)');
});
