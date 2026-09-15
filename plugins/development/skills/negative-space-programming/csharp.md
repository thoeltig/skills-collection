# Negative Space Programming in C#

Read `SKILL.md` first for the decision rules. This file is mechanics only.

## Choosing the assert mechanism

Neither built-in option is usable, so write one.

| Mechanism | Why not |
|---|---|
| `Debug.Assert` | Compiled out unless `DEBUG` is defined. The release binary is a different program from the tested one, with the checks removed exactly where they matter. |
| `Trace.Assert` | Survives release, but the default `DefaultTraceListener` shows a modal dialog on Windows — a service or CI job hangs forever instead of failing. Reconfiguring listeners globally is action at a distance. |
| `ArgumentNullException.ThrowIfNull` etc. | Fine for public API argument validation, but throws `ArgumentException` types that callers legitimately catch. An invariant violation must be uncatchable by ordinary handlers. |
| Custom `Invariant` class | Ships in every build, throws a type nobody catches, and carries the caller's expression text for free. |

## The assert helper

```csharp
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;

/// <summary>Signals that program state the code assumed impossible has occurred.</summary>
/// <remarks>Caught only by the single top-level failsafe. Never caught in domain code.</remarks>
public sealed class InvariantViolationException : Exception
{
    public InvariantViolationException(string message, Exception? cause = null) : base(message, cause) { }
}

public static class Invariant
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Require(
        [DoesNotReturnIf(false)] bool condition,
        string message,
        [CallerArgumentExpression(nameof(condition))] string? expression = null,
        [CallerMemberName] string? member = null,
        [CallerLineNumber] int line = 0)
    {
        if (!condition)
        {
            Fail(message, expression, member, line);
        }
    }

    [DoesNotReturn]
    private static void Fail(string message, string? expression, string? member, int line) => throw new InvariantViolationException($"{member}:{line} — {message} [{expression}]");
}
```

Three attributes are each doing real work:

- **`[DoesNotReturnIf(false)]`** is the C# equivalent of TypeScript's `asserts condition`. After `Invariant.Require(candidate is not null, ...)` the flow analyzer knows `candidate` is not null for the rest of the method, and the nullable warning disappears without a `!` suppression. This is the single most valuable line in the file: it makes the assertion pay compile-time rent.
- **`[CallerArgumentExpression]`** captures the source text of the condition, so the message never has to restate the expression — it states the *domain* meaning while the mechanics come for free.
- **`[DoesNotReturn]`** on `Fail` lets the caller's definite-assignment and reachability analysis treat the failure branch as terminal, so no `return default;` is needed after it.

Splitting `Fail` out of `Require` keeps the success path free of string interpolation. `Require` inlines to a compare and a branch that the CPU predicts correctly forever; the allocation and formatting live in a cold method that runs once.

#### Annotate the helper for both engines

Roslyn and ReSharper read *different attributes for the same fact*. A helper carrying only the BCL pair narrows in the build but not in the IDE, so Rider keeps reporting possible-null on the line after every `Require` call even though `dotnet build` is clean. Carry both:

```csharp
[AssertionMethod]
[MethodImpl(MethodImplOptions.AggressiveInlining)]
public static void Require(
    [DoesNotReturnIf(false)]                               // Roslyn: narrows in the build
    [AssertionCondition(AssertionConditionType.IS_TRUE)]   // ReSharper: narrows in the IDE
    bool condition,
    string message,
    [CallerArgumentExpression(nameof(condition))] string? expression = null)
{
    if (!condition) Fail(message, expression);
}

[DoesNotReturn]      // Roslyn
[TerminatesProgram]  // ReSharper
private static void Fail(string message, string? expression) =>
    throw new InvariantViolationException($"{message} [{expression}]");
```

- `[AssertionMethod]` declares that the method halts control flow when its condition fails;
- `[AssertionCondition]` names *which* parameter is that condition, and its argument is mandatory.

The BCL pair is what actually fails the build — the JetBrains pair only removes IDE noise.

### Named helpers

