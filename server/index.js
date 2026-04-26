import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const workspaceFile = path.join(dataDir, "workspace.json");
const legacyDocumentFile = path.join(dataDir, "document.json");
const port = Number(process.env.PORT || 3001);
const host = "0.0.0.0";
const clients = new Map();

function now() {
  return Date.now();
}

function uid(prefix) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createNode(partial) {
  const stamp = now();
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    text: partial.text,
    order: partial.order ?? 0,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 220,
    height: partial.height ?? (partial.image ? 220 : 72),
    color: partial.color ?? "#111827",
    collapsed: partial.collapsed ?? false,
    image: partial.image,
    createdAt: partial.createdAt ?? stamp,
    updatedAt: stamp
  };
}

function getChildren(document, parentId) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.y - b.y);
}

function normalizeSiblingOrder(document, parentId) {
  const ordered = getChildren(document, parentId).map((node) => node.id);
  const nodes = { ...document.nodes };
  ordered.forEach((id, index) => {
    nodes[id] = { ...nodes[id], order: index, updatedAt: now() };
  });
  return { ...document, nodes, updatedAt: now() };
}

function getDescendantIds(document, nodeId) {
  const found = [];
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const child of getChildren(document, current)) {
      found.push(child.id);
      stack.push(child.id);
    }
  }
  return found;
}

function arrangeDocument(document, focusNodeId = "root") {
  if (!document.nodes.root) {
    return document;
  }

  const nodes = { ...document.nodes };
  nodes.root = { ...nodes.root, x: 0, y: 0 };

  const rootSpacingX = 340;
  const childSpacingX = 250;
  const siblingSpacingY = 124;

  function subtreeHeight(nodeId) {
    const node = nodes[nodeId];
    if (!node || node.collapsed) {
      return 1;
    }

    const children = getChildren({ ...document, nodes }, nodeId);
    if (children.length === 0) {
      return 1;
    }

    return Math.max(1, children.reduce((sum, child) => sum + subtreeHeight(child.id), 0));
  }

  function placeChildren(parentId, startY) {
    const parent = nodes[parentId];
    const children = getChildren({ ...document, nodes }, parentId);
    if (!parent || children.length === 0) {
      return;
    }

    const totalUnits = children.reduce((sum, child) => sum + subtreeHeight(child.id), 0);
    let cursor = startY - ((totalUnits - 1) * siblingSpacingY) / 2;

    for (const child of children) {
      const units = subtreeHeight(child.id);
      const branchCenterY = cursor + ((units - 1) * siblingSpacingY) / 2;
      const xShift = parentId === "root" ? rootSpacingX : childSpacingX;

      nodes[child.id] = {
        ...nodes[child.id],
        x: parent.x + xShift,
        y: branchCenterY
      };

      placeChildren(child.id, branchCenterY);
      cursor += units * siblingSpacingY;
    }
  }

  placeChildren("root", 0);

  if (focusNodeId !== "root" && nodes[focusNodeId] && document.nodes[focusNodeId]) {
    const drift = document.nodes[focusNodeId].y - nodes[focusNodeId].y;
    if (Math.abs(drift) > 0.5) {
      Object.values(nodes).forEach((node) => {
        if (node.id === "root") {
          return;
        }
        nodes[node.id] = { ...node, y: node.y + drift };
      });
    }
  }

  return {
    ...document,
    nodes,
    updatedAt: now()
  };
}

function createSampleDocument(title) {
  const root = createNode({
    id: "root",
    text: title,
    color: "#111111"
  });
  const stewardship = createNode({
    id: uid("node"),
    parentId: "root",
    text: "Stewardship",
    order: 0,
    color: "#d1d5db"
  });
  const possibilities = createNode({
    id: uid("node"),
    parentId: "root",
    text: "Resource possibilities",
    order: 1,
    color: "#d1d5db"
  });
  const optimistic = createNode({
    id: uid("node"),
    parentId: possibilities.id,
    text: "Optimistic view",
    order: 0,
    color: "#ffffff"
  });
  const balanced = createNode({
    id: uid("node"),
    parentId: possibilities.id,
    text: "Balanced view",
    order: 1,
    color: "#ffffff"
  });

  return arrangeDocument({
    id: uid("doc"),
    title,
    nodes: {
      root,
      [stewardship.id]: stewardship,
      [possibilities.id]: possibilities,
      [optimistic.id]: optimistic,
      [balanced.id]: balanced
    },
    updatedAt: now()
  });
}

function createInitialWorkspace() {
  const folderId = uid("folder");
  const noteId = uid("note");
  return {
    id: "shared-workspace",
    title: "Geonius",
    version: 1,
    folders: [
      {
        id: folderId,
        name: "Geography",
        noteIds: [noteId],
        createdAt: now(),
        updatedAt: now()
      }
    ],
    notes: {
      [noteId]: {
        id: noteId,
        folderId,
        title: "3.3 Resource Stewardship",
        document: createSampleDocument("3.3 Resource Stewardship"),
        createdAt: now(),
        updatedAt: now()
      }
    },
    updatedAt: now()
  };
}

