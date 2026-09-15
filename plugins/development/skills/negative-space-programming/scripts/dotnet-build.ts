/**
 * .NET build filter. Runs `dotnet build` with warnings as errors and reports CS/CA diagnostics.
 *
 * `-tl:off` disables the terminal logger, which rewrites lines in place and makes output
 * unparseable. `-v:m` is the lowest verbosity that still prints one `->` line per built project,
 * which supplies the checked count.
 *
 * msbuild repeats a diagnostic once per project referencing the file, so identical findings are
 * de-duplicated: a shared file with one error must not be reported eleven times.
 *
 *   node dotnet-build.js [Solution.sln]
 */

import { assert, exitCode, isEntryPoint, render, type Finding, type ToolReport } from './contract.js';
import { reportRunFailure, runTool } from './run.js';

// path(line,col): error CS8602: message [C:\path\Project.csproj]
// The trailing project is matched so it is stripped from the detail, but it is NOT counted: msbuild
// names it by full .csproj path while `->` lines use the short name, so mixing the two double-counts.
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (?:error|warning) ([A-Z]+\d+): (.*?)(?:\s\[(?:.+?)\])?$/;
const BUILT_PROJECT = /^\s*(\S+) -> \S+/;

export interface BuildParse {
  readonly findings: readonly Finding[];
  readonly checked: number;
}

export function parseBuild(output: string): BuildParse {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const projects = new Set<string>();

  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;

    if (!line.includes('): ')) {
      const built = BUILT_PROJECT.exec(line);
      if (built !== null) projects.add(built[1] as string);
      continue;
    }

    const match = DIAGNOSTIC.exec(line.trim());
    if (match === null) continue;

    const [, file, lineNumber, column, code, detail] = match;
    assert(file !== undefined && lineNumber !== undefined, `malformed msbuild diagnostic: ${line}`);

    const key = `${file}:${lineNumber}:${column}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      file,
      line: Number(lineNumber),
      column: Number(column ?? '0'),
      code: code ?? 'CS',
      detail: (detail ?? '').trim(),
    });
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
