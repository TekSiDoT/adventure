import { Injectable, signal, computed, inject } from '@angular/core';
import { Story, StoryNode, Choice, OpenQuestion, InventoryItem } from '../models/story.model';
import { SupabaseService, DbStoryEvent, DbStoryState, AuthResponse } from './supabase.service';

interface HistoryEntry {
  nodeId: string;
  choiceText?: string;
  wasRealChoice?: boolean;
  answer?: string;
}

@Injectable({
  providedIn: 'root'
})
export class StoryService {
  private supabase = inject(SupabaseService);

  // Story content (loaded from Supabase only)
  private story = signal<Story | null>(null);
  private storyLoadedFromDb = signal<boolean>(false);
  readonly isStoryFromDb = this.storyLoadedFromDb.asReadonly();

  // Auth state
  private pinVerified = signal<boolean>(false);
  private authLoading = signal<boolean>(false);
  private currentUser = signal<AuthResponse['user'] | null>(null);
  private currentStoryMeta = signal<AuthResponse['story'] | null>(null);

  // Player state (from Supabase for player, derived from events for reader)
  private currentNodeId = signal<string>('start');
  private collectedItems = signal<Set<string>>(new Set());

  // History/events (from Supabase)
  private storyEvents = signal<DbStoryEvent[]>([]);

  // Expose events for reader position mapping
  readonly events = computed(() => this.storyEvents());
  private readerLastSeenEventId = signal<number>(0);

  // Legacy local state (kept for exploration hub feature)
  private exploredNodes = signal<Set<string>>(new Set());
  private pendingReturn = signal<string | null>(null);

  // UI state
  private debugMode = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly isDebugMode = computed(() => this.debugMode());
  readonly isAuthLoading = computed(() => this.authLoading());

  // Computed state
  readonly isPinVerified = computed(() => this.pinVerified());

  readonly isReaderMode = computed(() => {
    const user = this.currentUser();
    return user?.role === 'reader';
  });

  readonly isAdmin = computed(() => {
    const user = this.currentUser();
    return user?.role === 'admin';
  });

  readonly currentNode = computed<StoryNode | null>(() => {
    const s = this.story();
    const nodeId = this.currentNodeId();
    return s?.nodes[nodeId] ?? null;
  });

  readonly allNodes = computed(() => {
    const s = this.story();
    if (!s) return [];
    return Object.values(s.nodes).map(node => ({
      id: node.id,
      title: node.title || node.id
    }));
  });

  // Full story structure for admin overview
  readonly storyStructure = computed(() => {
    const s = this.story();
    if (!s) return null;
    return s;
  });

  // Convert DB events to history entries for display
  // Shows all visited nodes from events
  readonly storyHistory = computed(() => {
    const s = this.story();
    const events = this.storyEvents();
    if (!s || events.length === 0) return [];

    return events.map(event => {
      const node = s.nodes[event.node_id];
      // Create a fallback node if it doesn't exist in the loaded story
      const fallbackNode: StoryNode = {
        id: event.node_id,
        title: event.node_id,
        text: '',
        choices: []
      };
      return {
        node: node || fallbackNode,
        choiceText: event.choice_text || event.answer,
        wasRealChoice: !!event.choice_id && event.choice_id !== 'continue'
      };
    });
  });

  readonly inventory = computed<InventoryItem[]>(() => {
    const s = this.story();
    if (!s?.items) return [];

    return [...this.collectedItems()]
      .map(id => s.items![id])
      .filter((item): item is InventoryItem => item !== undefined);
  });

  readonly inventoryCount = computed(() => this.collectedItems().size);

  // Reader-specific: are they caught up with the player?
  readonly isCaughtUp = computed(() => {
    if (!this.isReaderMode()) return true;
    const events = this.storyEvents();
    const index = this.readerIndex();
    return index >= events.length - 1;
  });

  // Reader progress indicator
  readonly readerProgress = computed(() => {
    const events = this.storyEvents();
    const index = this.readerIndex();
    return {
      current: Math.max(0, index + 1),
      total: events.length
    };
  });

  // New event indicator for readers
  private hasNewEvents = signal<boolean>(false);
  readonly showNewEventToast = computed(() => this.hasNewEvents());

  // Exploration hub support
  readonly explorationStatus = computed(() => {
    const current = this.currentNode();
    if (!current?.explorationHub) return null;

    const explored = this.exploredNodes();
    const required = current.explorationHub.requiredNodes;
    const exploredList = required.map(nodeId => ({
      nodeId,
      explored: explored.has(nodeId)
    }));
    const allExplored = required.every(nodeId => explored.has(nodeId));

    return {
      requiredNodes: required,
      exploredList,
      allExplored,
      summaryNodeId: current.explorationHub.summaryNodeId
    };
  });

