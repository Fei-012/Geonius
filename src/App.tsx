import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { createInitialDocument, createNode, cryptoSafeId, getChildren, removeNode, rootId } from "./shared/document";
import type { MindmapDocument, MindmapNode, Presence } from "./shared/types";

const palette = ["#0f766e", "#f97316", "#2563eb", "#dc2626", "#7c3aed", "#059669", "#ca8a04"];
const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3001";

function getRandomName() {
  const animals = ["Fox", "Whale", "Otter", "Panda", "Falcon", "Lynx", "Robin"];
  const adjectives = ["Swift", "Bright", "Calm", "Wild", "Bold", "Mellow", "Nova"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
}

function isVisible(document: MindmapDocument, nodeId: string): boolean {
  let current = document.nodes[nodeId];
  while (current && current.parentId) {
    const parent = document.nodes[current.parentId];
    if (!parent) {
      return false;
    }
    if (parent.collapsed) {
      return false;
    }
    current = parent;
  }
  return true;
}

function getConnectionLines(document: MindmapDocument) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId && isVisible(document, node.id))
    .map((node) => {
      const parent = document.nodes[node.parentId!];
      return { node, parent };
    })
    .filter((item): item is { node: MindmapNode; parent: MindmapNode } => Boolean(item.parent));
}

