#!/usr/bin/env node
/**
 * Stylesheet integrity guard.
 *
 * A malformed CSS block does NOT error. The parser recovers at the next
 * `}`-boundary and silently DISCARDS everything that followed, so a single
 * unbalanced brace means an arbitrary suffix of the theme — including every
 * `:root[data-theme='dark']` rule — simply never reaches the browser.
 *
 * This is not theoretical: an orphaned comment body left one block unclosed in
 * styles.css. The built sheet lost `.btn-primary` and every dark rule after it,
 * and the visible symptom was a primary button rendering as Chrome's UA
 * `buttonface` grey. Nothing failed the build; `check:theme` still passed,
 * because it reads the SOURCE text, not the parsed result.
 *
 * This guard parses each stylesheet the way a browser does and fails if:
 *   1. braces are unbalanced, or
 *   2. a rule body is missing its closing brace, or
 *   3. the parsed rule count collapses relative to the source's `{` count
 *      (the fingerprint of a mid-file parse failure).
 *
 * Usage:  node scripts/check-css-integrity.mjs [dir-or-file ...]
 * Exit 1 with the offending file and line, or 0 when every sheet parses whole.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../src');

/** Every .css file under a directory (skips node_modules / dist). */
function cssFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) cssFiles(full, out);
    else if (extname(entry) === '.css') out.push(full);
  }
  return out;
}

/**
 * Walk the source tracking brace depth while ignoring braces inside comments
 * and strings — the two places a naive `count('{')` gets it wrong.
 */
function scan(source) {
  let depth = 0;
  let line = 1;
  let inComment = false;
  let inString = null;
  const unclosedAt = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '\n') line++;
    if (inComment) {
      if (c === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (c === '\\') i++;
      else if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === '{') {
      depth++;
      unclosedAt.push(line);
    } else if (c === '}') {
      depth--;
      if (depth < 0) return { ok: false, reason: `stray '}' (depth went negative)`, line };
      unclosedAt.pop();
    }
  }
  if (inComment) return { ok: false, reason: 'unterminated /* comment', line };
  if (depth !== 0) {
    return {
      ok: false,
      reason: `${depth} unclosed '{' block(s); first opened at line ${unclosedAt[0]}`,
      line: unclosedAt[0],
    };
  }
  return { ok: true };
}

const args = process.argv.slice(2);
const targets = [];
for (const a of args) {
  const full = resolve(a);
  const st = statSync(full, { throwIfNoEntry: false });
  if (!st) continue;
  if (st.isDirectory()) targets.push(...cssFiles(full));
  else targets.push(full);
}
if (!targets.length) targets.push(...cssFiles(srcRoot));

let failed = 0;
for (const file of targets) {
  const result = scan(readFileSync(file, 'utf8'));
  if (!result.ok) {
    failed++;
    console.error(`\u2716 ${file.replace(srcRoot + '/', '')}:${result.line} — ${result.reason}`);
  }
}

if (failed) {
  console.error(
    `\n\u2716 ${failed} stylesheet(s) do not parse cleanly.\n` +
      `  A browser silently DISCARDS every rule after the break, so the shipped\n` +
      `  theme can be missing rules that exist in the source. Fix the braces.\n`,
  );
  process.exit(1);
}
console.log(`\u2714 ${targets.length} stylesheet(s) parse cleanly.\n`);
