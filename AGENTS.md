# Nostos — Agent Instructions

This file is read automatically by coding agents working in this repo (Codex,
OpenCode, Antigravity CLI, Copilot, Cursor, and others — see
<https://agents.md>). If you are an agent, follow it.

**Read this before making changes.** It is not a style guide; it is the
workflow contract for this repository.

---

## 1. Never commit directly to `main`

Every change goes through a branch and a pull request. No exceptions for
"trivial" or "obvious" fixes.

```bash
git fetch origin
git checkout main && git pull origin main
git checkout -b fix/short-description
```

### Why this matters here

Multiple agents (and the human) work in this repo **concurrently, in the same
working tree**. Pushing straight to `main` has caused real damage:

- concurrent agents overwriting each other's uncommitted files;
- a stash/rebase cycle trampling another agent's in-flight edits;
- lost work that had to be manually recovered from backups.

A branch + PR makes work reviewable and merges atomic. A direct push does not.

### Branch names

Observed convention in this repo — match it:

| Prefix | Use |
| --- | --- |
| `feature/<slug>` | new functionality |
| `fix/<slug>` | bug fixes |
| `chore/<slug>` | tooling, config, deps |

Slugs are short and hyphenated: `fix/modal-zen-ux`, `feature/tinymce-nostos`.

### Commit messages

Conventional Commits, always: `type(scope): summary`.

Seen in this repo: `fix(ui):`, `feat(brand):`, `refactor(theme):`,
`docs(readme):`, `test(visual-qa):`, `chore:`.

Write the body to explain **why**, and record what you actually verified —
measured numbers, not adjectives. See `git log` for the house style: commits
here routinely cite before/after values and the exact command run.

---

## 2. Verify before you open the PR

Run the cheapest checks that cover your change, and **report the real result**.

```bash
# Frontend, from Nostos.Frontend/
npm run check          # CSS integrity + theme-token graph (fast, always run)
npm test               # unit tests
npm run build          # production build must succeed

# Backend, from the repo root
dotnet build Nostos.sln
```

Rules:

- **Never claim a check passed without running it.** Paste the real output.
- If a check fails for a reason unrelated to your change, say so explicitly
  rather than silently ignoring it.
- Do not describe work as done when it is verified only by reading the code.
  Exercise it.
- If something is genuinely unverified, label it as unverified in the PR body.

---

## 3. Open the PR

```bash
git push -u origin HEAD
gh pr create --title "fix(ui): short summary" --body "…"
```

### PR body format

House style, based on merged PRs in this repo:

```markdown
<One-line summary of what and why.>

**<Area>**
- Specific change
- Specific change

Verified: <exact checks run and their results>.

Closes #<issue-number>
```

Keep it factual. `Closes #N` links the issue — include it when one exists.

### Do not merge your own PR

Open it and stop. The human reviews and merges. Do not merge, and do not
enable auto-merge.

---

## 4. Working alongside other agents

This is the single biggest source of lost work in this repo.

- **Stay in your lane.** Only edit files your task requires. If you need to
  change something outside it, say so instead of doing it.
- **Stage explicit paths.** `git add path/a path/b`, never `git add -A` or
  `git add .` — the working tree usually contains other people's uncommitted
  work.
- **Never `git stash`, `git checkout -- .`, `git reset --hard`, or
  `git clean`** while other work may be present. These silently destroy
  uncommitted edits and have already done so here.
- **Before `git rebase`/`git pull --rebase`, check `git status`** and stop if
  files you did not touch are modified.
- If you find unexpected modifications, **leave them alone** and mention them
  in your report. They are not yours to clean up.

---

## 5. Project specifics

- **Stack:** .NET 10 + SQLite + EF Core (backend), Angular 21 standalone +
  Signals (frontend).
- **Run the app:** `npm start` (dev), `npm run prod` (production build).
- **Brand:** the mark is forest tile + paper arch, **theme-invariant** — see
  the README's Brand section and `Nostos.Frontend/public/`.
- **Never commit `Nostos.Backend/wwwroot/` or `Nostos.Frontend/dist/`** —
  both are gitignored build output.
- **UI/theme changes:** `styles.css` holds the token graph; a colour token
  added to `:root` needs its `:root[data-theme='dark']` counterpart or
  `npm run check:theme` fails. Genuinely theme-invariant tokens belong in that
  script's `INVARIANT` list instead.
- **Visual changes:** verify in a real browser and attach before/after
  evidence. Downscaled screenshots hide defects — check at 1:1.

---

## 6. Scope discipline

Do exactly what was asked, and no more.

If you believe adjacent work is needed, **finish the requested change first,
then raise the extra item** rather than folding it in. Unrequested "improvements"
to files the user has already finished are treated as a defect, not a bonus.
