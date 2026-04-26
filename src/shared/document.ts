import type { MindmapDocument, MindmapNode } from "./types";

const ROOT_ID = "root";

export const rootId = ROOT_ID;

export function createNode(partial: Partial<MindmapNode> & Pick<MindmapNode, "id" | "text">): MindmapNode {
  const now = Date.now();

  return {
    parentId: null,
    x: 0,
    y: 0,
    color: "#f97316",
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

export function createInitialDocument(): MindmapDocument {
  const root = createNode({
    id: ROOT_ID,
    text: "Geonius",
    x: 0,
    y: 0,
    color: "#0f766e"
  });

  const strategy = createNode({
    id: cryptoSafeId(),
    text: "Strategy",
    parentId: ROOT_ID,
    x: 280,
    y: -140,
    color: "#f97316"
  });

  const execution = createNode({
    id: cryptoSafeId(),
    text: "Execution",
    parentId: ROOT_ID,
    x: 280,
    y: 20,
    color: "#2563eb"
  });

  const assets = createNode({
    id: cryptoSafeId(),
    text: "Images",
    parentId: ROOT_ID,
    x: 280,
    y: 180,
    color: "#9333ea"
  });

  return {
    id: "default-room",
    title: "Live Collaborative Mindmap",
    nodes: {
      [root.id]: root,
      [strategy.id]: strategy,
      [execution.id]: execution,
      [assets.id]: assets
    },
    updatedAt: Date.now()
  };
}

export function getChildren(document: MindmapDocument, parentId: string): MindmapNode[] {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.y - b.y);
}

export function getDescendantIds(document: MindmapDocument, nodeId: string): string[] {
  const descendants: string[] = [];
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const children = getChildren(document, current);
    for (const child of children) {
      descendants.push(child.id);
      stack.push(child.id);
    }
  }

  return descendants;
}

export function removeNode(document: MindmapDocument, nodeId: string): MindmapDocument {
  if (nodeId === ROOT_ID) {
    return document;
  }

  const nextNodes = { ...document.nodes };
  const toDelete = [nodeId, ...getDescendantIds(document, nodeId)];

  for (const id of toDelete) {
    delete nextNodes[id];
  }

  return {
    ...document,
    nodes: nextNodes,
    updatedAt: Date.now()
  };
}

export function cryptoSafeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `node-${Math.random().toString(36).slice(2, 10)}`;
}
