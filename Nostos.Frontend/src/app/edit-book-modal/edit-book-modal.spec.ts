import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditBookModal } from './edit-book-modal';

describe('EditBookModal', () => {
  let component: EditBookModal;
  let fixture: ComponentFixture<EditBookModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditBookModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditBookModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
