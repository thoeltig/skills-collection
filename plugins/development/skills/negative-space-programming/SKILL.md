---
name: negative-space-programming
description: Assertion-driven design from NASA's Power of Ten and TigerStyle, for C# and TypeScript. Use when deciding whether a check is an assertion, an exception, or a returned value; when a function needs pre/postconditions; when a loop, queue, batch or recursion needs a bound; when designing types so illegal states cannot be constructed; when placing try/catch at a framework or third-party boundary; or when reviewing code that handles errors defensively instead of eliminating them.
---

# Negative Space Programming

## The idea

Most code is built like a castle. Checks are walls around the safe interior, and the gate admits only an approved state. The walls face outward and the interior trusts whatever got through.

Negative space programming lays tripwires instead of walls. You state what must never be true, at the places it would first become true. Nothing dangerous reaches the interior, so the interior needs no walls. The stance is: *if I handle everything I claim to handle, everything else is unacceptable and must stop the operation loudly.*

The difference is not the number of checks. It is what a check means.

- A defensive check **tolerates** a bad state — it returns `false`, logs, substitutes a default, and execution continues with the badness now one frame further from its origin.
- A negative-space check **eliminates** a state — it declares the state impossible. If reality disagrees, the code is wrong, and continuing would produce a wrong answer that looks like a right one.

The payoff is that the middle of the program gets simpler, not more complex. Every state ruled out at the edge is a branch that never has to exist downstream.

## Files in this skill

`SKILL.md` is the entry point and holds every rule that is not language-specific. Load the rest on
demand:

| File | Load it when |
|---|---|
| `csharp.md` | writing or reviewing C# — assert helper, flow attributes, wrapper types, exhaustiveness, failsafe |
| `typescript.md` | writing or reviewing TypeScript — `asserts` narrowing, brands, required tsconfig and lint config, failsafe |
| `example.md` | the fragments need assembling — one small feature end to end in both languages, with its tests |
| `setup.md` | configuring a project — the output contract, CI, container, coverage, CRAP, optional mutation testing, output filtering, and the checklist that confirms each layer is actually live before you rely on it. Language-agnostic: compiler and lint config live in the language files |
| `jetbrains-annotations.md` | reaching for a JetBrains attribute — the full 75-entry reference. Never write one from memory |
| `scripts/*.ts` | ready-to-run output filters for each tool. See `setup.md` §3 |

## Three layers, cheapest first

Express every constraint at the cheapest layer that can hold it. Moving a constraint down a layer deletes work at every call site above it.

| Layer | Catches | Cost of a violation |
|---|---|---|
| **Compiler and analyzers** | Design and shape errors — wrong type, missing case, nullable misuse, unused result | Caught before commit, zero runtime cost |
| **Runtime assertions** | State and usage errors — value relationships, invariants across a mutation, computed results | Caught at first occurrence, with the offending value |
| **Tests** | That the logic is right *and* that each assertion actually fires | Caught in CI |

Rules that follow from the ordering:

- **Never write a runtime assertion for something a type could guarantee.** Fix the type instead — that removes the check from every call site at once. `IReadOnlyList<T>` beats asserting the list is not mutated. A non-nullable parameter beats a null check.
- **Turn on everything the toolchain offers before writing a single assert.** Strict compiler flags, warnings as errors, the full analyzer set, typed lint rules. A linter rule that flags a check the type already guarantees is telling you the assertion is dead weight.
- **A constraint the compiler cannot express becomes a runtime assertion.** "Non-empty", "sums to the same total", "these two ids differ", "this index is within this specific count" — types rarely reach these.
- **A runtime assertion that has never fired is unverified.** It may be tautological, unreachable, or wrong. Every non-trivial assertion gets a negative test that trips it.
- **When a field or a case is added to a shared type, let the compiler enumerate every touch point.** Shape the type so the addition cannot compile until each site handles it — a discriminated union with exhaustive matching, a required field, no default. An optional field with a default produces no error at all, and a manual checklist of "places to update" eventually misses one, silently.

See `csharp.md` and `typescript.md` for the concrete toolchain settings and language mechanics.

## Working method

Rules about what to *do*, rather than about what the code looks like. Nothing in a diff shows whether they were followed, and in practice they catch more than the code rules do.

### Before building

- **Before building on data, look at the real data.** A fixture shows what you expected; the source shows what is there. Probe first, then design, then validate against that same source immediately after — not against fixtures written from the same expectation that produced the bug.
- **State the limit before you find it.** Covered in full under **Limits** below. Anything that grows gets a bound chosen deliberately and a defined behaviour at that bound; discovering the bound in front of a reader is the failure this prevents.
- **For anything that aggregates, merges or splits, ask what a wrong result would look like.** Where wrong looks the same as right, add the check that tells them apart: a total reached a second way, a count that must conserve down a breakdown, one figure computed by two routes. A wrong merge does not fail — it moves the number under a different name. Silent wrongness needs a check; loud wrongness does not.

