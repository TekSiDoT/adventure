import { Component, inject, signal, computed, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoryService } from '../../services/story.service';
import { SupabaseService, DbStoryEvent, DbUser } from '../../services/supabase.service';
import { StoryNode, Choice } from '../../models/story.model';

interface TreeNode {
  node: StoryNode;
  isCurrent: boolean;
  isVisited: boolean;
  isUpcoming: boolean;
  children: TreeNode[];
  choiceMade?: Choice;        // The choice that was taken (if visited)
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

  // Player-only events (filtered to exclude admin browsing)
  private playerEvents = signal<DbStoryEvent[]>([]);
  private playerUserId = signal<string | null>(null);
  playerName = signal<string>('Spieler');
  playerCurrentNodeId = signal<string | null>(null);

  // Build full story structure as a tree from start node
  readonly storyTree = computed(() => {
    const story = this.storyStructure();
    const events = this.playerEvents(); // Use player-filtered events only

    if (!story) return [];

    // Get visited node IDs from player events only (in order)
    const visitedIds = new Set(events.map(e => e.node_id));
    const visitOrder = events.map(e => e.node_id);

    // Player's actual position is the last player event's node_id
    const playerCurrentNodeId = events.length > 0 ? events[events.length - 1].node_id : story.currentNode;
    const playerCurrentNode = story.nodes[playerCurrentNodeId];

    // Build a map of which next node was visited from each node
    const nextNodeVisited = new Map<string, string>();
    for (let i = 0; i < visitOrder.length - 1; i++) {
      nextNodeVisited.set(visitOrder[i], visitOrder[i + 1]);
    }

    // Build full tree recursively - traverse ALL paths
    const buildTree = (nodeId: string, seen: Set<string>): TreeNode | null => {
      if (seen.has(nodeId)) return null;
      seen.add(nodeId);

      const node = story.nodes[nodeId];
      if (!node) return null;

      const isVisited = visitedIds.has(node.id);
      const isCurrent = node.id === playerCurrentNodeId;
      const isUpcoming = !isVisited && !isCurrent && (playerCurrentNode?.choices.some(c => c.nextNode === node.id) ?? false);

      // Find which choice was made by looking at what node was visited next
      const nextVisited = nextNodeVisited.get(node.id);
      const choiceMade = node.choices.find(c => c.nextNode === nextVisited);

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
        children,
        choiceMade,
        choicesAvailable: node.choices,
        isExplorationHub: !!node.explorationHub
      };
    };

    const root = buildTree(story.currentNode, new Set());
    return root ? [root] : [];
  });

  // Flatten tree for display with smart expand/collapse and chapter grouping
  readonly flattenedTree = computed(() => {
    const tree = this.storyTree();
    const result: FlatItem[] = [];
    // Track which headers have been shown to avoid duplicates
    const shownParts = new Set<string>();
    const shownChapters = new Set<string>(); // key: "teil-kapitel"

    const flatten = (nodes: TreeNode[], depth: number, isChildOfBranch: boolean) => {
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
            kapitel: node.kapitel
          });
        }

        // Exploration hubs: expanded if current, collapsed if past (visited)
        // Normal branches: collapsed if past, expanded if current/future
        const isPastDecision = hasBranch && !isHub && treeNode.isVisited && !treeNode.isCurrent;
        const isPastHub = isHub && treeNode.isVisited && !treeNode.isCurrent;
        const shouldExpand = (isHub && !isPastHub) || (hasBranch && !isPastDecision);

        result.push({ type: 'node', treeNode, depth, isChildOfBranch });

        if (isPastDecision) {
          // Past decision: collapsed - only follow the path that was taken
          // Find the child that matches the choice made
          const takenChild = treeNode.children.find(
            child => child.node.id === treeNode.choiceMade?.nextNode
          );
          if (takenChild) {
            flatten([takenChild], depth, false);
          }
        } else if (isPastHub) {
          // Past exploration hub: collapsed - follow path to summary
          // Find the summary node child (last child typically)
          const summaryChild = treeNode.children.find(
            child => child.node.id === treeNode.node.explorationHub?.summaryNodeId
          );
          if (summaryChild) {
            flatten([summaryChild], depth, false);
          }
        } else if (shouldExpand) {
          // Current exploration hub or current/future decision: expanded
          flatten(treeNode.children, depth + 1, true);
        } else {
          // Linear node: continue at same depth
          flatten(treeNode.children, depth, false);
        }
      }
    };

    flatten(tree, 0, false);
    return result;
  });

  async ngOnInit(): Promise<void> {
    // Ensure story events are loaded (may not be loaded yet for admin)
    await this.storyService.refreshState();
    await this.loadPlayerEvents();
    await this.loadReaderStatuses();
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
    return treeNode.choicesAvailable.length > 1 &&
           !treeNode.isExplorationHub &&
           treeNode.isVisited &&
           !treeNode.isCurrent &&
           !!treeNode.choiceMade;
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

  onNodeClick(nodeId: string): void {
    this.storyService.navigateToNode(nodeId);
    this.close.emit();
  }

  onClose(): void {
    this.close.emit();
  }
}
