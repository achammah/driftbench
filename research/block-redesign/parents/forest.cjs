// Builds the parent forest (trie collapse) of a spec directory.
// Usage: NODE_PATH=<dir with yaml> node forest.cjs <specs dir> <out.json>
// Chain key: the spec Given/kind/target, then each block's When, Given and Then (expect), in order.
// A block shared by two or more specs with the same chain becomes one trie node (a stem block, emitted once).
const { parse } = require('yaml');
const fs = require('node:fs');
const path = require('node:path');

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') ? [path.join(d, e.name)] : [],
  );
}

function loadSpecs(root) {
  const specs = [];
  for (const f of walk(root).sort()) {
    let s;
    try {
      s = parse(fs.readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    if (s && Array.isArray(s.blocks)) specs.push({ file: path.relative(root, f), spec: s });
  }
  return specs;
}

function buildForest(specs) {
  const nodes = []; // {id, parent, depth, key, specIds:[], blockId, spec0, idx0}
  const byKey = new Map();
  const roots = new Map(); // root key -> node ids
  const paths = []; // per spec: list of node ids
  specs.forEach(({ spec }, si) => {
    let key = JSON.stringify([spec.given ?? null, spec.kind, spec.target ?? null]);
    let parent = -1;
    const p = [];
    spec.blocks.forEach((b, i) => {
      key += '|' + JSON.stringify([b.when, b.given ?? null, b.expect ?? null]);
      let id = byKey.get(key);
      if (id === undefined) {
        id = nodes.length;
        nodes.push({ id, parent, depth: i, specIds: [], firstSpec: spec.id, blockId: b.id, blockIndex: i });
        byKey.set(key, id);
      }
      nodes[id].specIds.push(si);
      p.push(id);
      parent = id;
    });
    paths.push(p);
  });
  return { nodes, paths };
}

module.exports = { loadSpecs, buildForest };

if (require.main === module) {
  const [root, out] = process.argv.slice(2);
  const specs = loadSpecs(root);
  const { nodes, paths } = buildForest(specs);
  const blocks = specs.reduce((n, s) => n + s.spec.blocks.length, 0);
  const summary = {
    specs: specs.length,
    blocks,
    trieNodes: nodes.length,
    repeatedBlocks: blocks - nodes.length,
    treeRoots: nodes.filter((n) => n.parent === -1).length,
    maxDepth: Math.max(...nodes.map((n) => n.depth)) + 1,
  };
  console.log(summary);
  if (out)
    fs.writeFileSync(
      out,
      JSON.stringify({ summary, specIds: specs.map((s) => s.spec.id), paths, nodes }, null, 0),
    );
}