### Before believing a result

The rules above produce findings; these decide whether a finding is real. Each covers a claim that arrives already sounding settled — a clean report, a measurement, a conclusion written down by someone else — and each fails in the same direction, where the wrong answer and the right one are indistinguishable at the moment you would notice.

- **A negative result is only evidence if the tool could have seen a positive one.** "No matches", "no findings", "no change" are claims about the tool as much as about the data. Confirm it detects a known-present case first: a file it silently skipped, a path it never walked, a filter that excluded the match — each produces a clean report indistinguishable from a real one.
- **A probe is not automatically more trustworthy than the thing it probes.** It is new code with no tests, and a bug in it looks exactly like a real finding. Reconcile its own totals against a count known independently before believing any discrepancy it reports.
- **A ratio of two summaries answers a different question than the summary of the ratios.** Where the same items produce both numbers, "the typical item's ratio" means divide per item, then summarize those. The ratio of two totals is the overall rate — legitimate, but a different figure and never the typical one. The ratio of two *medians* is neither; nothing is described by it. Name the question before picking the form.
- **A claim that something cannot be done deserves the same check as a claim that it works.** "Not separable", "cannot be measured", "no route exists" are conclusions, not observations, until someone has run the cheapest version of the attempt. Record the attempt and what it returned, not the conclusion alone — a bare conclusion is cheaper to inherit than to re-test, so it never gets re-tested.

## Classification: bug or operating condition

This is the decision that everything else depends on, and it is the one most often gotten wrong.

- **Bug** — impossible if the code is correct. Assert it. Throws a named invariant exception.
- **Operating condition** — possible in a correct program, because it originates outside the program. Return it as a typed value, or throw a named domain exception the caller is documented to handle.

Classify by **where the value came from**, never by how alarming it sounds.

| Origin of the value | Channel |
|---|---|
| Argument passed by another function in this codebase | assert |
| Value this function just computed | assert (postcondition) |
| Injected dependency or module state this function reads | assert what it touches |
| CLI args, environment, configuration | validate → typed failure |
| User input, request payload, message from a queue | validate → typed failure |
| File contents, foreign data, anything deserialized | validate → typed failure |
| Filesystem, network, child process, third-party library | catch at the call site → typed failure |

**The trap: severity is not a channel.** The most common misapplication is asserting a condition because it sounds catastrophic, when it is in fact an ordinary outcome:

```
assert(amount > 0, "...");             // depends: where did amount come from?
assert(balance >= amount, "...");      // wrong if balance/amount came from a request
```

Insufficient funds is a normal condition of a *correct* banking system, arriving from outside. Asserting it converts an everyday business outcome into a process-level fault and hands any caller a trivial denial-of-service. Note the first line is not automatically wrong — if `amount` was constructed by our own code three frames up, it is a genuine precondition. Same expression, two channels, decided only by origin.

The test is **positional, not moral**. Do not ask how bad the condition is. Ask:

> **Has this value already crossed a validation boundary?**

- **Not yet** — this function *is* the boundary. Parse it, return a typed failure. The strictest checking in the whole program lives here.
- **Already** — the parse guaranteed it. Assert. A violation now means our own code broke the guarantee.

**Nothing is let through.** "Not an assertion" never means "not checked". The boundary rejects *more* than an assertion would, because it has to handle malice as well as accident — it just reports the rejection as a value the caller must branch on, rather than as a fault that ends the operation. Read the other way round, the rule inverts: outside data is the only data checked *twice*, once at the boundary as a failure and again downstream as an assertion.

The two sit one layer apart, and the parse is the seam:

| | Before the parse | After the parse |
|---|---|---|
| Type of the value | `unknown` / raw string / untyped record | a domain type that cannot be wrong |
| A bad value means | the world sent us something bad | **our own code** produced something bad |
| Channel | typed failure, returned | assertion, thrown |
| Who must act | the caller, by branching | the author, by fixing the code |

So the same condition lands in different channels at different depths. "`sessionId` is non-empty" is a validated failure in the parser that reads it from the file, and an assertion in every function downstream of that parser. Not duplication — the boundary doing its job, and the interior stating what the boundary guarantees.

The corollary is where this style earns its keep: **the deeper you go, the more you may assert**, because more has been ruled out behind you. If a function deep in the core still needs to handle malformed input, the parse boundary is in the wrong place.

### Cancellation is a third outcome

