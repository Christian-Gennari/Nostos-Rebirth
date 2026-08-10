import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, BookOpenCheck, RefreshCw, X } from 'lucide-angular';
import { Observable } from 'rxjs';

import { Note } from '../core/dtos/note.dtos';
import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCapture,
  ReadingConstraint,
  ReadingMode,
  ReadingNotification,
  ReadingSessionStatus,
  ReadingWeekSummary,
  ReadingWeeklyReview,
} from '../core/dtos/reading-training.dtos';
import { BooksService } from '../core/services/books.service';
import { NotesService } from '../core/services/notes.service';
import { ReadingTrainingService } from '../core/services/reading-training.service';
import { ReadingTrainingStore } from './reading-training.store';
import { ActiveBooksComponent, ActiveBooksReorderEvent } from './components/active-books/active-books.component';
import {
  AvailableBook,
  BookAssignmentDraft,
  BookAssignmentFormComponent,
} from './components/book-assignment-form/book-assignment-form.component';
import { CapacityLaneView, CapacityLanesComponent } from './components/capacity-lanes/capacity-lanes.component';
import { CaptureDraft, CaptureFormComponent } from './components/capture-form/capture-form.component';
import { PendingNoticesComponent } from './components/pending-notices/pending-notices.component';
import { ReadingInboxComponent } from './components/reading-inbox/reading-inbox.component';
import { RateSessionDraft, SessionFeedbackComponent, SkipRatingsDraft } from './components/session-feedback/session-feedback.component';
import { SessionHistoryComponent } from './components/session-history/session-history.component';
import { SessionPlanDraft, SessionPlannerComponent, modeLabel } from './components/session-planner/session-planner.component';
import { TodaySessionComponent } from './components/today-session/today-session.component';
import { WeekStripComponent } from './components/week-strip/week-strip.component';

/** Mode presentation facts; Recovery is volume-only by policy. */
const MODE_LANES: ReadonlyArray<{ mode: ReadingMode; title: string; volumeOnly: boolean }> = [
  { mode: ReadingMode.Endurance, title: 'Endurance', volumeOnly: false },
  { mode: ReadingMode.Deep, title: 'Deep', volumeOnly: false },
  { mode: ReadingMode.Recovery, title: 'Recovery', volumeOnly: true },
];

/** Reader-facing labels for the backend's lowercase weekly-review decision kinds. */
const DECISION_LABELS: Record<string, string> = {
  increase: 'Increase target',
  hold: 'Hold target',
  deload: 'Deload',
  consolidate: 'Consolidate',
};

function decisionLabel(kind: string): string {
  return DECISION_LABELS[kind] ?? kind;
}

