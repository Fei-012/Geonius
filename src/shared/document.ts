import type { MindmapDocument, MindmapNode, MindmapOperation } from "./types";

const ROOT_ID = "root";
const ROOT_SPACING_X = 320;
const CHILD_SPACING_X = 240;
const SIBLING_SPACING_Y = 132;

export const rootId = ROOT_ID;

export function createNode(partial: Partial<MindmapNode> & Pick<MindmapNode, "id" | "text">): MindmapNode {
  const now = Date.now();

  return {
    parentId: null,
    order: 0,
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
    order: 0,
    color: "#f97316"
  });

  const execution = createNode({
    id: cryptoSafeId(),
    text: "Execution",
    parentId: ROOT_ID,
    order: 1,
    color: "#2563eb"
  });

  const assets = createNode({
    id: cryptoSafeId(),
    text: "Images",
    parentId: ROOT_ID,
    order: 2,
    color: "#9333ea"
  });

  return arrangeDocument({
    id: "default-room",
    title: "Live Collaborative Mindmap",
    version: 1,
    nodes: {
      [root.id]: root,
      [strategy.id]: strategy,
      [execution.id]: execution,
      [assets.id]: assets
    },
    updatedAt: Date.now()
  });
}

export function getChildren(document: MindmapDocument, parentId: string): MindmapNode[] {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.y - b.y);
}

export function getSiblingIds(document: MindmapDocument, parentId: string | null): string[] {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.y - b.y)
    .map((node) => node.id);
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

export function normalizeSiblingOrder(document: MindmapDocument, parentId: string | null): MindmapDocument {
  const orderedIds = getSiblingIds(document, parentId);
  const nextNodes = { ...document.nodes };

  orderedIds.forEach((id, index) => {
    nextNodes[id] = {
      ...nextNodes[id],
      order: index,
      updatedAt: Date.now()
    };
  });

  return {
    ...document,
    nodes: nextNodes,
    updatedAt: Date.now()
  };
}

export function reorderSiblings(document: MindmapDocument, parentId: string | null, orderedIds: string[]): MindmapDocument {
  const nextNodes = { ...document.nodes };

  orderedIds.forEach((id, index) => {
    const current = nextNodes[id];
    if (!current || current.parentId !== parentId) {
      return;
    }

    nextNodes[id] = {
      ...current,
      order: index,
      updatedAt: Date.now()
    };
  });

  return {
    ...document,
    nodes: nextNodes,
    updatedAt: Date.now()
  };
}

export function removeNode(document: MindmapDocument, nodeId: string): MindmapDocument {
  if (nodeId === ROOT_ID) {
    return document;
  }

  const parentId = document.nodes[nodeId]?.parentId ?? null;
  const nextNodes = { ...document.nodes };
  const toDelete = [nodeId, ...getDescendantIds(document, nodeId)];

  for (const id of toDelete) {
    delete nextNodes[id];
  }

  const nextDocument = {
    ...document,
    nodes: nextNodes,
    updatedAt: Date.now()
  };

  return arrangeDocument(normalizeSiblingOrder(nextDocument, parentId));
}

export function updateNode(document: MindmapDocument, nodeId: string, changes: Partial<Omit<MindmapNode, "id" | "createdAt">>) {
  const current = document.nodes[nodeId];
  if (!current) {
    return document;
  }

  return {
    ...document,
    nodes: {
      ...document.nodes,
      [nodeId]: {
        ...current,
        ...changes,
        updatedAt: Date.now()
      }
    },
    updatedAt: Date.now()
  };
}

export function upsertNode(document: MindmapDocument, node: MindmapNode): MindmapDocument {
  const nextDocument = {
    ...document,
    nodes: {
      ...document.nodes,
      [node.id]: {
        ...node,
        updatedAt: Date.now()
      }
    },
    updatedAt: Date.now()
  };

  return normalizeSiblingOrder(nextDocument, node.parentId);
}

