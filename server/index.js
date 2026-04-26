import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "document.json");
const port = Number(process.env.PORT || 3001);

const clients = new Map();

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(createInitialDocument(), null, 2));
  }
}

function createNode(partial) {
  const now = Date.now();
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    text: partial.text,
    order: partial.order ?? 0,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    color: partial.color ?? "#f97316",
    collapsed: partial.collapsed ?? false,
    image: partial.image,
    createdAt: partial.createdAt ?? now,
    updatedAt: now
  };
}

function cryptoSafeId() {
  return globalThis.crypto?.randomUUID?.() ?? `node-${Math.random().toString(36).slice(2, 10)}`;
}

function getChildren(document, parentId) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.y - b.y);
}

function getSiblingIds(document, parentId) {
  return getChildren({ ...document, nodes: document.nodes }, parentId).map((node) => node.id);
}

function normalizeSiblingOrder(document, parentId) {
  const orderedIds = getSiblingIds(document, parentId);
  const nodes = { ...document.nodes };
  orderedIds.forEach((id, index) => {
    nodes[id] = { ...nodes[id], order: index, updatedAt: Date.now() };
  });
  return { ...document, nodes, updatedAt: Date.now() };
}

function getDescendantIds(document, nodeId) {
  const descendants = [];
  const stack = [nodeId];
  while (stack.length) {
    const current = stack.pop();
    for (const child of getChildren(document, current)) {
      descendants.push(child.id);
      stack.push(child.id);
    }
  }
  return descendants;
}

function arrangeDocument(document, focusNodeId = "root") {
  const nodes = { ...document.nodes };
  if (!nodes.root) {
    return document;
  }

  nodes.root = { ...nodes.root, x: 0, y: 0 };

  const rootSpacingX = 320;
  const childSpacingX = 240;
  const siblingSpacingY = 132;

  function subtreeHeight(nodeId) {
    const node = nodes[nodeId];
    if (!node || node.collapsed) {
      return 1;
    }
    const children = getChildren({ ...document, nodes }, nodeId);
    if (!children.length) {
      return 1;
    }
    return Math.max(1, children.reduce((sum, child) => sum + subtreeHeight(child.id), 0));
  }

  function placeChildren(parentId, startY) {
    const parent = nodes[parentId];
    const children = getChildren({ ...document, nodes }, parentId);
    if (!parent || !children.length) {
      return;
    }

    const total = children.reduce((sum, child) => sum + subtreeHeight(child.id), 0);
    let cursor = startY - ((total - 1) * siblingSpacingY) / 2;

    for (const child of children) {
      const units = subtreeHeight(child.id);
      const centerY = cursor + ((units - 1) * siblingSpacingY) / 2;
      nodes[child.id] = {
        ...nodes[child.id],
        x: parent.x + (parentId === "root" ? rootSpacingX : childSpacingX),
        y: centerY
      };
      placeChildren(child.id, centerY);
      cursor += units * siblingSpacingY;
    }
  }

  placeChildren("root", 0);

  if (focusNodeId !== "root" && nodes[focusNodeId] && document.nodes[focusNodeId]) {
    const drift = document.nodes[focusNodeId].y - nodes[focusNodeId].y;
    if (Math.abs(drift) > 0.5) {
      for (const node of Object.values(nodes)) {
        if (node.id === "root") {
          continue;
        }
        nodes[node.id] = { ...node, y: node.y + drift };
      }
    }
  }

  return { ...document, nodes, updatedAt: Date.now() };
}

function createInitialDocument() {
  const root = createNode({ id: "root", text: "Geonius", color: "#0f766e" });
  const strategy = createNode({ id: cryptoSafeId(), text: "Strategy", parentId: "root", order: 0, color: "#f97316" });
  const execution = createNode({ id: cryptoSafeId(), text: "Execution", parentId: "root", order: 1, color: "#2563eb" });
  const assets = createNode({ id: cryptoSafeId(), text: "Images", parentId: "root", order: 2, color: "#9333ea" });
  return arrangeDocument({
    id: "default-room",
    title: "Live Collaborative Mindmap",
    version: 1,
    nodes: { root, [strategy.id]: strategy, [execution.id]: execution, [assets.id]: assets },
    updatedAt: Date.now()
  });
}

