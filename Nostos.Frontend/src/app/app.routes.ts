import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/library').then((m) => m.LibraryComponent),
  },
];