  readonly hasPendingReturn = computed(() => this.pendingReturn() !== null);
  readonly canGoBack = computed(() => this.storyEvents().length > 1);
  private readonly readerIndex = computed(() => {
    if (!this.isReaderMode()) return this.storyEvents().length - 1;
    const lastSeenId = this.readerLastSeenEventId();
    if (!lastSeenId) return -1;
    return this.storyEvents().findIndex(e => e.id === lastSeenId);
  });

  // For reader mode: available path (backward compat, but now based on events)
  readonly availablePath = computed<Choice | null>(() => {
    // In new system, readers navigate through events, not choices
    // Keep this for backward compatibility during transition
    const current = this.currentNode();
    const s = this.story();
    if (!current || !s || current.choices.length <= 1) return null;

    // Find which choice leads to the next event's node
    const events = this.storyEvents();
    const currentEventIndex = events.findIndex(e => e.node_id === current.id);
    if (currentEventIndex >= 0 && currentEventIndex < events.length - 1) {
      const nextEvent = events[currentEventIndex + 1];
      return current.choices.find(c => c.nextNode === nextEvent.node_id) || null;
    }

    return null;
  });

  readonly isCurrentNodeAnswered = computed(() => {
    const current = this.currentNode();
    if (!current) return false;
    // Check if there's an event with an answer for this node
    return this.storyEvents().some(e => e.node_id === current.id && e.answer);
  });

  constructor() {
    void this.tryRestoreSession();
  }

  async tryRestoreSession(): Promise<boolean> {
    if (this.pinVerified()) return true;
    if (!this.supabase.accessToken()) return false;

    this.authLoading.set(true);
    this.error.set(null);

    try {
      const response = await this.supabase.getSessionContext();
      const ok = await this.initializeAfterAuth(response);
      if (!ok) {
        this.supabase.logout();
      }
      return ok;
    } catch (err) {
      console.warn('Failed to restore session:', err);
      this.supabase.logout();
      return false;
    } finally {
      this.authLoading.set(false);
    }
  }

  /**
   * Ensure story is loaded from database (public method for components)
   */
  async ensureStoryFromDb(): Promise<boolean> {
    if (this.storyLoadedFromDb()) return true;

    const storyMeta = this.currentStoryMeta();
    if (!storyMeta) return false;

    return this.loadStoryFromSupabase(storyMeta.id);
  }

