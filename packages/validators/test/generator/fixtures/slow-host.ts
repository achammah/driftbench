// A host three times slower: every CPU time this process reads is three times the real one. The scale child
// imports it as its generator module and the reference unit sampler imports it first, so the product, the
// harness and the unit all slow down together, as on a slower or busier machine.
const SLOWER = 3;
const real = process.cpuUsage.bind(process);
process.cpuUsage = (previous) => {
  const now = real();
  const user = now.user * SLOWER;
  const system = now.system * SLOWER;
  return previous ? { user: user - previous.user, system: system - previous.system } : { user, system };
};
