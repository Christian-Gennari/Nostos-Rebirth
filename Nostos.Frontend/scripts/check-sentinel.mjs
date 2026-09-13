#!/usr/bin/env node
/**
 * Sentinel discrimination check.
 *
 * A guard that cannot fail is not a guard. This asserts that the build
 * fingerprint's sentinel (PR-#94's `index-list .index-row-shell` selector)
 * reports TRUE on the served bundle and FALSE once that selector is disabled.
 *
 * It disables the matching CSS rules in a throwaway page — no rebuild, no
 * source edit, reversible, and safe in a checkout another writer may be
 * building from.
 *
 * Two traps this file fell into and now guards against, both worth stating
 * because they are the reason a "discrimination check" can itself be vacuous:
 *
 *   1. The marker must be PASSED IN, not hard-coded. The first version searched
 *      for the literal string 'SENTINEL' and so counted zero rules.
 *   2. `rule.disabled = true` does NOT remove a rule from `cssRules` — the rule
 *      and its `selectorText` are still there, so a naive re-count reports the
 *      same number and looks like the sentinel refused to discriminate. Count
 *      only ENABLED rules. This is what made the check report a failure that
 *      did not exist.
 *
 * Rules are also walked recursively: the sentinel lives at the top level today,
 * but a media-query-wrapped rule would be invisible to a flat loop and the
 * check would then pass by finding nothing.
 *
 * Usage: node scripts/check-sentinel.mjs [--port 5214]
 */
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('port', '5214')}`;
const MARKER = 'index-list .index-row-shell';

const countEnabled = (marker) => {
  let found = 0;
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && r.selectorText === undefined) { walk(r.cssRules); continue; }
      if (!r.disabled && r.selectorText?.includes(marker)) found++;
    }
  };
  for (const s of document.styleSheets) {
    try { walk(s.cssRules); } catch { /* cross-origin sheet: not ours */ }
  }
  return found;
};

const disableMatching = (marker) => {
  let n = 0;
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && r.selectorText === undefined) { walk(r.cssRules); continue; }
      if (r.selectorText?.includes(marker)) { r.disabled = true; n++; }
    }
  };
  for (const s of document.styleSheets) {
    try { walk(s.cssRules); } catch { /* skip */ }
  }
  return n;
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/second-brain', { waitUntil: 'networkidle' });

  const before = await page.evaluate(countEnabled, MARKER);
  if (before < 1) {
    const seen = await page.evaluate(() => [...document.styleSheets].map((s) => {
      let n; try { n = s.cssRules.length; } catch { n = -1; }
      return `${s.href?.split('/').pop() ?? '(inline)'}:${n}`;
    }));
    console.error(`\n✖ sentinel not found on the served bundle (${before} enabled matches).`);
    console.error('  sheets: ' + seen.join(', '));
    console.error('  The app is serving a PRE-merge build, or the selector was renamed.');
    console.error('  Either way this baseline must not be trusted.\n');
    process.exit(1);
  }

  const disabled = await page.evaluate(disableMatching, MARKER);
  const after = await page.evaluate(countEnabled, MARKER);
  if (after !== 0) {
    console.error(`\n✖ sentinel still reports ${after} enabled match(es) after disabling ${disabled} — it does not discriminate.\n`);
    process.exit(1);
  }

  console.log(`\n  ✔ sentinel discriminates: ${before} enabled match(es) on the served bundle,`);
  console.log(`    0 after disabling ${disabled} rule(s) in the live page.\n`);
} finally {
  await browser.close();
}
