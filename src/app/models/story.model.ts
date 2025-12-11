export interface Choice {
  id: string;
  text: string;
  nextNode: string;
  grantsItems?: string[];  // Item IDs granted when selecting this choice
  returnsTo?: string;  // After visiting nextNode, return to this node (for exploration hubs)
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  image?: string;
}

export interface Media {
  image: string | null;
  imagePosition?: 'top' | 'middle' | 'bottom';
  audio: string | null;
}

export interface OpenQuestion {
  prompt: string;
}

export interface ExplorationHub {
  requiredNodes: string[];  // Node IDs that must be visited before proceeding
  summaryNodeId: string;    // Node ID to navigate to when all required nodes visited
}

export interface StoryNode {
  id: string;
  title?: string;
  text: string;
  media?: Media;
  choices: Choice[];
  openQuestion?: OpenQuestion;
  pending?: boolean;
  teaser?: string; // Preview sentence shown on pending page, e.g. "Odo entschliesst sich weiter zu gehen..."
  grantsItems?: string[];  // Item IDs granted when visiting this node
  explorationHub?: ExplorationHub;  // If set, this node is an exploration hub
  mistRevealText?: string;  // Elvish text to show with mist reveal animation
  // Hierarchy fields
  akt?: number;     // Act number (e.g., 1)
  teil?: string;    // Part name (e.g., "Prolog")
  kapitel?: number; // Chapter number within the part (e.g., 1, 2, 3)
}

export interface Story {
  currentNode: string;
  nodes: Record<string, StoryNode>;
  items?: Record<string, InventoryItem>;  // Catalog of all collectible items
}

// Database types (from Supabase)
export interface User {
  id: string;
  role: 'player' | 'reader' | 'admin';
  name?: string;
  currentStoryId?: string;
  lastActive?: string;
  pin?: string;  // Only visible in admin context
}

export interface StoryEvent {
  id: number;
  storyId: string;
  nodeId: string;
  choiceId?: string;
  choiceText?: string;
  answer?: string;
  collectedItems?: string[];
  createdAt: string;
  createdBy?: string;
}

export interface StoryState {
  storyId: string;
  currentNodeId: string;
  collectedItems: string[];
  updatedAt: string;
}

export interface StoryMeta {
  id: string;
  title: string;
  slug: string;
}
