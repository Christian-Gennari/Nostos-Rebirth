/**
 * Seed/cleanup helpers for the Second Brain specs.
 *
 * Why this exists: every Playwright spec shares ONE fixture instance
 * (`workers: 1`, a single global setup), and `visual-regression.spec.ts`'s
 * `brain-empty-desktop` deliberately asserts the *pristine* empty state. A spec
 * that seeds concepts into that shared database therefore poisons it for every
 * later spec — the empty-state test fails and, because the Second Brain matrix
 * is `mode: 'serial'`, its 8 remaining tests never run.
 *
 * So any spec that seeds a brain must put the fixture back the way it found it.
 * Snapshots are taken by concept id rather than by name: two specs may legitimately
 * use the same concept names ("Attention", "Memory"), and deleting by name could
 * remove a concept another spec is relying on.
 */
import { apiGet, apiPost } from './fixture';

export async function apiDelete(baseUrl: string, urlPath: string): Promise<void> {
  const res = await fetch(`${baseUrl}${urlPath}`, { method: 'DELETE' });
  // 404 is a pass: the row is already gone, which is the post-condition we want.
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${urlPath} -> ${res.status}: ${await res.text()}`);
  }
}

export interface ConceptRef {
  id: string;
  name: string;
}

/** Concept ids present right now, so a spec can delete only what it added. */
export async function snapshotConceptIds(baseUrl: string): Promise<Set<string>> {
  const concepts = await apiGet<ConceptRef[]>(baseUrl, '/api/concepts');
  return new Set(concepts.map((c) => c.id));
}

/** The concept created by this note content, or null if the note made none. */
export async function findConceptId(baseUrl: string, name: string): Promise<string | null> {
  const concepts = await apiGet<ConceptRef[]>(baseUrl, '/api/concepts');
  return concepts.find((c) => c.name === name)?.id ?? null;
}

export interface BrainSeed {
  bookId: string;
  conceptNames: string[];
  /** Concept ids that existed before seeding (everything else this spec made). */
  beforeConceptIds: Set<string>;
}

/** Create a book plus one note per entry, and record what already existed. */
export async function seedBrain(
  baseUrl: string,
  title: string,
  notes: string[],
  conceptNames: string[]
): Promise<BrainSeed> {
  const beforeConceptIds = await snapshotConceptIds(baseUrl);
  const book = await apiPost<{ id: string }>(baseUrl, '/api/books', {
    type: 'physical',
    title,
    author: 'Nostos QA',
    categories: 'visual-qa',
  });
  for (const content of notes) {
    await apiPost(baseUrl, `/api/books/${book.id}/notes`, { content });
  }
  return { bookId: book.id, conceptNames, beforeConceptIds };
}

/**
 * Undo `seedBrain`: remove the concepts this spec created, then the book.
 *
 * Concepts are deleted explicitly because the product's own orphan sweep
 * (`ConceptCleanupWorker`) runs hourly, far too late for a test suite; until it
 * runs, a concept with no remaining notes still appears in the index and would
 * keep failing the empty-state assertion.
 *
 * Never throws: a cleanup failure must not mask the test's real result.
 */
export async function cleanupBrain(baseUrl: string, seed: BrainSeed): Promise<void> {
  try {
    const concepts = await apiGet<ConceptRef[]>(baseUrl, '/api/concepts');
    for (const concept of concepts) {
      if (!seed.beforeConceptIds.has(concept.id)) {
        await apiDelete(baseUrl, `/api/concepts/${concept.id}`);
      }
    }
  } catch (error) {
    console.warn('[brain-fixture] concept cleanup failed:', error);
  }
  try {
    await apiDelete(baseUrl, `/api/books/${seed.bookId}`);
  } catch (error) {
    console.warn('[brain-fixture] book cleanup failed:', error);
  }
}
