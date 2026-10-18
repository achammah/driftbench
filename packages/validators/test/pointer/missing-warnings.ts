import { referenceSut } from './reference';

/** The same product observation omission is used in every privacy child process. */
const reference = referenceSut();
export default {
  ...reference,
  name: 'missing-warning-observation',
  async scan(request: Parameters<typeof reference.scan>[0]) {
    const result = await reference.scan(request);
    delete result.warnings;
    return result;
  },
};
