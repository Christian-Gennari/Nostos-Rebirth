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

  // Define the CSS styles to be passed to the [customCSS] input
  readonly scrollbarStyles = `
    #toolbarViewer,
    #toolbarViewer * {
      font-family: "Inter", sans-serif !important;
      letter-spacing: -0.01em;
    }
    #viewerContainer::-webkit-scrollbar, ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    #viewerContainer::-webkit-scrollbar-track, ::-webkit-scrollbar-track {
      background: transparent;
    }
    #viewerContainer::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb {
      background: #ddd;
      border-radius: 4px;
    }
    #viewerContainer::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:hover {
      background: #bbb;
    }
  `;

  onPdfLoaded() {
    console.log('PDF Loaded');
  }

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
