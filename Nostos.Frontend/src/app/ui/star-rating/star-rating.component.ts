import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Star } from 'lucide-angular';

@Component({
  selector: 'app-star-rating',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="star-rating" [class.readonly]="readonly">
      @for (star of stars; track $index) {
      <lucide-icon
        [img]="StarIcon"
        [size]="size"
        class="star-icon"
        [class.filled]="$index < rating"
        (click)="rate($index + 1)"
      ></lucide-icon>
      }
    </div>
  `,
  styles: [
    `
      .star-rating {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .star-icon {
        color: #c5c7ccff; /* Gray-200 */
        transition: all 0.2s ease;
      }
      /* Hover effects only if not readonly */
      .star-rating:not(.readonly) .star-icon:hover {
        transform: scale(1.1);
        cursor: pointer;
      }
      .star-rating:not(.readonly):hover .star-icon {
        /* Optional: highlight all stars up to hover could go here,
         but simple fill is often enough */
      }

      .star-icon.filled {
        fill: #fbbf24; /* Amber-400 */
        color: #fbbf24;
      }
    `,
  ],
})
export class StarRatingComponent {
  @Input() rating = 0;
  @Input() readonly = false;
  @Input() size = 18;
  @Output() ratingChange = new EventEmitter<number>();

  StarIcon = Star;
  stars = new Array(5); // Dummy array for loop

  rate(val: number) {
    if (this.readonly) return;

    // Logic change: If the clicked star value is the current rating, set it to 0 (reset). Otherwise, set it to the new value.
    const newRating = this.rating === val ? 0 : val;
    this.ratingChange.emit(newRating);
  }
}
