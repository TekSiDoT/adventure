import { Component, inject, signal, computed, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService, DbUser, DbStoryEvent, DbStoryState } from '../../services/supabase.service';
import { StoryService } from '../../services/story.service';
import { StoryNode } from '../../models/story.model';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent implements OnInit, OnDestroy {
  private supabase = inject(SupabaseService);
  private storyService = inject(StoryService);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  @Output() close = new EventEmitter<void>();

  users = signal<DbUser[]>([]);
  events = signal<DbStoryEvent[]>([]);
  storyState = signal<DbStoryState | null>(null);
  dbEvents = signal<DbStoryEvent[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);

  // Form state
  newReaderName = signal('');
  isGenerating = signal(false);
  generatedPin = signal<string | null>(null);
  copiedPin = signal(false);

  // Tab state
  activeTab = signal<'users' | 'locks' | 'export'>('users');

  // Lock management state
  allNodes = signal<Array<{ id: string; title: string; is_locked: boolean; locked_until: string | null }>>([]);
  isTogglingLock = signal<string | null>(null); // node id being toggled

  readonly storyHistory = this.storyService.storyHistory;

  // Get current node details from story
  readonly currentNodeDetails = computed(() => {
    const state = this.storyState();
    if (!state) return null;
    const node = this.storyService.currentNode();
    // Try to get from all nodes
    const allNodes = this.storyService.allNodes();
    const found = allNodes.find(n => n.id === state.current_node_id);
    return {
      id: state.current_node_id,
      title: found?.title || state.current_node_id
    };
  });

  readonly sortedUsers = computed(() => {
    return [...this.users()].sort((a, b) => {
      // Sort by role first (admin > player > reader)
      const roleOrder = { admin: 0, player: 1, reader: 2 };
      const roleDiff = roleOrder[a.role] - roleOrder[b.role];
      if (roleDiff !== 0) return roleDiff;
      // Then by last active (most recent first)
      return new Date(b.last_active).getTime() - new Date(a.last_active).getTime();
    });
  });

  readonly sortedEvents = computed(() => {
    return [...this.events()].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });

  readonly readerCount = computed(() =>
    this.users().filter(u => u.role === 'reader').length
  );

  readonly lockedCount = computed(() =>
    this.allNodes().filter(n => n.is_locked).length
  );

  readonly unlockedCount = computed(() =>
    this.allNodes().filter(n => !n.is_locked).length
  );

  async ngOnInit() {
    await this.loadData();
    // Auto-refresh every 5 seconds for live status
    this.refreshInterval = setInterval(() => this.loadStoryState(), 5000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async loadData() {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Load users
      const usersResponse = await this.supabase.getUsers();
      if (usersResponse.success && usersResponse.users) {
        this.users.set(usersResponse.users);
      } else {
        this.error.set(usersResponse.error || 'Fehler beim Laden der Benutzer');
      }

      // Load story state and events from Supabase
      await this.loadStoryState();

      // Load lock status for all nodes
      await this.loadNodesLockStatus();
    } catch (err) {
      console.error('Load data error:', err);
      this.error.set('Fehler beim Laden der Daten');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadNodesLockStatus() {
    const story = this.supabase.story();
    if (!story) return;

    const nodes = await this.supabase.getAllNodesLockStatus(story.id);
    this.allNodes.set(nodes);
  }

  async toggleNodeLock(nodeId: string, currentlyLocked: boolean) {
    const story = this.supabase.story();
    if (!story) return;

    this.isTogglingLock.set(nodeId);

    try {
      const result = await this.supabase.setNodeLock(story.id, nodeId, !currentlyLocked);

      if (result.success) {
        // Refresh lock status
        await this.loadNodesLockStatus();
      } else {
        this.error.set(result.error || 'Fehler beim Ändern des Lock-Status');
      }
    } catch (err) {
      console.error('Toggle lock error:', err);
      this.error.set('Fehler beim Ändern des Lock-Status');
    } finally {
      this.isTogglingLock.set(null);
    }
  }

  async loadStoryState() {
    const story = this.supabase.story();
    if (!story) return;

    try {
      const { state, events } = await this.supabase.getStoryState(story.id);
      if (state) {
        this.storyState.set(state);
      }
      if (events) {
        this.dbEvents.set(events);
      }
    } catch (err) {
      console.error('Failed to load story state:', err);
    }
  }

  async generatePin() {
    const name = this.newReaderName().trim();
    if (!name) return;

    this.isGenerating.set(true);
    this.generatedPin.set(null);
    this.copiedPin.set(false);

    try {
      const story = this.supabase.story();
      if (!story) {
        this.error.set('Keine Story ausgewählt');
        return;
      }

      const response = await this.supabase.generateReaderPin(name, story.id);

      if (response.success && response.user) {
        this.generatedPin.set(response.user.pin);
        this.newReaderName.set('');
        // Reload users list
        await this.loadData();
      } else {
        this.error.set(response.error || 'Fehler beim Generieren des PINs');
      }
    } catch (err) {
      console.error('Generate PIN error:', err);
      this.error.set('Fehler beim Generieren des PINs');
    } finally {
      this.isGenerating.set(false);
    }
  }

  async copyPin() {
    const pin = this.generatedPin();
    if (pin) {
      await navigator.clipboard.writeText(pin);
      this.copiedPin.set(true);
      setTimeout(() => this.copiedPin.set(false), 2000);
    }
  }

  async deleteUser(user: DbUser) {
    if (!confirm(`"${user.name || 'Unbenannt'}" wirklich löschen?`)) return;

    try {
      const response = await this.supabase.deleteUser(user.id);
      if (response.success) {
        await this.loadData();
      } else {
        this.error.set(response.error || 'Fehler beim Löschen');
      }
    } catch (err) {
      console.error('Delete user error:', err);
      this.error.set('Fehler beim Löschen');
    }
  }

  exportEvents() {
    const history = this.storyHistory();
    const exportData = {
      exportedAt: new Date().toISOString(),
      events: history.map((h, i) => ({
        index: i + 1,
        nodeId: h.node.id,
        nodeTitle: h.node.title,
        choiceText: h.choiceText,
        wasRealChoice: h.wasRealChoice
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getRoleBadge(role: string): string {
    switch (role) {
      case 'admin': return '👑 Admin';
      case 'player': return '🎮 Spieler';
      case 'reader': return '📖 Leser';
      default: return role;
    }
  }

  onClose() {
    this.close.emit();
  }
}
