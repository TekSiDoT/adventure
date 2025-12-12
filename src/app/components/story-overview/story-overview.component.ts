import { Component, inject, signal, computed, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoryService } from '../../services/story.service';
import { SupabaseService, DbStoryEvent, DbUser } from '../../services/supabase.service';
import { StoryNode, Choice } from '../../models/story.model';

interface NodeLockStatus {
  id: string;
  is_locked: boolean;
  locked_until: string | null;
}

interface TreeNode {
  node: StoryNode;
  isCurrent: boolean;
  isVisited: boolean;
  isUpcoming: boolean;
  isLocked: boolean;          // True if this node is locked
  children: TreeNode[];
  choicesAvailable: Choice[]; // All choices at this node
  isExplorationHub: boolean;  // True if this node is an exploration hub
}

interface FlatItem {
  type: 'part-header' | 'chapter-header' | 'node';
  treeNode?: TreeNode;
  depth: number;
  isChildOfBranch: boolean;
  teil?: string;
  kapitel?: number;
  chapterKey?: string; // "teil-kapitel" key for grouping
}

interface ReaderLiveStatus {
  name: string;
  nodeId: string;
  nodeTitle: string;
}

@Component({
  selector: 'app-story-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story-overview.component.html',
  styleUrl: './story-overview.component.scss'
})
export class StoryOverviewComponent implements OnInit {
  private storyService = inject(StoryService);
  private supabase = inject(SupabaseService);

  @Output() close = new EventEmitter<void>();

  readonly storyHistory = this.storyService.storyHistory;
  private readonly storyStructure = this.storyService.storyStructure;
  private readonly events = this.storyService.events;

  readerStatuses = signal<ReaderLiveStatus[]>([]);
  isLoading = signal(true);
  expandedPastDecisions = signal<Set<string>>(new Set());

  // Lock management (admin only)
  nodeLockStatus = signal<Map<string, NodeLockStatus>>(new Map());
  isTogglingLock = signal<string | null>(null);

  // Chapter collapse state
  collapsedChapters = signal<Set<string>>(new Set());

  // Admin check
  readonly isAdmin = computed(() => this.supabase.isAdmin());

  // Track the current chapter for auto-collapse
  readonly currentChapterKey = computed(() => {
    const story = this.storyStructure();
    const events = this.playerEvents();
    if (!story || events.length === 0) return null;

    const currentNodeId = events[events.length - 1].node_id;
    const currentNode = story.nodes[currentNodeId];
    if (!currentNode) return null;

    return `${currentNode.teil}-${currentNode.kapitel}`;
  });

  // Player-only events (filtered to exclude admin browsing)
  private playerEvents = signal<DbStoryEvent[]>([]);
  private playerUserId = signal<string | null>(null);
  playerName = signal<string>('Spieler');
  playerCurrentNodeId = signal<string | null>(null);

  // Build full story structure as a tree from start node
  // Simplified: only need Set of visited nodes (order doesn't matter)
  readonly storyTree = computed(() => {
    const story = this.storyStructure();
    const events = this.playerEvents(); // Use player-filtered events only

    if (!story) return [];

    // Simple: just a Set of visited node IDs (order doesn't matter!)
    const visitedIds = new Set(events.map(e => e.node_id));

    // Player's actual position is the last player event's node_id
    const playerCurrentNodeId = events.length > 0 ? events[events.length - 1].node_id : story.currentNode;
    const playerCurrentNode = story.nodes[playerCurrentNodeId];

    // Build full tree recursively - traverse ALL paths
    const buildTree = (nodeId: string, seen: Set<string>): TreeNode | null => {
      if (seen.has(nodeId)) return null;
      seen.add(nodeId);

      const node = story.nodes[nodeId];
      if (!node) return null;

      const isVisited = visitedIds.has(node.id);
      const isCurrent = node.id === playerCurrentNodeId;
      const isUpcoming = !isVisited && !isCurrent && (playerCurrentNode?.choices.some(c => c.nextNode === node.id) ?? false);

      // Build ALL children (full story tree)
      const children: TreeNode[] = [];
      for (const choice of node.choices) {
        const childNode = buildTree(choice.nextNode, new Set(seen));
        if (childNode) children.push(childNode);
      }

      // For exploration hubs, also follow the summaryNodeId path
      if (node.explorationHub?.summaryNodeId) {
        const summaryNode = buildTree(node.explorationHub.summaryNodeId, new Set(seen));
        if (summaryNode) children.push(summaryNode);
      }

      return {
        node,
        isCurrent,
        isVisited,
        isUpcoming,
        isLocked: false, // Lock status is checked dynamically via isNodeLocked()
        children,
        choicesAvailable: node.choices,
        isExplorationHub: !!node.explorationHub
      };
    };

    const root = buildTree(story.currentNode, new Set());
    return root ? [root] : [];
  });

