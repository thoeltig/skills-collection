/**
 * Hook entry. SubagentStart tells an agent the build and test state it starts from, SubagentStop
 * blocks a coder that leaves new problems behind, SessionEnd deletes the session's data.
 * Silent whenever no configuration file exists or the disable variable is set.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEntryPoint } from '../skills/negative-space-programming/scripts/contract.ts';
import { runStep, runSteps, type StepOutcome, type StepRunner } from './checks.ts';
import { BUDGET_SECONDS, loadConfig, type Config } from './config.ts';
import { appendLog, cleanSessions, isSafeId, lockPath, pruneResults, readJson, sessionDirectory, withLock, writeJson } from './store.ts';
import { describeState, findRegressions } from './summary.ts';
import { gitRoot, treeHash } from './workspace.ts';

/** Blocks per agent before the hook lets it finish and tells the user instead. */
export const MAX_BLOCKS = 3;

export interface HookInput {
  readonly event: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly agentId: string | undefined;
  readonly agentType: string | undefined;
}

export interface Dependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly dataRoot: string;
  readonly runner: StepRunner;
  readonly now: () => number;
  readonly gitRoot: (cwd: string) => string | undefined;
  readonly treeHash: (root: string) => string | undefined;
}

export type HookOutput = Readonly<Record<string, unknown>> | undefined;

/** What an agent started from, kept until its stop is compared against it. */
interface AgentBaseline {
  readonly treeHash: string | undefined;
  readonly steps: readonly StepOutcome[];
  readonly blocks: number;
  readonly lastKeys: readonly string[];
}

interface Active {
  readonly root: string;
  readonly sessionDir: string;
  readonly config: Config;
}

interface Evaluation {
  readonly treeHash: string | undefined;
  readonly steps: readonly StepOutcome[];
  readonly cached: boolean;
}

/** Parses the hook's stdin; undefined for input this hook cannot act on safely. */
export function parseInput(raw: unknown): HookInput | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const fields = raw as Record<string, unknown>;
  const { hook_event_name: event, session_id: sessionId, cwd, agent_id: agentId, agent_type: agentType } = fields;
  if (typeof event !== 'string' || !isSafeId(sessionId) || typeof cwd !== 'string') return undefined;
  return {
    event,
    sessionId,
    cwd,
    agentId: isSafeId(agentId) ? agentId : undefined,
    agentType: typeof agentType === 'string' ? agentType : undefined,
  };
}

function activate(input: HookInput, deps: Dependencies): Active | HookOutput {
  const root = deps.gitRoot(input.cwd) ?? input.cwd;
  const projectDir = deps.env['CLAUDE_PROJECT_DIR'];
  const roots = projectDir === undefined || projectDir === root ? [root] : [root, projectDir];
  const state = loadConfig(deps.env, roots);
  if (state.status === 'disabled') return undefined;
  if (state.status === 'invalid') return { systemMessage: `Build check off: ${state.path} is invalid — ${state.reason}` };
  return { root, sessionDir: sessionDirectory(deps.dataRoot, input.sessionId), config: state.config };
}

function isActive(value: Active | HookOutput): value is Active {
  return value !== undefined && 'config' in value;
}

/** The steps' outcome for the tree as it is now: cached when the tree and configuration are unchanged. */
function evaluate(active: Active, deps: Dependencies): Evaluation | undefined {
  const { root, sessionDir, config } = active;
  const tree = deps.treeHash(root);
  const cachePath = tree === undefined ? undefined : join(sessionDir, 'results', `${tree}-${config.hash}.json`);
  const cached = cachePath === undefined ? undefined : readJson<StepOutcome[]>(cachePath);
  if (cached !== undefined) return { treeHash: tree, steps: cached, cached: true };

  const stepSeconds = config.steps.reduce((sum, step) => sum + step.timeoutSeconds, 0);
  const waitMs = (BUDGET_SECONDS - stepSeconds) * 1000;
  const steps = withLock(lockPath(deps.dataRoot, root), waitMs, () => runSteps(config.steps, root, deps.runner), deps.now);
  if (steps === undefined) return undefined;
  if (cachePath !== undefined) {
    writeJson(cachePath, steps);
    pruneResults(join(sessionDir, 'results'));
  }
  return { treeHash: tree, steps, cached: false };
}

