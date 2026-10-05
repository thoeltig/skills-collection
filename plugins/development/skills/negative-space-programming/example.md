# Worked example, end to end

One small feature carried through every layer, so the fragments in `SKILL.md`, `csharp.md` and `typescript.md` can be seen composed. TypeScript is shown in full; the C# section covers only the places the language changes the answer.

**The feature:** load a table of unit rates from a file, look up a rate, price a line item, total an order.

| Piece | File | Zone | Channel |
|---|---|---|---|
| Fault model | `rates/failures.ts` | — | declares the failure variants |
| Domain types | `rates/types.ts` | — | makes illegal states unconstructable |
| Owning wrapper | `rates/rate-file-reader.ts` | below | `try` lives here and nowhere else |
| Parse | `rates/parse.ts` | boundary | foreign → domain, returns failures |
| Core | `rates/pricing.ts` | middle | pure, assertions only, no `Result` |
| Composition root | `main.ts` | above | resolves paths, catches, decides policy |
| Stub | `rates/rate-file-reader.stub.ts` | test | canned lookup, same preconditions |

---

## 1. Fault model

One file per module, each variant with the condition that produces it. This file is the module's contract with its callers.

```ts
// rates/failures.ts
export type RateFileFailure =
  | { kind: 'NotYetCreated' }                                  // path absent; a first run may create it
  | { kind: 'TooLarge'; characters: number; limit: number }    // present but beyond the read bound
  | { kind: 'Unreadable'; cause: unknown };                    // present but IO or permission refused

export type RateTableFailure =
  | { kind: 'TooManyLines'; found: number; limit: number }
  | { kind: 'MalformedLine'; lineNumber: number; reason: string }
  | { kind: 'DuplicateKey'; key: string; lineNumber: number };

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

## 2. Domain types

```ts
// rates/types.ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type RateKey   = Brand<string, 'RateKey'>;   // 1..64 chars, no separator
export type UnitRate  = Brand<number, 'UnitRate'>;  // USD per unit, finite, > 0
export type Quantity  = Brand<number, 'Quantity'>;  // whole units, >= 0
export type UsdAmount = Brand<number, 'UsdAmount'>; // USD, full precision, rounded at render

export type RateTable = ReadonlyMap<RateKey, UnitRate>;

/** One priced order line. `key` is the sort key that makes an order total order-independent. */
export interface PricedLine {
  readonly key: RateKey;
  readonly amount: UsdAmount;
}
```

`UnitRate`, `Quantity` and `UsdAmount` all erase to `number`. Branding is the only thing that stops one being passed where another is expected — a mistake nothing else catches, because the arithmetic is valid either way.

## 3. The owning wrapper

The only module in the codebase that imports `node:fs`. Note the numbered order, and that no assertion sits inside the `try`.

```ts
// rates/rate-file-reader.ts
import { readFile } from 'node:fs/promises';
import { assertNotEmpty, InvariantViolation } from '../assert.js';
import type { RateFileFailure } from './failures.js';

const MAX_RATE_FILE_CHARACTERS = 1_000_000;

export type RateFileRead =
  | { ok: true; content: string }
  | { ok: false; error: RateFileFailure };

/** Reads the raw rate file. Implementations return state; none of them throw for IO. */
export interface RateFileReader {
  read(path: string): Promise<RateFileRead>;
}

export class FileSystemRateFileReader implements RateFileReader {
  async read(path: string): Promise<RateFileRead> {
    // 1. Preconditions — OUTSIDE the try. `path` came from our own code.
    assertNotEmpty(path, 'path');

    // 2. One external call. Nothing of ours inside.
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch (error: unknown) {
      // 3. Our own types leave untouched, as the first action in the catch.
      if (error instanceof InvariantViolation) throw error;
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return { ok: false, error: { kind: 'NotYetCreated' } };
      }
      return { ok: false, error: { kind: 'Unreadable', cause: error } };
    }

    // 4. The bound on foreign content is a FAILURE, not an assertion — see the note below.
    if (content.length > MAX_RATE_FILE_CHARACTERS) {
      return {
        ok: false,
        error: { kind: 'TooLarge', characters: content.length, limit: MAX_RATE_FILE_CHARACTERS },
      };
    }

