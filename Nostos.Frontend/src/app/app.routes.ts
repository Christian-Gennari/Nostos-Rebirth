import { Routes } from '@angular/router';
import { LibraryComponent } from './library/library';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/library').then((m) => m.LibraryComponent),
  },
];