  // Flatten tree for display with smart expand/collapse and chapter grouping
  // Simplified: always show ALL branches (visited ones are marked with checkmarks)
  readonly flattenedTree = computed(() => {
    const tree = this.storyTree();
    const collapsedChapters = this.collapsedChapters();
    const result: FlatItem[] = [];
    // Track which headers have been shown to avoid duplicates
    const shownParts = new Set<string>();
    const shownChapters = new Set<string>(); // key: "teil-kapitel"

    const flatten = (nodes: TreeNode[], depth: number, isChildOfBranch: boolean, currentChapter: string | null) => {
      for (const treeNode of nodes) {
        const node = treeNode.node;
        const hasBranch = treeNode.choicesAvailable.length > 1;
        const isHub = treeNode.isExplorationHub;

        // Add part header if not shown yet
        if (node.teil && !shownParts.has(node.teil)) {
          shownParts.add(node.teil);
          result.push({
            type: 'part-header',
            depth: 0,
            isChildOfBranch: false,
            teil: node.teil
          });
        }

        // Add chapter header if not shown yet
        const chapterKey = `${node.teil}-${node.kapitel}`;
        if (node.kapitel && !shownChapters.has(chapterKey)) {
          shownChapters.add(chapterKey);
          result.push({
            type: 'chapter-header',
            depth: 0,
            isChildOfBranch: false,
            teil: node.teil,
            kapitel: node.kapitel,
            chapterKey
          });
        }

        // Check if this chapter is collapsed
        const isChapterCollapsed = collapsedChapters.has(chapterKey);

        // Only add the node if its chapter is not collapsed
        if (!isChapterCollapsed) {
          result.push({ type: 'node', treeNode, depth, isChildOfBranch, chapterKey });
        }

        // Determine how to recurse into children
        const isPastHub = isHub && treeNode.isVisited && !treeNode.isCurrent;
        const isPastDecision = hasBranch && !isHub && treeNode.isVisited && !treeNode.isCurrent;

        if (isPastHub) {
          // Past exploration hub: follow to summary node only
          const summaryChild = treeNode.children.find(
            child => child.node.id === treeNode.node.explorationHub?.summaryNodeId
          );
          if (summaryChild) {
            flatten([summaryChild], depth, false, chapterKey);
          }
        } else if (isPastDecision) {
          // Past decision: only follow visited children (collapsed view)
          const visitedChildren = treeNode.children.filter(child => child.isVisited);
          if (visitedChildren.length > 0) {
            flatten(visitedChildren, depth, false, chapterKey);
          }
        } else if (hasBranch || isHub) {
          // Current/future branch or hub: show all children indented
          flatten(treeNode.children, depth + 1, true, chapterKey);
        } else {
          // Linear node: continue at same depth
          flatten(treeNode.children, depth, false, chapterKey);
        }
      }
    };

    flatten(tree, 0, false, null);
    return result;
  });

  async ngOnInit(): Promise<void> {
    // Ensure story is loaded from database (has chapter data)
    await this.storyService.ensureStoryFromDb();

    // Ensure story events are loaded (may not be loaded yet for admin)
    await this.storyService.refreshState();
    await this.loadPlayerEvents();
    await this.loadReaderStatuses();

    // Load lock status for admin
    if (this.supabase.isAdmin()) {
      await this.loadLockStatus();
    }

    this.isLoading.set(false);
  }

