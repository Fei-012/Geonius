const palette = ["#0f766e", "#f97316", "#2563eb", "#dc2626", "#7c3aed", "#059669", "#ca8a04"];
const rootId = "root";

const state = {
  document: null,
  presence: [],
  selectedNodeId: rootId,
  viewport: { x: window.innerWidth / 2, y: 180, scale: 1 },
  clientId: localStorage.getItem("geonius-client-id") || `client-${Math.random().toString(36).slice(2, 10)}`,
  user: {
    name: localStorage.getItem("geonius-user-name") || randomName(),
    color: localStorage.getItem("geonius-user-color") || palette[Math.floor(Math.random() * palette.length)]
  }
};

localStorage.setItem("geonius-client-id", state.clientId);
localStorage.setItem("geonius-user-name", state.user.name);
localStorage.setItem("geonius-user-color", state.user.color);

let dragState = null;
let panState = null;

function randomName() {
  const animals = ["Fox", "Whale", "Otter", "Panda", "Falcon", "Lynx", "Robin"];
  const adjectives = ["Swift", "Bright", "Calm", "Wild", "Bold", "Mellow", "Nova"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
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

function getChildren(parentId) {
  return Object.values(state.document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.y - b.y);
}

function getSiblingIds(parentId) {
  return getChildren(parentId).map((node) => node.id);
}

function isVisible(nodeId) {
  let current = state.document.nodes[nodeId];
  while (current && current.parentId) {
    const parent = state.document.nodes[current.parentId];
    if (!parent || parent.collapsed) {
      return false;
    }
    current = parent;
  }
  return true;
}

function applyOperation(operation, shouldRender = true) {
  state.document = applyOperationLocal(state.document, operation);
  if (shouldRender) {
    render();
  }
}

function applyOperationLocal(document, operation) {
  const now = Date.now();

  function normalizeSiblingOrder(parentId) {
    const ids = Object.values(document.nodes)
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.y - b.y)
      .map((node) => node.id);
    ids.forEach((id, index) => {
      document.nodes[id] = { ...document.nodes[id], order: index, updatedAt: now };
    });
  }

  function descendants(nodeId) {
    const found = [];
    const stack = [nodeId];
    while (stack.length) {
      const current = stack.pop();
      for (const child of Object.values(document.nodes).filter((node) => node.parentId === current)) {
        found.push(child.id);
        stack.push(child.id);
      }
    }
    return found;
  }

  function arrange(focusNodeId = rootId) {
    const nodes = { ...document.nodes };
    const root = nodes[rootId];
    nodes[rootId] = { ...root, x: 0, y: 0 };

    const rootSpacingX = 320;
    const childSpacingX = 240;
    const siblingSpacingY = 132;

    function children(parentId) {
      return Object.values(nodes)
        .filter((node) => node.parentId === parentId)
        .sort((a, b) => a.order - b.order || a.y - b.y);
    }

    function subtreeHeight(nodeId) {
      const node = nodes[nodeId];
      if (!node || node.collapsed) return 1;
      const list = children(nodeId);
      if (!list.length) return 1;
      return Math.max(1, list.reduce((sum, child) => sum + subtreeHeight(child.id), 0));
    }

    function place(parentId, startY) {
      const parent = nodes[parentId];
      const list = children(parentId);
      if (!parent || !list.length) return;
      const total = list.reduce((sum, child) => sum + subtreeHeight(child.id), 0);
      let cursor = startY - ((total - 1) * siblingSpacingY) / 2;
      for (const child of list) {
        const units = subtreeHeight(child.id);
        const centerY = cursor + ((units - 1) * siblingSpacingY) / 2;
        nodes[child.id] = {
          ...nodes[child.id],
          x: parent.x + (parentId === rootId ? rootSpacingX : childSpacingX),
          y: centerY
        };
        place(child.id, centerY);
        cursor += units * siblingSpacingY;
      }
    }

    place(rootId, 0);

    if (focusNodeId !== rootId && nodes[focusNodeId] && document.nodes[focusNodeId]) {
      const drift = document.nodes[focusNodeId].y - nodes[focusNodeId].y;
      if (Math.abs(drift) > 0.5) {
        Object.values(nodes).forEach((node) => {
          if (node.id !== rootId) {
            nodes[node.id] = { ...node, y: node.y + drift };
          }
        });
      }
    }

    document = { ...document, nodes, updatedAt: now };
  }

  switch (operation.type) {
    case "document/set":
      document = { ...operation.document, version: document.version + 1, updatedAt: now };
      break;
    case "title/set":
      document = { ...document, title: operation.title, version: document.version + 1, updatedAt: now };
      break;
    case "node/upsert":
      document = {
        ...document,
        nodes: { ...document.nodes, [operation.node.id]: { ...operation.node, updatedAt: now } },
        version: document.version + 1,
        updatedAt: now
      };
      normalizeSiblingOrder(operation.node.parentId);
      arrange(operation.node.parentId ?? rootId);
      break;
    case "node/update": {
      const current = document.nodes[operation.nodeId];
      if (!current) break;
      document = {
        ...document,
        nodes: {
          ...document.nodes,
          [operation.nodeId]: { ...current, ...operation.changes, updatedAt: now }
        },
        version: document.version + 1,
        updatedAt: now
      };
      break;
    }
    case "node/remove": {
      if (operation.nodeId === rootId) break;
      const parentId = document.nodes[operation.nodeId]?.parentId ?? null;
      const nodes = { ...document.nodes };
      [operation.nodeId, ...descendants(operation.nodeId)].forEach((id) => delete nodes[id]);
      document = { ...document, nodes, version: document.version + 1, updatedAt: now };
      normalizeSiblingOrder(parentId);
      arrange(parentId ?? rootId);
      break;
    }
    case "nodes/reorder":
      document = {
        ...document,
        nodes: { ...document.nodes },
        version: document.version + 1,
        updatedAt: now
      };
      operation.orderedIds.forEach((id, index) => {
        if (document.nodes[id] && document.nodes[id].parentId === operation.parentId) {
          document.nodes[id] = { ...document.nodes[id], order: index, updatedAt: now };
        }
      });
      arrange(operation.parentId ?? rootId);
      break;
    case "nodes/arrange":
      document = { ...document, version: document.version + 1 };
      arrange(operation.focusNodeId);
      break;
  }
  return document;
}

async function postJson(url, payload) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function commitOperation(operation) {
  applyOperation(operation);
  postJson("/operation", { clientId: state.clientId, operation }).catch(console.error);
}

function syncPresence() {
  postJson("/presence", {
    clientId: state.clientId,
    name: state.user.name,
    color: state.user.color,
    selectedNodeId: state.selectedNodeId
  }).catch(console.error);
}

function screenToCanvas(clientX, clientY) {
  return {
    x: (clientX - state.viewport.x) / state.viewport.scale,
    y: (clientY - state.viewport.y) / state.viewport.scale
  };
}

function createChild(parentId) {
  const parent = state.document.nodes[parentId];
  if (!parent) return;
  const siblings = getChildren(parentId);
  const node = createNode({
    id: `node-${Math.random().toString(36).slice(2, 10)}`,
    text: "New idea",
    parentId,
    order: siblings.length,
    color: palette[siblings.length % palette.length]
  });
  state.selectedNodeId = node.id;
  commitOperation({ type: "node/upsert", node });
  syncPresence();
}

function createSibling(nodeId) {
  const current = state.document.nodes[nodeId];
  if (!current || !current.parentId) return;
  const ids = getSiblingIds(current.parentId);
  const index = ids.indexOf(nodeId);
  const newId = `node-${Math.random().toString(36).slice(2, 10)}`;
  ids.splice(index + 1, 0, newId);
  const node = createNode({
    id: newId,
    text: "New sibling",
    parentId: current.parentId,
    order: index + 1,
    color: current.color
  });
  state.selectedNodeId = newId;
  commitOperation({
    type: "document/set",
    document: applyOperationLocal(
      applyOperationLocal(structuredClone(state.document), { type: "node/upsert", node }),
      { type: "nodes/reorder", parentId: current.parentId, orderedIds: ids }
    )
  });
  syncPresence();
}

function moveNodeAmongSiblings(nodeId, direction) {
  const node = state.document.nodes[nodeId];
  if (!node) return;
  const ids = getSiblingIds(node.parentId);
  const currentIndex = ids.indexOf(nodeId);
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= ids.length) return;
  const nextIds = [...ids];
  const [moved] = nextIds.splice(currentIndex, 1);
  nextIds.splice(targetIndex, 0, moved);
  commitOperation({ type: "nodes/reorder", parentId: node.parentId, orderedIds: nextIds });
}

