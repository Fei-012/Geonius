export type MindmapNode = {
  id: string;
  parentId: string | null;
  text: string;
  order: number;
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
  version: number;
  nodes: Record<string, MindmapNode>;
  updatedAt: number;
};

export type Presence = {
  socketId: string;
  name: string;
  color: string;
  selectedNodeId: string | null;
};

export type MindmapOperation =
  | {
      type: "document/set";
      document: MindmapDocument;
    }
  | {
      type: "title/set";
      title: string;
    }
  | {
      type: "node/upsert";
      node: MindmapNode;
    }
  | {
      type: "node/update";
      nodeId: string;
      changes: Partial<Omit<MindmapNode, "id" | "createdAt">>;
    }
  | {
      type: "node/remove";
      nodeId: string;
    }
  | {
      type: "nodes/reorder";
      parentId: string | null;
      orderedIds: string[];
    }
  | {
      type: "nodes/arrange";
      focusNodeId?: string;
    };
