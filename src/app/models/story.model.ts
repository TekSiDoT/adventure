export interface Choice {
  id: string;
  text: string;
  nextNode: string;
}

export interface Media {
  image: string | null;
  audio: string | null;
}

export interface StoryNode {
  id: string;
  title?: string;
  text: string;
  media?: Media;
  choices: Choice[];
  pending?: boolean;
}

export interface Story {
  currentNode: string;
  pin: string;
  readerPin?: string;
  nodes: Record<string, StoryNode>;
}
