import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { App } from './app.component';
import { AssistantStatusService } from './ui/assistant/assistant-status.service';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        // The root shell asks the server whether the assistant is available;
        // this spec is about the shell, not that request.
        {
          provide: AssistantStatusService,
          useValue: { available: signal(true), ensureLoaded: () => {}, refresh: () => {} },
        },
        // The shell keeps the service worker's manifest fresh; there is no
        // worker under test, so the update API only needs to exist.
        {
          provide: SwUpdate,
          useValue: { isEnabled: false, checkForUpdate: () => Promise.resolve(false) },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the app shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
    expect(compiled.querySelector('app-toast-container')).not.toBeNull();
  });
});
