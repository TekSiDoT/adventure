import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StoryService } from '../../services/story.service';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { Choice, OpenQuestion } from '../../models/story.model';

@Component({
  selector: 'app-story-view',
  standalone: true,
  imports: [CommonModule, FormsModule, AudioPlayerComponent],
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
  openAnswer = signal<string>('');

  async onChoiceClick(choice: Choice): Promise<void> {
    this.isChoosing.set(true);
    await this.storyService.makeChoice(choice);
    this.openAnswer.set(''); // Clear any leftover open answer
    this.isChoosing.set(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onRestart(): void {
    this.storyService.resetAdventure();
    this.showHistory.set(false);
    this.openAnswer.set('');
  }

  toggleHistory(): void {
    this.showHistory.set(!this.showHistory());
  }

  async onOpenAnswerSubmit(question: OpenQuestion): Promise<void> {
    const answer = this.openAnswer().trim();
    if (!answer) return;

    this.isChoosing.set(true);
    await this.storyService.submitOpenAnswer(question, answer);
    this.openAnswer.set('');
    this.isChoosing.set(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
