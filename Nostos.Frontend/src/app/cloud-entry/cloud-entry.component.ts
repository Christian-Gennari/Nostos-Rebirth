import { Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { ButtonComponent } from '../ui/button/button.component';
import { NostosIconComponent } from '../ui/icon/nostos-icon.component';
import { CloudEntryService } from '../core/services/cloud-entry.service';

@Component({
  selector: 'app-cloud-entry',
  standalone: true,
  imports: [ButtonComponent, NostosIconComponent],
  templateUrl: './cloud-entry.component.html',
  styleUrl: './cloud-entry.component.css',
})
export class CloudEntryComponent {
  readonly entry = inject(CloudEntryService);

  @ViewChild('archiveInput')
  private archiveInput?: ElementRef<HTMLInputElement>;

  constructor() {
    effect(() => {
      const redirectUrl = this.entry.checkoutRedirect();
      if (redirectUrl) {
        this.navigateTo(redirectUrl);
      }
    });
  }

  navigateTo(url: string): void {
    globalThis.location.assign(url);
  }

  signIn(): void {
    this.navigateTo(this.entry.loginUrl());
  }

  async checkout(): Promise<void> {
    const url = await this.entry.beginCheckout(this.entry.selectedOffer()?.offerId ?? null);
    if (url) this.navigateTo(url);
  }

  async checkSubscription(): Promise<void> {
    await this.entry.checkSubscription();
  }

  async manageSubscription(): Promise<void> {
    const url = await this.entry.openBillingPortal();
    if (url) this.navigateTo(url);
  }

  chooseImport(): void {
    this.archiveInput?.nativeElement.click();
  }

  async importSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    await this.entry.importPortableArchive(file);
    input.value = '';
  }
}
