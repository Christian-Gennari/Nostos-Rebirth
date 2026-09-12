import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { BloomArtDirective } from './bloom-art.directive';

/**
 * Test host: one image under the directive, with a src the spec can swap so it
 * can observe both the held-back and the revealed state.
 */
@Component({
  standalone: true,
  imports: [BloomArtDirective],
  template: `<img appBloomArt [src]="src()" alt="cover" />`,
})
class HostComponent {
  readonly src = signal('data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=');
}

describe('BloomArtDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  const image = (): HTMLImageElement =>
    fixture.debugElement.query(By.css('img')).nativeElement as HTMLImageElement;

  it('starts the art in the global held-back state', async () => {
    fixture.detectChanges();
    // `.bloom-art` is the class the global stylesheet keys the defocus off; it
    // must be present before any pixels exist.
    expect(image().classList.contains('bloom-art')).toBe(true);
  });

  it('blooms the art in on its own load event, without a manual detectChanges', async () => {
    fixture.detectChanges();
    image().classList.remove('is-bloomed');

    // Simulate the browser finishing the decode. The app runs zoneless: this
    // only reaches the DOM if the reveal flag is reactive, so a plain field
    // here would leave every cover at opacity 0 forever.
    image().dispatchEvent(new Event('load'));
    await fixture.whenStable();

    expect(image().classList.contains('is-bloomed')).toBe(true);
  });

  it('reveals on error too, so a missing cover never stays invisible', async () => {
    fixture.detectChanges();
    image().classList.remove('is-bloomed');

    image().dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(image().classList.contains('is-bloomed')).toBe(true);
  });
});