A cancelled operation did not fail — it was stopped by us, on purpose. It is neither a bug nor an operating condition, and treating it as either produces noise: an error log for something that went exactly as instructed, or a failure state a caller has to branch on to discover nothing is wrong.

So cancellation is filtered, not caught: it passes through the same place the invariant type does, alongside it, and is never converted into a failure value. Only the top records it, and records it as an operation abandoned rather than an operation broken.

### The decision has a type-level form

Both channels can be written so the compiler enforces which one you chose:

| Channel | TypeScript | C# |
|---|---|---|
| **Failure** — the caller must branch | `value is T` predicate | `bool TryParse(…, [NotNullWhen(true)] out T)` |
| **Bug** — the caller must not continue | `asserts value is T` | `void Require([DoesNotReturnIf(false)] bool)` |

A predicate forces an `if`/`else` at every call site, so the rejection path is visible and cannot be forgotten. An assertion produces straight-line code and narrows for the rest of the block, because there is no valid rejection to write.

Picking the wrong one is the classification error made concrete: a predicate where you meant an assertion invites every caller to swallow a bug, and an assertion where you meant a predicate crashes the program on ordinary input. The language files carry the mechanics.

**If a case cannot be classified, stop and ask.** Do not default to the softer channel because the classification was unclear. A misclassified bug hides silently; a misclassified operating condition crashes on a Tuesday.

## The boundary model: our code is the middle

Three zones, three different rules. Getting the zone right decides where `try` is allowed and where an exception is permitted to escape.

| Zone | What lives there | Rule |
|---|---|---|
| **Above** | UI, entry point, request loop, consumers of our library | catch here, exactly once, and branch by category |
| **Middle** | our own domain, services, pure logic | no `try`/`catch` of our own code; assertions throw and travel |
| **Below** | framework, third-party, native, OS, filesystem, network | one owning wrapper per dependency; `try` allowed only inside it |

### Below us — code we do not own

It throws whatever it likes, undocumented, and changes across versions. `try`/`catch` is allowed **only here**.

Do not scatter `try` across every call site. **Give each dependency one owning wrapper** — a module or class that is the only thing in the codebase importing that library. Everything outside it works on domain types and branches on a returned state, and never sees a `try`.

This buys five things:

1. The conversion logic exists once instead of once per call site, so it cannot drift.
2. The third-party type never escapes, so a rename or signature change in the library is a single-file refactor.
3. Everything outside the wrapper becomes "the middle" — assertions apply, `try` is banned, and the zone boundary is a file boundary a reviewer can see.
4. The wrapper is also the parse boundary, so it hands back domain types rather than raw payloads.
5. It is a **test seam**. Real IO failures are hard to induce; a fake wrapper makes "every named failure variant has a test that produces it" actually reachable.

#### The order inside a wrapper method

Fixed, and the reason for it is that an assertion must never be catchable by the wrapper's own `catch`:

```
1.  assert preconditions          ← OUTSIDE the try
2.  try { one external call }     ← nothing of ours inside
3.  catch (narrow) → named state  ← rethrow our own types first
4.  assert postconditions         ← OUTSIDE the try
5.  return the discriminated state
```

**Never write an assertion inside a `try`.** The `catch` two lines below would silence it, turning the loudest signal in the system into a returned state — the precise failure this style exists to prevent, committed by the component built to prevent it.

**The forced exception.** Some third-party APIs cannot be split — a handle that must be opened, read and closed in one scope, a transaction, a native session. Where an assertion genuinely must sit between steps inside one `try`, the `catch` **must rethrow the invariant type as its first action**, never log it and return a state. Filter it out of the catch rather than catching and rethrowing where the language allows, so the stack is never unwound.

#### What the wrapper returns

**A discriminated state, never a flattened one.** Collapsing `NotFound`, `PermissionDenied` and `Corrupt` into one `false` / `null` / `Unavailable` destroys the distinction the caller needed to pick a recovery — inside the component whose job was to preserve it. **Logging is not handling**: a wrapper that logs and returns a bare failure has moved the problem to a file nobody reads.

The caller then does one of two things with that state, and which one depends on whether absence was expected:

- **Branch on it**, when the condition is a legitimate outcome. A missing file that may not have been created yet is a state — the caller creates the file. That is a named recovery.
- **Assert against it**, when the condition was already ruled out on the way in. If the file *must* exist, its existence is asserted before the call; the wrapper reporting `NotFound` afterwards means the precondition was violated or the world changed underneath us, and the caller converts that state into a named invariant exception carrying the cause.

#### Wrapper sizing

