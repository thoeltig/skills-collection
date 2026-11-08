---
name: managing-agent-instructions
description: Sets up and maintains the project-level agent instructions file (CLAUDE.md, AGENTS.md) that every session loads. Use when a project has no instructions file yet, when the existing one is long, stale or generic, after adding modules, commands, domain terms, skills or tools, or when the user asks which skills or tools an agent should use at which step of the project workflow.
---

# Managing Agent Instructions

The root instructions file is the one file every session loads, wherever it was started and whatever it touches. Every line is paid for in every session — but an instruction that was never loaded costs more than one that was. It is an **index and a routing table**, not documentation: it says what the terms mean, where things are, how to run them, and which skill or tool to reach for at which step. Everything else is a pointer.

## Which file

- **Pick one file, by project setup.** Claude Code reads `AGENTS.md` natively when no `CLAUDE.md` exists, and most other agents read only `AGENTS.md`. Follow what the repository already has (`.claude/`, `.codex/`, `.cursor/`, an existing file); with no signal, `AGENTS.md` serves every agent. Never keep both — two copies drift.
- **Everything is shared by default.** The committed file holds what every contributor and every session needs.
- **`CLAUDE.local.md` is for the personal remainder only:** skills or tools only you have installed, your local environment, your preferences. It is not gitignored automatically — add it to `.gitignore` when creating it. With `AGENTS.md` as the project file, a `CLAUDE.local.md` stops Claude Code from reading `AGENTS.md` natively, so its first line must be `@AGENTS.md`.

## Root first, split when too large

