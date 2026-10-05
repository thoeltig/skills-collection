import { describe, test } from 'node:test';
import expect from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InvariantViolation } from './contract.ts';
import { declaringClassName, decodeEntities, mergeClasses, parseCobertura, readableMethodName, readReports } from './cobertura.ts';
import { report } from './cobertura-samples.ts';

describe('declaringClassName', () => {
  test('folds lambda closures and async state machines into the declaring class', () => {
    expect.equal(declaringClassName('Ns.Mailer.<>c__DisplayClass3_0'), 'Ns.Mailer');
    expect.equal(declaringClassName('Ns.Mailer/<SendAsync>d__5'), 'Ns.Mailer');
  });

  test('drops generic parameters, so a generic class and its state machines share one name', () => {
    expect.equal(declaringClassName('Ns.Validator<T>'), 'Ns.Validator');
    expect.equal(declaringClassName('Ns.Validator/<RunAsync>d__2'), 'Ns.Validator');
  });
});

describe('readableMethodName', () => {
  test('names a state machine after the method that owns it', () => {
    expect.equal(readableMethodName('Ns.A/<SendAsync>d__5', 'MoveNext'), 'SendAsync (state machine)');
    expect.equal(readableMethodName('Ns.A.<SaveAsync>d__3<T>', 'MoveNext'), 'SaveAsync (state machine)');
  });

  test('names a lambda after its enclosing method', () => {
    expect.equal(readableMethodName('Ns.A.<>c', '<Send>b__3_0'), 'lambda in Send');
  });

  test('leaves ordinary methods alone', () => {
    expect.equal(readableMethodName('Ns.A', 'Send'), 'Send');
  });
});

test('decodeEntities decodes the XML entities and leaves other text alone', () => {
  expect.equal(decodeEntities('A.&lt;&gt;c &amp; &quot;x&quot; &apos;y&apos;'), `A.<>c & "x" 'y'`);
  expect.equal(decodeEntities('&nbsp;'), '&nbsp;');
});

describe('parseCobertura', () => {
  test('reads class-level lines once, not again from the methods', () => {
    const [cls] = parseCobertura(report('a.xml', [{ name: 'A', file: 'a.cs', methods: [{ name: 'M', lines: [[1, 0], [2, 3]] }] }]));
    expect.deepEqual([...(cls?.lines ?? [])], [[1, 0], [2, 3]]);
  });

  test('rejects input that is not Cobertura, with the source in the message', () => {
    expect.throws(
      () => parseCobertura({ source: 'x.xml', xml: '<html></html>' }),
      (error: unknown) => error instanceof InvariantViolation && error.message.includes('x.xml'),
    );
  });

  test('rejects a report without classes instead of reporting it as clean', () => {
    expect.throws(
      () => parseCobertura({ source: 'e.xml', xml: '<coverage><packages></packages></coverage>' }),
      (error: unknown) => error instanceof InvariantViolation && error.message.includes('no <class>'),
    );
  });
});

describe('mergeClasses', () => {
  test('a line hit by any report counts as covered', () => {
    const net8 = report('net8.xml', [{ name: 'A', file: 'a.cs', methods: [{ name: 'M', lines: [[1, 0], [2, 1]] }] }]);
    const net9 = report('net9.xml', [{ name: 'A', file: 'a.cs', methods: [{ name: 'M', lines: [[1, 4], [2, 0]] }] }]);

    const merged = mergeClasses([...parseCobertura(net8), ...parseCobertura(net9)]);

    expect.equal(merged.length, 1);
    expect.deepEqual([...(merged[0]?.lines ?? [])], [[1, 4], [2, 1]]);
  });

  test('folds a compiler-generated class into its declaring class', () => {
    const merged = mergeClasses(
      parseCobertura(
        report('a.xml', [
          { name: 'Ns.A', file: 'a.cs', methods: [{ name: 'M', lines: [[10, 1]] }] },
          { name: 'Ns.A.<>c__DisplayClass3_0', file: 'a.cs', methods: [{ name: '<M>b__0', lines: [[11, 0]] }] },
        ]),
      ),
    );

    expect.deepEqual(merged.map((cls) => cls.name), ['Ns.A']);
    expect.deepEqual([...(merged[0]?.lines.keys() ?? [])], [10, 11]);
  });
});

describe('readReports', () => {
  test('searches directories recursively for the MTP and c8 report names only', () => {
    const root = mkdtempSync(join(tmpdir(), 'reports-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, '0a.cobertura.xml'), '<coverage/>');
      writeFileSync(join(root, 'nested', 'cobertura-coverage.xml'), '<coverage/>');
      writeFileSync(join(root, 'result.trx'), '<TestRun/>');
      writeFileSync(join(root, 'other.xml'), '<x/>');

      const found = readReports([root]).map((entry) => entry.source);

      expect.deepEqual(found, [join(root, '0a.cobertura.xml'), join(root, 'nested', 'cobertura-coverage.xml')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails when a directory contains no report', () => {
    const root = mkdtempSync(join(tmpdir(), 'reports-'));
    try {
      expect.throws(
        () => readReports([root]),
        (error: unknown) => error instanceof InvariantViolation && error.message.includes('no Cobertura report'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