- **Wrap the use case, not the library.** `readRateFile(path)` — not a `FileSystemWrapper` exposing `ReadAllText` / `WriteAllText` / `Exists` / `Delete`. A 1:1 passthrough of a large API is pure overhead, and it leaks the library's shape back into every caller anyway. Multi-step third-party sequences belong *inside* one use-case method, which is the main thing a wrapper is for.
- **One owner per dependency.** If the third-party type appears anywhere outside its wrapper, the refactoring-scope benefit is already gone. Enforce it with a lint rule or an architecture test, not by review.

**Pair the two assertion sites.** Assert a record is well-formed before writing it out, and assert it again after reading it back. The two checks are on independent paths, so a fault in the serializer, the transport, or the storage cannot pass both.

### The middle — our own code

- No `try`/`catch` around our own code, ever. Nothing to catch: our code either works or asserts.
- No `catch` of the invariant exception type. It travels through the middle untouched.
- Failures that are operating conditions are returned as values or thrown as named domain exceptions the signature or documentation names.
- Never convert a failure into a success without a named recovery. Returning `[]`, `0`, `null`, or a default because a call below failed hides a bug behind a plausible-looking answer.

### Above us — where policy lives

Who catches, and what they do, depends on who owns the process.

- **A library does not decide policy.** Let the exception escape with its type, message and cause chain intact, and document which types escape. A library that swallows an invariant violation to "be nice" has destroyed its consumer's only signal. The consumer's top level decides what it means for their program.
- **An application or UI top level always catches**, exactly once, and branches on the category:
  - *Operating condition* — log it, show the user an actionable message, continue running.
  - *Invariant violation* — log the full chain, show the user a message, and end the operation. Terminate the process after the dialog closes when the corrupted state is process-wide; otherwise abandon the operation and keep the process alive.
- **A server request loop** treats an invariant violation as the end of *that request*: log the full chain, return a non-success status, continue serving. It escalates to killing the process only when the process owns exclusive mutable state that is now suspect.
- **A batch run** records the failure in the run summary, keeps processing independent records, and exits non-zero. Nothing is dropped silently.
- **Anything a framework invokes on us is Above, not Middle.** An event handler, a UI callback, a timer tick, a queue consumer: nothing of ours is above it to receive a throw, so it catches, classifies and decides. It receives already-constructed dependencies and never constructs them.

Two consequences at that edge:

- **What reaches the handler's `catch` is by definition uncovered.** The work it starts reports its own success and its own operating failures — that is what makes it the top-level code for that click. So the handler is a local failsafe, not a policy layer: log the full chain, tell the user something went wrong and where to look, and end the operation.
- **Detached work is the dangerous form.** `async void`, or a promise nobody observes, hands the framework work whose failure the global failsafe often cannot see — or sees stripped of the stack that would explain it. Route every one through a single helper that catches, classifies and reports, and give that helper a synchronous overload too, so a callback reads the same whether its work awaits or not — otherwise synchronous handlers get wrapped in a pointless `async` lambda to reach it, or skip it entirely. Only the member that actually discards a task is named for the discard: a name like `SafeExecute` describes how it feels rather than what it does. A callback that can fire repeatedly starts a detached task each time, so bound it at the source — disable the control, guard re-entrancy, or pass a token.

Register the failsafe explicitly: uncaught exceptions and unobserved async failures both reach it. An assertion that fires into a swallowed promise or an unawaited task is worse than no assertion.

## Structure: modules, and where a file lives

The boundary model decides what a file may do. This decides where it sits, so the zone a reader is in is visible from the path instead of reconstructed from the imports.

**Group by module, not by technical layer.** A module is a capability with a name from the domain — payments, rates, extraction — and it holds everything that capability needs. Grouping by layer instead (`controllers/`, `services/`, `repositories/`) spreads one change across three trees, and puts unrelated code side by side for no better reason than that it sits at the same altitude.

**Inside a module the shape is the same in every module.** The names are fixed; the nesting appears only when a part outgrows a file or two. A five-file module is five files, not four folders holding one each.

| Part | Boundary zone | Holds |
|---|---|---|
| contract | middle | the interfaces other modules call, the DTOs that cross, the fault model |
| domain | middle | pure logic, value types, the parse that mints them |
| infrastructure | below-facing | one implementation per dependency the module owns — the only place `try` appears |
| entry | above-facing | what a framework invokes: handler, controller, command |