    // 5. Discriminated state out. No fs type escapes this file.
    return { ok: true, content };
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
```

**Why there is no postcondition assertion here.** The obvious candidate, `assert(typeof content === 'string')`, is a tautology — the return type already says so, and the linter will flag it. The other candidate, the size bound, is about *foreign content*, so it belongs in the failure channel. That is the general shape: **a wrapper asserts its arguments and our own state, and returns failures about whatever the world handed back.** A wrapper with a postcondition assertion on the payload has usually misclassified something.

## 4. The parse

Foreign text in, domain type out. After this function nothing downstream checks a rate again.

```ts
// rates/parse.ts
const MAX_RATE_LINES = 10_000;
const MAX_KEY_CHARACTERS = 64;

export function parseRateTable(content: string): Result<RateTable, RateTableFailure> {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length > MAX_RATE_LINES) {
    return { ok: false, error: { kind: 'TooManyLines', found: lines.length, limit: MAX_RATE_LINES } };
  }

  const table = new Map<RateKey, UnitRate>();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const [rawKey, rawRate, ...extra] = line.split(',');

    if (rawKey === undefined || rawRate === undefined || extra.length > 0) {
      return { ok: false, error: { kind: 'MalformedLine', lineNumber, reason: 'expected exactly key,rate' } };
    }

    const key = rawKey.trim();
    if (key.length === 0 || key.length > MAX_KEY_CHARACTERS) {
      return { ok: false, error: { kind: 'MalformedLine', lineNumber, reason: `key length ${key.length} outside 1..${MAX_KEY_CHARACTERS}` } };
    }

    const rate = Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return { ok: false, error: { kind: 'MalformedLine', lineNumber, reason: `rate must be finite and > 0, got ${rawRate.trim()}` } };
    }

    if (table.has(key as RateKey)) {
      return { ok: false, error: { kind: 'DuplicateKey', key, lineNumber } };
    }

    table.set(key as RateKey, rate as UnitRate);
  }

  return { ok: true, value: table };
}
```

Every `as` in the module is here, in the one file that owns the brands. Every bound — line count, key length — is a named constant with a failure attached, not a surprise discovered in production.

## 5. The core

No `Result`, no `try`, no foreign data. Failure is impossible; only bugs remain, so only assertions.

```ts
// rates/pricing.ts
import { assert } from '../assert.js';
import type { PricedLine, Quantity, RateKey, RateTable, UnitRate, UsdAmount } from './types.js';

const MAX_ORDER_LINES = 1_000;

/** Absence is a genuine, expected value here, so an optional — not a Result. */
export function rateFor(table: RateTable, key: RateKey): UnitRate | undefined {
  return table.get(key);
}

export function priceLineItem(rate: UnitRate, quantity: Quantity): UsdAmount {
  assert(rate > 0, `rate must be > 0, got ${rate}`);
  assert(Number.isInteger(quantity), `quantity must be a whole number, got ${quantity}`);
  assert(quantity >= 0, `quantity must be >= 0, got ${quantity}`);

  const amount = rate * quantity;

  assert(Number.isFinite(amount), `amount must be finite, got ${amount} from rate ${rate} x quantity ${quantity}`);
  return amount as UsdAmount;
}

export function priceOrder(lines: readonly PricedLine[]): UsdAmount {
  assert(lines.length <= MAX_ORDER_LINES, `order must hold <= ${MAX_ORDER_LINES} lines, got ${lines.length}`);

  // Float addition is order-dependent, so fix an explicit sort key before summing.
  const ordered = [...lines].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

  let total = 0;
  for (const line of ordered) {
    total += line.amount;
  }

  assert(Number.isFinite(total), `order total must be finite, got ${total} over ${ordered.length} lines`);
  return total as UsdAmount;
}
```

**Why `MAX_ORDER_LINES` is asserted while `MAX_RATE_LINES` is returned.** Both bound a count, and origin alone decides the channel: `lines` was built by our own code from an already-parsed order, so exceeding the bound is a bug; the rate file's line count came straight off disk, so exceeding that bound is a failure the caller branches on. Same expression, different channel — the table in `SKILL.md` applied twice in one feature.

**The assertion that is missing on purpose.** `assert(amount >= 0)` looks like a reasonable postcondition, and it is a tautology: it follows from `rate > 0` and `quantity >= 0`, both asserted four lines above with no independent derivation in between. It would cost a test that can never be made to fail. The X + Y floor is what makes that cost visible — which is the point of having one.

`Number.isFinite(amount)` is *not* redundant: two finite positives can multiply to `Infinity`, and nothing above rules that out.

## 6. Composition root

The only place that touches `process`, the clock and the filesystem. Everything below receives resolved values.

```ts
// main.ts
async function main(): Promise<void> {
  const path = resolveRatePath(process.argv, process.env);   // config: validated, never asserted
  const reader: RateFileReader = new FileSystemRateFileReader();

  const read = await reader.read(path);
  if (!read.ok) {
    return reportAndExit(describeRateFileFailure(read.error));
  }

  const parsed = parseRateTable(read.content);
  if (!parsed.ok) {
    return reportAndExit(describeRateTableFailure(parsed.error));
  }

  // Past this line there is no Result and no failure channel. Only assertions.
  const total = priceOrder(buildLines(parsed.value, readOrder()));
  process.stdout.write(`${JSON.stringify({ total })}\n`);
}

