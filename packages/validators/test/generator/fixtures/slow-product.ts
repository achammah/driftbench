import { generateSuiteToDisk as real } from '@agent-nexus/driftbench-generate';

// A product twice as slow: the disk API does its work, then spends the same CPU time again, so the suite is
// the same and only the cost doubles. The harness and the reference unit are untouched.
const cpu = () => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};

export const generateSuiteToDisk: typeof real = (prepared, options) => {
  const started = cpu();
  const result = real(prepared, options);
  const end = cpu() + (cpu() - started);
  let spent = 0;
  while (cpu() < end) for (let index = 0; index < 10_000; index += 1) spent += Math.sqrt(index);
  return spent < 0 ? result : result;
};