  /**
   * Load events filtered to only show player actions (not admin browsing)
   */
  private async loadPlayerEvents(): Promise<void> {
    // Get all users to find the player
    const usersResponse = await this.supabase.getUsers();
    if (!usersResponse.success || !usersResponse.users) return;

    // Find the user with role='player' (the actual protagonist)
    const playerUser = usersResponse.users.find(u => u.role === 'player');
    if (playerUser) {
      this.playerUserId.set(playerUser.id);
      this.playerName.set(playerUser.name || 'Spieler');

      // Filter events to only include those created by the player
      const allEvents = this.events();
      const filteredEvents = allEvents.filter(e => e.created_by === playerUser.id);
      this.playerEvents.set(filteredEvents);

      // Track player's current position (last event)
      if (filteredEvents.length > 0) {
        this.playerCurrentNodeId.set(filteredEvents[filteredEvents.length - 1].node_id);
      }
    } else {
      // Fallback: if no dedicated player, use all events (for backward compatibility)
      this.playerEvents.set(this.events());
    }
  }

  /**
   * Check if the player is at a specific node
   */
  isPlayerAtNode(nodeId: string): boolean {
    return this.playerCurrentNodeId() === nodeId;
  }

  async loadReaderStatuses(): Promise<void> {
    const storyMeta = this.supabase.story();
    if (!storyMeta) return;

    const positions = await this.supabase.getReaderPositions(storyMeta.id);
    const events = this.playerEvents(); // Use player events for reader position mapping
    const story = this.storyStructure();

    if (!story) return;

    // Map reader positions to their current node using player events (database records)
    const statuses: ReaderLiveStatus[] = positions.map(pos => {
      // Get node from player events at reader's position (historyIndex maps to events array)
      const event = events[pos.historyIndex];
      const nodeId = event?.node_id || story.currentNode;
      const node = story.nodes[nodeId];

      return {
        name: pos.name,
        nodeId,
        nodeTitle: node?.title || nodeId
      };
    });

    this.readerStatuses.set(statuses);
  }

  // Get readers at a specific node
  getReadersAtNode(nodeId: string): string[] {
    return this.readerStatuses()
      .filter(s => s.nodeId === nodeId)
      .map(s => s.name);
  }

  togglePastDecision(nodeId: string): void {
    const current = this.expandedPastDecisions();
    const newSet = new Set(current);
    if (newSet.has(nodeId)) {
      newSet.delete(nodeId);
    } else {
      newSet.add(nodeId);
    }
    this.expandedPastDecisions.set(newSet);
  }

  isPastDecisionExpanded(nodeId: string): boolean {
    return this.expandedPastDecisions().has(nodeId);
  }

  isPastDecision(treeNode: TreeNode): boolean {
    // A past decision is a branch point (multiple choices) that was visited
    return treeNode.choicesAvailable.length > 1 &&
           !treeNode.isExplorationHub &&
           treeNode.isVisited &&
           !treeNode.isCurrent;
  }

  isPastExplorationHub(treeNode: TreeNode): boolean {
    return treeNode.isExplorationHub &&
           treeNode.isVisited &&
           !treeNode.isCurrent;
  }

  getExplorationNodes(treeNode: TreeNode): { nodeId: string; title: string; visited: boolean }[] {
    const hub = treeNode.node.explorationHub;
    if (!hub) return [];

    const story = this.storyStructure();
    if (!story) return [];

    return hub.requiredNodes.map(nodeId => {
      const node = story.nodes[nodeId];
      // Check if this exploration node was visited by looking at player events
      const events = this.playerEvents();
      const visited = events.some(e => e.node_id === nodeId);
      return {
        nodeId,
        title: node?.title || nodeId,
        visited
      };
    });
  }

  // Get the choice text that leads to this node (from parent's choices)
  getChoiceTextForNode(treeNode: TreeNode): string {
    // Find parent node that has a choice leading to this node
    const story = this.storyStructure();
    if (!story) return '';

    for (const node of Object.values(story.nodes)) {
      const choice = node.choices.find(c => c.nextNode === treeNode.node.id);
      if (choice) {
        return choice.text;
      }
    }
    return '';
  }

