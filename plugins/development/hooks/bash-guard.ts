/**
 * PreToolUse hook for Bash. `coder` and `verifier` may only run the build and test filter scripts of
 * negative-space-programming; `verifier` also read-only git. Allowed commands still go through the
 * normal permission prompt; the hook only denies. A guardrail against accidents, not a sandbox: a
 * test run executes whatever code the agent wrote. The main session and other agents are not checked.
 * Registered in hooks.json: the same hook in the agents' frontmatter did not take effect (probe, 2026-11).
 */
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from '../skills/negative-space-programming/scripts/contract.ts';

const FILTERS = ['dotnet-build', 'dotnet-test', 'node-test', 'tsc'] as const;
const GIT_READ = ['diff', 'status', 'log', 'show', 'rev-parse'] as const;
/** `--output` writes a file, `--ext-diff` runs a configured program. */
const GIT_FORBIDDEN_OPTION = /^--(output|ext-diff)(=|$)/;
const SHELL_SYNTAX = /[;&|<>`$\r\n]/;
/** Git access per guarded agent; any other `agent_type`, or none (the main session), passes unchecked. */
const GUARDED: Readonly<Record<string, boolean>> = { 'development:coder': false, 'development:verifier': true };

export interface Policy {
  readonly scriptsDir: string;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly git: boolean;
}

export type Verdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * Splits a command into words the way bash would for the subset accepted here. Undefined for anything
 * whose bash meaning could differ from a literal reading: unbalanced quotes and backslash escapes.
 */
export function tokenize(command: string): string[] | undefined {
  const words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;
  for (let index = 0; index < command.length; index++) {
    const char = command[index] as string;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else if (quote === '"' && char === '\\' && /["\\]/.test(command[index + 1] ?? '')) return undefined;
      else word += char;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
      word ??= '';
    } else if (char === '\\') {
      return undefined;
    } else {
      word = (word ?? '') + char;
    }
  }
  if (quote !== undefined) return undefined;
  if (word !== undefined) words.push(word);
  return words;
}

/** A comparable absolute path; Git Bash's `/c/x` becomes `c:/x`, and Windows compares case-insensitively. */
function normalize(path: string, policy: Policy): string {
  if (policy.platform !== 'win32') return posix.resolve(policy.cwd, path);
  const drive = /^\/([a-zA-Z])(\/|$)/.exec(path);
  const native = drive === null ? path : `${drive[1]}:/${path.slice(drive[0].length)}`;
  return win32.resolve(policy.cwd, native).replaceAll('\\', '/').toLowerCase();
}

function scriptPath(policy: Policy, filter: string): string {
  return `${policy.scriptsDir.replaceAll('\\', '/')}/${filter}.ts`;
}

function isFilterScript(words: readonly string[], policy: Policy): boolean {
  const script = words[1];
  if (words[0] !== 'node' || script === undefined) return false;
  const target = normalize(script, policy);
  return FILTERS.some((filter) => normalize(scriptPath(policy, filter), policy) === target);
}

function isReadOnlyGit(words: readonly string[]): boolean {
  if (words[0] !== 'git') return false;
  const rest = words[1] === '-C' ? words.slice(3) : words.slice(1);
  if (words[1] === '-C' && words[2] === undefined) return false;
  const subcommand = rest[0];
  return subcommand !== undefined && (GIT_READ as readonly string[]).includes(subcommand) && !rest.some((word) => GIT_FORBIDDEN_OPTION.test(word));
}

function allowedForms(policy: Policy): string {
  const scripts = FILTERS.map((filter) => `  node "${scriptPath(policy, filter)}" [args]`);
  const git = policy.git ? [`  git [-C <path>] ${GIT_READ.join('|')} [args] (no --output, --ext-diff)`] : [];
  return [...scripts, ...git].join('\n');
}

function deny(why: string, policy: Policy): Verdict {
  const scope = policy.git ? 'the build and test filter scripts and read-only git' : 'the build and test filter scripts';
  return { allowed: false, reason: `Bash denied: only ${scope} may run. ${why}\nAllowed, one command per call:\n${allowedForms(policy)}` };
}

export function checkCommand(command: string, policy: Policy): Verdict {
  if (SHELL_SYNTAX.test(command)) return deny('Shell operators, substitutions and newlines (; & | < > ` $) are not accepted.', policy);
  const words = tokenize(command);
  if (words === undefined) return deny('Unbalanced quotes or backslash escapes; quote Windows paths or use forward slashes.', policy);
  if (isFilterScript(words, policy)) return { allowed: true };
  if (policy.git && isReadOnlyGit(words)) return { allowed: true };
  return deny(`Not an allowed command: ${command.slice(0, 80)}`, policy);
}

export interface HookOptions {
  readonly scriptsDir: string;
  readonly platform: NodeJS.Platform;
}

export type HookOutput = Readonly<Record<string, unknown>> | undefined;

/** Undefined lets the call continue to the normal permission flow. */
export function handle(raw: unknown, options: HookOptions): HookOutput {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { tool_name: toolName, tool_input: toolInput, agent_type: agentType, cwd } = raw as Record<string, unknown>;
  if (toolName !== 'Bash' || typeof agentType !== 'string') return undefined;
  const git = GUARDED[agentType];
  if (git === undefined) return undefined;

  const policy: Policy = { ...options, cwd: typeof cwd === 'string' ? cwd : process.cwd(), git };
  const command = (toolInput as { command?: unknown } | undefined)?.command;
  const verdict = typeof command === 'string' && command.trim() !== '' ? checkCommand(command.trim(), policy) : deny('No command given.', policy);
  if (verdict.allowed) return undefined;
  process.stderr.write(`bash-guard: denied for ${agentType}: ${String(command).slice(0, 200)}\n`);
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } };
}

function main(): number {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error: unknown) {
    process.stderr.write(`bash-guard: hook input is not JSON: ${String(error)}\n`);
    return 1;
  }
  const scriptsDir = fileURLToPath(new URL('../skills/negative-space-programming/scripts', import.meta.url));
  const output = handle(raw, { scriptsDir, platform: process.platform });
  if (output !== undefined) process.stdout.write(JSON.stringify(output));
  return 0;
}

// Exit 2 blocks the call: a guard that crashed must not let the command through.
if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error: unknown) {
    process.stderr.write(`bash-guard failed, call blocked: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 2;
  }
}
