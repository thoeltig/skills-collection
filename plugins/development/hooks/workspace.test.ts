import { test } from 'node:test';
import expect from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRoot } from './workspace.ts';

test('finds the repository root from a subfolder', () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'build-check-repo-')));
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    expect.equal(init.status, 0, init.stderr);
    mkdirSync(join(root, 'sub'));
    expect.equal(gitRoot(join(root, 'sub'))?.toLowerCase(), root.toLowerCase());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('outside a repository there is no root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-check-plain-'));
  try {
    expect.equal(gitRoot(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
