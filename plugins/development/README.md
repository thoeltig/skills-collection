# development

Skills for writing fail-fast, assertion-driven code.

## Skills

### negative-space-programming

Assertion-driven design from NASA's Power of Ten and TigerStyle, for C# and TypeScript. Covers classifying a check as an assertion, exception, or returned value; pre/postconditions; bounding loops, queues, batches and recursion; designing types so illegal states cannot be constructed; and placing `try`/`catch` only at framework or third-party boundaries.

See [`skills/negative-space-programming/SKILL.md`](./skills/negative-space-programming/SKILL.md).

#### Requirements

- **Filter scripts** (`scripts/*.ts`): Node ≥ 22.18, which runs TypeScript directly — no install, no build step. Run them from the project root: `node <skill-dir>/scripts/<filter>.ts`. Tests: `node --test "<skill-dir>/scripts/*.test.ts"`.
- **C# tests and coverage**: xUnit v3 on Microsoft.Testing.Platform (`global.json` runner) with `Microsoft.Testing.Extensions.CodeCoverage`. See `setup.md` §4 and `csharp.md`.
- **TypeScript coverage**: c8 with `--reporter=cobertura`.

## Agents

Three agents for delegating work from a main session. Each brief must carry everything the agent needs: it does not see the main conversation.

| Agent | Model | Does |
|---|---|---|
| `coder` | sonnet by default; haiku or opus per call | Implements a change from a brief (goal, area, constraints, out of scope), stops and asks when the brief is ambiguous, reports changes, verification, assumptions and what was not done |
| `explorer` | haiku | Read-only search; answers with verbatim excerpts and `path:start-end` ranges, plus what it searched |
| `verifier` | opus | Reviews a finished change from a ref range, uncommitted changes or a worktree, given the goal, constraints and non-goals; separates confirmed issues with evidence from suspicions; never edits |

The `coder` description tells the main session which model fits a brief. The `explorer` also uses the `batch_read` and project-intel `query` tools when those plugins are installed.

## Build check hook

Runs the project's build and tests around delegated work, so an agent knows what was already broken and cannot finish having broken something new.

- **When an agent starts** (`coder`, `verifier`), it gets the current state as context. Green looks like this: `Build check at start: Build green · Tests 97/97 green`. Problems that already exist are listed and labelled as pre-existing.
- **When a `coder` stops** after changing files, the checks run again. New problems block the stop and are fed back: findings or failing tests the start state did not have, or a step that no longer runs. The hook blocks at most 3 times, and not again when the same problems remain. It then lets the agent finish and tells you.
- **The main session is not checked.**

The output is a headline per step, then findings grouped by code. Tests failing for one cause are grouped as well. Output is capped at 15 lines per step. Results are cached per tree state and session. Everything is deleted when the session ends; data of sessions that never ended is swept after 7 days.

### Configuration

Create `.claude/build-check.json` in the project. Without the file, the hook does nothing.

```json
{"steps":[{"tool":"dotnet-build","args":["App.sln"]},{"tool":"dotnet-test","args":["--solution","App.sln"],"timeoutSeconds":900}]}
```

| Field | Values |
|---|---|
| `tool` | `dotnet-build`, `tsc` (build); `dotnet-test`, `node-test` (tests). These are the filters from `negative-space-programming/scripts`, so output is always parsed, never raw |
| `args` | Build tools: at most one project, solution or tsconfig. Test tools: passed to `dotnet test` or `node --test` |
| `timeoutSeconds` | Per step, default 600. All steps together at most 1700 |

| Environment variable | Effect |
|---|---|
| `SKILLS_COLLECTION_BUILD_CHECK_CONFIG` | Another config path, absolute or relative to the project |
| `SKILLS_COLLECTION_BUILD_CHECK_DISABLED` | `1` or `true` turns the hook off |

In a worktree the config is read from the worktree first, then from the main project, so an untracked config still applies.

### Things to know

- **An agent waits for the check before it starts.** Point the test step at fast tests: a full suite with integration tests that wait on unavailable services can take many minutes. Repeat starts on an unchanged tree reuse the cached result.
- **The config runs code.** Building and testing executes the project's build scripts and tests, without a permission prompt. Only add a config to projects you trust, the same as project hooks.
- `dotnet-test` needs xUnit v3 on Microsoft.Testing.Platform (`global.json` runner). It uses xUnit's own `--report-xunit-trx`.
- `dotnet-build` treats warnings as errors, like the filter does, so NuGet audit warnings appear as problems. That is harmless, because only new ones block.
- Two agents in the same folder never build at once; the second one waits, or skips with a message when the budget runs out.
- Requires Node ≥ 22.18 and git; outside a git repository nothing is cached.

## Installation

```
/plugin install development@skills-collection
```
