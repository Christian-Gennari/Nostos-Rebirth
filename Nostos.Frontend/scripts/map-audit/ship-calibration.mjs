/**
 * Final calibration for the Obsidian-model layout, measured the way it will ship.
 *
 * This models the real pipeline end to end:
 *   Obsidian force constants x GRAPH_SCALE  ->  settle  ->  uniform camera fit
 *   ->  Sigma's own size mapping (size / sqrt(ratio), mirroring Obsidian's
 *       `nodeScale = Math.sqrt(1/scale)`)  ->  on-screen radii and distances.
 *
 * It sweeps GRAPH_SCALE across stage SHAPES, because the camera fit makes the
 * on-screen density depend on the stage's aspect: a tall stage frames the same
 * graph larger, so the same scale is NOT equally legible everywhere.
 *
 * Usage: node scripts/map-audit/ship-calibration.mjs /tmp/gp-graph.json
 */
import { readFileSync } from 'node:fs';
import { forceSimulation, forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force';

const file = process.argv[2] ?? '/tmp/gp-graph.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

/* Obsidian 1.13.7 defaults, verbatim (docs/obsidian-graph-physics.md). */
const OBS = {
  linkDistance: 250,
  collideRadius: 60,
  collideStrength: 0.5,
  repelStrength: 1000,
  distanceMin: 30,
  centerStrength: 0.1,
  velocityDecay: 0.6,
  alphaMin: 0.001,
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
};

/* Nostos node sizing (unchanged from the shipped component). */
const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 16;
const FIT_OCCUPANCY = 0.88;

const STAGES = [
  { name: 'desktop', w: 990, h: 730 },
  { name: 'laptop', w: 820, h: 620 },
  { name: 'portrait-phone', w: 369, h: 707 },
];

const usages = data.nodes.map((n) => Math.max(0, n.usageCount));
const minUsage = Math.min(...usages);
const maxUsage = Math.max(...usages);
const usageRange = Math.max(1, maxUsage - minUsage);

function hashSeed(v) {
  let h = 2166136261;
  for (let i = 0; i < v.length; i += 1) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/** Obsidian's own seeding: a jittered ring, radius ~ linkDistance. */
function seedRadial(nodes, linkDistance) {
  const I = nodes.length;
  const L = 60 * I * 60;
  const O = Math.sqrt(L / Math.PI);
  for (const n of nodes) {
    const angle = 2 * Math.PI * hashSeed(`${n.id}:a`);
    const r = linkDistance + Math.sqrt(hashSeed(`${n.id}:r`)) * O;
    n.x = r * Math.cos(angle);
    n.y = r * Math.sin(angle);
  }
}

function run(stage, graphScale) {
  const S = graphScale;
  const nodes = data.nodes.map((n) => {
    const ratio = (Math.max(0, n.usageCount) - minUsage) / usageRange;
    return {
      id: n.id,
      size: NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio),
      x: 0, y: 0,
    };
  });
  seedRadial(nodes, OBS.linkDistance * S);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.edges.filter((e) => byId.has(e.sourceId) && byId.has(e.targetId))
    .map((e) => ({ source: e.sourceId, target: e.targetId }));

  const sim = forceSimulation(nodes)
    .velocityDecay(OBS.velocityDecay)
    .alphaDecay(OBS.alphaDecay)
    .alphaTarget(0)
    .force('x', forceX(0).strength(OBS.centerStrength))
    .force('y', forceY(0).strength(OBS.centerStrength))
    .force('link', forceLink(links).id((d) => d.id).distance(OBS.linkDistance * S).strength(1))
    .force('charge', forceManyBody().strength(-OBS.repelStrength * S).distanceMin(OBS.distanceMin * S))
    .force('collide', forceCollide().radius(OBS.collideRadius * S).strength(OBS.collideStrength));
  sim.alpha(0.3);
  let ticks = 0;
  while (sim.alpha() > OBS.alphaMin && ticks < 5000) { sim.tick(); ticks += 1; }
  sim.stop();

  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);

  // Camera ratio: Sigma's `ratio` is the inverse on-screen scale, so
  // span_on_screen = span_graph / ratio.
  const ratio = Math.max(
    spanX / (stage.w * FIT_OCCUPANCY),
    spanY / (stage.h * FIT_OCCUPANCY),
    1e-6,
  );

  // On-screen geometry, exactly as Sigma would map it.
  const zoomToSize = (s) => s / Math.sqrt(ratio); // Obsidian's nodeScale = sqrt(1/scale)
  const pts = nodes.map((n) => ({
    x: n.x / ratio,
    y: n.y / ratio,
    r: zoomToSize(n.size),
  }));

  let overlaps = 0;
  const nn = [];
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
  const radii = pts.map((p) => p.r).sort((a, b) => a - b);
  const medNN = nn[Math.floor(nn.length / 2)];
  const medR = radii[Math.floor(radii.length / 2)];

  return {
    graphScale: graphScale,
    stage: `${stage.w}x${stage.h}`,
    ticks,
    ratio: +ratio.toFixed(3),
    fillX: +((spanX / ratio) / stage.w).toFixed(3),
    fillY: +((spanY / ratio) / stage.h).toFixed(3),
    nodeR: `${radii[0].toFixed(1)}-${radii[radii.length - 1].toFixed(1)}`,
    minNN: +nn[0].toFixed(1),
    p25NN: +nn[Math.floor(nn.length * 0.25)].toFixed(1),
    medianNN: +medNN.toFixed(1),
    NNoverR: +(medNN / medR).toFixed(2),
    overlaps,
  };
}

console.log(`graph: ${data.nodes.length} nodes, ${data.edges.length} edges\n`);
for (const stage of STAGES) {
  console.log(`########## ${stage.name} (${stage.w}x${stage.h})`);
  for (const graphScale of [0.2, 0.3, 0.4, 0.5, 0.75, 1]) {
    console.log(JSON.stringify(run(stage, graphScale)));
  }
  console.log();
}
