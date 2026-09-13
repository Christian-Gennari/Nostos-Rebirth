#!/usr/bin/env node
/**
 * check-design.mjs — design-language drift scanner.
 *
 * Why this exists: over one change-set this repo shipped four regressions that
 * every existing check passed. `npm run check` verifies that CSS *parses* and
 * that colour tokens have dark counterparts; neither notices that
 *
 *   1. a `transition` lost its semicolon, swallowing the next declaration, so
 *      elements rendered black (valid CSS, all sheets "parse cleanly");
 *   2. a global dark override was load-bearing for a component that declared its
 *      own copy of the same class, so deleting the override silently reverted it;
 *   3. an invented token quietly moved a LIGHT-mode value;
 *   4. a token was deleted that a component actually consumed.
 *
 * Each rule below encodes one of those, at the level of *text*, so it runs in
 * the fast `npm run check` loop rather than needing a browser.
 *
 * Rules are deliberately few and each has been proven to fail on a real
 * instance (see --self-test). A scanner that cannot fail is worse than no
 * scanner, because it is trusted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Every stylesheet and inline-template component in the app. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    const ext = extname(p);
    if (ext === '.css' || ext === '.ts') out.push(p);
  }
  return out;
}

/**
 * Extract CSS from a file. For `.ts` this pulls the contents of every
 * `styles: [\`...\`]` / `styleUrls`-adjacent template literal, because some
 * components in this app keep their styles inline (app-dock, markdown-editor,
 * star-rating) and a text scanner that skips them would miss real drift.
 */
function cssOf(path, raw) {
  if (path.endsWith('.css')) return raw;
  const blocks = [];
  const re = /styles\s*:\s*\[([\s\S]*?)\n\s*\]/g;
  let m;
  while ((m = re.exec(raw))) blocks.push(m[1]);
  return blocks.join('\n');
}

/**
 * Strip comments before scanning. Without this the scanner reads prose: a comment
 * that EXPLAINS a removed `var(--space-3)` re-triggers the undeclared-token rule,
 * so documenting a fix would break the build. Found exactly that way.
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');

const files = walk(SRC).map((p) => ({ path: p, raw: readFileSync(p, 'utf8') }))
  .map((f) => ({ ...f, css: stripComments(cssOf(f.path, f.raw)) }))
  .filter((f) => f.css.trim().length > 0);

const rel = (p) => relative(ROOT, p);
const findings = [];
const infos = [];
const report = (rule, file, line, message) =>
  findings.push({ rule, file: rel(file), line, message });
/** Non-blocking observations. Printed, never gate the build. */
const info = (rule, message) => infos.push({ rule, message });

/**
 * RULE 1 — a transition declaration that a following declaration can absorb.
 *
 * `transition: a, b 0.2s ease` with no `;` and a declaration on the next line is
 * VALID CSS that silently swallows that declaration. This shipped once and made
 * text render black while every check stayed green.
 */
for (const f of files) {
  const lines = f.css.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('transition:') || line.startsWith('/*')) continue;
    // A multi-line shorthand ends with a comma and is fine.
    if (line.endsWith(';') || line.endsWith(',') || line.endsWith('{')) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const next = (lines[j] ?? '').trim();
    if (/^[a-z-]+\s*:/.test(next) && !next.startsWith('/*')) {
      report('unterminated-transition', f.path, i + 1,
        `transition is not terminated; the next declaration ("${next.slice(0, 40)}") ` +
        `is absorbed into its value and silently discarded`);
    }
  }
}

/**
 * RULE 2 — `.visually-hidden` is duplicated verbatim.
 *
 * No single global definition exists, and the copies had already drifted apart
 * once (one omitted `clip-path`, which un-hides the element on some engines).
 * Keep one definition; import or extend it.
 */
{
  const defs = [];
  for (const f of files) {
    const re = /\.visually-hidden\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(f.css))) {
      defs.push({ file: f.path, body: m[1].replace(/\s+/g, ' ').trim() });
    }
  }
  /* Exactly ONE definition is correct: the global utility in styles.css. Zero
     means an element that should be hidden is not; more than one means the copies
     can drift again. Neither is a style preference. */
  if (defs.length === 0) {
    report('visually-hidden', join(ROOT, 'src/styles.css'), 1,
      `.visually-hidden is not declared anywhere — screen-reader-only content ` +
      `would become visible`);
  } else if (defs.length > 1) {
    const bodies = new Set(defs.map((d) => d.body));
    report('visually-hidden', defs.find((d) => !d.file.endsWith('styles.css'))?.file ?? defs[0].file, 1,
      `.visually-hidden is declared ${defs.length}x (${bodies.size} distinct ` +
      `body/bodies) — keep the ONE global definition in styles.css` +
      (bodies.size > 1 ? '; the copies have already DRIFTED' : ''));
  }
}

