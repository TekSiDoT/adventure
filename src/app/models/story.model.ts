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
}

export interface Story {
  currentNode: string;
  pin: string;
  readerPin?: string;
  nodes: Record<string, StoryNode>;
  items?: Record<string, InventoryItem>;  // Catalog of all collectible items
}
