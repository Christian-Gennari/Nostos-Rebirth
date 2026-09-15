/**
 * Framing experiment: can the SIMULATION itself produce a layout that fills a
 * portrait stage, instead of shearing a settled square layout after the fact?
 *
 * The shipped code runs ForceAtlas2 once, then rescales each axis independently
 * (clamped to 1.4x). That is a post-hoc stretch of frozen coordinates, so the
 * geometry the user then drags is not the geometry the physics produced.
 *
 * d3-force offers a legitimate in-simulation control: forceX and forceY are
 * separate forces, so their strengths can differ. Stronger gravity on an axis
 * compresses the settled cloud along it. This script measures the settled
 * extent for a grid of (strengthX, strengthY) so the choice is a dose-response
 * curve, not a guess.
 *
 * Usage: node scripts/map-audit/framing-sweep.mjs /tmp/gp-graph.json 369 707
 */
import { readFileSync } from 'node:fs';
import { forceSimulation, forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force';

const file = process.argv[2] ?? '/tmp/gp-graph.json';
const STAGE_W = Number(process.argv[3] ?? 369);
const STAGE_H = Number(process.argv[4] ?? 707);
const FIT_OCCUPANCY = 0.88;

const data = JSON.parse(readFileSync(file, 'utf8'));
const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 16;
const usages = data.nodes.map((n) => Math.max(0, n.usageCount));
const minUsage = Math.min(...usages);
const maxUsage = Math.max(...usages);
const usageRange = Math.max(1, maxUsage - minUsage);

function hashSeed(v) {
  let h = 2166136261;
  for (let i = 0; i < v.length; i += 1) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function run({ centerStrength, centerStrengthY, linkDistance, repelStrength, collideRadius }) {
  const aspect = STAGE_W / STAGE_H;
  const seedW = aspect >= 1 ? aspect : 1;
  const seedH = aspect >= 1 ? 1 : 1 / aspect;
  const nodes = data.nodes.map((n) => {
    const ratio = (Math.max(0, n.usageCount) - minUsage) / usageRange;
    return {
      id: n.id,
      size: NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio),
      x: (hashSeed(`${n.id}:x`) * 2 - 1) * seedW,
      y: (hashSeed(`${n.id}:y`) * 2 - 1) * seedH,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.edges.filter((e) => byId.has(e.sourceId) && byId.has(e.targetId))
    .map((e) => ({ source: e.sourceId, target: e.targetId }));

  const sim = forceSimulation(nodes)
    .velocityDecay(0.6)
    .alphaDecay(1 - Math.pow(0.001, 1 / 300))
    .alphaTarget(0)
    .force('x', forceX(0).strength(centerStrength))
    .force('y', forceY(0).strength(centerStrengthY ?? centerStrength))
    .force('link', forceLink(links).id((d) => d.id).distance(linkDistance).strength(1))
    .force('charge', forceManyBody().strength(-repelStrength).distanceMin(30))
    .force('collide', forceCollide().radius(collideRadius).strength(0.5));
  sim.alpha(0.3);
  let ticks = 0;
  while (sim.alpha() > 0.001 && ticks < 5000) { sim.tick(); ticks += 1; }
  sim.stop();

  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const scale = Math.min((STAGE_W * FIT_OCCUPANCY) / spanX, (STAGE_H * FIT_OCCUPANCY) / spanY);
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
    ticks,
    graphAspect: +(spanX / spanY).toFixed(2),
    fillX: +((spanX * scale) / STAGE_W).toFixed(3),
    fillY: +((spanY * scale) / STAGE_H).toFixed(3),
    minNN: +nn[0].toFixed(1),
    medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
    overlaps,
  };
}

console.log(`stage ${STAGE_W}x${STAGE_H} (aspect ${(STAGE_W / STAGE_H).toFixed(2)}), stage aspect ratio ${(STAGE_H / STAGE_W).toFixed(2)}`);
console.log('\n--- uniform centering, sweep linkDistance (collide 32, repel 1000) ---');
for (const linkDistance of [80, 100, 120, 150, 200, 250]) {
  console.log('ld', linkDistance, JSON.stringify(run({ centerStrength: 0.1, linkDistance, repelStrength: 1000, collideRadius: 32 })));
}

console.log('\n--- anisotropic centering: Y strength = X strength * (H/W) ratios ---');
console.log('(compressing the SHORTER axis of a tall stage to pull the cloud into its shape)');
for (const ratio of [1, 1.25, 1.5, 2, 2.5, 3]) {
  console.log('ratio', ratio, JSON.stringify(run({ centerStrength: 0.1, centerStrengthY: 0.1 * ratio, linkDistance: 120, repelStrength: 1000, collideRadius: 32 })));
}

console.log('\n--- the shipped equivalent: uniform settle then per-axis stretch (control) ---');
{
  const r = run({ centerStrength: 0.1, linkDistance: 120, repelStrength: 1000, collideRadius: 32 });
  console.log('uniform', JSON.stringify(r));
}
