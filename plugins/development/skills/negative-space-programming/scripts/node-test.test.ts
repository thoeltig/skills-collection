import { test } from 'node:test';
import expect from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNodeTest, parseRecords, toRecord } from './node-test.ts';

const SAMPLE = `import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
function helper() { throw new Error('invariant broke, got -3'); }
describe('suite', () => {
  it('passes', () => assert.equal(1 + 1, 2));
  it('fails on assert', () => assert.equal(1 + 1, 3));
  it('fails in helper', () => helper());
  it.skip('skipped', () => {});
  it.todo('todo');
});
test('top-level passes', () => {});
`;

test('ignores a suite that failed only because its children did', () => {
  const event = { type: 'test:fail', data: { name: 'suite', details: { type: 'suite', error: { failureType: 'subtestsFailed' } } } };
  expect.equal(toRecord(event), undefined);
});

test('keeps a suite that failed for its own reason', () => {
  const error = { failureType: 'hookFailed', cause: new Error('before hook broke') };
  const record = toRecord({ type: 'test:fail', data: { name: 'suite', details: { type: 'suite', error } } });
  expect.equal(record?.kind, 'fail');
});

test('reads only the run summary, not the per-file ones', () => {
  const counts = { tests: 3, failed: 1, cancelled: 0, skipped: 1, todo: 0 };
  expect.equal(toRecord({ type: 'test:summary', data: { file: '/a.test.ts', counts } }), undefined);
  expect.deepEqual(toRecord({ type: 'test:summary', data: { counts } }), { kind: 'summary', ...counts });
});

test('rejects output without a run summary instead of reporting a clean run', () => {
  expect.deepEqual(parseRecords('', '/repo'), { ok: false, reason: 'the reporter wrote no run summary' });
});

test('rejects a summary counting more failures than were reported', () => {
  const summary = JSON.stringify({ kind: 'summary', tests: 2, failed: 1, cancelled: 0, skipped: 0, todo: 0 });
  expect.equal(parseRecords(summary, '/repo').ok, false);
});

test('runs node --test and reports each failure at its innermost project frame', () => {
  const directory = mkdtempSync(join(tmpdir(), 'node-test-'));
  // A child of the test runner otherwise reports to this runner instead of to the custom reporter.
  const context = process.env['NODE_TEST_CONTEXT'];
  delete process.env['NODE_TEST_CONTEXT'];
  try {
    writeFileSync(join(directory, 'sample.test.mjs'), SAMPLE);
    const result = checkNodeTest(['sample.test.mjs'], directory);
    expect.ok(result.ok, result.ok ? '' : `${result.reason}: ${result.detail}`);
    expect.equal(result.report.checked, 4);
    expect.equal(result.report.skipped, 2);
    const located = result.report.findings.map((finding) => [finding.test, finding.file, finding.line]);
    expect.deepEqual(located, [
      ['suite > fails on assert', 'sample.test.mjs', 6],
      ['suite > fails in helper', 'sample.test.mjs', 3],
    ]);
    expect.equal(result.report.findings[1]?.detail, 'invariant broke, got -3');
  } finally {
    if (context !== undefined) process.env['NODE_TEST_CONTEXT'] = context;
    rmSync(directory, { recursive: true, force: true });
  }
});