process.on('uncaughtException', (error) => { logFatal('uncaughtException', error); process.exit(1); });
process.on('unhandledRejection', (reason) => { logFatal('unhandledRejection', reason); process.exit(1); });

void main().catch((error: unknown) => { logFatal('main', error); process.exit(1); });
```

The two `if (!x.ok)` guards are the entire failure surface of the program. Both bind the error and
branch on it; neither turns it into a default.

## 7. The stub

A lookup table of canned responses. This is what makes the failure paths testable — `TooLarge` and `Unreadable` are close to impossible to induce against a real filesystem on demand.

```ts
// rates/rate-file-reader.stub.ts
export class StubRateFileReader implements RateFileReader {
  private readonly responses: ReadonlyMap<string, RateFileRead>;
  public readonly requestedPaths: string[] = [];

  constructor(responses: Readonly<Record<string, RateFileRead>>) {
    this.responses = new Map(Object.entries(responses));
  }

  async read(path: string): Promise<RateFileRead> {
    assertNotEmpty(path, 'path');            // the SAME precondition the real one asserts
    this.requestedPaths.push(path);

    const response = this.responses.get(path);
    assert(response !== undefined, `stub has no response configured for the requested path, ${this.responses.size} configured`);
    return response;
  }
}
```

**The stub asserts the same preconditions as the real implementation.** A lax stub lets tests pass on calls that would fail in production, which is worse than no stub — it converts a missing check into green CI.

## 8. The tests

`priceLineItem` has **X = 4** assertions and **Y = 1** logic step, so the floor is **5**, plus one inverse.

| # | Test | Covers |
|---|---|---|
| 1 | `3 × 2.50 → 7.50` | Y: the multiplication |
| 2 | `rate = 0` trips, message contains `must be > 0, got 0` | X1 |
| 3 | `quantity = 1.5` trips, message contains `whole number` | X2 |
| 4 | `quantity = -1` trips, message contains `>= 0, got -1` | X3 |
| 5 | `rate = Number.MAX_VALUE, quantity = 2` trips on `finite` | X4 — overflow, not reachable any other way |
| 6 | `quantity = 0 → 0` accepted | **inverse** of X3: proves the bound is `>= 0`, not `> 0` |

Test 6 is the case the floor does not produce on its own. Tests 2–5 prove bad input is rejected; none of them prove that the *good* value sitting immediately next to the boundary is accepted. That is the class of bug where an off-by-one in an assertion silently narrows what the function accepts.

```ts
import { describe, test } from 'node:test';
import expect from 'node:assert/strict';   // aliased: `assert` is already taken

describe('priceLineItem', () => {
  test('prices a whole quantity at the unit rate', () => {
    expect.ok(Math.abs(priceLineItem(rate(2.5), quantity(3)) - 7.5) < 1e-10);
  });

  test('trips on a zero rate', () => {
    expect.throws(
      () => priceLineItem(rate(0), quantity(3)),
      (error: unknown) =>
        error instanceof InvariantViolation && /rate must be > 0, got 0/.test(error.message),
    );
  });

  test('accepts a quantity of zero', () => {          // the inverse, not implied by the rejections
    expect.equal(priceLineItem(rate(2.5), quantity(0)), 0);
  });
});

