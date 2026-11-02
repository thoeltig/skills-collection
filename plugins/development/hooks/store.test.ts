import { test } from 'node:test';
import expect from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSessions, isSafeId, lockPath, pruneResults, sessionDirectory, withLock } from './store.ts';

function withDir(work: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'build-check-store-'));
  try {
    work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function age(path: string, ms: number): void {
  const when = new Date(Date.now() - ms);
  utimesSync(path, when, when);
}

test('refuses ids that could leave the data folder', () => {
  expect.equal(isSafeId('60801c5f-0737-4edf-81d1-1b0139805474'), true);
  expect.equal(isSafeId('ab441c5bcb692446d'), true);
  expect.equal(isSafeId('../x'), false);
  expect.equal(isSafeId(''), false);
  expect.equal(isSafeId(3), false);
  expect.throws(() => sessionDirectory('/data', '../escape'), /sessionId must match/);
});

test('keeps only the newest cached results', () => {
  withDir((dir) => {
    for (let index = 0; index < 5; index++) {
      writeFileSync(join(dir, `${index}.json`), '{}');
      age(join(dir, `${index}.json`), (5 - index) * 1000);
    }
    pruneResults(dir, 2);
    expect.deepEqual(readdirSync(dir).sort(), ['3.json', '4.json']);
  });
});

test('removes the ending session and stale ones, keeps other live sessions', () => {
  withDir((dir) => {
    for (const id of ['ending', 'live', 'crashed']) mkdirSync(sessionDirectory(dir, id), { recursive: true });
    age(sessionDirectory(dir, 'crashed'), 8 * 24 * 60 * 60 * 1000);
    cleanSessions(dir, 'ending', Date.now());
    expect.deepEqual(readdirSync(join(dir, 'sessions')), ['live']);
  });
});

test('cleaning a session that never wrote anything is a no-op', () => {
  withDir((dir) => expect.doesNotThrow(() => cleanSessions(dir, 'never', Date.now())));
});

test('runs work under the lock and releases it, also when the work throws', () => {
  withDir((dir) => {
    const lock = lockPath(dir, 'C:/repo');
    expect.equal(withLock(lock, 0, () => 42), 42);
    expect.equal(existsSync(lock), false);
    expect.throws(() => withLock(lock, 0, () => { throw new Error('boom'); }), /boom/);
    expect.equal(existsSync(lock), false);
  });
});

test('gives up on a held lock after the wait without removing it, and takes over a stale one', () => {
  withDir((dir) => {
    const lock = lockPath(dir, 'C:/repo');
    mkdirSync(join(lock, '..'), { recursive: true });
    writeFileSync(lock, '');
    age(lock, 5000);
    expect.equal(withLock(lock, 0, () => 'ran'), undefined);
    expect.equal(existsSync(lock), true);
    expect.equal(withLock(lock, 1000, () => 'ran', Date.now, 4000), 'ran');
  });
});

test('one folder maps to one lock regardless of case', () => {
  expect.equal(lockPath('/data', 'C:/Repo'), lockPath('/data', 'c:/repo'));
});
