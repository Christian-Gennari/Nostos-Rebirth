import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { BackupService } from '../core/services/backup.service';
import { OpdsService } from '../core/services/opds.service';
import { ToastService } from '../core/services/toast.service';
import { ThemeService, Theme } from '../core/services/theme.service';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';
import {
  BackupStatus,
  BackupSettings,
  BackupHistoryItem,
  BackupProgress,
} from '../core/dtos/backup.dtos';
import { OpdsInfo } from '../core/dtos/opds.dtos';
import { NostosIconComponent } from '../ui/icon/nostos-icon.component';
import { LibraryPreferencesService } from '../core/services/library-preferences.service';
import { AssistantStatusService } from '../ui/assistant/assistant-status.service';
import { AssistantSettingsService } from '../ui/assistant/assistant-settings.service';
import { PROCESSING_MODES, ProcessingMode } from '../ui/assistant/assistant.service';
import { AiProviderService } from '../core/services/ai-provider.service';
import {
  AiProviderKind,
  AiProviderSection,
  AiProviderSectionUpdate,
  AiProviderUpdate,
} from '../core/dtos/ai-provider.dtos';

const SLOW_STEP_THRESHOLD_MS = 30_000;

/** How long the copy button stays on "Copied" before it offers to copy again. */
const COPIED_FEEDBACK_MS = 2_500;

/**
 * Every user-visible string for the AI provider feature, in one place: the card's
 * own copy plus the locked-state sentence the older Reading assistant card shows
 * when no provider is configured. Keeping them together means a wording change is
 * a single edit.
 */
const AI_PROVIDER_COPY = {
  title: 'AI provider',
  intro:
    'Notes and voice recordings are sent directly to the OpenAI-compatible endpoints configured below.',
  readingAssistant: 'Reading assistant',
  voiceTranscription: 'Voice transcription',
  voiceToggle: 'Enable voice transcription',
  voiceToggleHelp: 'Send voice recordings to the transcription endpoint.',
  endpoint: 'Endpoint',
  endpointPlaceholder: 'https://api.openai.com/v1',
  endpointHelp: 'Base URL, including /v1.',
  model: 'Model',
  modelPlaceholderLlm: 'e.g. gpt-4o-mini',
  modelPlaceholderStt: 'e.g. whisper-1',
  modelHelp: 'Exact model name expected by the endpoint.',
  apiKey: 'API key',
  apiKeyPlaceholderUnset: 'Leave empty if unauthenticated',
  apiKeyPlaceholderSet: 'Configured on server (leave blank to keep)',
  apiKeyHelp: 'Stored on your server. Never returned to the browser.',
  loadModels: 'Load models',
  testConnection: 'Test connection',
  clear: 'Clear key',
  save: 'Save',
  testing: 'Testing connection…',
  loading: 'Loading models…',
  saved: 'Saved.',
  modelsLoaded: (count: number) => `Loaded ${count} models.`,
  modelsEmpty: 'No models returned by endpoint.',
  modelsError: (message: string) => `Could not load models: ${message}`,
  connectionError: (message: string) => `Connection failed: ${message}`,
  keyCleared: 'Key removed. Falling back to environment variable if present.',
  oldCardEmptyState: 'Set up an AI provider in Settings to enable this.',
  // Capture processing (issue #262): the stored, global choice that used to be a
  // per-capture select in the widget. The description shown is the one belonging
  // to the currently selected option, followed by `captureScope`.
  //
  // The three descriptions are not parallel by accident: only the third claims
  // anything about the user's words, because only that one stops being them.
  // `clarify` rewrites vocabulary and syntax, so calling its output "your words"
  // would be a lie, and "one clear thought" would promise a quality the setting
  // cannot guarantee.
  captureLabel: 'Captured thoughts',
  captureScope: 'Applies only to new notes. Existing notes are never rewritten.',
  captureDescriptions: {
    verbatim: 'Your words, exactly as you wrote or spoke them.',
    light_polish: 'Your words with grammar and filler tidied, nothing added or dropped.',
    clarify: 'Your thoughts consolidated into a single note, rephrased for coherence.',
  } as Record<ProcessingMode, string>,
  captureLoadFailed: 'Could not read this setting',
  captureLoadFailedHelp:
    'The server did not answer the request for how your captures are saved. Reload the page to try again.',
  captureSaveFailed: 'Could not save this setting. Your previous choice is still in effect.',
  // The reviewed set covers the four card actions but not a failed GET/PUT or
  // the configured-key signals, so these keep their earlier wording.
  configured: 'Configured',
  configuredFromEnv: 'Configured — using the server environment variable.',
  loadFailed: 'Could not load the AI provider settings.',
  couldNotSave: (message: string) => `Could not save: ${message}`,
} as const;

/** How a section's inline status line is coloured. */
type AiProviderStatusTone = 'neutral' | 'ok' | 'error';

interface AiProviderStatus {
  text: string;
  tone: AiProviderStatusTone;
}

/**
 * One provider's editable state. The `saved*` fields are the effective values
 * the server last reported, so Save can send only what actually changed; the
 * typed `key` is never seeded from a response (the API does not return one).
 */
interface AiProviderForm {
  enabled: boolean;
  baseUrl: string;
  model: string;
  key: string;
  keyCleared: boolean;
  hasKey: boolean;
  keyFromServerEnv: boolean;
  savedBaseUrl: string;
  savedModel: string;
  savedEnabled: boolean;
}

function emptyAiProviderForm(): AiProviderForm {
  return {
    enabled: false,
    baseUrl: '',
    model: '',
    key: '',
    keyCleared: false,
    hasKey: false,
    keyFromServerEnv: false,
    savedBaseUrl: '',
    savedModel: '',
    savedEnabled: false,
  };
}

const defaultProgress: BackupProgress = {
  isRunning: false,
  currentStep: null,
  percentComplete: 0,
  startedAt: null,
  stepNumber: 0,
  totalSteps: 0,
};

