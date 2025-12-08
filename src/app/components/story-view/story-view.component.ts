import { Component, inject, signal, computed, ElementRef, ViewChildren, QueryList, AfterViewInit, OnDestroy } from '@angular/core';
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
export class StoryViewComponent implements AfterViewInit, OnDestroy {
  private storyService = inject(StoryService);
  private observer: IntersectionObserver | null = null;
  private keyBuffer = '';
  private keyListener = this.onKeyDown.bind(this);

  @ViewChildren('historyChapter') historyChapters!: QueryList<ElementRef>;

  readonly currentNode = this.storyService.currentNode;
  readonly isLoading = this.storyService.isLoading;
  readonly error = this.storyService.error;
  readonly storyHistory = this.storyService.storyHistory;
  readonly isReaderMode = this.storyService.isReaderMode;
  readonly isCurrentNodeAnswered = this.storyService.isCurrentNodeAnswered;
  readonly isDebugMode = this.storyService.isDebugMode;
  readonly allNodes = this.storyService.allNodes;

  isChoosing = signal<boolean>(false);
  showHistory = signal<boolean>(false);
  openAnswer = signal<string>('');
  activeChapterIndex = signal<number>(0);

  readonly imagePosition = computed(() => this.currentNode()?.media?.imagePosition ?? 'top');

  readonly paragraphsBeforeImage = computed(() => {
    const node = this.currentNode();
    if (!node) return [];
    const paragraphs = node.text.split('\n\n');
    const pos = this.imagePosition();
    if (pos === 'top') return [];
    if (pos === 'bottom') return paragraphs;
    // middle: first half
    return paragraphs.slice(0, Math.ceil(paragraphs.length / 2));
  });

  readonly paragraphsAfterImage = computed(() => {
    const node = this.currentNode();
    if (!node) return [];
    const paragraphs = node.text.split('\n\n');
    const pos = this.imagePosition();
    if (pos === 'top') return paragraphs;
    if (pos === 'bottom') return [];
    // middle: second half
    return paragraphs.slice(Math.ceil(paragraphs.length / 2));
  });

  async onChoiceClick(choice: Choice): Promise<void> {
    this.isChoosing.set(true);
    await this.storyService.makeChoice(choice);
    this.openAnswer.set(''); // Clear any leftover open answer
    this.isChoosing.set(false);
    // Use setTimeout to ensure scroll happens after Angular's change detection completes
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }, 0);
  }

  onRestart(): void {
    this.storyService.resetAdventure();
    this.showHistory.set(false);
    this.openAnswer.set('');
  }

  onDebugNavigate(nodeId: string): void {
    this.storyService.navigateToNode(nodeId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  onDebugReset(): void {
    this.storyService.debugReset();
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
  }

  ngAfterViewInit(): void {
    this.historyChapters.changes.subscribe(() => {
      this.setupIntersectionObserver();
    });
    window.addEventListener('keydown', this.keyListener);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    window.removeEventListener('keydown', this.keyListener);
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Handle Enter key for single "Weiter" choice
    if (event.key === 'Enter') {
      const node = this.currentNode();
      if (node && node.choices.length === 1 && !this.isChoosing() && !this.isReaderMode()) {
        event.preventDefault();
        this.onChoiceClick(node.choices[0]);
      }
      return;
    }

    // Debug code: 31337 toggles admin/debug mode
    this.keyBuffer += event.key;
    if (this.keyBuffer.length > 5) {
      this.keyBuffer = this.keyBuffer.slice(-5);
    }
    if (this.keyBuffer === '31337') {
      this.keyBuffer = '';
      this.storyService.toggleDebugMode();
    }
  }

  private setupIntersectionObserver(): void {
    this.observer?.disconnect();

    if (this.historyChapters.length === 0) return;

    // Set initial active chapter
    this.activeChapterIndex.set(0);

    this.observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible chapter
        const visibleEntries = entries.filter(e => e.isIntersecting);
        if (visibleEntries.length > 0) {
          // Get the one closest to the top of the viewport
          const topEntry = visibleEntries.reduce((prev, curr) =>
            curr.boundingClientRect.top < prev.boundingClientRect.top ? curr : prev
          );
          const index = parseInt(topEntry.target.getAttribute('data-index') || '0', 10);
          this.activeChapterIndex.set(index);
        }
      },
      { threshold: 0.1, rootMargin: '-10% 0px -70% 0px' }
    );

    this.historyChapters.forEach((chapter) => {
      this.observer?.observe(chapter.nativeElement);
    });
  }

  scrollToChapter(index: number): void {
    const chapters = this.historyChapters.toArray();
    if (chapters[index]) {
      chapters[index].nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
