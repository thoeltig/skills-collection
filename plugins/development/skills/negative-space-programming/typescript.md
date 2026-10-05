# Negative Space Programming in TypeScript

Read `SKILL.md` first for the decision rules. This file is mechanics only.

TypeScript's advantage over C# here is that the type system is expressive enough to hold most of the negative space, and its disadvantage is that all of it evaporates at runtime. So: push everything you can into the types, and assume every value crossing a module boundary from outside is a lie.

## Project settings

```jsonc
{
  "type": "module",                   // REQUIRED by verbatimModuleSyntax + module: nodenext
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "npm run build && node --enable-source-maps --test-reporter=./dist/testing/reporter.js --test \"dist/**/*.test.js\""
  }
}
```

`--enable-source-maps` is not optional: without it every reported location points into `dist/`, and the output contract in `setup.md` requires locations in the source.

The compiler and lint configuration are under **Layer one** below.

## The assert helper

```ts
/**
 * The bug channel. An assertion failure means the code is wrong, never that the data was.
 * Assertions ship: never stripped from a production build, never gated behind a flag.
 * `InvariantViolation` is caught only by the top-level failsafe.
 */
export class InvariantViolation extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = 'InvariantViolation';
  }
}

/**
 * Throws from `site`'s caller, so the top stack frame is the code that broke the invariant rather
 * than the helper itself. Every helper below passes its own reference.
 */
function fail(message: string, site: (...args: never[]) => unknown): never {   // not `Function`: no-unsafe-function-type bans it
  const violation = new InvariantViolation(message);
  Error.captureStackTrace?.(violation, site);   // V8 only; elsewhere the helper frame stays on top
  throw violation;
}

export function assert(condition: boolean, message: string): asserts condition {
  if (condition) return;
  fail(message, assert);
}

/**
 * Marks a branch the type system proves unreachable, such as an exhausted discriminated union.
 * `context` names the switch, so the message identifies the site without needing the stack.
 */
export function assertUnreachable(value: never, context: string): never {
  fail(`${context}: unhandled variant ${JSON.stringify(value)}`, assertUnreachable);
}
```

`asserts condition` is the whole point: after `assert(candidate !== undefined, '...')` the compiler narrows `candidate` for the rest of the block, so the assertion buys type-level ground rather than just throwing. This is what makes an assertion cheaper than an `if`.

**Two gotchas with `asserts`:**

1. The call target must have an explicit type annotation. `import { assert } from './assert.js'` is fine. `const assert = (c: boolean, m: string): asserts c => {...}` raises `TS2775`, *"Assertions require every name in the call target to be declared with an explicit type annotation"* — and the damage is the line *after*, which then narrows nothing. Always a `function` declaration, never an arrow assigned to an inferred `const`.
2. `Error.captureStackTrace` is V8-only. The `?.` keeps it safe in browsers and other runtimes; where it is absent the helper's own frame stays on top, so put the function name in the message for those builds.

### Named helpers

```ts
export function assertNotEmpty(value: string, name: string): void {
  if (value.length > 0) return;
  fail(`${name} must not be empty`, assertNotEmpty);
}

export function assertNonNegative(value: number, name: string): void {
  if (Number.isFinite(value) && value >= 0) return;
  fail(`${name} must be a finite number >= 0, got ${value}`, assertNonNegative);
}

export function assertInteger(value: number, name: string): void {
  if (Number.isInteger(value)) return;
  fail(`${name} must be an integer, got ${value}`, assertInteger);
}

/** Bounds are inclusive. A transposed range is itself a bug and is reported as one. */
export function assertInRange(value: number, min: number, max: number, name: string): void {
  if (min > max) fail(`range for ${name} is transposed: min ${min} > max ${max}`, assertInRange);
  if (value >= min && value <= max) return;
  fail(`${name} must be in [${min}, ${max}], got ${value}`, assertInRange);
}
```

Three details worth copying rather than reinventing:

