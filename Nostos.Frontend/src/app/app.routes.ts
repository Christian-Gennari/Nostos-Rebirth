import { Routes } from '@angular/router';
import { Library } from './library/library';
import { Home } from './home/home';

export const routes: Routes = [
  {
    path: '',
    component: Home,
  },
  {
    path: 'library',
    component: Library,
  },
];
