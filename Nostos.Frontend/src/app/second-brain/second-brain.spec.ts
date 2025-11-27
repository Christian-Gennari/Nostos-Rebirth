import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecondBrain } from './second-brain';

describe('SecondBrain', () => {
  let component: SecondBrain;
  let fixture: ComponentFixture<SecondBrain>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecondBrain]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecondBrain);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