@Component({
  standalone: true,
  selector: 'app-settings',
  imports: [CommonModule, FormsModule, NostosIconComponent, ConfirmModal],
  template: `
    <div class="settings-page">
      <header class="settings-header">
        <h1>Settings</h1>
      </header>

      <section class="settings-card">
        <div class="card-header">
          <nostos-icon name="gear-six" [size]="20" weight="light"></nostos-icon>
          <h2>Backup</h2>
        </div>

        <div class="card-body">
          <!-- Enable Toggle -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Automatic Backup</span>
              @if (settings().isEnabled) {
                <span class="label-desc">Backups are created automatically every {{ formatInterval(settings().intervalHours) }}.</span>
              } @else {
                <span class="label-desc">When turned on, the first backup will run within 5 minutes, then every {{ formatInterval(settings().intervalHours) }} thereafter.</span>
              }
            </div>
            <label class="toggle">
              <input type="checkbox" [checked]="settings().isEnabled" (change)="toggleEnabled($event)">
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Include Book Files -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Include Book Files</span>
              <span class="label-desc">Include EPUB, PDF, and audio files in backups. Makes archives much larger but ensures full recovery.</span>
            </div>
            <label class="toggle">
              <input type="checkbox" [checked]="settings().includeBookFiles" (change)="toggleBookFiles($event)">
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Schedule -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Backup Frequency</span>
              <span class="label-desc">How often to create automatic backups.</span>
            </div>
            <select class="select-sm" [value]="settings().intervalHours.toString()" (change)="changeInterval($event)">
              <option value="6">Every 6 hours</option>
              <option value="12">Every 12 hours</option>
              <option value="24">Daily</option>
              <option value="168">Weekly</option>
            </select>
          </div>

          <!-- Max Backups -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Max Backups</span>
              <span class="label-desc">Oldest backups will be automatically deleted when this limit is reached.</span>
            </div>
            <select class="select-sm" [value]="settings().maxBackups.toString()" (change)="changeMaxBackups($event)">
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
          </div>

          <!-- Manual Backup -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Manual Backup</span>
              <span class="label-desc">Create a backup now regardless of the schedule.</span>
            </div>
            <button
              class="btn btn-primary"
              [disabled]="backingUp()"
              (click)="triggerBackup()"
            >
              @if (backingUp()) {
                <nostos-icon name="circle-notch" [size]="16" class="spin"></nostos-icon>
                Backing up...
              } @else {
                <nostos-icon name="arrows-clockwise" [size]="16"></nostos-icon>
                Back up now
              }
            </button>
          </div>

          @if (backingUp() && progress().isRunning) {
            <div class="progress-bar-container">
              <div class="progress-step-label">
                Step {{ progress().stepNumber }} of {{ progress().totalSteps }} &mdash; {{ progress().currentStep }}
              </div>
              <div class="progress-bar">
                <div class="progress-bar-fill" [style.width.%]="progress().percentComplete"></div>
              </div>
              @if (showSlowNotice()) {
                <div class="slow-notice">
                  This step may take a few minutes for large libraries.
                </div>
              }
            </div>
          }

          <!-- Import from Disk -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Import from Disk</span>
              <span class="label-desc">Copy .nostos files to the Storage/backups/ folder on the server, then scan to add them to your history.</span>
            </div>
            <button
              class="btn btn-secondary"
              [disabled]="importing()"
              (click)="scanForBackups()"
            >
              @if (importing()) {
                <nostos-icon name="circle-notch" [size]="16" class="spin"></nostos-icon>
                Scanning...
              } @else {
                <nostos-icon name="folder-simple" [size]="16"></nostos-icon>
                Scan for Backups
              }
            </button>
          </div>

          <!-- Last Backup Info -->
          @if (status().lastBackupAt) {
            <div class="last-backup-info">
              Last backup: {{ status().lastBackupAt | date:'medium' }}
              <span class="status-{{ status().lastBackupStatus === 'Completed' ? 'success' : 'error' }}">
                {{ status().lastBackupStatus }}
              </span>
            </div>
          }
        </div>
      </section>

      <!-- Backup History -->
      <section class="settings-card">
        <div class="card-header">
          <nostos-icon name="archive" [size]="20" weight="light"></nostos-icon>
          <h2>Backup History</h2>
        </div>

        @if (history().length === 0) {
          <div class="empty-state">
            No backups yet. Create your first backup to get started.
          </div>
        } @else {
          <div class="history-list">
            @for (item of history(); track item.id) {
              <div class="history-item">
                <div class="history-info">
                  <span class="history-date">{{ item.createdAt | date:'medium' }}</span>
                  <span class="history-meta">
                    {{ formatSize(item.sizeBytes) }}
                    @if (item.includeBookFiles) {
                      &middot; with files
                    } @else {
                      &middot; metadata only
                    }
                    @if (item.errorMessage) {
                      &middot; <span class="status-error">{{ item.errorMessage }}</span>
                    }
                  </span>
                </div>
                <div class="history-actions">
                  <span class="status-{{ item.status === 'Completed' ? 'success' : item.status === 'Failed' ? 'error' : 'pending' }}">
                    {{ item.status }}
                  </span>
                  @if (item.status === 'Completed') {
                    <button class="btn btn-sm btn-secondary" (click)="downloadBackup(item.id)" title="Download archive">
                      <nostos-icon name="download-simple" [size]="14"></nostos-icon>
                    </button>
                    <button class="btn btn-sm btn-secondary" (click)="restoreBackup(item.id)" [disabled]="restoring()" title="Restore from this backup">
                      <nostos-icon name="arrows-clockwise" [size]="14"></nostos-icon>
                      Restore
                    </button>
                  }
                  <button class="btn btn-sm btn-danger" (click)="deleteBackup(item.id)" title="Delete backup">
                    <nostos-icon name="trash" [size]="14"></nostos-icon>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        @if (restoring() && progress().isRunning) {
          <div class="progress-bar-container">
            <div class="progress-step-label">
              Step {{ progress().stepNumber }} of {{ progress().totalSteps }} &mdash; {{ progress().currentStep }}
            </div>
            <div class="progress-bar">
              <div class="progress-bar-fill" [style.width.%]="progress().percentComplete"></div>
            </div>
            @if (showSlowNotice()) {
              <div class="slow-notice">
                This step may take a few minutes for large libraries.
              </div>
            }
          </div>
        }
      </section>

      <!-- E-reader access (issue #187). Sits with the library data rather than
           with Appearance: it is about reaching the library from elsewhere. -->
      <section class="settings-card">
        <div class="card-header">
          <nostos-icon name="book-open" [size]="20" weight="light"></nostos-icon>
          <h2>E-reader access</h2>
        </div>

        <div class="card-body">
          @if (opdsFailed()) {
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Could not read this setting</span>
                <span class="label-desc">The server did not answer the request for e-reader access. Reload the page to try again.</span>
              </div>
            </div>
          } @else if (opds(); as info) {
            @if (info.enabled && info.catalogUrl) {
              <div class="setting-row setting-row--stacked">
                <div class="setting-label">
                  <span class="label-text">Catalog address</span>
                  <span class="label-desc">Give this address to a compatible e-reader or reading app &mdash; it browses and downloads straight from your Nostos library, so nothing is copied and there is no second library to keep in sync.</span>
                </div>

                <div class="catalog-url-row">
                  <code class="catalog-url">{{ info.catalogUrl }}</code>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    (click)="copyCatalogUrl()"
                    [attr.aria-label]="'Copy catalog address ' + info.catalogUrl"
                  >
                    @if (copied()) {
                      <nostos-icon name="check" [size]="14"></nostos-icon>
                      Copied
                    } @else {
                      <nostos-icon name="copy" [size]="14"></nostos-icon>
                      Copy URL
                    }
                  </button>
                </div>

                @if (info.localOnly) {
                  <p class="catalog-note catalog-note--warning">
                    <nostos-icon name="warning" [size]="14"></nostos-icon>
                    <span>This address only works on this computer. Open Nostos from the address your reader will use &mdash; your machine's address on your home network or Tailscale &mdash; and the catalog address will match it.</span>
                  </p>
                } @else {
                  <p class="catalog-note">
                    Your reader has to be able to reach this server: the same home network or Tailscale network you are on now. In the reader's settings, look for &ldquo;catalog&rdquo; or &ldquo;OPDS catalog&rdquo; and enter the address above.
                  </p>
                }
              </div>
            } @else {
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">E-reader access is turned off</span>
                  <span class="label-desc">This server is not publishing a catalog, so there is no address to connect to. It can be switched on where Nostos is configured, with <code class="inline-code">Opds:Enabled=true</code>.</span>
                </div>
              </div>
            }
          }
        </div>
      </section>

      <!-- Reading assistant (W1). Availability is the server's to decide; this
           toggle is user intent only. When unavailable it renders off and
           non-interactive, and the supporting sentence explains why rather than
           the card hiding or adding a warning. -->
      <section class="settings-card" data-testid="assistant-settings-card">
        <div class="card-header">
          <nostos-icon name="sparkle" [size]="20" weight="light"></nostos-icon>
          <h2>Reading assistant</h2>
        </div>

        <div class="card-body">
          <div class="setting-row">
            <div class="setting-label">
              @if (assistantAvailable()) {
                <span class="label-desc">Show the dock capsule for capturing thoughts while reading.</span>
              } @else {
                <span class="label-desc">{{ copy.oldCardEmptyState }}</span>
              }
            </div>
            @if (assistantAvailable()) {
              <label class="toggle">
                <input
                  type="checkbox"
                  [checked]="assistantEnabled()"
                  (change)="setAssistantEnabled($event)"
                  aria-label="Reading assistant"
                  data-testid="assistant-enabled-toggle"
                >
                <span class="toggle-slider"></span>
              </label>
            } @else {
              <label class="toggle toggle--disabled">
                <input
                  type="checkbox"
                  [checked]="false"
                  disabled
                  aria-disabled="true"
                  aria-label="Reading assistant"
                  data-testid="assistant-enabled-toggle"
                >
                <span class="toggle-slider"></span>
              </label>
            }
          </div>

          <!-- The stored capture-processing choice (issue #262). It applies to
               the user's own words as they become a note; it is not gated on
               availability and has no disabled state — that is the toggle's
               business, this is a preference the server applies at capture. -->
          @if (assistantSettingsFailed()) {
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">{{ copy.captureLoadFailed }}</span>
                <span class="label-desc">{{ copy.captureLoadFailedHelp }}</span>
              </div>
            </div>
          } @else {
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">{{ copy.captureLabel }}</span>
                <span class="label-desc">{{ captureModeDescription() }} {{ copy.captureScope }}</span>
                @if (assistantSettingsSaveFailed()) {
                  <span class="label-desc">{{ copy.captureSaveFailed }}</span>
                }
              </div>
              <select
                class="select-sm"
                data-testid="capture-processing-mode"
                [attr.aria-label]="copy.captureLabel"
                (change)="changeCaptureProcessingMode($event)"
              >
                @for (mode of processingModes; track mode.value) {
                  <option [value]="mode.value" [selected]="mode.value === captureProcessingMode()">
                    {{ mode.label }}
                  </option>
                }
              </select>
            </div>
          }
        </div>
      </section>

      <!-- AI provider: the LLM and voice-STT endpoints, moved out of
           appsettings.json. Both sub-sections share one Save; the API key is
           write-only, so the password field is never seeded from the server and
           Save omits apiKey unless the user typed one or pressed Clear. -->
      <section class="settings-card" data-testid="ai-provider-settings-card">
        <div class="card-header">
          <nostos-icon name="brain" [size]="20" weight="light"></nostos-icon>
          <h2>{{ copy.title }}</h2>
        </div>

        @if (aiLoadFailed()) {
          <div class="card-body">
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">{{ copy.loadFailed }}</span>
                <span class="label-desc">The server did not answer the request for the current settings. Reload the page to try again.</span>
              </div>
            </div>
          </div>
        } @else {
          <div class="card-body">
            <p class="provider-intro">{{ copy.intro }}</p>

            <!-- Reading assistant (text/LLM) -->
            <div class="provider-section" data-testid="ai-provider-llm">
              <h3 class="provider-heading">{{ copy.readingAssistant }}</h3>

              <div class="provider-field">
                <label class="provider-label" for="ai-llm-base-url">{{ copy.endpoint }}</label>
                <input
                  id="ai-llm-base-url"
                  class="provider-input"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  [placeholder]="copy.endpointPlaceholder"
                  [value]="aiLlm().baseUrl"
                  (input)="setAiBaseUrl('llm', $event)"
                />
                <p class="provider-help">{{ copy.endpointHelp }}</p>
              </div>

              <div class="provider-field">
                <label class="provider-label" for="ai-llm-model">{{ copy.model }}</label>
                <div class="provider-input-row">
                  <input
                    id="ai-llm-model"
                    class="provider-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    [placeholder]="copy.modelPlaceholderLlm"
                    list="ai-llm-model-options"
                    [value]="aiLlm().model"
                    (input)="setAiModel('llm', $event)"
                  />
                  <button
                    type="button"
                    class="btn btn-secondary"
                    (click)="loadAiModels('llm')"
                    [disabled]="aiBusy()"
                  >
                    @if (aiLoadingKind() === 'llm') {
                      <nostos-icon name="circle-notch" [size]="15" class="spin"></nostos-icon>
                      {{ copy.loading }}
                    } @else {
                      {{ copy.loadModels }}
                    }
                  </button>
                </div>
                <datalist id="ai-llm-model-options">
                  @for (model of aiLlmModels(); track model) {
                    <option [value]="model"></option>
                  }
                </datalist>
                <p class="provider-help">{{ copy.modelHelp }}</p>
              </div>

              <div class="provider-field">
                <label class="provider-label" for="ai-llm-api-key">{{ copy.apiKey }}</label>
                <input
                  id="ai-llm-api-key"
                  class="provider-input"
                  type="password"
                  autocomplete="new-password"
                  [placeholder]="
                    aiLlm().hasKey || aiLlm().keyFromServerEnv
                      ? copy.apiKeyPlaceholderSet
                      : copy.apiKeyPlaceholderUnset
                  "
                  [value]="aiLlm().key"
                  (input)="setAiKey('llm', $event)"
                />
                @if (aiLlm().hasKey || aiLlm().key.length > 0) {
                  <div class="provider-key-row">
                    <span class="provider-key-state">
                      <nostos-icon name="check" [size]="14"></nostos-icon>
                      {{ aiLlm().keyFromServerEnv ? copy.configuredFromEnv : copy.configured }}
                    </span>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      (click)="clearAiKey('llm')"
                      [disabled]="aiBusy()"
                    >
                      {{ copy.clear }}
                    </button>
                  </div>
                }
                <p class="provider-help">{{ copy.apiKeyHelp }}</p>
              </div>

              <div class="provider-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  (click)="testAiConnection('llm')"
                  [disabled]="aiBusy()"
                >
                  @if (aiTestingKind() === 'llm') {
                    <nostos-icon name="circle-notch" [size]="15" class="spin"></nostos-icon>
                    {{ copy.testing }}
                  } @else {
                    {{ copy.testConnection }}
                  }
                </button>
              </div>

              @if (aiLlmStatus(); as status) {
                <p
                  class="provider-status"
                  [class.is-ok]="status.tone === 'ok'"
                  [class.is-error]="status.tone === 'error'"
                  role="status"
                >{{ status.text }}</p>
              }
            </div>

            <!-- Voice transcription (speech-to-text) -->
            <div class="provider-section" data-testid="ai-provider-stt">
              <h3 class="provider-heading">{{ copy.voiceTranscription }}</h3>

              <div class="provider-toggle-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    [checked]="aiStt().enabled"
                    (change)="setAiVoiceEnabled($event)"
                    [attr.aria-label]="copy.voiceToggle"
                    data-testid="voice-transcription-toggle"
                  >
                  <span class="toggle-slider"></span>
                </label>
                <span class="provider-toggle-label">{{ copy.voiceToggle }}</span>
              </div>
              <p class="provider-help provider-toggle-help">{{ copy.voiceToggleHelp }}</p>

              <div class="provider-field">
                <label class="provider-label" for="ai-stt-base-url">{{ copy.endpoint }}</label>
                <input
                  id="ai-stt-base-url"
                  class="provider-input"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  [placeholder]="copy.endpointPlaceholder"
                  [value]="aiStt().baseUrl"
                  (input)="setAiBaseUrl('stt', $event)"
                />
                <p class="provider-help">{{ copy.endpointHelp }}</p>
              </div>

              <div class="provider-field">
                <label class="provider-label" for="ai-stt-model">{{ copy.model }}</label>
                <div class="provider-input-row">
                  <input
                    id="ai-stt-model"
                    class="provider-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    [placeholder]="copy.modelPlaceholderStt"
                    list="ai-stt-model-options"
                    [value]="aiStt().model"
                    (input)="setAiModel('stt', $event)"
                  />
                  <button
                    type="button"
                    class="btn btn-secondary"
                    (click)="loadAiModels('stt')"
                    [disabled]="aiBusy()"
                  >
                    @if (aiLoadingKind() === 'stt') {
                      <nostos-icon name="circle-notch" [size]="15" class="spin"></nostos-icon>
                      {{ copy.loading }}
                    } @else {
                      {{ copy.loadModels }}
                    }
                  </button>
                </div>
                <datalist id="ai-stt-model-options">
                  @for (model of aiSttModels(); track model) {
                    <option [value]="model"></option>
                  }
                </datalist>
                <p class="provider-help">{{ copy.modelHelp }}</p>
              </div>

              <div class="provider-field">
                <label class="provider-label" for="ai-stt-api-key">{{ copy.apiKey }}</label>
                <input
                  id="ai-stt-api-key"
                  class="provider-input"
                  type="password"
                  autocomplete="new-password"
                  [placeholder]="
                    aiStt().hasKey || aiStt().keyFromServerEnv
                      ? copy.apiKeyPlaceholderSet
                      : copy.apiKeyPlaceholderUnset
                  "
                  [value]="aiStt().key"
                  (input)="setAiKey('stt', $event)"
                />
                @if (aiStt().hasKey || aiStt().key.length > 0) {
                  <div class="provider-key-row">
                    <span class="provider-key-state">
                      <nostos-icon name="check" [size]="14"></nostos-icon>
                      {{ aiStt().keyFromServerEnv ? copy.configuredFromEnv : copy.configured }}
                    </span>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      (click)="clearAiKey('stt')"
                      [disabled]="aiBusy()"
                    >
                      {{ copy.clear }}
                    </button>
                  </div>
                }
                <p class="provider-help">{{ copy.apiKeyHelp }}</p>
              </div>

              <div class="provider-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  (click)="testAiConnection('stt')"
                  [disabled]="aiBusy()"
                >
                  @if (aiTestingKind() === 'stt') {
                    <nostos-icon name="circle-notch" [size]="15" class="spin"></nostos-icon>
                    {{ copy.testing }}
                  } @else {
                    {{ copy.testConnection }}
                  }
                </button>
              </div>

              @if (aiSttStatus(); as status) {
                <p
                  class="provider-status"
                  [class.is-ok]="status.tone === 'ok'"
                  [class.is-error]="status.tone === 'error'"
                  role="status"
                >{{ status.text }}</p>
              }
            </div>

            <div class="provider-footer">
              <button
                type="button"
                class="btn btn-primary"
                (click)="saveAiProvider()"
                [disabled]="aiBusy()"
                data-testid="ai-provider-save"
              >
                @if (aiSaving()) {
                  <nostos-icon name="circle-notch" [size]="15" class="spin"></nostos-icon>
                }
                {{ copy.save }}
              </button>
              @if (aiSaveStatus(); as status) {
                <span
                  class="provider-save-status"
                  [class.is-ok]="status.tone === 'ok'"
                  [class.is-error]="status.tone === 'error'"
                  role="status"
                >{{ status.text }}</span>
              }
            </div>
          </div>
        }
      </section>

      <section class="settings-card">
        <div class="card-header">
          <nostos-icon name="palette" [size]="20" weight="light"></nostos-icon>
          <h2>Appearance</h2>
        </div>

        <div class="card-body">
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Colour Theme</span>
              <span class="label-desc">Dark mode is a companion palette for evening reading — same paper, lower light.</span>
            </div>
            <!-- Two explicit options rather than a light/dark switch: the
                 control always shows both states, so the choice is legible
                 before it is made. -->
            <div class="theme-choice" role="radiogroup" aria-label="Colour theme">
              <button
                type="button"
                class="theme-opt"
                role="radio"
                [attr.aria-checked]="theme() === 'light'"
                [class.is-active]="theme() === 'light'"
                (click)="setTheme('light')"
              >
                <nostos-icon name="sun" [size]="15"></nostos-icon>
                Light
              </button>
              <button
                type="button"
                class="theme-opt"
                role="radio"
                [attr.aria-checked]="theme() === 'dark'"
                [class.is-active]="theme() === 'dark'"
                (click)="setTheme('dark')"
              >
                <nostos-icon name="moon" [size]="15"></nostos-icon>
                Dark
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Restore overwrites live data and delete removes the archive: both ask
         through the shared modal instead of window.confirm(). -->
    <app-confirm-modal
      [isOpen]="!!pendingRestore()"
      heading="Restore from this backup?"
      description="This overwrites your current database and book files with the backup data. A safety copy of the current database is made first, and you should restart the application after restore."
      confirmLabel="Restore"
      busyLabel="Restoring…"
      [busy]="restoring()"
      (confirm)="confirmRestore()"
      (cancel)="cancelRestore()"
    >
    </app-confirm-modal>

    <app-confirm-modal
      [isOpen]="!!pendingBackupDelete()"
      heading="Delete this backup?"
      description="The backup and its archive file are permanently removed."
      confirmLabel="Delete"
      (confirm)="confirmBackupDelete()"
      (cancel)="cancelBackupDelete()"
    >
    </app-confirm-modal>
  `,
  styleUrls: ['./settings.component.css'],
})
export class SettingsComponent implements OnInit, OnDestroy {
  private backupService = inject(BackupService);
  private opdsService = inject(OpdsService);
  private toast = inject(ToastService);
  private themeService = inject(ThemeService);
  private assistantStatus = inject(AssistantStatusService);
  private assistantSettings = inject(AssistantSettingsService);
  private preferences = inject(LibraryPreferencesService);
  private aiProvider = inject(AiProviderService);

