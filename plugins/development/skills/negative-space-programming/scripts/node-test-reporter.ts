/**
 * node:test custom reporter used by `node-test.ts`: one minified JSON line per failed test and one
 * for the run summary. Machine output for the filter, not for a reader.
 *
 *   node --test --test-reporter=<skill-dir>/scripts/node-test-reporter.ts --test-reporter-destination=stdout
 */
import { toRecord, type TestEvent } from './node-test.ts';

export default async function* reporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  for await (const event of source) {
    const record = toRecord(event);
    if (record !== undefined) yield `${JSON.stringify(record)}\n`;
  }
}
