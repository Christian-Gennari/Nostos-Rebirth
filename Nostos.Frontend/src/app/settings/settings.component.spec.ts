import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';

import { SettingsComponent } from './settings.component';
import { BackupService } from '../core/services/backup.service';
import { OpdsService } from '../core/services/opds.service';
import { ToastService } from '../core/services/toast.service';
import { OpdsInfo } from '../core/dtos/opds.dtos';
import {
  LIBRARY_PREFERENCES_STORAGE_KEY,
  LibraryPreferencesService,
} from '../core/services/library-preferences.service';
import { AssistantStatusService } from '../ui/assistant/assistant-status.service';
import { AiProviderService } from '../core/services/ai-provider.service';
import {
  AiProviderModelsRequest,
  AiProviderModelsResponse,
  AiProviderSettings,
  AiProviderTestRequest,
  AiProviderTestResult,
  AiProviderUpdate,
} from '../core/dtos/ai-provider.dtos';

const toastMock = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

/** A reachable catalog address, as the server reports it behind its proxy. */
const remoteInfo: OpdsInfo = {
  enabled: true,
  catalogUrl: 'https://omenhub.example.ts.net:5215/opds/',
  urlSource: 'request',
  localOnly: false,
};

const opdsServiceMock = {
  getInfo: vi.fn(() => of(remoteInfo)),
};

/**
 * Effective AI provider settings. The LLM's key is stored server-side; the
 * voice key comes from the server environment. Both password fields must still
 * render empty — the API never returns a key.
 */
const aiProviderSettings: AiProviderSettings = {
  llm: {
    enabled: true,
    baseUrl: 'http://omenhub:20128/v1',
    model: 'qwen3-32b',
    hasKey: true,
    keyFromServerEnv: false,
  },
  stt: {
    enabled: false,
    baseUrl: 'http://omenhub:20128',
    model: 'groq/whisper-large-v3-turbo',
    hasKey: true,
    keyFromServerEnv: true,
  },
};

const aiProviderServiceMock = {
  get: vi.fn((): Observable<AiProviderSettings> => of(aiProviderSettings)),
  update: vi.fn(
    (_update: AiProviderUpdate): Observable<AiProviderSettings> => of(aiProviderSettings),
  ),
  loadModels: vi.fn(
    (_request: AiProviderModelsRequest): Observable<AiProviderModelsResponse> =>
      of({ models: ['qwen3-32b', 'gpt-4o'] }),
  ),
  test: vi.fn(
    (_request: AiProviderTestRequest): Observable<AiProviderTestResult> =>
      of({ ok: true, detail: 'Reached the endpoint.' }),
  ),
};

const backupServiceMock = {
  getStatus: vi.fn(() =>
    of({
      isEnabled: false,
      provider: 'Local',
      lastBackupAt: null,
      lastBackupStatus: null,
      includeBookFiles: true,
      intervalHours: 168,
      maxBackups: 3,
    }),
  ),
  getSettings: vi.fn(() =>
    of({
      isEnabled: false,
      provider: 'Local',
      includeBookFiles: true,
      intervalHours: 168,
      maxBackups: 3,
    }),
  ),
  getHistory: vi.fn(() => of([])),
  updateSettings: vi.fn(() => of({})),
  triggerBackup: vi.fn(() => of({ status: 'Completed', sizeBytes: 0 })),
  getDownloadUrl: vi.fn(() => ''),
  importExisting: vi.fn(() => of([])),
  restore: vi.fn(() => of({ success: true, message: 'Restored.' })),
  deleteBackup: vi.fn(() => of(null)),
  getProgress: vi.fn(() => of({})),
};

/**
 * The assistant's server availability, driven by the test. Real requests are
 * covered by `AssistantStatusService`'s own spec; here the card only needs the
 * answer to change.
 */
const assistantStatusMock = {
  available: signal(true),
  ensureLoaded: vi.fn(),
  refresh: vi.fn(),
};

