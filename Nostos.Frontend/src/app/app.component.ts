import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainerComponent } from './ui/toast-container/toast-container.component';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  /**
   * Boot hydration: constructing the root ThemeService here guarantees a
   * stored global theme ('nostos.theme') is applied to documentElement on
   * EVERY app boot, on every route — not only when a reader happens to
   * construct the service.
   */
  private themeService = inject(ThemeService);
}
