import { generateSuiteToDisk as real } from '@agent-nexus/driftbench-generate';

// A product quadratic in the suite it writes: after the real work it spends CPU time in proportion to the
// square of the specs written (DRIFTBENCH_QUADRATIC_US microseconds times specs squared, 1 by default), as a
// writer that compares every spec with every earlier one would. The suite itself is unchanged.
const cpu = () => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};

export const generateSuiteToDisk: typeof real = (prepared, options) => {
  const result = real(prepared, options);
  const perPair = Number(process.env.DRIFTBENCH_QUADRATIC_US ?? 1) / 1000;
  const end = cpu() + perPair * result.summary.specs * result.summary.specs;
  let spent = 0;
  while (cpu() < end) for (let index = 0; index < 10_000; index += 1) spent += Math.sqrt(index);
  return spent < 0 ? result : result;
};