```csharp
public static class Invariant
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void NotEmpty(
        [NotNull] string? value,
        string name,
        [CallerMemberName] string? member = null,
        [CallerLineNumber] int line = 0)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            Fail($"{name} must be a non-empty string, got {Describe(value)}", name, member, line);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void NonNegative(
        decimal value, string name,
        [CallerMemberName] string? member = null,
        [CallerLineNumber] int line = 0)
    {
        if (value >= 0) return;
        Fail($"{name} must be >= 0, got {value}", name, member, line);
    }

    /// <summary>Bounds are inclusive. A transposed range is itself a bug and is named as one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void InRange(
        decimal value, decimal min, decimal max, string name,
        [CallerMemberName] string? member = null,
        [CallerLineNumber] int line = 0)
    {
        if (min > max) Fail($"range for {name} is transposed: min {min} > max {max}", name, member, line);
        if (value >= min && value <= max) return;
        Fail($"{name} must be in [{min}, {max}], got {value}", name, member, line);
    }

    private static string Describe(string? value) =>
        value is null ? "null" : value.Length == 0 ? "empty" : "whitespace";
}
```

`[NotNull]` on the parameter propagates the non-null guarantee to the caller's variable, same trick as `[DoesNotReturnIf]`. A helper contains no control flow beyond its single guard, and passes its own caller info through so the reported location is the calling method.

## Layer one: make the compiler do it

### Project settings

`Directory.Build.props` at the solution root:

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>

    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnableNETAnalyzers>true</EnableNETAnalyzers>
    <AnalysisMode>All</AnalysisMode>
    <AnalysisLevel>latest-all</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>

    <GenerateDocumentationFile>true</GenerateDocumentationFile>
  </PropertyGroup>
</Project>
```

**`<Nullable>enable</Nullable>` is the switch that turns the whole compile layer on.** Without it every attribute in the next section is inert decoration.

`AnalysisMode=All` turns on every CA rule including the off-by-default ones, and `TreatWarningsAsErrors` makes them binding. Expect a large first-run backlog; triage it once in `.editorconfig` with a written reason per suppression, never by lowering `AnalysisLevel`.

**Do not set `WarningsAsErrors` to a bare number.** That property takes warning *codes* (`CS8602;CA2007`). A value like `9999` silences nothing and enables nothing — it is a confusion with `WarningLevel`, which is the numeric one.

### `.editorconfig`

```ini
[*.cs]
dotnet_diagnostic.CS8600.severity = error   # converting null literal to non-nullable
dotnet_diagnostic.CS8602.severity = error   # dereference of a possibly null reference
dotnet_diagnostic.CS8618.severity = error   # non-nullable field uninitialised leaving the ctor
dotnet_diagnostic.CS8625.severity = error   # cannot convert null literal to non-nullable
dotnet_diagnostic.CS8509.severity = error   # switch expression does not handle all values
dotnet_diagnostic.CA2007.severity = error   # ConfigureAwait on every await in library code
dotnet_diagnostic.CA1852.severity = error   # seal types never inherited
dotnet_diagnostic.CA1062.severity = none    # public-arg null checks — NRT already covers it
```

**CS8509 as an error is load-bearing.** It is what makes a closed record hierarchy fail the build when a variant is added and a `switch` is not updated — the C# half of exhaustiveness. Without it the pattern under **Closed hierarchies** below is advisory only.

### Packages

```xml
<ItemGroup>
  <PackageReference Include="JetBrains.Annotations" Version="*" />
  <PackageReference Include="NetArchTest.Rules" Version="*" />   <!-- wrapper-ownership tests -->
