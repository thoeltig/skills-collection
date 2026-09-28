import { test } from 'node:test';
import expect from 'node:assert/strict';

import { render } from './contract.ts';
import { parseBuild } from './dotnet-build.ts';

const LOCATED = String.raw`C:\src\Shared\Tokens.cs(12,9): error CS8602: Dereference of a possibly null reference. [C:\src\App\App.csproj]`;

test('reports a located diagnostic once although every referencing project repeats it', () => {
  const output = [LOCATED, LOCATED.replace('App\\App.csproj', 'Api\\Api.csproj'), '  App -> C:\\src\\App\\bin\\App.dll'].join('\n');

  const { findings, checked } = parseBuild(output);

  expect.equal(checked, 1);
  expect.deepEqual(findings, [
    { file: String.raw`C:\src\Shared\Tokens.cs`, line: 12, column: 9, code: 'CS8602', detail: 'Dereference of a possibly null reference.' },
  ]);
});

test('reports project-level NuGet errors from a localized SDK, one per distinct message', () => {
  const project = String.raw`C:\src\Bench\Bench.csproj`;
  const conflict = (dependency: string) =>
    `${project} : error NU1608: Warnung als Fehler: "Workspaces 4.5.0" erfordert ${dependency} (= 4.5.0). [C:\\src\\App.sln]`;
  const output = [conflict('Common'), conflict('CSharp'), conflict('Common')].join('\n');

  const { findings } = parseBuild(output);

  expect.equal(findings.length, 2);
  expect.deepEqual(findings.map((finding) => [finding.file, finding.line, finding.code]), [
    [project, 0, 'NU1608'],
    [project, 0, 'NU1608'],
  ]);
  expect.match(findings[1]?.detail ?? '', /CSharp/);
});

test('reports tool-level errors that name no file', () => {
  const { findings } = parseBuild('MSBUILD : error MSB1009: Project file does not exist.');

  expect.deepEqual(findings, [{ file: 'MSBUILD', line: 0, code: 'MSB1009', detail: 'Project file does not exist.' }]);
});

test('renders a finding without position as the file alone, not as file:0', () => {
  const output = render({ tool: 'dotnet-build', checked: 0, findings: [{ file: 'MSBUILD', line: 0, code: 'MSB1009', detail: 'x' }] });

  expect.match(output, /^  MSBUILD  \[MSB1009\] x$/m);
});

test('ignores ordinary build chatter', () => {
  const { findings, checked } = parseBuild('Determining projects to restore...\nBuild succeeded.\n    0 Warning(s)');

  expect.deepEqual(findings, []);
  expect.equal(checked, 0);
});