function busy(active: Active): HookOutput {
  return { systemMessage: `Build check skipped: another check is still running in ${active.root}` };
}

function onSubagentStart(input: HookInput, deps: Dependencies): HookOutput {
  if (input.agentId === undefined) return undefined;
  const active = activate(input, deps);
  if (!isActive(active)) return active;
  const started = deps.now();
  const evaluation = evaluate(active, deps);
  if (evaluation === undefined) return busy(active);

  const baseline: AgentBaseline = { treeHash: evaluation.treeHash, steps: evaluation.steps, blocks: 0, lastKeys: [] };
  writeJson(join(active.sessionDir, 'agents', `${input.agentId}.json`), baseline);
  const state = describeState(evaluation.steps, active.root);
  appendLog(active.sessionDir, { event: input.event, agent: input.agentId, tree: evaluation.treeHash, cached: evaluation.cached, ms: deps.now() - started, state: state.split('\n')[0] });
  const context = state.includes('\n')
    ? `Build check at start. These problems exist before you change anything:\n${state}`
    : `Build check at start: ${state}`;
  return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: context } };
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function onSubagentStop(input: HookInput, deps: Dependencies): HookOutput {
  if (input.agentId === undefined) return undefined;
  const active = activate(input, deps);
  if (!isActive(active)) return active;
  const baselinePath = join(active.sessionDir, 'agents', `${input.agentId}.json`);
  const baseline = readJson<AgentBaseline>(baselinePath);
  if (baseline === undefined) return undefined;

  const tree = deps.treeHash(active.root);
  if (tree !== undefined && tree === baseline.treeHash) return undefined;
  const evaluation = evaluate(active, deps);
  if (evaluation === undefined) return busy(active);
  const regressions = findRegressions(baseline.steps, evaluation.steps, active.root);
  appendLog(active.sessionDir, { event: input.event, agent: input.agentId, tree: evaluation.treeHash, cached: evaluation.cached, regressions: regressions?.keys.length ?? 0, blocks: baseline.blocks });
  if (regressions === undefined) return undefined;

  if (baseline.blocks >= MAX_BLOCKS || sameKeys(regressions.keys, baseline.lastKeys)) {
    return { systemMessage: `Build check: ${input.agentType ?? 'agent'} finished with problems its changes introduced:\n${regressions.text}` };
  }
  writeJson(baselinePath, { ...baseline, blocks: baseline.blocks + 1, lastKeys: regressions.keys });
  const reason = `Build check after your changes found new problems. Fix them before you finish; if a fix is outside your task, stop and name them in your report.\n${regressions.text}`;
  return { decision: 'block', reason };
}

export function handle(input: HookInput, deps: Dependencies): HookOutput {
  switch (input.event) {
    case 'SubagentStart':
      return onSubagentStart(input, deps);
    case 'SubagentStop':
      return onSubagentStop(input, deps);
    case 'SessionEnd':
      cleanSessions(deps.dataRoot, input.sessionId, deps.now());
      return undefined;
    default:
      return undefined;
  }
}

export function defaultDependencies(env: NodeJS.ProcessEnv): Dependencies {
  const pluginData = env['CLAUDE_PLUGIN_DATA'] ?? join(tmpdir(), 'skills-collection');
  return { env, dataRoot: join(pluginData, 'build-check'), runner: runStep, now: Date.now, gitRoot, treeHash };
}

function main(): number {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error: unknown) {
    process.stderr.write(`build-check: hook input is not JSON: ${String(error)}\n`);
    return 1;
  }
  const input = parseInput(raw);
  if (input === undefined) {
    process.stderr.write('build-check: hook input lacks hook_event_name, a safe session_id or cwd\n');
    return 1;
  }
  const output = handle(input, defaultDependencies(process.env));
  if (output !== undefined) process.stdout.write(JSON.stringify(output));
  return 0;
}

// The failsafe: whatever escaped is reported once, as a non-blocking hook error, never as a block.
if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error: unknown) {
    process.stderr.write(`build-check failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  }
}
