import { Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, CalendarDays, CheckCircle2 } from 'lucide-angular';

import { ReadingProgramme, ReadingWeekSummary } from '../../../core/dtos/reading-training.dtos';

/**
 * Compact current-week strip. Pure presentation of the server's weekly
 * summary and programme targets: figures are shown without success/failure
 * judgement, constrained/recovery volume is explained neutrally, and the
 * review action is emitted for the page to orchestrate (preview then commit).
 */
@Component({
  standalone: true,
  selector: 'app-week-strip',
  imports: [LucideAngularModule],
  templateUrl: './week-strip.component.html',
  styleUrl: './week-strip.component.css',
})
export class WeekStripComponent {
  readonly week = input<ReadingWeekSummary | null>(null);
  readonly programme = input<ReadingProgramme | null>(null);

  /** Emits the week summary so the page can preview/commit that exact week. */
  readonly reviewRequested = output<ReadingWeekSummary>();

  readonly CalendarIcon = CalendarDays;
  readonly ReviewIcon = CheckCircle2;

  /** "2026-W33" -> "Week 33"; falls back to the raw key when unparseable. */
  readonly weekLabel = computed(() => {
    const key = this.week()?.weekKey ?? '';
    const match = /^(\d{4})-W(\d{1,2})$/i.exec(key);
    return match ? `Week ${Number(match[2])}` : key;
  });

  /** Sum of the three mode targets, or null when no programme is known. */
  readonly totalTargetMinutes = computed<number | null>(() => {
    const targets = this.programme()?.targets;
    if (!targets) return null;
    return targets.enduranceTargetMinutes + targets.deepTargetMinutes + targets.recoveryTargetMinutes;
  });
}
