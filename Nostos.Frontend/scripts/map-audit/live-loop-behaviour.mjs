/**
 * Equilibrium + live-loop behaviour of the Obsidian model.
 *
 * The design settles once, then re-heats to alpha 0.3 for the duration of a drag
 * (exactly what Obsidian's worker does: `alpha: .3, alphaTarget: .3` on every
 * pointermove, and `alphaTarget: 0` on release). Two things must be true for that
 * to behave well:
 *
 *   A. Re-heating must not balloon the graph. d3's alpha floor is not a force
 *      balance, so a re-heat always redistributes SOMETHING; what matters is the
 *      size of the effect on the settled span.
 *   B. The final state must SETTLE and STOP (alpha decays back to the floor and
 *      the loop halts), not churn forever.
 *
 * It reports span growth and per-node drift for the real sequence:
 *   settle -> (optional rescale to stage units) -> drag for N ticks -> release.
 *
 * It also isolates the rescale: the same sequence at S=1 with no rescale is the
 * control, so any difference is attributable to the rescale.
 *
 * Usage: node scripts/map-audit/live-loop-behaviour.mjs /tmp/gp-graph.json
 */
import { readFileSync } from 'node:fs';
import { forceSimulation, forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force';

const file = process.argv[2] ?? '/tmp/gp-graph.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

const OBS = {
  linkDistance: 250, collideRadius: 60, collideStrength: 0.5,
  repelStrength: 1000, distanceMin: 30, centerStrength: 0.1,
  velocityDecay: 0.6, alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  alphaMin: 0.001, dragAlpha: 0.3,
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

const span = (nodes) => {
  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
};

function toAlphaFloor(sim, cap = 5000) {
  let t = 0;
  while (sim.alpha() > OBS.alphaMin && t < cap) { sim.tick(); t += 1; }
  return t;
}

/** Hold alpha at alphaTarget for `ticks` ticks, the way a drag does. */
function heated(live, ticks) {
  live.alphaTarget(OBS.dragAlpha);
  live.alpha(OBS.dragAlpha);
  let t = 0;
  while (t < ticks) { live.tick(); t += 1; }
}

function scenario(stageW, stageH, rescale) {
  const { nodes, links } = build();
  const sim = makeSim(nodes, links, 1);
  sim.alpha(0.3);
  const settleTicks = toAlphaFloor(sim);
  const settled = span(nodes);
  const settledPos = nodes.map((n) => ({ x: n.x, y: n.y }));

  let S = 1;
  let k = 1;
  if (rescale) {
    k = Math.min((stageW * FIT_OCCUPANCY) / settled.x, (stageH * FIT_OCCUPANCY) / settled.y);
    const meanX = nodes.reduce((a, n) => a + n.x, 0) / nodes.length;
    const meanY = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
    for (const n of nodes) { n.x = (n.x - meanX) * k; n.y = (n.y - meanY) * k; }
    S = k;
  }
  const afterRescale = nodes.map((n) => ({ x: n.x, y: n.y }));
  const preDragSpan = span(nodes);

  // Drag phase: re-heat and HOLD alpha at 0.3, as the pointermove handler does.
  sim.stop();
  const live = makeSim(nodes, links, S);
  heated(live, 300);
  const duringDrag = span(nodes);
  const dragDrift = nodes.map((n, i) => Math.hypot(n.x - afterRescale[i].x, n.y - afterRescale[i].y));

  // Release: alphaTarget 0, decay back to the floor.
  live.alphaTarget(0);
  const releaseTicks = toAlphaFloor(live);
  const finalSpan = span(nodes);
  live.stop();

  // Idle: re-run to prove the loop has genuinely stopped.
  live.alpha(0.001);
  const idleDrift = nodes.map((n, i) => Math.hypot(n.x - afterRescale[i].x, n.y - afterRescale[i].y));

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  void settledPos; void dragDrift;
  return {
    rescale: !!rescale,
    k: +k.toFixed(4),
    settleTicks,
    settleSpan: `${settled.x.toFixed(0)}x${settled.y.toFixed(0)}`,
    dragTicks: 300,
    dragSpanGrowthX: +(duringDrag.x / preDragSpan.x).toFixed(3),
    dragSpanGrowthY: +(duringDrag.y / preDragSpan.y).toFixed(3),
    releaseTicks,
    finalSpanGrowthX: +(finalSpan.x / preDragSpan.x).toFixed(3),
    finalSpanGrowthY: +(finalSpan.y / preDragSpan.y).toFixed(3),
    aspectSettled: +(settled.x / settled.y).toFixed(3),
    aspectDuringDrag: +(duringDrag.x / duringDrag.y).toFixed(3),
    aspectFinal: +(finalSpan.x / finalSpan.y).toFixed(3),
    idleMaxDrift: +Math.max(...idleDrift).toFixed(3),
    meanIdleDrift: +mean(idleDrift).toFixed(4),
  };
}

for (const [W, H] of [[990, 730], [369, 707]]) {
  console.log(`\n########## stage ${W}x${H}`);
  console.log('no rescale (S=1, control) ', JSON.stringify(scenario(W, H, false)));
  console.log('rescued to stage units    ', JSON.stringify(scenario(W, H, true)));
}

/* Long-run stability: does repeated heat/cool drift the layout permanently? */
console.log('\n########## 5 heat/cool cycles (does the layout wander?)');
{
  const { nodes, links } = build();
  const sim = makeSim(nodes, links, 1);
  sim.alpha(0.3);
  toAlphaFloor(sim);
  const baseline = span(nodes);
  const out = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    heated(sim, 120);
    sim.alphaTarget(0);
    toAlphaFloor(sim);
    const s = span(nodes);
    const aspect = s.x / s.y;
    out.push({ cycle, spanX: +s.x.toFixed(0), spanY: +s.y.toFixed(0), vsBaseline: +(s.x / baseline.x).toFixed(3), aspect: +aspect.toFixed(3) });
  }
  for (const o of out) console.log(JSON.stringify(o));
  sim.stop();
}
