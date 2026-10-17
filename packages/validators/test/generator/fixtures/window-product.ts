import { generateSuiteToDisk as real } from '@agent-nexus/driftbench-generate';

// A product that fails the earlier absolute 10x budget by a margin: after its second generation it spends CPU
// time until the process has used DRIFTBENCH_PLANT_WINDOW_MS of it (33000 by default). With the work before and
// after the generations, the scale child's window then reads about 31 to 39 s. The suite is unchanged.
const cpu = () => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};
let calls = 0;

export const generateSuiteToDisk: typeof real = (prepared, options) => {
  const result = real(prepared, options);
  calls += 1;
  if (calls === 2) {
    const target = Number(process.env.DRIFTBENCH_PLANT_WINDOW_MS ?? 33_000);
    let spent = 0;
    while (cpu() < target) for (let index = 0; index < 10_000; index += 1) spent += Math.sqrt(index);
    if (spent < 0) throw new Error('unreachable');
  }
  return result;
};
