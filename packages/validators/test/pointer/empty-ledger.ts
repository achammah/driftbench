import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference';

/** A working reader except that its public ledger loses every source witness. */
const reference = referenceSut();
export default {
  ...reference,
  name: 'empty-ledger',
  async scan(request) {
    const result = await reference.scan(request);
    return { ...result, ledger: { raw: '{}', entries: [] } };
  },
} satisfies PointerSut;
