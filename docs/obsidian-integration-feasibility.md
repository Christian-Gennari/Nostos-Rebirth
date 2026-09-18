# Architecture Decision Record: Obsidian Integration Feasibility for Nostos Second Brain

- **Status:** Proposed (Spike #215 Complete)
- **Date:** 2026-09-18
- **Context:** GitHub Issue [#215](https://github.com/Christian-Gennari/Nostos-Rebirth/issues/215)
- **Related Issues / Docs:**
  - PR [#195](https://github.com/Christian-Gennari/Nostos-Rebirth/pull/195) (Merged: Per-book Markdown notes export)
  - Issue [#210](https://github.com/Christian-Gennari/Nostos-Rebirth/issues/210) (Open: Full-library notes export — JSON / Obsidian vault)
  - `docs/concept-system.md` (Nostos Concept extraction, storage, and lifecycle)
  - `docs/obsidian-graph-physics.md` (Force simulation and Sigma.js canvas alignment)
  - `docs/library-mcp-contracts.md` (MCP tool contracts)

---

## 1. Context & Problem Statement

Nostos provides an integrated Second Brain tailored specifically to deep reading and research:
- Automatic concept extraction parsing wiki-style `[[Concept]]` syntax within note cards.
- Relational storage in SQLite via EF Core (`Concepts`, `Notes`, `NoteConcepts`), anchoring annotations to EPUB canonical fragment identifiers (`CfiRange`), PDF coordinate rectangles/page numbers, or audiobook timestamps.
- Force-directed graph visualization powered by Sigma.js / Graphology tuned to emulate Obsidian's physics mechanics.
- Angular 21 master-detail knowledge explorer (`/second-brain`) and Writing Studio integration.

Issue #215 asks whether Nostos should avoid "rebuilding Obsidian" by integrating directly with Obsidian—evaluating whether Obsidian can be docked or embedded in place of Nostos's `/second-brain`, whether a live REST API sync can link them, or whether filesystem export/deep linking is the appropriate architectural pattern.

This document presents a technical, legal, and operational evaluation of four candidate integration patterns, defines the architectural boundary between an e-reader and a knowledge management system, models long-term maintenance costs, and details the concrete implementation path.

---

## 2. Evaluation of Integration Patterns

### Pattern 1: UI Embedding / Docking (iframe, Web Component, Streamed Desktop, Headless Server)

- **Description:** Replacing Nostos's `/second-brain` view or sidebar with an embedded Obsidian workspace—either rendered directly in the DOM or hosted headlessly and streamed into the browser.
- **Technical Analysis:**
  - Obsidian is a proprietary, closed-source desktop and mobile application packaged with Electron and Chromium. Dynalist Inc. does not distribute an embeddable Web Component, WebAssembly runtime, or browser-hosted web application.
  - Standard `<iframe>` embedding is impossible because Obsidian does not run an HTTP web server serving an HTML/JS client.
  - *Evaluation of Official CLI and Headless Offerings:*
    - **Obsidian CLI** (`https://obsidian.md/help/cli`, verified 2026-09-18): Provides terminal control ("Anything you can do in Obsidian can be done from the command line"), but requires the Obsidian 1.12 installer (1.12.7+), must be explicitly enabled in desktop settings, and acts strictly as a control channel for an active, running local desktop Obsidian instance on the same machine. It does not provide an embeddable web component, headless canvas, or browser-facing UI.
    - **Obsidian Headless** (`https://obsidian.md/help/headless`, verified 2026-09-18; open beta): A standalone CLI client distributed via npm (`npm install -g obsidian-headless`, requires Node.js 22+). However, its documented services are strictly limited to **Headless Sync** (`https://obsidian.md/help/sync/headless`) and **Headless Publish** (`https://obsidian.md/help/publish/headless`). It is an account-gated transport client (`ob login`) for Obsidian's paid cloud synchronization and publishing services; it does not render a UI, host a web application, or provide an embeddable editor.
    - Neither offering enables embedding Obsidian in a browser or serving an interactive second-brain UI to remote clients.
  - Headless/streamed execution requires running an entire virtual Linux display server (Xvfb/Wayland), Chromium/Electron, and a streaming gateway (such as KasmVNC or WebRTC) inside a server container.
  - Resource footprint: Streaming an Electron GUI over WebRTC demands **1.0–2.0 GB RAM per concurrent user session** and substantial server CPU encoding overhead.
  - User Experience: Severe latency over WAN/mobile connections, broken touch/pinch-to-zoom gestures on tablets and e-ink browsers, lack of responsive CSS alignment with Nostos's theme system, and complete breakdown on offline/PWA mobile readers.
- **Legal & Licensing Obstacles:**
  - Sublicensing and hosting restrictions in Obsidian's Terms of Service explicitly forbid hosting Obsidian as a multi-user service for third parties (see Section 4 below).
- **Verdict:** **INFEASIBLE** (Technically prohibitive, resource-intensive, and legally restricted).

---

### Pattern 2: Local REST API Plugin Integration (`localhost:27124`)

- **Description:** Interfacing Nostos with a user's running Obsidian instance via the community plugin `obsidian-local-rest-api` (listening on default port `27124`), executing real-time note and vault CRUD over HTTPS.
- **Technical Analysis:**
  - *Client-Side Browser Execution:*
    1. **Private Network Access (PNA):** Modern W3C security standards implemented in Chromium, Firefox, and Safari restrict public or external origins (e.g. `https://nostos.app` or any remote self-hosted server) from dispatching `fetch()` requests to loopback addresses (`127.0.0.1` / `localhost`). Preflight checks require `Access-Control-Request-Private-Network` headers which fail unless explicitly configured and trusted.
    2. **Self-Signed TLS & Mixed Content:** `obsidian-local-rest-api` runs over HTTPS using a locally generated certificate authority (CA) and self-signed leaf certificate. Browsers reject requests to untrusted HTTPS certificates in background `fetch()` calls. A web application cannot bypass this security prompt programmatically; users would have to manually open `https://127.0.0.1:27124` in a separate browser tab and add a security exception.
    3. **Remote Deployment Invalidation:** Nostos is routinely deployed on headless home servers, NAS devices (Synology, TrueNAS), or Docker containers. A client browsing Nostos from a tablet, phone, or office laptop cannot reach `localhost:27124` on their reading device unless Obsidian is actively running on that exact client device.
  - *Server-Side Backend Execution & CLI/Headless Limitations:*
    - If the Nostos ASP.NET Core backend were to connect directly to `https://127.0.0.1:27124`, it could configure an `HttpClientHandler` to trust the local CA or bypass cert validation.
    - However, the backend loopback `127.0.0.1` refers to the **server host (or container)**, not the user's desktop computer. Obsidian is a desktop GUI app and does not run inside headless NAS or server Docker environments. Reaching the user's desktop Obsidian from a remote server would require reverse tunnels (WireGuard, Tailscale, or SSH port forwarding) and complex per-client token management.
    - Official CLI and Headless offerings cannot bridge this gap: the official **Obsidian CLI** (`https://obsidian.md/help/cli`, verified 2026-09-18) only drives a running desktop instance on the local machine and cannot act as a remote daemon or run on an uninstalled server; **Obsidian Headless** (`https://obsidian.md/help/headless`, verified 2026-09-18) requires an account login (`ob login`), is restricted to paid Sync/Publish pipe operations, and exposes no local or server-side vault CRUD API. Neither enables a server-side vault API on a host with no Obsidian installation or Obsidian account.
    - Additionally, the community plugin `obsidian-local-rest-api` (on release 5.1.0 on 5.x, verified 2026-09-18; `https://github.com/coddingtonbear/obsidian-local-rest-api`) now also exposes a built-in **MCP server at `/mcp/` with 15 vault tools** as the modern alternative to its raw REST surface, but running it still requires an active desktop Obsidian instance on the target machine.
- **Verdict:** **FEASIBLE WITH SEVERE CONSTRAINTS** (Only viable for a purely local single-user desktop setup where Nostos and Obsidian share the same OS instance; completely **INFEASIBLE** for multi-device, remote, or containerized deployments).

---

### Pattern 3: Vault Export / Directory Synchronization (Headless Vault Generator)

- **Description:** Nostos acts as a first-class Obsidian vault generator and directory synchronization provider. Nostos writes notes, concepts, and book records as standard Markdown files with YAML frontmatter and `[[wikilinks]]` to a user-configured directory (e.g. `Storage/vault/` or an external sync mount).
- **Technical Analysis:**
  - An Obsidian vault is simply a filesystem folder containing UTF-8 Markdown (`.md`) files.
  - Zero proprietary runtime dependencies: Nostos generates the files directly without requiring Obsidian, Node.js, or Electron to be running.
  - Synchronization: Users sync the resulting vault to their personal Obsidian app via existing tools: Syncthing, iCloud Drive, Nextcloud, Git, or Obsidian Sync.
  - Schema Compatibility: Emits flat frontmatter scalars compatible with Obsidian's core indexing and community plugins (such as Dataview). Emits `[[wikilinks]]` for concepts and books, which Obsidian's native Graph View immediately resolves into an interactive knowledge graph.
  - Scalability & Resource Cost: Negligible RAM and CPU overhead; file writes are fast, atomic, and run asynchronously in the background.
  - Round-trip / Bidirectional Scope: One-way generation (Nostos → Obsidian) is 100% robust. Bidirectional synchronization (Obsidian edits → Nostos SQLite) introduces significant conflict vectors (see Section 6).
- **Verdict:** **FEASIBLE** (Recommended baseline for Issue #210).

---

### Pattern 4: OS-Level Protocol Deep Linking (`obsidian://` URI Scheme)

- **Description:** Nostos frontend renders native "Open in Obsidian" action buttons on note cards and book detail views, dispatching OS-registered `obsidian://` protocol links.
- **Technical Analysis:**
  - Obsidian registers the `obsidian://` custom protocol handler on Windows, macOS, Linux, iOS, and Android (documented at `https://obsidian.md/help/uri`, verified 2026-09-18).
  - Supported URI actions include `open` (open vault or specific note/heading/block), `new` (create note with optional content, append, prepend, or silent flags), `daily` (open/create daily note), `unique` (create unique note), `search` (execute query in vault search), `choose-vault` (open vault manager), and `hook-get-address` (Hook integration), along with shorthand URI paths and `x-callback-url` parameters (`x-success`, `x-error`).
  - Technical requirements: The target vault must be registered in the user's local Obsidian client. On Linux, standard desktop environment registration via `.desktop` file (`Exec=obsidian %u`) is required (as detailed in the official URI troubleshooting documentation).
  - Zero server overhead: Handled entirely by browser OS link dispatch (`<a href="obsidian://open?vault=...">`).
- **Verdict:** **FEASIBLE** (Ideal complementary feature for one-way vault export).

---

## 3. The Architectural Boundary

The division of responsibility between Nostos and Obsidian must be strictly delineated:

> **Nostos owns reading immersion, text selection, CFI/coordinate highlight anchoring, and reader-coupled note capture; Obsidian owns external zettelkasten synthesis, freeform drafting, and broad multi-vault personal knowledge management.**
>
> What crosses the boundary is **projected read-only Markdown and flat YAML frontmatter** (book metadata, note content, concept wikilinks, and stable UUIDs) pushed from Nostos to the vault filesystem, complemented by client-side `obsidian://` deep links for rapid navigation. What **can never cross the boundary** into Obsidian as mutable state is internal e-reader coordinates (`CfiRange`, PDF viewport bounding boxes, audiobook playback fractions) and transient reading progression (`ProgressPercent`, `LastLocation`, active reader sessions), because external Markdown editors possess no semantic awareness of EPUB spine structures or document pagination and will inevitably corrupt or discard them.

---

## 4. Legal & Licensing Position (Dynalist Inc.)

Every legal and licensing condition was verified against official published Dynalist Inc. terms on **2026-09-18**:

1. **Software Pricing & End-User License:**
   - *Source:* [Obsidian Pricing](https://obsidian.md/pricing), [Obsidian License Overview](https://obsidian.md/license), [Obsidian Blog: Obsidian is now free for work](https://obsidian.md/blog/free-for-work/) (published 2025-02-20).
   - *Verification Date:* 2026-09-18.
   - *Findings:* As of February 20, 2025, Obsidian is 100% free for everyone and for all purposes—including personal, commercial, non-profit, educational, and government use. Commercial licenses are now purely voluntary corporate sponsorships. End users incur zero licensing fees to install and run Obsidian.
2. **Distribution & Hosting Restrictions:**
   - *Source:* [Obsidian Terms of Service](https://obsidian.md/terms) (Section "Content and Ownership" → "Restrictions", last updated February 20, 2025).
   - *Verification Date:* 2026-09-18.
   - *Findings:* Section Restrictions explicitly states:
     > *"Customer shall not (and shall not permit others to): (i) license, sub-license, sell, transfer, distribute or share the Services or Software or make any of them available for access by third parties; (ii) create derivative works based on or otherwise modify the Services or Software; (iii) disassemble, reverse engineer or decompile the Services or Software... (v) use the Services or Software to provide a service for others..."*
   - *Implication for Nostos:* Nostos **cannot** package, bundle, redistribute, or Docker-host Obsidian binaries. Running Obsidian on a server to offer a hosted multi-user "docked" notes service violates Section Restrictions (i) and (v).
3. **Safe Harbor (Filesystem Vaults & URI Protocol):**
   - *Source:* [Obsidian URI Documentation](https://obsidian.md/help/uri), [Obsidian License Overview](https://obsidian.md/license).
   - *Verification Date:* 2026-09-18.
   - *Findings:* Obsidian operates on standard local directories of plain Markdown files. Interacting via standard filesystem I/O, writing `.md` files with YAML frontmatter, and triggering operating system `obsidian://` protocol links carries **zero licensing risk**. Dynalist Inc. claims no rights or restrictions over third-party file generators or deep links.
4. **Obsidian Headless and CLI Account & Subscription Obligations:**
   - *Source:* [Obsidian Headless](https://obsidian.md/help/headless), [Headless Sync](https://obsidian.md/help/sync/headless), [Headless Publish](https://obsidian.md/help/publish/headless), [Obsidian Sync Plans](https://obsidian.md/help/sync/plans).
   - *Verification Date:* 2026-09-18.
   - *Findings:* Unlike the local desktop application which is free for commercial and personal use, Obsidian Headless requires authenticating with an active Obsidian account (`ob login`). Furthermore, its services—Headless Sync and Headless Publish—require active paid subscriptions: Obsidian Sync is $4/user/mo (Sync Standard) and $8/user/mo (Sync Plus) billed annually, and Obsidian Publish from $8/site/mo billed annually ([Obsidian Pricing](https://obsidian.md/pricing), verified 2026-09-18). This is the one place where recurring financial costs and proprietary account gates enter the picture, contrasting directly with the zero-cost filesystem vault generation and `obsidian://` protocol URI paths.

---

## 5. Scope & Maintenance Cost Comparison (Q4)

| Dimension | Internal Second Brain (Keep & Refine) | External Sync Integration (Full Bidirectional) |
|---|---|---|
| **Surface Area** | **Small & Self-Contained:** SQLite tables (`Concepts`, `Notes`, `NoteConcepts`), EF Core entities, lightweight regex extractor (`NoteProcessorService`), Sigma.js canvas component, Angular master-detail explorer. | **Large & Sprawling:** Filesystem watchers, background synchronization workers, file lock handlers, Markdown AST parser, YAML frontmatter serializer/deserializer, conflict resolution engine, network transport (if REST API). |
| **Runtime Dependencies** | .NET 10 runtime, SQLite, Angular 21 frontend. Zero external processes. | OS filesystem permissions, external sync clients (Syncthing/iCloud), filesystem event notification limits (`inotify`), third-party plugin versioning (`obsidian-local-rest-api` 5.x). If evaluating official tooling: Obsidian CLI requires a running desktop instance (Obsidian 1.12.7+ installer); Obsidian Headless requires Node.js 22+, account auth (`ob login`), and paid Sync/Publish subscriptions. |
| **Upgrade Risk** | **Low:** Changes governed entirely within the Nostos repository via standard EF Core database migrations. | **High:** Vulnerable to Obsidian format shifts, third-party plugin deprecations (e.g. `obsidian-local-rest-api` breaking changes between v4 and v5), file lock contention, and OS-specific path quirks. |
| **Breakage Modes** | UI rendering edge cases in Sigma.js or regex parsing omissions. Failure is isolated to the `/second-brain` view; reader is unharmed. | **Severe:** External note edits desynchronizing or corrupting EPUB `CfiRange` coordinates; note deletion cascades; race conditions when user edits while Nostos writes; silent file corruption. |
| **Mobile / PWA Support** | **First-class:** Native responsive Angular views work across mobile, desktop, tablets, and e-ink browsers. | **Partial / Fragmented:** Mobile Obsidian uses sandboxed mobile storage (iOS app container); syncing requires iCloud or Obsidian Sync; URI links may fail if app not installed. |

**Conclusion:** Replacing the internal second brain with an external sync integration substantially increases architectural surface area and failure modes while degrading the core reading experience. The internal Second Brain must remain the primary reader-focused tool, with vault export serving as an external export pipeline.

---

## 6. Conflict & Round-Trip Analysis (One-Way vs. Bidirectional)

### Idempotence and Timestamp Strategy
In a one-way export / directory emission model:
- Every note is assigned a deterministic filename based on book title and stable note UUID: `{BookTitle} - Note {UUID[:8]}.md`.
- File content generation is purely functional and idempotent. If a note is updated in Nostos (e.g. user adds or edits text in the reader), re-export overwrites the file cleanly without producing duplicates.
- Note files carry `id`, `created_at`, and `updated_at` in frontmatter (where `updated_at` mirrors `created_at` in ISO-8601 UTC because `NoteModel` in Nostos schema has no `UpdatedAt` column; see Section 7).

### The Problem with Bidirectional Sync
If Nostos were to accept edits made inside Obsidian and synchronize them back into SQLite:
1. **CFI Anchoring Loss:** An e-reader highlight relies on a fragile DOM anchor (`epubcfi(...)`) or PDF rectangle. If a user modifies the highlighted quote in Obsidian, Nostos cannot re-anchor the highlight to the underlying EPUB/PDF file. The note becomes "floating" or unanchored.
2. **Wikilink & Concept Extraction Drift:** If a user adds `[[New Concept]]` in Obsidian, a background watcher must parse the markdown, create the concept row in `Concepts`, and update `NoteConcepts`. If they delete the wikilink, Nostos must orphan-clean the concept.
3. **Deletions and Renames:** If a user deletes a note file in Obsidian, did they intend to delete the note from their Nostos book, or did they merely organize their vault? Deleting rows in SQLite based on filesystem deletions risks permanent data loss.
4. **Filesystem Concurrency Races:** When external sync tools (Syncthing, iCloud Drive, Git) update files simultaneously with Nostos backend writes, file locks and conflict copies (`.sync-conflict-...`) proliferate.

**Architectural Policy:** Nostos will implement **one-way export / headless generation** (Nostos → Obsidian Vault). The SQLite database remains the authoritative source of truth. External edits in Obsidian are treated as downstream zettelkasten synthesis and do not feed back into reader annotations.

---

## 7. Recommendation & Follow-Up Path

### Recommended Decisions:
1. **Retain and Maintain Nostos's Internal Second Brain:**
   Keep the `/second-brain` master-detail UI, SQLite schema, and Sigma.js concept graph as the authoritative, reader-native knowledge hub.
2. **Implement One-Way Headless Vault Export under Issue #210:**
   Expand Issue #210 ("full-library notes export (JSON / Obsidian vault)") to implement the schema validated in Spike #215:
   - Export full library or selected collections to a designated filesystem directory or zip archive.
   - Emit flat frontmatter scalars (Dataview-compatible) with ISO-8601 UTC timestamps and standard `[[wikilinks]]`.
   - Note that a true `updated_at` timestamp requires adding a `Notes.UpdatedAt` column to `NoteModel` in `Nostos.Backend` along with an EF Core migration.
   - Provide an optional "Sync to Directory" setting in Nostos Backend allowing automated file emission on note creation/update.
3. **Add "Open in Obsidian" Deep Links:**
   Add an optional button to Note cards and Book views that dispatches `obsidian://open?vault={VaultName}&file={FilePath}` when the user configures their Obsidian vault name in Nostos preferences.

### Non-Goals:
- Hosting or embedding the Obsidian Electron app in the browser or via streaming (X11/VNC/WebRTC).
- Distributing or bundling Obsidian binaries.
- Relying on the `localhost:27124` Local REST API plugin for production reader workflows.
- Bidirectional mutation from Obsidian filesystem into Nostos SQLite tables.
