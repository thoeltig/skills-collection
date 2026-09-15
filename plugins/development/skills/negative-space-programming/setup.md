# Full setup

Everything needed to make the three layers in `SKILL.md` real: the compiler enforces what it can, assertions cover what remains, tests verify both — and **every channel reports in a form a reader can act on**. A layer nobody can see the output of is not a layer.

## Scopes

The same toolchain in three places. Pick by what the machine already has; the configuration is identical in all three.

| Scope | Use when | Section |
|---|---|---|
| **Local** | the machine has the SDKs already | §2, §3 |
| **CI** | gating merges | §7 |
| **Container** | the machine lacks a tool, or you want CI parity locally | §6 |

## 1. The output contract

**Read this before any tool config.** Every tool in this document is wrapped so its output obeys one shape. This is not cosmetic: a reader given `point 1 ok / point 2 ok / point 3 fail` has to find point 3. A reader given only point 3 is already working.

> **One tally line. Then failures only. Each failure carries its location and the single
> distinguishing detail. Success produces no body at all.**

The reference implementation is a `node:test` reporter — the shape every other filter copies:

```
✓ 412 passed  ~ 3 skipped  ✖ 2 failed

✖  rejects a negative token count (pricing.test.ts:48-12)
`expect.throws(() => tokens(-1), InvariantViolation);`
error: tokens.count must be a finite number >= 0, got -1

✖  totals an order deterministically (pricing.test.ts:71-5)
`expect.equal(priceOrder(lines), 24.5);`
returned: 24.499999999999996
```

Four properties, all load-bearing:

1. **The tally is one line**, so a clean run costs one line of attention.
2. **Passes are never itemised.** On success the body is empty and the function returns early.
3. **Each failure resolves to `file:line-column`** in the *source*, not the build output. For TypeScript that requires `--enable-source-maps`; without it every location points at `dist/`.
4. **The source line is echoed**, then either what came back (`returned:`) or what was thrown (`error:`) — never both, never a full stack.

Every filter in §3 implements this. A tool whose raw output does not fit it gets a filter, not an exception.

---

## 2. Per-language setup

**Nothing language-specific lives in this file.** Each language file carries its own toolchain, and
adding a language means adding one file rather than editing this one. That is the whole reason the
split exists: language count must not be a structural property of the skill.

| Language | File |
|---|---|
| C# | `csharp.md` |
| TypeScript | `typescript.md` |

### What a language file provides

1. **Project settings** — compiler and analyzer configuration, with version floors where a flag is newer than the language's common baseline.
2. **Lint configuration** — the required rule set, and how to confirm type-aware rules are actually firing rather than silently loaded.
3. **Dependencies** — the packages the toolchain needs, and what each one buys.
4. **The assert helper** — full source, using whatever the language offers to narrow types at the call site (`asserts condition`, `[DoesNotReturnIf(false)]`, or the local equivalent).
5. **What the build actually reports** — measured, not assumed: which diagnostics reach the build, which reach only a separate analyser, and which reach nothing.
6. **Illegal states** — branded or wrapper types, closed unions, exhaustiveness, and the language's escape hatches from each.
7. **The failure type** — how `Result` or its equivalent is expressed.
8. **Boundary and failsafe** — the wrapper idiom and the top-level handler registration.
9. **Tests** — the runner idiom for asserting on both error type and message.
10. **Verification cases** — the language's half of the §5 checklist: code that must fail to compile or lint, and the exact diagnostic each case must produce.

## 3. Filter scripts

TypeScript, not shell: cross-platform, type-checked by the same compiler as the code, and runnable by the Node the project already requires. Thin `npm` scripts are the entry points.

`scripts/` in this skill folder ships them. Copy the folder into the project and compile it with the rest of the source — the imports use `.js` extensions, so they run from the build output, the same way the `test` script in `typescript.md` runs the compiled tests.