function migrateLegacyIfNeeded(raw) {
  if (raw && raw.notes && raw.folders) {
    return raw;
  }

  if (raw && raw.nodes) {
    const folderId = uid("folder");
    const noteId = uid("note");
    return {
      id: "shared-workspace",
      title: "Geonius",
      version: raw.version ?? 1,
      folders: [
        {
          id: folderId,
          name: "My documents",
          noteIds: [noteId],
          createdAt: now(),
          updatedAt: now()
        }
      ],
      notes: {
        [noteId]: {
          id: noteId,
          folderId,
          title: raw.title || "Untitled note",
          document: raw,
          createdAt: now(),
          updatedAt: now()
        }
      },
      updatedAt: now()
    };
  }

  return createInitialWorkspace();
}

function ensureWorkspaceFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(workspaceFile)) {
    return;
  }

  if (fs.existsSync(legacyDocumentFile)) {
    const migrated = migrateLegacyIfNeeded(JSON.parse(fs.readFileSync(legacyDocumentFile, "utf8")));
    fs.writeFileSync(workspaceFile, JSON.stringify(migrated, null, 2));
    return;
  }

  fs.writeFileSync(workspaceFile, JSON.stringify(createInitialWorkspace(), null, 2));
}

function loadWorkspace() {
  ensureWorkspaceFile();
  return migrateLegacyIfNeeded(JSON.parse(fs.readFileSync(workspaceFile, "utf8")));
}

function saveWorkspace(workspace) {
  fs.writeFileSync(workspaceFile, JSON.stringify(workspace, null, 2));
}

function withNote(workspace, noteId, updater) {
  const note = workspace.notes[noteId];
  if (!note) {
    return workspace;
  }

  const nextNote = updater(note);
  return {
    ...workspace,
    notes: {
      ...workspace.notes,
      [noteId]: {
        ...nextNote,
        updatedAt: now()
      }
    },
    updatedAt: now()
  };
}

function applyDocumentOperation(document, operation) {
  switch (operation.type) {
    case "document/title":
      return {
        ...document,
        title: operation.title,
        updatedAt: now()
      };
    case "node/upsert": {
      const next = {
        ...document,
        nodes: {
          ...document.nodes,
          [operation.node.id]: {
            ...operation.node,
            updatedAt: now()
          }
        },
        updatedAt: now()
      };
      return arrangeDocument(normalizeSiblingOrder(next, operation.node.parentId), operation.node.parentId ?? "root");
    }
    case "node/update": {
      const current = document.nodes[operation.nodeId];
      if (!current) {
        return document;
      }

      return {
        ...document,
        nodes: {
          ...document.nodes,
          [operation.nodeId]: {
            ...current,
            ...operation.changes,
            updatedAt: now()
          }
        },
        updatedAt: now()
      };
    }
    case "node/remove": {
      if (operation.nodeId === "root") {
        return document;
      }

      const parentId = document.nodes[operation.nodeId]?.parentId ?? null;
      const nextNodes = { ...document.nodes };
      [operation.nodeId, ...getDescendantIds(document, operation.nodeId)].forEach((id) => delete nextNodes[id]);

      return arrangeDocument(
        normalizeSiblingOrder(
          {
            ...document,
            nodes: nextNodes,
            updatedAt: now()
          },
          parentId
        )
      );
    }
    case "nodes/reorder": {
      const nextNodes = { ...document.nodes };
      operation.orderedIds.forEach((id, index) => {
        if (nextNodes[id] && nextNodes[id].parentId === operation.parentId) {
          nextNodes[id] = { ...nextNodes[id], order: index, updatedAt: now() };
        }
      });
      return arrangeDocument(
        {
          ...document,
          nodes: nextNodes,
          updatedAt: now()
        },
        operation.parentId ?? "root"
      );
    }
    case "nodes/arrange":
      return arrangeDocument(document, operation.focusNodeId);
    default:
      return document;
  }
}

