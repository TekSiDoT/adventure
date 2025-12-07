import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Story, StoryNode, Choice, OpenQuestion } from '../models/story.model';

const PIN_STORAGE_KEY = 'adventure_v2_pin_verified';
const READER_MODE_KEY = 'adventure_v2_reader_mode';
const CURRENT_NODE_KEY = 'adventure_v2_current_node';
const HISTORY_KEY = 'adventure_v2_history';

interface HistoryEntry {
  nodeId: string;
  choiceText?: string;
}

@Injectable({
  providedIn: 'root'
})
export class StoryService {
  private story = signal<Story | null>(null);
  private currentNodeId = signal<string>('start');
  private pinVerified = signal<boolean>(false);
  private readerMode = signal<boolean>(false);
  private history = signal<HistoryEntry[]>([]);

  readonly isLoading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  readonly currentNode = computed<StoryNode | null>(() => {
    const s = this.story();
    const nodeId = this.currentNodeId();
    return s?.nodes[nodeId] ?? null;
  });

  readonly isPinVerified = computed(() => this.pinVerified());
  readonly isReaderMode = computed(() => this.readerMode());

  readonly storyHistory = computed(() => {
    const s = this.story();
    if (!s) return [];

    return this.history().map(entry => ({
      node: s.nodes[entry.nodeId],
      choiceText: entry.choiceText
    })).filter(h => h.node);
  });

  constructor(private http: HttpClient) {
    this.checkStoredState();
    this.loadStory();
  }

  private checkStoredState(): void {
    const stored = localStorage.getItem(PIN_STORAGE_KEY);
    if (stored === 'true') {
      this.pinVerified.set(true);
    }

    const isReader = localStorage.getItem(READER_MODE_KEY);
    if (isReader === 'true') {
      this.readerMode.set(true);
    }

    const savedNode = localStorage.getItem(CURRENT_NODE_KEY);
    if (savedNode) {
      this.currentNodeId.set(savedNode);
    }

    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try {
        this.history.set(JSON.parse(savedHistory));
      } catch {
        this.history.set([]);
      }
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
          this.history.set([]);
          localStorage.removeItem(HISTORY_KEY);
        }
        // Initialize history with start node if empty
        if (this.history().length === 0 && story.nodes[this.currentNodeId()]) {
          this.history.set([{ nodeId: this.currentNodeId() }]);
          this.saveHistory();
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load story:', err);
        this.error.set('Das Abenteuer konnte nicht geladen werden. Bitte neu laden!');
        this.isLoading.set(false);
      }
    });
  }

  private saveHistory(): void {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history()));
  }

  verifyPin(pin: string): boolean {
    const s = this.story();
    if (!s) return false;

    // Check main PIN (chooser mode)
    if (pin === s.pin) {
      this.pinVerified.set(true);
      this.readerMode.set(false);
      localStorage.setItem(PIN_STORAGE_KEY, 'true');
      localStorage.removeItem(READER_MODE_KEY);
      return true;
    }

    // Check reader PIN (read-only mode)
    if (s.readerPin && pin === s.readerPin) {
      this.pinVerified.set(true);
      this.readerMode.set(true);
      localStorage.setItem(PIN_STORAGE_KEY, 'true');
      localStorage.setItem(READER_MODE_KEY, 'true');
      this.notifyReaderLogin();
      return true;
    }

    return false;
  }

  async makeChoice(choice: Choice): Promise<void> {
    const current = this.currentNode();
    if (!current) return;

    // Send notification only for real choices (multiple options) and not in reader mode
    if (!this.readerMode() && current.choices.length > 1) {
      try {
        await this.notifyChoice(current, choice);
      } catch (err) {
        console.error('Failed to send notification:', err);
        // Continue anyway - don't block the adventure
      }
    }

    // Update history - mark current node with the choice made
    const currentHistory = this.history();
    if (currentHistory.length > 0) {
      const updatedHistory = [...currentHistory];
      updatedHistory[updatedHistory.length - 1] = {
        ...updatedHistory[updatedHistory.length - 1],
        choiceText: choice.text
      };
      // Add the new node
      updatedHistory.push({ nodeId: choice.nextNode });
      this.history.set(updatedHistory);
      this.saveHistory();
    }

    // Update current node
    this.currentNodeId.set(choice.nextNode);
    localStorage.setItem(CURRENT_NODE_KEY, choice.nextNode);
  }

  async submitOpenAnswer(question: OpenQuestion, answer: string): Promise<void> {
    const current = this.currentNode();
    if (!current) return;

    // Send notification (open answers always notify, unless reader mode)
    if (!this.readerMode()) {
      try {
        await this.notifyOpenAnswer(current, question, answer);
      } catch (err) {
        console.error('Failed to send notification:', err);
      }
    }

    // Update history
    const currentHistory = this.history();
    if (currentHistory.length > 0) {
      const updatedHistory = [...currentHistory];
      updatedHistory[updatedHistory.length - 1] = {
        ...updatedHistory[updatedHistory.length - 1],
        choiceText: answer
      };
      updatedHistory.push({ nodeId: question.nextNode });
      this.history.set(updatedHistory);
      this.saveHistory();
    }

    // Update current node
    this.currentNodeId.set(question.nextNode);
    localStorage.setItem(CURRENT_NODE_KEY, question.nextNode);
  }

  private async notifyOpenAnswer(node: StoryNode, question: OpenQuestion, answer: string): Promise<void> {
    await fetch('/.netlify/functions/notify-choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromNode: node.id,
        fromTitle: node.title || node.id,
        choiceId: 'open-answer',
        choiceText: `[${question.prompt}] ${answer}`,
        toNode: question.nextNode,
        timestamp: new Date().toISOString()
      })
    });
  }

  private async notifyReaderLogin(): Promise<void> {
    try {
      await fetch('/.netlify/functions/notify-choice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromNode: 'login',
          fromTitle: 'Reader Login',
          choiceId: 'reader-login',
          choiceText: 'Ein Leser hat sich eingeloggt',
          toNode: 'start',
          timestamp: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error('Failed to send reader login notification:', err);
    }
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
      this.history.set([{ nodeId: s.currentNode }]);
      this.saveHistory();
    }
  }

  logout(): void {
    this.pinVerified.set(false);
    this.readerMode.set(false);
    localStorage.removeItem(PIN_STORAGE_KEY);
    localStorage.removeItem(READER_MODE_KEY);
  }
}