- **One `fail`, every helper passes itself.** The `captureStackTrace` call exists once instead of per helper, and the reported frame is always the caller.
- **The transposed-range check.** `assertInRange(x, 10, 1, 'n')` is a bug in the *call*, not in `x`, and it gets its own message. An assertion helper is subject to the same classification rules as the code it guards.
- **`assertNonNegative` rejects `NaN` and `Infinity`.** `NaN >= 0` is already `false`, but writing `Number.isFinite` states that `Infinity` is rejected too, which the comparison alone does not make obvious.

A helper is a thin layer over one guard and contains no control flow.
## Layer one: make the compiler do it

The toolchain below is **required, not optional**. Every rule in `SKILL.md` that says "the compiler should hold this" assumes it is present. A project without type-aware linting is not running this style with a small gap — it is running a weaker one, in which assertions and tests silently inherit work that should never have reached them.

### Required tsconfig

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,            // 4.1+  arr[i] is T | undefined
    "noPropertyAccessFromIndexSignature": true,  // 4.2+
    "noImplicitOverride": true,                  // 4.3+
    "exactOptionalPropertyTypes": true,          // 4.4+  { a?: T } rejects { a: undefined }
    "useUnknownInCatchVariables": true,          // 4.4+  implied by strict; catch (e: unknown)
    "verbatimModuleSyntax": true,                // 5.0+
    "erasableSyntaxOnly": true,                  // 5.8+  no enums, namespaces, param properties
    "isolatedModules": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

As written this needs TypeScript 5.8 or newer. The per-flag floors are noted so you can see what a version bump buys — the target is all of them, not a subset.

`noUncheckedIndexedAccess` is the highest-value flag and the most irritating. It forces a check or an assertion at every array and record access, which is exactly where index/count confusion lives. Where the access is provably safe, `assert(item !== undefined, ...)` documents *why* and narrows in one line.

**Portability trap, measured:** `verbatimModuleSyntax` with `"module": "nodenext"` requires `"type": "module"` in `package.json`. Without it every `export` raises `TS1287` and every `import` `TS1295`. The identical sources went from 20 errors to 0 on adding that one field.

### Required ESLint configuration

```js
// eslint.config.js — ESLint 9+ flat config
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,                 // type-aware linting — REQUIRED, see below
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      // One zone per wrapped dependency, lifted by directory below — never by filename, which any
      // rename defeats. §5 case 9 of `setup.md` verifies this fires, so the paths are
      // project-specific but the rule itself is not optional.
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [{ name: 'node:fs', message: 'go through the module that owns the filesystem' }],
      }],
      // The only per-function complexity figure available on the TS side — istanbul emits none and
      // `crap.ts` needs one. At 10 the rule reports the same set CRAP would flag.
      complexity: ['error', 10],
    },
  },
  {
    // The one place `as` is legal: the module that owns the brands and mints them.
    files: ['**/types.ts', '**/parse.ts'],
    rules: { '@typescript-eslint/consistent-type-assertions': 'off' },
  },
  {
    // A module's infrastructure directory is the only place its dependencies may be imported.
    files: ['**/infrastructure/**'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
);
```

| Rule | What it enforces |
|---|---|
| `no-floating-promises` | every promise awaited or explicitly observed — an assertion firing into a floating promise is worse than no assertion |
| `no-misused-promises` | no async callback where a sync one is expected |
| `no-unnecessary-condition` | **flags checks the type already guarantees** — the automated form of *assert only what remains after the compiler*; when it fires on one of your assertions, delete the assertion |
| `switch-exhaustiveness-check` | a second net under the `never` check, catching switches that have no `default` at all |
| `strict-boolean-expressions` | no truthiness coercion — kills the `0` / `''` class of bug |
| `no-non-null-assertion` | `!` banned; use an assertion that carries a message |
| `no-unsafe-assignment` / `-argument` / `-return` | `any` cannot leak inward from an untyped dependency |
| `consistent-type-assertions` | `as` is the hole through which branded types are forged — confine it to the owning module |
| `no-restricted-imports` | one owner per dependency, held by the build rather than by review — the typescript-eslint variant also covers `import type`, which the base rule misses |
| `complexity` | the per-function complexity CRAP needs, and the function-shape rule made mechanical |