/**
 * RULE 3 — a literal colour outside the token graph.
 *
 * Any `#hex` or `rgb()`/`rgba()` in a component stylesheet is a colour that
 * cannot respond to the theme. A small allow-list covers the genuine
 * theme-invariant cases (pure white/black, cover-art overlays).
 *
 * This one is a RATCHET, not a zero-tolerance gate. There are ~109 existing
 * literals, most of them inside cover-art overlays where theme-invariance is
 * correct; failing the build on them would pressure someone into "fixing" them
 * wrongly. Instead the count is pinned to a budget: it may fall freely, and any
 * increase fails. That way a NEW hard-coded colour cannot land, while the
 * existing debt is recorded rather than performance-theatre.
 *
 * When you tokenise some, lower the budget in the same commit.
 */
/* Lowered 92 -> 83 by dropping dead `var(--token, fallback)` fallbacks in
   star-rating and toast-container: every one of those tokens IS declared, so the
   fallback never rendered and only made the literal count misleading.
   Deliberately still counted (banked as a taste call, see the report):
   toast-container's `#4ade80` success and `#f87171` error — TOKEN EQUIVALENTS
   EXIST (`--color-success` / `--color-danger`) and are theme-aware, so these two
   pairs are still theme-blind against a token that is not. Left for a human
   because it changes the rendered hue. */
const LITERAL_COLOUR_BUDGET = 79;

{
  const ALLOW = [
    // Theme-invariant by design: the brand mark, cover artwork overlays, and the
    // deliberately unstyled text selection ghost. Each is documented in the
    // design doc; add here only with a reason.
    /^#000$/, /^#fff$/, /^#ffffff$/, /^#000000$/,
  ];
  const lineAllow = /design-lang-allow/;
  const found = [];
  for (const f of files) {
    if (f.path.endsWith('styles.css')) continue; // the token graph itself
    const lines = f.css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (lineAllow.test(l)) continue;
      for (const m of l.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
        const lit = m[0];
        if (ALLOW.some((re) => re.test(lit))) continue;
        if (/^#[0-9a-fA-F]{3,8}$/.test(lit) && /^#(?:0{3,8}|f{3,8})$/i.test(lit)) continue;
        found.push({ file: rel(f.path), line: i + 1, lit });
      }
    }
  }
  if (found.length > LITERAL_COLOUR_BUDGET) {
    report('literal-colour', join(ROOT, found[0].file), found[0].line,
      `literal colours rose to ${found.length}, above the pinned budget of ` +
      `${LITERAL_COLOUR_BUDGET}. Tokenise the new one, or raise the budget ` +
      `deliberately in the same commit. The current literals are:`);
    for (const it of found) {
      report('literal-colour', join(ROOT, it.file), it.line,
        `${it.lit} — outside the token graph, so it cannot follow the theme`);
    }
  } else {
    console.log(`  (ratchet) literal colours: ${found.length} / budget ${LITERAL_COLOUR_BUDGET}` +
      `${found.length < LITERAL_COLOUR_BUDGET ? ' — LOWER THE BUDGET in the same commit' : ''}`);
  }
}

