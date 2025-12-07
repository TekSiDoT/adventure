import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Story, StoryNode, Choice } from '../models/story.model';

const PIN_STORAGE_KEY = 'adventure_pin_verified';
const CURRENT_NODE_KEY = 'adventure_current_node';

@Injectable({
  providedIn: 'root'
})
export class StoryService {
  private story = signal<Story | null>(null);
  private currentNodeId = signal<string>('start');
  private pinVerified = signal<boolean>(false);

  readonly isLoading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  readonly currentNode = computed<StoryNode | null>(() => {
    const s = this.story();
    const nodeId = this.currentNodeId();
    return s?.nodes[nodeId] ?? null;
  });

  readonly isPinVerified = computed(() => this.pinVerified());

  constructor(private http: HttpClient) {
    this.checkStoredPin();
    this.loadStory();
  }

  private checkStoredPin(): void {
    const stored = localStorage.getItem(PIN_STORAGE_KEY);
    if (stored === 'true') {
      this.pinVerified.set(true);
    }
    const savedNode = localStorage.getItem(CURRENT_NODE_KEY);
    if (savedNode) {
      this.currentNodeId.set(savedNode);
    }
  }

  private loadStory(): void {
    this.isLoading.set(true);
    this.http.get<Story>('/assets/story.json').subscribe({
      next: (story) => {
        this.story.set(story);
        // If saved node doesn't exist, reset to story's current node
        if (!story.nodes[this.currentNodeId()]) {
          this.currentNodeId.set(story.currentNode);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load story:', err);
        this.error.set('Failed to load the adventure. Please refresh!');
        this.isLoading.set(false);
      }
    });
  }

  verifyPin(pin: string): boolean {
    const s = this.story();
    if (s && pin === s.pin) {
      this.pinVerified.set(true);
      localStorage.setItem(PIN_STORAGE_KEY, 'true');
      return true;
    }
    return false;
  }

  async makeChoice(choice: Choice): Promise<void> {
    const current = this.currentNode();
    if (!current) return;

    // Send notification
    try {
      await this.notifyChoice(current, choice);
    } catch (err) {
      console.error('Failed to send notification:', err);
      // Continue anyway - don't block the adventure
    }

    // Update current node
    this.currentNodeId.set(choice.nextNode);
    localStorage.setItem(CURRENT_NODE_KEY, choice.nextNode);
  }

  private async notifyChoice(node: StoryNode, choice: Choice): Promise<void> {
    await fetch('/.netlify/functions/notify-choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromNode: node.id,
        fromTitle: node.title || node.id,
        choiceId: choice.id,
        choiceText: choice.text,
        toNode: choice.nextNode,
        timestamp: new Date().toISOString()
      })
    });
  }

  resetAdventure(): void {
    const s = this.story();
    if (s) {
      this.currentNodeId.set(s.currentNode);
      localStorage.setItem(CURRENT_NODE_KEY, s.currentNode);
    }
  }

  logout(): void {
    this.pinVerified.set(false);
    localStorage.removeItem(PIN_STORAGE_KEY);
  }
}
