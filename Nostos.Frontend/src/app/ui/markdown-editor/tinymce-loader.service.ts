import { Injectable } from '@angular/core';

export interface TinyMceApi {
  init: (config: Record<string, unknown>) => unknown;
  remove: (editor: unknown) => void;
}

@Injectable({ providedIn: 'root' })
export class TinyMceLoader {
  private loadPromise: Promise<TinyMceApi> | null = null;

  load(): Promise<TinyMceApi> {
    const existing = this.readGlobal();
    if (existing) return Promise.resolve(existing);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<TinyMceApi>((resolve, reject) => {
      const selector = 'script[data-nostos-tinymce="true"]';
      const existingScript = document.querySelector<HTMLScriptElement>(selector);
      const script = existingScript ?? document.createElement('script');

      const finish = () => {
        const api = this.readGlobal();
        if (api) {
          resolve(api);
          return;
        }
        this.loadPromise = null;
        reject(new Error('TinyMCE loaded without exposing the global API.'));
      };

      const fail = () => {
        this.loadPromise = null;
        reject(new Error('Failed to load TinyMCE.'));
      };

      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', fail, { once: true });

      if (!existingScript) {
        script.src = '/tinymce/tinymce.min.js';
        script.async = true;
        script.dataset['nostosTinymce'] = 'true';
        document.head.appendChild(script);
      }
    });

    return this.loadPromise;
  }

  private readGlobal(): TinyMceApi | null {
    const candidate = (globalThis as Record<string, unknown>)['tinymce'];
    if (!candidate || typeof candidate !== 'object') return null;

    const api = candidate as Partial<TinyMceApi>;
    return typeof api.init === 'function' && typeof api.remove === 'function'
      ? (candidate as TinyMceApi)
      : null;
  }
}
