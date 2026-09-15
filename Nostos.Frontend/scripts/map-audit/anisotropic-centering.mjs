/**
 * Can a portrait stage be filled LEGITIMATELY?
 *
 * The shipped code fills it by shearing settled coordinates per-axis (up to
 * 1.4x), which distorts the physics geometry itself — equal link lengths become
 * unequal on screen. This script tests the alternative: keep the physics
 * isotropic in its local structure (forceLink is isotropic regardless) and make
 * only the CONFINING potential anisotropic, by giving forceX and forceY
 * different strengths.
 *
 * Weaker gravity on an axis lets the cloud spread along it. Since the camera fit
 * is uniform, the settled aspect (spanX/spanY) is what decides how much of a
 * non-square stage gets used: fill on the tight axis is 0.88 and the other axis
 * gets 0.88 * min(1, stageAspect/graphAspect) on the wide side.
 *
 * Usage: node scripts/map-audit/anisotropic-centering.mjs /tmp/gp-graph.json
 */
import { readFileSync } from 'node:fs';
import { forceSimulation, forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force';

const file = process.argv[2] ?? '/tmp/gp-graph.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

const LINK_DISTANCE = 250;
const COLLIDE_RADIUS = 60;
const COLLIDE_STRENGTH = 0.5;
const REPEL_STRENGTH = 1000;
const DISTANCE_MIN = 30;
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

function run(stageW, stageH, cx, cy) {
  const N = data.nodes.length;
  const L = 60 * N * 60;
  const O = Math.sqrt(L / Math.PI);
  const nodes = data.nodes.map((n) => {
    const ratio = (Math.max(0, n.usageCount) - minUsage) / usageRange;
    const angle = 2 * Math.PI * hashSeed(`${n.id}:a`);
    const r = LINK_DISTANCE + Math.sqrt(hashSeed(`${n.id}:r`)) * O;
    return {
      id: n.id,
      size: NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio),
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.edges.filter((e) => byId.has(e.sourceId) && byId.has(e.targetId))
    .map((e) => ({ source: e.sourceId, target: e.targetId }));

  const sim = forceSimulation(nodes)
    .velocityDecay(0.6)
    .alphaDecay(1 - Math.pow(0.001, 1 / 300))
    .alphaTarget(0)
    .force('x', forceX(0).strength(cx))
    .force('y', forceY(0).strength(cy))
    .force('link', forceLink(links).id((d) => d.id).distance(LINK_DISTANCE).strength(1))
    .force('charge', forceManyBody().strength(-REPEL_STRENGTH).distanceMin(DISTANCE_MIN))
    .force('collide', forceCollide().radius(COLLIDE_RADIUS).strength(COLLIDE_STRENGTH));
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
  return {
    cx, cy,
    graphAspect: +(spanX / spanY).toFixed(2),
    fillX: +((spanX * scale) / stageW).toFixed(3),
    fillY: +((spanY * scale) / stageH).toFixed(3),
    usedStage: +(((spanX * scale) * (spanY * scale)) / (stageW * stageH)).toFixed(3),
    minNN: +nn[0].toFixed(1),
    medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
    overlaps,
  };
}

for (const [W, H] of [[990, 730], [369, 707]]) {
  const need = (W / H).toFixed(2); // aspect the graph must reach to fill BOTH axes
  console.log(`\n########## stage ${W}x${H}; to fill both axes the layout needs aspect ${need}`);
  console.log('(uniform centerStrength 0.1 = control)');
  console.log(JSON.stringify(run(W, H, 0.1, 0.1)));
  console.log('-- anisotropic: weaker Y (spreads vertically) --');
  for (const cy of [0.07, 0.05, 0.03, 0.02, 0.01]) console.log(JSON.stringify(run(W, H, 0.1, cy)));
  console.log('-- anisotropic: weaker X (spreads horizontally) --');
  for (const cx of [0.07, 0.05, 0.03, 0.02, 0.01]) console.log(JSON.stringify(run(W, H, cx, 0.1)));
}
