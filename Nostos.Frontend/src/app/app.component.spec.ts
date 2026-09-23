import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { App } from './app.component';
import { AssistantStatusService } from './ui/assistant/assistant-status.service';
import { CloudEntryService } from './core/services/cloud-entry.service';

describe('App', () => {
  const productReady = signal(true);

  beforeEach(async () => {
    localStorage.clear();
    productReady.set(true);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: CloudEntryService,
          useValue: {
            productReady,
            initialize: () => Promise.resolve(),
            view: signal({ kind: 'product' }),
            actionPending: signal(false),
            actionError: signal(null),
          },
        },
        {
          provide: AssistantStatusService,
          useValue: { available: signal(true), ensureLoaded: () => {}, refresh: () => {} },
        },
        {
          provide: SwUpdate,
          useValue: { isEnabled: false, checkForUpdate: () => Promise.resolve(false) },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the normal product shell only after Cloud entry is ready', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
    expect(compiled.querySelector('app-toast-container')).not.toBeNull();

    productReady.set(false);
    fixture.detectChanges();

    expect(compiled.querySelector('router-outlet')).toBeNull();
    expect(compiled.querySelector('app-cloud-entry')).not.toBeNull();
    expect(compiled.querySelector('app-assistant')).toBeNull();
  });
});