| File | Status | Input → output |
|---|---|---|
| `contract.ts` | verified | `Finding` / `ToolReport`, `render`, `exitCode`, `collapseRanges`, `isEntryPoint`, and the filters' own `assert` — the scripts are standalone and do not import the project's |
| `run.ts` | verified | the external boundary — one child process per call → named state |
| `tsc.ts` | verified end to end | `tsc --noEmit --listFiles` → errors with `file:line-col` |
| `coverage.ts` | verified | Cobertura XML → uncovered regions, never a percentage |
| `crap.ts` | verified | Cobertura XML → methods scoring above 30 |
| `dotnet-build.ts` | parser verified | msbuild log → CS/CA diagnostics, de-duplicated |
| `eslint.ts` | parser verified | `eslint --format=json` → findings with rule id |
| `inspectcode.ts` | **parser only, unverified** | `jb inspectcode` SARIF → issues at warning and above |

Adding a language adds a row here and a filter in `scripts/`. That is a catalogue entry, not a change to how the pipeline is shaped.

`inspectcode.ts` follows JetBrains' documented SARIF contract and is exercised against a synthetic sample, but has never seen real `jb` output — confirm the shape on first run in the container. The rest were run against real tool output or against captured samples of it.

### InspectCode specifics

Four things that are easy to get wrong, all from JetBrains' own documentation:

- **SARIF is the default output, not XML.** It has been since 2024.1, and the XML format is documented as heading for deprecation. Omit `--format` entirely and read the `.json`; do not target `-f=xml` in new work.
- **Severity is an override, not a property of the issue.** A result carries its own level *only when it differs from its rule's* — which happens when some projects in the solution set `TreatWarningsAsErrors` and others do not. Read the rule table first and join by id, or every unoverridden issue silently gets the wrong severity. The same rule governs the XML `Severity` attribute.
- **It restores and builds the solution by default.** That is a real cost in a pipeline that has already built, so pass `--no-build` there; passing `--build` explicitly silences the warning when you do want it. The exception: solutions with source generators need InspectCode's own build to analyse correctly.
- **Paths are relative to the solution file**, while `tsc` reports relative to the working directory. In a mixed pipeline that is two different anchors in one report. Either pass `--absolute-paths` (`-a`) and normalise, or state the anchor in the step name.

The default minimum severity is SUGGESTION and above; `-e=WARNING` raises it, which is what these scripts use. `--verbosity=ERROR` keeps the tool's own chatter out of the output.

### Two platform constraints the scripts work around

Both were found by running them, and both silently break a naive implementation:

- **Never invoke an npm tool through `npx` or `node_modules/.bin`.** On Windows those are `.cmd` shims, and Node refuses to spawn `.cmd` without a shell (the CVE-2024-27980 mitigation, surfacing as `EINVAL`) while `shell: true` is deprecated for argument passing (DEP0190) precisely because it concatenates rather than escapes. Both doors are shut. `run.ts` resolves the package's real entry script and runs it under `process.execPath` instead — no shell, no shim, identical on every platform.
- **Package resolution anchors to `process.cwd()`, not to the script.** The filters check the project you are in, which may not be where the scripts are installed.

**Cobertura is why one parser serves both languages:** coverlet (`dotnet test --collect:"XPlat Code Coverage"`) and c8/istanbul (`--reporter=cobertura`) both emit it. Note the asymmetry — coverlet writes a `complexity` attribute per method and istanbul does not, so CRAP on TypeScript needs complexity from the ESLint `complexity` rule instead. `crap.ts` detects the missing data and exits 2 rather than reporting a meaningless all-clear.

Verified output, the shape every filter produces:

```
✓ coverage: 1 checked, 0 findings

✖ coverage: 2 checked, 1 findings
  src/rates/pricing.ts:11  [uncovered] uncovered: 11-13, 40 (Rates.Pricing)

✖ crap: 3 checked, 1 findings
  src/big.cs:20  [CRAP] 110 for Orchestrate (complexity 10, coverage 0%) — prefer splitting over adding tests
```

