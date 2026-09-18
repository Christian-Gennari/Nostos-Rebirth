### Spike #215 Complete: Obsidian Integration Feasibility, Licensing, & Prototype

We have completed the feasibility evaluation for integrating Obsidian with Nostos's Second Brain. The full Architecture Decision Record is available in [`docs/obsidian-integration-feasibility.md`](../../docs/obsidian-integration-feasibility.md) and the validated prototype is committed in [`spikes/215-obsidian-vault/`](./).

---

#### 1. Integration Pattern Verdicts
1. **UI Embedding / Docking:** **INFEASIBLE.** Obsidian is closed-source Electron; it offers no embeddable web component or browser-hosted web application. Official CLI and Headless offerings (open beta `obsidian-headless`) do not provide a web UI or general vault API (CLI drives a running local desktop instance; Headless is an account-gated transport client for paid Sync/Publish). Streaming via WebRTC/VNC requires 1–2 GB RAM/session, introduces severe latency, degrades touch/mobile reading, and violates Dynalist ToS restrictions on hosting services for third parties.
2. **Local REST API (`localhost:27124`):** **FEASIBLE WITH SEVERE CONSTRAINTS.** Blocked in web browsers by Private Network Access (PNA) and untrusted self-signed TLS certificates. Fails completely when Nostos is hosted on a remote server/NAS or viewed on mobile/tablet. (The plugin also exposes an MCP server at `/mcp/` with 15 vault tools, sharing the same desktop execution constraints).
3. **Headless Vault Export / Sync:** **FEASIBLE (RECOMMENDED).** Emitting standard Markdown files with Dataview-compatible flat YAML frontmatter (ISO-8601 UTC timestamps) and `[[wikilinks]]` directly to a local directory or `.zip` archive has zero runtime overhead and requires no Obsidian process.
4. **OS Protocol Deep Linking (`obsidian://`):** **FEASIBLE.** Standard `<a href="obsidian://open?vault=...&file=...">` links (along with `search`, `new`, `daily`, `unique`, `choose-vault`, `hook-get-address`) provide seamless navigation from Nostos into the user's local Obsidian app.

---

#### 2. Legal & Licensing Status (Dynalist Inc., verified 2026-09-18)
- **Free for all:** As of February 20, 2025, Obsidian is 100% free for all personal and commercial use without mandatory paid licenses.
- **Restrictions:** Terms of Service §Restrictions prohibits sublicensing, distributing, bundling binaries, or hosting Obsidian as a multi-user service.
- **Safe Harbor:** Writing plain Markdown vaults and dispatching `obsidian://` URIs carries **zero licensing risk**.

---

#### 3. The Architectural Boundary
> **Nostos owns reading immersion, text selection, CFI/coordinate highlight anchoring, and reader-coupled note capture; Obsidian owns external zettelkasten synthesis, freeform drafting, and broad multi-vault personal knowledge management.**
>
> What crosses the boundary is projected read-only Markdown and flat YAML frontmatter pushed from Nostos to the vault filesystem. Internal e-reader coordinates (`CfiRange`, PDF coordinates, playback fractions) and transient reading states can never cross as mutable state because external Markdown editors lack EPUB/document spine awareness and will corrupt or drop them.

---

#### 4. Prototype Verification (`spikes/215-obsidian-vault/`)
A stdlib-only Python generator and validator were executed. Because this repository is public and the author's real reading notes are private, the committed sample vault (`sample/`) is generated from a synthetic fixture database (`fixtures/nostos-fixture.db` built deterministically via `fixtures/build_fixture.py`), and real library output (`out/`) is gitignored.

- **Synthetic Fixture Sample Vault (`sample/`):**
  - **Emitted:** 16 Markdown files (6 notes, 5 books, 4 concepts, 1 master index). Exercises same-title format disambiguation (`(physical)` vs `(edition)`), EPUB CFIs, PDF `pageNumber` JSON, audiobook seconds + chapter mapping, missing CFIs, notes with/without selected text, and wikilinks.
  - **Frontmatter:** 100% flat scalar properties compatible with Dataview, formatted with ISO-8601 UTC timestamps (no nested maps). Superset of `formatNotesMarkdown()` conventions from PR #195 (`updated_at` mirrors `created_at` pending Issue #210 EF migration).
  - **Wikilinks:** 39 total `[[wikilinks]]` parsed across all files; **100% resolved** with 0 broken links.
  - **Round-Trip Integrity:** 67 assertions verified that CFI ranges, book links, note content, highlighted excerpts, and ISO-8601 UTC timestamps match the database exactly.
  - **Status:** **PASSED** (0 errors).

- **Local Real-Library Run (Counts Only):**
  - Run locally against `Nostos.Backend/nostos.db` into `out/`: 140 files generated (63 notes, 23 books, 53 concepts, 1 index).
  - 387 wikilinks parsed; **100% resolved** (0 broken links).
  - 684 round-trip assertions verified against the real database with 0 errors and 100% ISO-8601 UTC compliance.

- **Reproduction Commands:**
  ```bash
  # Fixture run (sample vault)
  python3 spikes/215-obsidian-vault/fixtures/build_fixture.py spikes/215-obsidian-vault/fixtures/nostos-fixture.db
  python3 spikes/215-obsidian-vault/generate_vault.py spikes/215-obsidian-vault/fixtures/nostos-fixture.db spikes/215-obsidian-vault/sample
  python3 spikes/215-obsidian-vault/validate_vault.py spikes/215-obsidian-vault/sample spikes/215-obsidian-vault/fixtures/nostos-fixture.db

  # Real-library run (uncommitted local vault)
  python3 spikes/215-obsidian-vault/generate_vault.py Nostos.Backend/nostos.db spikes/215-obsidian-vault/out
  python3 spikes/215-obsidian-vault/validate_vault.py spikes/215-obsidian-vault/out Nostos.Backend/nostos.db
  ```

---

#### 5. Recommendation & Follow-up Path
1. **Retain Nostos's internal Second Brain** (`/second-brain`) as the primary reader-native knowledge explorer.
2. **Implement one-way vault export under Issue #210** (`ExportService.ExportObsidianVaultAsync()` emitting zip/directory).
3. **Add optional "Open in Obsidian" deep link buttons** on note cards.
4. Explicitly reject browser UI embedding and bidirectional sync from product scope.
