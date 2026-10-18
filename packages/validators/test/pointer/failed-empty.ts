import empty from './empty';

/** Refusing every scan must not earn privacy or replay credit either. */
export default {
  ...empty,
  name: 'failed-empty-reader',
  scan: async () => ({ ...(await empty.scan()), ok: false, error: 'constant failure' }),
};
