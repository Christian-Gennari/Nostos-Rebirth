import { TestBed } from '@angular/core/testing';

import { TinyMceLoader } from './tinymce-loader.service';

describe('TinyMceLoader', () => {
  let loader: TinyMceLoader;

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)['tinymce'];
    document.querySelectorAll('script[data-nostos-tinymce="true"]').forEach((node) => node.remove());

    TestBed.configureTestingModule({});
    loader = TestBed.inject(TinyMceLoader);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['tinymce'];
    document.querySelectorAll('script[data-nostos-tinymce="true"]').forEach((node) => node.remove());
  });

  it('uses an already loaded TinyMCE global without adding a script', async () => {
    const api = { init: () => undefined, remove: () => undefined };
    (globalThis as Record<string, unknown>)['tinymce'] = api;

    await expect(loader.load()).resolves.toBe(api);
    expect(document.querySelector('script[data-nostos-tinymce="true"]')).toBeNull();
  });

  it('loads the packaged TinyMCE script only once for concurrent callers', async () => {
    const first = loader.load();
    const second = loader.load();

    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[data-nostos-tinymce="true"]',
    );
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe('/tinymce/tinymce.min.js');

    const api = { init: () => undefined, remove: () => undefined };
    (globalThis as Record<string, unknown>)['tinymce'] = api;
    scripts[0].dispatchEvent(new Event('load'));

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it('removes a failed script so a later load can retry cleanly', async () => {
    const failed = loader.load();
    const firstScript = document.querySelector<HTMLScriptElement>(
      'script[data-nostos-tinymce="true"]',
    )!;
    firstScript.dispatchEvent(new Event('error'));

    await expect(failed).rejects.toThrow('Failed to load TinyMCE.');
    expect(firstScript.isConnected).toBe(false);

    const retry = loader.load();
    const secondScript = document.querySelector<HTMLScriptElement>(
      'script[data-nostos-tinymce="true"]',
    )!;
    expect(secondScript).not.toBe(firstScript);

    const api = { init: () => undefined, remove: () => undefined };
    (globalThis as Record<string, unknown>)['tinymce'] = api;
    secondScript.dispatchEvent(new Event('load'));

    await expect(retry).resolves.toBe(api);
  });
});