  /**
   * Load story content from Supabase database
   */
  private async loadStoryFromSupabase(storyId: string): Promise<boolean> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const story = await this.supabase.getStoryContent(storyId);
      if (story && Object.keys(story.nodes).length > 0) {
        this.story.set(story);
        this.storyLoadedFromDb.set(true);
        return true;
      }
      this.error.set('Das Abenteuer konnte nicht geladen werden. Bitte später erneut versuchen!');
    } catch (err) {
      console.warn('Failed to load story from Supabase:', err);
      this.error.set('Das Abenteuer konnte nicht geladen werden. Bitte später erneut versuchen!');
    } finally {
      this.isLoading.set(false);
    }
    return false;
  }

  /**
   * Verify PIN via Supabase RPC
   */
  async verifyPin(pin: string): Promise<boolean> {
    this.authLoading.set(true);
    this.error.set(null);

    try {
      const response = await this.supabase.authWithPin(pin);

      if (!response.success) {
        this.authLoading.set(false);
        return false;
      }

      const ok = await this.initializeAfterAuth(response);
      this.authLoading.set(false);
      return ok;
    } catch (err) {
      console.error('Auth error:', err);
      this.authLoading.set(false);
      return false;
    }
  }

  private async initializeAfterAuth(response: AuthResponse): Promise<boolean> {
    if (!response.success || !response.user || !response.story) return false;

    // Store auth state
    this.currentUser.set(response.user);
    this.currentStoryMeta.set(response.story);

    const loaded = await this.loadStoryFromSupabase(response.story.id);
    if (!loaded) return false;

    // Initialize state from response
    if (response.state) {
      if (!this.isReaderMode()) {
        this.currentNodeId.set(response.state.currentNodeId);
      }
      this.collectedItems.set(new Set(response.state.collectedItems || []));
    }

    // Load canonical history via paging (do not ship full history in auth response)
    await this.loadAllEvents();

    // Readers should see their own last seen entry, not the player's current node.
    if (this.isReaderMode()) {
      const lastSeenEventId = response.readerLastSeenEventId ?? 0;
      this.readerLastSeenEventId.set(lastSeenEventId);

      const event = this.storyEvents().find(e => e.id === lastSeenEventId);
      if (event) {
        this.currentNodeId.set(event.node_id);
        if (event.collected_items) {
          this.collectedItems.set(new Set(event.collected_items));
        }
      } else {
        this.currentNodeId.set(this.story()?.currentNode || 'start');
      }

      this.subscribeToUpdates(response.story.id);
    }

    this.pinVerified.set(true);
    return true;
  }

  private async loadAllEvents(): Promise<void> {
    const storyMeta = this.currentStoryMeta();
    if (!storyMeta) return;

    const all: DbStoryEvent[] = [];
    let afterId = 0;
    while (true) {
      const page = await this.supabase.getStoryEventsPage(storyMeta.id, afterId, 500);
      if (page.length === 0) break;
      all.push(...page);
      afterId = page[page.length - 1].id;
      if (page.length < 500) break;
    }

    this.storyEvents.set(all);
  }

  /**
   * Subscribe to real-time story updates (for readers)
   */
  private subscribeToUpdates(storyId: string): void {
    this.supabase.subscribeToEvents(
      storyId,
      (newEvent) => {
        // Add new event to list
        const events = [...this.storyEvents(), newEvent];
        this.storyEvents.set(events);
        this.hasNewEvents.set(true);

        // Auto-dismiss toast after 5 seconds
        setTimeout(() => this.hasNewEvents.set(false), 5000);
      },
      (newState) => {
        // Readers navigate through history; do not override their view state here.
      }
    );
  }

  /**
   * Player makes a choice
   */
  async makeChoice(choice: Choice): Promise<void> {
    const current = this.currentNode();
    const storyMeta = this.currentStoryMeta();
    if (!current || !storyMeta) return;

    // Collect items from this choice
    this.collectItems(choice.grantsItems);

    // Handle exploration hub
    if (choice.returnsTo) {
      this.markNodeExplored(choice.nextNode);
      this.pendingReturn.set(choice.returnsTo);
    }

    // Update current node
    this.currentNodeId.set(choice.nextNode);

    // Collect items from the next node
    const nextNode = this.story()?.nodes[choice.nextNode];
    if (nextNode?.grantsItems) {
      this.collectItems(nextNode.grantsItems);
    }

    // Record event to Supabase (player only)
    if (!this.isReaderMode()) {
      const wasRealChoice = current.choices.length > 1;

      const eventResult = await this.supabase.recordEvent({
        storyId: storyMeta.id,
        nodeId: choice.nextNode,
        choiceId: wasRealChoice ? choice.id : 'continue',
        choiceText: wasRealChoice ? choice.text : undefined,
        collectedItems: [...this.collectedItems()]
      });

      // Update story state
      await this.supabase.updateStoryState(
        storyMeta.id,
        choice.nextNode,
        [...this.collectedItems()]
      );

      if (eventResult.success && eventResult.event) {
        this.storyEvents.set([...this.storyEvents(), eventResult.event]);
      } else {
        // As a fallback (e.g. if insert didn't return), try to sync the newest events.
        await this.refreshState();
      }
    }
  }

  /**
   * Reader advances to next event
   */
  readerAdvance(): void {
    if (!this.isReaderMode()) return;

    const events = this.storyEvents();
    const index = this.readerIndex();

    if (index < events.length - 1) {
      const nextEvent = events[index + 1];
      this.readerLastSeenEventId.set(nextEvent.id);
      this.currentNodeId.set(nextEvent.node_id);

      // Update collected items
      if (nextEvent.collected_items) {
        this.collectedItems.set(new Set(nextEvent.collected_items));
      }

      // Save position to Supabase
      const storyMeta = this.currentStoryMeta();
      if (storyMeta) {
        this.supabase.updateReaderPosition(storyMeta.id, nextEvent.id);
      }
    }
  }

  /**
   * Reader goes back to previous event
   */
  readerGoBack(): void {
    if (!this.isReaderMode()) return;

    const events = this.storyEvents();
    const index = this.readerIndex();
    if (index > 0) {
      const previousEvent = events[index - 1];
      this.readerLastSeenEventId.set(previousEvent.id);
      this.currentNodeId.set(previousEvent.node_id);

      if (previousEvent.collected_items) {
        this.collectedItems.set(new Set(previousEvent.collected_items));
      }

      const storyMeta = this.currentStoryMeta();
      if (storyMeta) {
        this.supabase.updateReaderPosition(storyMeta.id, previousEvent.id);
      }
    }
  }

  /**
   * Dismiss new event toast
   */
  dismissNewEventToast(): void {
    this.hasNewEvents.set(false);
  }

  /**
   * Refresh story state (for readers)
   */
  async refreshState(): Promise<void> {
    const storyMeta = this.currentStoryMeta();
    if (!storyMeta) return;

    const { state } = await this.supabase.getStoryState(storyMeta.id);

    if (state) {
      // Don't update currentNodeId for readers - they control their own position
      if (!this.isReaderMode()) {
        this.currentNodeId.set(state.current_node_id);
      }
      this.collectedItems.set(new Set(state.collected_items || []));
    }

    const existing = this.storyEvents();
    const lastId = existing.length > 0 ? existing[existing.length - 1].id : 0;
    const newEvents = await this.supabase.getStoryEventsPage(storyMeta.id, lastId, 500);
    if (newEvents.length > 0) {
      this.storyEvents.set([...existing, ...newEvents]);
    }
  }

  /**
   * Submit answer to open question
   */
  async submitOpenAnswer(question: OpenQuestion, answer: string): Promise<void> {
    const current = this.currentNode();
    const storyMeta = this.currentStoryMeta();
    if (!current || !storyMeta) return;

    // Record event to Supabase
    if (!this.isReaderMode()) {
      const eventResult = await this.supabase.recordEvent({
        storyId: storyMeta.id,
        nodeId: current.id,
        answer: `[${question.prompt}] ${answer}`,
        collectedItems: [...this.collectedItems()]
      });

      if (eventResult.success && eventResult.event) {
        this.storyEvents.set([...this.storyEvents(), eventResult.event]);
      } else {
        await this.refreshState();
      }
    }
  }

  /**
   * Return to exploration hub after exploring a node
   */
  returnToHub(): void {
    const returnTo = this.pendingReturn();
    if (!returnTo) return;

    this.currentNodeId.set(returnTo);
    this.pendingReturn.set(null);
  }

  /**
   * Navigate to summary when all exploration nodes are visited
   */
  proceedToSummary(): void {
    const status = this.explorationStatus();
    if (!status?.allExplored) return;

    this.currentNodeId.set(status.summaryNodeId);
  }

  isNodeExplored(nodeId: string): boolean {
    return this.exploredNodes().has(nodeId);
  }

  private markNodeExplored(nodeId: string): void {
    const current = this.exploredNodes();
    if (!current.has(nodeId)) {
      const newExplored = new Set(current);
      newExplored.add(nodeId);
      this.exploredNodes.set(newExplored);
    }
  }

  private collectItems(itemIds: string[] | undefined): void {
    if (!itemIds || itemIds.length === 0) return;

    const current = this.collectedItems();
    const newItems = new Set(current);

    for (const id of itemIds) {
      newItems.add(id);
    }

    this.collectedItems.set(newItems);
  }

  /**
   * Reset adventure (player only)
   */
  resetAdventure(): void {
    const s = this.story();
    if (s) {
      this.currentNodeId.set(s.currentNode);
      this.collectedItems.set(new Set());
      this.exploredNodes.set(new Set());
      this.pendingReturn.set(null);
    }
  }

  /**
   * Go back (for players)
   */
  goBack(): void {
    const events = this.storyEvents();
    if (events.length < 2) return;

    // For players, going back is more complex with server state
    // For now, just go to previous event's node
    const previousEvent = events[events.length - 2];
    this.currentNodeId.set(previousEvent.node_id);
  }

  /**
   * Logout
   */
  logout(): void {
    this.supabase.logout();
    this.pinVerified.set(false);
    this.currentUser.set(null);
    this.currentStoryMeta.set(null);
    this.storyEvents.set([]);
    this.readerLastSeenEventId.set(0);
    this.currentNodeId.set('start');
    this.collectedItems.set(new Set());
  }

  /**
   * Debug mode toggle
   */
  toggleDebugMode(): void {
    this.debugMode.set(!this.debugMode());
  }

  /**
   * Debug navigation
   */
  navigateToNode(nodeId: string): void {
    const s = this.story();
    if (!s || !s.nodes[nodeId]) return;
    this.currentNodeId.set(nodeId);
  }

  /**
   * Debug reset
   */
  debugReset(): void {
    this.logout();
    window.location.reload();
  }
}
