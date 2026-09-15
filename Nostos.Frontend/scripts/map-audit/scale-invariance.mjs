/**
 * Scale-invariance check for the Obsidian force set.
 *
 * The force ratios are what determine the SHAPE of the settled layout; the
 * absolute length unit only sets its size. Since the camera fit is uniform, a
 * self-similar layout should produce IDENTICAL on-screen nearest-neighbour
 * distances at any length scale S — meaning S is free, and Obsidian's literal
 * constants (250/60/1000, i.e. S=1) are as good as any rescaled set.
 *
 * This script proves or disproves that, instead of assuming it, then reports the
 * on-screen crowding for the constants we intend to ship.
 *
 * Usage: node scripts/map-audit/scale-invariance.mjs /tmp/gp-graph.json
 */
import { readFileSync } from 'node:fs';
import { forceSimulation, forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force';

const file = process.argv[2] ?? '/tmp/gp-graph.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

/* Obsidian 1.13.7 defaults (docs/obsidian-graph-physics.md). */
const OBS = {
  linkDistance: 250,
  collideRadius: 60,
  collideStrength: 0.5,
  repelStrength: 1000,   // slider 10 -> e*e*e
  distanceMin: 30,
  centerStrength: 0.1,
  velocityDecay: 0.6,
};

const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 16;
const FIT_OCCUPANCY = 0.88;

const usages = data.nodes.map((n) => Math.max(0, n.usageCount));
const minUsage = Math.min(...usages);
const maxUsage = Math.max(...usages);
const usageRange = Math.max(1, maxUsage - minUsage);

function hashSeed(v) {
  let h = 2166136261;
  for (let i = 0; i < v.length; i += 1) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/** Obsidian's own seeding: new nodes on a jittered ring, or beside placed neighbours. */
function seed(nodes, linkDistance, S) {
  const I = nodes.length;
  const L = 60 * I * 60;
  const O = Math.sqrt(L / Math.PI);
  const F = Math.sqrt(L);
  for (const n of nodes) {
    const angle = 2 * Math.PI * hashSeed(`${n.id}:a`);
    const r = (linkDistance + Math.sqrt(hashSeed(`${n.id}:r`)) * O) * S;
    n.x = r * Math.cos(angle);
    n.y = r * Math.sin(angle);
    void F;
  }
}

function run(stageW, stageH, S, centerStrength = OBS.centerStrength) {
  const nodes = data.nodes.map((n) => {
    const ratio = (Math.max(0, n.usageCount) - minUsage) / usageRange;
    return {
      id: n.id,
      size: NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio),
      x: 0, y: 0,
    };
  });
  seed(nodes, OBS.linkDistance, S);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.edges.filter((e) => byId.has(e.sourceId) && byId.has(e.targetId))
    .map((e) => ({ source: e.sourceId, target: e.targetId }));

  const sim = forceSimulation(nodes)
    .velocityDecay(OBS.velocityDecay)
    .alphaDecay(1 - Math.pow(0.001, 1 / 300))
    .alphaTarget(0)
    .force('x', forceX(0).strength(centerStrength))
    .force('y', forceY(0).strength(centerStrength))
    .force('link', forceLink(links).id((d) => d.id).distance(OBS.linkDistance * S).strength(1))
    .force('charge', forceManyBody().strength(-OBS.repelStrength * S).distanceMin(OBS.distanceMin * S))
    .force('collide', forceCollide().radius(OBS.collideRadius * S).strength(OBS.collideStrength));
  sim.alpha(0.3);
  let ticks = 0;
  while (sim.alpha() > 0.001 && ticks < 5000) { sim.tick(); ticks += 1; }
  sim.stop();

  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const scale = Math.min((stageW * FIT_OCCUPANCY) / spanX, (stageH * FIT_OCCUPANCY) / spanY);
  const pts = nodes.map((n) => ({ x: n.x * scale, y: n.y * scale, r: n.size }));
  let overlaps = 0; const nn = [];
  for (let i = 0; i < pts.length; i += 1) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j += 1) {
      if (i === j) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < best) best = d;
      if (j > i && d < pts[i].r + pts[j].r - 0.001) overlaps += 1;
    }
    nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const screenSpanX = spanX * scale; const screenSpanY = spanY * scale;
  return {
    S,
    centerStrength,
    aspect: +(spanX / spanY).toFixed(2),
    fillX: +(screenSpanX / stageW).toFixed(3),
    fillY: +(screenSpanY / stageH).toFixed(3),
    minNN: +nn[0].toFixed(1),
    p25NN: +nn[Math.floor(nn.length * 0.25)].toFixed(1),
    medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
    overlaps,
  };
}

for (const [W, H] of [[990, 730], [369, 707]]) {
  console.log(`\n########## stage ${W}x${H} — on-screen metrics vs length scale S`);
  for (const S of [0.25, 0.5, 1, 2, 4]) {
    console.log(JSON.stringify(run(W, H, S)));
  }
}

console.log('\n########## centerStrength sweep at S=1, stage 990x730');
for (const c of [0.05, 0.1, 0.2, 0.35, 0.52]) {
  console.log(JSON.stringify(run(990, 730, 1, c)));
}
console.log('\n########## centerStrength sweep at S=1, stage 369x707');
for (const c of [0.05, 0.1, 0.2, 0.35, 0.52]) {
  console.log(JSON.stringify(run(369, 707, 1, c)));
}