function App() {
  const [document, setDocument] = useState<MindmapDocument>(createInitialDocument);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(rootId);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [user] = useState(() => ({
    name: getRandomName(),
    color: palette[Math.floor(Math.random() * palette.length)]
  }));
  const [viewport, setViewport] = useState({ x: window.innerWidth / 2, y: 140, scale: 1 });
  const selectedNodeIdRef = useRef(selectedNodeId);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    const nextSocket = io(socketUrl);
    setSocket(nextSocket);

    nextSocket.on("connect", () => {
      setIsConnected(true);
      nextSocket.emit("presence:update", {
        name: user.name,
        color: user.color,
        selectedNodeId: selectedNodeIdRef.current
      });
    });

    nextSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    nextSocket.on("document:sync", (payload: { document: MindmapDocument; presence: Presence[] }) => {
      setDocument(payload.document);
      setPresence(payload.presence);
    });

    nextSocket.on("presence:sync", (nextPresence: Presence[]) => {
      setPresence(nextPresence);
    });

    return () => {
      nextSocket.disconnect();
    };
  }, [user.color, user.name]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.emit("presence:update", {
      name: user.name,
      color: user.color,
      selectedNodeId
    });
  }, [selectedNodeId, socket, user.color, user.name]);

  const selectedNode = document.nodes[selectedNodeId] ?? document.nodes[rootId];

  useEffect(() => {
    if (!document.nodes[selectedNodeId]) {
      setSelectedNodeId(rootId);
    }
  }, [document.nodes, selectedNodeId]);

  function syncDocument(nextDocument: MindmapDocument) {
    setDocument(nextDocument);
    socket?.emit("document:update", nextDocument);
  }

  function updateNode(nodeId: string, updater: (node: MindmapNode) => MindmapNode) {
    const current = document.nodes[nodeId];
    if (!current) {
      return;
    }

    const updated = updater(current);
    syncDocument({
      ...document,
      nodes: {
        ...document.nodes,
        [nodeId]: {
          ...updated,
          updatedAt: Date.now()
        }
      },
      updatedAt: Date.now()
    });
  }

  function addChildNode(parentId: string) {
    const parent = document.nodes[parentId];
    if (!parent) {
      return;
    }

    const siblings = getChildren(document, parentId);
    const newNode = createNode({
      id: cryptoSafeId(),
      text: "New idea",
      parentId,
      x: parent.x + (parentId === rootId ? 280 : 220),
      y: siblings.length === 0 ? parent.y : siblings[siblings.length - 1].y + 120,
      color: palette[siblings.length % palette.length]
    });

    const nextDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        [newNode.id]: newNode
      },
      updatedAt: Date.now()
    };
    setSelectedNodeId(newNode.id);
    syncDocument(nextDocument);
  }

  function deleteSelectedNode() {
    if (selectedNodeId === rootId) {
      return;
    }

    const nextDocument = removeNode(document, selectedNodeId);
    setSelectedNodeId(rootId);
    syncDocument(nextDocument);
  }

  async function onUploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedNode) {
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    updateNode(selectedNode.id, (node) => ({
      ...node,
      image: dataUrl
    }));
    event.target.value = "";
  }

  const visibleNodes = useMemo(
    () => Object.values(document.nodes).filter((node) => isVisible(document, node.id)),
    [document]
  );
  const connectionLines = useMemo(() => getConnectionLines(document), [document]);

  function screenToCanvas(clientX: number, clientY: number) {
    return {
      x: (clientX - viewport.x) / viewport.scale,
      y: (clientY - viewport.y) / viewport.scale
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      const point = screenToCanvas(event.clientX, event.clientY);
      updateNode(dragRef.current.nodeId, (node) => ({
        ...node,
        x: point.x - dragRef.current!.offsetX,
        y: point.y - dragRef.current!.offsetY
      }));
      return;
    }

    if (panRef.current) {
      setViewport((current) => ({
        ...current,
        x: current.x + event.clientX - panRef.current!.x,
        y: current.y + event.clientY - panRef.current!.y
      }));
      panRef.current = { x: event.clientX, y: event.clientY };
    }
  }

  function handlePointerUp() {
    dragRef.current = null;
    panRef.current = null;
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setViewport((current) => ({
      ...current,
      scale: Math.max(0.45, Math.min(1.8, current.scale + delta))
    }));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        addChildNode(selectedNodeId);
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedNode();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, document]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Geonius</p>
          <h1>{document.title}</h1>
          <p className="subtle">
            A live collaborative mindmap inspired by outline-first thinking, with image blocks built into nodes.
          </p>
        </div>

        <div className="panel">
          <div className="panel-row">
            <span>Status</span>
            <strong className={isConnected ? "connected" : "disconnected"}>
              {isConnected ? "Live" : "Offline"}
            </strong>
          </div>
          <div className="panel-row">
            <span>You</span>
            <strong>{user.name}</strong>
          </div>
          <div className="presence-list">
            {presence.map((member) => (
              <div className="presence-chip" key={member.socketId}>
                <span className="presence-dot" style={{ background: member.color }} />
                {member.name}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Selected Node</h2>
          <input
            className="title-input"
            value={selectedNode?.text ?? ""}
            onChange={(event) =>
              updateNode(selectedNode.id, (node) => ({
                ...node,
                text: event.target.value
              }))
            }
          />
          <label className="stack">
            Color
            <input
              type="color"
              value={selectedNode?.color ?? "#0f766e"}
              onChange={(event) =>
                updateNode(selectedNode.id, (node) => ({
                  ...node,
                  color: event.target.value
                }))
              }
            />
          </label>
          <label className="stack">
            Image
            <input type="file" accept="image/*" onChange={onUploadImage} />
          </label>
          <div className="button-row">
            <button onClick={() => addChildNode(selectedNode.id)}>Add child</button>
            <button
              className="ghost"
              onClick={() =>
                updateNode(selectedNode.id, (node) => ({
                  ...node,
                  collapsed: !node.collapsed
                }))
              }
            >
              {selectedNode?.collapsed ? "Expand" : "Collapse"}
            </button>
            <button className="danger" onClick={deleteSelectedNode} disabled={selectedNodeId === rootId}>
              Delete
            </button>
          </div>
          <p className="hint">Shortcuts: `Tab` adds a child, `Backspace` deletes the selected node.</p>
        </div>
      </aside>

      <main
        className="canvas-shell"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className="toolbar">
          <button onClick={() => setViewport({ x: window.innerWidth / 2, y: 140, scale: 1 })}>Reset view</button>
          <span>{Math.round(viewport.scale * 100)}%</span>
        </div>

        <div
          className="canvas"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedNodeId(rootId);
              panRef.current = { x: event.clientX, y: event.clientY };
            }
          }}
        >
          <svg className="connections">
            <g
              transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
            >
              {connectionLines.map(({ node, parent }) => (
                <path
                  key={node.id}
                  d={`M ${parent.x} ${parent.y} C ${parent.x + 100} ${parent.y}, ${node.x - 100} ${node.y}, ${node.x} ${node.y}`}
                  stroke="rgba(15, 23, 42, 0.18)"
                  strokeWidth={3 / viewport.scale}
                  fill="none"
                />
              ))}
            </g>
          </svg>

          <div
            className="canvas-viewport"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
            }}
          >
            {visibleNodes.map((node) => (
              <article
                key={node.id}
                className={`node-card ${selectedNodeId === node.id ? "selected" : ""}`}
                style={{
                  left: node.x,
                  top: node.y,
                  borderColor: node.color
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedNodeId(node.id);
                  const point = screenToCanvas(event.clientX, event.clientY);
                  dragRef.current = {
                    nodeId: node.id,
                    offsetX: point.x - node.x,
                    offsetY: point.y - node.y
                  };
                }}
                onDoubleClick={() => addChildNode(node.id)}
              >
                <span className="node-accent" style={{ background: node.color }} />
                <h3>{node.text}</h3>
                {node.image ? <img src={node.image} alt={node.text} className="node-image" /> : null}
                <p>{getChildren(document, node.id).length} linked ideas</p>
              </article>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