describe('SettingsComponent backup-only surface', () => {
  let fixture: ComponentFixture<SettingsComponent>;

  async function configure(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: BackupService, useValue: backupServiceMock },
        { provide: OpdsService, useValue: opdsServiceMock },
        { provide: ToastService, useValue: toastMock },
        { provide: AssistantStatusService, useValue: assistantStatusMock },
        { provide: AiProviderService, useValue: aiProviderServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    opdsServiceMock.getInfo.mockClear();
    opdsServiceMock.getInfo.mockReturnValue(of(remoteInfo));
    toastMock.error.mockClear();
    toastMock.success.mockClear();
    assistantStatusMock.available.set(true);
    assistantStatusMock.refresh.mockClear();
    aiProviderServiceMock.get.mockClear();
    aiProviderServiceMock.get.mockReturnValue(of(aiProviderSettings));
    aiProviderServiceMock.update.mockClear();
    aiProviderServiceMock.update.mockReturnValue(of(aiProviderSettings));
    aiProviderServiceMock.loadModels.mockClear();
    aiProviderServiceMock.loadModels.mockReturnValue(
      of<AiProviderModelsResponse>({ models: ['qwen3-32b', 'gpt-4o'] }),
    );
    aiProviderServiceMock.test.mockClear();
    aiProviderServiceMock.test.mockReturnValue(
      of<AiProviderTestResult>({ ok: true, detail: 'Reached the endpoint.' }),
    );

    await configure();
  });

  afterEach(() => {
    localStorage.clear();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  /**
   * Was `renders no Appearance card and no theme controls` — an assertion from
   * the theme-system removal. Dark mode is back as a deliberate feature, so the
   * contract is inverted rather than dropped: the card must exist, and the
   * control must offer both themes.
   */
  it('renders the Appearance card with a working Light/Dark choice', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
    expect(headers).toContain('Appearance');

    const options = fixture.debugElement.queryAll(By.css('.theme-opt'));
    expect(options.map((o) => o.nativeElement.textContent.trim())).toEqual(['Light', 'Dark']);

    // Defaults to light in a test environment (no stored choice, and
    // matchMedia reports no dark preference).
    expect(options[0].nativeElement.classList.contains('is-active')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    options[1].nativeElement.click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('nostos.theme')).toBe('dark');
  });

  it('reverts to light and clears the attribute when Light is chosen', () => {
    fixture.componentInstance.setTheme('dark');
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    fixture.componentInstance.setTheme('light');
    fixture.detectChanges();
    // Removing the attribute (not setting 'light') keeps `:root` the single
    // owner of the light values.
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('nostos.theme')).toBe('light');
  });

  it('renders the Backup and Backup History cards', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
    expect(headers).toContain('Backup');
    expect(headers).toContain('Backup History');
    // No empty section/divider where Appearance was: the first card is Backup.
    expect(headers[0]).toBe('Backup');
  });

  it('exposes the automatic-backup toggle and manual backup action', () => {
    const toggles = fixture.debugElement.queryAll(By.css('input[type="checkbox"]'));
    // Automatic Backup + Include Book Files + the Reading assistant toggle (W1)
    // + the AI provider card's voice transcription toggle.
    expect(toggles.length).toBe(4);
    const buttons = fixture.debugElement
      .queryAll(By.css('button'))
      .map((b) => b.nativeElement.textContent.trim());
    expect(buttons).toContain('Back up now');
    expect(buttons).toContain('Scan for Backups');
  });

  it('asks through ConfirmModal before restoring (no direct restore)', () => {
    const component = fixture.componentInstance;
    backupServiceMock.restore.mockClear();

    component.restoreBackup('b1');
    expect(component.pendingRestore()).toBe('b1');
    expect(backupServiceMock.restore).not.toHaveBeenCalled();

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeTruthy();

    component.confirmRestore();
    expect(backupServiceMock.restore).toHaveBeenCalledWith('b1');
    expect(component.pendingRestore()).toBeNull();
  });

  it('cancelling restore performs nothing', () => {
    const component = fixture.componentInstance;
    backupServiceMock.restore.mockClear();

    component.restoreBackup('b1');
    component.cancelRestore();
    expect(component.pendingRestore()).toBeNull();
    expect(backupServiceMock.restore).not.toHaveBeenCalled();
  });

  it('asks through ConfirmModal before deleting a backup', () => {
    const component = fixture.componentInstance;
    backupServiceMock.deleteBackup.mockClear();

    component.deleteBackup('b9');
    expect(component.pendingBackupDelete()).toBe('b9');
    expect(backupServiceMock.deleteBackup).not.toHaveBeenCalled();

    component.confirmBackupDelete();
    expect(backupServiceMock.deleteBackup).toHaveBeenCalledWith('b9');
    expect(component.pendingBackupDelete()).toBeNull();
  });

  // ------------------------------------------------------------------
  // E-reader access (issue #187)
  // ------------------------------------------------------------------

  it('renders the E-reader access card with the catalog address and one copy action', () => {
    const headers = cardHeaders();
    expect(headers).toContain('E-reader access');
    // Grouped with the library data, above Appearance.
    expect(headers.indexOf('E-reader access')).toBeLessThan(headers.indexOf('Appearance'));

    expect(catalogUrlText()).toBe(remoteInfo.catalogUrl);

    const copy = copyButton();
    expect(copy).toBeTruthy();
    expect(copy!.textContent).toContain('Copy URL');
  });

  it('leads with plain language and keeps OPDS as the secondary protocol name', () => {
    const heading = cardHeading('E-reader access');
    expect(heading).toContain('E-reader access');
    expect(heading).not.toMatch(/OPDS/u);

    const text = cardBodyText();
    expect(text).toContain('e-reader');
    expect(text).toMatch(/OPDS catalog/u);
  });

  it('copies the address in one action and confirms it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    installClipboard(writeText);

    copyButton()!.click();
    await flush();

    expect(writeText).toHaveBeenCalledWith(remoteInfo.catalogUrl);
    expect(fixture.componentInstance.copied()).toBe(true);
    fixture.detectChanges();
    expect(copyButton()!.textContent).toContain('Copied');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('reports a refused clipboard instead of silently doing nothing', async () => {
    installClipboard(vi.fn(() => Promise.reject(new Error('denied'))));

    copyButton()!.click();
    await flush();

    expect(fixture.componentInstance.copied()).toBe(false);
    expect(toastMock.error).toHaveBeenCalled();
    // The address stays on screen, selectable, as the manual fallback.
    expect(catalogUrlText()).toBe(remoteInfo.catalogUrl);
  });

  it('warns when the address is only reachable from this computer', () => {
    renderWith({
      enabled: true,
      catalogUrl: 'http://localhost:5214/opds/',
      urlSource: 'request',
      localOnly: true,
    });

    const warning = fixture.nativeElement.querySelector('.catalog-note--warning');
    expect(warning).toBeTruthy();
    expect((warning as HTMLElement).textContent).toContain('only works on this computer');

    // Still shown — a reader running on this machine can use it — but never
    // without that warning.
    expect(catalogUrlText()).toContain('localhost');
    expect(fixture.nativeElement.querySelectorAll('.catalog-note--warning').length).toBe(1);
  });

  it('offers no connection address when the server has e-reader access turned off', () => {
    renderWith({ enabled: false, catalogUrl: null, urlSource: 'request', localOnly: false });

    expect(fixture.nativeElement.querySelector('.catalog-url')).toBeNull();
    expect(copyButton()).toBeNull();
    expect(cardBodyText()).toContain('turned off');
  });

  it('says the setting could not be read rather than presenting a guess', () => {
    opdsServiceMock.getInfo.mockReturnValue(throwError(() => new Error('offline')));
    render();

    expect(cardBodyText()).toContain('Could not read this setting');
    expect(fixture.nativeElement.querySelector('.catalog-url')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Reading assistant (W1)
  // ------------------------------------------------------------------

  it('renders the Reading assistant card with the available copy and an on toggle', () => {
    expect(cardHeaders()).toContain('Reading assistant');

    const card = assistantCard();
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(
      'Show the dock capsule for capturing thoughts while reading.',
    );

    const toggle = assistantToggle();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-disabled')).toBeNull();
    expect(toggle.checked).toBe(true);
  });

  it('records the assistant choice through the existing preferences service', () => {
    const preferences = TestBed.inject(LibraryPreferencesService);
    expect(preferences.assistantEnabled()).toBe(true);

    assistantToggle().checked = false;
    assistantToggle().dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(preferences.assistantEnabled()).toBe(false);
  });

  it('persists the assistant toggle across a reload', async () => {
    assistantToggle().checked = false;
    assistantToggle().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_STORAGE_KEY)!).assistantEnabled).toBe(
      false,
    );

    // A reload is a fresh injector reading the same localStorage.
    TestBed.resetTestingModule();
    await configure();

    expect(TestBed.inject(LibraryPreferencesService).assistantEnabled()).toBe(false);
    expect(assistantToggle().checked).toBe(false);
  });

  it('defaults the assistant toggle on for preferences stored before it existed', async () => {
    localStorage.setItem(
      LIBRARY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        viewMode: 'list',
        sort: 'lastread',
        pageSize: 50,
        sidebarExpanded: false,
        groupByWork: false,
      }),
    );

    TestBed.resetTestingModule();
    await configure();

    const preferences = TestBed.inject(LibraryPreferencesService);
    expect(preferences.assistantEnabled()).toBe(true);
    // The older choices survive: the missing field is not corruption.
    expect(preferences.viewMode()).toBe('list');
    expect(preferences.pageSize()).toBe(50);
    expect(assistantToggle().checked).toBe(true);
  });

  it('renders the toggle off and non-interactive when the server is unavailable', () => {
    assistantStatusMock.available.set(false);
    render();

    // The card stays visible; the supporting sentence is substituted in place.
    const card = assistantCard();
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(
      'Set up an AI provider in Settings to enable this.',
    );
    expect(card!.textContent).not.toContain('Show the dock capsule');

    const toggle = assistantToggle();
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.checked).toBe(false);
    // Muted, never an alarm: the existing toggle itself is dimmed and inert.
    expect(toggle.closest('.toggle')!.classList.contains('toggle--disabled')).toBe(true);
  });

  it('never records a preference while the assistant is unavailable', () => {
    assistantStatusMock.available.set(false);
    render();

    const preferences = TestBed.inject(LibraryPreferencesService);
    preferences.setAssistantEnabled(false);

    // The guard is belt-and-braces behind the disabled control.
    fixture.componentInstance.setAssistantEnabled({
      target: { checked: true },
    } as unknown as Event);

    expect(preferences.assistantEnabled()).toBe(false);
  });

  // ------------------------------------------------------------------
  // AI provider
  // ------------------------------------------------------------------

  it('renders the AI provider card with the effective values and both keys empty', () => {
    const card = aiCard();
    expect(card).not.toBeNull();

    expect(inputValue('#ai-llm-base-url')).toBe(aiProviderSettings.llm.baseUrl);
    expect(inputValue('#ai-llm-model')).toBe(aiProviderSettings.llm.model);
    expect(inputValue('#ai-stt-base-url')).toBe(aiProviderSettings.stt.baseUrl);
    expect(inputValue('#ai-stt-model')).toBe(aiProviderSettings.stt.model);

    // The API never returns a key, so neither password field may carry one.
    expect(inputValue('#ai-llm-api-key')).toBe('');
    expect(inputValue('#ai-stt-api-key')).toBe('');
    expect(input('#ai-llm-api-key').type).toBe('password');
    expect(input('#ai-stt-api-key').type).toBe('password');
  });

  it('says a key is configured, and where it comes from, without rendering it', () => {
    const llm = cardSection('ai-provider-llm');
    expect(llm.textContent).toContain('Configured');
    expect(llm.textContent).not.toContain('server environment variable');
    expect(buttonByText('ai-provider-llm', 'Clear')).toBeTruthy();

    const stt = cardSection('ai-provider-stt');
    expect(stt.textContent).toContain('using the server environment variable');
    expect(buttonByText('ai-provider-stt', 'Clear')).toBeTruthy();
  });

  it('renders the reviewed intro and field helpers on both sections', () => {
    const card = aiCard()!;
    expect(card.textContent).toContain(
      'Notes and voice recordings are sent directly to the OpenAI-compatible endpoints configured below.',
    );
    expect(card.textContent).toContain('Base URL, including /v1.');
    expect(card.textContent).toContain('Exact model name expected by the endpoint.');
    expect(card.textContent).toContain('Stored on your server. Never returned to the browser.');
    expect(card.textContent).toContain('Send voice recordings to the transcription endpoint.');
    expect(card.textContent).toContain('Enable voice transcription');
  });

  it('offers the reviewed placeholders, and calls out an already-configured key', () => {
    expect(input('#ai-llm-base-url').placeholder).toBe('https://api.openai.com/v1');
    expect(input('#ai-stt-base-url').placeholder).toBe('https://api.openai.com/v1');
    expect(input('#ai-llm-model').placeholder).toBe('e.g. gpt-4o-mini');
    expect(input('#ai-stt-model').placeholder).toBe('e.g. whisper-1');
    // Both sections have a key already (one stored, one from the environment).
    expect(input('#ai-llm-api-key').placeholder).toBe('Configured on server (leave blank to keep)');
    expect(input('#ai-stt-api-key').placeholder).toBe('Configured on server (leave blank to keep)');
  });

  it('offers the unauthenticated key placeholder when no key is configured', () => {
    aiProviderServiceMock.get.mockReturnValueOnce(
      of<AiProviderSettings>({
        llm: { enabled: false, baseUrl: '', model: '', hasKey: false, keyFromServerEnv: false },
        stt: { enabled: false, baseUrl: '', model: '', hasKey: false, keyFromServerEnv: false },
      }),
    );
    render();

    expect(input('#ai-llm-api-key').placeholder).toBe('Leave empty if unauthenticated');
    expect(input('#ai-stt-api-key').placeholder).toBe('Leave empty if unauthenticated');
  });

  it('omits apiKey when the key was never touched', () => {
    setInputValue('#ai-llm-model', 'gpt-4o');
    clickSave();

    expect(aiProviderServiceMock.update).toHaveBeenCalledTimes(1);
    const body = aiProviderServiceMock.update.mock.calls[0][0];
    expect(body.llm).toEqual({ model: 'gpt-4o' });
    expect(body.stt).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body.llm, 'apiKey')).toBe(false);
    expect(saveStatusText()).toBe('Saved.');
  });

  it('sends apiKey: "" only after Clear, and says what will be used instead', () => {
    clickButton('ai-provider-llm', 'Clear');
    expect(llmStatusText()).toBe('Key removed. Falling back to environment variable if present.');

    clickSave();
    expect(aiProviderServiceMock.update.mock.calls[0][0].llm).toEqual({ apiKey: '' });
    expect(saveStatusText()).toBe('Saved.');
  });

  it('sends a typed key, then never leaves it in the DOM after the save', () => {
    setInputValue('#ai-llm-api-key', 'sk-typed');
    clickSave();

    expect(aiProviderServiceMock.update.mock.calls[0][0].llm).toEqual({ apiKey: 'sk-typed' });
    // The typed value is spent: a successful save re-seeds from the response,
    // which never carries a key.
    expect(inputValue('#ai-llm-api-key')).toBe('');
  });

  it('loads models into the datalist while keeping the field free-text', () => {
    aiProviderServiceMock.loadModels.mockReturnValueOnce(
      of<AiProviderModelsResponse>({ models: ['alpha', 'beta', 'gamma'] }),
    );

    clickButton('ai-provider-llm', 'Load models');

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#ai-llm-model-options option'),
    ).map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['alpha', 'beta', 'gamma']);
    expect(llmStatusText()).toBe('Loaded 3 models.');

    const model = input('#ai-llm-model');
    expect(model.getAttribute('list')).toBe('ai-llm-model-options');
    expect(model.readOnly).toBe(false);
    expect(model.disabled).toBe(false);
  });

  it('says so when the endpoint returns no models', () => {
    aiProviderServiceMock.loadModels.mockReturnValueOnce(
      of<AiProviderModelsResponse>({ models: [] }),
    );
    clickButton('ai-provider-llm', 'Load models');
    expect(llmStatusText()).toBe('No models returned by endpoint.');
  });

  it('renders the success detail inline after Test connection', () => {
    aiProviderServiceMock.test.mockReturnValueOnce(
      of<AiProviderTestResult>({ ok: true, detail: 'Connected. 42 models.' }),
    );
    clickButton('ai-provider-llm', 'Test connection');

    expect(aiProviderServiceMock.test.mock.calls[0][0]).toEqual({
      kind: 'llm',
      baseUrl: aiProviderSettings.llm.baseUrl,
      model: aiProviderSettings.llm.model,
      apiKey: undefined,
    });
    expect(llmStatusText()).toBe('Connected. 42 models.');
    expect(statusElement('ai-provider-llm').classList.contains('is-ok')).toBe(true);
  });

  it('renders the error inline when the test reports failure', () => {
    aiProviderServiceMock.test.mockReturnValueOnce(
      of<AiProviderTestResult>({ ok: false, error: '401 Unauthorized' }),
    );
    clickButton('ai-provider-llm', 'Test connection');

    expect(llmStatusText()).toBe('401 Unauthorized');
    expect(statusElement('ai-provider-llm').classList.contains('is-error')).toBe(true);
  });

  it('wraps a transport failure rather than showing a bare HTTP message', () => {
    aiProviderServiceMock.test.mockReturnValueOnce(
      throwError(() => ({ error: { error: 'Connection refused' } })),
    );
    clickButton('ai-provider-llm', 'Test connection');

    expect(llmStatusText()).toBe('Connection failed: Connection refused');
  });

  it('wraps a failed model lookup with the load-specific message', () => {
    aiProviderServiceMock.loadModels.mockReturnValueOnce(
      throwError(() => ({ error: { error: 'Endpoint rejected the request' } })),
    );
    clickButton('ai-provider-llm', 'Load models');

    expect(llmStatusText()).toBe('Could not load models: Endpoint rejected the request');
    expect(statusElement('ai-provider-llm').classList.contains('is-error')).toBe(true);
  });

  it('uses the reviewed in-flight label while a connection test runs', () => {
    const pending = new Subject<AiProviderTestResult>();
    aiProviderServiceMock.test.mockReturnValueOnce(pending);

    clickButton('ai-provider-llm', 'Test connection');
    expect(buttonByText('ai-provider-llm', 'Testing connection…')!.disabled).toBe(true);

    pending.next({ ok: true, detail: 'Connection verified.' });
    pending.complete();
    fixture.detectChanges();

    expect(llmStatusText()).toBe('Connection verified.');
  });

  it('sends the voice toggle as the stt section', () => {
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="voice-transcription-toggle"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    clickSave();
    expect(aiProviderServiceMock.update.mock.calls[0][0]).toEqual({ stt: { enabled: true } });
  });

  it('disables Save, Load and Test while a request is in flight', () => {
    const pending = new Subject<AiProviderModelsResponse>();
    aiProviderServiceMock.loadModels.mockReturnValueOnce(pending);

    clickButton('ai-provider-llm', 'Load models');

    expect(buttonByText('ai-provider-llm', 'Loading models…')!.disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(buttonByText('ai-provider-stt', 'Test connection')!.disabled).toBe(true);

    pending.next({ models: ['one'] });
    pending.complete();
    fixture.detectChanges();

    expect(saveButton().disabled).toBe(false);
    expect(llmStatusText()).toBe('Loaded 1 models.');
  });

  it('reports an unreadable provider setting in place instead of guessing', () => {
    aiProviderServiceMock.get.mockReturnValueOnce(throwError(() => new Error('offline')));
    render();

    const card = aiCard();
    expect(card!.textContent).toContain('Could not load the AI provider settings.');
    expect(card!.querySelector('#ai-llm-base-url')).toBeNull();
  });

  // ------------------------------------------------------------------

  function aiCard(): HTMLElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="ai-provider-settings-card"]',
    ) as HTMLElement | null;
  }

  function cardSection(testid: string): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
  }

  function input(id: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(id) as HTMLInputElement;
  }

  function inputValue(id: string): string {
    return input(id).value;
  }

  function setInputValue(id: string, value: string): void {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function buttonByText(testid: string, text: string): HTMLButtonElement | null {
    const buttons = Array.from(
      cardSection(testid).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return buttons.find((button) => (button.textContent ?? '').trim().includes(text)) ?? null;
  }

  function clickButton(testid: string, text: string): void {
    const button = buttonByText(testid, text);
    expect(button).not.toBeNull();
    button!.click();
    fixture.detectChanges();
  }

  function saveButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      '[data-testid="ai-provider-save"]',
    ) as HTMLButtonElement;
  }

  function clickSave(): void {
    saveButton().click();
    fixture.detectChanges();
  }

  function statusElement(testid: string): HTMLElement {
    return cardSection(testid).querySelector('.provider-status') as HTMLElement;
  }

  function llmStatusText(): string {
    return (statusElement('ai-provider-llm').textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function saveStatusText(): string {
    const element = fixture.nativeElement.querySelector(
      '.provider-save-status',
    ) as HTMLElement | null;
    return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function cardHeaders(): string[] {
    return fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
  }

  function cardHeading(title: string): string {
    return cardHeaders().find((h) => h === title) ?? '';
  }

  function assistantCard(): HTMLElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="assistant-settings-card"]',
    ) as HTMLElement | null;
  }

  function assistantToggle(): HTMLInputElement {
    return fixture.nativeElement.querySelector(
      '[data-testid="assistant-enabled-toggle"]',
    ) as HTMLInputElement;
  }

  function erCard(): HTMLElement | null {
    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.settings-card'),
    ) as HTMLElement[];
    return (
      cards.find((c) => c.querySelector('h2')?.textContent?.trim() === 'E-reader access') ?? null
    );
  }

  function cardBodyText(): string {
    const card = erCard();
    if (!card) return '';
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelector('h2')?.remove();
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function catalogUrlText(): string {
    return (erCard()?.querySelector('.catalog-url')?.textContent ?? '').trim();
  }

  function copyButton(): HTMLButtonElement | null {
    const buttons = Array.from(erCard()?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    return (
      buttons.find((b) => /Copy URL|Copied/u.test(b.textContent ?? '')) ?? null
    );
  }

  function installClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Re-renders the card with a different server answer. */
  function renderWith(info: OpdsInfo): void {
    opdsServiceMock.getInfo.mockReturnValue(of(info));
    render();
  }

  /** Re-renders with whatever the mock currently answers. */
  function render(): void {
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  }
});
