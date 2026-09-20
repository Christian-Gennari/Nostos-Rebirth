import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { NostosIconComponent } from '../icon/nostos-icon.component';
import { AssistantService, formatTimestamp } from './assistant.service';
import { AssistantVoiceService } from './assistant-voice.service';
import { AssistantStatusService } from './assistant-status.service';
import { LibraryPreferencesService } from '../../core/services/library-preferences.service';

/**
 * App-wide assistant shell (issue #261 §1, §2, §4 capture; #262 voice).
 *
 * One root-level component: a quiet collapsed capsule that opens a compact
 * capture/conversation surface. It is surface-aware — the collapsed trigger
 * moves out of the reader's text column on phones — and it never steals focus
 * while closed. No LLM: capture and push-to-talk voice only.
 *
 * The microphone lives in the composer of the OPEN surface (one tap on the
 * trigger, then the mic). That placement works in every layout, including the
 * icon-only mobile reader variant, and deliberately does not touch the collapsed
 * capsule whose 154px width was measured to cover the page-turn control.
 */
@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [NostosIconComponent],
  templateUrl: './assistant.component.html',
  styleUrl: './assistant.component.css',
  host: {
    '[class.is-open]': 'assistant.isOpen()',
  },
})
export class AssistantComponent {
  readonly assistant = inject(AssistantService);
  readonly voice = inject(AssistantVoiceService);
  private readonly status = inject(AssistantStatusService);
  private readonly preferences = inject(LibraryPreferencesService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  /** The element focused before opening, restored on close. */
  private previouslyFocused: HTMLElement | null = null;

  /**
   * Whether the shell exists at all: the user wants it (preference on) AND the
   * server can run it (available). The panel and the capsule share this one
   * gate, so neither can appear without the other's precondition.
   */
  readonly visible = computed(
    () => this.preferences.assistantEnabled() && this.status.available(),
  );

  /** The compact header names the current book when the surface has one. */
  readonly currentBookTitle = computed(() => {
    const title = this.assistant.context().bookTitle?.trim();
    return title ? title : null;
  });

  /** Drives the quiet send affordance without making the template inspect text. */
  readonly hasDraft = computed(() => this.assistant.draft().trim().length > 0);

  /**
   * How far the software keyboard has lifted the viewport. Drives the mobile
   * sheet's bottom offset so the composer is never buried. 0 on desktop.
   */
  private readonly keyboardOffset = signal(0);

  readonly isOpen = computed(() => this.assistant.isOpen());
  readonly isReader = computed(() => this.assistant.context().surface === 'reader');
  readonly sheetBottomPx = computed(() =>
    this.keyboardOffset() > 0 ? this.keyboardOffset() : null,
  );

  constructor() {
    // Availability is a server fact; ask once for the life of the session.
    this.status.ensureLoaded();

    // A finished transcript is handed to the conversation, which owns the ONE
    // policy for whether it is reviewed or auto-sent. The composer keeps focus so
    // the user can read and edit before pressing Enter.
    this.voice.onTranscript = (text) => {
      this.assistant.insertTranscript(text);
      setTimeout(() => this.composer()?.nativeElement.focus(), 0);
    };
  }

  /** The visible recorder clock, e.g. "0:07". */
  elapsedLabel(): string {
    return formatTimestamp(String(this.voice.elapsedSeconds()));
  }

  onMicTap(): void {
    if (this.voice.isRecording()) {
      this.voice.stop();
      return;
    }
    if (this.voice.status() === 'idle') this.voice.start();
  }

  onVoiceStop(): void {
    this.voice.stop();
  }

  onVoiceCancel(): void {
    this.voice.cancel();
  }

  /** Pre-dispatch Undo: keeps the transcript in the composer, sends nothing. */
  onUndoTranscript(): void {
    this.assistant.undoTranscript();
    setTimeout(() => this.composer()?.nativeElement.focus(), 0);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Cmd/Ctrl+J opens the assistant. Cmd/Ctrl+K belongs to the command
    // palette and is deliberately not touched here.
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'j') {
      // Never hijack the shortcut when the assistant is not on screen.
      if (!this.visible()) return;
      event.preventDefault();
      if (this.assistant.isOpen()) this.close();
      else this.open();
      return;
    }
    if (event.key === 'Escape' && this.visible() && this.assistant.isOpen()) {
      event.preventDefault();
      this.close();
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (!this.assistant.isOpen()) return;
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.close();
  }

  toggle(): void {
    if (this.assistant.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    if (!this.visible()) return;
    this.previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.assistant.open();
    this.startKeyboardTracking();
    setTimeout(() => this.composer()?.nativeElement.focus(), 0);
  }

  close(): void {
    // Closing the surface abandons any live recording or upload: the tracks are
    // stopped and the audio discarded, never left running behind a closed panel.
    this.voice.cancel();
    this.assistant.close();
    this.stopKeyboardTracking();
    const previous = this.previouslyFocused;
    this.previouslyFocused = null;
    if (previous && previous.isConnected) previous.focus();
  }

  onBackdrop(): void {
    this.close();
  }

  onComposerInput(event: Event): void {
    const element = event.target as HTMLTextAreaElement;
    this.assistant.updateDraft(element.value);
    this.autoGrow(element);
  }

  onComposerEnter(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (keyboard.shiftKey) return; // Shift+Enter is a newline.
    event.preventDefault();
    this.submitDraft();
  }

  onSendClick(): void {
    if (!this.hasDraft() || this.assistant.sending()) return;
    this.submitDraft();
    setTimeout(() => this.composer()?.nativeElement.focus(), 0);
  }

  private submitDraft(): void {
    this.assistant.submit();
    const element = this.composer()?.nativeElement;
    if (element) {
      element.value = this.assistant.draft();
      this.autoGrow(element);
    }
  }

  private autoGrow(element: HTMLTextAreaElement): void {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  private startKeyboardTracking(): void {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!viewport) return;
    this.updateKeyboardOffset();
    viewport.addEventListener('resize', this.onViewportChange);
    viewport.addEventListener('scroll', this.onViewportChange);
  }

  private stopKeyboardTracking(): void {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!viewport) return;
    viewport.removeEventListener('resize', this.onViewportChange);
    viewport.removeEventListener('scroll', this.onViewportChange);
    this.keyboardOffset.set(0);
  }

  private readonly onViewportChange = (): void => this.updateKeyboardOffset();

  private updateKeyboardOffset(): void {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!viewport) {
      this.keyboardOffset.set(0);
      return;
    }
    const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    this.keyboardOffset.set(Math.round(offset));
  }
}
