import { Routes } from '@angular/router';
import { Home } from './home/home.component';
import { WorkspaceLayout } from './workspace-layout/workspace-layout.component';

export const routes: Routes = [
  {
    path: '',
    component: Home,
  },

  // Dedicated Reader Route (full-screen immersive mode)
  {
    path: 'read/:id',
    loadComponent: () => import('./reader/reader-shell.component').then((m) => m.ReaderShell),
  },

  // Wrap ONLY library + brain inside workspace layout
  {
    path: '',
    component: WorkspaceLayout,
    children: [
      {
        path: 'library',
        loadComponent: () => import('./library/library.component').then((m) => m.Library),
        data: { shouldReuse: true },
      },
      {
        path: 'second-brain',
        loadComponent: () =>
          import('./second-brain/second-brain.component').then((m) => m.SecondBrain),
        data: { shouldReuse: true },
      },
      {
        path: 'studio',
        loadComponent: () =>
          import('./writing-studio/writing-studio.component').then((m) => m.WritingStudio),
        data: { shouldReuse: true },
      },
      {
        path: 'library/:id',
        loadComponent: () =>
          import('./book-detail/book-detail.component').then((m) => m.BookDetail),
        data: { shouldReuse: true },
      },
    ],
  },

  // Catch-all: redirect unknown routes to library
  {
    path: '**',
    redirectTo: 'library',
  },
];
