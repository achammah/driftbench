import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packages = [
  'core',
  'checks',
  'judges',
  'users',
  'adapters',
  'sandbox',
  'stats',
  'store',
  'report',
  'battery',
  'artifacts',
  'space',
  'generate',
  'estate',
  'validators',
  'vitest',
];

export default defineConfig({
  resolve: {
    alias: {
      // The Acme example package, which the CLI loads by name: its source, like the packages below.
      '@agent-nexus/driftbench-example-acme': fileURLToPath(
        new URL('./examples/acme/src/package.ts', import.meta.url),
      ),
      // The adapter contract suite, a second entry of the adapters package; listed before the package itself.
      '@agent-nexus/driftbench-adapters/contract': fileURLToPath(
        new URL('./packages/adapters/src/contract.ts', import.meta.url),
      ),
      ...Object.fromEntries(
        packages.map((name) => [
          name === 'cli' ? '@agent-nexus/driftbench' : `@agent-nexus/driftbench-${name}`,
          fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
        ]),
      ),
    },
  },
  test: {
    include: [
      'benchmarks/test/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      'tools/**/*.test.mjs',
      'tools/**/*.test.ts',
    ],
    environment: 'node',
    // Removes the temporary folders a test file made, when the file ends.
    setupFiles: ['./tools/vitest-temp-folders.ts'],
  },
});
