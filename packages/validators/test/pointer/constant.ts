import { constant } from '../../src/ladders/pointer/kit/labellers';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference';

// Compute one correct, nonempty answer once, then ignore every caller's input.
// Children import this same module and receive the same fixed answer.
const reference = referenceSut();
const fixture = {
  path: 'constant-fixture.md',
  text: 'Preserve the copper ledger beside the wooden cabinet after the shift ends.',
};
const cut = reference.cut(fixture);
const scan = reference.scan({ files: [fixture], labeler: constant('rule') });

export default {
  name: 'constant-nonempty-reader',
  cut: async () => structuredClone(await cut),
  scan: async () => structuredClone(await scan),
} satisfies PointerSut;
