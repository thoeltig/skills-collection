import { test } from 'node:test';
import expect from 'node:assert/strict';
import { join, resolve } from 'node:path';
import type { Finding } from '../skills/negative-space-programming/scripts/contract.ts';
import type { StepOutcome } from './checks.ts';
import { describeState, findRegressions, MAX_LINES } from './summary.ts';

const ROOT = resolve('/repo');

function build(findings: Finding[], tool: 'dotnet-build' | 'tsc' = 'dotnet-build'): StepOutcome {
  return { tool, kind: 'build', result: { ok: true, report: { tool, checked: 3, findings } } };
}

function tests(findings: Finding[], checked = 12, skipped = 0): StepOutcome {
  return { tool: 'dotnet-test', kind: 'test', result: { ok: true, report: { tool: 'dotnet-test', checked, skipped, findings } } };
}

const notRun: StepOutcome = { tool: 'dotnet-test', kind: 'test', result: { ok: false, tool: 'dotnet-test', reason: 'NoTrxReport', detail: 'exited 1 without a TRX report\nlong tail' } };

const nullRef = (file: string, line: number): Finding => ({ file, line, code: 'CS8602', detail: 'Dereference of a possibly null reference.' });
const failing = (test: string, line = 20, detail = 'Expected: 3 · Actual: 2'): Finding => ({ file: 'T/ATests.cs', line, code: 'TEST', detail, test });

test('an all-green state is one line', () => {
  expect.equal(describeState([build([]), tests([], 12, 1)], ROOT), 'Build green · Tests 12/12 green, 1 skipped');
});

test('groups one code across files with collapsed line ranges', () => {
  const state = describeState([build([nullRef('A.cs', 12), nullRef('A.cs', 13), nullRef('B.cs', 40)]), tests([])], ROOT);
  expect.equal(state, ['Build red: 3 problems', '  CS8602 ×3: Dereference of a possibly null reference. — A.cs:12-13 · B.cs:40', 'Tests 12/12 green'].join('\n'));
});

test('shows absolute paths inside the root relative to it, and others unchanged', () => {
  const inside: Finding = { file: join(ROOT, 'App', 'App.csproj'), line: 0, code: 'NU1903', detail: 'vulnerable package' };
  const outside: Finding = { ...inside, file: resolve('/elsewhere/Lib.csproj') };
  const state = describeState([build([inside, outside])], ROOT);
  expect.equal(state.split('\n')[1], `  NU1903 ×2: vulnerable package — App/App.csproj · ${resolve('/elsewhere/Lib.csproj')}`);
});

test('lists a failing test by class and method with its location', () => {
  const state = describeState([build([]), tests([failing('T.ATests.Adds(value: "a.b")')])], ROOT);
  expect.equal(state, ['Build green', 'Tests red: 1 of 12 failing', '  ✖ ATests.Adds(value: "a.b") — Expected: 3 · Actual: 2 (T/ATests.cs:20)'].join('\n'));
});

test('tests failing with one message at one line are one line', () => {
  const shared = ['N.Fixture.One', 'N.Fixture.Two', 'N.Fixture.Three'].map((name) => failing(name, 110, 'Retry failed after 6 tries.'));
  const state = describeState([tests([...shared, failing('N.Other.Four', 7)], 40)], ROOT);
  expect.equal(
    state,
    ['Tests red: 4 of 40 failing', '  ✖ 3 tests — Retry failed after 6 tries. (T/ATests.cs:110): Fixture.One, Fixture.Two, +1', '  ✖ Other.Four — Expected: 3 · Actual: 2 (T/ATests.cs:7)'].join('\n'),
  );
});

test('names a step that could not run with the first line of its reason', () => {
  expect.equal(describeState([build([]), notRun], ROOT), ['Build green', 'Tests not run: NoTrxReport — exited 1 without a TRX report'].join('\n'));
});

test('labels steps by tool when two share a kind', () => {
  expect.equal(describeState([build([], 'tsc'), build([])], ROOT), 'Build (tsc) green · Build (dotnet-build) green');
});

test('caps finding lines and counts the rest', () => {
  const many = Array.from({ length: MAX_LINES + 5 }, (_, index) => failing(`T.Many${index}`, index + 1));
  const lines = describeState([tests(many, 40)], ROOT).split('\n');
  expect.equal(lines.length, 1 + MAX_LINES + 1);
  expect.equal(lines.at(-1), '  +5 more');
});

test('a pre-existing finding on a shifted line is not a regression', () => {
  expect.equal(findRegressions([build([nullRef('A.cs', 12)])], [build([nullRef('A.cs', 30)])], ROOT), undefined);
});

test('reports only findings and failing tests the baseline lacked', () => {
  const regressions = findRegressions(
    [build([nullRef('A.cs', 12)]), tests([failing('T.Old')])],
    [build([nullRef('A.cs', 12), nullRef('C.cs', 5)]), tests([failing('T.Old'), failing('T.New', 33)])],
    ROOT,
  );
  expect.equal(
    regressions?.text,
    ['Build red: 1 new problem', '  CS8602: Dereference of a possibly null reference. — C.cs:5', 'Tests red: 1 new failing test', '  ✖ T.New — Expected: 3 · Actual: 2 (T/ATests.cs:33)'].join('\n'),
  );
  expect.deepEqual(regressions?.keys, ['dotnet-build|C.cs|CS8602|Dereference of a possibly null reference.', 'dotnet-test|test|T.New']);
});

test('a test failing with another message is still the same failure', () => {
  const changed = failing('T.Old', 20, 'Expected: 3 · Actual: 4');
  expect.equal(findRegressions([tests([failing('T.Old')])], [tests([changed])], ROOT), undefined);
});

test('a step that ran before and cannot run now is a regression; one that never ran is not', () => {
  expect.match(findRegressions([tests([])], [notRun], ROOT)?.text ?? '', /^Tests not run: NoTrxReport/);
  expect.equal(findRegressions([notRun], [notRun], ROOT), undefined);
});