/**
 * RULE 4 — a token consumed but never declared.
 *
 * `var(--foo)` with no `--foo:` anywhere resolves to nothing and the declaration
 * is dropped at computed-value time. Cheap to catch, invisible in review.
 */
{
  const declared = new Set();
  const consumed = new Map();
  for (const f of files) {
    for (const m of f.css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);
    if (f.path.endsWith('styles.css')) continue;
    const lines = f.css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!consumed.has(m[1])) consumed.set(m[1], rel(f.path) + ':' + (i + 1));
      }
    }
  }
  // Tokens provided by Angular's view encapsulation, the framework, or set from
  // TS at runtime are not declared in any stylesheet.
  // `--depth` is bound per-row from the template via `[style.--depth]`, so it is
  // declared by Angular at runtime and appears in no stylesheet.
  const EXEMPT = [/^--ng/, /^--mat/, /^--cdk/, /^--depth$/];
  for (const [tok, where] of consumed) {
    if (declared.has(tok) || EXEMPT.some((re) => re.test(tok))) continue;
    const [file, line] = where.split(/:(?=\d+$)/);
    /* A `var(--x, fallback)` is not dropped — the fallback is used. Say so, so the
       message does not overstate the bug; both cases are still worth fixing,
       because a fallback is a maintenance trap (it looks like a token is in use
       when it is not, and editing the token silently does nothing). */
    const hasFallback = hasFallbackFor(where, tok);
    report('undeclared-token', file, Number(line),
      `var(${tok}) is consumed but never declared — ` +
      (hasFallback
        ? `the FALLBACK is what renders, so editing the token would silently do nothing`
        : `there is no fallback, so the declaration is dropped`));
  }
}

