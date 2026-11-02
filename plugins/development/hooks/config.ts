/**
 * Reads the project's build-check configuration. The file is foreign data, so every field is
 * validated here and a bad file is a returned state, never an exception.
 *
 *   {"steps":[{"tool":"dotnet-build","args":["App.sln"]},{"tool":"dotnet-test","args":["--solution","App.sln"],"timeoutSeconds":900}]}
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const CONFIG_ENV = 'SKILLS_COLLECTION_BUILD_CHECK_CONFIG';
export const DISABLED_ENV = 'SKILLS_COLLECTION_BUILD_CHECK_DISABLED';
export const DEFAULT_CONFIG_PATH = '.claude/build-check.json';

/** Kept below the 1800 s timeout in hooks.json, so a run that uses its whole budget still reports. */
export const BUDGET_SECONDS = 1700;
const DEFAULT_STEP_SECONDS = 600;
const MAX_STEPS = 10;

const TOOL_KINDS = { 'dotnet-build': 'build', tsc: 'build', 'dotnet-test': 'test', 'node-test': 'test' } as const;
export type ToolName = keyof typeof TOOL_KINDS;
export type StepKind = (typeof TOOL_KINDS)[ToolName];

export interface Step {
  readonly tool: ToolName;
  readonly kind: StepKind;
  readonly args: readonly string[];
  readonly timeoutSeconds: number;
}

export interface Config {
  readonly path: string;
  readonly steps: readonly Step[];
  /** Changes whenever the steps do, so cached results of another configuration are never reused. */
  readonly hash: string;
}

export type ConfigState =
  | { readonly status: 'disabled' }
  | { readonly status: 'invalid'; readonly path: string; readonly reason: string }
  | { readonly status: 'ok'; readonly config: Config };

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && Object.hasOwn(TOOL_KINDS, value);
}

function parseStep(raw: unknown, index: number): Parsed<Step> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: `steps[${index}] must be an object` };
  const { tool, args = [], timeoutSeconds = DEFAULT_STEP_SECONDS } = raw as Record<string, unknown>;
  if (!isToolName(tool)) {
    return { ok: false, reason: `steps[${index}].tool must be one of ${Object.keys(TOOL_KINDS).join(', ')}, got ${JSON.stringify(tool)}` };
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    return { ok: false, reason: `steps[${index}].args must be an array of strings` };
  }
  const kind = TOOL_KINDS[tool];
  if (kind === 'build' && args.length > 1) {
    return { ok: false, reason: `steps[${index}]: ${tool} takes at most one argument (the project or solution), got ${args.length}` };
  }
  if (typeof timeoutSeconds !== 'number' || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > BUDGET_SECONDS) {
    return { ok: false, reason: `steps[${index}].timeoutSeconds must be an integer in 1..${BUDGET_SECONDS}, got ${JSON.stringify(timeoutSeconds)}` };
  }
  return { ok: true, value: { tool, kind, args: args as string[], timeoutSeconds } };
}

export function parseConfig(text: string, path: string): ConfigState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    return { status: 'invalid', path, reason: `not valid JSON: ${String(error)}` };
  }
  const steps = (raw as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    return { status: 'invalid', path, reason: `steps must be an array of 1..${MAX_STEPS} entries` };
  }
  const parsed: Step[] = [];
  for (const [index, entry] of steps.entries()) {
    const step = parseStep(entry, index);
    if (!step.ok) return { status: 'invalid', path, reason: step.reason };
    parsed.push(step.value);
  }
  const total = parsed.reduce((sum, step) => sum + step.timeoutSeconds, 0);
  if (total > BUDGET_SECONDS) {
    return { status: 'invalid', path, reason: `step timeouts add up to ${total} s, more than the ${BUDGET_SECONDS} s budget` };
  }
  const hash = createHash('sha1').update(JSON.stringify(parsed)).digest('hex').slice(0, 12);
  return { status: 'ok', config: { path, steps: parsed, hash } };
}

/**
 * Finds and reads the configuration. A relative path is looked up under each root in order: the
 * agent's working tree first, then the session's project, because a worktree lacks an untracked file.
 * A missing file means the check is off, the same as the disable variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv, roots: readonly string[]): ConfigState {
  const disabled = env[DISABLED_ENV]?.trim().toLowerCase();
  if (disabled === '1' || disabled === 'true') return { status: 'disabled' };
  const configured = env[CONFIG_ENV]?.trim() || DEFAULT_CONFIG_PATH;
  const candidates = isAbsolute(configured) ? [configured] : roots.map((root) => join(root, configured));
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) return { status: 'disabled' };
  return parseConfig(readFileSync(path, 'utf8'), path);
}
