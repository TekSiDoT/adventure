import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoryService } from '../../services/story.service';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { Choice } from '../../models/story.model';

@Component({
  selector: 'app-story-view',
  standalone: true,
  imports: [CommonModule, AudioPlayerComponent],
  templateUrl: './story-view.component.html',
  styleUrl: './story-view.component.scss'
})
export class StoryViewComponent {
  private storyService = inject(StoryService);

  readonly currentNode = this.storyService.currentNode;
  readonly isLoading = this.storyService.isLoading;
  readonly error = this.storyService.error;
  readonly storyHistory = this.storyService.storyHistory;
  readonly isReaderMode = this.storyService.isReaderMode;

  isChoosing = signal<boolean>(false);
  showHistory = signal<boolean>(false);

  async onChoiceClick(choice: Choice): Promise<void> {
    this.isChoosing.set(true);
    await this.storyService.makeChoice(choice);
    this.isChoosing.set(false);
  }

  onRestart(): void {
    this.storyService.resetAdventure();
    this.showHistory.set(false);
  }

  toggleHistory(): void {
    this.showHistory.set(!this.showHistory());
  }
}
