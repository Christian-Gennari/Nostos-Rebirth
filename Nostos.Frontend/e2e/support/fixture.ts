/**
 * Shared Task 13 E2E helpers: fixture state access + thin REST client for the
 * supported Nostos API surface (contracts mirror Nostos.Shared/Dtos and
 * Nostos.Backend/Endpoints — nothing here invents endpoints).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface FixtureState {
  baseUrl: string;
  port: number;
  token: string;
  tempDir: string;
  repoRoot: string;
  backendPid: number | null;
  startedAt: string;
}

const STATE_FILE = path.join(__dirname, 'fixture-state.json');

export function loadFixture(): FixtureState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as FixtureState;
}

/** Stable client identity used for REST seeding (distinct from the MCP fixed id). */
export const SEED_CLIENT = 'task13-e2e';

export function seedKey(scope: string, run: string, name: string): string {
  return `task13-${scope}-${run}-${name}`;
}

export function newRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function apiGet<T = any>(baseUrl: string, urlPath: string): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`);
  if (!res.ok) throw new Error(`GET ${urlPath} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function apiPost<T = any>(baseUrl: string, urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${urlPath} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function apiPatch<T = any>(baseUrl: string, urlPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${urlPath} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// --- wire enums (numeric, matches Nostos.Shared/Enums) ---
export const ReadingMode = { Endurance: 0, Deep: 1, Recovery: 2 } as const;
export const ReadingSessionStatus = {
  Idle: 0,
  Planned: 1,
  Active: 2,
  Paused: 3,
  AwaitingFeedback: 4,
  Completed: 5,
  Cancelled: 6,
} as const;
export const ReadingCaptureType = { Thought: 0, Question: 1, Bookmark: 2 } as const;
export const ReadingAssignmentStatus = { Active: 0, Queued: 1, Completed: 2, Archived: 3 } as const;

export interface CommandEnvelope<T> {
  reply: string;
  data: T | null;
  stateVersion: string;
  duplicate: boolean;
}

export interface ReadingSessionDto {
  id: string;
  bookAssignmentId: string | null;
  bookId: string;
  bookTitle: string | null;
  mode: number;
  status: number;
  targetMinutes: number;
  plannedTargetMinutes: number;
  constraint: number;
  accumulatedSeconds: number;
  measuredSeconds: number;
  reportedMinutes: number | null;
  effort: number;
  focus: number;
  rating: number | null;
  ratingsSkipped: boolean;
  plannedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReadingCaptureDto {
  id: string;
  text: string;
  type: number;
  bookId: string;
  sessionId: string | null;
  externalId: string | null;
  resolved: boolean;
  promotedNoteId: string | null;
  createdAt: string;
}

export interface ReadingBookAssignmentDto {
  id: string;
  bookId: string;
  bookTitle: string | null;
  bookAuthor: string | null;
  mode: number;
  status: number;
  queueOrder: number;
  isDefault: boolean;
}

export interface BookDto {
  id: string;
  title: string;
  author: string | null;
  type: string;
  categories: string | null;
}

/** Seed a programme + library books + mode assignments through supported REST. */
export async function seedTrainingState(baseUrl: string, runId: string): Promise<{
  candide: BookDto;
  meditations: BookDto;
  candideAssignment: ReadingBookAssignmentDto;
  meditationsAssignment: ReadingBookAssignmentDto;
}> {
  await apiPost(baseUrl, '/api/reading-training/initialize', {
    clientId: SEED_CLIENT,
    idempotencyKey: seedKey('seed', runId, 'init'),
  });

  const candide = await apiPost<BookDto>(baseUrl, '/api/books', {
    type: 'physical',
    title: 'Candide',
    author: 'Voltaire',
    language: 'French',
    categories: 'literature',
  });
  const meditations = await apiPost<BookDto>(baseUrl, '/api/books', {
    type: 'physical',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    language: 'English',
    categories: 'philosophy',
  });

  const candideAssignment = await apiPost<CommandEnvelope<ReadingBookAssignmentDto>>(
    baseUrl,
    '/api/reading-training/books',
    {
      clientId: SEED_CLIENT,
      idempotencyKey: seedKey('seed', runId, 'assign-candide'),
      bookId: candide.id,
      mode: ReadingMode.Deep,
      makeDefault: true,
    }
  );
  const meditationsAssignment = await apiPost<CommandEnvelope<ReadingBookAssignmentDto>>(
    baseUrl,
    '/api/reading-training/books',
    {
      clientId: SEED_CLIENT,
      idempotencyKey: seedKey('seed', runId, 'assign-meditations'),
      bookId: meditations.id,
      mode: ReadingMode.Endurance,
      makeDefault: true,
    }
  );

  if (!candideAssignment.data || !meditationsAssignment.data) {
    throw new Error(`Assignment seeding failed: ${candideAssignment.reply} / ${meditationsAssignment.reply}`);
  }

  return {
    candide,
    meditations,
    candideAssignment: candideAssignment.data,
    meditationsAssignment: meditationsAssignment.data,
  };
}