The `N checked` count is not decoration: it is what makes a **silent no-op visible**. A filter pointed at the wrong path, or at a format it cannot parse, would otherwise print `0 findings` and look exactly like success. Every filter also asserts it found the structure it expected, so a format change fails loudly.

Rules for writing a filter:

- **Never print a passing item.** If `findings` is empty the output is the tally line and nothing else.
- **One line of detail per finding**, plus at most the echoed source line. No stack traces, no XML fragments, no "analysing project 3 of 11".
- **Bound the output.** Cap findings at a stated number (100 is a reasonable default) and print `…and N more` when the cap is hit. A 4,000-issue first run must not become 4,000 lines; that is the *state the limit before you find it* rule applied to the tooling.
- **Exit non-zero when `findings` is non-empty.** The filter is the gate, not a viewer.
- **Sort deterministically** — file, then line, then code — so two runs over unchanged code produce byte-identical output and a diff means something changed.
- **Report the count of units examined**, so a filter that silently parsed nothing is visible.
- **Assert the input shape.** A parser that finds nothing looks identical to a clean run; that is the skill's own *silent wrongness needs a check* rule applied to the tooling itself.
- **An advisory filter never returns 1.** Findings exit 0; it still exits 2 when it could not run, which is the rule below and holds for every filter. `crap.ts` is the only advisory one and says so in a comment; everything else gates.
- **Guard `main` with `isEntryPoint(import.meta.url)`.** A module-level call runs on *import*, which spawns the tool and sets an exit code the moment a test imports the parser — making the parser untestable, which is the one thing a filter must not be.
- **Separate "could not run" from "ran and found nothing."** A missing tool, a timeout, or an exit code with no parseable output exits **2**; findings exit **1**; clean exits **0**. Collapsing the first into the last reports a broken toolchain as a healthy codebase.

---

## 4. Coverage, CRAP and mutants

All three are instruments pointed at existing rules. None of them introduces a new one.

### Coverage → the X + Y floor

- **C#:** `dotnet test --collect:"XPlat Code Coverage"` — coverlet, Cobertura by default, and the only C# source that carries the per-method `complexity` attribute `crap.ts` needs.
- **TypeScript:** `node --test --experimental-test-coverage --test-coverage-reporter=cobertura` (Node 22+), or c8 / istanbul with `--reporter=cobertura`.

Both filters in §3 read Cobertura and nothing else. Both commands above ship with the SDK, need no licence and no extra tooling — which is the point: a coverage tool emitting any other format costs a second parser before it reports anything.

Read it as a *locator*, never as a score. An uncovered line is either a logic step with no test or an assertion that has never been tripped — both are X + Y floor violations with a file and a line attached. The filter reports uncovered regions; it does not report a percentage, because a percentage cannot be acted on and invites gaming.

### CRAP → function shape

```
CRAP(m) = complexity(m)^2 * (1 - coverage(m))^3 + complexity(m)
```

The conventional critical threshold is **30**. Useful anchors:

| Complexity | Coverage | CRAP |
|---|---|---|
| 5 | 100% | 5 |
| 5 | 0% | 30 — exactly at the line |
| 10 | 100% | 10 |
| 10 | 50% | 22.5 |
| 10 | 0% | 110 |

Two ways to get under the threshold, and **the default answer is the first**:

1. **Split the method.** Complexity above roughly 10 means it owns more than one decision, which is the function-shape rule in `SKILL.md` firing. Pushing `if`s up and `for`s down lowers complexity and lowers the floor at the same time.
2. **Add tests.** Correct only when the complexity is genuinely irreducible — a real state machine, a parser table. Adding tests to keep a bloated method under the line is gaming the metric.

CRAP is advisory, not a merge gate. It points at candidates; a human decides whether the complexity is essential. Gating on it rewards whichever of the two fixes is cheaper, which is the wrong one.

