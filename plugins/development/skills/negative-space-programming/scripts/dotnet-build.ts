/**
 * .NET build filter. Runs `dotnet build` with warnings as errors and reports every diagnostic:
 * located ones (CS/CA/IDE, `file(line,col)`) and project-level ones without a position (NuGet
 * `NU*`, `MSB*`, `CSC : error`), which would otherwise surface only as an unexplained exit code.
 *
 * `-tl:off` disables the terminal logger, which rewrites lines in place and makes output
 * unparseable. `-v:m` is the lowest verbosity that still prints one `->` line per built project,
 * which supplies the checked count.
 *
 * msbuild repeats a diagnostic once per project referencing the file, so identical findings are
 * de-duplicated: a shared file with one error must not be reported eleven times.
 *
 *   node dotnet-build.ts [Solution.sln]
 */

import { assert, exitCode, isEntryPoint, render, type Finding, type ToolReport } from './contract.ts';
import { reportRunFailure, runTool } from './run.ts';

// path(line,col): error CS8602: message [C:\path\Project.csproj]
// The trailing project is matched so it is stripped from the detail, but it is NOT counted: msbuild
// names it by full .csproj path while `->` lines use the short name, so mixing the two double-counts.
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (?:error|warning) ([A-Z]+\d+): (.*?)(?:\s\[(?:.+?)\])?$/;
// C:\path\Project.csproj : error NU1608: message [C:\path\App.sln]   |   MSBUILD : error MSB1009: message
// `error`/`warning` and the code stay English in localized SDKs; only the message is translated.
const PROJECT_DIAGNOSTIC = /^(.+?) : (?:error|warning) ([A-Z]+\d+): (.*?)(?:\s\[(?:.+?)\])?$/;
const BUILT_PROJECT = /^\s*(\S+) -> \S+/;

export interface BuildParse {
  readonly findings: readonly Finding[];
  readonly checked: number;
}

export function parseBuild(output: string): BuildParse {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const projects = new Set<string>();

  const add = (key: string, finding: Finding): void => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const located = DIAGNOSTIC.exec(line);
    if (located !== null) {
      const [, file, lineNumber, column, code, detail] = located;
      assert(file !== undefined && lineNumber !== undefined && code !== undefined, `malformed msbuild diagnostic: ${line}`);
      add(`${file}:${lineNumber}:${column}:${code}`, {
        file,
        line: Number(lineNumber),
        column: Number(column ?? '0'),
        code,
        detail: (detail ?? '').trim(),
      });
      continue;
    }

    const projectLevel = PROJECT_DIAGNOSTIC.exec(line);
    if (projectLevel !== null) {
      const [, file, code, detail] = projectLevel;
      assert(file !== undefined && code !== undefined, `malformed msbuild diagnostic: ${line}`);
      const text = (detail ?? '').trim();
      // No position to tell repeats apart, and one code often covers several distinct problems
      // (NU1608 per package), so the message is part of the identity.
      add(`${file}::${code}:${text}`, { file, line: 0, code, detail: text });
      continue;
    }

    const built = BUILT_PROJECT.exec(line);
    if (built !== null) projects.add(built[1] as string);
  }

  return { findings, checked: projects.size };
}

function main(argv: readonly string[]): number {
  const args = ['build', '--nologo', '-v:m', '-tl:off', '-p:TreatWarningsAsErrors=true'];
  const target = argv[0];
  if (target !== undefined) args.splice(1, 0, target);

  const run = runTool('dotnet', args);
  if (!run.ok) return reportRunFailure('dotnet-build', run);

  const { findings, checked } = parseBuild(`${run.stdout}\n${run.stderr}`);

  // A non-zero exit with nothing parseable means the invocation failed, not that the code is clean.
  if (run.status !== 0 && findings.length === 0) {
    process.stderr.write(
      `\u2716 dotnet-build: exited ${run.status} with no diagnostics\n${run.stdout.slice(0, 2000)}\n`,
    );
    return 2;
  }

  // Only meaningful on success: a failed build legitimately produces no `->` lines.
  if (run.status === 0) {
    assert(checked > 0, 'dotnet build succeeded having built 0 projects - wrong target?');
  }

  const report: ToolReport = { tool: 'dotnet-build', checked, findings };
  process.stdout.write(render(report));
  return exitCode(report);
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
