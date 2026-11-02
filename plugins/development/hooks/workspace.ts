/**
 * Git facts about the tree an agent works in. The hook input's `cwd` is the session's current shell
 * directory (any subfolder) or an agent's worktree, so the root is always asked of git.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTool } from '../skills/negative-space-programming/scripts/run.ts';

const GIT_TIMEOUT_MS = 60_000;

function git(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const run = runTool('git', args, GIT_TIMEOUT_MS, cwd, env);
  if (!run.ok || run.status !== 0) return undefined;
  return run.stdout.trim();
}

/** The working tree's top folder, or undefined outside a git repository. */
export function gitRoot(cwd: string): string | undefined {
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  return root === undefined || root === '' ? undefined : resolve(root);
}

/**
 * A hash of every tracked and untracked, non-ignored file as it is on disk, without touching the
 * real index: the index is copied and `git add -A` runs against the copy. Equal hashes mean an
 * unchanged tree, so a cached result is still true.
 */
export function treeHash(root: string): string | undefined {
  const indexPath = git(['rev-parse', '--git-path', 'index'], root);
  if (indexPath === undefined) return undefined;
  const scratch = mkdtempSync(join(tmpdir(), 'build-check-index-'));
  try {
    const index = join(scratch, 'index');
    const source = resolve(root, indexPath);
    // A copied index keeps git's stat cache, so `add -A` hashes only what changed.
    if (existsSync(source)) copyFileSync(source, index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    if (git(['add', '-A'], root, env) === undefined) return undefined;
    return git(['write-tree'], root, env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