### Mutation → the X + Y floor, verified

**Optional. The reasoning is the part worth keeping even if the tool never runs.**

Coverage proves a line executed. It cannot prove anything was checked while it executed, so a test that asserts nothing at all reports the same full coverage as a test that pins every value. Mutation testing closes that gap: the tool edits the source — a comparison operator flips, a condition becomes a constant, an arithmetic operator changes — reruns the suite, and reports every edit the suite failed to notice. A surviving mutant is a change in behaviour that no test objected to.

That lands on two rules this skill already states and currently holds by discipline alone:

| Rule in `SKILL.md` | The mutant that checks it |
|---|---|
| one test per assertion, which *trips* it | the mutant that makes the assertion's condition always true — it survives exactly when nothing ever trips that assertion |
| add the inverses, so the bound is known to be `>=` and not `>` | the boundary mutant `>=` → `>` — killed only by the test that accepts the value sitting on the bound |

The second row is the reason to know about this at all. An off-by-one inside an assertion silently narrows what a function accepts; the narrowed function still passes every test written against it, and the line reads as fully covered throughout. The inverse test is the only thing that catches it, and a surviving boundary mutant is the only mechanical signal that the inverse test is missing.

**Advisory, never a gate**, for the same reason CRAP is. An equivalent mutant — one whose edit does not change behaviour — cannot be killed by any test, so a score below 100 is not evidence of a missing test. Gating on the score buys tests written to kill mutants rather than to state intent. Read the surviving mutants; ignore the percentage. No filter for it ships in §3: the output contract exists to make gates readable, and this is not one, so its own HTML report is the artefact.

**Stryker** covers both languages here — one project with an implementation for each, added with `npm init stryker@latest` or `dotnet tool install -g dotnet-stryker`. Use the npm initializer rather than installing the core package by hand: StrykerJS needs a runner plugin matching the project's test runner, and the initializer asks which runner and installs the matching plugin, so the one mistake that produces a tool which runs and mutates nothing cannot be made silently. It is a real dependency and a slow run, so it earns its place the way every other tool does.

Two things to settle before the first run, both of which otherwise bury the findings in noise:

- **Bound the run.** The cost is the mutant count times the suite runtime, and the mutant count tracks code size. Scope the mutated set to the modules whose logic carries the risk, and treat a whole-repository run as a scheduled job rather than a development loop — *state the bound before you find it*, applied to the tooling.
- **Assertion messages mutate too.** A message is a string literal, and only the fragment a test matches on is protected; every other character becomes a mutant nothing can kill. Disable the string mutators, or the report is mostly message noise.

---

## 5. Confirm the setup is live before relying on it

**The most important section here, and it is a checklist rather than a build step.** Every layer has a silent failure mode where it is configured, reports nothing, and enforces nothing — a type-aware lint rule loaded without type information, an analyser whose findings never reach the build, an assertion stripped from the release build, a compiler run over a glob that matches nothing.

In every case the run is green. **Green is exactly what a broken layer looks like.** So every case below is written to *fail*, and what you are confirming is that it does.

Work through it once, by hand, before writing the code these layers are supposed to protect: paste the case into a file, run the tool, check that the diagnostic is the expected one. It costs minutes, and it is what separates a guarantee from an assumption — the assertions you skip and the tests you do not write are both priced on these layers working.

### The categories

Language-agnostic. Each language file supplies the concrete cases and the exact diagnostics they must produce — item 10 of the contract in §2.

