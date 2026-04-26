export type MindmapNode = {
  id: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  color: string;
  collapsed: boolean;
  image?: string;
  createdAt: number;
  updatedAt: number;
};

export type MindmapDocument = {
  id: string;
  title: string;
  nodes: Record<string, MindmapNode>;
  updatedAt: number;
};

export type Presence = {
  socketId: string;
  name: string;
  color: string;
  selectedNodeId: string | null;
};