function indentNode(nodeId) {
  const node = state.document.nodes[nodeId];
  if (!node?.parentId) return;
  const siblings = getSiblingIds(node.parentId);
  const currentIndex = siblings.indexOf(nodeId);
  if (currentIndex <= 0) return;
  const previousSibling = state.document.nodes[siblings[currentIndex - 1]];
  if (!previousSibling) return;
  const nodeUpdate = { ...node, parentId: previousSibling.id, order: getChildren(previousSibling.id).length };
  commitOperation({ type: "node/upsert", node: nodeUpdate });
  if (previousSibling.collapsed) {
    commitOperation({ type: "node/update", nodeId: previousSibling.id, changes: { collapsed: false } });
  }
}

function outdentNode(nodeId) {
  const node = state.document.nodes[nodeId];
  if (!node?.parentId || node.parentId === rootId) return;
  const parent = state.document.nodes[node.parentId];
  if (!parent?.parentId) return;
  const ids = getSiblingIds(parent.parentId);
  const parentIndex = ids.indexOf(parent.id);
  ids.splice(parentIndex + 1, 0, nodeId);
  const nodeUpdate = { ...node, parentId: parent.parentId, order: parentIndex + 1 };
  commitOperation({
    type: "document/set",
    document: applyOperationLocal(
      applyOperationLocal(structuredClone(state.document), { type: "node/upsert", node: nodeUpdate }),
      { type: "nodes/reorder", parentId: parent.parentId, orderedIds: ids.filter((id, idx, arr) => arr.indexOf(id) === idx) }
    )
  });
}

