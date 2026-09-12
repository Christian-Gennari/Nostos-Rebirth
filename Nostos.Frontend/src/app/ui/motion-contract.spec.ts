/**
 * Motion-contract gate: the loading skeleton is gone from Nostos, and it stays
 * gone.
 *
 * Every wait in the app is now one of two things — the structureless waiting
 * field (`.wait-field`, styles.css) or a fade/defocus applied to real content
 * that is already arriving. A skeleton is neither: it is a guessed structure
 * whose rows, bars and thumbnails never match the real metrics, so it jitters
 * against the content it is standing in for. That is the whole reason it was
 * removed, so a `skeleton` class, keyframe or markup block reappearing in a
 * template or stylesheet is a regression, not a style choice.
 *
 * Scans templates and stylesheets under src/ (component styles included) and
 * reports every offending file. Comments count: naming the thing is how it
 * comes back.
 */
// No @types/node in this repo; vitest resolves the node built-ins at runtime.
// Used only for static source guards (templates/stylesheet files).
// @ts-expect-error — see above.
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-expect-error — see above.
import path from 'node:path';
// @ts-expect-error — see above.
import process from 'node:process';

import { describe, expect, it } from 'vitest';

/** Vitest runs with the project root as cwd (Nostos.Frontend). */
const SRC = path.resolve(process.cwd(), 'src');
const SCANNED_EXTENSIONS = ['.html', '.css', '.scss'];
const FORBIDDEN = /skeleton/i;

function collectFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      collectFiles(full, found);
    } else if (SCANNED_EXTENSIONS.includes(path.extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

describe('motion contract', () => {
  it('has no loading skeleton left in any template or stylesheet', () => {
    const files = collectFiles(SRC);

    // Guards the guard: an empty or mis-rooted scan must fail loudly rather
    // than pass as "nothing found" — and the global stylesheet, where the
    // waiting-field contract actually lives, has to be inside the scan.
    expect(files.length, `no templates/stylesheets found under ${SRC}`).toBeGreaterThan(30);
    expect(files.some((file) => file.endsWith('src/styles.css'))).toBe(true);

    const offenders = files
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(offenders, 'remove the skeleton and use .wait-field / a fade instead').toEqual([]);
  });
});
