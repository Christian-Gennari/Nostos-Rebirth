#!/usr/bin/env node
/**
 * Theme token-graph guard.
 *
 * A custom property left out of a theme block does NOT error — it silently
 * keeps the OTHER theme's value, which shows up as a light patch (or invisible
 * text) inside the dark UI. That failure mode is how the previous theme system
 * became unmaintainable, and nothing in a light-mode build ever reveals it.
 *
 * This compares the light `:root` token set against the dark block and fails on
 * any *colour* token that has no counterpart.
 *
 * Usage:  node scripts/check-theme-tokens.mjs [path/to/styles.css]
 * Exit 1 with a list of missing tokens, or 0 when the graph is complete.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? resolve(here, '../src/styles.css');
const css = readFileSync(file, 'utf8');

/**
 * Non-colour token families. These are theme-INVARIANT by design (geometry,
 * motion, type scale, spacing) so they are expected to be absent from the dark
 * block and must not be reported.
 */
const INVARIANT = /^--(radius|motion|ease|text-(xs|sm|base|lg|xl|2xl)|space|container-width|fw|transition|glass-blur|modal-scrim-blur|sidebar-width)/;

/**
 * Tokens whose value is a `color-mix()` of another token. They re-derive
 * themselves per theme, so an explicit dark value is not required.
 */
const DERIVED = /^--danger-/;

/**
 * Extract custom properties from every light `:root { ... }` block.
 * `styles.css` declares several (surfaces, then type/shadows/glass, then editor
 * chrome), so scanning only the first would silently under-report. Blocks
 * qualified with `[data-theme=...]` are skipped: those belong to a theme.
 */
function lightTokens(source) {
  const re = /(^|[\s}])?:root\s*\{/g;
  const out = new Map();
  let m;
  let found = 0;
  while ((m = re.exec(source))) {
    const brace = source.indexOf('{', m.index + (m[0].length - 1));
    // Skip `:root[data-theme=...]` — a themed block, not the light default.
    const selectorStart = source.lastIndexOf('\n', m.index) + 1;
    if (/data-theme/.test(source.slice(selectorStart, brace))) continue;
    const end = matchBlockEnd(source, brace);
    const block = source.slice(brace, end);
    for (const t of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(t[1], t[2].trim());
    found++;
  }
  if (!found) throw new Error('no plain `:root {` block found');
  return out;
}

/** Index of the `}` closing the block that opens at `openIndex`. */
function matchBlockEnd(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('unbalanced braces');
}

/** Extract custom properties from the `:root[data-theme='dark']` block. */
function darkTokens(source) {
  const m = source.match(/:root\[data-theme=['"]dark['"]\]\s*\{/);
  if (!m) throw new Error("no `:root[data-theme='dark']` block found");
  const brace = source.indexOf('{', m.index);
  const end = matchBlockEnd(source, brace);
  return new Map(
    [...source
      .slice(brace, end)
      .matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]),
  );
}

const light = lightTokens(css);
const dark = darkTokens(css);

const missing = [];
for (const [token, value] of light) {
  if (dark.has(token)) continue;
  if (INVARIANT.test(token)) continue;
  if (DERIVED.test(token)) continue;
  missing.push([token, value]);
}

const introduced = [...dark.keys()].filter((t) => !light.has(t));

console.log(`${file}`);
console.log(`  light tokens        : ${light.size}`);
console.log(`  dark tokens         : ${dark.size}`);
console.log(`  dark-only (new)     : ${introduced.length ? introduced.join(', ') : '—'}`);

if (missing.length) {
  console.error(`\n✖ ${missing.length} colour token(s) have no dark counterpart.`);
  console.error('  Each will silently keep its LIGHT value inside the dark theme:\n');
  for (const [token, value] of missing) console.error(`    ${token.padEnd(30)} ${value}`);
  console.error('\n  Add these to the `:root[data-theme=\'dark\']` block in styles.css,');
  console.error('  or add the family to INVARIANT if it is genuinely theme-invariant.\n');
  process.exit(1);
}

console.log('\n✔ Every colour token has a dark counterpart.\n');
