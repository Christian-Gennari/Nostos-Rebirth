/**
 * Does the design stay at equilibrium?
 *
 * The plan is:
 *   1. settle once at Obsidian's literal constants (length scale S = 1);
 *   2. scale the settled layout into stage pixel units by factor k;
 *   3. run the LIVE loop during a drag with the force constants multiplied by k.
 *
 * Step 3 is only sound if the settle equilibrium is scale-invariant, i.e. if
 * running at constants x k over positions x k reproduces the same balanced state.
 * If it is not, the graph visibly swells or creeps the moment a user drags.
 *
 * This script measures the drift directly: settle, rescale, run 600 further
 * ticks, and report how far nodes move. Control runs the same 600 ticks with NO
 * rescale, so the comparison isolates the rescale's effect.
 *
 * It also checks the centering subtlety: forceX/forceY pull the MEAN toward 0,
 * so the rescale must re-centre on the mean. Rescaling about the bounding-box
 * centre (as the shipped `normalizeGraphPositions` does) leaves the mean
 * off-origin and the centering force then drags the whole graph.
 *
 * Usage: node scripts/map-audit/layout-equilibrium.mjs /tmp/gp-graph.json
 */
import { readFileSync } from 'node:fs';
import { forceSimulation, forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force';

const file = process.argv[2] ?? '/tmp/gp-graph.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

const OBS = {
  linkDistance: 250, collideRadius: 60, collideStrength: 0.5,
  repelStrength: 1000, distanceMin: 30, centerStrength: 0.1,
  velocityDecay: 0.6, alphaDecay: 1 - Math.pow(0.001, 1 / 300),
};
const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 16;
const FIT_OCCUPANCY = 0.88;

const usages = data.nodes.map((n) => Math.max(0, n.usageCount));
const minUsage = Math.min(...usages); const maxUsage = Math.max(...usages);
const usageRange = Math.max(1, maxUsage - minUsage);

function hashSeed(v) {
  let h = 2166136261;
  for (let i = 0; i < v.length; i += 1) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function build() {
  const N = data.nodes.length;
  const L = 60 * N * 60;
  const O = Math.sqrt(L / Math.PI);
  const nodes = data.nodes.map((n) => {
    const ratio = (Math.max(0, n.usageCount) - minUsage) / usageRange;
    const angle = 2 * Math.PI * hashSeed(`${n.id}:a`);
    const r = OBS.linkDistance + Math.sqrt(hashSeed(`${n.id}:r`)) * O;
    void ratio;
    return { id: n.id, size: NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio), x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.edges.filter((e) => byId.has(e.sourceId) && byId.has(e.targetId)).map((e) => ({ source: e.sourceId, target: e.targetId }));
  return { nodes, links };
}

function makeSim(nodes, links, S) {
  return forceSimulation(nodes)
    .velocityDecay(OBS.velocityDecay).alphaDecay(OBS.alphaDecay).alphaTarget(0)
    .force('x', forceX(0).strength(OBS.centerStrength))
    .force('y', forceY(0).strength(OBS.centerStrength))
    .force('link', forceLink(links).id((d) => d.id).distance(OBS.linkDistance * S).strength(1))
    .force('charge', forceManyBody().strength(-OBS.repelStrength * S).distanceMin(OBS.distanceMin * S))
    .force('collide', forceCollide().radius(OBS.collideRadius * S).strength(OBS.collideStrength));
}

function stats(nodes) {
  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  return {
    meanX, meanY,
    spanX: Math.max(...xs) - Math.min(...xs),
    spanY: Math.max(...ys) - Math.min(...ys),
    bboxMidX: (Math.max(...xs) + Math.min(...xs)) / 2,
    bboxMidY: (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

function scenario(stageW, stageH, recenterOn) {
  const { nodes, links } = build();
  const sim = makeSim(nodes, links, 1);
  sim.alpha(0.3);
  let ticks = 0;
  while (sim.alpha() > 0.001 && ticks < 5000) { sim.tick(); ticks += 1; }
  const settled = stats(nodes);

  const k = Math.min(
    (stageW * FIT_OCCUPANCY) / settled.spanX,
    (stageH * FIT_OCCUPANCY) / settled.spanY,
  );
  const cx = recenterOn === 'mean' ? settled.meanX : settled.bboxMidX;
  const cy = recenterOn === 'mean' ? settled.meanY : settled.bboxMidY;
  const pos0 = nodes.map((n) => ({ x: n.x, y: n.y }));
  for (const n of nodes) { n.x = (n.x - cx) * k; n.y = (n.y - cy) * k; }
  const before = nodes.map((n) => ({ x: n.x, y: n.y }));

  // Live loop, as it would run during a drag: constants scaled by k.
  sim.stop();
  const live = makeSim(nodes, links, k);
  live.alpha(0.3);
  let liveTicks = 0;
  while (live.alpha() > 0.001 && liveTicks < 600) { live.tick(); liveTicks += 1; }
  live.stop();

  const drifts = nodes.map((n, i) => Math.hypot(n.x - before[i].x, n.y - before[i].y));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const after = stats(nodes);
  return {
    settleTicks: ticks,
    k: +k.toFixed(4),
    recenteredOn: recenterOn,
    liveTicks,
    maxDrift: +Math.max(...drifts).toFixed(1),
    meanDrift: +mean(drifts).toFixed(2),
    nodesMovedOver2px: drifts.filter((d) => d > 2).length,
    spanBefore: `${before.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0).toFixed(0)}/${before.reduce((m, p) => Math.max(m, Math.abs(p.y)), 0).toFixed(0)}`,
    spanRatioBefore: +(settled.spanX / settled.spanY).toFixed(3),
    spanRatioAfter: +(after.spanX / after.spanY).toFixed(3),
  };
}

/* Control: 600 more ticks at S=1 WITHOUT any rescale (pure equilibrium check). */
function control(stageW, stageH) {
  const { nodes, links } = build();
  const sim = makeSim(nodes, links, 1);
  sim.alpha(0.3);
  let t = 0;
  while (sim.alpha() > 0.001 && t < 5000) { sim.tick(); t += 1; }
  const before = nodes.map((n) => ({ x: n.x, y: n.y }));
  sim.alpha(0.5);
  let t2 = 0;
  while (sim.alpha() > 0.001 && t2 < 600) { sim.tick(); t2 += 1; }
  const drifts = nodes.map((n, i) => Math.hypot(n.x - before[i].x, n.y - before[i].y));
  void stageW; void stageH;
  return { settleTicks: t, liveTicks: t2, maxDrift: +Math.max(...drifts).toFixed(1), meanDrift: +(drifts.reduce((a, b) => a + b, 0) / drifts.length).toFixed(2) };
}

for (const [W, H] of [[990, 730], [369, 707]]) {
  console.log(`\n########## stage ${W}x${H}`);
  console.log('CONTROL (no rescale)      ', JSON.stringify(control(W, H)));
  console.log('rescale, recentre on MEAN ', JSON.stringify(scenario(W, H, 'mean')));
  console.log('rescale, recentre on BBOX ', JSON.stringify(scenario(W, H, 'bbox')));
}