describe('rate file reader', () => {
  test('reports an unreadable file as a state, not a throw', async () => {
    const reader = new StubRateFileReader({
      '/rates.csv': { ok: false, error: { kind: 'Unreadable', cause: new Error('EACCES') } },
    });

    const read = await reader.read('/rates.csv');

    expect.equal(read.ok, false);
    if (read.ok) return;
    expect.equal(read.error.kind, 'Unreadable');      // discriminated, not flattened
  });
});
```

Every assertion is tested by the *type* and by the distinguishing part of the *message*. A bare `toThrow()` would pass on a `TypeError` from a typo.

---

## The same feature in C#

Only the places the language changes the answer.

### Wrapper: filter instead of rethrow

C# exception filters are strictly better than catch-and-rethrow here, because the filter is evaluated **before** the stack unwinds — so an invariant violation passing through keeps its original stack intact rather than being re-thrown from this frame.

```csharp
public sealed class FileSystemRateFileReader : IRateFileReader
{
    private const int MaxRateFileCharacters = 1_000_000;

    public RateFileRead Read(string path)
    {
        Invariant.NotEmpty(path, nameof(path));                        // 1. outside the try

        string content;
        try
        {
            content = File.ReadAllText(path);                          // 2. one call, nothing of ours
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return RateFileRead.NotYetCreated();                       // 3. named states
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return RateFileRead.Unreadable(ex);
        }

        // 4. foreign content → failure channel, not an assertion
        if (content.Length > MaxRateFileCharacters)
        {
            return RateFileRead.TooLarge(content.Length, MaxRateFileCharacters);
        }

        return RateFileRead.Success(content);                          // 5.
    }
}
```

Both `catch` clauses are filtered, so `InvariantViolationException` and `OperationCanceledException` raised anywhere inside never match and propagate untouched. There is no unfiltered `catch (Exception)` in the file. Where a forced multi-step sequence makes a broad catch unavoidable, the filter becomes explicit:

```csharp
catch (Exception ex) when (ex is not InvariantViolationException and not OperationCanceledException)
```

### Discriminated state without discriminated unions

```csharp
public abstract record RateFileRead
{
    private RateFileRead() { }                       // closed: only nested types derive

    public sealed record Success(string Content) : RateFileRead;
    public sealed record NotYetCreated : RateFileRead;
    public sealed record TooLarge(int Characters, int Limit) : RateFileRead;
    public sealed record Unreadable(Exception Cause) : RateFileRead;
}

static string Describe(RateFileRead read) => read switch
{
    RateFileRead.Success             => "read",
    RateFileRead.NotYetCreated       => "rate file not created yet",
    RateFileRead.TooLarge t          => $"rate file has {t.Characters} characters, limit {t.Limit}",
    RateFileRead.Unreadable u        => $"rate file unreadable: {u.Cause.GetType().Name}",
    _ => throw new InvariantViolationException($"unhandled RateFileRead: {read.GetType().Name}"),
};
```

The private constructor closes the hierarchy, so adding a variant makes this switch stop compiling (CS8509 — promote it to error). The `_` arm is an assertion, not a fallback, and it throws `InvariantViolationException` — the same channel every other assertion uses.

### Core

```csharp
public static UsdAmount PriceLineItem(UnitRate rate, Quantity quantity)
{
    Invariant.Require(rate.Value > 0, $"rate must be > 0, got {rate.Value}");
    Invariant.Require(quantity.Value >= 0, $"quantity must be >= 0, got {quantity.Value}");

    var amount = rate.Value * quantity.Value;

    return new UsdAmount(amount);
}
```

Two assertions fewer than TypeScript, both because a type carries the constraint. `Quantity` wraps an `int`, so "whole number" needs no assertion. And `decimal` has no infinity — an overflow throws `OverflowException` out of the multiplication itself and reaches the failsafe unaided — so TypeScript's finiteness postcondition would be a tautology here. X = 2, Y = 1, floor = 3. **Moving a constraint into a type lowers the test floor** — the clearest reason to prefer the compiler.

### Stub

```csharp
public sealed class StubRateFileReader : IRateFileReader
{
    private readonly IReadOnlyDictionary<string, RateFileRead> _responses;
    public List<string> RequestedPaths { get; } = [];

    public StubRateFileReader(IReadOnlyDictionary<string, RateFileRead> responses) => _responses = responses;

    public RateFileRead Read(string path)
    {
        Invariant.NotEmpty(path, nameof(path));                  // same precondition as the real one
        RequestedPaths.Add(path);

        Invariant.Require(
            _responses.TryGetValue(path, out var response),
            $"stub has no response configured for the requested path, {_responses.Count} configured");

        return response;
    }
}
```

`Invariant.Require` carries `[DoesNotReturnIf(false)]`, so the compiler treats `response` as non-null after the call and the `return` needs no `!`.