**The silent trap: type-aware linting must actually be switched on.** The valuable rules above all require type information. Configure ESLint without `projectService` (or the older `parserOptions.project`) and those rules **load and never fire** — no error, no warning, no output. The lint run passes and enforces nothing. Verify once, deliberately: write `if (someNonNullable)` and confirm `no-unnecessary-condition` reports it. If it does not, the whole compiler layer is inert.

### Custom lint rules

When a rule keeps coming up in review, encode it once with `@typescript-eslint/utils` — about 50 lines each, and it stops the class returning:

- `catch` referencing `InvariantViolation` outside the designated failsafe module.
- `try` blocks containing more than one statement, or calling into our own `src/`.
- `as SomeBrandedType` outside the module that owns that brand.
- A `for` or `while` whose bound is neither a literal nor an asserted constant.
- Anything the `no-restricted-imports` zone above cannot express — a dependency reachable through
  several specifiers, or an ownership rule that depends on which symbol is imported.

### What the compiler actually reports

Verified against TypeScript 7.0.2 with the config above:

| Case | Result |
|---|---|
| `assert(v !== undefined, …)` then `v.length`, helper imported from another module | **no error** — `asserts condition` narrows across module boundaries |
| Same, but the helper is an un-annotated `const` arrow | `TS2775` on the call, **and** `TS18048` on the next line |
| `values[0].length` on `readonly string[]` | `TS2532` |
| `values[0]` asserted non-undefined, then `.length` | **no error** — the assertion narrows the indexed access |
| bare `'raw-string'` passed where `SessionId` is expected | `TS2345`, and the message names the brand |
| `{ retries: undefined }` against `{ retries?: number }` | `TS2375` |
| a third union variant added, `default: assertUnreachable(failure, …)` | `TS2345: Argument of type '{ kind: "C"; }' is not assignable to parameter of type 'never'` |

**This table is also TypeScript's half of the §5 checklist** (`setup.md`, contract item 10): each row is a case to paste into a scratch file once, confirming it produces exactly that code. The row that must produce *nothing* is the one proving the assertion narrows — it fails the check by erroring, not by passing.

Two things this pins down:

- **The `TS2775` case is the dangerous one.** The error lands on the call, but the damage is the line after: the assertion compiles as an ordinary call and narrows nothing, so the code reads as guarded while the type says otherwise. Always declare assert helpers as `function` declarations exported from a module — never an arrow assigned to an inferred `const`.
- **Exhaustiveness is a `tsc` error, not a lint finding.** The `never` check is enforced by the compiler itself, which is why `switch-exhaustiveness-check` is listed above as a second net rather than the primary one.

## What is runtime-specific

Only the first group is portable as written. Keep the split deliberate, or a browser or library project inherits Node with no warning.

| Group | Contents | Portability |
|---|---|---|
| **Agnostic core** | `assert`, named helpers, `InvariantViolation`, `assertUnreachable`, brands, `Result`, parse functions, pure domain | anywhere |
| **V8 detail** | `Error.captureStackTrace` | call it with `?.`; where absent, put the function name in the message |
| **Node** | fs and network wrappers, `NodeJS.ErrnoException`, `process.on('uncaughtException' \| 'unhandledRejection')`, `process.exit` | replaced wholesale in another runtime |
| **Browser** | the inline-asset `assert`, `window.addEventListener('error' \| 'unhandledrejection')` | replaced wholesale |

**Nothing in the agnostic core imports `node:*` or touches `process` or `window`.** That single rule is what lets the domain run under any test runner and ship inside a library. Deno and Bun implement most of the Node surface but not all of it — treat each as a third implementation behind the wrapper interface, never as a reason to widen the core.

## Branded types

```ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type SessionId = Brand<string, 'SessionId'>;
export type Tokens = Brand<number, 'Tokens'>;
export type UsdAmount = Brand<number, 'UsdAmount'>;
```

A bare `string` is no longer assignable to `SessionId`, so the only way to produce one is through the module that owns it. That module is the single place the constraint is checked, and every call site downstream is checked by the compiler for free.

`Tokens` and `UsdAmount` both erase to `number`, and branding is what stops one being passed where the other is expected — a mistake nothing else catches, since the arithmetic is valid either way.

**Keep the `as` in one place.** The cast is the hole in the scheme; confine it to the constructor functions and forbid it elsewhere by lint rule.

## `is` guard versus `asserts` guard

Both narrow. They differ in what happens when the value is invalid, which is the channel decision from `SKILL.md` expressed in the type system.

| Form | Use when | Shape it forces |
|---|---|---|
| `value is T` | invalid is a **legitimate alternative** the caller must handle | `if (isX(v)) { ... } else { ... }` — the compiler makes the else branch visible |
| `asserts value is T` | invalid is a **bug** — the value came from our own code | straight-line code after the call; the type is narrowed for the rest of the block |

```ts
// Foreign data → predicate. The caller is forced to write the rejection path.
export function isSessionId(value: string): value is SessionId {
  return value.length > 0 && value.length <= 64 && /^[\w-]+$/.test(value);
}

// Our own data → assertion. There is no rejection path because there is no valid rejection.
export function assertSessionId(value: string): asserts value is SessionId {
  assert(value.length > 0, `sessionId must be non-empty, got empty string`);
  assert(value.length <= 64, `sessionId must be <= 64 chars, got ${value.length}`);
  assert(/^[\w-]+$/.test(value), `sessionId must match [\\w-]+, got ${value.length} chars starting ${value.slice(0, 4)}`);
}
```

The three split assertions in the second function name which constraint broke. One combined boolean would report only that the id was bad. Note the third message logs a *prefix and a length*, not the whole value — keep identifiers and shapes in messages, not payloads.

## Parse, don't validate

Convert foreign data once, at the edge, into a type that cannot be wrong. Downstream code takes the parsed type and has nothing left to check.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type UsageParseFailure =
  | { kind: 'MalformedLine'; lineNumber: number; reason: string }
  | { kind: 'MissingUsageField'; lineNumber: number; field: string }
  | { kind: 'UnsupportedSchemaVersion'; found: number; expected: number };

export function parseUsageEntry(raw: unknown, lineNumber: number): Result<UsageEntry, UsageParseFailure> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'MalformedLine', lineNumber, reason: 'not an object' } };
  }
  const record = raw as Record<string, unknown>;

  const inputTokens = record['input_tokens'];
  if (typeof inputTokens !== 'number' || !Number.isInteger(inputTokens) || inputTokens < 0) {
    return { ok: false, error: { kind: 'MissingUsageField', lineNumber, field: 'input_tokens' } };
  }

  return { ok: true, value: { inputTokens: inputTokens as Tokens } };
}
```

Everything downstream receives `UsageEntry`, where `inputTokens` is a non-negative integer by construction. The check happened once instead of at every consumer, and a consumer that *does* check is now flagged by `no-unnecessary-condition`.

**`Result` lives at the edge only.** If it is spreading into the analysis core, the parse boundary is in the wrong place.

Declare the failure variants for a module in one file, each with a one-line description of the condition that produces it. That file is the module's fault model and doubles as the contract any third-party producer has to satisfy.

## Exhaustiveness

`assertUnreachable` is the helper declared under **The assert helper** above; a `default` arm is its only caller.

```ts
function describe(failure: UsageParseFailure): string {
  switch (failure.kind) {
    case 'MalformedLine':
      return `line ${failure.lineNumber}: ${failure.reason}`;
    case 'MissingUsageField':
      return `line ${failure.lineNumber}: missing ${failure.field}`;
    case 'UnsupportedSchemaVersion':
      return `schema ${failure.found}, expected ${failure.expected}`;
    default:
      return assertUnreachable(failure, 'describe');
  }
}
```

Add a variant to the union and this stops compiling — the compile-time layer catching a design change. The `default` arm still throws because the union is only closed to code the compiler can see; a value deserialised at runtime can carry an unknown `kind`.

## The external boundary

```ts
// Absence is expected → state value.
export async function loadStore(path: string): Promise<StoreLoad> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { kind: 'NotYetCreated' };            // named recovery: caller creates it
    }
    return { kind: 'Unreadable', cause: error };   // cause kept
  }
  return parseStore(content);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
