import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddBookModal } from './add-book-modal.component';

describe('AddBookModal', () => {
  let component: AddBookModal;
  let fixture: ComponentFixture<AddBookModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddBookModal],
    }).compileComponents();

    fixture = TestBed.createComponent(AddBookModal);
    component = fixture.componentInstance;
    // isOpen and collections are required inputs; provide them before the first
    // change detection so the constructor effect and template can read them.
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('collections', []);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