</ItemGroup>
```

Pin exact versions in a real project. `JetBrains.Annotations` is a runtime dependency; see the section on what it does and does not enforce below.
### Flow-analysis attributes are compile-time assertions — the default set

**Use these by default.** They live in `System.Diagnostics.CodeAnalysis`, they are consumed by Roslyn itself, and each one teaches the compiler a fact it then enforces at every call site for free. Prefer one of these to a runtime check whenever the shape allows — a constraint moved here deletes an assertion *and* lowers the test floor.

This is the complete nullability set.

**Preconditions — what the caller may pass in**

| Attribute | Tells the compiler |
|---|---|
| `[AllowNull]` | this non-nullable input may be given `null` (a setter that normalises it away) |
| `[DisallowNull]` | this nullable input must never be given `null` (readable as null, not settable to null) |

**Unconditional postconditions — what the callee guarantees on the way out**

| Attribute | Tells the compiler |
|---|---|
| `[NotNull]` | this nullable input, `ref`, `out` or return **is non-null once this returns** |
| `[MaybeNull]` | this non-nullable return may in fact be `null` |

**Conditional postconditions — guarantees tied to the return value**

| Attribute | Tells the compiler |
|---|---|
| `[NotNullWhen(true)]` | if the method returned `true`, this `out`/param is non-null — the `TryParse` shape |
| `[MaybeNullWhen(false)]` | if the method returned `false`, this `out` may be null — the `TryGetValue` shape |
| `[NotNullIfNotNull(nameof(input))]` | null in, null out; non-null in, non-null out |

**Control flow**

| Attribute | Tells the compiler |
|---|---|
| `[DoesNotReturn]` | this path terminates; code after the call is unreachable |
| `[DoesNotReturnIf(false)]` | this argument being `false` terminates — **the C# equivalent of `asserts condition`** |

**Member state**

| Attribute | Tells the compiler |
|---|---|
| `[MemberNotNull(nameof(X))]` | after this method, field `X` is initialised — lets an `Init()` satisfy CS8618 |
| `[MemberNotNullWhen(true, nameof(X))]` | `IsLoaded` returning `true` implies `Buffer` is non-null |

All eleven are inert unless `<Nullable>enable</Nullable>` is set.

**Other BCL attributes worth reaching for**

| Attribute | Purpose |
|---|---|
| `[SetsRequiredMembers]` | this constructor satisfies every `required` member |
| `[StringSyntax("Json")]` / `("Regex")` / `("CompositeFormat")` | the string literal is validated as that syntax |
| `[ConstantExpected(Min = 1, Max = 64)]` | the argument must be a compile-time constant in range |
| `[Experimental("ID")]` | using this API is a **build error** until explicitly suppressed |
| `[UnscopedRef]` | opts out of default `ref` escape-analysis scoping |
| `[RequiresUnreferencedCode]` / `[RequiresDynamicCode]` / `[DynamicallyAccessedMembers]` | trimming and AOT safety |

### What the build actually reports

This matters more than it looks, because it decides which of these an automated reader — CI, a pre-commit hook, an agent working from build output — can see at all.

Verified against the .NET 10.0.400 SDK with `<Nullable>enable</Nullable>`:

| Case | Result |
|---|---|
| Dereference a `string?` with no guard | `CS8602` on `dotnet build` |
| Same dereference after `Invariant.Require(s is not null, …)` | **no diagnostic** — `[DoesNotReturnIf(false)]` narrows through our own wrapper |
| `return v` after `Invariant.Require(d.TryGetValue(k, out var v), …)` | **no diagnostic** — narrowing composes with `TryGetValue`'s `[MaybeNullWhen(false)]` |
| `CallerArgumentExpression` at runtime | captured the source text: `one must exceed two [1 > 2]` |
| JetBrains `[Pure]` and `[MustUseReturnValue]` results discarded, `[NotNull]` given `null` | **complete silence — zero diagnostics** |

**This table is also C#'s half of the §5 checklist** (`setup.md`, contract item 10): each row is a case to paste into a scratch file once, confirming it produces exactly that diagnostic. A setup where row 1 stops firing has gone dark in the compile layer without anything turning red.

**So: BCL attributes are build diagnostics. JetBrains attributes are not.** Roslyn consumes the former directly, so they emit `CS86xx` and fail the build under `TreatWarningsAsErrors`. JetBrains annotations are consumed by a *separate* engine — ReSharper/Rider inspections, or `jb inspectcode` in CI — and are inert metadata to `csc`. Anything relying on them is invisible to a build-output reader unless `jb inspectcode` is run and its report supplied.

**This is why the BCL set is the default and JetBrains is the supplement, never the reverse.** Put a
constraint in JetBrains annotations only when the BCL genuinely cannot express it.

### JetBrains annotations — reference only, unless the CLI is present

**Status: mentioned, not relied upon.** Without `jb inspectcode` wired into the build, a JetBrains annotation has exactly the enforcement power of a comment — read by humans running ReSharper or Rider, and by nothing else. Write one to *document* a contract; never treat one as the thing that holds it. Anything that must actually be enforced belongs in the BCL set above, in a runtime assertion, or in a test.

`JetBrains.Annotations` ships as an **assembly** (`lib/netstandard2.0/JetBrains.Annotations.dll`), not as source, so referencing it adds a real runtime dependency. It expresses constraints Roslyn has no concept of.

The package defines **75 attributes**; roughly 32 are ASP.NET, Razor, routing or XAML specific and irrelevant here. These are the ones that carry negative-space meaning:

| Attribute | Declares | Use |
|---|---|---|
| `[AssertionMethod]` + `[AssertionCondition(IS_TRUE)]` | this method halts when the condition fails | the assert helper itself |
| `[TerminatesProgram]` | unconditionally terminates control flow | the `Fail` / panic path |
| `[ContractAnnotation("value:null => halt")]` | input-to-outcome contract | guards where a null argument ends the operation |
| `[NonNegativeValue]` | integral value never below zero | counts, sizes, indexes — a later `== -1` is then flagged as always false |
| `[ValueRange(1, 1000)]` | integral value within inclusive intervals; multiple non-intersecting ranges allowed | bounds, batch sizes |
| `[Pure]` | discarding the result is meaningless | pure leaf functions |
| `[MustUseReturnValue("…")]` | the caller must consume the result | **the failure-returning parse or lookup** |
| `[NotNull]` / `[CanBeNull]` | nullability contract | projects without `<Nullable>enable</Nullable>` |
| `[ItemNotNull]` / `[ItemCanBeNull]` | element nullability of `IEnumerable`, `Task<T>`, `Lazy<T>` | collections whose *elements* carry the constraint |
| `[MustDisposeResource]` / `[HandlesResourceDisposal]` | ownership of a disposable | a wrapper handing out a session or handle |
| `[InstantHandle]` | the delegate argument is not captured | callbacks a leaf invokes and forgets |
| `[RequireStaticDelegate]` | the delegate must not capture | hot paths where a closure allocation is a defect |
| `[NoEnumeration]` | the `IEnumerable` argument is not enumerated | guard helpers taking a sequence, without tripping multiple-enumeration |
| `[CollectionAccess(CollectionAccessType.Read)]` | whether the method reads or mutates | only meaningful if **every** method on the type is marked |

`[MustUseReturnValue]` is the highest-value one because it has **no BCL equivalent**: `CA1806` covers only a fixed list of known BCL methods, never your own. "The caller forgot to branch on the returned failure" is the single most common way a failure gets silently discarded, and this is the only attribute that catches it — at the cost of being invisible to the build.

**Two name collisions that silently change meaning:**

| Simple name | `System.Diagnostics.*` | `JetBrains.Annotations` |
|---|---|---|
| `NotNull` | **postcondition**: non-null *after this returns* | **precondition**: caller must not pass null |
| `Pure` | `System.Diagnostics.Contracts.PureAttribute` — legacy Code Contracts, effectively inert | drives the discarded-result inspection |

The two `NotNull`s point in near-opposite directions and are selected by a `using`. **Fully qualify both** — `[JetBrains.Annotations.Pure]`, `[JetBrains.Annotations.NotNull]` — or alias them at the top of the file. Never rely on which `using` won.

**Never write a JetBrains annotation from memory.** The package exposes 75; the table above lists the 14 that carry negative-space meaning. The parameter shapes of the rarer ones — `[ContractAnnotation]`'s string DSL especially — are easy to get subtly wrong in a way that compiles cleanly and means nothing, and because a wrong one produces no diagnostic anywhere, the mistake is undetectable without reading the definition.

**`jetbrains-annotations.md`, next to this file, is the full reference** — JetBrains' own documentation of the annotations, all with descriptions and examples. Read the entry before writing the attribute. It travels with the skill so the lookup works in any project.

If you need to verify something about the annotations which is not in the documentation, you can read `<nuget-cache>/jetbrains.annotations/<version>/lib/netstandard2.0/JetBrains.Annotations.xml`, which is always on disk wherever the package is referenced.

#### Making them visible

- **For a build or an agent:** `dotnet tool install -g JetBrains.ReSharper.GlobalTools`, then `jb inspectcode Solution.sln -f=Text -o=inspect.txt`. Installing the ReSharper IDE extension or Rider does **not** put this on `PATH` — the CLI is a separate package.
- **For consumers of a library:** with the NuGet reference the attribute types are already public, so a consumer who also references the package gets the inspections. The `<DefineConstants>JETBRAINS_ANNOTATIONS</DefineConstants>` switch belongs to the *copy-the-source* variant of the annotations, where it controls whether the attribute types are emitted public rather than `internal`; with the package reference it gates nothing. Either way the benefit reaches only consumers running ReSharper, Rider, or `jb inspectcode`.

### Custom analyzers for project rules

When a rule keeps being violated in review, write it as a Roslyn analyzer once instead of catching it by eye forever. High-value ones for this style:

- `catch (InvariantViolationException)` outside the designated failsafe type — error.
- `try` blocks containing more than one statement, or containing a call to our own namespace.
- `Debug.Assert` used anywhere.
- A `for`/`while` whose bound is not a constant or an asserted variable.

A `DiagnosticAnalyzer` plus a `.editorconfig` severity is about 60 lines and pays back on the second review it saves.

## Making illegal states unrepresentable

### Value types, and the `default` hole

```csharp
public readonly record struct Tokens(int Count)
{
    public static Tokens Of(int count)
    {
        Invariant.Require(count >= 0, $"token count must be >= 0, got {count}");
        return new Tokens(count);
    }
}
```

**The gotcha:** a struct always has an implicit parameterless constructor, so `default(Tokens)`, `new Tokens()`, and every uninitialised array slot bypass `Of` entirely. For a value type whose zero is meaningless — an id, a non-empty string — this is a real hole. Three ways out, in order of preference:

1. **Pick a value type whose `default` is valid.** `Tokens(0)` is fine as a default. Design the domain so zero is the identity element and the hole closes itself.
2. **Use a `sealed record class`.** Reference types have no `default` bypass — the only invalid value is `null`, and nullable reference types make that a compile error. Costs an allocation.
3. **Assert on read.** A `Value` property that asserts the backing field is initialised. Last resort: it moves the check back to runtime and to every access.

```csharp
public sealed record AccountId
{
    private AccountId(string value) => Value = value;
    public string Value { get; }

