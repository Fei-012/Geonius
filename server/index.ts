import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import { applyOperation, createInitialDocument } from "../src/shared/document.js";
import type { MindmapDocument, MindmapOperation, Presence } from "../src/shared/types.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.resolve(process.cwd(), "server/data");
const DATA_FILE = path.join(DATA_DIR, "document.json");

type ServerState = {
  document: MindmapDocument;
  presence: Record<string, Presence>;
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createInitialDocument(), null, 2));
  }
}

function loadDocument(): MindmapDocument {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");

  return JSON.parse(raw) as MindmapDocument;
}

function saveDocument(document: MindmapDocument) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(document, null, 2));
}

const state: ServerState = {
  document: loadDocument(),
  presence: {}
};

app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.emit("document:sync", {
    document: state.document,
    presence: Object.values(state.presence)
  });

  socket.on("presence:update", (presence: Omit<Presence, "socketId">) => {
    state.presence[socket.id] = {
      ...presence,
      socketId: socket.id
    };
    io.emit("presence:sync", Object.values(state.presence));
  });

  socket.on("operation:apply", (operation: MindmapOperation) => {
    state.document = applyOperation(state.document, operation);
    saveDocument(state.document);
    socket.broadcast.emit("operation:apply", {
      operation,
      version: state.document.version
    });
  });

  socket.on("disconnect", () => {
    delete state.presence[socket.id];
    io.emit("presence:sync", Object.values(state.presence));
  });
});

httpServer.listen(PORT, () => {
  console.log(`Collaborative server listening on http://localhost:${PORT}`);
});
