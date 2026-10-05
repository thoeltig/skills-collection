/**
 * The external boundary for every filter: one child process per call, converted immediately to a
 * named state. No filter calls `node:child_process` directly.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';

import { assert } from './contract.ts';

export type ToolRun =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string; readonly status: number }
  | { readonly ok: false; readonly reason: 'NotInstalled'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'Timeout'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'Failed'; readonly detail: string };

/** Wall-clock ceiling. `jb inspectcode` on a large solution is the reason this is minutes, not seconds. */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** Output ceiling. A first run on an unchecked codebase can emit tens of megabytes. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function options(timeoutMs: number) {
  return {
    encoding: 'utf8' as const,
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
  };
}

export function runTool(
  command: string,
  args: readonly string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ToolRun {
  assert(command.length > 0, 'command must be a non-empty executable name');
  assert(timeoutMs > 0, `timeoutMs must be > 0, got ${timeoutMs}`);

  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(command, [...args], options(timeoutMs));
  } catch (error: unknown) {
    return { ok: false, reason: 'Failed', detail: String(error) };
  }

  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'NotInstalled', detail: command };
    if (result.signal === 'SIGTERM') {
      return { ok: false, reason: 'Timeout', detail: `${command} exceeded ${timeoutMs}ms` };
    }
    return { ok: false, reason: 'Failed', detail: String(result.error) };
  }

  return {
    ok: true,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    status: result.status ?? 0,
  };
}

/**
 * Locates an npm-installed tool's entry script.
 *
 * Windows leaves no safe way to spawn the `.cmd` shims in `node_modules/.bin`: Node refuses to
 * launch `.cmd`/`.bat` without a shell (the CVE-2024-27980 mitigation, surfacing as EINVAL), and
 * `shell: true` is deprecated for argument-passing (DEP0190) precisely because it concatenates
 * rather than escapes. Resolving the real JS entry and running it under `process.execPath` sidesteps
 * both, and behaves identically on every platform.
 */
export function resolveNodeBin(packageName: string, binName: string): string | null {
  assert(packageName.length > 0, 'packageName must not be empty');
  assert(binName.length > 0, 'binName must not be empty');

  // Anchored to the working directory, not to this module: the filter checks the project you are
  // in, and the scripts may well be installed somewhere else entirely.
  const require = createRequire(resolvePath(process.cwd(), '__resolve__.js'));

  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    return null;   // named recovery: not installed here; the caller reports NotInstalled
  }

  let manifest: { readonly bin?: string | Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
  } catch {
    return null;
  }

  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (entry === undefined) return null;
  return resolvePath(dirname(manifestPath), entry);
}

/** Runs an npm-installed tool under the current Node binary. No shell, no shim. */
export function runNodeTool(
  packageName: string,
  binName: string,
  args: readonly string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ToolRun {
  const entry = resolveNodeBin(packageName, binName);
  if (entry === null) {
    return { ok: false, reason: 'NotInstalled', detail: `${packageName} (bin: ${binName})` };
  }
  return runTool(process.execPath, [entry, ...args], timeoutMs);
}

/** Uniform exit for a tool that could not be run at all. Distinct from "ran and found problems". */
export function reportRunFailure(tool: string, run: Extract<ToolRun, { ok: false }>): number {
  process.stderr.write(`✖ ${tool}: ${run.reason} — ${run.detail}\n`);
  return 2;
}
