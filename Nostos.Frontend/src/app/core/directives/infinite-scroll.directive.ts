import {
  Directive,
  ElementRef,
  EventEmitter,
  Output,
  OnDestroy,
  AfterViewInit,
  inject,
} from '@angular/core';

@Directive({
  selector: '[appInfiniteScroll]',
  standalone: true,
})
export class InfiniteScrollDirective implements AfterViewInit, OnDestroy {
  @Output() scrolly = new EventEmitter<void>();

  private observer: IntersectionObserver | null = null;
  private el = inject(ElementRef);

  ngAfterViewInit() {
    const options = {
      root: null, // viewport
      rootMargin: '100px', // Trigger 100px before the bottom
      threshold: 0.1,
    };

    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        this.scrolly.emit();
      }
    }, options);

    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
