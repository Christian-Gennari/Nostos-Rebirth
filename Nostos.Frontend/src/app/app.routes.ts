import { Routes } from '@angular/router';
import { Home } from './home/home';
import { WorkspaceLayout } from './workspace-layout/workspace-layout';

export const routes: Routes = [
  {
    path: '',
    component: Home,
  },

  // --- NEW: Dedicated Reader Route ---
  // Placed outside WorkspaceLayout for full-screen immersive mode
  {
    path: 'read/:id',
    loadComponent: () => import('./reader/reader-shell').then((m) => m.ReaderShell),
  },

  // Wrap ONLY library + brain inside workspace layout
  {
    path: '',
    component: WorkspaceLayout,
    children: [
      {
        path: 'library',
        loadComponent: () => import('./library/library').then((m) => m.Library),
        data: { shouldReuse: true },
      },
      {
        path: 'second-brain',
        loadComponent: () => import('./second-brain/second-brain').then((m) => m.SecondBrain),
        data: { shouldReuse: true },
      },
      {
        path: 'studio',
        loadComponent: () => import('./writing-studio/writing-studio').then((m) => m.WritingStudio),
        data: { shouldReuse: true },
      },
      // 👇 Added reuse here so BookDetail stays open
      {
        path: 'library/:id',
        loadComponent: () => import('./book-detail/book-detail').then((m) => m.BookDetail),
        data: { shouldReuse: true },
      },
    ],
  },
];
