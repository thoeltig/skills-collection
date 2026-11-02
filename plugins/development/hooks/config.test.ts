import { test } from 'node:test';
import expect from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUDGET_SECONDS, CONFIG_ENV, DISABLED_ENV, loadConfig, parseConfig } from './config.ts';

function withRoots(work: (worktree: string, project: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'build-check-config-'));
  try {
    const worktree = join(base, 'worktree');
    const project = join(base, 'project');
    mkdirSync(join(worktree, '.claude'), { recursive: true });
    mkdirSync(join(project, '.claude'), { recursive: true });
    work(worktree, project);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const VALID = '{"steps":[{"tool":"dotnet-build","args":["App.sln"]},{"tool":"dotnet-test","args":["--solution","App.sln"]}]}';

test('a missing file turns the check off', () => {
  withRoots((worktree, project) => expect.deepEqual(loadConfig({}, [worktree, project]), { status: 'disabled' }));
});

test('the disable variable wins over an existing file', () => {
  withRoots((worktree) => {
    writeFileSync(join(worktree, '.claude', 'build-check.json'), VALID);
    expect.deepEqual(loadConfig({ [DISABLED_ENV]: '1' }, [worktree]), { status: 'disabled' });
    expect.deepEqual(loadConfig({ [DISABLED_ENV]: 'TRUE' }, [worktree]), { status: 'disabled' });
    expect.equal(loadConfig({ [DISABLED_ENV]: '0' }, [worktree]).status, 'ok');
  });
});

test('falls back to the project when the worktree lacks the untracked file', () => {
  withRoots((worktree, project) => {
    writeFileSync(join(project, '.claude', 'build-check.json'), VALID);
    const state = loadConfig({}, [worktree, project]);
    expect.equal(state.status, 'ok');
    if (state.status === 'ok') expect.equal(state.config.path, join(project, '.claude', 'build-check.json'));
  });
});

test('reads the path from the environment, relative to each root', () => {
  withRoots((worktree) => {
    writeFileSync(join(worktree, 'checks.json'), VALID);
    expect.equal(loadConfig({ [CONFIG_ENV]: 'checks.json' }, [worktree]).status, 'ok');
    expect.equal(loadConfig({ [CONFIG_ENV]: join(worktree, 'checks.json') }, ['/elsewhere']).status, 'ok');
  });
});

test('derives each step kind from its tool and defaults args and timeout', () => {
  const state = parseConfig('{"steps":[{"tool":"tsc"},{"tool":"node-test","args":["src/**/*.test.ts"]}]}', 'c.json');
  expect.equal(state.status, 'ok');
  if (state.status !== 'ok') return;
  expect.deepEqual(state.config.steps, [
    { tool: 'tsc', kind: 'build', args: [], timeoutSeconds: 600 },
    { tool: 'node-test', kind: 'test', args: ['src/**/*.test.ts'], timeoutSeconds: 600 },
  ]);
});

test('a different configuration gets a different hash', () => {
  const one = parseConfig('{"steps":[{"tool":"tsc"}]}', 'c.json');
  const two = parseConfig('{"steps":[{"tool":"tsc","args":["tsconfig.app.json"]}]}', 'c.json');
  expect.ok(one.status === 'ok' && two.status === 'ok');
  expect.notEqual(one.config.hash, two.config.hash);
});

for (const [name, text, fragment] of [
  ['not JSON', '{steps:', 'not valid JSON'],
  ['no steps', '{"steps":[]}', 'steps must be an array'],
  ['an unknown tool', '{"steps":[{"tool":"npm"}]}', 'tool must be one of'],
  ['args that are not strings', '{"steps":[{"tool":"dotnet-test","args":[1]}]}', 'array of strings'],
  ['a build tool with two targets', '{"steps":[{"tool":"dotnet-build","args":["a.sln","b.sln"]}]}', 'at most one argument'],
  ['a zero timeout', '{"steps":[{"tool":"tsc","timeoutSeconds":0}]}', 'timeoutSeconds'],
  ['timeouts above the budget', `{"steps":[{"tool":"tsc","timeoutSeconds":${BUDGET_SECONDS}},{"tool":"node-test","timeoutSeconds":1}]}`, 'budget'],
] as const) {
  test(`rejects ${name}`, () => {
    const state = parseConfig(text, 'c.json');
    expect.equal(state.status, 'invalid');
    if (state.status === 'invalid') expect.match(state.reason, new RegExp(fragment));
  });
}

test('accepts timeouts that use exactly the budget', () => {
  expect.equal(parseConfig(`{"steps":[{"tool":"tsc","timeoutSeconds":${BUDGET_SECONDS}}]}`, 'c.json').status, 'ok');
});
