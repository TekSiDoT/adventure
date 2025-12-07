import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoryService } from './services/story.service';
import { PinGateComponent } from './components/pin-gate/pin-gate.component';
import { StoryViewComponent } from './components/story-view/story-view.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PinGateComponent, StoryViewComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild(PinGateComponent) pinGate!: PinGateComponent;

  private storyService = inject(StoryService);
  readonly isPinVerified = this.storyService.isPinVerified;

  onPinSubmit(pin: string): void {
    const valid = this.storyService.verifyPin(pin);
    if (!valid) {
      this.pinGate.showError();
    }
  }
}
