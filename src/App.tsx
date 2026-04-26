import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  applyOperation,
  arrangeDocument,
  createInitialDocument,
  createNode,
  cryptoSafeId,
  getChildren,
  getSiblingIds,
  rootId
} from "./shared/document";
import type { MindmapDocument, MindmapNode, MindmapOperation, Presence } from "./shared/types";

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
    if (!parent || parent.collapsed) {
      return false;
    }
    current = parent;
  }
  return true;
}

function getConnectionLines(document: MindmapDocument) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId && isVisible(document, node.id))
    .map((node) => ({
      node,
      parent: document.nodes[node.parentId!]
    }))
    .filter((entry): entry is { node: MindmapNode; parent: MindmapNode } => Boolean(entry.parent));
}

function OutlineTree({
  document,
  selectedNodeId,
  presence,
  onSelect,
  onUpdateText,
  onNodeKeyDown
}: {
  document: MindmapDocument;
  selectedNodeId: string;
  presence: Presence[];
  onSelect: (nodeId: string) => void;
  onUpdateText: (nodeId: string, text: string) => void;
  onNodeKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, nodeId: string) => void;
}) {
  function renderBranch(nodeId: string, depth: number): JSX.Element {
    const node = document.nodes[nodeId];
    const children = getChildren(document, nodeId);
    const watchers = presence.filter((member) => member.selectedNodeId === nodeId);

    return (
      <div key={nodeId} className="outline-branch">
        <div
          className={`outline-row ${selectedNodeId === nodeId ? "active" : ""}`}
          style={{ paddingLeft: `${depth * 18 + 10}px` }}
        >
          <button
            className="tree-toggle"
            onClick={() => onSelect(nodeId)}
            title={node.collapsed ? "Select collapsed branch" : "Select branch"}
          >
            {children.length > 0 ? (node.collapsed ? "+" : "-") : "•"}
          </button>
          <input
            value={node.text}
            className="outline-input"
            onFocus={() => onSelect(nodeId)}
            onChange={(event) => onUpdateText(nodeId, event.target.value)}
            onKeyDown={(event) => onNodeKeyDown(event, nodeId)}
          />
          <div className="mini-presence">
            {watchers.map((member) => (
              <span
                key={member.socketId}
                className="mini-presence-dot"
                title={member.name}
                style={{ background: member.color }}
              />
            ))}
          </div>
        </div>
        {!node.collapsed ? children.map((child) => renderBranch(child.id, depth + 1)) : null}
      </div>
    );
  }

  return <div className="outline-tree">{renderBranch(rootId, 0)}</div>;
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
  const [viewport, setViewport] = useState({ x: window.innerWidth / 2, y: 180, scale: 1 });
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

    nextSocket.on("operation:apply", (payload: { operation: MindmapOperation }) => {
      setDocument((current) => applyOperation(current, payload.operation));
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

  useEffect(() => {
    if (!document.nodes[selectedNodeId]) {
      setSelectedNodeId(rootId);
    }
  }, [document.nodes, selectedNodeId]);

  const selectedNode = document.nodes[selectedNodeId] ?? document.nodes[rootId];
  const visibleNodes = useMemo(
    () => Object.values(document.nodes).filter((node) => isVisible(document, node.id)),
    [document]
  );
  const connectionLines = useMemo(() => getConnectionLines(document), [document]);
  const otherUsers = presence.filter((member) => member.name !== user.name);

  function commitOperation(operation: MindmapOperation) {
    setDocument((current) => applyOperation(current, operation));
    socket?.emit("operation:apply", operation);
  }

  function updateNodeText(nodeId: string, text: string) {
    commitOperation({
      type: "node/update",
      nodeId,
      changes: { text }
    });
  }

  function updateSelectedNode(changes: Partial<Omit<MindmapNode, "id" | "createdAt">>) {
    if (!selectedNode) {
      return;
    }

    commitOperation({
      type: "node/update",
      nodeId: selectedNode.id,
      changes
    });
  }

  function createSibling(nodeId: string) {
    const current = document.nodes[nodeId];
    if (!current || !current.parentId) {
      return;
    }

    const siblingIds = getSiblingIds(document, current.parentId);
    const currentIndex = siblingIds.indexOf(nodeId);
    const nextOrder = currentIndex + 1;
    const reorderedIds = [...siblingIds];
    const newId = cryptoSafeId();
    reorderedIds.splice(nextOrder, 0, newId);

    const newNode = createNode({
      id: newId,
      text: "New sibling",
      parentId: current.parentId,
      order: nextOrder,
      color: current.color
    });

    commitOperation({
      type: "document/set",
      document: arrangeDocument(
        applyOperation(
          applyOperation(document, {
            type: "node/upsert",
            node: newNode
          }),
          {
            type: "nodes/reorder",
            parentId: current.parentId,
            orderedIds: reorderedIds
          }
        ),
        current.parentId
      )
    });

    setSelectedNodeId(newId);
  }

  function createChild(parentId: string) {
    const parent = document.nodes[parentId];
    if (!parent) {
      return;
    }

    const siblings = getChildren(document, parentId);
    const newNode = createNode({
      id: cryptoSafeId(),
      text: "New idea",
      parentId,
      order: siblings.length,
      color: palette[siblings.length % palette.length]
    });

    commitOperation({
      type: "node/upsert",
      node: newNode
    });
    setSelectedNodeId(newNode.id);
  }

  function removeSelectedNode() {
    if (selectedNodeId === rootId) {
      return;
    }

    commitOperation({
      type: "node/remove",
      nodeId: selectedNodeId
    });
    setSelectedNodeId(rootId);
  }

  function toggleCollapse(nodeId: string) {
    const node = document.nodes[nodeId];
    if (!node) {
      return;
    }

    commitOperation({
      type: "node/update",
      nodeId,
      changes: { collapsed: !node.collapsed }
    });
  }

  function moveNodeAmongSiblings(nodeId: string, direction: -1 | 1) {
    const node = document.nodes[nodeId];
    if (!node) {
      return;
    }

    const siblingIds = getSiblingIds(document, node.parentId);
    const currentIndex = siblingIds.indexOf(nodeId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblingIds.length) {
      return;
    }

    const nextIds = [...siblingIds];
    const [movedId] = nextIds.splice(currentIndex, 1);
    nextIds.splice(targetIndex, 0, movedId);

    commitOperation({
      type: "nodes/reorder",
      parentId: node.parentId,
      orderedIds: nextIds
    });
  }

  function outdentNode(nodeId: string) {
    const node = document.nodes[nodeId];
    if (!node?.parentId || node.parentId === rootId) {
      return;
    }

    const parent = document.nodes[node.parentId];
    if (!parent?.parentId) {
      return;
    }

    const uncleIds = getSiblingIds(document, parent.parentId);
    const parentIndex = uncleIds.indexOf(parent.id);
    const reorderedUncles = [...uncleIds];
    reorderedUncles.splice(parentIndex + 1, 0, nodeId);

    const movedNode = {
      ...node,
      parentId: parent.parentId,
      order: parentIndex + 1
    };

    let nextDocument = applyOperation(document, {
      type: "node/upsert",
      node: movedNode
    });

    nextDocument = applyOperation(nextDocument, {
      type: "nodes/reorder",
      parentId: parent.parentId,
      orderedIds: reorderedUncles.filter((id, index, array) => array.indexOf(id) === index)
    });

    commitOperation({
      type: "document/set",
      document: arrangeDocument(nextDocument, movedNode.parentId ?? rootId)
    });
  }

  function indentNode(nodeId: string) {
    const node = document.nodes[nodeId];
    if (!node?.parentId) {
      return;
    }

    const siblingIds = getSiblingIds(document, node.parentId);
    const currentIndex = siblingIds.indexOf(nodeId);
    if (currentIndex <= 0) {
      return;
    }

    const previousSiblingId = siblingIds[currentIndex - 1];
    const previousSibling = document.nodes[previousSiblingId];
    if (!previousSibling) {
      return;
    }

    const previousChildren = getChildren(document, previousSibling.id);
    const movedNode = {
      ...node,
      parentId: previousSibling.id,
      order: previousChildren.length
    };

    commitOperation({
      type: "node/upsert",
      node: movedNode
    });

    if (previousSibling.collapsed) {
      commitOperation({
        type: "node/update",
        nodeId: previousSibling.id,
        changes: { collapsed: false }
      });
    }
  }

  async function onUploadImage(event: ChangeEvent<HTMLInputElement>) {
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

    updateSelectedNode({ image: dataUrl });
    event.target.value = "";
  }

  function screenToCanvas(clientX: number, clientY: number) {
    return {
      x: (clientX - viewport.x) / viewport.scale,
      y: (clientY - viewport.y) / viewport.scale
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      const point = screenToCanvas(event.clientX, event.clientY);
      commitOperation({
        type: "node/update",
        nodeId: dragRef.current.nodeId,
        changes: {
          x: point.x - dragRef.current.offsetX,
          y: point.y - dragRef.current.offsetY
        }
      });
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

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setViewport((current) => ({
      ...current,
      scale: Math.max(0.45, Math.min(1.8, current.scale + delta))
    }));
  }

  function handleOutlineKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, nodeId: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      createSibling(nodeId);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        outdentNode(nodeId);
      } else {
        indentNode(nodeId);
      }
      return;
    }

    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveNodeAmongSiblings(nodeId, -1);
      return;
    }

    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveNodeAmongSiblings(nodeId, 1);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        createChild(selectedNodeId);
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        removeSelectedNode();
      }

      if (event.key === " ") {
        event.preventDefault();
        toggleCollapse(selectedNodeId);
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
          <h1>Shared Mindmap</h1>
          <p className="subtle">
            Outline-first collaboration with live syncing, branch arranging, and image cards inside nodes.
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
          <div className="panel-row">
            <span>Version</span>
            <strong>{document.version}</strong>
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
          <div className="panel-heading">
            <h2>Outline</h2>
            <button className="ghost" onClick={() => commitOperation({ type: "nodes/arrange" })}>
              Arrange
            </button>
          </div>
          <OutlineTree
            document={document}
            selectedNodeId={selectedNodeId}
            presence={presence}
            onSelect={setSelectedNodeId}
            onUpdateText={updateNodeText}
            onNodeKeyDown={handleOutlineKeyDown}
          />
          <p className="hint">`Enter` sibling, `Tab` indent, `Shift+Tab` outdent, `Alt+↑/↓` reorder.</p>
        </div>

        <div className="panel">
          <h2>Selected Node</h2>
          <input
            className="title-input"
            value={selectedNode?.text ?? ""}
            onChange={(event) => updateNodeText(selectedNode.id, event.target.value)}
          />
          <label className="stack">
            Color
            <input
              type="color"
              value={selectedNode?.color ?? "#0f766e"}
              onChange={(event) => updateSelectedNode({ color: event.target.value })}
            />
          </label>
          <label className="stack">
            Image
            <input type="file" accept="image/*" onChange={onUploadImage} />
          </label>
          <div className="button-row">
            <button onClick={() => createChild(selectedNode.id)}>Add child</button>
            <button className="ghost" onClick={() => createSibling(selectedNode.id)} disabled={selectedNode.id === rootId}>
              Add sibling
            </button>
            <button className="ghost" onClick={() => toggleCollapse(selectedNode.id)}>
              {selectedNode?.collapsed ? "Expand" : "Collapse"}
            </button>
            <button className="danger" onClick={removeSelectedNode} disabled={selectedNodeId === rootId}>
              Delete
            </button>
          </div>
          <p className="hint">Canvas shortcuts: `Tab` child, `Space` collapse, `Backspace` delete.</p>
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
          <button onClick={() => setViewport({ x: window.innerWidth / 2, y: 180, scale: 1 })}>Reset view</button>
          <button className="ghost" onClick={() => commitOperation({ type: "nodes/arrange", focusNodeId: selectedNodeId })}>
            Reflow branch
          </button>
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
            <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
              {connectionLines.map(({ node, parent }) => (
                <path
                  key={node.id}
                  d={`M ${parent.x} ${parent.y} C ${parent.x + 105} ${parent.y}, ${node.x - 105} ${node.y}, ${node.x} ${node.y}`}
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
            {visibleNodes.map((node) => {
              const viewers = otherUsers.filter((member) => member.selectedNodeId === node.id);

              return (
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
                  onDoubleClick={() => createChild(node.id)}
                >
                  <span className="node-accent" style={{ background: node.color }} />
                  <div className="node-title-row">
                    <h3>{node.text}</h3>
                    {viewers.length > 0 ? (
                      <div className="node-watchers">
                        {viewers.map((member) => (
                          <span
                            key={member.socketId}
                            className="node-watcher"
                            style={{ background: member.color }}
                            title={member.name}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {node.image ? <img src={node.image} alt={node.text} className="node-image" /> : null}
                  <p>{getChildren(document, node.id).length} linked ideas</p>
                </article>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
