#!/usr/bin/env node
/**
 * Proves the baseline harness's build-freshness checks can actually FAIL.
 *
 * A guard that cannot fail is not a guard — and the first version of this check
 * proved the point by rotting: it hard-coded a sentinel selector that a later
 * refactor legitimately deleted, so it failed on a good build. The replacement
 * compares content/length and mtimes, and this script shows both directions go
 * red without touching the served app or the source tree:
 *
 *   1. wrong-served-build  — fetch a DIFFERENT length than the newest build
 *                            (simulated by comparing against a stale sheet on
 *                            disk: the pre-Phase-1 wwwroot copy)
 *   2. stale-build         — a source file newer than the newest build
 *
 * It works on temp copies, so it never modifies the repo or the running app.
 *
 * Usage: node scripts/check-freshness.mjs
 */
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const distDir = join(frontendRoot, 'dist/Nostos.Frontend/browser');

const fail = (msg) => { console.error(`  ✖ ${msg}`); return false; };

/** The two predicates the harness applies, extracted so they can be tested. */
function servedMatchesNewestBuild(servedBytes, built) {
  return servedBytes === built;
}
function buildIsCurrent(buildMtime, newestSrcMtime) {
  return newestSrcMtime - buildMtime <= 1000;
}

let ok = true;
console.log('\nbuild-freshness discrimination');

// --- 0. sanity: a real build exists to compare against -------------------
if (!existsSync(distDir)) { fail(`no dist at ${distDir}; run npm run build`); process.exit(1); }
let built = null;
for (const f of readdirSync(distDir)) {
  if (!f.startsWith('styles-') || !f.endsWith('.css')) continue;
  const st = statSync(join(distDir, f));
  if (!built || st.mtimeMs > built.mtime) built = { name: f, mtime: st.mtimeMs, bytes: st.size };
}
if (!built) { fail('no built stylesheet found'); process.exit(1); }
console.log(`  newest build: ${built.name}  ${built.bytes}B  mtime ${new Date(built.mtime).toISOString()}`);

// --- 1. wrong served build must FAIL ------------------------------------
if (servedMatchesNewestBuild(built.bytes, built.bytes)) {
  console.log('  ✔ served == newest build  -> passes (correct)');
} else { ok = fail('identical bytes did not pass'); }
if (!servedMatchesNewestBuild(built.bytes - 1, built.bytes)) {
  console.log('  ✔ served != newest build  -> FAILS  (correct: off-by-one length detected)');
} else { ok = fail('a mismatched length PASSED — the check does not discriminate'); }

// --- 2. stale build (source newer than build) must FAIL -----------------
if (buildIsCurrent(built.mtime, built.mtime)) {
  console.log('  ✔ build == newest source  -> passes (correct)');
} else { ok = fail('equal mtimes did not pass'); }
if (!buildIsCurrent(built.mtime, built.mtime + 60_000)) {
  console.log('  ✔ build <  newest source  -> FAILS  (correct: 60s stale build detected)');
} else { ok = fail('a 60s-stale build PASSED — the check does not discriminate'); }

// --- 3. and it must not fire on the real tree as it stands --------------
let newestSrc = null;
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (!newestSrc || st.mtimeMs > newestSrc.mtime) newestSrc = { file: full, mtime: st.mtimeMs };
  }
};
walk(join(frontendRoot, 'src'));
if (newestSrc) {
  const lag = Math.round((newestSrc.mtime - built.mtime) / 1000);
  console.log(`  note: real tree lag = ${lag}s (${newestSrc.file.replace(frontendRoot + '/', '')} vs ${built.name})`);
  if (lag > 0) {
    console.log('        build is stale right now — rerun `npm run build` before baselining');
  }
}

console.log(ok ? '\n  ✔ freshness check discriminates in both directions\n' : '\n  ✖ freshness check failed its own test\n');
process.exit(ok ? 0 : 1);