  /** The AI provider card's copy, exposed so the template reads one source. */
  readonly copy = AI_PROVIDER_COPY;

  /** The active theme, exposed for the Appearance card. */
  readonly theme = this.themeService.theme;

  /** Whether the server can run the assistant, for the Reading assistant card. */
  readonly assistantAvailable = this.assistantStatus.available;

  /** The persisted user intent for the Reading assistant toggle. */
  readonly assistantEnabled = this.preferences.assistantEnabled;

  /** The stored capture-processing choice, exposed to the Reading assistant card. */
  readonly captureProcessingMode = this.assistantSettings.captureProcessingMode;

  /** The three modes in presentation order, with the labels the select shows. */
  readonly processingModes = PROCESSING_MODES;

  /** True when the server did not answer the capture setting GET. */
  readonly assistantSettingsFailed = this.assistantSettings.loadFailed;

  /** True when the capture setting PUT failed; the previous choice stays in force. */
  readonly assistantSettingsSaveFailed = this.assistantSettings.saveFailed;

  /** The description of the selected option; the card appends the fixed scope note. */
  readonly captureModeDescription = computed(
    () => this.copy.captureDescriptions[this.captureProcessingMode()],
  );

  setAssistantEnabled(event: Event): void {
    // The control is disabled while unavailable, so this is belt-and-braces:
    // never record intent the server cannot yet honour.
    if (!this.assistantAvailable()) return;
    const checked = (event.target as HTMLInputElement).checked;
    this.preferences.setAssistantEnabled(checked);
  }

