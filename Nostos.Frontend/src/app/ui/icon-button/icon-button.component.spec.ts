import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, Pencil, Trash2, X } from 'lucide-angular';
import { IconButtonComponent } from './icon-button.component';

/**
 * The host template exercises the ATTRIBUTE SELECTOR, which is the whole point of
 * this component: the usage site is a plain `<button>` with extra attributes, and
 * natives like `disabled` must keep working with no forwarding code.
 */
@Component({
  standalone: true,
  imports: [IconButtonComponent, LucideAngularModule],
  template: `
    <button appIconButton [icon]="pencil" tip="Edit" ariaLabel="Edit book" (click)="clicks = clicks + 1"></button>
    <button appIconButton [icon]="trash" size="xs" tone="danger" ariaLabel="Delete"></button>
    <button appIconButton [icon]="x" size="xxs" shape="round" ariaLabel="Jump"></button>
    <button appIconButton [icon]="pencil" [disabled]="disabled()" (click)="clicks = clicks + 1"></button>
    <button appIconButton [icon]="pencil" [active]="true" ariaLabel="TOC"></button>
    <button appIconButton [icon]="pencil" [pressed]="pressed()"></button>
    <button appIconButton [icon]="pencil" class="desktop-only zen-toggle" ariaLabel="Extra"></button>
  `,
})
class HostComponent {
  pencil = Pencil;
  trash = Trash2;
  x = X;
  clicks = 0;
  /**
   * Signals, not plain fields: the component uses
   * ChangeDetectionStrategy.OnPush, so mutating a plain property would not
   * re-render and the test would fail for a reason unrelated to the component.
   * Using signals here also matches how every real call site feeds these inputs.
   */
  readonly disabled = signal(false);
  readonly pressed = signal<boolean | null>(null);
}

function buttons(f: ReturnType<typeof TestBed.createComponent<HostComponent>>) {
  return Array.from(f.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
}

describe('IconButtonComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('renders the host as the native <button>, not a wrapper element', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const all = buttons(f);
    expect(all.length).toBe(7);
    // Every host is a real button; there is no custom element in between.
    expect(f.nativeElement.querySelector('app-icon-button')).toBeNull();
  });

  it('keeps the icon-btn class on the host so existing CSS and specs still match', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    for (const b of buttons(f)) expect(b.classList.contains('icon-btn')).toBe(true);
  });

  it('renders the glyph inside the button', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    expect(buttons(f)[0].querySelector('lucide-icon')).toBeTruthy();
  });

  it('puts aria-label on the host, and omits it when empty', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const all = buttons(f);
    expect(all[0].getAttribute('aria-label')).toBe('Edit book');
    expect(all[3].getAttribute('aria-label')).toBeNull();
  });

  it('applies the measured size rungs as host classes', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const all = buttons(f);
    expect(all[1].classList.contains('icon-btn--xs')).toBe(true);
    expect(all[2].classList.contains('icon-btn--xxs')).toBe(true);
    expect(all[2].classList.contains('icon-btn--round')).toBe(true);
    // md is the default and needs no class: the base rule already is 32px.
    expect(all[0].classList.contains('icon-btn--md')).toBe(false);
  });

  it('applies the danger tone as a host class', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    expect(buttons(f)[1].classList.contains('icon-btn--danger')).toBe(true);
    expect(buttons(f)[0].classList.contains('icon-btn--danger')).toBe(false);
  });

  it('keeps native disabled behaviour with no forwarding code', async () => {
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.disabled.set(true);
    await f.whenStable();
    const b = buttons(f)[3];
    expect(b.disabled).toBe(true);
    b.click();
    expect(f.componentInstance.clicks).toBe(0); // a disabled button does not fire
  });

  it('lets native click pass through', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    buttons(f)[0].click();
    expect(f.componentInstance.clicks).toBe(1);
  });

  it('marks the active state with a class, not an attribute the surface fights', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    expect(buttons(f)[4].classList.contains('icon-btn--active')).toBe(true);
  });

  it('omits aria-pressed entirely by default, and emits it only when set', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    // Default null: an action button must NOT claim to be a toggle.
    expect(buttons(f)[5].getAttribute('aria-pressed')).toBeNull();
    f.componentInstance.pressed.set(true);
    await f.whenStable();
    expect(buttons(f)[5].getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves one-off utility classes untouched on the host', async () => {
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const b = buttons(f)[6];
    expect(b.classList.contains('desktop-only')).toBe(true);
    expect(b.classList.contains('zen-toggle')).toBe(true);
    expect(b.classList.contains('icon-btn')).toBe(true);
  });
});
