import { Component, input, computed } from '@angular/core';
import { PdfJsViewerModule } from 'ng2-pdfjs-viewer';

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  imports: [PdfJsViewerModule],
  templateUrl: './pdf-reader.html',
  styleUrl: './pdf-reader.css',
})
export class PdfReader {
  // Receive the ID from the Shell
  bookId = input.required<string>();

  // Construct the backend URL
  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);

  // Handle errors passed up from the viewer
  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
