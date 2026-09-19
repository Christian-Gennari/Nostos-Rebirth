import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';
import { NostosIconComponent } from '../icon/nostos-icon.component';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [NostosIconComponent],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast-' + toast.type" role="alert">
          <nostos-icon
            [name]="
              toast.type === 'success' ? 'check-circle' : toast.type === 'error' ? 'warning' : 'info'
            "
            [size]="16"></nostos-icon>
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-dismiss" (click)="toastService.dismiss(toast.id)">
            <nostos-icon name="x" [size]="14"></nostos-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-container {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 380px;
        pointer-events: none;
      }

      .toast {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.75rem 1rem;
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        color: var(--color-text-main);
        /* Was 0.875rem — a size used exactly ONCE in the codebase against twelve
           uses of 0.88rem. The two differ by 0.08px, which is not a distinction
           anyone can perceive; keeping both meant two rungs of a type scale that
           stood for one measured size. */
        font-size: 0.88rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        pointer-events: auto;
        animation: toast-slide-in 0.25s ease-out;
      }

      /* Tokens, not literals. These were the last theme-blind colours in the app:
         #4ade80 / #f87171 are a light-mode-tailwind green/red that sat on a dark
         surface at the wrong value, and NOTHING else in the codebase hardcodes
         these — every other surface (book-detail, settings, library, note-card,
         flat-tree, second-brain, add-book-modal) reads --color-success /
         --color-danger, which are theme-aware (#22c55e -> #8FC7A8 and
         #ba1a1a -> #ffb4ab). The "info" variant below already used
         --color-primary, so the component was internally inconsistent as well.
         The brand manifesto calls for "very restrained" accents and explicitly
         avoids "neon gradients & colorful AI aesthetics"; a saturated mint on a
         near-black surface was the one place that leaked through. */
      .toast-success {
        border-left: 3px solid var(--color-success);
      }
      .toast-success nostos-icon {
        color: var(--color-success);
      }

      .toast-error {
        border-left: 3px solid var(--color-danger);
      }
      .toast-error nostos-icon {
        color: var(--color-danger);
      }

      .toast-info {
        border-left: 3px solid var(--color-primary);
      }
      .toast-info nostos-icon {
        color: var(--color-primary);
      }

      .toast-message {
        flex: 1;
        line-height: 1.4;
      }

      .toast-dismiss {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
        border-radius: 4px;
        transition: color 0.15s;
      }
      .toast-dismiss:hover {
        color: var(--color-text-main);
      }

      @keyframes toast-slide-in {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `,
  ],
})
export class ToastContainerComponent {
  toastService = inject(ToastService);
}