- **The module's public surface is its contract, and nothing else.** Internal types never cross it: the entity a repository maps to stays inside, and callers see the DTO. `internal` with `InternalsVisibleTo` in C#; a single exported contract file plus an import zone in TypeScript.
- **Name by role, not by pattern.** `IPaymentService` with `StripePaymentService` behind it; `RateFileReader` with `FileSystemRateFileReader`. Reader, Writer, Repository, Factory, Client and Gateway all say what the thing does, and they still read in five years. `Manager`, `Helper`, `Processor` and `Util` say nothing, and collect whatever had no home.
- **Enforce ownership by location, never by filename.** The rule is that only this module's infrastructure part may import that dependency, and the strongest form makes it a separate compilation unit — a contract project and an implementation project — because then the compiler refuses the import and no test has to.
- **One shared kernel, closed by rule.** The assert helper, the invariant type and the base value types live where every module may import them, and that place imports nothing. It is closed to feature logic: a thing belongs there because every module needs it, never because it had nowhere else to go. That is the whole difference between a kernel and a `utils/` folder.
- **The composition root sits as high as the platform allows** — `Program.cs`, `main.ts`, `App` — outside every module, one per entry point. It is the only place implementations are constructed and the only place the clock, filesystem, environment and randomness are read. A library has none; its consumer's root is the root.
- **Modules talk through contracts, synchronously, by default.** An event bus between modules inverts the call stack, so an assertion firing in a handler has lost the caller that caused it. Use events where the decoupling is real — another process, another lifecycle — and then the queue is bounded and the bound has a named failure.
- **Tests sit beside the unit they test**, so a missing one is visible in a directory listing rather than discoverable only by running coverage.

**When the contract is data rather than a call, it is a schema and not a shared type.** Two modules that meet through a file, a store or a message never import each other's code — they work from the documented shape, the way a consumer works from an API's published contract rather than from its source. The version travels inside the data, each side owns its own types, and the shared artefact is a set of fixtures. A shared type couples them at build time, which is the one thing the format existed to avoid, and the coupling stays invisible until someone outside the repository tries to implement it.

## Writing assertions

**Where.** Preconditions on entry, postconditions before returning, wherever the type system does not already guarantee it.

**How much.** Two per function on average is the published figure, but the useful rule is subtractive:

> **Assert the negative space that remains after the compiler has taken its part.**

Enumerate what must never be true for this function. Strike everything a type, a closed union, a nullability annotation or an analyzer already makes unrepresentable. What is left is the assertion set. Nothing else enters that decision — in particular, **not** the tests.

The three layers run in one direction and never feed back:

```
types + compiler  →  what remains = the assertions  →  assertions + logic steps = the test floor
```

Tightening a type deletes an assertion and lowers the floor. Writing a test does neither. A test covers the inputs its author thought of; an assertion covers every input at runtime — which is precisely the set the author could not enumerate. So *"there is already a test for that"* is never a reason to omit an assertion. The two overlap deliberately; see **Tests** below.

The places that most need an assertion are the places tests reach least — untested code, untestable code, and anything whose wrong answer looks like a right one. *Untested and unasserted* is the state that must not exist.

**What.** Both spaces. The positive space you expect *and* the negative space you reject. Bugs cluster on the boundary between them, so a check that only confirms the good case misses half of where the interesting failures are.

**Suspension invalidates preconditions.** A precondition asserted on entry holds for the rest of the function only if the function runs to completion without suspending. Every `await`, `yield` and callback boundary is a point where other code runs and shared state can change, so an assertion made before the suspension says nothing about the state after it.

- Prefer functions that do not suspend between asserting a property and using it. Fetch first, then compute in a straight line.
- Where a suspension is unavoidable and the value still matters, **re-assert after it**, and treat that as a pair of assertions on independent paths rather than a duplicate.
- Never assert a property of shared mutable state and then `await` before acting on it. That is the async form of TOCTOU: check and use are separated in time, so the check guarantees nothing.

This applies only to state something else can reach. A function's own locals and its immutable parameters are unaffected by a suspension, so re-asserting those is the noise this rule is not asking for.
**Messages** state the expected condition in domain terms and carry the actual value:

```
entry.inputTokens must be >= 0, got -3
pricing.rate must be in (0, 10), got 12.5 for model claude-opus-5
```

Not `assertion failed`, not `invalid input`. A reader holding only that one line from a log must reach the cause without re-running the code. Keep captured values to a few scalars; if describing a failure needs an object graph, write a dedicated assertion for that type that checks its fields individually and names the one that broke.

**Split compound assertions** when the conditions are unrelated: `assert(a); assert(b);` names which one broke. A range check on a single value is one assertion.

**Wrap recurring checks in named helpers** — `AssertNotEmpty(value, name)`, `AssertNonNegative(value, name)`, `AssertInRange(value, min, max, name)`. The helper takes the field name and builds the message from it and the actual value, so call sites stay short and messages stay uniform. A helper is a thin layer over the base assert and contains no control flow. Each one arranges for the reported stack frame to be the caller, not the helper.

**Assertions ship.** Never strip them from a release build, never gate them behind a debug flag. A build whose assertions are removed is a different program from the one that was tested, and it is the one running in front of users. In C# this specifically rules out `Debug.Assert`.