| # | The case | Proves |
|---|---|---|
| 1 | use a possibly-absent value with no guard | the nullability analysis is on |
| 2 | the same use, after an assertion — **must produce nothing** | the assertion narrows the type |
| 3 | index a collection without checking the result | unchecked-index analysis is on |
| 4 | pass a raw primitive where a branded type is required | brands are not structurally erased |
| 5 | give an optional property an explicit empty value | exact-optional analysis is on |
| 6 | add a union variant and leave it unhandled | exhaustiveness is enforced |
| 7 | write a condition the type already guarantees | **type-aware linting is genuinely running** |
| 8 | leave an async call unobserved | type-aware rules reach async code |
| 9 | import a wrapped dependency outside its wrapper | wrapper ownership holds |
| 10 | trip an assertion in a **release** build | assertions were not stripped |

Cases 7 and 10 catch real misconfiguration most often: 7 because a lint config without type information loads the valuable rules and silently never fires them, and 10 because a build that strips assertions is a different program from the one that was tested. Case 2 is the only one that must produce *nothing* — it fails the check by erroring, not by passing.

Work through it again after any toolchain or dependency-version change, and any time you are about to lean on a layer you have not actually watched fire. A layer confirmed once and then silently disabled by a version bump is worse than one never configured, because the assertions and the tests were both sized on the assumption it was working.

**Keep the cases instead of rewriting them.** Check them into `verify/`, excluded from the normal build, and every rerun is reading a file rather than writing one. Add a case whenever a toolchain surprise costs you an afternoon, and the checklist grows into this project's own failure history rather than staying the generic ten.

Nothing here is automated by default — these cases pass by failing, so a CI job means an inverted build that also tracks diagnostic codes across tool versions. Checked-in cases are what make that a later decision rather than a rewrite: wiring them up is then a runner that compiles or lints each file and fails if any of them succeeds. Case 7 is usually the one worth automating first, since a lint config that silently stops firing is the failure the rest of the layers are priced on.

---

## 6. Container scope

One way to get every channel at once on a machine that lacks the tools — not a prerequisite. The configuration in sections 2 and 3 is identical inside and outside.

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS toolchain

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV PATH="${PATH}:/root/.dotnet/tools"
RUN dotnet tool install --global JetBrains.ReSharper.GlobalTools \
 && dotnet tool install --global dotnet-stryker

WORKDIR /workspace
```

Mount the source rather than copying it, so edits apply without a rebuild:

```
docker run -it -v "$(pwd)":/workspace toolchain /bin/bash
```

The ReSharper command line tools are free and run on Linux, which is why they are worth adding here. `dotnet-stryker` is installed for the same reason and is the optional §4 instrument: with it in the image a scheduled pipeline can produce a mutation report without any developer machine carrying the tool. Nothing else in this document needs a licence: coverage comes from the SDK's own collector, and every filter in §3 reads formats those free tools already emit.

---

## 7. CI scope

Order matters — each step is cheaper than the next and its failures are easier to read, so a break is reported by the most specific tool that can see it.

| # | Step | Gates? |
|---|---|---|
| 1 | format check | yes |
| 2 | `tsc --noEmit` / `dotnet build` with warnings as errors | yes |
| 3 | `eslint` (typed) / `jb inspectcode` | yes |
| 4 | tests, with the compact reporter | yes |
| 5 | coverage — uncovered regions listed | yes |
| 6 | CRAP — methods over threshold listed | **no**, advisory |
| 7 | mutation — surviving mutants listed | **no**, optional and advisory; scheduled, not per push |

§5 is not in this table. It is run by hand at setup and after a toolchain change, because its cases pass by failing.

Every gating step runs through its filter from §3, so a failing pipeline produces a handful of located findings rather than several thousand lines of tool output.

**Run each step even when an earlier one failed**, then report all of them together. Stopping at the first failure turns one push into five, each revealing the next problem. This is the same rule as *where a run processes many independent records, nothing is dropped silently* — applied to the pipeline itself.

`jb inspectcode` takes minutes on a large solution. If that is too slow for every push, move step 3's ReSharper half to pre-merge or nightly and keep the compiler and ESLint halves on every push. Say so explicitly in the pipeline; a check people believe is running on every push, but is not, is the same silent-green failure as §5.
