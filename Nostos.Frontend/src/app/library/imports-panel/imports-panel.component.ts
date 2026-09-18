import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  AlertCircle,
  Book as BookIcon,
  RotateCcw,
  WifiOff,
  X,
} from 'lucide-angular';
import { ImportService } from '../../core/services/import.service';
import { ImportActivity, isImportInFlight, importStageLabel } from '../../core/dtos/import.dtos';

/**
 * "Imports in Progress" — pinned at the top of the library view, above the sort
 * and filter controls.
 *
 * Driven ENTIRELY by ImportService's signals: it is not fed by the library query
 * and it does not read the library's sort, filter, search or pagination. That is
 * the whole point — an import must not disappear because the user filtered to
 * Favourites, searched for something else, or is on page 4 of the results.
 *
 * Why it is not CSS-sticky, having been asked for as "pinned": the library's
 * toolbar is already `position: sticky; top: 0`, and a second sticky element at
 * the same offset either covers it — taking the search box and the sort control
 * away for the length of an import — or needs a JavaScript-measured offset that
 * changes with the number of entries. It is pinned in the sense that matters: a
 * fixed position at the top of the view, outside the results list, and visible
 * whatever those results are.
 */
@Component({
  selector: 'app-imports-panel',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './imports-panel.component.html',
  styleUrl: './imports-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportsPanel {
  private readonly feed = inject(ImportService);

  readonly BookIcon = BookIcon;
  readonly AlertCircleIcon = AlertCircle;
  readonly RotateCcwIcon = RotateCcw;
  readonly XIcon = X;
  readonly WifiOffIcon = WifiOff;

  /** Active imports first, then the failures the user has to act on. */
  readonly entries = computed(() => [
    ...this.feed.activeImports(),
    ...this.feed.failedImports(),
  ]);

  readonly hasEntries = computed(() => this.entries().length > 0);
  readonly reconnecting = computed(() => this.feed.connectionState() === 'reconnecting');

  /** Pluralised once, here, so the heading and the count cannot disagree. */
  readonly heading = computed(() => {
    const count = this.entries().length;
    return count === 1 ? 'Imports in Progress (1)' : `Imports in Progress (${count})`;
  });

  isInFlight(activity: ImportActivity): boolean {
    return isImportInFlight(activity);
  }

  stageLabel(activity: ImportActivity): string {
    return importStageLabel(activity);
  }

  /**
   * The same thumbnail contract the library list and grid use, so an import shows
   * the same art as the row it will become.
   */
  coverUrl(activity: ImportActivity): string | null {
    return activity.coverUrl ? `${activity.coverUrl}/thumbnail?width=320` : null;
  }

  /** Screen-reader text for the bar: "Downloading, 42 percent". */
  progressLabel(activity: ImportActivity): string {
    return `${this.stageLabel(activity)}, ${activity.percent} percent`;
  }

  cancel(activity: ImportActivity): void {
    this.feed.cancel(activity);
  }

  retry(activity: ImportActivity): void {
    this.feed.retry(activity);
  }

  dismiss(activity: ImportActivity): void {
    this.feed.dismiss(activity);
  }
}
