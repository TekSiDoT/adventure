import { Component, signal, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pin-gate',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pin-gate.component.html',
  styleUrl: './pin-gate.component.scss'
})
export class PinGateComponent {
  @Output() pinSubmit = new EventEmitter<string>();
  @Input() isLoading = false;

  readonly PIN_LENGTH = 6;
  readonly pinDots = Array(6).fill(0).map((_, i) => i);

  pin = signal<string>('');
  error = signal<boolean>(false);
  shake = signal<boolean>(false);

  onDigitClick(digit: string): void {
    if (this.pin().length < this.PIN_LENGTH) {
      this.pin.set(this.pin() + digit);
      this.error.set(false);
    }
  }

  onBackspace(): void {
    this.pin.set(this.pin().slice(0, -1));
    this.error.set(false);
  }

  onClear(): void {
    this.pin.set('');
    this.error.set(false);
  }

  onSubmit(): void {
    if (this.pin().length === this.PIN_LENGTH && !this.isLoading) {
      this.pinSubmit.emit(this.pin());
    }
  }

  showError(): void {
    this.error.set(true);
    this.shake.set(true);
    this.pin.set('');
    setTimeout(() => this.shake.set(false), 500);
  }
}
