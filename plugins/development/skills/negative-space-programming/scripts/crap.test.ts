import { test } from 'node:test';
import expect from 'node:assert/strict';

import { InvariantViolation } from './contract.ts';
import { analyze, crapScore } from './crap.ts';
import { report } from './cobertura-samples.ts';

test('crapScore matches the anchor table in setup.md', () => {
  expect.equal(crapScore(5, 1), 5);
  expect.equal(crapScore(5, 0), 30);
  expect.equal(crapScore(10, 0.5), 22.5);
  expect.equal(crapScore(10, 0), 110);
});

test('crapScore rejects coverage outside [0, 1]', () => {
  expect.throws(
    () => crapScore(3, 1.5),
    (error: unknown) => error instanceof InvariantViolation && error.message.includes('1.5'),
  );
});

const untested = { name: 'Ns.A', file: 'a.cs', methods: [{ name: 'Run', complexity: 10, lines: [[5, 0], [6, 0]] as const }] };

test('reports an untested complex method once across framework reports', () => {
  const result = analyze([report('net8.xml', [untested]), report('net9.xml', [untested])]);

  expect.ok(result.ok);
  expect.equal(result.report.checked, 1);
  expect.equal(result.report.findings.length, 1);
  expect.match(result.report.findings[0]?.detail ?? '', /^110 for Run \(complexity 10, coverage 0%\)/);
});

test('coverage from another test project counts towards the score', () => {
  const tested = { name: 'Ns.A', file: 'a.cs', methods: [{ name: 'Run', complexity: 10, lines: [[5, 1], [6, 1]] as const }] };

  const result = analyze([report('integration.xml', [tested]), report('unit.xml', [untested])]);

  expect.ok(result.ok);
  expect.deepEqual(result.report.findings, []);
});

test('a report without complexity is a named fault, not a clean run', () => {
  const istanbul = { name: 'pricing.ts', file: 'src/pricing.ts', methods: [{ name: 'price', lines: [[3, 0]] as const }] };

  const result = analyze([report('ts.xml', [istanbul])]);

  expect.deepEqual(result, { ok: false, reason: 'NoComplexity', methods: 1 });
});