```

- One external call inside the `try`, and nothing of ours.
- `catch (error: unknown)` — guaranteed by `useUnknownInCatchVariables`. Narrow before touching it; a thrown value in JavaScript can be any value at all, including a string or `undefined`.
- If `InvariantViolation` could be raised inside the wrapped call, rethrow it: `if (error instanceof InvariantViolation) throw error;` as the first line of the catch.

Where existence was ruled out on entry, the same read becomes an assertion pair instead:

```ts
export async function loadRequiredStore(path: string, exists: boolean): Promise<Store> {
  assert(exists, `required store must exist before load, path length ${path.length}`);

  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error: unknown) {
    throw new InvariantViolation('required store became unreadable after existence check', { cause: error });
  }

  const store = parseStore(content);
  assert(store.records.length > 0, `required store must hold records, got ${store.records.length}`);
  return store;
}
```

### One owning wrapper per dependency

See `SKILL.md` for the rule and `example.md` for a complete one. The two TypeScript-specific points:

- **Rethrow our own types as the first line of the catch**, before any narrowing: `if (error instanceof InvariantViolation) throw error;`. TypeScript has no exception filter, so this is the only ordering that works, and it must come before the `code === 'ENOENT'` style checks — not after, where an early `return` may already have swallowed it.
- **Enforce the single owner by location, with lint rather than review.** The `@typescript-eslint/no-restricted-imports` zone in the required config above makes importing `node:fs` outside a module's infrastructure directory a build error, and `eslint-plugin-import`'s `no-restricted-paths` expresses the same thing directly as directory-to-directory rules. Anchor it to the directory, never to a filename — a rename should not be able to open the boundary. Without one of them it lasts about three weeks.

Define the wrapper as an `interface` and inject it. The real implementation is constructed only at the composition root; everything else receives the interface, which is what makes the stub in `example.md` a drop-in.

## Top-level failsafe

One per entry point. Logs the full chain including `cause`, ends the operation, never converts what it caught into a domain failure.

```ts
// Node
process.on('uncaughtException', (error) => { logFatal('uncaughtException', error); process.exit(1); });
process.on('unhandledRejection', (reason) => { logFatal('unhandledRejection', reason); process.exit(1); });

// Browser
window.addEventListener('error', (event) => logFatal('error', event.error));
window.addEventListener('unhandledrejection', (event) => logFatal('unhandledrejection', event.reason));
```

UI policy: catch always, then branch. Operating failure → log, show an actionable message, keep running. `InvariantViolation` → log the full chain, show a message, and end the operation — reloading or terminating once the dialog closes only if the damaged state is application-wide.

### Framework callbacks and detached work

`no-misused-promises` bans `addEventListener('click', async () => …)`, and rightly: it hands the DOM a promise nothing observes. The legal form is a synchronous listener delegating to one helper.

```ts
/**
 * Runs work a framework callback started, where no caller of ours can receive a throw.
 * The callback reports its own outcomes; whatever reaches here it did not cover.
 */
export function fireAndForget(start: () => Promise<void>, reporter: FailureReporter): void {
  void start().catch((error: unknown) => report(error, reporter));
}

/** The synchronous twin, for a listener whose work does not await. Nothing is detached. */
export function runAndReport(start: () => void, reporter: FailureReporter): void {
  try {
    start();
  } catch (error: unknown) {
    report(error, reporter);
  }
}

