import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NostosIconComponent } from './nostos-icon.component';
import { NOSTOS_CONCEPTS } from './nostos-concepts';
import { NOSTOS_ICON_NAMES, NOSTOS_ICONS } from './nostos-icons';

@Component({
  standalone: true,
  imports: [NostosIconComponent],
  template: `
    <nostos-icon name="trash" />
    <nostos-icon name="star" weight="fill" [size]="24" />
    <nostos-icon concept="audiobook" />
    <nostos-icon name="book" concept="audiobook" />
    <nostos-icon name="brain" weight="light" />
    <nostos-icon name="trash" [label]="'Delete book'" />
    <nostos-icon [name]="dynamic()" [size]="dynamicSize()" />
    <nostos-icon name="trash" weight="fill" />
  `,
})
class HostComponent {
  readonly dynamic = signal<'x' | 'check'>('x');
  readonly dynamicSize = signal(12);
}

function icons(f: ReturnType<typeof TestBed.createComponent<HostComponent>>) {
  return Array.from(f.nativeElement.querySelectorAll('nostos-icon')) as HTMLElement[];
}
const svgOf = (el: HTMLElement) => el.querySelector('svg') as SVGElement;
/**
 * The drawn geometry only. Compared by `d` attribute rather than raw markup:
 * a DOM serialiser drops the self-closing slash from `<path ... />`, so raw
 * strings differ between the asset and the rendered element for a reason that
 * has nothing to do with which glyph was drawn.
 */
const drawing = (markup: string) => (markup.match(/\sd="[^"]*"/g) ?? []).join('|');

describe('NostosIconComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('renders the requested glyph as an inline svg', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const svg = svgOf(icons(f)[0]);
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 256 256');
  });

  it('resolves a semantic concept through the one central mapping', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    // NOSTOS_CONCEPTS decides this (audiobook -> headphones), not the call site.
    expect(drawing(svgOf(icons(f)[2]).innerHTML)).toBe(drawing(NOSTOS_ICONS.headphones.regular));
    // An explicit name wins over a concept, so a call site can still override.
    expect(drawing(svgOf(icons(f)[3]).innerHTML)).toBe(drawing(NOSTOS_ICONS.book.regular));
  });

  it('writes the requested size onto the svg so CSS can still override it', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    expect(svgOf(icons(f)[0]).getAttribute('width')).toBe('16'); // default rung
    expect(svgOf(icons(f)[1]).getAttribute('width')).toBe('24');
    f.componentInstance.dynamicSize.set(11);
    await f.whenStable();
    expect(svgOf(icons(f)[6]).getAttribute('width')).toBe('11');
  });

  it('renders a different drawing for a different weight', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    expect(drawing(svgOf(icons(f)[4]).innerHTML)).toBe(drawing(NOSTOS_ICONS.brain.light!));
    expect(drawing(svgOf(icons(f)[4]).innerHTML)).not.toBe(drawing(NOSTOS_ICONS.brain.regular));
  });

  it('falls back to regular when that glyph has no such weight imported', async () => {
    // 'trash' ships only its regular variant; weight="fill" must not blank it.
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    expect(drawing(svgOf(icons(f)[7]).innerHTML)).toBe(drawing(NOSTOS_ICONS.trash.regular));
  });

  it('is decorative by default: aria-hidden, no role, no name', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const el = icons(f)[0];
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('aria-label')).toBeNull();
  });

  it('becomes a named image when a label is given - and stops being hidden', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const el = icons(f)[5];
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Delete book');
    expect(el.getAttribute('aria-hidden')).toBeNull();
  });

  it('tracks a changed name without leaking the previous glyph', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const before = drawing(svgOf(icons(f)[6]).innerHTML);
    f.componentInstance.dynamic.set('check');
    await f.whenStable();
    expect(drawing(svgOf(icons(f)[6]).innerHTML)).toBe(drawing(NOSTOS_ICONS.check.regular));
    expect(drawing(svgOf(icons(f)[6]).innerHTML)).not.toBe(before);
    expect(icons(f)[6].querySelectorAll('svg').length).toBe(1);
  });

  it('throws loudly when neither name nor concept is given', () => {
    // A silent blank box is the failure mode this guards against.
    @Component({
      standalone: true,
      imports: [NostosIconComponent],
      template: `<nostos-icon />`,
    })
    class BrokenHost {}
    TestBed.configureTestingModule({ imports: [BrokenHost] });
    const f = TestBed.createComponent(BrokenHost);
    expect(() => f.detectChanges()).toThrowError(/no icon requested/);
  });
});

describe('Nostos icon registry', () => {
  it('ships every glyph with a regular variant (the component fallback depends on it)', () => {
    for (const name of NOSTOS_ICON_NAMES) {
      expect(NOSTOS_ICONS[name].regular?.length).toBeGreaterThan(0);
    }
  });

  it('only maps concepts to glyphs that exist', () => {
    for (const [concept, glyph] of Object.entries(NOSTOS_CONCEPTS)) {
      expect(concept.length).toBeGreaterThan(0);
      expect(NOSTOS_ICON_NAMES).toContain(glyph);
    }
  });

  it('carries Phosphor markup, so nothing is a leftover from another family', () => {
    for (const name of NOSTOS_ICON_NAMES) {
      const svg = NOSTOS_ICONS[name].regular!;
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox="0 0 256 256"');
      expect(svg).toContain('fill="currentColor"');
      expect(svg).not.toContain('stroke-width');
    }
  });
});
