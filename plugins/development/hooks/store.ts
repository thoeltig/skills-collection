/**
 * The hook's files under the plugin data folder: per session one baseline per agent and a log;
 * across sessions one lock per checked folder. A session's folder is deleted when the session ends.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert } from '../skills/negative-space-programming/scripts/contract.ts';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const LOCK_POLL_MS = 1000;
/** The hook timeout in hooks.json: a lock older than that belongs to a run the timeout killed. */
export const LOCK_STALE_MS = 1_800_000;

/** Ids arrive in hook input from outside; anything that could escape the data folder is refused. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

export function sessionDirectory(dataRoot: string, sessionId: string): string {
  assert(isSafeId(sessionId), `sessionId must match ${ID}, got ${JSON.stringify(sessionId)}`);
  return join(dataRoot, 'sessions', sessionId);
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

export function appendLog(sessionDir: string, record: Readonly<Record<string, unknown>>): void {
  mkdirSync(sessionDir, { recursive: true });
  appendFileSync(join(sessionDir, 'build-check.log'), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

export function cleanSession(dataRoot: string, sessionId: string): void {
  rmSync(sessionDirectory(dataRoot, sessionId), { recursive: true, force: true });
}

export function lockPath(dataRoot: string, folder: string): string {
  const key = createHash('sha1').update(folder.toLowerCase()).digest('hex').slice(0, 16);
  return join(dataRoot, 'locks', `${key}.lock`);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAcquire(path: string, staleMs: number, now: () => number): boolean {
  try {
    closeSync(openSync(path, 'wx'));
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (now() - statSync(path).mtimeMs > staleMs) rmSync(path, { force: true });
  return false;
}

/**
 * Runs `work` while holding the folder's lock, so two agents in one folder never build at once.
 * Returns undefined when the lock stayed taken for `waitMs`.
 */
export function withLock<T>(
  path: string,
  waitMs: number,
  work: () => T,
  now: () => number = Date.now,
  staleMs: number = LOCK_STALE_MS,
): T | undefined {
  assert(waitMs >= 0, `waitMs must be >= 0, got ${waitMs}`);
  mkdirSync(join(path, '..'), { recursive: true });
  const deadline = now() + waitMs;
  while (!tryAcquire(path, staleMs, now)) {
    if (now() >= deadline) return undefined;
    sleep(LOCK_POLL_MS);
  }
  try {
    return work();
  } finally {
    rmSync(path, { force: true });
  }
}