/** Parses an ISO "YYYY-Www" week key; returns null when unparseable. */
function parseWeekKey(weekKey: string): { year: number; week: number } | null {
  const match = /^(\d{4})-W(\d{1,2})$/i.exec(weekKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= 53 ? { year, week } : null;
}

/** A page-owned modal dialog in the focus trap: its element, its opener, and its closer. */
interface OpenDialog {
  element: HTMLElement;
  trigger: HTMLElement | null;
  close: () => void;
}

/**
 * Reading Training page shell.
 *
 * Orchestration only: it connects the store for the route lifetime, renders
 * the store's signals (loading / error / not-initialized / initialized) and
 * the committed reading-training panels (week strip, lanes, today session,
 * feedback, planner, active books, inbox, history), and forwards child-component
 * events as typed store commands. The page owns idempotency: a stable client
 * id per page instance and a fresh idempotency key generated once per user
 * action. Mutations are never retried automatically; dialog/panel visibility
 * is page-local UI state only and dialogs close on command success, never on
 * failure. Read-only resources (inbox, history) load on connect and reload
 * after the commands that change them.
 */
@Component({
  standalone: true,
  selector: 'app-reading-training',
  imports: [
    LucideAngularModule,
    ActiveBooksComponent,
    BookAssignmentFormComponent,
    CapacityLanesComponent,
    CaptureFormComponent,
    PendingNoticesComponent,
    ReadingInboxComponent,
    SessionFeedbackComponent,
    SessionHistoryComponent,
    SessionPlannerComponent,
    TodaySessionComponent,
    WeekStripComponent,
  ],
  templateUrl: './reading-training.component.html',
  styleUrl: './reading-training.component.css',
})
export class ReadingTrainingComponent implements OnInit, OnDestroy {
  readonly store = inject(ReadingTrainingStore);
  private readonly booksService = inject(BooksService);
  private readonly notesService = inject(NotesService);
  private readonly readingService = inject(ReadingTrainingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Stable UI client id for this page instance (never generated by store/service). */
  private readonly clientId = crypto.randomUUID();

  RefreshIcon = RefreshCw;
  SetupIcon = BookOpenCheck;
  CloseIcon = X;

  /** Programme absent because the server reported `not_initialized`. */
  readonly notInitialized = computed(
    () =>
      this.store.dashboard() === null &&
      (this.store.error()?.includes('not_initialized') ?? false)
  );

  /** Open session projected from the authoritative dashboard snapshot. */
  readonly openSession = computed(
    () => this.store.openSession() ?? this.store.dashboard()?.openSession ?? null
  );

  /** Three capacity lanes projected from the authoritative snapshot. */
  readonly lanes = computed<CapacityLaneView[]>(() => {
    const programme = this.store.programme() ?? this.store.dashboard()?.programme ?? null;
    if (!programme) return [];
    const targets = programme.targets;
    return MODE_LANES.map((lane) => {
      const targetMinutes =
        lane.mode === ReadingMode.Endurance
          ? targets.enduranceTargetMinutes
          : lane.mode === ReadingMode.Deep
            ? targets.deepTargetMinutes
            : targets.recoveryTargetMinutes;
      const establishedMinutes =
        lane.mode === ReadingMode.Endurance
          ? targets.enduranceEstablishedMinutes
          : lane.mode === ReadingMode.Deep
            ? targets.deepEstablishedMinutes
            : targets.recoveryEstablishedMinutes;
      const book = this.store.defaultBookForMode(lane.mode);
      return {
        mode: lane.mode,
        title: lane.title,
        targetMinutes,
        establishedMinutes,
        bookTitle: book?.bookTitle ?? null,
        volumeOnly: lane.volumeOnly,
        // The dashboard snapshot does not yet carry committed review
        // decisions; the latest adaptation reason will be supplied by the
        // weekly-review slice once that data is available.
        reason: null,
      };
    });
  });

  // --- UI-only dialog / panel state (never sent to the server) ---

  private readonly bookFormOpenState = signal(false);
  private readonly bookFormModeState = signal<ReadingMode | null>(null);
  private readonly availableBooksState = signal<AvailableBook[]>([]);
  private readonly availableBooksLoadingState = signal(false);
  private readonly availableBooksErrorState = signal<string | null>(null);

  private readonly plannerOpenState = signal(false);

  private readonly captureOpenState = signal(false);

  private readonly chooserOpenState = signal(false);
  private readonly chooserCaptureState = signal<ReadingCapture | null>(null);
  private readonly chooserNotesState = signal<Note[]>([]);
  private readonly chooserNotesLoadingState = signal(false);
  private readonly chooserNotesErrorState = signal<string | null>(null);
  private readonly chooserNoteIdState = signal('');

  private readonly reviewOpenState = signal(false);
  private readonly reviewState = signal<ReadingWeeklyReview | null>(null);
  private readonly reviewLoadingState = signal(false);
  private readonly reviewErrorState = signal<string | null>(null);
  private readonly reviewWeekState = signal<{ year: number; week: number } | null>(null);

  readonly bookFormOpen = this.bookFormOpenState.asReadonly();
  readonly bookFormMode = this.bookFormModeState.asReadonly();
  readonly availableBooks = this.availableBooksState.asReadonly();
  readonly availableBooksLoading = this.availableBooksLoadingState.asReadonly();
  readonly availableBooksError = this.availableBooksErrorState.asReadonly();

  readonly plannerOpen = this.plannerOpenState.asReadonly();
  readonly captureOpen = this.captureOpenState.asReadonly();

  readonly chooserOpen = this.chooserOpenState.asReadonly();
  readonly chooserCapture = this.chooserCaptureState.asReadonly();
  readonly chooserNotes = this.chooserNotesState.asReadonly();
  readonly chooserNotesLoading = this.chooserNotesLoadingState.asReadonly();
  readonly chooserNotesError = this.chooserNotesErrorState.asReadonly();
  readonly chooserNoteId = this.chooserNoteIdState.asReadonly();

  readonly reviewOpen = this.reviewOpenState.asReadonly();
  readonly review = this.reviewState.asReadonly();
  readonly reviewLoading = this.reviewLoadingState.asReadonly();
  readonly reviewError = this.reviewErrorState.asReadonly();

  // --- derived projections ---

  /** The feedback form is shown only while the open session awaits ratings. */
  readonly sessionAwaitingFeedback = computed(
    () => this.openSession()?.status === ReadingSessionStatus.AwaitingFeedback
  );

  /** The planner is visible only with no open session and after an explicit open. */
  readonly plannerVisible = computed(() => this.plannerOpenState() && !this.openSession());

  /** Assignments eligible for a new session: Active only, in queue order (the backend rejects plans for Queued assignments). */
  readonly plannerBooks = computed<ReadingBookAssignment[]>(() =>
    this.store
      .books()
      .filter((book) => book.status === ReadingAssignmentStatus.Active)
      .sort((a, b) => a.queueOrder - b.queueOrder)
  );

  /** Library bookId -> title map for the inbox, derived from store books only. */
  readonly bookTitles = computed<Record<string, string>>(() => {
    const titles: Record<string, string> = {};
    for (const book of this.store.books()) {
      if (book.bookTitle) titles[book.bookId] = book.bookTitle;
    }
    return titles;
  });

  /** Dialog elements; the focus trap targets whichever of these is open. */
  private readonly bookFormDialogEl = viewChild<ElementRef<HTMLElement>>('bookFormDialog');
  private readonly captureDialogEl = viewChild<ElementRef<HTMLElement>>('captureDialog');
  private readonly chooserDialogEl = viewChild<ElementRef<HTMLElement>>('chooserDialog');
  private readonly reviewDialogEl = viewChild<ElementRef<HTMLElement>>('reviewDialog');

  /** Open page dialogs in open order; the last entry is the active (topmost) one. */
  private readonly openDialogStack: OpenDialog[] = [];

  private keydownListenerAttached = false;

  /** Monotonic weekly-review preview sequence: stale responses are dropped. */
  private reviewPreviewSeq = 0;

  /** The four page-owned dialogs; declaration order matches document order. */
  private readonly dialogDefs: ReadonlyArray<{
    el: () => ElementRef<HTMLElement> | undefined;
    isOpen: () => boolean;
    close: () => void;
  }> = [
    { el: () => this.bookFormDialogEl(), isOpen: () => this.bookFormOpen(), close: () => this.closeBookForm() },
    { el: () => this.captureDialogEl(), isOpen: () => this.captureOpen(), close: () => this.closeCapture() },
    { el: () => this.chooserDialogEl(), isOpen: () => this.chooserOpen(), close: () => this.closeChooser() },
    { el: () => this.reviewDialogEl(), isOpen: () => this.reviewOpen(), close: () => this.closeReview() },
  ];

  constructor() {
    // Once a real open session exists the planner closes permanently; it only
    // ever reappears through an explicit user action.
    effect(() => {
      if (this.openSession() !== null) this.plannerOpenState.set(false);
    });

    // Centralized modal management: one document keydown listener is active
    // only while at least one dialog is open. Escape closes the active dialog,
    // Tab/Shift+Tab wrap among its focusables, and closing restores focus to
    // the element that opened the dialog.
    effect(() => {
      this.syncDialogStack();
    });
  }

  ngOnInit(): void {
    this.store.connect();
    // Read-only resources: load once on connect; failures keep the last good
    // data and are surfaced through store.error (swallowed subscriptions).
    this.store
      .loadInbox()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => void 0 });
    this.store
      .loadHistory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => void 0 });
  }

  ngOnDestroy(): void {
    this.store.disconnect();
    if (this.keydownListenerAttached) {
      document.removeEventListener('keydown', this.onDocumentKeydown, true);
      this.keydownListenerAttached = false;
    }
  }

  onRefresh(): void {
    this.store.refresh();
  }

  /**
   * Forwards the exact notice id to the store; the store owns the lease/ack
   * lifecycle and removes the notice only after the server confirms the ack.
   * No idempotency key and no local removal here.
   */
  onAcknowledgeNotice(notice: ReadingNotification): void {
    this.store
      .acknowledgeNotification(notice.notificationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => void 0 });
  }

  onSetup(): void {
    this.runAction((key) => this.store.initialize({ clientId: this.clientId, idempotencyKey: key }));
  }

  onStart(): void {
    const session = this.openSession();
    if (session?.status === ReadingSessionStatus.Planned) {
      this.runAction((key) =>
        this.store.startSession({ clientId: this.clientId, idempotencyKey: key, sessionId: session.id })
      );
    } else {
      this.runAction((key) => this.store.startNewSession({ clientId: this.clientId, idempotencyKey: key }));
    }
  }

  onPause(): void {
    this.runAction((key) => this.store.pauseSession({ clientId: this.clientId, idempotencyKey: key }));
  }

  onResume(): void {
    this.runAction((key) => this.store.resumeSession({ clientId: this.clientId, idempotencyKey: key }));
  }

  onComplete(reportedMinutes?: number): void {
    this.runAction(
      (key) =>
        this.store.completeSession({ clientId: this.clientId, idempotencyKey: key, reportedMinutes }),
      () => this.reloadHistory()
    );
  }

  onCancel(): void {
    this.runAction((key) => this.store.cancelSession({ clientId: this.clientId, idempotencyKey: key }));
  }

  // --- session feedback (AwaitingFeedback only) ---

  /**
   * Two-step rate flow: first report the actual minutes through
   * `completeSession`, then — only on its success — send effort/focus through
   * `rateSession`. Each step gets its own fresh idempotency key; nothing is
   * retried or optimistically applied, and the server stays authoritative.
   */
  onRate(draft: RateSessionDraft): void {
    const session = this.openSession();
    if (!session || session.id !== draft.sessionId) return;
    this.store
      .completeSession({
        clientId: this.clientId,
        idempotencyKey: crypto.randomUUID(),
        reportedMinutes: draft.reportedMinutes,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.store
            .rateSession({
              clientId: this.clientId,
              idempotencyKey: crypto.randomUUID(),
              effort: draft.effort,
              focus: draft.focus,
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => this.reloadHistory(),
              error: () => void 0,
            });
        },
        error: () => void 0,
      });
  }

  onSkip(draft: SkipRatingsDraft): void {
    const session = this.openSession();
    if (!session || session.id !== draft.sessionId) return;
    this.runAction(
      (key) => this.store.skipRatings({ clientId: this.clientId, idempotencyKey: key }),
      () => this.reloadHistory()
    );
  }

  // --- active books ---

  /**
   * Opens the book-assignment dialog for one mode and loads the real library
   * catalogue through BooksService (never invented client-side).
   */
  onAddRequested(mode: ReadingMode): void {
    this.bookFormModeState.set(mode);
    this.bookFormOpenState.set(true);
    this.loadAvailableBooks();
  }

  loadAvailableBooks(): void {
    this.availableBooksState.set([]);
    this.availableBooksErrorState.set(null);
    this.availableBooksLoadingState.set(true);
    this.booksService
      .list({ page: 1, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.availableBooksLoadingState.set(false);
          this.availableBooksState.set(
            page.items.map((book) => ({ bookId: book.id, title: book.title, author: book.author }))
          );
        },
        error: () => {
          this.availableBooksLoadingState.set(false);
          this.availableBooksErrorState.set('Unable to load the library book list.');
        },
      });
  }

  closeBookForm(): void {
    this.bookFormOpenState.set(false);
  }

  onAddBook(draft: BookAssignmentDraft): void {
    this.runAction(
      (key) =>
        this.store.addBook({
          clientId: this.clientId,
          idempotencyKey: key,
          bookId: draft.bookId,
          mode: draft.mode,
          makeDefault: draft.makeDefault,
        }),
      () => this.bookFormOpenState.set(false)
    );
  }

  onSetDefault(book: ReadingBookAssignment): void {
    this.runAction((key) =>
      this.store.setDefaultBook({
        clientId: this.clientId,
        idempotencyKey: key,
        bookAssignmentId: book.id,
        mode: book.mode,
      })
    );
  }

  onFinish(book: ReadingBookAssignment): void {
    this.runAction((key) =>
      this.store.completeBook({ clientId: this.clientId, idempotencyKey: key, bookAssignmentId: book.id })
    );
  }

  onReorder(event: ActiveBooksReorderEvent): void {
    this.runAction((key) =>
      this.store.reorderQueue({ clientId: this.clientId, idempotencyKey: key, assignmentIds: event.assignmentIds })
    );
  }

  // --- session planner ---

  openPlanner(): void {
    this.plannerOpenState.set(true);
  }

  closePlanner(): void {
    this.plannerOpenState.set(false);
  }

  /** Plan uses the constrained minutes when a constraint applies, else the target. */
  onPlan(draft: SessionPlanDraft): void {
    this.runAction((key) =>
      this.store.planSession({
        clientId: this.clientId,
        idempotencyKey: key,
        bookAssignmentId: draft.bookAssignmentId,
        mode: draft.mode,
        targetMinutes: draft.constrainedMinutes ?? draft.targetMinutes,
        constraint: draft.constraint !== ReadingConstraint.None ? draft.constraint : undefined,
      })
    );
  }

  /** Start-now drops target/constraint and sends only the assignment + mode. */
  onStartNew(draft: SessionPlanDraft): void {
    this.runAction((key) =>
      this.store.startNewSession({
        clientId: this.clientId,
        idempotencyKey: key,
        bookAssignmentId: draft.bookAssignmentId,
        mode: draft.mode,
      })
    );
  }

  // --- capture form ---

  openCapture(): void {
    this.captureOpenState.set(true);
  }

  closeCapture(): void {
    this.captureOpenState.set(false);
  }

  /** Verbatim text; enriches the request with the open session's book/session. */
  onCapture(draft: CaptureDraft): void {
    const session = this.openSession();
    this.runAction(
      (key) =>
        this.store.capture({
          clientId: this.clientId,
          idempotencyKey: key,
          text: draft.text,
          type: draft.type,
          ...(session ? { bookId: session.bookId, sessionId: session.id } : {}),
        }),
      () => {
        this.captureOpenState.set(false);
        this.reloadInbox();
      }
    );
  }

  // --- inbox: resolve (dismiss/keep) and promote ---

  onDismissCapture(capture: ReadingCapture): void {
    this.runAction(
      (key) =>
        this.store.resolveCapture(capture.id, {
          clientId: this.clientId,
          idempotencyKey: key,
          keep: false,
        }),
      () => this.reloadInbox()
    );
  }

  onKeepCapture(capture: ReadingCapture): void {
    this.runAction(
      (key) =>
        this.store.resolveCapture(capture.id, {
          clientId: this.clientId,
          idempotencyKey: key,
          keep: true,
        }),
      () => this.reloadInbox()
    );
  }

  /** Opens the note chooser and loads the capture book's real notes. */
  onPromoteCapture(capture: ReadingCapture): void {
    this.chooserCaptureState.set(capture);
    this.chooserNoteIdState.set('');
    this.chooserOpenState.set(true);
    this.loadChooserNotes(capture.bookId);
  }

  loadChooserNotes(bookId: string): void {
    this.chooserNotesState.set([]);
    this.chooserNotesErrorState.set(null);
    this.chooserNotesLoadingState.set(true);
    this.notesService
      .list(bookId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (notes) => {
          this.chooserNotesLoadingState.set(false);
          this.chooserNotesState.set(notes);
        },
        error: () => {
          this.chooserNotesLoadingState.set(false);
          this.chooserNotesErrorState.set('Unable to load notes for this book.');
        },
      });
  }

  closeChooser(): void {
    this.chooserOpenState.set(false);
  }

  onChooserNoteChange(event: Event): void {
    this.chooserNoteIdState.set((event.target as HTMLSelectElement).value);
  }

  /** Requires an existing note id; the server remains authoritative. */
  onPromoteNote(): void {
    const capture = this.chooserCaptureState();
    const noteId = this.chooserNoteIdState();
    if (!capture || noteId === '') return;
    this.runAction(
      (key) =>
        this.store.promoteCapture(capture.id, { clientId: this.clientId, idempotencyKey: key, noteId }),
      () => {
        this.chooserOpenState.set(false);
        this.reloadInbox();
      }
    );
  }

  noteLabel(note: Note): string {
    const firstLine = note.content.split('\n')[0].trim();
    return firstLine === '' ? 'Untitled note' : firstLine;
  }

  // --- weekly review ---

  /** Parses the exact "YYYY-Www" key and previews that week via the GET endpoint. */
  onReviewRequested(week: ReadingWeekSummary): void {
    const parsed = parseWeekKey(week.weekKey);
    if (!parsed) return;
    // Monotonic preview sequence: a newer preview (or a close/reopen cycle)
    // invalidates any still-in-flight older response, so a stale preview can
    // never overwrite the week currently shown.
    const seq = ++this.reviewPreviewSeq;
    this.reviewWeekState.set(parsed);
    this.reviewState.set(null);
    this.reviewErrorState.set(null);
    this.reviewOpenState.set(true);
    this.reviewLoadingState.set(true);
    this.readingService
      .previewWeeklyReview(parsed.year, parsed.week)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (seq !== this.reviewPreviewSeq) return; // stale preview: drop
          this.reviewLoadingState.set(false);
          if (!result.data) {
            this.reviewErrorState.set('No weekly review data is available for that week yet.');
            return;
          }
          this.reviewState.set(result.data);
        },
        error: () => {
          if (seq !== this.reviewPreviewSeq) return;
          this.reviewLoadingState.set(false);
          this.reviewErrorState.set("Unable to preview this week's review.");
        },
      });
  }

  closeReview(): void {
    this.reviewOpenState.set(false);
  }

  onCommitWeeklyReview(): void {
    const week = this.reviewWeekState();
    if (!week) return;
    this.runAction(
      (key) =>
        this.store.commitWeeklyReview({
          clientId: this.clientId,
          idempotencyKey: key,
          year: week.year,
          week: week.week,
        }),
      () => this.reviewOpenState.set(false)
    );
  }

  modeLabel(mode: ReadingMode): string {
    return modeLabel(mode);
  }

  decisionLabel(kind: string): string {
    return decisionLabel(kind);
  }

  completionRatePercent(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  // --- internals ---

  private reloadInbox(): void {
    this.store
      .loadInbox()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => void 0 });
  }

  private reloadHistory(): void {
    this.store
      .loadHistory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => void 0 });
  }

  // --- modal dialog focus trap ---

  /**
   * Keeps the open-dialog stack in sync with the four dialog signals. Runs as
   * an effect: it drops closed dialogs (restoring trigger focus when the last
   * one closes), admits newly opened dialogs (remembering the element that
   * opened them), registers the single document keydown listener only while
   * at least one dialog is open, and moves focus into the active dialog.
   */
  private syncDialogStack(): void {
    const openDefs = this.dialogDefs.filter((def) => def.isOpen() && def.el() !== undefined);
    const openElements = new Set(openDefs.map((def) => def.el()!.nativeElement));

    // Remove closed dialogs, newest first; focus falls to the next dialog
    // beneath, or back to the trigger when the last dialog closes.
    for (let i = this.openDialogStack.length - 1; i >= 0; i--) {
      const entry = this.openDialogStack[i];
      if (openElements.has(entry.element)) continue;
      this.openDialogStack.splice(i, 1);
      if (this.openDialogStack.length === 0) {
        this.restoreFocus(entry.trigger);
      } else if (document.activeElement === entry.element) {
        this.openDialogStack[this.openDialogStack.length - 1].element.focus();
      }
    }

    // Admit newly opened dialogs in document order.
    for (const def of openDefs) {
      const element = def.el()!.nativeElement;
      if (this.openDialogStack.some((entry) => entry.element === element)) continue;
      this.openDialogStack.push({
        element,
        trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        close: def.close,
      });
    }

    this.updateDialogKeydownListener();

    // Move focus into the active dialog when focus is outside it.
    const active = this.openDialogStack[this.openDialogStack.length - 1];
    if (active && !active.element.contains(document.activeElement)) {
      active.element.focus();
    }
  }

  private updateDialogKeydownListener(): void {
    const shouldListen = this.openDialogStack.length > 0;
    if (shouldListen && !this.keydownListenerAttached) {
      document.addEventListener('keydown', this.onDocumentKeydown, true);
      this.keydownListenerAttached = true;
    } else if (!shouldListen && this.keydownListenerAttached) {
      document.removeEventListener('keydown', this.onDocumentKeydown, true);
      this.keydownListenerAttached = false;
    }
  }

  /**
   * Single document-level handler for the active dialog: Escape closes it,
   * Tab/Shift+Tab wrap among its visible enabled focusables. The close button
   * stays enabled while a mutation is in flight, so it remains a trap target.
   */
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    const active = this.openDialogStack[this.openDialogStack.length - 1];
    if (!active) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      active.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = this.focusableElements(active.element);
    if (focusables.length === 0) return;
    const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = current === null ? -1 : focusables.indexOf(current);
    if (event.shiftKey) {
      if (currentIndex <= 0) {
        event.preventDefault();
        focusables[focusables.length - 1].focus();
      }
    } else if (currentIndex === -1 || currentIndex === focusables.length - 1) {
      event.preventDefault();
      focusables[0].focus();
    }
  };

  /** Visible, enabled, keyboard-reachable elements inside a dialog. */
  private focusableElements(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
    ).filter((el) => {
      if (el.tabIndex < 0) return false;
      if ('disabled' in el && (el as HTMLButtonElement).disabled) return false;
      return true;
    });
  }

  private restoreFocus(trigger: HTMLElement | null): void {
    if (trigger && trigger.isConnected) {
      trigger.focus();
    }
  }

  /**
   * Dispatches one user action with a fresh idempotency key, generated here —
   * once per action — never by the store or service. Command failures are
   * surfaced by the store's error/lastReply signals; nothing is retried.
   * `onSuccess` runs only after the command's authoritative refresh. The
   * command itself stays owned by the store; only the page's callbacks stop
   * when the page is destroyed.
   */
  private runAction(invoke: (idempotencyKey: string) => Observable<unknown>, onSuccess?: () => void): void {
    invoke(crypto.randomUUID())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => onSuccess?.(),
        error: () => void 0,
      });
  }
}