  // Check if a node was visited (used for displaying visited status on choices)
  isNodeVisited(nodeId: string): boolean {
    const events = this.playerEvents();
    return events.some(e => e.node_id === nodeId);
  }

  onNodeClick(nodeId: string): void {
    this.storyService.navigateToNode(nodeId);
    this.close.emit();
  }

  onClose(): void {
    this.close.emit();
  }

  // ==========================================
  // Lock Management (Admin only)
  // ==========================================

  async loadLockStatus(): Promise<void> {
    const story = this.supabase.story();
    if (!story) return;

    const nodes = await this.supabase.getAllNodesLockStatus(story.id);
    const lockMap = new Map<string, NodeLockStatus>();
    for (const node of nodes) {
      lockMap.set(node.id, {
        id: node.id,
        is_locked: node.is_locked,
        locked_until: node.locked_until
      });
    }
    this.nodeLockStatus.set(lockMap);
  }

  isNodeLocked(nodeId: string): boolean {
    const lockStatus = this.nodeLockStatus().get(nodeId);
    if (!lockStatus) return false;
    if (lockStatus.is_locked) return true;
    if (lockStatus.locked_until) {
      return new Date(lockStatus.locked_until) > new Date();
    }
    return false;
  }

  async toggleNodeLock(nodeId: string): Promise<void> {
    const story = this.supabase.story();
    if (!story) return;

    this.isTogglingLock.set(nodeId);

    try {
      const currentlyLocked = this.isNodeLocked(nodeId);
      const result = await this.supabase.setNodeLock(story.id, nodeId, !currentlyLocked);

      if (result.success) {
        await this.loadLockStatus();
      }
    } finally {
      this.isTogglingLock.set(null);
    }
  }

  // ==========================================
  // Chapter Collapse Management
  // ==========================================

  /**
   * Initialize collapsed chapters - collapse all chapters before the current one
   */
  initializeCollapsedChapters(): void {
    const story = this.storyStructure();
    const currentKey = this.currentChapterKey();
    if (!story || !currentKey) return;

    // Collect all chapter keys that appear before the current chapter
    const collapsedSet = new Set<string>();
    const allChapterKeys: string[] = [];

    // Build ordered list of chapters by traversing story tree
    const visitedChapters = new Set<string>();
    const collectChapters = (nodeId: string, seen: Set<string>) => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);

      const node = story.nodes[nodeId];
      if (!node) return;

      const chapterKey = `${node.teil}-${node.kapitel}`;
      if (!visitedChapters.has(chapterKey)) {
        visitedChapters.add(chapterKey);
        allChapterKeys.push(chapterKey);
      }

      for (const choice of node.choices) {
        collectChapters(choice.nextNode, new Set(seen));
      }
      if (node.explorationHub?.summaryNodeId) {
        collectChapters(node.explorationHub.summaryNodeId, new Set(seen));
      }
    };

    collectChapters(story.currentNode, new Set());

    // Mark all chapters before current as collapsed
    for (const key of allChapterKeys) {
      if (key === currentKey) break;
      collapsedSet.add(key);
    }

    this.collapsedChapters.set(collapsedSet);
  }

  toggleChapter(chapterKey: string): void {
    const current = this.collapsedChapters();
    const newSet = new Set(current);
    if (newSet.has(chapterKey)) {
      newSet.delete(chapterKey);
    } else {
      newSet.add(chapterKey);
    }
    this.collapsedChapters.set(newSet);
  }

  isChapterCollapsed(chapterKey: string): boolean {
    return this.collapsedChapters().has(chapterKey);
  }

  expandAllChapters(): void {
    this.collapsedChapters.set(new Set());
  }

  collapseAllChapters(): void {
    // Collect all chapter keys
    const story = this.storyStructure();
    if (!story) return;

    const allKeys = new Set<string>();
    for (const node of Object.values(story.nodes)) {
      if (node.kapitel) {
        allKeys.add(`${node.teil}-${node.kapitel}`);
      }
    }
    this.collapsedChapters.set(allKeys);
  }

  hasCollapsedChapters(): boolean {
    return this.collapsedChapters().size > 0;
  }
}