export function arrangeDocument(document: MindmapDocument, focusNodeId = ROOT_ID): MindmapDocument {
  if (!document.nodes[ROOT_ID]) {
    return document;
  }

  const nextNodes = { ...document.nodes };
  const anchor = nextNodes[ROOT_ID];
  nextNodes[ROOT_ID] = {
    ...anchor,
    x: 0,
    y: 0
  };

  function subtreeHeight(nodeId: string): number {
    const node = nextNodes[nodeId];
    if (!node || node.collapsed) {
      return 1;
    }

    const children = getChildren({ ...document, nodes: nextNodes }, nodeId);
    if (children.length === 0) {
      return 1;
    }

    return Math.max(
      1,
      children.reduce((sum, child) => sum + subtreeHeight(child.id), 0)
    );
  }

  function placeChildren(parentId: string, startY: number) {
    const parent = nextNodes[parentId];
    const children = getChildren({ ...document, nodes: nextNodes }, parentId);
    if (!parent || children.length === 0) {
      return;
    }

    const totalHeight = children.reduce((sum, child) => sum + subtreeHeight(child.id), 0);
    let cursor = startY - ((totalHeight - 1) * SIBLING_SPACING_Y) / 2;

    children.forEach((child) => {
      const heightUnits = subtreeHeight(child.id);
      const branchCenterY = cursor + ((heightUnits - 1) * SIBLING_SPACING_Y) / 2;
      const spacingX = parentId === ROOT_ID ? ROOT_SPACING_X : CHILD_SPACING_X;

      nextNodes[child.id] = {
        ...nextNodes[child.id],
        x: parent.x + spacingX,
        y: branchCenterY
      };

      placeChildren(child.id, branchCenterY);
      cursor += heightUnits * SIBLING_SPACING_Y;
    });
  }

  placeChildren(ROOT_ID, nextNodes[ROOT_ID].y);

  if (focusNodeId !== ROOT_ID && nextNodes[focusNodeId]) {
    const offsetY = document.nodes[focusNodeId]?.y ?? nextNodes[focusNodeId].y;
    const nextY = nextNodes[focusNodeId].y;
    const drift = offsetY - nextY;

    if (Math.abs(drift) > 0.5) {
      for (const node of Object.values(nextNodes)) {
        if (node.id === ROOT_ID) {
          continue;
        }

        nextNodes[node.id] = {
          ...node,
          y: node.y + drift
        };
      }
    }
  }

  return {
    ...document,
    nodes: nextNodes,
    updatedAt: Date.now()
  };
}

export function applyOperation(document: MindmapDocument, operation: MindmapOperation): MindmapDocument {
  switch (operation.type) {
    case "document/set":
      return {
        ...operation.document,
        version: document.version + 1,
        updatedAt: Date.now()
      };
    case "title/set":
      return {
        ...document,
        title: operation.title,
        version: document.version + 1,
        updatedAt: Date.now()
      };
    case "node/upsert":
      return {
        ...arrangeDocument(upsertNode(document, operation.node), operation.node.parentId ?? ROOT_ID),
        version: document.version + 1
      };
    case "node/update":
      return {
        ...updateNode(document, operation.nodeId, operation.changes),
        version: document.version + 1
      };
    case "node/remove":
      return {
        ...removeNode(document, operation.nodeId),
        version: document.version + 1
      };
    case "nodes/reorder":
      return {
        ...arrangeDocument(reorderSiblings(document, operation.parentId, operation.orderedIds), operation.parentId ?? ROOT_ID),
        version: document.version + 1
      };
    case "nodes/arrange":
      return {
        ...arrangeDocument(document, operation.focusNodeId),
        version: document.version + 1
      };
    default:
      return document;
  }
}

export function applyOperations(document: MindmapDocument, operations: MindmapOperation[]): MindmapDocument {
  return operations.reduce((current, operation) => applyOperation(current, operation), document);
}

export function cryptoSafeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `node-${Math.random().toString(36).slice(2, 10)}`;
}
