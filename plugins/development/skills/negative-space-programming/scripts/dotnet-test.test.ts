import { test } from 'node:test';
import expect from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseTrx, readReports } from './dotnet-test.ts';

// Shape captured from xunit.v3 4.0.2 `--report-xunit-trx` on Microsoft.Testing.Platform, paths replaced.
const CWD = resolve('/repo');
const SOURCE = join(CWD, 'Probe.Tests', 'ProbeTests.cs');

function result(name: string, outcome: string, body = ''): string {
  const attributes = `testName="${name}" outcome="${outcome}" testId="x"`;
  return body === '' ? `<UnitTestResult ${attributes} />` : `<UnitTestResult ${attributes}>${body}</UnitTestResult>`;
}

function failure(message: string, stackTrace: string): string {
  return `<Output><ErrorInfo><Message>${message}</Message><StackTrace>${stackTrace}</StackTrace></ErrorInfo></Output>`;
}

function trx(results: readonly string[], total = results.length): string {
  return `<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results>${results.join('')}</Results><ResultSummary outcome="Failed"><Counters total="${total}" executed="0" passed="0" failed="0" /></ResultSummary></TestRun>`;
}

const HELPER_THROW = failure(
  'System.InvalidOperationException : invariant broke, got -3',
  `   at Probe.Tests.Helper.Throw() in ${SOURCE}:line 25\n   at Probe.Tests.ProbeTests.FailsOnException() in ${SOURCE}:line 12\n   at System.Reflection.MethodBaseInvoker.InvokeWithNoArgs(Object obj, BindingFlags invokeAttr)`,
);

const ASSERT_EQUAL = failure(
  'Assert.Equal() Failure: Values differ\nExpected: 3\nActual:   2',
  `   at Probe.Tests.ProbeTests.FailsOnAssert() in ${SOURCE}:line 9`,
);

const SAMPLE = trx([
  result('Probe.Tests.ProbeTests.Passes', 'Passed'),
  result('Probe.Tests.ProbeTests.FailsOnAssert', 'Failed', ASSERT_EQUAL),
  result('Probe.Tests.ProbeTests.FailsOnException', 'Failed', HELPER_THROW),
  result('Probe.Tests.ProbeTests.Skipped', 'NotExecuted', '<Output><StdOut>probe skip</StdOut></Output>'),
]);

test('counts executed and skipped tests and reports each failure at its innermost project frame', () => {
  const parsed = parseTrx(SAMPLE, CWD);
  expect.ok(parsed.ok);
  expect.equal(parsed.value.executed, 3);
  expect.equal(parsed.value.skipped, 1);
  expect.deepEqual(parsed.value.findings, [
    {
      file: 'Probe.Tests/ProbeTests.cs',
      line: 9,
      code: 'TEST',
      detail: 'Assert.Equal() Failure: Values differ · Expected: 3 · Actual: 2',
      test: 'Probe.Tests.ProbeTests.FailsOnAssert',
    },
    {
      file: 'Probe.Tests/ProbeTests.cs',
      line: 25,
      code: 'TEST',
      detail: 'System.InvalidOperationException : invariant broke, got -3',
      test: 'Probe.Tests.ProbeTests.FailsOnException',
    },
  ]);
});

test('decodes XML entities in test names and messages', () => {
  const name = 'Theory(clientId: &quot;a&amp;b&quot;)';
  const parsed = parseTrx(trx([result(name, 'Failed', failure('expected &lt;1&gt;', ''))]), CWD);
  expect.ok(parsed.ok);
  expect.equal(parsed.value.findings[0]?.test, 'Theory(clientId: "a&b")');
  expect.equal(parsed.value.findings[0]?.detail, 'expected <1>');
});

test('falls back to the test name when no frame lies inside the project', () => {
  const outside = failure('boom', '   at System.Linq.Enumerable.First() in /_/src/Enumerable.cs:line 7');
  const parsed = parseTrx(trx([result('T.Outside', 'Failed', outside)]), CWD);
  expect.ok(parsed.ok);
  expect.deepEqual(parsed.value.findings[0], { file: 'T.Outside', line: 0, code: 'TEST', detail: 'boom', test: 'T.Outside' });
});

test('reads a frame from a runtime with German resources', () => {
  const german = failure('kaputt', `   bei T.Run() in ${SOURCE}:Zeile 14`);
  const parsed = parseTrx(trx([result('T.Run', 'Failed', german)]), CWD);
  expect.ok(parsed.ok);
  expect.equal(parsed.value.findings[0]?.line, 14);
});

test('rejects a report whose Counters disagree with the results read', () => {
  const parsed = parseTrx(trx([result('T.A', 'Passed')], 2), CWD);
  expect.equal(parsed.ok, false);
});

test('accepts a report with zero results when Counters agree', () => {
  const parsed = parseTrx(trx([]), CWD);
  expect.ok(parsed.ok);
  expect.equal(parsed.value.executed, 0);
});

test('merges one report per target framework and reports a repeated failure once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trx-merge-'));
  try {
    writeFileSync(join(directory, 'net8.trx'), SAMPLE);
    writeFileSync(join(directory, 'net9.trx'), SAMPLE);
    const merged = readReports(directory, 2, '', CWD);
    expect.ok(merged.ok);
    expect.equal(merged.report.checked, 6);
    expect.equal(merged.report.skipped, 2);
    expect.equal(merged.report.findings.length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports a run without any TRX file as a run failure, not as a clean run', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trx-none-'));
  try {
    const merged = readReports(directory, 1, 'error CS1002: ; expected', CWD);
    expect.equal(merged.ok, false);
    if (!merged.ok) expect.equal(merged.reason, 'NoTrxReport');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