function loadDocument() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function saveDocument(document) {
  fs.writeFileSync(dataFile, JSON.stringify(document, null, 2));
}

function applyOperation(document, operation) {
  switch (operation.type) {
    case "document/set":
      return { ...operation.document, version: document.version + 1, updatedAt: Date.now() };
    case "title/set":
      return { ...document, title: operation.title, version: document.version + 1, updatedAt: Date.now() };
    case "node/upsert": {
      const next = {
        ...document,
        nodes: {
          ...document.nodes,
          [operation.node.id]: { ...operation.node, updatedAt: Date.now() }
        }
      };
      return {
        ...arrangeDocument(normalizeSiblingOrder(next, operation.node.parentId), operation.node.parentId ?? "root"),
        version: document.version + 1
      };
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
          [operation.nodeId]: { ...current, ...operation.changes, updatedAt: Date.now() }
        },
        version: document.version + 1,
        updatedAt: Date.now()
      };
    }
    case "node/remove": {
      if (operation.nodeId === "root") {
        return document;
      }
      const parentId = document.nodes[operation.nodeId]?.parentId ?? null;
      const nodes = { ...document.nodes };
      for (const id of [operation.nodeId, ...getDescendantIds(document, operation.nodeId)]) {
        delete nodes[id];
      }
      return {
        ...arrangeDocument(normalizeSiblingOrder({ ...document, nodes, updatedAt: Date.now() }, parentId)),
        version: document.version + 1
      };
    }
    case "nodes/reorder": {
      const nodes = { ...document.nodes };
      operation.orderedIds.forEach((id, index) => {
        if (nodes[id] && nodes[id].parentId === operation.parentId) {
          nodes[id] = { ...nodes[id], order: index, updatedAt: Date.now() };
        }
      });
      return {
        ...arrangeDocument({ ...document, nodes, updatedAt: Date.now() }, operation.parentId ?? "root"),
        version: document.version + 1
      };
    }
    case "nodes/arrange":
      return { ...arrangeDocument(document, operation.focusNodeId), version: document.version + 1 };
    default:
      return document;
  }
}

let state = {
  document: loadDocument(),
  presence: {}
};

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload, exceptId) {
  for (const [id, client] of clients.entries()) {
    if (id === exceptId) {
      continue;
    }
    sendSse(client, payload);
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024 * 1024) {
        reject(new Error("Body too large"));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, port });
  }

  if (req.method === "GET" && url.pathname === "/document") {
    return sendJson(res, 200, { document: state.document, presence: Object.values(state.presence) });
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const clientId = url.searchParams.get("clientId") || cryptoSafeId();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    clients.set(clientId, res);
    sendSse(res, { type: "hello", clientId });
    req.on("close", () => {
      clients.delete(clientId);
      delete state.presence[clientId];
      broadcast({ type: "presence", presence: Object.values(state.presence) });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/presence") {
    const body = JSON.parse(await collectBody(req));
    state.presence[body.clientId] = {
      socketId: body.clientId,
      name: body.name,
      color: body.color,
      selectedNodeId: body.selectedNodeId ?? null
    };
    broadcast({ type: "presence", presence: Object.values(state.presence) });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/operation") {
    const body = JSON.parse(await collectBody(req));
    state.document = applyOperation(state.document, body.operation);
    saveDocument(state.document);
    broadcast({ type: "operation", operation: body.operation, version: state.document.version }, body.clientId);
    return sendJson(res, 200, { ok: true, version: state.document.version });
  }

  const filePath = path.join(projectRoot, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (filePath.startsWith(projectRoot) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`Geonius is running at http://localhost:${port}`);
});
