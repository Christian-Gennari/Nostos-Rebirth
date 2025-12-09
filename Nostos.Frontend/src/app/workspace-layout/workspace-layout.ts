import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';
import { AppDockComponent } from '../misc-components/app-dock/app-dock';

@Component({
  standalone: true,
  selector: 'app-workspace-layout',
  imports: [RouterOutlet, SidebarCollections, AppDockComponent],
  templateUrl: './workspace-layout.html',
  styleUrl: './workspace-layout.css',
})
export class WorkspaceLayout {}
