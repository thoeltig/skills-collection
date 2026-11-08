import { test } from 'node:test';
import expect from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CheckResult, Finding } from '../skills/negative-space-programming/scripts/contract.ts';
import { handle, MAX_BLOCKS, parseInput, type Dependencies, type HookInput } from './build-check.ts';
import { DISABLED_ENV } from './config.ts';

const SESSION = 'session-1';
const AGENT = 'agent-1';
const CONFIG = '{"steps":[{"tool":"dotnet-build"},{"tool":"dotnet-test"}]}';

interface Harness {
  readonly deps: Dependencies;
  readonly project: string;
  readonly dataRoot: string;
  build: Finding[];
  failing: Finding[];
  runs: number;
}

function report(tool: string, findings: Finding[]): CheckResult {
  return { ok: true, report: { tool, checked: 10, findings } };
}

function withHarness(work: (harness: Harness) => void, config: string | null = CONFIG, env: NodeJS.ProcessEnv = {}): void {
  const base = mkdtempSync(join(tmpdir(), 'build-check-hook-'));
  try {
    const project = join(base, 'project');
    mkdirSync(join(project, '.claude'), { recursive: true });
    if (config !== null) writeFileSync(join(project, '.claude', 'build-check.json'), config);
    const harness: Harness = {
      project,
      dataRoot: join(base, 'data'),
      build: [],
      failing: [],
      runs: 0,
      deps: undefined as unknown as Dependencies,
    };
    (harness as { deps: Dependencies }).deps = {
      env,
      dataRoot: harness.dataRoot,
      now: Date.now,
      gitRoot: () => project,
      runner: (step) => {
        harness.runs++;
        return step.kind === 'build' ? report(step.tool, harness.build) : report(step.tool, harness.failing);
      },
    };
    work(harness);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function input(event: string, harness: Harness): HookInput {
  return { event, sessionId: SESSION, cwd: join(harness.project, 'sub'), agentId: AGENT, agentType: 'development:coder' };
}

const brokenTest: Finding = { file: 'T/A.cs', line: 9, code: 'TEST', detail: 'Expected 3', test: 'T.A.Adds' };

test('injects a one-line state for a green start', () => {
  withHarness((harness) => {
    const output = handle(input('SubagentStart', harness), harness.deps);
    expect.deepEqual(output, {
      hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'Build check at start: Build green · Tests 10/10 green' },
    });
  });
});

test('labels problems that exist at the start as not the agent\'s', () => {
  withHarness((harness) => {
    harness.failing = [brokenTest];
    const output = handle(input('SubagentStart', harness), harness.deps) as { hookSpecificOutput: { additionalContext: string } };
    expect.match(output.hookSpecificOutput.additionalContext, /^Build check at start\. These problems exist before you change anything/);
    expect.match(output.hookSpecificOutput.additionalContext, /✖ A\.Adds/);
  });
});

test('stays silent without a configuration file or when disabled', () => {
  withHarness((harness) => expect.equal(handle(input('SubagentStart', harness), harness.deps), undefined), null);
  withHarness((harness) => expect.equal(handle(input('SubagentStart', harness), harness.deps), undefined), CONFIG, { [DISABLED_ENV]: '1' });
});

test('tells the user, not the agent, about an invalid configuration', () => {
  withHarness((harness) => {
    const output = handle(input('SubagentStart', harness), harness.deps) as { systemMessage: string };
    expect.match(output.systemMessage, /^Build check off: .*build-check\.json is invalid/);
  }, '{"steps":[{"tool":"make"}]}');
});

test('a stop runs the checks again and passes without new problems, even when old ones remain', () => {
  withHarness((harness) => {
    harness.failing = [brokenTest];
    handle(input('SubagentStart', harness), harness.deps);
    expect.equal(handle(input('SubagentStop', harness), harness.deps), undefined);
    expect.equal(harness.runs, 4);
  });
});

test('blocks a stop that left a new problem behind, naming only the new one', () => {
  withHarness((harness) => {
    handle(input('SubagentStart', harness), harness.deps);
    harness.failing = [brokenTest];
    const output = handle(input('SubagentStop', harness), harness.deps) as { decision: string; reason: string };
    expect.equal(output.decision, 'block');
    expect.match(output.reason, /Tests red: 1 new failing test\n  ✖ A\.Adds/);
  });
});

test('lets the agent finish and tells the user when the same problems remain after a block', () => {
  withHarness((harness) => {
    handle(input('SubagentStart', harness), harness.deps);
    harness.failing = [brokenTest];
    expect.equal((handle(input('SubagentStop', harness), harness.deps) as { decision: string }).decision, 'block');
    const output = handle(input('SubagentStop', harness), harness.deps) as { systemMessage: string };
    expect.match(output.systemMessage, /^Build check: development:coder finished with problems its changes introduced/);
  });
});

test(`blocks at most ${MAX_BLOCKS} times even while the problems keep changing`, () => {
  withHarness((harness) => {
    handle(input('SubagentStart', harness), harness.deps);
    const decisions: string[] = [];
    for (let round = 0; round <= MAX_BLOCKS; round++) {
      harness.failing = [{ ...brokenTest, test: `T.A.Round${round}` }];
      const output = handle(input('SubagentStop', harness), harness.deps) as { decision?: string; systemMessage?: string };
      decisions.push(output.decision ?? 'finish');
    }
    expect.deepEqual(decisions, [...Array.from({ length: MAX_BLOCKS }, () => 'block'), 'finish']);
  });
});

test('a stop without a recorded start is left alone', () => {
  withHarness((harness) => expect.equal(handle(input('SubagentStop', harness), harness.deps), undefined));
});

test('session end deletes the session data, with or without a configuration', () => {
  withHarness((harness) => {
    handle(input('SubagentStart', harness), harness.deps);
    const sessionDir = join(harness.dataRoot, 'sessions', SESSION);
    expect.equal(existsSync(sessionDir), true);
    rmSync(join(harness.project, '.claude', 'build-check.json'));
    handle(input('SessionEnd', harness), harness.deps);
    expect.equal(existsSync(sessionDir), false);
  });
});

test('parses hook input and refuses unsafe ids', () => {
  const raw = { hook_event_name: 'SubagentStart', session_id: SESSION, cwd: '/repo', agent_id: AGENT, agent_type: 'development:coder' };
  expect.deepEqual(parseInput(raw), { event: 'SubagentStart', sessionId: SESSION, cwd: '/repo', agentId: AGENT, agentType: 'development:coder' });
  expect.equal(parseInput({ ...raw, session_id: '../x' }), undefined);
  expect.equal(parseInput({ ...raw, agent_id: '../x' })?.agentId, undefined);
  expect.equal(parseInput(null), undefined);
});
