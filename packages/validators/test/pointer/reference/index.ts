import type { PointerSut } from '../../../src/ladders/pointer/sut/port';
import { cutText } from './cut';
import { referenceLinks } from './links';
import { scanEstate } from './scan';
import { referenceStack } from './stack';

/**
 * The reference reader: a test-only implementation of the bank's port, written from docs/estate-pointer-reader.md,
 * that the bank's items must pass. It proves the items satisfiable and is the base of the planted-bug variants.
 * It is not the pointer reader and it ships nowhere.
 */
export function referenceSut(): PointerSut {
  return {
    name: 'reference',
    async cut(file) {
      return cutText(file.text);
    },
    async scan(request) {
      return scanEstate(request);
    },
    links: referenceLinks,
    stack: referenceStack,
  };
}

export default referenceSut;
