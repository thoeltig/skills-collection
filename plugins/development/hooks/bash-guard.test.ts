import { test } from 'node:test';
import expect from 'node:assert/strict';
import { checkCommand, handle, tokenize, type Policy } from './bash-guard.ts';

const WIN: Policy = { scriptsDir: 'C:/Plugin Root/scripts', cwd: 'C:/repo', platform: 'win32', git: false };
const VERIFIER: Policy = { ...WIN, git: true };
const POSIX: Policy = { scriptsDir: '/plugin/scripts', cwd: '/repo', platform: 'linux', git: false };

function allowed(command: string, policy: Policy = WIN): boolean {
  return checkCommand(command, policy).allowed;
}

test('tokenizes quotes like bash and refuses what it cannot mirror', () => {
  expect.deepEqual(tokenize(`node "C:\\a b\\x.ts" 'src/**/*.ts' plain`), ['node', 'C:\\a b\\x.ts', 'src/**/*.ts', 'plain']);
  expect.deepEqual(tokenize('  git   diff  '), ['git', 'diff']);
  expect.equal(tokenize('node "open'), undefined);
  expect.equal(tokenize('node C:\\x.ts'), undefined);
  expect.equal(tokenize('node "a\\"b"'), undefined);
});

test('allows each build and test filter script, with args', () => {
  expect.equal(allowed('node "C:/Plugin Root/scripts/dotnet-build.ts" App.sln'), true);
  expect.equal(allowed('node "C:/Plugin Root/scripts/dotnet-test.ts" --solution App.sln'), true);
  expect.equal(allowed('node "C:/Plugin Root/scripts/node-test.ts" "src/**/*.test.ts"'), true);
  expect.equal(allowed('node "C:/Plugin Root/scripts/tsc.ts"'), true);
  expect.equal(allowed('node /plugin/scripts/tsc.ts', POSIX), true);
});

test('matches Windows paths across slash style, msys drive form and case', () => {
  expect.equal(allowed('node "C:\\Plugin Root\\scripts\\tsc.ts"'), true);
  expect.equal(allowed('node "/c/plugin root/scripts/tsc.ts"'), true);
  expect.equal(allowed('node /PLUGIN/scripts/tsc.ts', POSIX), false);
});

test('denies other scripts, look-alike paths and node flags', () => {
  expect.equal(allowed('node "C:/Plugin Root/scripts/coverage.ts"'), false);
  expect.equal(allowed('node scripts/tsc.ts'), false);
  expect.equal(allowed('node "C:/repo/Claude_Temp_Files/scripts/tsc.ts"'), false);
  expect.equal(allowed('node --import x.mjs "C:/Plugin Root/scripts/tsc.ts"'), false);
  expect.equal(allowed('node'), false);
});

test('denies shell operators, substitutions and env prefixes', () => {
  for (const command of [
    'node "C:/Plugin Root/scripts/tsc.ts"; rm -rf x',
    'node "C:/Plugin Root/scripts/tsc.ts" && git push',
    'node "C:/Plugin Root/scripts/tsc.ts" | tee out',
    'node "C:/Plugin Root/scripts/tsc.ts" > out',
    'node "C:/Plugin Root/scripts/tsc.ts" "$(whoami)"',
    'node "C:/Plugin Root/scripts/tsc.ts" `whoami`',
    'node "C:/Plugin Root/scripts/tsc.ts"\nrm x',
    'X=1 node "C:/Plugin Root/scripts/tsc.ts"',
  ]) {
    expect.equal(allowed(command), false, command);
  }
});

test('denies raw build tools and anything else', () => {
  for (const command of ['dotnet build', 'dotnet test', 'npm test', 'npx tsc', 'rm -rf bin', 'cd sub']) expect.equal(allowed(command), false, command);
});

test('read-only git only for a policy that allows it', () => {
  for (const command of ['git diff main...HEAD', 'git status --porcelain', 'git log --oneline -5', 'git show HEAD:a.ts', 'git rev-parse HEAD', 'git -C "C:/wt" diff HEAD']) {
    expect.equal(allowed(command, VERIFIER), true, command);
    expect.equal(allowed(command, WIN), false, command);
  }
});

test('denies git that writes or runs configured programs', () => {
  for (const command of [
    'git commit -m x',
    'git checkout main',
    'git stash',
    'git diff --output=patch.txt',
    'git log -p --output patch.txt',
    'git diff --ext-diff',
    'git -c core.pager=x diff',
    'git -C',
    'git',
  ]) {
    expect.equal(allowed(command, VERIFIER), false, command);
  }
});

test('a denial names the reason and the allowed commands', () => {
  const verdict = checkCommand('npm test', VERIFIER);
  expect.equal(verdict.allowed, false);
  if (verdict.allowed) return;
  expect.match(verdict.reason, /^Bash denied: only the build and test filter scripts/);
  expect.match(verdict.reason, /node "C:\/Plugin Root\/scripts\/node-test\.ts"/);
  expect.match(verdict.reason, /git \[-C <path>\] diff\|status\|log\|show\|rev-parse/);
});

const OPTIONS = { scriptsDir: WIN.scriptsDir, platform: WIN.platform };
const bash = (agentType: string | undefined, command: string): Record<string, unknown> => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  cwd: 'C:/repo',
  ...(agentType === undefined ? {} : { agent_type: agentType }),
});

test('the hook guards only coder and verifier, only Bash, and only denies', () => {
  expect.equal(handle(bash(undefined, 'rm -rf x'), OPTIONS), undefined);
  expect.equal(handle(bash('development:explorer', 'rm -rf x'), OPTIONS), undefined);
  expect.equal(handle({ ...bash('development:coder', 'rm -rf x'), tool_name: 'Read' }, OPTIONS), undefined);
  expect.equal(handle(bash('development:coder', 'node "C:/Plugin Root/scripts/tsc.ts"'), OPTIONS), undefined);
  expect.equal(handle(bash('development:verifier', 'git diff'), OPTIONS), undefined);
  const denied = handle(bash('development:coder', 'git diff'), OPTIONS) as { hookSpecificOutput: Record<string, string> };
  expect.equal(denied.hookSpecificOutput['hookEventName'], 'PreToolUse');
  expect.equal(denied.hookSpecificOutput['permissionDecision'], 'deny');
  expect.match(denied.hookSpecificOutput['permissionDecisionReason'] ?? '', /^Bash denied/);
});

test('a call without a command string is denied', () => {
  const output = handle({ ...bash('development:coder', ''), tool_input: {} }, OPTIONS) as { hookSpecificOutput: Record<string, string> };
  expect.equal(output.hookSpecificOutput['permissionDecision'], 'deny');
});