**Default to one root file.** Folder-level files and path-scoped rules load only under conditions the user does not see: Claude Code loads `<folder>/CLAUDE.md` when a file in that subtree is touched, and `.claude/rules/*.md` with `paths:` when a matching file is ([memory docs](https://code.claude.com/docs/en/memory.md)); other agents may not load them at all. A session started at the root that searches, plans or delegates before touching a file works without them — and in a team, someone always works from the root. A root file up to ~200 lines is cheaper than instructions that silently go missing.

**Split only when the root outgrows its budget**, and then disclose the split actively instead of relying on automatic loading:

- Move out the largest block that concerns one subtree only — typically a frontend's or backend's own conventions.
- Keep glossary, commands and workflow routing in the root. They are cross-cutting, and they are what a root-started session needs most.
- Name every split-off file in the root's workflow table with an explicit trigger: *before working in `frontend/` → read `frontend/CLAUDE.md`*. Automatic loading then becomes a bonus, not the mechanism.
- A split-off file never repeats the root; it assumes it has been read.

## What the root file contains

Six sections, in this order. Omit a section that would be empty rather than filling it with generic text.

```markdown
# <Project>

<One or two lines: what this is, the stack.>

## Glossary
| Term | Meaning | Defined in |
|---|---|---|
| Rate | price per 1M tokens for one model and one token kind | `src/rates/contract.ts` |

## Map
| Path | What | Read when |
|---|---|---|
| `src/rates/` | rate parsing and lookup | changing pricing |
| `docs/architecture.md` | module boundaries | adding a module |

## Commands
| Task | Command |
|---|---|
| test | `npm test` |
| lint | `npm run lint` |

## Workflow
| Before | Invoke | Why |
|---|---|---|
| writing or changing C# / TS code | skill `development:negative-space-programming` | assertion and boundary rules |
| writing docs | skill `documents:managing-documentation` | style and structure rules |
| finding files or connections | tool `project-intel query` | ranked map instead of grep + read |
| working in `frontend/` | read `frontend/CLAUDE.md` | split-off frontend conventions |

## Rules
- <Project constraints the code does not show, each one line.>
```

- **Glossary.** One term, one meaning. Each term points at the file that defines it, so it can be re-verified. A name that means two things in two modules is a bug the compiler cannot see; the glossary is where it becomes visible.
- **Map.** A "read when" index, never a tree dump. **Its depth depends on the tooling the whole team has** — push the mapping to a tool where one exists, the way a type moves a check to the compiler:
  - *With an indexing tool* (project-intel or another code map): top-level folders only — projects, docs, scripts — plus a workflow row routing file and connection lookups to that tool.
  - *Without one:* one level deeper. Add the topic-relevant subfolders of the main projects and docs, and the generated files and scripts an agent would otherwise rediscover by searching.
  - A tool only this user has installed does not count for the committed map; it goes in `CLAUDE.local.md`.
- **Commands.** The exact command, runnable from the repository root. Take them from what CI runs, not from memory.
- **Workflow.** The trigger is an observable step — "before editing `*.cs`", "before a release" — never a topic. The target is the exact name as invoked: `plugin:skill` for a skill, the tool name for a tool. A skill can trigger on its description alone, but that is probabilistic; the routing table makes it deterministic at the step that needs it.
- **Rules.** Only what an agent cannot infer from the code and would otherwise get wrong. A mistake an agent repeated across sessions belongs here, as the rule that prevents it.

## What stays out

- Anything one read of the code shows — the language, the framework, the folder names a `ls` lists.
- Generic engineering advice. It belongs in the user's global instructions or in a skill, not repeated per project.
- Content that exists in a doc. Link the doc in the map.
- Procedures longer than a few lines. Move them into a linked doc or a skill and route to it.
- Session notes, progress logs, change history.
- Secrets, absolute paths, user names, machine-specific values. Use relative paths and environment variable names; anything truly personal goes in `CLAUDE.local.md`.

## Setup

1. **Probe the repository.** Manifests, build files, scripts, CI workflows, existing docs, existing instruction files in any agent's format. Commands come from what CI runs.
2. **Inventory the session.** List the skills and tools available in the current session — the skill listing and MCP tools in context. Route only to what exists. Mark anything only this user has installed for `CLAUDE.local.md`, or ask whether the team should install it.
3. **Ask, do not invent.** Glossary terms, workflow steps and project rules come from the user or the code, never from a guess. Ask them in one batch.
4. **Draft the root file** to the template above, with the map depth set by the tooling found in step 2. Budget: up to ~200 lines, the documented ceiling.
5. **Split only past the budget**, as described under *Root first, split when too large*, and add the read trigger for each split-off file to the workflow table.
6. **Verify before handing over.** Every path exists, every command runs, every skill and tool name resolves in this session. Run long or side-effecting commands only after asking.

## Maintain

Update the file in the same change that makes it wrong:

| Change | Update |
|---|---|
| module or folder added, moved, removed | Map; folder file |
| command added or renamed, CI changed | Commands |
| new domain term, or a term changed meaning | Glossary |
| skill or tool adopted or dropped | Workflow |
| indexing tool adopted or dropped | Map depth: shrink to top level, or deepen |
| root file past its budget | split one subtree out; add its read trigger to Workflow |
| an agent repeated the same mistake | Rules |

When reviewing an existing file:

- **Check for drift:** paths that no longer exist, commands missing from the manifest or CI, skills or tools no longer installed, glossary terms that no longer appear in the code.
- **Prune:** an entry that no session needed recently, or that the code now shows on its own, no longer earns its tokens. Remove it.
- **Move down only past the budget:** an entry that matters in one subtree stays in the root until the root is too large, then moves to that subtree's file with a read trigger left behind.

## Checklist

- Root file under budget, every section earns its lines?
- Every split-off file named in the root with an explicit read trigger?
- Map depth matches the indexing tooling the whole team has?
- Every glossary term points at a defining file?
- Every map path exists, every command runs from the root?
- Every workflow trigger is an observable step, every target an exact skill or tool name available in this session?
- Nothing personal, secret or absolute in the committed file; `CLAUDE.local.md` gitignored if present?
- Nothing a single read of the code would show, nothing duplicated from a doc?