function removeSelectedNode() {
  if (state.selectedNodeId === rootId) return;
  commitOperation({ type: "node/remove", nodeId: state.selectedNodeId });
  state.selectedNodeId = rootId;
  syncPresence();
}

function toggleCollapse(nodeId) {
  const node = state.document.nodes[nodeId];
  if (!node) return;
  commitOperation({ type: "node/update", nodeId, changes: { collapsed: !node.collapsed } });
}

function renderOutline(nodeId, depth) {
  const node = state.document.nodes[nodeId];
  const children = getChildren(nodeId);
  const watchers = state.presence.filter((member) => member.selectedNodeId === nodeId);
  const branch = document.createElement("div");
  branch.className = "outline-branch";

  const row = document.createElement("div");
  row.className = `outline-row ${state.selectedNodeId === nodeId ? "active" : ""}`;
  row.style.paddingLeft = `${depth * 18 + 10}px`;

  const toggle = document.createElement("button");
  toggle.className = "tree-toggle";
  toggle.textContent = children.length ? (node.collapsed ? "+" : "-") : "•";
  toggle.onclick = () => {
    state.selectedNodeId = nodeId;
    syncPresence();
    render();
  };

  const input = document.createElement("input");
  input.className = "outline-input";
  input.value = node.text;
  input.onfocus = () => {
    state.selectedNodeId = nodeId;
    syncPresence();
    render();
  };
  input.oninput = (event) => {
    commitOperation({ type: "node/update", nodeId, changes: { text: event.target.value } });
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createSibling(nodeId);
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      outdentNode(nodeId);
    } else if (event.key === "Tab") {
      event.preventDefault();
      indentNode(nodeId);
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveNodeAmongSiblings(nodeId, -1);
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveNodeAmongSiblings(nodeId, 1);
    }
  };

  const presence = document.createElement("div");
  presence.className = "mini-presence";
  watchers.forEach((member) => {
    const dot = document.createElement("span");
    dot.className = "mini-presence-dot";
    dot.style.background = member.color;
    dot.title = member.name;
    presence.appendChild(dot);
  });

  row.append(toggle, input, presence);
  branch.appendChild(row);
  if (!node.collapsed) {
    children.forEach((child) => branch.appendChild(renderOutline(child.id, depth + 1)));
  }
  return branch;
}

