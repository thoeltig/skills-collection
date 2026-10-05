# Changelog

All notable changes documented here.
Format: [Common Changelog](https://common-changelog.org)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

## [1.1.0] - 2026-09-28

### Changed

- **Breaking:** run the `negative-space-programming` filter scripts directly with Node ≥ 22.18 (`node <skill-dir>/scripts/<filter>.ts`) instead of copying and compiling them; relative imports now end in `.ts`
- **Breaking:** collect C# coverage with xUnit v3 on Microsoft.Testing.Platform and `Microsoft.Testing.Extensions.CodeCoverage` instead of coverlet on VSTest
- Merge all Cobertura reports per class and method in `coverage.ts` and `crap.ts`, so a gap is reported once instead of once per test project and target framework
- Fold compiler-generated classes into their declaring class and name lambdas and async state machines readably in coverage and CRAP findings
- Accept result directories as input for `coverage.ts` and `crap.ts`
- Collect TypeScript coverage with `c8 --reporter=cobertura`

### Added

- Add xUnit v3 test project setup to `csharp.md`: `global.json` runner, packages, fixture libraries, root `.editorconfig` section for `CA1707`/`CA2007` in test projects
- Add xUnit v3 test rules to `csharp.md`: `TestContext.Current.CancellationToken`, `ValueTask` lifecycle, conditional skips
- Add `node:test` tests for the Cobertura reader, `coverage.ts`, `crap.ts` and `dotnet-build.ts`
- Add `scripts/package.json` so the scripts load as ES modules under any parent `package.json`

### Fixed

- Fix `dotnet-build.ts` dropping project-level diagnostics without a position (`NU*`, `MSB*`) and reporting only an exit code
- Fix the documented Node coverage reporter: Node's test runner writes lcov, not Cobertura
- Fix the claim that coverlet is the only C# source of per-method complexity

## [1.0.1] - 2026-09-19

### Added

- Add some findings and learned lessons from real work to the `negative-space-programming` skill which should close some minor gaps

## [1.0.0] - 2026-09-15

_First release._

### Added

- Add `negative-space-programming` skill

[unreleased]: https://github.com/thoeltig/skills-collection/compare/Development_v1.1.0...HEAD
[1.1.0]: https://github.com/thoeltig/skills-collection/compare/Development_v1.0.1...Development_v1.1.0
[1.0.1]: https://github.com/thoeltig/skills-collection/compare/Development_v1.0.0...Development_v1.0.1
[1.0.0]: https://github.com/thoeltig/skills-collection/releases/tag/Development_v1.0.0