**Do not assert:**

- what a non-nullable type, a closed union, or a validated wrapper type already guarantees
- the same property twice in one call chain with no independent derivation in between
- anything with a side effect; an assertion must be a pure boolean test

## Logging

Logging is a debugging aid, not an audit trail.

**An assertion is logging that speaks only when something is wrong**, and it carries the value that broke. At most scales that covers what per-function tracing would, at none of the volume — so logging lives at the composition root, the run loop and the external boundary, and domain code stays quiet. Add tracing inside a function when a specific question needs it, not as a standing rule.

- Debug level at state changes and before and after every external call. Include the values that drove the decision, not merely that it happened.
- One structured record per line, minified JSON. Every record carries the operation and the record identity, so a message traces back to the thing it happened to.
- Messages are descriptive and self-contained: `parsed 412 records from <source>, skipped 3` beats `parse done`.
- Never log message bodies, file contents, secrets, or absolute user paths. Log shapes, counts and identifiers.
- **Logging is not handling.** A failure that is logged and then dropped is a failure ignored — see the wrapper rules under the boundary model.

## State isolation: make a crash cheap

If an assertion can fire mid-mutation, the crash leaves torn state behind — and the cleanup code you would write to repair it runs in exactly the corrupted world you just proved you do not understand.

So do not write cleanup. Arrange for there to be nothing to clean up.

1. Compute the next state on temporaries.
2. Run every check against those temporaries.
3. Commit to shared, live, or persistent state only once success is guaranteed.

```
// Unsafe: state moves before the check
order.Status = Processing;
... work ...
assert(order.Total > 0);      // fires with the order stuck mid-flight

// Safe: check, then commit
var nextStatus = Processing;
assert(order.Total > 0);
order.Status = nextStatus;    // nothing between the last check and the commit
```

Where a sequence of commits cannot be collapsed into one, put the durable record first: append the intent to a log, then mutate. A crash mid-mutation is then recoverable by replay, and the recovery path is one code path used on every start rather than an exception path used once a year.

## Limits: state the bound before you find it

Everything grows until something stops it. Choose what stops it, deliberately, in advance.

- **No recursion.** Tree and directory walks are iterative with an explicit depth limit, so the bound is a number a reader can see rather than a stack size a reader has to guess.
- **Every loop, buffer, queue, batch and retry has a fixed upper bound, and the bound is asserted.** Loops over data that should terminate on their own still get a guard counter — an event loop that genuinely cannot terminate asserts that fact instead.
- **Bound concurrency explicitly.** A fixed-size worker pool whose size is passed in, never an unbounded fan-out over a directory listing or a result set.
- **Bound the run.** A batch takes a maximum item count and a wall-clock ceiling; exceeding either ends the run with a summary, never silently.
- **Name what happens at the bound.** What is dropped, folded, truncated or rejected is stated in the code and surfaced to the caller. A silent truncation is a wrong answer wearing the costume of a right one.
- **Work at a pace you control.** Pull in batches rather than reacting per event. This keeps control flow yours, makes the per-period work bound real, and is faster besides.
- **An intake bound is not a fan-out bound.** Capping what comes in leaves what each input can produce downstream uncapped — one item well inside the intake limit can still expand into unbounded work below it. The fan-out gets its own bound, in its own units, sized from what that downstream work costs rather than scaled off the intake number.

## Function shape

1. Precondition assertions
2. Flat body — guard-and-return, no `else` after a returning `if`, no `catch`, and no `throw` used as flow control. An assertion and a named domain exception are not flow control; a `throw` standing in for a `return` is.
3. Postcondition assertions
4. Return

That is the shape of a function in **the middle**. A wrapper method follows the numbered order under **The boundary model** instead — the one place a `try` belongs.

- Short and single-purpose, roughly 50–70 lines. If it needs a section comment, it wants splitting.
- **Push `if`s up and `for`s down.** The parent owns branching and state; leaves are pure and do straight-line work. Assertions in a pure leaf hold for its whole lifetime and are worth more.
- Declare each variable at the smallest scope, close to its use. Never keep two names for the same value — duplicates drift apart, and the check reads the stale one.
- **Return the simplest type that carries the meaning.** Every extra state in a return type becomes a branch in every caller, and that dimensionality is viral: `void` over `bool`, `bool` over a value, a plain value over an optional, an optional over a result type.
- State invariants positively. `if (index < count)` is easier to get right than `if (index >= count)` with the negation carried in the reader's head.
- Prefer non-throwing APIs where the library offers both, and pass options explicitly at the call site rather than inheriting a default that may change.
- Fail once, loudly. No retry around a bug, no defensive re-check that quietly repairs an impossible state.

