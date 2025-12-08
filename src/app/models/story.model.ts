export interface Choice {
  id: string;
  text: string;
  nextNode: string;
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
}

export interface Story {
  currentNode: string;
  pin: string;
  readerPin?: string;
  nodes: Record<string, StoryNode>;
}