function report(error: unknown, reporter: FailureReporter): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;   // cancelled on purpose

  if (error instanceof InvariantViolation) {
    reporter.fatal(error);                 // the failsafe, invoked explicitly
    return;
  }

  reporter.unexpected(error);              // full chain to the log, "something went wrong" to the user
}

exportButton.addEventListener('click', () => fireAndForget(() => exportReport(), reporter));
saveButton.addEventListener('click', () => runAndReport(() => saveDraft(), reporter));
```

Both listeners read the same, which is the point of having the synchronous twin — without it, a handler whose work does not await gets wrapped in a pointless `async () =>` just to reach the helper. The classification lives in `report` once, so the two paths cannot drift, and only `fireAndForget` detaches.

`reporter` is injected at the composition root, so the helper is tested by asserting what it was handed rather than by driving a real UI. A callback that can fire repeatedly starts a detached task per click: disable the control or carry an `AbortController`, because nothing downstream bounds it.

A **library** registers nothing. It lets the error escape with its type and `cause` intact and documents what escapes; the consumer's failsafe decides.

### On `process.exit(1)` in the assert helper

Some write-ups put `process.exit(1)` directly inside `assert`. Do not. It makes the helper untestable without mocking `process.exit`, unusable in library or browser code, kills unrelated in-flight work in a server, and — worst — truncates the log write that was supposed to explain the crash, because Node's stdout to a pipe or file is asynchronous.

Throw. Let the single failsafe decide whether this process should die, and let it flush synchronously before it does.

## Assertions in browser assets

An inlined `<script>` in a generated page cannot import the project's `assert`, and it is checked by neither the type system nor a unit test. That makes it the *last* place to leave unguarded, not the first. Declare a local one at the top of the asset:

```js
function assert(condition, message) {
  if (condition) return;
  throw new Error(`InvariantViolation: ${message}`);
}
```

Same rules: domain-term message, offending value included, split compound conditions.

## Tests

Examples use `node:test` — built in, zero dependency. Vitest and Jest differ only in the import and in `throws` versus `expect().toThrow`; the requirements below are runner-neutral.

Alias the runner's assert on import: `node:assert` and this codebase's `assert` collide, and the wrong one silently becomes a test-only check that never ships.

```ts
import { describe, test } from 'node:test';
import expect from 'node:assert/strict';

import { InvariantViolation } from '../assert.js';
import { priceLineItem, quantity, rate } from './pricing.js';

describe('priceLineItem', () => {
  test('prices a whole quantity at the unit rate', () => {          // Y: the logic step
    expect.ok(Math.abs(priceLineItem(rate(2.5), quantity(3)) - 7.5) < 1e-10);   // never `==` on money
  });

  test('trips on a zero rate', () => {                              // X1
    expect.throws(
      () => priceLineItem(rate(0), quantity(3)),
      (error: unknown) =>
        error instanceof InvariantViolation && /rate must be > 0, got 0/.test(error.message),
    );
  });

  test('accepts a quantity of zero', () => {                        // inverse of X3
    expect.equal(priceLineItem(rate(2.5), quantity(0)), 0);
  });
});
```

Runner-neutral requirements:

- **Assert on the error class *and* the distinguishing part of the message.** A bare "it threw" passes when the code throws a `TypeError` from a typo. `node:assert` takes a predicate for this; Vitest and Jest take two `toThrow` calls, one with the class and one with a pattern.
- **Meet the X + Y floor** from `SKILL.md`: one test per assertion that trips it, one per logic step that exercises it, plus the inverses neither side implies.
- **Every named failure variant has a test that produces it**, driven through the stub wrapper — `TooLarge` and `Unreadable` are not inducible against a real filesystem on demand.
- **The stub asserts the same preconditions as the real implementation.** A lax stub turns a missing check into green CI.
- Exhaustiveness needs no test: adding a union variant is already a `tsc` error at the `never` check. Do not write a test for something the compiler rejects.