function applyWorkspaceOperation(workspace, operation) {
  switch (operation.type) {
    case "workspace/set":
      return {
        ...operation.workspace,
        version: workspace.version + 1,
        updatedAt: now()
      };
    case "folder/create": {
      const folder = {
        id: uid("folder"),
        name: operation.name || "New folder",
        noteIds: [],
        createdAt: now(),
        updatedAt: now()
      };
      return {
        ...workspace,
        folders: [...workspace.folders, folder],
        version: workspace.version + 1,
        updatedAt: now()
      };
    }
    case "folder/update":
      return {
        ...workspace,
        folders: workspace.folders.map((folder) =>
          folder.id === operation.folderId
            ? { ...folder, ...operation.changes, updatedAt: now() }
            : folder
        ),
        version: workspace.version + 1,
        updatedAt: now()
      };
    case "folder/delete": {
      const folder = workspace.folders.find((item) => item.id === operation.folderId);
      if (!folder) {
        return workspace;
      }

      const nextNotes = { ...workspace.notes };
      folder.noteIds.forEach((noteId) => {
        delete nextNotes[noteId];
      });

      return {
        ...workspace,
        folders: workspace.folders.filter((item) => item.id !== operation.folderId),
        notes: nextNotes,
        version: workspace.version + 1,
        updatedAt: now()
      };
    }
    case "note/create": {
      const folder = workspace.folders.find((item) => item.id === operation.folderId);
      if (!folder) {
        return workspace;
      }

      const noteId = uid("note");
      const note = {
        id: noteId,
        folderId: operation.folderId,
        title: operation.title || "Untitled note",
        document: createSampleDocument(operation.title || "Untitled note"),
        createdAt: now(),
        updatedAt: now()
      };

      return {
        ...workspace,
        folders: workspace.folders.map((item) =>
          item.id === operation.folderId
            ? { ...item, noteIds: [...item.noteIds, noteId], updatedAt: now() }
            : item
        ),
        notes: {
          ...workspace.notes,
          [noteId]: note
        },
        version: workspace.version + 1,
        updatedAt: now()
      };
    }
    case "note/delete": {
      const note = workspace.notes[operation.noteId];
      if (!note) {
        return workspace;
      }

      const nextNotes = { ...workspace.notes };
      delete nextNotes[operation.noteId];

      return {
        ...workspace,
        folders: workspace.folders.map((folder) =>
          folder.id === note.folderId
            ? {
                ...folder,
                noteIds: folder.noteIds.filter((id) => id !== operation.noteId),
                updatedAt: now()
              }
            : folder
        ),
        notes: nextNotes,
        version: workspace.version + 1,
        updatedAt: now()
      };
    }
    case "note/update":
      return {
        ...workspace,
        notes: {
          ...workspace.notes,
          [operation.noteId]: {
            ...workspace.notes[operation.noteId],
            ...operation.changes,
            updatedAt: now()
          }
        },
        version: workspace.version + 1,
        updatedAt: now()
      };
    case "document/title":
    case "node/upsert":
    case "node/update":
    case "node/remove":
    case "nodes/reorder":
    case "nodes/arrange":
      return {
        ...withNote(workspace, operation.noteId, (note) => ({
          ...note,
          document: applyDocumentOperation(note.document, operation)
        })),
        version: workspace.version + 1
      };
    default:
      return workspace;
  }
}

let state = {
  workspace: loadWorkspace(),
  presence: {}
};

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload, exceptId) {
  for (const [id, res] of clients.entries()) {
    if (id === exceptId) {
      continue;
    }
    sendEvent(res, payload);
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function localNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      url: `http://localhost:${port}`,
      lanUrls: localNetworkAddresses().map((address) => `http://${address}:${port}`)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/workspace") {
    sendJson(res, 200, {
      workspace: state.workspace,
      presence: Object.values(state.presence)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const clientId = url.searchParams.get("clientId") || uid("client");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    clients.set(clientId, res);
    sendEvent(res, { type: "hello", clientId });

    req.on("close", () => {
      clients.delete(clientId);
      delete state.presence[clientId];
      broadcast({ type: "presence", presence: Object.values(state.presence) });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/presence") {
    const payload = JSON.parse(await collectBody(req));
    state.presence[payload.clientId] = {
      socketId: payload.clientId,
      name: payload.name,
      color: payload.color,
      selectedNoteId: payload.selectedNoteId ?? null,
      selectedNodeId: payload.selectedNodeId ?? null
    };
    broadcast({ type: "presence", presence: Object.values(state.presence) }, payload.clientId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/operation") {
    const payload = JSON.parse(await collectBody(req));
    state.workspace = applyWorkspaceOperation(state.workspace, payload.operation);
    saveWorkspace(state.workspace);
    broadcast(
      {
        type: "operation",
        operation: payload.operation,
        version: state.workspace.version
      },
      payload.clientId
    );
    sendJson(res, 200, {
      ok: true,
      version: state.workspace.version
    });
    return;
  }

  const filePath = path.join(projectRoot, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (filePath.startsWith(projectRoot) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, {
      "Content-Type": contentType(filePath)
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("Not found");
});

server.listen(port, host, () => {
  const lanUrls = localNetworkAddresses();
  console.log(`Geonius is running at http://localhost:${port}`);
  if (lanUrls.length > 0) {
    console.log(`LAN access: ${lanUrls.map((address) => `http://${address}:${port}`).join(", ")}`);
  }
});
