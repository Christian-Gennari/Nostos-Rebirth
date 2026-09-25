import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ButtonComponent } from '../ui/button/button.component';
import { CloudEntryService } from '../core/services/cloud-entry.service';

@Component({
  selector: 'app-cloud-entry',
  standalone: true,
  imports: [ButtonComponent],
  templateUrl: './cloud-entry.component.html',
  styleUrl: './cloud-entry.component.css',
})
export class CloudEntryComponent {
  readonly entry = inject(CloudEntryService);

  @ViewChild('archiveInput')
  private archiveInput?: ElementRef<HTMLInputElement>;

  signIn(): void {
    globalThis.location.assign(this.entry.loginUrl());
  }

  async checkout(): Promise<void> {
    const url = await this.entry.beginCheckout(this.entry.selectedOffer()?.offerId ?? null);
    if (url) globalThis.location.assign(url);
  }

  async checkSubscription(): Promise<void> {
    await this.entry.checkSubscription();
  }

  async manageSubscription(): Promise<void> {
    const url = await this.entry.openBillingPortal();
    if (url) globalThis.location.assign(url);
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
