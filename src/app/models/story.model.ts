export interface Choice {
  id: string;
  text: string;
  nextNode: string;
  grantsItems?: string[];  // Item IDs granted when selecting this choice
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
}

export interface Story {
  currentNode: string;
  pin: string;
  readerPin?: string;
  nodes: Record<string, StoryNode>;
  items?: Record<string, InventoryItem>;  // Catalog of all collectible items
}
