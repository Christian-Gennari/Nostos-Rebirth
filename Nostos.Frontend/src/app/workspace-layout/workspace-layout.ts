import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';

@Component({
  standalone: true,
  selector: 'app-workspace-layout',
  imports: [RouterOutlet, SidebarCollections],
  templateUrl: './workspace-layout.html',
  styleUrl: './workspace-layout.css',
})
export class WorkspaceLayout {}