## Determinism

- Clock, filesystem, environment, randomness and paths are **injected** into domain code, never read directly from it. Only the composition root at the entry point touches them.
- Given the same input, the code produces the same output, byte for byte. Any genuinely nondeterministic field — a generation timestamp, a run id — is injected rather than read.
- Golden-file tests depend on this. Anything that breaks byte-identical output is a bug in the code, not in the test.

Determinism is also what makes the X + Y floor reachable: a function that reads the clock or the filesystem directly cannot be handed the inputs that trip its own assertions.

## Tests

The assertions and the tests are one system; neither is complete alone.

### The floor

> **A function with X assertions and Y logic steps needs at least X + Y tests.**

- **X** — one test per assertion, which *trips* it. An assertion that has never fired is an unverified claim: it may be tautological, unreachable, or checking the wrong thing.
- **Y** — one test per logic step, which *exercises* it. A logic step is a branch, a distinct transformation, or a distinct output shape — each `if` / `case` / early return, plus each computation whose result is separately observable.
- **Then add the inverses.** Where an assertion test and a logic test do not already cover each other's opposite, the missing direction is its own test. An assertion test proves the bad input is rejected; it says nothing about the good input near the boundary being accepted. Concretely: if you test `assert(quantity >= 0)` with `-1` and watch it trip, add a test that `0` is accepted — that is the test which proves the bound is `>=` and not `>`. An off-by-one inside an assertion silently narrows what the function accepts, and the inverse test is the only thing that catches it.

This is a floor, not a target, and it is deliberately mechanical: it makes the test count a function of what the code actually does rather than of how thorough the author felt. It also prices assertions honestly — every assertion added costs a test, so tautological ones get noticed.

A function whose X + Y is large is telling you it does too much. Splitting it does not raise the total; it distributes it across units that can each be tested in isolation.

### The rest

- **Test valid data, invalid data, and valid data becoming invalid.** The third is where the interesting bugs are: a record that passed validation and was then mutated past the boundary.
- **Every named failure variant has a test that produces it.** A failure type nothing constructs is either dead or a lie about the fault model.
- Assert on the exception *type* and on the distinguishing part of the message. A test that accepts any exception passes when the code throws for the wrong reason — including a typo raising a `TypeError`.
- Use the fake wrapper to produce the failure states real IO will not produce on demand.
- Overlap between an assertion and a test is a failsafe, not duplication. The assertion covers the input the test did not think of.
- **A structural or derived check — a conservation total, a golden file, a snapshot pin — is unverified until it has been seen to fail.** Same rule as the assertion that has never fired: prove it reports clean when nothing changed *and* reports the change when something did. A check that is silently inert — a wrong anchor, a comparison that never runs — passes by doing nothing, and that reads exactly like proof.
- **"No caller outside its own test" is a stronger dead-code signal than "no caller."** Dead-code detectors count a test as a legitimate use, which hides exactly this shape: code kept alive only by the test written to cover it, never by anything that runs it in production. The answer is to delete both or to wire it up — not to leave it because the metric is green.

### What tests cannot cover

Tests check the data, the computation, and that output is produced. They cannot check whether the output *means* anything to someone who did not build it, because a test harness has no reader. Any output a person reads — a report, a CLI summary, a UI, an API response — is therefore not finished until a person has read it, asking *how would someone without knowledge of this project read this?*. Labels nobody recognises, a long tail burying what matters, two adjacent tables disagreeing about which rows exist: all found that way, none findable by a script.

**Then ask whether the reading left a testable residue.** Some catches convert: "this grid shows 6 of 10 items" is a comprehension complaint, but underneath sits a property — two breakdowns hold the same rows and reach the same total — which becomes a test. Others do not: no assertion says a label is unreadable. Convert the ones that convert, so that class cannot come back silently.

## Precedence when rules collide

> **safety > developer experience > performance**

When two rules in this document conflict, the earlier goal wins. Trade safety or legibility for speed only with a measurement proving it is necessary.

The ordering is not a compromise between the three, and putting performance last is not a claim that it does not matter. It reflects that most systems are not latency-bound, while every system is read by people — and that in this style the three mostly point the same way. Eliminating a state deletes the branch that handled it, so safer code is *smaller* code, and smaller code is both easier to read and faster to run. Where they genuinely diverge, legibility loses to safety and speed loses to both.

When performance does dominate — a hot loop, a real latency budget, a measured bottleneck — that is stated by the task or obvious from context, and it is a local exception with a measurement attached, not a change to the ordering.

Ties *within* safety are broken by which failure is quieter. A wrong answer that looks right beats a crash for danger every time, so the check that distinguishes them wins over the check that merely adds noise.

