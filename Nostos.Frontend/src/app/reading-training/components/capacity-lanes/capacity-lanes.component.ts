import { Component, InputSignal, input } from '@angular/core';

import { ReadingMode } from '../../../core/dtos/reading-training.dtos';

/**
 * One capacity lane's presentation projection. The page builds these views
 * from the authoritative store snapshot (programme targets + default book);
 * this component never reads domain state itself.
 */
export interface CapacityLaneView {
  mode: ReadingMode;
  title: string;
  /** Current sustainable target in minutes (the programme's adapted target). */
  targetMinutes: number;
  /** Established baseline in minutes, shown when it differs from the target. */
  establishedMinutes: number;
  /** Default active book title for the mode, or null when none is assigned. */
  bookTitle: string | null;
  /**
   * Recovery contributes volume only — it never increases, deloads, or
   * changes any target. Rendered as a visible "volume only" note instead of
   * any progression/failure language.
   */
  volumeOnly: boolean;
  /**
   * Latest committed weekly adaptation reason, when the snapshot carries one.
   * The dashboard snapshot does not yet include committed review decisions,
   * so the page supplies null until the weekly-review slice lands.
   */
  reason: string | null;
}

@Component({
  standalone: true,
  selector: 'app-capacity-lanes',
  templateUrl: './capacity-lanes.component.html',
  styleUrl: './capacity-lanes.component.css',
})
export class CapacityLanesComponent {
  readonly lanes: InputSignal<CapacityLaneView[]> = input<CapacityLaneView[]>([]);
  readonly modeEnum = ReadingMode;
}
