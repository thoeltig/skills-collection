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

## Installation

```
/plugin install development@skills-collection
```
