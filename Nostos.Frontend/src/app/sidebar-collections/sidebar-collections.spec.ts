import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SidebarCollections } from './sidebar-collections';

describe('SidebarCollections', () => {
  let component: SidebarCollections;
  let fixture: ComponentFixture<SidebarCollections>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarCollections]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SidebarCollections);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