    public static AccountId FromTrusted(string value)
    {
        Invariant.NotEmpty(value, nameof(value));
        return new AccountId(value);
    }

    public static bool TryParse(string? raw, [NotNullWhen(true)] out AccountId? id)
    {
        // foreign data — failure channel, not assertion
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 64) { id = null; return false; }
        id = new AccountId(raw);
        return true;
    }
}
```

Two entry points, two channels: `FromTrusted` asserts because its caller is our code; `TryParse` returns because its caller holds foreign data. `[NotNullWhen(true)]` means the caller gets the narrowing without a null check inside the `if`.

### Closed hierarchies

C# has no discriminated unions, so approximate one and let the compiler check the match:

```csharp
public abstract record ExtractFailure
{
    private ExtractFailure() { }   // only nested types can derive — the hierarchy is closed

    public sealed record MalformedLine(int LineNumber, string Reason) : ExtractFailure;
    public sealed record MissingUsageField(string FieldName) : ExtractFailure;
    public sealed record UnsupportedSchemaVersion(int Found, int Expected) : ExtractFailure;
}

static string Describe(ExtractFailure failure) => failure switch
{
    ExtractFailure.MalformedLine m           => $"line {m.LineNumber}: {m.Reason}",
    ExtractFailure.MissingUsageField f       => $"missing field {f.FieldName}",
    ExtractFailure.UnsupportedSchemaVersion v => $"schema {v.Found}, expected {v.Expected}",
    _ => throw new InvariantViolationException($"unhandled ExtractFailure: {failure.GetType().Name}"),
};
```

The private constructor closes the hierarchy, which makes the compiler emit CS8509 ("switch expression does not handle all values") when a variant is added and this switch is not updated. Promote CS8509 to error. The `_` arm still exists because the analyzer cannot prove closure across assemblies — it is an assertion, not a fallback, and it must throw. Throw `InvariantViolationException` rather than the BCL `UnreachableException`: an unhandled variant is a bug in our code like any other, and the failsafe, the tests and the log filters all key on that one type.

**Enums are not closed.** `(Status)999` is a legal `Status`. A `default` arm on an enum switch is a real runtime path when the value came from a database column or a deserialiser, so it is a *failure* there and an *assertion* only when the value was produced by our own code.

### Result type

```csharp
public readonly record struct Result<TValue, TError>
{
    private Result(bool ok, TValue? value, TError? error) => (Ok, _value, _error) = (ok, value, error);
    private readonly TValue? _value;
    private readonly TError? _error;

    public bool Ok { get; }

    public static Result<TValue, TError> Success(TValue value) => new(true, value, default);
    public static Result<TValue, TError> Failure(TError error) => new(false, default, error);

    public TValue Value
    {
        get { Invariant.Require(Ok, "Value read from a failed Result"); return _value!; }
    }

    public TError Error
    {
        get { Invariant.Require(!Ok, "Error read from a successful Result"); return _error!; }
    }
}
```

Note what happens here: the type cannot prevent reading `Value` off a failure, so that residue dropsto the runtime layer as an assertion — an accurate illustration of the layering rule. `default` on this struct is a failure with a null error, which is why `Ok`/`Error` are asserted rather than trusted. Where the language allows it, prefer returning the closed hierarchy directly over a generic result wrapper; it removes the hole entirely.

**Keep `Result` at the edge.** Parsing, file access, configuration, pricing lookup. Everything downstream of the parse boundary works on parsed types where failure is impossible and returns plain values. If `Result` is spreading into the core, the boundary is in the wrong place.

## The external boundary

```csharp
// Absence is expected → state value.
public StoreLoad LoadStore(string path)
{
    string content;
    try
    {
        content = File.ReadAllText(path);
    }
    catch (FileNotFoundException)
    {
        return StoreLoad.NotYetCreated;             // named recovery: caller creates it
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
    {
        return StoreLoad.Unreadable(ex);            // cause kept
    }

    return ParseStore(content);
}

// Absence was ruled out on entry → assertion on the way out.
public Store LoadRequiredStore(string path)
{
    Invariant.Require(File.Exists(path), $"store file must exist before load, path length {path.Length}");

    string content;
    try
    {
        content = File.ReadAllText(path);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
    {
        throw new InvariantViolationException("required store became unreadable after existence check", ex);
    }

    var store = ParseStore(content);
    Invariant.Require(store.Records.Count > 0, $"required store must hold records, got {store.Records.Count}");
    return store;
}
```

- One external call per `try`. The `try` holds a single statement and nothing of ours.
- `catch (Exception ex) when (...)` filters rather than catching broadly then re-checking; the filter runs before the stack unwinds, which keeps the original stack intact for debugging.
- Never `catch (Exception)` unfiltered here — it would swallow `InvariantViolationException` and `OperationCanceledException` raised inside the call.
- The two `Invariant.Require` calls in the second method are the paired assertions: one on the way in, one on the way out, on independent paths.

### Prefer an exception filter to catch-and-rethrow

An assertion must never be silenced by the wrapper's own `catch`, so assertions go outside the `try`. Where a forced multi-step third-party sequence makes that impossible, do **not** write `catch (Exception ex) { if (ex is InvariantViolationException) throw; ... }`. Use a filter:

```csharp
catch (Exception ex) when (ex is not InvariantViolationException and not OperationCanceledException)
{
    return Unreadable(ex);
}
```

A `when` filter is evaluated **before the stack unwinds**. An invariant violation passing through never enters the handler, so its original stack and first-chance debugger break are preserved — whereas catch-and-rethrow discards the point of origin. Never log-and-swallow it: logging is not handling, and the wrapper is the last place that should decide the process's fate.

### One owning wrapper per dependency

See `SKILL.md` for the rule and `example.md` for a complete one. Enforcement in C#:

- Put the dependency behind an interface, register the real implementation only at the composition root, and inject the interface everywhere else.
- Add an architecture test — NetArchTest or ArchUnitNET — asserting no type outside the wrapper's namespace references the third-party namespace. That check is cheap and it is the only thing that actually holds the boundary once the team grows.
- `InternalsVisibleTo` plus `internal` on the third-party-facing types keeps the leak inside one assembly even if the architecture test is skipped.

## Top-level failsafe

One per entry point. It logs the full chain and ends the operation; it never converts what it caught into a domain failure.

```csharp
AppDomain.CurrentDomain.UnhandledException += (_, e) =>
    LogFatal("unhandled exception", e.ExceptionObject as Exception);

TaskScheduler.UnobservedTaskException += (_, e) =>
{
    LogFatal("unobserved task exception", e.Exception);
    e.SetObserved();
};
```

Per host: ASP.NET Core gets exception-handler middleware that maps `InvariantViolationException` to 500 and logs the chain; WPF/WinForms hook `DispatcherUnhandledException` / `Application.ThreadException`; a worker hooks the same plus its own loop guard.

UI policy, as decided for this style: catch always, then branch. An operating failure logs and shows an actionable message and the app continues. An `InvariantViolationException` logs the full chain, shows a message, and terminates once the dialog closes — unless the damaged state is confined to the operation, in which case abandon the operation and keep running.

### Framework callbacks and detached work

`async void` hands the runtime work whose failure the handlers above often cannot see — or see stripped of the stack that would explain it. So a button click does not get its own inline `try`; it goes through one helper, which is the same policy applied where the global failsafe cannot reach.

```csharp
/// <summary>
/// Runs work a framework callback started, where no caller of ours can receive a throw.
/// The delegate reports its own outcomes; whatever reaches these handlers it did not cover.
/// </summary>
public static async Task RunAndReportAsync(Func<Task> start, IFailureReporter reporter)
{
    try
    {
        await start().ConfigureAwait(true);   // the catch reports to the user, so keep the caller's context
    }
    catch (Exception error)
    {
        Report(error, reporter);
    }
}

/// <summary>The synchronous overload, for a callback whose work does not await. Nothing is detached.</summary>
public static void RunAndReport(Action start, IFailureReporter reporter)
{
    try
    {
        start();
    }
    catch (Exception error)
    {
        Report(error, reporter);
    }
}

/// <summary>The framework-facing edge for async work. Named for the discard, because there is one.</summary>
public static void FireAndForget(Func<Task> start, IFailureReporter reporter) =>
    _ = RunAndReportAsync(start, reporter);

private static void Report(Exception error, IFailureReporter reporter)
{
    if (error is OperationCanceledException) return;   // cancelled on purpose: not a failure

    if (error is InvariantViolationException violation)
    {
        reporter.Fatal(violation);                     // the failsafe, invoked explicitly
        return;
    }

    reporter.Unexpected(error);                        // full chain to the log, a message to the user
}
```

Three details are load-bearing:

- **`ConfigureAwait(false)` would be wrong here**, though it is right everywhere else in library code. The catch reports to the user, so it needs the caller's context; `false` lands the handler on a thread-pool thread and the report then needs a dispatcher or throws.
- **`IFailureReporter` is injected**, so policy stays at the composition root and the helper is testable by asserting what the reporter was handed — no process isolation, the same seam the failsafe uses.
- **One shape, three members.** `RunAndReport` and `RunAndReportAsync` are the ordinary sync/async pair, so a callback reads the same whether its work awaits or not, and nobody wraps synchronous code in `async () =>` just to reach the helper. `FireAndForget` is the only one that discards a task, and it is named for the discard instead of hiding it inside an overload. The awaitable one is what tests call.
- **The broad `catch (Exception)` is correct here and nowhere else.** This is the top level for that callback — nothing of ours sits above it to be more specific. It swallows nothing: `Report` classifies, and the invariant type reaches the failsafe explicitly rather than becoming a log line.

A **library** does not do this. It lets the exception escape, documents which types escape, and leaves the policy to the consumer's failsafe.

## `Environment.FailFast`

```csharp
Environment.FailFast(message, exception);
```

It bypasses every `catch` and every `finally`, skips remaining finalizers, and writes a Watson crash dump. That is precisely why it exists: nothing gets a chance to flush corrupted state to disk.

Use it only when the process owns exclusive mutable state that is now suspect and any further write would persist corruption — a single-writer store, a ledger mid-commit, an in-memory index that backs durable data. Everywhere else it is too blunt: it discards unrelated in-flight requests, skips the logging you were about to do (log *before* calling it, synchronously), and makes the code untestable without process isolation.

Default to throwing `InvariantViolationException`. It fails just as fast in every way that matters, and it can be tested.

## Tests

```csharp
[Fact]
public void Sum_totals_token_counts()                      // positive
{
    Assert.Equal(Tokens.Of(30), TokenMath.Sum([Tokens.Of(10), Tokens.Of(20)]));
}

[Fact]
public void Of_rejects_a_negative_token_count()            // negative — trips the assertion
{
    var ex = Assert.Throws<InvariantViolationException>(() => Tokens.Of(-1));
    Assert.Contains("must be >= 0", ex.Message);
    Assert.Contains("-1", ex.Message);                     // the offending value is carried
}

[Fact]
public void TryParse_reports_an_over_long_id_as_a_failure() // failure channel, not an assertion
{
    Assert.False(AccountId.TryParse(new string('x', 65), out var id));
    Assert.Null(id);
}
```

Assert on the type *and* on the distinguishing part of the message — a test that accepts any exception passes when the code throws for the wrong reason. Every named failure variant gets a test that produces it; every non-trivial assertion gets a test that trips it.

For the crash-only paths, put the assertion behind a seam so the test does not need process isolation: the failsafe takes an injected `Action<Exception>` terminator, and the test asserts it was called with the right exception rather than actually killing the runner.
