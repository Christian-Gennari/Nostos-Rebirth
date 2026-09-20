/**
 * The assistant's capture seam (issue #261 §4).
 *
 * This is the ONE place that saves a typed capture. It POSTs to the existing
 * `POST /api/books/{bookId}/notes` route with the anchor/provenance fields the
 * canonical note DTO accepts (issue #260); 261-S2 swaps this implementation for
 * the canonical `CaptureAsync` path without any caller changing.
 *
 * The rules it enforces, from #261 §4:
 *   - an app-known location is attached automatically;
 *   - a skipped/absent anchor is still saved (`SourceAnchorKind = unknown`) —
 *     a thought is never lost to a missing anchor;
 *   - a quote that did not come from the digital source carries an explicit
 *     provenance/fidelity note.
 */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { Note } from '../../core/dtos/note.dtos';
import { CaptureNoteDto, NotesService } from '../../core/services/notes.service';
import { AssistantAnchor, AssistantAnchorKind } from './assistant-context.service';

export interface AssistantCaptureRequest {
  bookId: string;
  /** What the user wrote. Required: there is no capture without a thought. */
  text: string;
  /** The passage a quote was taken from, when the surface has one. */
  selectedText?: string | null;
  /** App-known or user-supplied source anchor; null means "not known". */
  anchor?: AssistantAnchor | null;
}

export interface AssistantCaptureResult {
  note: Note;
  anchorKind: AssistantAnchorKind;
  anchorValue: string | null;
  verified: boolean;
}

/**
 * Appended to a quote's content when the passage was transcribed by hand rather
 * than read from the digital source, so the difference is never inferred later.
 */
export const QUOTE_FIDELITY_NOTE =
  'Quoted by hand; punctuation and wording may differ from the source.';

@Injectable({ providedIn: 'root' })
export class AssistantCaptureService {
  private readonly notes = inject(NotesService);

  /** Saves one capture. The single call site for the whole assistant. */
  capture(request: AssistantCaptureRequest): Observable<AssistantCaptureResult> {
    const anchor = request.anchor ?? null;
    const kind: AssistantAnchorKind = anchor?.kind ?? 'unknown';
    const value = anchor?.value ?? null;
    const verified = anchor?.verified ?? false;
    const selectedText = request.selectedText?.trim() ? request.selectedText : null;

    // EPUB keeps `CfiRange` authoritative for the existing readers (D4), while
    // the anchor columns describe the same location for the assistant.
    const cfiRange = kind === 'epub_cfi' && value ? value : undefined;

    const payload: CaptureNoteDto = {
      content: withQuoteProvenance(request.text, selectedText, verified),
      cfiRange,
      selectedText: selectedText ?? undefined,
      rawContent: request.text,
      captureSource: 'text',
      processingMode: 'verbatim',
      sourceAnchorKind: kind,
      sourceAnchorValue: value,
      anchorVerified: verified,
    };

    return this.notes
      .capture(request.bookId, payload)
      .pipe(map((note) => ({ note, anchorKind: kind, anchorValue: value, verified })));
  }
}

/**
 * Adds the fidelity note to a quote that was not taken from the digital source.
 * A verified anchor means the app read the passage itself, so it needs no note.
 */
export function withQuoteProvenance(
  text: string,
  selectedText: string | null,
  verified: boolean,
): string {
  if (!selectedText || verified) return text;
  return `${text}\n\n_${QUOTE_FIDELITY_NOTE}_`;
}
