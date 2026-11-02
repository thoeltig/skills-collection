/**
 * Runs the configured steps through the negative-space-programming filters. Every step runs even
 * when an earlier one failed: `dotnet test` builds on its own, and a test step that cannot run
 * reports why instead of being silently skipped.
 */
import type { CheckResult } from '../skills/negative-space-programming/scripts/contract.ts';
import { checkBuild } from '../skills/negative-space-programming/scripts/dotnet-build.ts';
import { checkDotnetTest } from '../skills/negative-space-programming/scripts/dotnet-test.ts';
import { checkNodeTest } from '../skills/negative-space-programming/scripts/node-test.ts';
import { checkTsc } from '../skills/negative-space-programming/scripts/tsc.ts';
import type { Step, StepKind, ToolName } from './config.ts';

export interface StepOutcome {
  readonly tool: ToolName;
  readonly kind: StepKind;
  readonly result: CheckResult;
}

export type StepRunner = (step: Step, root: string) => CheckResult;

export const runStep: StepRunner = (step, root) => {
  const timeoutMs = step.timeoutSeconds * 1000;
  switch (step.tool) {
    case 'dotnet-build':
      return checkBuild(step.args[0], root, timeoutMs);
    case 'tsc':
      return checkTsc(step.args[0], root, timeoutMs);
    case 'dotnet-test':
      return checkDotnetTest(step.args, root, timeoutMs);
    case 'node-test':
      return checkNodeTest(step.args, root, timeoutMs);
  }
};

export function runSteps(steps: readonly Step[], root: string, runner: StepRunner = runStep): StepOutcome[] {
  return steps.map((step) => ({ tool: step.tool, kind: step.kind, result: runner(step, root) }));
}