## Adopting this in code that does not follow it yet

**Greenfield and brownfield are properties of the scope in front of you, not of the project.** A six-week-old repository has modules nobody has revisited. A feature branch may arrive written by someone who has never read this. The function you are about to change may predate the boundary you now want. The trigger for this section is not project age — it is *the code in front of me does not hold the invariant yet*, which can be true on day ten.

Two consequences:

- **Apply the sequence at whatever scope you are in** — repository, module, branch, or a single function. The steps do not change; only how many of them fit in one commit.
- **This is a continuous operation, not a one-time migration.** Non-conforming code keeps arriving for as long as people who have not read this contribute. A rule held by review decays with every unfamiliar contributor, which is why the enforcement points below — the lint rule, the architecture test, the baseline file — are the part that actually holds. Anything held only by discipline is temporary.

Applying it front-to-back does not work at any scope: turning on strict flags and the full analyzer set at once produces an unreviewable diff and a revert. Sequence it instead.

**The expensive part is classification, not assertions.** Deciding which values are foreign and where the boundary should sit is analysis work on code you did not write — including code you wrote and no longer remember. Budget for that, not for typing `assert`.

1. **Inventory the boundary first, change nothing.** List every place foreign data enters — IO, network, config, deserialization, third-party calls, UI input. This list is the plan; everything else follows from it.
2. **Wrap one dependency.** Pick the one with the most call sites. One owning wrapper, discriminated state, a fake for tests — then delete the scattered `try`/`catch` it replaces. This is usually a net *reduction* in lines, which makes it reviewable and makes the case for the next one.
3. **Move the parse to that boundary.** Introduce the parsed type the wrapper returns. Downstream defensive checks are now provably redundant and the linter will point at them; delete them. This is where the codebase gets smaller.
4. **Assert in new and modified code only.** Do not retrofit assertions across untouched files. An assertion written without understanding the invariant is tautological, and tautological assertions are worse than none because they read as coverage.
5. **Stage the compiler flags one at a time**, each as its own commit, ordered by yield against noise. Typically `strictNullChecks` first and largest, then index-access checking, then analyzers at *warning* before *error*. Scope per directory where the toolchain allows it, and use a baseline or suppression file so new violations fail the build while old ones do not.
6. **Then the failsafe and the bounds.** Register the top-level handler, then walk the unbounded loops, queues and fan-outs from the inventory in step 1.

**Expect the first assertions in legacy code to fire.** That is the point, and it is also the risk: an assertion added to code you do not fully understand will find a real bug at an inconvenient time. Add them only where you have *established* the invariant, and only when you can afford to fix what they catch. If you cannot, you are not ready to assert there yet — write the characterization test first.

**Never** do a mechanical repo-wide insertion of null checks or argument guards. It produces volume without understanding, inflates the test floor with tests nobody will write, and buries the few assertions that mean something.

## When not to do this

The style has a cost and there are places it does not pay.

- **Exploratory code and spikes.** The point of a spike is to discover the constraints. Asserting them before you know them encodes guesses.
- **Where the "impossible" state is actually reachable.** If a value comes from a source you do not control, an assertion on it is a misclassification, not rigor. Go back to the table.
- **Hot paths where the check itself allocates.** Keep the success path free of string building and formatting; construct the message only on the failure branch.
- **Anywhere a crash destroys unsaved user work**, unless the alternative is writing corrupt data. End the operation, not the process.
- **Crash-loop-prone deployments.** A process that exits on every malformed message from a queue it cannot drain is not fail-fast, it is unavailable. Fix the classification first.

## Review checklist

- Every check: is its value from inside or outside? Does the channel match?
- Any assertion on user input, config, files, or network data? Misclassified.
- Any `try` around our own code, or wrapping more than one external call?
- Any `catch` of the invariant type outside the single top-level failsafe?
- Any framework callback with its own inline `try`, or any detached task not routed through the fire-and-forget helper?
- Any dependency imported outside its module's infrastructure, or a module reaching past another's contract into its internals?
- Any failure turned into `[]`, `0`, `null` or a default without a named, justified recovery?
- Any loop, queue, batch, retry or walk without a stated and asserted bound?
- Any assertion the compiler could have made unnecessary?
- Any assertion without a test that trips it?
- Any state mutated before the last check that governs it?
- Does each message carry the offending value and read correctly alone in a log line?

## Where to go next

The routing table is under **Files in this skill** near the top of this file. In short: `csharp.md` or `typescript.md` for language mechanics, `example.md` when the fragments need assembling, `setup.md` to configure a project, `jetbrains-annotations.md` before writing any JetBrains attribute, and `scripts/` for the ready-to-run output filters.