function render() {
  const app = document.getElementById("app");
  const selectedNode = state.document.nodes[state.selectedNodeId] || state.document.nodes[rootId];
  const visibleNodes = Object.values(state.document.nodes).filter((node) => isVisible(node.id));
  const otherUsers = state.presence.filter((member) => member.name !== state.user.name);

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div>
          <p class="eyebrow">Geonius</p>
          <h1>Shared Mindmap</h1>
          <p class="subtle">Outline-first collaboration with live syncing, branch arranging, and image cards inside nodes.</p>
        </div>
        <div class="panel">
          <div class="panel-row"><span>Status</span><strong class="connected">Live</strong></div>
          <div class="panel-row"><span>You</span><strong>${state.user.name}</strong></div>
          <div class="panel-row"><span>Version</span><strong>${state.document.version}</strong></div>
          <div class="presence-list" id="presence-list"></div>
        </div>
        <div class="panel">
          <div class="panel-heading"><h2>Outline</h2><button class="ghost" id="arrange-all">Arrange</button></div>
          <div class="outline-tree" id="outline-tree"></div>
          <p class="hint">\`Enter\` sibling, \`Tab\` indent, \`Shift+Tab\` outdent, \`Alt+↑/↓\` reorder.</p>
        </div>
        <div class="panel">
          <h2>Selected Node</h2>
          <input class="title-input" id="selected-title" value="${escapeHtml(selectedNode.text)}" />
          <label class="stack">Color<input type="color" id="selected-color" value="${selectedNode.color}" /></label>
          <label class="stack">Image<input type="file" accept="image/*" id="selected-image" /></label>
          <div class="button-row">
            <button id="add-child">Add child</button>
            <button class="ghost" id="add-sibling" ${selectedNode.id === rootId ? "disabled" : ""}>Add sibling</button>
            <button class="ghost" id="toggle-collapse">${selectedNode.collapsed ? "Expand" : "Collapse"}</button>
            <button class="danger" id="delete-node" ${selectedNode.id === rootId ? "disabled" : ""}>Delete</button>
          </div>
          <p class="hint">Canvas shortcuts: \`Tab\` child, \`Space\` collapse, \`Backspace\` delete.</p>
        </div>
      </aside>
      <main class="canvas-shell">
        <div class="toolbar">
          <button id="reset-view">Reset view</button>
          <button class="ghost" id="arrange-branch">Reflow branch</button>
          <span>${Math.round(state.viewport.scale * 100)}%</span>
        </div>
        <div class="canvas" id="canvas">
          <svg class="connections" id="connections"></svg>
          <div class="canvas-viewport" id="canvas-viewport"></div>
        </div>
      </main>
    </div>
  `;

  const presenceList = document.getElementById("presence-list");
  state.presence.forEach((member) => {
    const chip = document.createElement("div");
    chip.className = "presence-chip";
    chip.innerHTML = `<span class="presence-dot" style="background:${member.color}"></span>${escapeHtml(member.name)}`;
    presenceList.appendChild(chip);
  });

  const outlineTree = document.getElementById("outline-tree");
  outlineTree.appendChild(renderOutline(rootId, 0));

  document.getElementById("selected-title").oninput = (event) => {
    commitOperation({ type: "node/update", nodeId: selectedNode.id, changes: { text: event.target.value } });
  };
  document.getElementById("selected-color").oninput = (event) => {
    commitOperation({ type: "node/update", nodeId: selectedNode.id, changes: { color: event.target.value } });
  };
  document.getElementById("selected-image").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    commitOperation({ type: "node/update", nodeId: selectedNode.id, changes: { image: dataUrl } });
  };
  document.getElementById("add-child").onclick = () => createChild(selectedNode.id);
  document.getElementById("add-sibling").onclick = () => createSibling(selectedNode.id);
  document.getElementById("toggle-collapse").onclick = () => toggleCollapse(selectedNode.id);
  document.getElementById("delete-node").onclick = removeSelectedNode;
  document.getElementById("arrange-all").onclick = () => commitOperation({ type: "nodes/arrange" });
  document.getElementById("arrange-branch").onclick = () => commitOperation({ type: "nodes/arrange", focusNodeId: selectedNode.id });
  document.getElementById("reset-view").onclick = () => {
    state.viewport = { x: window.innerWidth / 2, y: 180, scale: 1 };
    render();
  };

  const canvas = document.getElementById("canvas");
  const viewport = document.getElementById("canvas-viewport");
  viewport.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`;

  const connections = document.getElementById("connections");
  connections.innerHTML = `<g transform="translate(${state.viewport.x} ${state.viewport.y}) scale(${state.viewport.scale})"></g>`;
  const g = connections.querySelector("g");
  visibleNodes
    .filter((node) => node.parentId)
    .forEach((node) => {
      const parent = state.document.nodes[node.parentId];
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${parent.x} ${parent.y} C ${parent.x + 105} ${parent.y}, ${node.x - 105} ${node.y}, ${node.x} ${node.y}`);
      path.setAttribute("stroke", "rgba(15, 23, 42, 0.18)");
      path.setAttribute("stroke-width", String(3 / state.viewport.scale));
      path.setAttribute("fill", "none");
      g.appendChild(path);
    });

  visibleNodes.forEach((node) => {
    const card = document.createElement("article");
    card.className = `node-card ${state.selectedNodeId === node.id ? "selected" : ""}`;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.borderColor = node.color;
    card.innerHTML = `
      <span class="node-accent" style="background:${node.color}"></span>
      <div class="node-title-row">
        <h3>${escapeHtml(node.text)}</h3>
        <div class="node-watchers"></div>
      </div>
      ${node.image ? `<img src="${node.image}" alt="${escapeHtml(node.text)}" class="node-image" />` : ""}
      <p>${getChildren(node.id).length} linked ideas</p>
    `;
    otherUsers
      .filter((member) => member.selectedNodeId === node.id)
      .forEach((member) => {
        const dot = document.createElement("span");
        dot.className = "node-watcher";
        dot.style.background = member.color;
        dot.title = member.name;
        card.querySelector(".node-watchers").appendChild(dot);
      });
    card.onpointerdown = (event) => {
      event.stopPropagation();
      state.selectedNodeId = node.id;
      syncPresence();
      const point = screenToCanvas(event.clientX, event.clientY);
      dragState = { nodeId: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y };
      render();
    };
    card.ondblclick = () => createChild(node.id);
    viewport.appendChild(card);
  });

  canvas.onpointerdown = (event) => {
    if (event.target === canvas) {
      state.selectedNodeId = rootId;
      syncPresence();
      panState = { x: event.clientX, y: event.clientY };
      render();
    }
  };
  canvas.onpointermove = (event) => {
    if (dragState) {
      const point = screenToCanvas(event.clientX, event.clientY);
      commitOperation({
        type: "node/update",
        nodeId: dragState.nodeId,
        changes: { x: point.x - dragState.offsetX, y: point.y - dragState.offsetY }
      });
    } else if (panState) {
      state.viewport.x += event.clientX - panState.x;
      state.viewport.y += event.clientY - panState.y;
      panState = { x: event.clientX, y: event.clientY };
      render();
    }
  };
  canvas.onpointerup = () => {
    dragState = null;
    panState = null;
  };
  canvas.onpointerleave = () => {
    dragState = null;
    panState = null;
  };
  canvas.onwheel = (event) => {
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    state.viewport.scale = Math.max(0.45, Math.min(1.8, state.viewport.scale + delta));
    render();
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    createChild(state.selectedNodeId);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    removeSelectedNode();
  } else if (event.key === " ") {
    event.preventDefault();
    toggleCollapse(state.selectedNodeId);
  }
});

async function start() {
  const response = await fetch("/document");
  const payload = await response.json();
  state.document = payload.document;
  state.presence = payload.presence;
  render();
  syncPresence();

  const events = new EventSource(`/events?clientId=${encodeURIComponent(state.clientId)}`);
  events.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "hello" && payload.clientId) {
      state.clientId = payload.clientId;
      localStorage.setItem("geonius-client-id", state.clientId);
    }
    if (payload.type === "presence") {
      state.presence = payload.presence;
      render();
    }
    if (payload.type === "operation") {
      applyOperation(payload.operation);
    }
  };
}

start().catch((error) => {
  document.getElementById("app").innerHTML = `<div style="padding:24px;font-family:sans-serif">Failed to start Geonius: ${escapeHtml(error.message)}</div>`;
});
