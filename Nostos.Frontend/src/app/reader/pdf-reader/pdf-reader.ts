import { Component, input, computed } from '@angular/core';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer'; // <--- CHANGED

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  imports: [NgxExtendedPdfViewerModule], // <--- CHANGED
  templateUrl: './pdf-reader.html',
  styleUrl: './pdf-reader.css',
})
export class PdfReader {
  // Receive the ID from the Shell
  bookId = input.required<string>();

  // Construct the backend URL
  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);

  // (Removed scrollbarStyles - we can handle this with standard CSS now)

  onPdfLoaded() {
    console.log('PDF Loaded');
    // This is where we will initialize the Highlight Layer later
  }

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
