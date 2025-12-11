import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router } from '@angular/router';
import { StoryService } from './services/story.service';
import { PinGateComponent } from './components/pin-gate/pin-gate.component';
import { StoryViewComponent } from './components/story-view/story-view.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, PinGateComponent, StoryViewComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild(PinGateComponent) pinGate!: PinGateComponent;

  private storyService = inject(StoryService);
  private router = inject(Router);

  readonly isPinVerified = this.storyService.isPinVerified;
  readonly isAuthLoading = this.storyService.isAuthLoading;

  get isTestRoute(): boolean {
    return this.router.url.startsWith('/mist-test');
  }

  async onPinSubmit(pin: string): Promise<void> {
    const valid = await this.storyService.verifyPin(pin);
    if (!valid) {
      this.pinGate.showError();
    }
  }
}
