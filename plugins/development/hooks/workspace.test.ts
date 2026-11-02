import { test } from 'node:test';
import expect from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRoot, treeHash } from './workspace.ts';

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  expect.equal(run.status, 0, run.stderr);
}

function withRepo(work: (root: string) => void): void {
  // `.native` expands Windows 8.3 short names (THOREH~1) the way git reports the root.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'build-check-repo-')));
  try {
    git(root, 'init', '-q');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    writeFileSync(join(root, '.gitignore'), 'bin/\n');
    writeFileSync(join(root, 'a.cs'), 'class A {}');
    work(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('finds the repository root from a subfolder', () => {
  withRepo((root) => {
    mkdirSync(join(root, 'sub'));
    expect.equal(gitRoot(join(root, 'sub'))?.toLowerCase(), root.toLowerCase());
  });
});

test('outside a repository there is no root and no tree hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-check-plain-'));
  try {
    expect.equal(gitRoot(dir), undefined);
    expect.equal(treeHash(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tree hash is stable, sees untracked edits, ignores ignored files, and leaves the index alone', () => {
  withRepo((root) => {
    const first = treeHash(root);
    expect.match(first ?? '', /^[0-9a-f]{40}$/);
    expect.equal(treeHash(root), first);

    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'out.dll'), 'binary');
    expect.equal(treeHash(root), first);

    writeFileSync(join(root, 'a.cs'), 'class A { int x; }');
    expect.notEqual(treeHash(root), first);

    const status = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' });
    expect.equal(status.stdout, '');
  });
});