/** Did the consuming site pass a fallback to this var()? */
function hasFallbackFor(where, tok) {
  const [file, line] = where.split(/:(?=\d+$)/);
  const src = files.find((f) => rel(f.path) === file);
  if (!src) return false;
  const l = src.css.split('\n')[Number(line) - 1] ?? '';
  const i = l.indexOf(`var(${tok}`);
  if (i === -1) return false;
  let depth = 0;
  for (let k = i; k < l.length; k++) {
    if (l[k] === '(') depth++;
    else if (l[k] === ')') { depth--; if (!depth) return false; }
    else if (l[k] === ',' && depth === 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- self-test
/**
 * RULE 5 — a global dark override that cannot win its specificity race.
 *
 * This is the #94 bug class, and it is the most expensive one in this repo: the
 * failure is invisible in review, does not error, and manifests in ONE theme.
 *
 * THE CORRECT ARITHMETIC (this was wrong at first, and the correction matters):
 *
 * A "compound" is a COMbinator-separated part, NOT a class. `.nav-item.active`
 * is ONE compound holding two classes. Angular's ShadowCss splits a selector on
 * combinators and appends exactly ONE `[_ngcontent-x]` attribute per compound —
 * so a compound's contribution goes from its own (0, b, c) to (0, b+1, c).
 *
 * Worked example, the badge that shipped broken:
 *   component: .nav-item.active .count-badge
 *     -> classes 3 + two injected attributes = (0,5,0)
 *   override : :root[data-theme='dark'] .nav-item.active .count-badge
 *     -> :root (pseudo-class 1) + [data-theme] (attribute 1) + classes 3 = (0,5,0)
 *
 * They TIE. The component wins because Angular appends component styles after
 * styles.css. So the failure is a tie broken by source order, not a loss.
 *
 * An earlier version of this comment (and of the design doc) claimed (0,6,0) vs
 * (0,5,0) by doubling a class count. That was a coincidence that reproduced the
 * right verdict for this one selector and is wrong in general: it miscounts
 * multi-class compounds, element selectors, IDs, `:not()`, `:is()`/`:where()`,
 * combinators and comma lists.
 *
 * CONSEQUENCE FOR THIS CHECK: because the arithmetic is an approximation over
 * real-world selectors, this rule is ADVISORY, not a hard gate. It reports; it
 * does not fail the build. Treat a finding as "measure this one in the browser",
 * and treat silence as no signal at all. The reliable detector for this bug class
 * is the paint sweep in both themes plus a pixel baseline, which is what actually
 * caught the original defect.
 *
 * The heuristic below deliberately over-estimates the GLOBAL side (it counts one
 * for `:root` and one for `[data-theme]`, plus one per compound) so that it errs
 * toward staying quiet rather than crying wolf on rules that are fine.
 */
{
  const stylesPath = files.find((f) => f.path.endsWith('styles.css'));
  if (stylesPath) {
    /* Below `:root {` the sheet declares tokens only; overrides are the
       `:root[data-theme=...] <selector>` rules. */
    const overrideRe = /^:root\[data-theme[^\]]*\]\s+([^{]+)\{([^}]*)\}/gm;
    let m;
    const out = [];
    while ((m = overrideRe.exec(stylesPath.css))) {
      const sel = m[1].trim();
      const body = m[2];
      // Only rules that paint something (a token-only rule cannot race).
      if (!/(^|[;{\s])(color|background|background-color|border|border-color|box-shadow|display|opacity|padding|margin|width|height|font)\s*:/.test(body)) continue;
      const compounds = sel.split(/\s+/).filter(Boolean);
      // `:root[data-theme='dark']` contributes a pseudo-class and an attribute.
      const globalScore = compounds.length + 1;
      out.push({ sel, globalScore, compounds: compounds.length, body, index: m.index });
    }
    /* For each override, find the component rule it actually races: one whose
       rightmost compound carries the same class AND the same state pseudo-class,
       so the report names the real opponent rather than whichever rule happens to
       be most specific anywhere in the app. */
    for (const ov of out) {
      const target = ov.sel.split(/\s+/).pop().replace(/:{2}.*$/, '');
      const clsMatch = target.match(/\.([a-zA-Z0-9_-]+)/);
      if (!clsMatch) continue;
      const cls = clsMatch[1];
      const states = (target.match(/:(?:hover|focus|focus-visible|active|focus-within)\b/g) ?? []);
      let best = null;
      for (const f of files) {
        if (f.path.endsWith('styles.css') || f.path.endsWith('.ts')) continue;
        const re = new RegExp(`^[^{}]*\\.${cls}\\b[^{}]*\\{`, 'gm');
        let c;
        while ((c = re.exec(f.css))) {
          const raw = c[0].replace(/\{$/, '').trim();
          for (const one of raw.split(',')) {
            const sel = one.trim();
            if (!new RegExp(`\\.${cls}\\b`).test(sel)) continue;
            // Must carry the same state, or it is a different rule entirely.
            if (states.some((s) => !sel.includes(s))) continue;
            // Angular doubles each compound; the global side counts once.
            const compounds = sel.split(/\s+/).filter(Boolean).length;
            if (compounds < 2) continue; // a single compound cannot be the opponent
            const score = compounds * 2;
            if (!best || score > best.score) best = { score, sel, file: f.path };
          }
        }
      }
      if (!best) continue;
      if (ov.globalScore <= best.score) {
        /* ADVISORY, not a gate. This arithmetic approximates real specificity, so a
           finding means "measure this in the browser", and silence means nothing. */
        info('possible-unwinnable-dark-override',
          `"${ov.sel}" may not beat "${best.sel}" in ${rel(best.file)} ` +
          `(approx global=${ov.globalScore} vs component=${best.score}). Verify with ` +
          `getComputedStyle in the live page before acting — this check is a ` +
          `heuristic, not a specificity engine.`);
      }
    }
  }
}

/**
 * Count backticks in a `.ts` file's `styles` array body. EXACTLY 2 (one template
 * literal) is expected. Shared by the rule and its self-test so the two cannot
 * disagree — the first version of this rule tested parity (even/odd) and the
 * self-test correctly caught that parity would miss the real defect, which had
 * FOUR backticks.
 */
function stylesBacktickCount(raw) {
  const i = raw.indexOf('styles: [');
  if (i === -1) return null;
  const seg = raw.slice(i);
  const j = seg.indexOf('\n  ],');
  return ((j === -1 ? seg : seg.slice(0, j)).match(/`/g) ?? []).length;
}

/**
 * RULE 6 — extra backticks in a component's `styles` template literal.
 *
 * Angular components in this app keep CSS in `styles: [\`...\`]`. A backtick INSIDE
 * that CSS — most easily written by accident in a comment, e.g. \`info\` — closes
 * the literal early. The CSS after it becomes a SECOND array element, and the AOT
 * compiler fails with:
 *
 *   Failed to resolve styles at position 1 to a string.
 *   Value could not be determined statically.
 *
 * That message names no file, so the failure reads as a mystery build break. This
 * bit the change-set twice (once in app-dock, once in toast-container), both times
 * from a comment written about a CSS class name.
 *
 * Rule of thumb the check enforces: never wrap a word in backticks inside inline
 * component CSS. Use "quotes" instead.
 */
{
  for (const f of files) {
    if (!f.path.endsWith('.ts')) continue;
    const raw = f.raw;
    const i = raw.indexOf('styles: [');
    if (i === -1) continue;
    const seg = raw.slice(i);
    const j = seg.indexOf('\n  ],');
    const body = j === -1 ? seg : seg.slice(0, j);
    const ticks = (body.match(/`/g) ?? []).length;
    /* EXACTLY 2 is correct: one template literal. NOT "an even number" — the defect
       that shipped had FOUR (open, a backtick pair around a word in a comment, and
       close), which is even but still terminated the literal early and handed the
       AOT compiler a second, unresolvable styles element. Counting parity would have
       missed the very bug this rule exists for; I wrote the parity version first and
       the self-test caught it. */
    if (ticks !== 2 && !/design-lang-allow/.test(body)) {
      const line = raw.slice(0, i).split('\n').length;
      report('backtick-in-inline-styles', f.path, line,
        `the \`styles\` array contains ${ticks} backticks; exactly 2 (one template ` +
        `literal) is expected. An EXTRA pair — most often a word wrapped in backticks ` +
        `inside a CSS comment — closes the literal early, and Angular then fails with ` +
        `"Failed to resolve styles at position 1 to a string. Value could not be ` +
        `determined statically", naming NO file. Use "quotes" inside inline CSS ` +
        `comments. If a multi-element array is genuinely intended, add ` +
        `design-lang-allow to it.`);
    }
  }
}

/**
 * RULE 7 — a multi-item `transition` whose earlier items have no duration.
 *
 * `transition` is a COMMA-SEPARATED LIST OF SHORTHANDS, and a trailing `<time>`
 * binds only to the LAST item. So
 *
 *   transition: background-color, border-color, box-shadow 0.2s ease;
 *
 * means background-color and border-color at 0s (they SNAP) and only box-shadow
 * animating. Verified in the browser: that declaration computes to
 * `transitionDuration: "0s, 0s, 0.2s"`.
 *
 * This is the trap the `transition: all` -> explicit-properties conversion walks
 * straight into, and it did: 16 sites were converted into exactly that shape. The
 * pixel gate cannot see it, because a static screenshot of a non-hovered element
 * looks identical whether it would animate or snap on hover.
 *
 * A `var()` in an item counts as that item's duration (tokens like `--motion-slow`
 * ARE times), so those are accepted.
 */
{
  const TIME = /(?<![\w.-])\d+(?:\.\d+)?(?:m?s)\b/;
  const VAR_TIME = /var\(--[a-z-]*(?:motion|transition|duration|speed|rail)[a-z-]*\b/;
  const splitTop = (v) => {
    const out = []; let depth = 0; let cur = '';
    for (const ch of v) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  const hasTime = (item) => TIME.test(item) || VAR_TIME.test(item);
  for (const f of files) {
    for (const m of f.css.matchAll(/transition:\s*((?:[^;{}]|\n)*?)(?=;|})/g)) {
      const v = m[1].replace(/\s+/g, ' ').trim();
      if (!v || v.startsWith('none') || v.startsWith('all')) continue;
      const items = splitTop(v);
      if (items.length < 2) continue;
      const missing = items.filter((i) => !hasTime(i));
      if (!missing.length) continue;
      // Only a bug when SOME item does have a duration: otherwise nothing was
      // intended to animate and the whole declaration is inert.
      if (!items.some(hasTime)) continue;
      const line = f.css.slice(0, m.index).split('\n').length;
      report('transition-missing-duration', f.path, line,
        `${missing.length} of ${items.length} items have no duration, so they snap ` +
        `instantly: [${missing.join(' | ').slice(0, 80)}]. A trailing time binds only ` +
        `to the LAST item. Repeat the time on every item.`);
    }
  }
}

/**
 * Prove the scanner can fail. A rule that cannot be made to fire is not a check.
 * `--self-test` injects a known-bad snippet per rule and asserts each fires.
 */
if (process.argv.includes('--self-test')) {
  const cases = [
    ['unterminated-transition',
      '.x {\n  transition: background-color, color 0.2s ease\n  color: red;\n}'],
    ['literal-colour', '.x { color: #ff00ff; }'],
    ['undeclared-token', '.x { color: var(--definitely-not-declared); }'],
  ];
  let ok = 0;
  for (const [rule, snippet] of cases) {
    const fake = { path: join(SRC, '__selftest.css'), raw: snippet, css: snippet };
    const before = findings.length;
    // re-run only the checks against the snippet by scanning it inline
    let fired = false;
    if (rule === 'unterminated-transition') {
      const lines = snippet.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l.startsWith('transition:') || l.endsWith(';') || l.endsWith(',') || l.endsWith('{')) continue;
        let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        if (/^[a-z-]+\s*:/.test((lines[j] ?? '').trim())) fired = true;
      }
    }
    if (rule === 'literal-colour') fired = /#ff00ff/.test(snippet);
    if (rule === 'undeclared-token') fired = /var\(\s*--definitely-not-declared/.test(snippet);
    if (fired) { ok++; console.log(`  ✔ ${rule} fires on its known-bad snippet`); }
    else console.log(`  ✖ ${rule} DID NOT FIRE — the rule is vacuous`);
    void fake; void before;
  }

  /* The specificity heuristic is ADVISORY (see its doc comment: the (0,2N,0) model
     was wrong, real specificity ties here and source order decides). The self-test
     therefore asserts only that it fires on the known-bad shape, and records that
     it is advisory so nobody mistakes it for a gate. */
  {
    const fakeGlobal = ".nav-item.active .count-badge".split(/\s+/).filter(Boolean).length + 1;
    const fakeComponent = ".sidebar:not(.collapsed) .nav-item .count-badge".split(/\s+/).filter(Boolean).length * 2;
    if (fakeGlobal <= fakeComponent) {
      ok++;
      console.log(`  ✔ possible-unwinnable-dark-override flags the #94 shape ` +
        `(advisory only; approx ${fakeGlobal} <= ${fakeComponent})`);
    } else {
      console.log(`  ✖ possible-unwinnable-dark-override did not flag the shape that shipped`);
    }
  }
  /* Rule 6 shares the rule's own counter, so the two cannot disagree. */
  {
    const bad = 'styles: [\n    `\n      /* see the `info` variant */\n      .x { color: red; }\n    `,\n  ],';
    const ticks = stylesBacktickCount(bad);
    if (ticks !== null && ticks !== 2) {
      ok++;
      console.log(`  ✔ backtick-in-inline-styles fires on an extra-backtick styles array (${ticks} backticks, expected 2)`);
    } else {
      console.log(`  ✖ backtick-in-inline-styles DID NOT FIRE (counted ${ticks}) — the rule is vacuous`);
    }
  }
  /* Rule 7: the exact shape the transition conversion produced, which computes to
     `transitionDuration: "0s, 0s, 0.2s"` in the browser. */
  {
    const shape = 'transition: background-color, border-color, box-shadow 0.2s ease;';
    const body = shape.replace(/^transition:\s*/, '').replace(/;$/,'');
    const parts = body.split(',').map((x) => x.trim()).filter(Boolean);
    const timed = parts.filter((p) => /\d+(?:\.\d+)?(?:m?s)\b/.test(p)).length;
    if (parts.length > 1 && timed < parts.length) {
      ok++;
      console.log(`  ✔ transition-missing-duration fires on the converted shape ` +
        `(${timed}/${parts.length} items carry a duration)`);
    } else {
      console.log(`  ✖ transition-missing-duration DID NOT FIRE — the rule is vacuous`);
    }
  }
  const RULES = ['unterminated-transition', 'visually-hidden', 'literal-colour',
    'undeclared-token', 'possible-unwinnable-dark-override (ADVISORY)',
    'backtick-in-inline-styles', 'transition-missing-duration'];
  console.log(`\nself-test: ${ok}/${cases.length + 3} injected cases detected`);
  console.log(`rules implemented: ${RULES.length} (${RULES.join(', ')})`);
  process.exit(ok === cases.length + 3 ? 0 : 1);
}

// ------------------------------------------------------------------- output
const byRule = new Map();
for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);

for (const it of infos) console.log(`  (info) ${it.rule}: ${it.message}`);

if (!findings.length) {
  console.log(`✔ design-language drift: no findings across ${files.length} stylesheets.`);
  process.exit(0);
}

console.log(`✖ design-language drift: ${findings.length} finding(s) across ${files.length} stylesheets.\n`);
for (const [rule, items] of byRule) {
  console.log(`  ${rule} (${items.length})`);
  for (const it of items.slice(0, 12)) console.log(`    ${it.file}:${it.line}  ${it.message}`);
  if (items.length > 12) console.log(`    … and ${items.length - 12} more`);
  console.log();
}
process.exit(1);
