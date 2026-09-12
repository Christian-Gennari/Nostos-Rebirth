# Nostos Writing Studio — Editor Replacement & Studio Redesign

**Status:** research + plan only. No code changes made.
**Date:** 2026-09-11
**Author:** Hermes (research run for C.G.)
**Scope:** replace TinyMCE in `writing-studio`, and redesign the studio around the Zen-first brief.

---

## 0. TL;DR

1. **Recommendation: Tiptap 3.31.3 (ProseMirror), headless, used directly from Angular — no React, no `ngx-tiptap`.**
   MIT, framework-agnostic, and its first-party `@tiptap/markdown` package is built on `marked@17` — the *same* parser Nostos already ships. No `iframe`, no `::ng-deep`, no asset-copy in `angular.json`.
2. **Measured editor payload drops from 440.0 kB gzip to 169.1 kB gzip (one lazy chunk), and 13 MB of `wwwroot/tinymce` disappears entirely.**
3. **Today's pipeline is provably lossy: I ran the actual `marked` → HTML → `turndown` round-trip, and Markdown tables are destroyed, multi-line blockquotes are collapsed into one line, `*italic*` becomes `_italic_`, and bullets are rewritten to `*   ` with 4-space indents.** Tiptap fixes all four; it normalises whitespace but keeps the semantics.
4. **The one thing that needed proof — `[[Concept]]` wikilinks — works.** I built a 40-line custom Tiptap node and round-tripped `[[Philosophy of Mind]]` intact through sentence, heading, list item and blockquote contexts in a real browser. Without it, both Tiptap *and* Milkdown escape the brackets and break the concept graph.
5. **Known Tiptap-Markdown limits to plan around:** loose lists collapse to tight, an escaped pipe (`\|`) inside a table cell breaks the row, YAML frontmatter is mangled, raw HTML blocks are dropped. All measured, all documented in §3.4. **Milkdown, the runner-up, ties Tiptap exactly on this corpus (both 15/26 vs today's 6/26)** and actually wins on loose lists, footnotes and raw HTML — but loses hard line breaks and offers far fewer first-party UI primitives. See §2.2 and §3.4.
6. **Studio redesign: keep the paper, delete the chrome, and move knowledge access into the text.** Zen mode should not be a "mode" — it should be the default, with the sidebars as on-demand overlays (`Cmd/Ctrl+O`, `[[`, `@`, `/`).

---

## 1. What the codebase actually does today (verified)

| Fact | Evidence |
| --- | --- |
| Editor is TinyMCE 8.8.2, self-hosted, GPL key | `Nostos.Frontend/package.json:44` (`"tinymce": "^8.8.2"`), `markdown-editor.component.ts:424` (`license_key: 'gpl'`) |
| TinyMCE is bundled as an **initial** script + 13 MB asset tree | `Nostos.Frontend/angular.json:34-39` — assets `node_modules/tinymce` → `/tinymce/`, scripts `tinymce.min.js` |
| Content is stored as **Markdown** in SQLite | `Nostos.Backend/Data/Models/WritingModel.cs:22` (`public string? Content`) |
| Every load/save is a conversion round-trip | `markdown-editor.component.ts:493` (`marked.parse`), `:502-505` (compare via `turndownService.turndown`), `:467` (emit HTML on change) |
| Editor is styled by fighting the iframe | `markdown-editor.component.ts:309-396` (~90 lines of `::ng-deep`), `src/tinymce-nostos.css` (whole file), `content_style` CSS-in-TS (`:120-287`) |
| Reference insertion bypasses the editor entirely | `writing-studio.component.ts:395-403` — appends `> "note text"` to the *markdown signal*, so the editor effect replaces content wholesale (cursor lost, undo history broken) |
| Autosave is a 2 s `setTimeout` with no offline queue or retry | `writing-studio.component.ts:187-217` |
| Zoneless: no `zone.js`, no `polyfills` entry | `Nostos.Frontend/package.json`, `angular.json` (no polyfills), `src/main.ts` — Angular 21 defaults to zoneless ([angular.dev/guide/zoneless](https://angular.dev/guide/zoneless): *"Zoneless is the default in Angular v21+"*) |
| Wikilink autocomplete infra already exists — but for a `<textarea>` | `core/directives/concept-autocomplete.directive.ts`, used only in `ui/concept-input.component/concept-input.component.html:12` |
| Zen mode already exists (issue #49) | `writing-studio.component.ts:237-266`, `body.nostos-zen` class |

**Design contract that must survive the swap:** `styles.css:167-182` defines `--editor-ui-*` tokens as *"the stable contract between Nostos and the editor chrome"*. With a headless editor these become ordinary component CSS — no bridge, no overrides.

### 1.1 Measured cost of the current editor (not estimated)

`Nostos.Backend/wwwroot/tinymce` is **13 MB on disk**. The part actually downloaded at runtime:

| Asset | raw | gzip |
| --- | --- | --- |
| `tinymce.min.js` (**initial bundle**, `scripts` array) | 475.1 kB | 165.6 kB |
| `themes/silver/theme.min.js` | 435.9 kB | 139.6 kB |
| `models/dom/model.min.js` | 93.7 kB | 31.8 kB |
| `icons/default/icons.min.js` | 109.5 kB | 29.1 kB |
| `skins/ui/oxide/skin.min.css` | 174.0 kB | 24.1 kB |
| `skins/ui/oxide/content.min.css` + content skin | 43.5 kB | 8.2 kB |
| 7 configured plugins (`lists,link,image,table,wordcount,searchreplace,quickbars`) | 117.2 kB | 36.5 kB |
| **Total runtime payload** | **~1.45 MB** | **440.0 kB** |

Additional context: the app's initial `scripts-*.js` bundle is 475.5 kB raw / 175.9 kB gzip — i.e. **essentially all of it is TinyMCE**, loaded on every route.

### 1.2 Measured cost of the candidates (built with esbuild, minify, gzip -9)

Method: fresh `/tmp/editor-bench`, real npm installs, bundled per candidate with the closest equivalent feature set (headings, marks, lists, blockquote, code block, tables, links, images, placeholder, floating menu, mentions, citation-style node).

| Candidate | raw (min) | **gzip** | note |
| --- | --- | --- | --- |
| TinyMCE 8.8.2 (today, runtime total) | ~1.45 MB | **440.0 kB** | + 13 MB on disk, includes initial 165.6 kB |
| Tiptap 3.31.3 — StarterKit only | 371.2 kB | 117.1 kB | |
| **Tiptap 3.31.3 — full target feature set** | **536.6 kB** | **169.1 kB** | 1 lazy chunk, 0 assets |
| Milkdown 7.22.1 — kit + commonmark + history | 358.3 kB | 108.4 kB | |
| Milkdown 7.22.1 — Crepe (ready-made) | 2 677.0 kB | 885.6 kB | bundles CodeMirror + KaTeX paths |
| CodeMirror 6 (markdown, full keymap/autocomplete/search) | 554.0 kB | 188.6 kB | syntax highlighting only — **not** WYSIWYG |

**Read:** Tiptap ≈ 38 % of the current runtime editor weight and can be lazy-loaded off the initial bundle, so first paint loses the 165.6 kB entirely.

---

## 2. Candidate evaluation

| | Tiptap 3.31.3 | Milkdown 7.22.1 | MDXEditor 4.2.4 | Lexical 0.50.0 | BlockNote 0.54.2 | CodeMirror 6 |
| --- | --- | --- | --- | --- | --- | --- |
| License (verified on npm) | MIT (`@tiptap/core` and every extension used) | MIT | MIT | MIT | MPL-2.0 | MIT |
| Paid tier? | Editor OSS is MIT & free; only AI toolkit / collaboration / comments / history need Tiptap Platform — [tiptap.dev/open-source-to-platform](https://tiptap.dev/open-source-to-platform) | none | none | none | none | none |
| Markdown model | **First-party `@tiptap/markdown`** (marked-based lexer → JSON, per-extension renderers) | remark/MDAST based, WYSIWYG-first | MDAST visitors, markdown-first | Lexical has no first-party MD tree; `@lexical/markdown` is import/export only | Lark/Block JSON; MD is partial | raw text = MD (no model conversion) |
| Framework fit for Angular 21 | framework-agnostic core; vanilla `new Editor({element})` | framework-agnostic | **React component — hard no for Angular** | framework-agnostic | React-first | framework-agnostic |
| Angular wrapper | `ngx-tiptap` 14.0.1 (MIT, peer `@angular/core >= 20`) — optional, not required | none needed | — | — | — | `@uiw/react-codemirror` etc. (not needed) |
| WYSIWYG "paper" look | yes | yes | yes | yes | yes | **no** (source view only) |
| Maintenance (verified publish dates) | **2026-09-04**, 3.31.3 | 2026-08-12 | 2026-09-09 | **2026-09-11** | 2026-09-09 | 2026-09-03 |
| Verdict | **adopt** | viable fallback | rejected (React) | rejected (no 1st-party MD) | rejected (React-first, MPL) | rejected (not WYSIWYG) |

### 2.1 Maintenance health (GitHub API, 2026-09-11)

| Repo | stars | forks | open issues | last push | licence |
| --- | --- | --- | --- | --- | --- |
| `ueberdosis/tiptap` | 38 350 | 3 119 | 846 | 2026-09-08 | MIT |
| `Milkdown/milkdown` | 11 906 | 552 | **36** | 2026-09-11 | MIT |
| `facebook/lexical` | 23 845 | 2 223 | 297 | 2026-09-11 | MIT |
| `TypeCellOS/BlockNote` | 10 172 | 773 | 219 | 2026-09-09 | MPL-2.0 (npm) |
| `mdx-editor/editor` | 3 670 | 306 | 88 | 2026-09-09 | MIT |
| `codemirror/dev` | 7 818 | 473 | 12 | 2026-04-15 | MIT |

Honest caveat: Tiptap carries the largest issue backlog (846) — expected for the biggest ecosystem, but it means upstream bugs like the escaped-pipe table case may sit. Milkdown is materially leaner (36 open issues) and would be the fallback if Tiptap's Markdown extension (still flagged "early release") proves unstable in practice.

### 2.2 Fairness note on Milkdown

Milkdown is a legitimate alternative, not a strawman. Its lean ProseMirror+remark build is *smaller* than Tiptap's (108.4 kB gzip measured), and its GitHub backlog is far cleaner (36 open issues vs Tiptap's 846). The deciding factor is not fidelity — see §3.4, where the two tie — but **UI primitives**: Tiptap ships first-party MIT bubble-menu, placeholder, suggestion/mention, focus, character-count and typography extensions, which is exactly the "chrome-free, in-text knowledge" design in §4. In Milkdown those are hand-rolled or third-party, and its ready-made Crepe build costs 885.6 kB gzip (measured), i.e. 5× Tiptap's full set. A subagent independently ranked Milkdown #1 on a "MDAST-native fidelity" argument with bundle figures of ~146 kB (Milkdown) vs ~174 kB (Tiptap); **I could not reproduce those numbers and my measurements contradict them** — treat that ranking as unverified.

**Why not `ngx-tiptap`:** it is a convenience wrapper (1 dependency, peers `@floating-ui/dom`) but adds an abstraction over an API that is already framework-agnostic and signal-friendly. The Nostos doctrine ("native, bloat-free, proven") argues for instantiating Tiptap directly in one component and pushing `contentChange` / `wordCount` through signals. Note it is also the least recently updated piece (2025-08-16).

---

## 3. The decisive test: Markdown round-trip fidelity

I did not take this on faith. I built two real browser harnesses (`/tmp/editor-bench/roundtrip.html`, `roundtrip2.html`), bundled with esbuild and executed in real Chrome.

### 3.1 Harness 1 — Tiptap vs the current pipeline (25 cases)

Current pipeline = what Nostos ships today: `marked.parse()` → HTML → `TurndownService.turndown()`.

| Input | today (`marked`+`turndown`) | Tiptap 3.31.3 |
| --- | --- | --- |
| `\| a \| b \|` table | **destroyed** → `a\n\nb\n\n1\n\n2` | table preserved (padding normalised) |
| multi-line blockquote | **collapsed** → `> Line one of the quote line two continues here.` | preserved on two lines |
| `*italic*` | rewritten to `_italic_` | `*italic*` kept |
| nested list | rewritten to `*   ` + 4-space indents | `- top\n  - child` kept |
| `- [ ] todo` | lost (plain bullets) | **lost too unless `TaskItem` is added** (see harness 2) |
| `[[Philosophy of Mind]]` | **escaped** → `\[\[Philosophy of Mind\]\]` | **escaped too** unless a custom node is registered (see harness 2) |
| `---` rule | rewritten to `* * *` | kept |
| YAML frontmatter | mangled | mangled |
| `[text][ref]` links | inlined | inlined |
| `<div>` HTML block | dropped | dropped |
| `<br>` | hard break | hard break |
| indented code block | fenced | fenced |

### 3.2 Harness 2 — Tiptap with the extensions Nostos needs (16 cases)

Added: `TaskList`/`TaskItem`, plus a **custom `wikilink` inline atom node** (markdownTokenizer + `parseMarkdown` + `renderMarkdown`), plus a **custom `referenceCard` block node** via `createBlockMarkdownSpec`.

| Case | Result |
| --- | --- |
| `[[Philosophy of Mind]]` alone / in a sentence / in a heading / in a list item / in a blockquote | **round-trips intact** |
| `[[Marcus Aurelius / Meditations]]` (spaces + slash) | **intact** |
| `[[A]] [[B]]` adjacent | **intact** |
| `- [ ] todo` / `- [x] done`, nested | **intact** |
| `:::reference {source="Simone Weil"}` custom block | **intact** |
| plain table | preserved, cells padded to column width |
| table with escaped pipe in a cell | **broken** → `\| x \| y \| z \|` splits the row *(upstream limitation)* |
| loose list (`- one\n\n- two`) | **collapses to tight list** *(upstream limitation)* |
| every case | trailing/blank-line differences → **needs a canonicalised save, not `===` comparison** |

### 3.3 What this means for the implementation

- A **custom `wikilink` node is mandatory**, not optional. Without it, every `[[Concept]]` in the studio becomes `\[\[Concept\]\]` — which would silently break the concept graph.
- The `[[...]]` node should accept marks (`marks: ''`) or be implemented as a mark, otherwise `**[[Attention Economy]]**` drops the bold (measured).
- Save must go through a **normaliser** (trailing newline, blank lines around block nodes) and a **dirty check based on the editor's own serialised output**, never on a freshly re-serialised string. The current `currentMarkdown.trim() !== markdown.trim()` guard (`markdown-editor.component.ts:503`) is exactly the pattern that causes full-document resets and cursor jumps.
- Escaped pipes in table cells need a small serializer patch or a documented "no `\|` in cells" rule.

---

### 3.4 Head-to-head, same corpus, three engines (final scoreboard)

26-case corpus, real Chrome, whitespace + benign-syntax variants folded (bullet marker `*`/`-`, thematic-break spelling, hard-break spelling, table padding, code-fence style), so these percentages reflect **semantic** fidelity, not formatting churn.

| Pipeline | semantically identical |
| --- | --- |
| **today** `marked` + `turndown` | **6 / 26 (23 %)** |
| **Tiptap 3.31.3** (+ wikilink node, tasks, tables, images) | **15 / 26 (58 %)** |
| **Milkdown 7.22.1** (commonmark + gfm) | **15 / 26 (58 %)** |

**The two engines tie on fidelity — so the choice must be made on *which* failures you can live with:**

Where Tiptap beats Milkdown:
- `[[wikilinks]]` — intact (with the custom node I wrote); Milkdown escapes them to `\[\[…]]` because it has no wikilink plugin either.
- hard line breaks — preserved (`<br>` → two-space break); **Milkdown drops the break entirely** (`line one<br>line two` → `line oneline two` — a real content loss).
- task lists, nested-list markers, `---` rules, and standard table separator syntax (`| :--- | ---: |` vs Milkdown's unusual `| :- | -: |`).

Where Milkdown beats Tiptap:
- **loose lists are preserved** (`- one` / blank / `- two`); Tiptap collapses them to a tight list (still *both* fail my rubric's exact form, but Milkdown keeps the structure).
- footnotes round-trip; raw HTML blocks round-trip; autolinks round-trip.

Both fail, in both engines: indented code → fenced code, reference-style links → inline links, table cells re-padded, `\#` → `#`, and YAML-ish frontmatter is mangled (Milkdown's is worse — it turns `title:` into a setext heading).

**Why this still lands on Tiptap:** the wikilink result is the one Nostos cannot compromise on, and the fidelity tie means the tiebreaker is ecosystem — first-party MIT bubble menu / suggestion / mention / focus / character-count extensions are precisely what §4's in-text-knowledge design is built from. Milkdown remains the documented fallback; if loose-list preservation turns out to matter, it can be added to Tiptap later with a small post-serialisation pass (or a `tight`/`loose` attribute on list nodes), which is cheaper than hand-building Milkdown's UI layer.

## 4. Recommended target design: Zen-first studio

The brief was "zen like is key". The current studio is a 3-panel code-editor layout with a Word-style toolbar bolted on (`writing-studio.component.html:1-268`). Proposal:

### 4.1 The default state is already zen
- Paper column stays: `width: min(100%, 740px)`, white sheet, 10 px radius, three-layer shadow (keep `writing-studio.component.css:410-427` verbatim).
- **Delete the top toolbar.** Formatting appears only on selection as a **bubble menu** (bold, italic, H2, quote, link) — `@tiptap/extension-bubble-menu` (MIT, already measured in the 169.1 kB).
- **Word count / save pill**: keep the existing `.editor-status-pill` but fade it to `opacity: 0` while typing and restore on pause/pointer-move (currently hidden only in zen, `writing-studio.component.css:476-478`).
- **Document title lives in the paper** (inline `h1`) instead of a header bar; two-way bound to `WritingModel.Name`.

### 4.2 Knowledge comes to the cursor, not the panel
Replace "click a note in the right sidebar → markdown gets rewritten" with in-text gestures:
- `[[` → existing `ConceptAutocompleteService` results, inserted as a real `wikilink` node (reuses `ui/concept-autocomplete-panel/`).
- `@` → the *existing* right-sidebar data (Concepts + Books notes) as an inline mention/quote picker; inserts the note as a **`referenceCard` block node** carrying `source` (book/concept + selectedText), so provenance is in the document rather than lost.
- `/` → slash menu: heading levels, quote, code, table, divider, reference card.
- The right sidebar survives as an **on-demand inspector** (`Cmd/Ctrl+O` overlay in zen; the roadmap's §4.3 "Quick Reference"), not as a permanent third column.

### 4.3 Zen mode becomes a state, not a mode
- `Esc` still exits, but zen is the default on mobile and the persisted default on desktop. **Design note:** VS Code requires a *double* `Esc` to leave zen precisely so a stray keypress doesn't eject the writer — worth copying ([VS Code default keybindings](https://code.visualstudio.com/docs/reference/default-keybindings)).
- **Typewriter scrolling** (roadmap §4.2) is a Tiptap extension away: keep the caret at ~50 % viewport height on `onSelectionUpdate`. Verified prior art: iA Writer documents "Typewriter" as one of three focus settings (the caret "remains vertically centered… when typing or moving up or down"), separate from its dimming modes ([iA Writer Focus Mode](https://ia.net/writer/support/editor/focus-mode)). **Critical detail from iA Writer's own docs:** *"A conflict between the area you will select to edit and Focus Mode's attempt to vertically center the cursor might result in the screen jumping vertically"* — they ship a warning telling users to toggle it off while editing. So: a scroll **dead zone** (hysteresis of ~3 lines) before recentering is mandatory, not a nicety. Bear/Lettera's "dead zone" discussion is *secondary* evidence (community thread, unverified).
- **Focus dimming** — ship it *off by default*. iA Writer's `⌘D` offers Sentence / Paragraph / Typewriter, and paragraph-level dimming at ~45–55 % opacity is the widely preferred setting (sentence dimming is the most complained-about variant). Implement via a ProseMirror decoration on the active block rather than CSS alone.
- Markdown input rules (`# `, `> `, `- `, `1. `) come free with StarterKit.
- **Slash menu taxonomy** worth copying from Craft/Notion: Structure (H1–H3, body, quote, callout) · Lists (bullet, numbered, task) · Media (image, code, table, divider) · Reference (concept `[[`, book note, quote card).

### 4.4 Mobile
- The current mobile layout already goes edge-to-edge (`writing-studio.component.css:587-600`); with a DOM-first editor there is no iframe to fight on iOS.
- Keyboard-eats-caret and IME/composition handling are the real risks (§6).

---

## 5. Phased implementation plan

> Each task is bite-sized and independently verifiable. No code has been written yet.

### Phase 0 — Safety net (do first, no behaviour change)
**Task 0.1 — Freeze the contract in tests**
- Files: `src/app/writing-studio/writing-studio.component.spec.ts` (33 specs as of today), `src/app/ui/markdown-editor/markdown-editor.component.spec.ts` (mocks the global `tinymce`, `:5-82`).
- Good news from the audit: only **two** of the 33 studio specs are TinyMCE-coupled — `writing-studio.component.spec.ts:165` ("prefers the editor wordcount-plugin count") and `:386` ("lets `.tox-tinymce` fill and clip to the paper frame"). The zen/paper-frame tests (`:180-350`, `:375-413`) are engine-agnostic and must stay green unchanged.
- Action: delete `markdown-editor.component.spec.ts` (it asserts TinyMCE internals only) and rewrite the two coupled studio specs against the new component contract: `initialContent` in → `contentChange` out, one editor instance per lifecycle, word-count emission, paper frame fills without its own shadow.
- Verify: `npx vitest run src/app/writing-studio src/app/ui/editor` — expected: green, no `tinymce` global anywhere in the specs.

**Task 0.2 — Golden-file corpus**
- Create `src/app/ui/editor/__fixtures__/roundtrip/*.md` with ~20 real documents (including `[[wikilinks]]`, quotes, tables, code fences).
- Add `src/app/ui/editor/markdown-roundtrip.spec.ts` that asserts `serialize(parse(md)) === normalise(md)`.
- Verify: `npx vitest run markdown-roundtrip` — expected: green against the normaliser, catching regressions for good.

### Phase 1 — Swap the engine behind the same component contract
**Task 1.1 — Add dependencies**
```bash
npm i @tiptap/core@3.31.3 @tiptap/pm@3.31.3 @tiptap/starter-kit@3.31.3 \
      @tiptap/markdown@3.31.3 @tiptap/extension-bubble-menu@3.31.3 \
      @tiptap/extension-placeholder@3.31.3 @tiptap/extension-table@3.31.3 \
      @tiptap/extension-link@3.31.3 @tiptap/extension-image@3.31.3 \
      @tiptap/extension-list@3.31.3 @tiptap/extension-mention@3.31.3 \
      @tiptap/suggestion@3.31.3
npm rm tinymce
```
- Verify: `npm ls tinymce` → empty; `npx ng build` still succeeds.

**Task 1.2 — `wikilink` extension (the critical one)**
- Create `src/app/ui/editor/extensions/wikilink.ts` — inline atom node, `markdownTokenizer` on `[[...]]`, `parseMarkdown` → `{target}`, `renderMarkdown` → `[[target]]`, `parseHTML` on `span[data-wikilink]`.
- Test: unit spec parsing `[[A B]]` → doc → `[[A B]]` (mirrors harness 2, which passed).
- Verify: `npx vitest run wikilink` — expected: 3 passed.

**Task 1.3 — `referenceCard` extension**
- Create `src/app/ui/editor/extensions/reference-card.ts` using `createBlockMarkdownSpec({nodeName:'referenceCard', name:'reference', content:'block', allowedAttributes:['source']})`.
- Verify: serialised output matches the `:::reference {source="…"}` form verified in harness 2.

**Task 1.4 — New component `app-editor`**
- Create `src/app/ui/editor/editor.component.ts` — headless Tiptap, no iframe, signal inputs/outputs, teardown in `ngOnDestroy`, `contentType: 'markdown'` on set, `editor.getMarkdown()` on change.
- **Zoneless note (important, and easy to get wrong):** Nostos runs **without zone.js** (verified: no `polyfills` entry in `angular.json`, no `zone.js` dependency, `app.config.ts` has no CD provider — Angular 21 is zoneless by default). That is good news: ProseMirror's own transaction loop never triggers change detection, so there is no per-keystroke dirty-check. The bridge is simply `editor.on('update', () => this.contentChange.emit(editor.getMarkdown()))` — emitting into a signal is what schedules rendering. Do **not** add `provideZonelessChangeDetection()` or `runOutsideAngular`; neither is needed and the latter implies a zone that isn't there.
- **Lazy-load it:** wrap the editor in Angular's `@defer` so `@angular/build` extracts it into its own chunk. This is what actually removes the 165.6 kB from the initial bundle, and it needs no routing change.
- Delete `src/app/ui/markdown-editor/markdown-editor.component.ts`, `src/app/ui/markdown-editor/markdown-editor.component.spec.ts`, `src/tinymce-nostos.css`.
- Modify `writing-studio.component.html:87-91` to use the new selector; `writing-studio.component.ts:45` import.
- Verify: `npx ng build` → **initial bundle should drop ~165 kB gz**; `ls Nostos.Backend/wwwroot/tinymce` → gone.

**Task 1.5 — Clean `angular.json`**
- Remove the `node_modules/tinymce` asset entry, the `src/tinymce-nostos.css` style, and the `tinymce.min.js` script (`angular.json:34-39`).
- Remove `--editor-ui-*` → editor bridge comments in `src/styles.css:165-182`, keep the tokens for the bubble menu.
- Verify: `npx ng build && du -sh dist/*` — expected: no `tinymce` directory, build smaller.

### Phase 2 — Chrome & zen
**Task 2.1** bubble menu styled from `--editor-ui-*` + `--glass-*` (no `::ng-deep`).
**Task 2.2** status pill fade-on-typing (`writing-studio.component.css:447-478`).
**Task 2.3** inline title `h1` bound to `editorTitle()`; drop `editor-header`'s toolbar remnants.
**Task 2.4** zen as default; persist per document; `Esc` exits (keep `writing-studio.component.ts:237-266` semantics and the focus-restore behaviour).
**Task 2.5** typewriter scrolling + optional focus dimming, behind a settings flag.

### Phase 3 — Knowledge in the text
**Task 3.1** `[[` → `ConceptAutocompleteService` (`ui/concept-autocomplete-panel/concept-autocomplete.service.ts`) feeding a Tiptap `Suggestion` popup; insert `wikilink` node. Replaces the textarea-only `ConceptAutocompleteDirective` for the studio.
**Task 3.2** `@` → concepts + books + notes, using the data already loaded in `writing-studio.component.ts:128-163`.
**Task 3.3** slash menu (`/`) for block transforms.
**Task 3.4** delete `insertNoteIntoEditor`'s markdown-string rewrite (`writing-studio.component.ts:395-403`) in favour of `editor.commands.insertContent` at the caret; keeps undo history intact.
**Task 3.5** zen overlay for the right sidebar (`Cmd/Ctrl+O`) per roadmap §4.3.

### Phase 4 — Durability
**Task 4.1** replace the 2 s `setTimeout` autosave (`writing-studio.component.ts:201-216`) with a three-tier save: (1) **immediate** local write of the serialised Markdown to IndexedDB on every update transaction (sub-millisecond, survives tab crash / iOS app kill), (2) debounced (~1.5–2 s) PUT to the API, (3) an **idle/hidden flush** — flush pending work on `requestIdleCallback` and, critically, on `visibilitychange` when `document.visibilityState === 'hidden'`, which is the only reliable hook on mobile Safari. IndexedDB rather than `localStorage` because it is async and quota-scaled.
**Task 4.2** conflict guard: send `UpdatedAt` (or a content hash) with the PUT and surface a "kept your version / took theirs" toast. If it is ever worth matching Bear's behaviour, the safe pattern is to *keep both* copies and badge the conflict rather than silently overwrite.
**Task 4.3** **service-worker hazard unique to this migration:** `ngsw-config.json` prefetches `/*.js` for the app shell, but the editor becomes a **lazy chunk**. Today `wwwroot/tinymce` is fetched as a plain asset (and is not in `ngsw-config.json` at all). After the swap, put the lazy editor chunk in an explicit asset group (e.g. `lazy`/`updateMode: prefetch`) so an offline writer can still open a document; otherwise the studio fails to boot offline the first time.

### Validation gate for every phase
```bash
npx vitest run                 # unit
npx playwright test            # e2e: mobile-dock, service-worker-navigation, visual-regression
npx ng build && du -sh Nostos.Backend/wwwroot   # bundle + asset tree check
```
Plus a manual pass: open a document with `[[wikilinks]]`, a table, a quote block and a code fence on desktop **and on the phone**, reload, and diff the stored Markdown.

---

## 6. Risks & open questions

| Risk | Severity | Mitigation |
| --- | --- | --- |
| `[[Concept]]` escaping breaks the concept graph if the custom node is skipped | **high** | make Task 1.2 a hard gate; golden-file test with real wikilinks |
| Loose-list collapse and `\|`-in-cell breakage in `@tiptap/markdown` (measured) | medium | either accept + document, or patch the serializer; add fixtures that pin current behaviour |
| Round-trip whitespace churn triggers autosave/reset loops | medium | canonical normaliser + dirty check from serialised output (Task 0.2) |
| iOS/Android caret + IME behaviour of a contenteditable surface | medium | needs a real-device pass; Playwright mobile emulation is not enough. Real prior art (all confirmed to exist via the GitHub API, and I verified the *titles*: most are now **closed**, i.e. the class of bug is known and mitigable, not currently-open defects): Lexical [#6354](https://github.com/facebook/lexical/issues/6354) (Android IME content consolidation), Lexical [#5841](https://github.com/facebook/lexical/issues/5841) (Korean IME on iOS), Tiptap [#4606](https://github.com/ueberdosis/tiptap/issues/4606) (Android first-character formatting), Tiptap [#5733](https://github.com/ueberdosis/tiptap/issues/5733) (Japanese IME formatting reset), Tiptap [#2629](https://github.com/ueberdosis/tiptap/issues/2629) (caret position inside a scrollable contenteditable on iOS Safari), ProseMirror [#1165](https://github.com/ProseMirror/prosemirror/issues/1165) (visual caret when an atom node — e.g. our wikilink — ends a line in Safari). Note: our `wikilink` node is an **inline atom**, which is exactly the shape [#1165](https://github.com/ProseMirror/prosemirror/issues/1165) is about, so put a Safari/iOS caret check on the Task 1.2 acceptance list. |
| `EditContext` will not save us: MDN classifies it **Experimental / "not Baseline … does not work in some of the most widely-used browsers"** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/EditContext)) — so every engine here stays on `contenteditable` with `beforeinput` interception. No engine on the shortlist relies on it. | low | accept; do not design around it |
| `@tiptap/markdown` is documented as an **early release** ("can be subject to change or may have edge cases") — [tiptap.dev/docs/editor/markdown](https://tiptap.dev/docs/editor/markdown) | medium | pin exact 3.31.3; the golden-file corpus makes upgrades cheap to validate |
| Escaped-pipe table cells silently split rows | low | document; avoid `\|` in cells or patch renderer |
| Note editor (`concept-input`) still uses a textarea — two editing surfaces | low | decide separately; out of scope for this migration |

**Open questions for C.G.:**
1. Should loose lists be preserved (requires post-processing) or is tight-normalisation acceptable?
2. Keep `ngx-tiptap` out, or accept it for convenience? (I recommend out.)
3. Should focus-dimming ship on by default, or stay opt-in? (I recommend opt-in — it is the most common complaint in the category.)
4. Should the notes (`concept-input`) textarea move onto the same engine later?

---

## Appendix A — How the measurements were taken (reproducible)

```bash
# candidate bundle sizes (real installs, esbuild minify, gzip -9)
mkdir -p /tmp/editor-bench && cd /tmp/editor-bench && npm init -y
npm i @tiptap/core@3.31.3 @tiptap/starter-kit@3.31.3 @tiptap/markdown@3.31.3 \
      @tiptap/extension-bubble-menu@3.31.3 @tiptap/extension-table@3.31.3 \
      @tiptap/extension-mention@3.31.3 @tiptap/pm@3.31.3 esbuild @milkdown/crepe \
      @codemirror/lang-markdown @codemirror/view @codemirror/commands
npx esbuild tiptap-full.ts --bundle --minify --format=esm --outfile=out.js
gzip -9 -c out.js | wc -c
```
Round-trip harnesses (all in `/tmp/editor-bench`, all executed in real Chrome):

| Harness | What it does |
| --- | --- |
| `roundtrip.html` | 25 cases — Tiptap 3.31.3 vs today's `marked`+`turndown` |
| `roundtrip2.html` | 16 cases — Tiptap with custom `wikilink` + `referenceCard` + task lists |
| `milkdown-rt.html` | 24 cases — Milkdown 7.22.1 (commonmark + gfm) |
| `compare.html` | **all three engines on one 26-case corpus, with the normaliser** — this is the §3.4 scoreboard (`today 6/26 · tiptap 15/26 · milkdown 15/26`); raw JSON dumped to `~/.hermes/cache/editor-cmp.json` |

### Appendix A.1 — Verification log (what I personally checked vs. what came from delegated research)

**Verified first-hand:** all versions/licences/dates (`npm view`), GitHub repo metrics (`gh api`), the 440.0 kB TinyMCE runtime payload (byte sums + `gzip -9`), the 13 MB asset tree, every bundle number (esbuild + `gzip -9`), every round-trip result above (real Chrome), the zoneless setup (absence of `polyfills`/`zone.js`), TinyMCE's GPLv2+ `license_key` requirement ([tiny.cloud](https://www.tiny.cloud/docs/tinymce/latest/license-key/)), Angular 21 zoneless-default ([angular.dev](https://angular.dev/guide/zoneless)), Tiptap OSS-vs-Platform scope ([tiptap.dev](https://tiptap.dev/open-source-to-platform)), iA Writer's focus-mode warning (quoted verbatim from [ia.net](https://ia.net/writer/support/editor/focus-mode)), MDN's EditContext status, and the existence + titles of all seven cited bug-tracker issues (`gh api`).

**Delegated research, spot-checked:** the zen-writing UX survey (iA Writer, Ulysses, Typora, Bear, VS Code, Zed, Craft, Obsidian) and the Angular/contenteditable engineering dossier. Their load-bearing citations checked out; exceptions I corrected or flag as unverified: (a) a claim that Nostos lacks `provideExperimentalZonelessChangeDetection()` implying zone.js — wrong, the app is zoneless by default; (b) ProseMirror [#878](https://github.com/ProseMirror/prosemirror/issues/878) was cited as a caret bug but its actual title is *"Feature Request: Allow custom `setSelection` behaviour"*; (c) the Milkdown-first ranking and its ~146 kB/~174 kB bundle figures — **not reproducible** by my own measurement; (d) Ulysses' "Fixed Scrolling"/"Line Marker" specifics and Obsidian's `Tab`-keeps-caret-for-alias behaviour: plausible, not independently verified.

**Never taken on faith:** every child summary was treated as unverified until it either reproduced under my own tooling or was checked against a primary source.

## Appendix B — Verified versions & licenses (npm, 2026-09-11)

- `@tiptap/core` 3.31.3 MIT (published 2026-09-04) · `@tiptap/markdown` 3.31.3 MIT (deps: `marked ^17.0.1`) · `@tiptap/starter-kit`, `extension-bubble-menu`, `extension-placeholder`, `extension-table`, `extension-link`, `extension-image`, `extension-mention`, `extension-suggestion`, `extension-focus`, `extension-character-count`, `extension-typography` — all 3.31.3 MIT
- `@milkdown/core` 7.22.1 MIT · `@milkdown/crepe` 7.22.1 MIT
- `@mdxeditor/editor` 4.2.4 MIT (**React-only**)
- `lexical` 0.50.0 / `@lexical/markdown` 0.50.0 MIT
- `@blocknote/core` 0.54.2 MPL-2.0
- `@codemirror/lang-markdown` 6.5.2 MIT · `@codemirror/view` 6.43.11 MIT · `@codemirror/state` 6.7.4 MIT
- `prosemirror-markdown` 1.13.7 MIT · `markdown-it` 15.0.2 MIT · `micromark` 4.0.2 MIT
- `ngx-tiptap` 14.0.1 MIT (peer `@angular/core >=20.0.0`, `@tiptap/core ^3.0.1`; last publish 2025-08-16)
- TinyMCE: GPLv2+ self-hosted via `license_key: 'gpl'` — [tiny.cloud license key docs](https://www.tiny.cloud/docs/tinymce/latest/license-key/). Current usage is licence-compliant for a GPL-3.0 project, so **licensing is not the reason to move**; architecture, fidelity and design control are.
