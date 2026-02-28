import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';
import { LucideAngularModule, X, CheckCircle, AlertTriangle, Info } from 'lucide-angular';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast-' + toast.type" role="alert">
          <lucide-icon
            [img]="
              toast.type === 'success' ? CheckIcon : toast.type === 'error' ? AlertIcon : InfoIcon
            "
            [size]="16"
          ></lucide-icon>
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-dismiss" (click)="toastService.dismiss(toast.id)">
            <lucide-icon [img]="CloseIcon" [size]="14"></lucide-icon>
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
        border-radius: var(--radius-md, 8px);
        background: var(--bg-surface, #1e1e2e);
        border: 1px solid var(--border-color, #333);
        color: var(--color-text, #e0e0e0);
        font-size: 0.875rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: auto;
        animation: toast-slide-in 0.25s ease-out;
      }

      .toast-success {
        border-left: 3px solid #4ade80;
      }
      .toast-success lucide-icon {
        color: #4ade80;
      }

      .toast-error {
        border-left: 3px solid #f87171;
      }
      .toast-error lucide-icon {
        color: #f87171;
      }

      .toast-info {
        border-left: 3px solid var(--color-primary, #818cf8);
      }
      .toast-info lucide-icon {
        color: var(--color-primary, #818cf8);
      }

      .toast-message {
        flex: 1;
        line-height: 1.4;
      }

      .toast-dismiss {
        background: none;
        border: none;
        color: var(--color-text-muted, #888);
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
        border-radius: 4px;
        transition: color 0.15s;
      }
      .toast-dismiss:hover {
        color: var(--color-text, #e0e0e0);
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

  CheckIcon = CheckCircle;
  AlertIcon = AlertTriangle;
  InfoIcon = Info;
  CloseIcon = X;
}