  changeCaptureProcessingMode(event: Event): void {
    this.assistantSettings.setCaptureProcessingMode(
      (event.target as HTMLSelectElement).value as ProcessingMode,
    );
  }

  setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }
  /** E-reader access (issue #187): null until the server has answered. */
  opds = signal<OpdsInfo | null>(null);

  /** True when the info request failed, so the card never presents a guess as fact. */
  opdsFailed = signal(false);

  copied = signal(false);
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- AI provider card state ------------------------------------------
  // The card loads its own effective settings; a failure is shown in place
  // rather than guessed at, so the fields are never presented as fact.
  aiLoadFailed = signal(false);
  aiLlm = signal<AiProviderForm>(emptyAiProviderForm());
  aiStt = signal<AiProviderForm>(emptyAiProviderForm());

  /** Model ids offered as suggestions for each sub-section (free text stays editable). */
  aiLlmModels = signal<string[]>([]);
  aiSttModels = signal<string[]>([]);

  /** Inline outcome lines: `Testing…` / test result / load result / clear notice. */
  aiLlmStatus = signal<AiProviderStatus | null>(null);
  aiSttStatus = signal<AiProviderStatus | null>(null);
  aiSaveStatus = signal<AiProviderStatus | null>(null);

  aiSaving = signal(false);

  /** Which section, if any, is running a Load models request. One at a time. */
  aiLoadingKind = signal<AiProviderKind | null>(null);

  /** Which section, if any, is running a Test connection request. One at a time. */
  aiTestingKind = signal<AiProviderKind | null>(null);

  aiBusy = computed(
    () => this.aiSaving() || this.aiLoadingKind() !== null || this.aiTestingKind() !== null,
  );

  status = signal<BackupStatus>({
    isEnabled: false,
    provider: 'Local',
    lastBackupAt: null,
    lastBackupStatus: null,
    includeBookFiles: true,
    intervalHours: 168,
    maxBackups: 3,
  });

  settings = signal<BackupSettings>({
    isEnabled: false,
    provider: 'Local',
    includeBookFiles: true,
    intervalHours: 168,
    maxBackups: 3,
  });

  history = signal<BackupHistoryItem[]>([]);
  backingUp = signal(false);
  restoring = signal(false);
  importing = signal(false);

  /** Backup id awaiting restore confirmation (asked through ConfirmModal). */
  pendingRestore = signal<string | null>(null);

  /** Backup id awaiting archive-delete confirmation (asked through ConfirmModal). */
  pendingBackupDelete = signal<string | null>(null);
  progress = signal<BackupProgress>(defaultProgress);
  showSlowNotice = signal(false);
  private stepChangedAt = 0;
  private slowNoticeInterval: ReturnType<typeof setInterval> | null = null;

  private progressInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadData();
    this.loadOpdsInfo();
    this.loadAiProvider();
    this.assistantStatus.refresh();
    this.assistantSettings.refresh();
  }

  ngOnDestroy(): void {
    this.stopProgressPolling();
    if (this.copiedTimeout !== null) {
      clearTimeout(this.copiedTimeout);
      this.copiedTimeout = null;
    }
  }

  loadOpdsInfo(): void {
    this.opdsService.getInfo().subscribe({
      next: (info) => {
        this.opds.set(info);
        this.opdsFailed.set(false);
      },
      error: () => {
        this.opds.set(null);
        this.opdsFailed.set(true);
      },
    });
  }

  // --- AI provider card -------------------------------------------------
  // Four calls, one dedicated service. The key is write-only: `toForm` never
  // seeds `key`, and Save includes `apiKey` only when the user typed one or
  // pressed Clear.

  loadAiProvider(): void {
    this.aiProvider.get().subscribe({
      next: (settings) => {
        this.aiLlm.set(this.toAiForm(settings.llm));
        this.aiStt.set(this.toAiForm(settings.stt));
        this.aiLoadFailed.set(false);
      },
      error: () => {
        this.aiLoadFailed.set(true);
      },
    });
  }

  setAiBaseUrl(kind: AiProviderKind, event: Event): void {
    this.patchAiForm(kind, { baseUrl: (event.target as HTMLInputElement).value });
  }

  setAiModel(kind: AiProviderKind, event: Event): void {
    this.patchAiForm(kind, { model: (event.target as HTMLInputElement).value });
  }

  setAiKey(kind: AiProviderKind, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    // Typing revokes a pending Clear; emptying the field again does NOT clear the
    // stored key — the brief makes Clear the only explicit clear signal.
    this.patchAiForm(kind, {
      key: value,
      keyCleared: value.length > 0 ? false : this.aiFormFor(kind).keyCleared,
    });
  }

  setAiVoiceEnabled(event: Event): void {
    this.patchAiForm('stt', { enabled: (event.target as HTMLInputElement).checked });
  }

  clearAiKey(kind: AiProviderKind): void {
    this.patchAiForm(kind, { key: '', keyCleared: true });
    this.setAiStatus(kind, { text: AI_PROVIDER_COPY.keyCleared, tone: 'neutral' });
  }

  /**
   * Asks the endpoint what models it advertises. The unsaved endpoint/key are
   * sent along so the lookup matches what the user is about to save; the stored
   * key is used when the field is empty.
   */
  loadAiModels(kind: AiProviderKind): void {
    if (this.aiBusy()) return;
    const form = this.aiFormFor(kind);
    const request = { kind, baseUrl: form.baseUrl, apiKey: form.key || undefined };

    this.aiLoadingKind.set(kind);
    this.setAiStatus(kind, { text: AI_PROVIDER_COPY.loading, tone: 'neutral' });
    this.aiProvider.loadModels(request).subscribe({
      next: (response) => {
        this.aiLoadingKind.set(null);
        const models = response.models ?? [];
        this.setAiModels(kind, models);
        this.setAiStatus(
          kind,
          models.length === 0
            ? { text: AI_PROVIDER_COPY.modelsEmpty, tone: 'neutral' }
            : { text: AI_PROVIDER_COPY.modelsLoaded(models.length), tone: 'ok' },
        );
      },
      error: (error) => {
        this.aiLoadingKind.set(null);
        this.setAiStatus(kind, {
          text: AI_PROVIDER_COPY.modelsError(this.errorMessage(error)),
          tone: 'error',
        });
      },
    });
  }

  /**
   * One real round-trip against the provider. The route always answers HTTP 200
   * so a failure can carry a message, so this branches on `ok`, never the status.
   */
  testAiConnection(kind: AiProviderKind): void {
    if (this.aiBusy()) return;
    const form = this.aiFormFor(kind);
    const request = {
      kind,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.key || undefined,
    };

    this.aiTestingKind.set(kind);
    this.setAiStatus(kind, { text: AI_PROVIDER_COPY.testing, tone: 'neutral' });
    this.aiProvider.test(request).subscribe({
      next: (result) => {
        this.aiTestingKind.set(null);
        this.setAiStatus(
          kind,
          result.ok
            ? { text: result.detail, tone: 'ok' }
            : { text: result.error, tone: 'error' },
        );
      },
      error: (error) => {
        this.aiTestingKind.set(null);
        this.setAiStatus(kind, {
          text: AI_PROVIDER_COPY.connectionError(this.errorMessage(error)),
          tone: 'error',
        });
      },
    });
  }

  /** Sends only the sections that changed; re-seeds from the response on success. */
  saveAiProvider(): void {
    if (this.aiBusy()) return;

    const update: AiProviderUpdate = {};
    const llm = this.buildAiSectionUpdate(this.aiLlm());
    if (llm) update.llm = llm;
    const stt = this.buildAiSectionUpdate(this.aiStt());
    if (stt) update.stt = stt;

    this.aiSaving.set(true);
    this.aiSaveStatus.set(null);
    this.aiProvider.update(update).subscribe({
      next: (settings) => {
        this.aiSaving.set(false);
        this.aiLlm.set(this.toAiForm(settings.llm));
        this.aiStt.set(this.toAiForm(settings.stt));
        this.aiSaveStatus.set({ text: AI_PROVIDER_COPY.saved, tone: 'ok' });
      },
      error: (error) => {
        this.aiSaving.set(false);
        this.aiSaveStatus.set({
          text: AI_PROVIDER_COPY.couldNotSave(this.errorMessage(error)),
          tone: 'error',
        });
      },
    });
  }

  /**
   * A section's PUT body, or null when nothing in it changed. `apiKey` is present
   * only for a typed value or a Clear — otherwise the key is left untouched.
   */
  private buildAiSectionUpdate(form: AiProviderForm): AiProviderSectionUpdate | null {
    const update: AiProviderSectionUpdate = {};
    let changed = false;

    if (form.baseUrl !== form.savedBaseUrl) {
      update.baseUrl = form.baseUrl;
      changed = true;
    }
    if (form.model !== form.savedModel) {
      update.model = form.model;
      changed = true;
    }
    if (form.enabled !== form.savedEnabled) {
      update.enabled = form.enabled;
      changed = true;
    }
    if (form.key.length > 0) {
      update.apiKey = form.key;
      changed = true;
    } else if (form.keyCleared) {
      update.apiKey = '';
      changed = true;
    }

    return changed ? update : null;
  }

  private toAiForm(section: AiProviderSection): AiProviderForm {
    return {
      enabled: section.enabled,
      baseUrl: section.baseUrl,
      model: section.model,
      // Always empty: the API never returns the key, so there is nothing to seed.
      key: '',
      keyCleared: false,
      hasKey: section.hasKey,
      keyFromServerEnv: section.keyFromServerEnv,
      savedBaseUrl: section.baseUrl,
      savedModel: section.model,
      savedEnabled: section.enabled,
    };
  }

  private aiFormFor(kind: AiProviderKind): AiProviderForm {
    return kind === 'llm' ? this.aiLlm() : this.aiStt();
  }

  private patchAiForm(kind: AiProviderKind, patch: Partial<AiProviderForm>): void {
    const target = kind === 'llm' ? this.aiLlm : this.aiStt;
    target.update((form) => ({ ...form, ...patch }));
  }

  private setAiModels(kind: AiProviderKind, models: string[]): void {
    const target = kind === 'llm' ? this.aiLlmModels : this.aiSttModels;
    target.set(models);
  }

  private setAiStatus(kind: AiProviderKind, status: AiProviderStatus | null): void {
    const target = kind === 'llm' ? this.aiLlmStatus : this.aiSttStatus;
    target.set(status);
  }

  /** The most useful message from an HttpErrorResponse, or a plain fallback. */
  private errorMessage(error: unknown): string {
    const body = (error as { error?: unknown } | null)?.error;
    if (body && typeof body === 'object') {
      const message = (body as { error?: unknown }).error;
      if (typeof message === 'string' && message) return message;
    }
    const message = (error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) return message;
    return 'Unknown error';
  }

  /**
   * Copies the catalog address. The clipboard API is only available in a
   * secure context (https, or localhost), so a failure is reported rather than
   * swallowed — the address on screen stays selectable as the fallback.
   */
  copyCatalogUrl(): void {
    const url = this.opds()?.catalogUrl;
    if (!url || !navigator.clipboard) {
      this.toast.error('Copying is not available here — select the address and copy it.');
      return;
    }

    navigator.clipboard.writeText(url).then(
      () => {
        this.copied.set(true);
        this.toast.success('Catalog address copied.');
        if (this.copiedTimeout !== null) clearTimeout(this.copiedTimeout);
        this.copiedTimeout = setTimeout(() => {
          this.copied.set(false);
          this.copiedTimeout = null;
        }, COPIED_FEEDBACK_MS);
      },
      () => {
        this.toast.error('Could not copy automatically — select the address and copy it.');
      },
    );
  }

  loadData(): void {
    this.backupService.getStatus().subscribe({
      next: (s) => this.status.set(s),
      error: () => this.toast.error('Failed to load backup status.'),
    });

    this.backupService.getSettings().subscribe({
      next: (s) => this.settings.set(s),
      error: () => {},
    });

    this.loadHistory();
  }

  loadHistory(): void {
    this.backupService.getHistory().subscribe({
      next: (h) => this.history.set(h),
      error: () => {},
    });
  }

  toggleEnabled(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.backupService.updateSettings({ isEnabled: checked }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.refreshStatus();
      },
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  toggleBookFiles(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.backupService.updateSettings({ includeBookFiles: checked }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.refreshStatus();
      },
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  changeInterval(event: Event): void {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.backupService.updateSettings({ intervalHours: value }).subscribe({
      next: (s) => this.settings.set(s),
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  changeMaxBackups(event: Event): void {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.backupService.updateSettings({ maxBackups: value }).subscribe({
      next: (s) => this.settings.set(s),
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  triggerBackup(): void {
    this.backingUp.set(true);
    this.startProgressPolling();
    this.backupService.triggerBackup().subscribe({
      next: (result) => {
        this.backingUp.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        if (result.status === 'Completed') {
          this.toast.success(`Backup created successfully (${this.formatSize(result.sizeBytes)}).`);
        } else {
          this.toast.error('Backup failed. Check the logs for details.');
        }
        this.loadData();
      },
      error: () => {
        this.backingUp.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        this.toast.error('Backup failed. Check the logs for details.');
      },
    });
  }

  downloadBackup(id: string): void {
    window.open(this.backupService.getDownloadUrl(id), '_blank');
  }

  scanForBackups(): void {
    this.importing.set(true);
    this.backupService.importExisting().subscribe({
      next: (imported) => {
        this.importing.set(false);
        if (imported.length > 0) {
          this.toast.success(`Found ${imported.length} backup(s) on disk.`);
        } else {
          this.toast.info('No new backups found on disk.');
        }
        this.loadHistory();
      },
      error: () => {
        this.importing.set(false);
        this.toast.error('Failed to scan for backups.');
      },
    });
  }

  restoreBackup(id: string): void {
    this.pendingRestore.set(id);
  }

  cancelRestore(): void {
    if (this.restoring()) return;
    this.pendingRestore.set(null);
  }

  confirmRestore(): void {
    const id = this.pendingRestore();
    if (!id || this.restoring()) return;
    this.pendingRestore.set(null);

    this.restoring.set(true);
    this.startProgressPolling();
    this.backupService.restore(id).subscribe({
      next: (result) => {
        this.restoring.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        if (result.success) {
          this.toast.success(result.message);
        } else {
          this.toast.error(result.message);
        }
        this.loadHistory();
      },
      error: () => {
        this.restoring.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        this.toast.error('Restore failed. Check the logs for details.');
      },
    });
  }

  deleteBackup(id: string): void {
    this.pendingBackupDelete.set(id);
  }

  cancelBackupDelete(): void {
    this.pendingBackupDelete.set(null);
  }

  confirmBackupDelete(): void {
    const id = this.pendingBackupDelete();
    if (!id) return;
    this.pendingBackupDelete.set(null);

    this.backupService.deleteBackup(id).subscribe({
      next: () => {
        this.toast.success('Backup deleted.');
        this.loadHistory();
      },
      error: () => this.toast.error('Failed to delete backup.'),
    });
  }

  private startProgressPolling(): void {
    this.stopProgressPolling();
    this.stepChangedAt = Date.now();
    this.slowNoticeInterval = setInterval(() => {
      this.showSlowNotice.set(Date.now() - this.stepChangedAt > SLOW_STEP_THRESHOLD_MS);
    }, 1000);
    this.progressInterval = setInterval(() => {
      this.backupService.getProgress().subscribe({
        next: (p) => {
          const prev = this.progress();
          if (p.currentStep !== prev.currentStep) {
            this.stepChangedAt = Date.now();
            this.showSlowNotice.set(false);
          }
          this.progress.set(p);
        },
        error: () => {},
      });
    }, 1000);
  }

  private stopProgressPolling(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    if (this.slowNoticeInterval) {
      clearInterval(this.slowNoticeInterval);
      this.slowNoticeInterval = null;
    }
  }

  private refreshStatus(): void {
    this.backupService.getStatus().subscribe({
      next: (s) => this.status.set(s),
      error: () => {},
    });
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  formatInterval(hours: number): string {
    if (hours < 24) return `${hours} hours`;
    if (hours === 24) return 'day';
    if (hours === 168) return 'week';
    return `${hours} hours`;
  }
}