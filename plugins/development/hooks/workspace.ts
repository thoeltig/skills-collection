/**
 * Git facts about the tree an agent works in. The hook input's `cwd` is the session's current shell
 * directory (any subfolder) or an agent's worktree, so the root is always asked of git.
 */
import { resolve } from 'node:path';
import { runTool } from '../skills/negative-space-programming/scripts/run.ts';

const GIT_TIMEOUT_MS = 60_000;

/** The working tree's top folder, or undefined outside a git repository. */
export function gitRoot(cwd: string): string | undefined {
  const run = runTool('git', ['rev-parse', '--show-toplevel'], GIT_TIMEOUT_MS, cwd, process.env);
  if (!run.ok || run.status !== 0) return undefined;
  const root = run.stdout.trim();
  return root === '' ? undefined : resolve(root);
}
