const palette = ["#111827", "#d1d5db", "#f3f4f6", "#e5e7eb", "#cbd5e1", "#ddd6fe"];
const rootId = "root";
const localWorkspaceKey = "geonius-personal-workspace";
const localViewModeKey = "geonius-view-mode";

const state = {
  workspace: null,
  presence: [],
  selectedNoteId: null,
  selectedNodeId: rootId,
  focusEditorNodeId: null,
  editingNodeId: null,
  selectAllOnFocus: false,
  personalMode: true,
  hoveredConnectorNodeId: null,
  viewMode: localStorage.getItem(localViewModeKey) || "mindmap",
  sidebarCollapsed: false,
  expandedFolders: {},
  search: "",
  viewport: { x: window.innerWidth * 0.34, y: 220, scale: 1 },
  clientId: localStorage.getItem("geonius-client-id") || `client-${Math.random().toString(36).slice(2, 10)}`,
  user: {
    name: localStorage.getItem("geonius-user-name") || randomName(),
    color: localStorage.getItem("geonius-user-color") || "#111827"
  }
};

localStorage.setItem("geonius-client-id", state.clientId);
localStorage.setItem("geonius-user-name", state.user.name);
localStorage.setItem("geonius-user-color", state.user.color);

let dragState = null;
let panState = null;
let resizeState = null;
let suppressNodeClickUntil = 0;

function randomName() {
  const animals = ["Fox", "Whale", "Otter", "Panda", "Falcon", "Lynx", "Robin"];
  const adjectives = ["Swift", "Bright", "Calm", "Wild", "Bold", "Mellow", "Nova"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createNode(partial) {
  const stamp = Date.now();
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    text: partial.text,
    order: partial.order ?? 0,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 320,
    height: partial.height ?? (partial.image ? 220 : 52),
    color: partial.color ?? "#111827",
    collapsed: partial.collapsed ?? false,
    image: partial.image,
    createdAt: partial.createdAt ?? stamp,
    updatedAt: stamp
  };
}

function getNodeSize(node) {
  return {
    width: node.width ?? 320,
    height: node.height ?? (node.image ? 220 : 52)
  };
}

function createLocalInitialWorkspace() {
  const stamp = Date.now();
  const folderId = uid("folder");
  const noteId = uid("note");
  const rootNode = createNode({ id: rootId, text: "My Mind Map", color: "#111111", width: 360 });
  const branchOne = createNode({
    id: uid("node"),
    parentId: rootId,
    text: "First branch with more horizontal room for longer text",
    order: 0,
    color: "#d1d5db",
    width: 380
  });
  const branchTwo = createNode({
    id: uid("node"),
    parentId: rootId,
    text: "Second branch with more horizontal room for longer text",
    order: 1,
    color: "#d1d5db",
    width: 380
  });
  const branchThree = createNode({
    id: uid("node"),
    parentId: rootId,
    text: "Third branch with more horizontal room for longer text",
    order: 2,
    color: "#d1d5db",
    width: 380
  });

  const workspace = {
    id: "personal-workspace",
    title: "Geonius",
    version: 1,
    folders: [
      {
        id: folderId,
        name: "My documents",
        noteIds: [noteId],
        createdAt: stamp,
        updatedAt: stamp
      }
    ],
    notes: {
      [noteId]: {
        id: noteId,
        folderId,
        title: "My Mind Map",
        document: {
          id: uid("doc"),
          title: "My Mind Map",
          nodes: {
            [rootId]: rootNode,
            [branchOne.id]: branchOne,
            [branchTwo.id]: branchTwo,
            [branchThree.id]: branchThree
          },
          updatedAt: stamp
        },
        createdAt: stamp,
        updatedAt: stamp
      }
    },
    updatedAt: stamp
  };

  return applyWorkspaceOperationLocally(workspace, { type: "nodes/arrange", noteId, focusNodeId: rootId });
}

function loadPersonalWorkspace() {
  try {
    const raw = localStorage.getItem(localWorkspaceKey);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function savePersonalWorkspace(workspace) {
  try {
    localStorage.setItem(localWorkspaceKey, JSON.stringify(workspace));
  } catch (error) {
    console.error(error);
  }
}

function normalizeWorkspaceAppearance(workspace) {
  if (!workspace?.notes) {
    return workspace;
  }

  const nextNotes = {};
  Object.entries(workspace.notes).forEach(([noteId, note]) => {
    const nextNodes = {};
    Object.entries(note.document.nodes).forEach(([nodeId, node]) => {
      nextNodes[nodeId] = node.image
        ? node
        : {
            ...node,
            height: 52,
            width: Math.max(320, node.width ?? 320)
          };
    });

    nextNotes[noteId] = {
      ...note,
      document: {
        ...note.document,
        nodes: nextNodes
      }
    };
  });

  return {
    ...workspace,
    notes: nextNotes
  };
}

function getResizeDirection(event, element) {
  const rect = element.getBoundingClientRect();
  const edge = 10;
  const nearLeft = event.clientX - rect.left <= edge;
  const nearRight = rect.right - event.clientX <= edge;
  const nearTop = event.clientY - rect.top <= edge;
  const nearBottom = rect.bottom - event.clientY <= edge;

  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearLeft) return "w";
  if (nearRight) return "e";
  if (nearTop) return "n";
  if (nearBottom) return "s";
  return "";
}

function cursorForResizeDirection(direction) {
  switch (direction) {
    case "e":
    case "w":
      return "ew-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "";
  }
}

function getNodeDepth(document, nodeId) {
  let depth = 0;
  let current = document.nodes[nodeId];
  while (current && current.parentId) {
    depth += 1;
    current = document.nodes[current.parentId];
  }
  return depth;
}

function autoGrowNodeCard(card, editor, node, persist = false) {
  const { height: currentHeight } = getNodeSize(node);
  const textAreaPadding = 14;
  const headerHeight = 12;
  const imageHeight = node.image ? Math.max(120, currentHeight - 44) : 0;

  editor.style.height = "0px";
  const nextEditorHeight = Math.max(22, editor.scrollHeight);
  editor.style.height = `${nextEditorHeight}px`;

  const nextHeight = Math.max(
    currentHeight,
    headerHeight + textAreaPadding + nextEditorHeight + (node.image ? imageHeight + 10 : 0)
  );

  card.style.minHeight = `${nextHeight}px`;

  if (persist && nextHeight !== currentHeight) {
    commitOperation(
      {
        type: "node/update",
        noteId: state.selectedNoteId,
        nodeId: node.id,
        changes: { height: nextHeight }
      },
      { render: false }
    );
    node.height = nextHeight;
  }
}

function currentNote() {
  return state.workspace?.notes?.[state.selectedNoteId] ?? null;
}

function currentDocument() {
  return currentNote()?.document ?? null;
}

function currentFolder() {
  const note = currentNote();
  return note ? state.workspace.folders.find((folder) => folder.id === note.folderId) : null;
}

function getChildren(document, parentId) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.y - b.y);
}

function getSiblingIds(document, parentId) {
  return getChildren(document, parentId).map((node) => node.id);
}

function countDescendants(document, nodeId) {
  let total = 0;
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop();
    getChildren(document, current).forEach((child) => {
      total += 1;
      stack.push(child.id);
    });
  }
  return total;
}

function isVisible(document, nodeId) {
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

function filteredNoteIds(folder) {
  if (!state.search.trim()) {
    return folder.noteIds;
  }

  const keyword = state.search.trim().toLowerCase();
  return folder.noteIds.filter((noteId) => state.workspace.notes[noteId]?.title.toLowerCase().includes(keyword));
}

function applyWorkspaceOperationLocally(workspace, operation) {
  const stamp = Date.now();

  function getChildrenLocal(document, parentId) {
    return Object.values(document.nodes)
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.y - b.y);
  }

  function normalizeSiblingOrder(document, parentId) {
    const nodes = { ...document.nodes };
    getChildrenLocal(document, parentId).forEach((node, index) => {
      nodes[node.id] = { ...nodes[node.id], order: index, updatedAt: stamp };
    });
    return { ...document, nodes, updatedAt: stamp };
  }

  function descendants(document, nodeId) {
    const ids = [];
    const stack = [nodeId];
    while (stack.length > 0) {
      const current = stack.pop();
      getChildrenLocal(document, current).forEach((child) => {
        ids.push(child.id);
        stack.push(child.id);
      });
    }
    return ids;
  }

  function arrangeDocument(document, focusNodeId = rootId) {
    if (!document.nodes[rootId]) {
      return document;
    }

    const nodes = { ...document.nodes };
    nodes[rootId] = { ...nodes[rootId], x: 0, y: 0 };
    const columnGapX = 92;
    const siblingGapY = 48;

    function nodeBoxWidth(nodeId) {
      const node = nodes[nodeId];
      if (!node) {
        return 320;
      }
      return Math.max(120, node.width ?? 220);
    }

    function nodeBoxHeight(nodeId) {
      const node = nodes[nodeId];
      if (!node) {
        return 72;
      }
      return Math.max(42, node.height ?? (node.image ? 220 : 52));
    }

    function branchHeight(nodeId) {
      const node = nodes[nodeId];
      if (!node || node.collapsed) {
        return nodeBoxHeight(nodeId);
      }

      const children = getChildrenLocal({ ...document, nodes }, nodeId);
      if (children.length === 0) {
        return nodeBoxHeight(nodeId);
      }

      const childrenHeight = children.reduce((sum, child, index) => {
        return sum + branchHeight(child.id) + (index > 0 ? siblingGapY : 0);
      }, 0);

      return Math.max(nodeBoxHeight(nodeId), childrenHeight);
    }

    const depthById = {};
    let maxDepth = 0;

    function assignDepth(nodeId, depth) {
      depthById[nodeId] = depth;
      maxDepth = Math.max(maxDepth, depth);
      const children = getChildrenLocal({ ...document, nodes }, nodeId);
      children.forEach((child) => assignDepth(child.id, depth + 1));
    }

    assignDepth(rootId, 0);

    const maxWidthByDepth = {};
    Object.keys(depthById).forEach((id) => {
      const depth = depthById[id];
      maxWidthByDepth[depth] = Math.max(maxWidthByDepth[depth] ?? 0, nodeBoxWidth(id));
    });

    const columnCenterXByDepth = { 0: 0 };
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const previousWidth = maxWidthByDepth[depth - 1] ?? 320;
      const currentWidth = maxWidthByDepth[depth] ?? 320;
      columnCenterXByDepth[depth] =
        columnCenterXByDepth[depth - 1] + previousWidth / 2 + currentWidth / 2 + columnGapX;
    }

    function placeChildren(parentId, startY) {
      const parent = nodes[parentId];
      const children = getChildrenLocal({ ...document, nodes }, parentId);
      if (!parent || children.length === 0) {
        return;
      }

      const totalHeight = children.reduce((sum, child, index) => {
        return sum + branchHeight(child.id) + (index > 0 ? siblingGapY : 0);
      }, 0);
      let cursor = startY - totalHeight / 2;

      children.forEach((child) => {
        const units = branchHeight(child.id);
        const centerY = cursor + units / 2;
        const childDepth = depthById[child.id] ?? 1;
        nodes[child.id] = {
          ...nodes[child.id],
          x: columnCenterXByDepth[childDepth],
          y: centerY
        };
        placeChildren(child.id, centerY);
        cursor += units + siblingGapY;
      });
    }

    placeChildren(rootId, 0);

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

    return { ...document, nodes, updatedAt: stamp };
  }

  function withNote(noteId, updater) {
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
          updatedAt: stamp
        }
      },
      updatedAt: stamp
    };
  }

  function applyDocumentOperation(document, docOperation) {
    switch (docOperation.type) {
      case "document/title":
        return {
          ...document,
          title: docOperation.title,
          updatedAt: stamp
        };
      case "node/upsert": {
        const nextDocument = {
          ...document,
          nodes: {
            ...document.nodes,
            [docOperation.node.id]: {
              ...docOperation.node,
              updatedAt: stamp
            }
          },
          updatedAt: stamp
        };
        return arrangeDocument(normalizeSiblingOrder(nextDocument, docOperation.node.parentId), docOperation.node.parentId ?? rootId);
      }
      case "node/update": {
        const current = document.nodes[docOperation.nodeId];
        if (!current) {
          return document;
        }
        const nextDocument = {
          ...document,
          nodes: {
            ...document.nodes,
            [docOperation.nodeId]: {
              ...current,
              ...docOperation.changes,
              updatedAt: stamp
            }
          },
          updatedAt: stamp
        };
        if (
          "collapsed" in (docOperation.changes || {}) ||
          "width" in (docOperation.changes || {}) ||
          "height" in (docOperation.changes || {})
        ) {
          return arrangeDocument(nextDocument, docOperation.nodeId);
        }
        return nextDocument;
      }
      case "node/remove": {
        if (docOperation.nodeId === rootId) {
          return document;
        }
        const parentId = document.nodes[docOperation.nodeId]?.parentId ?? null;
        const nextNodes = { ...document.nodes };
        [docOperation.nodeId, ...descendants(document, docOperation.nodeId)].forEach((id) => delete nextNodes[id]);
        return arrangeDocument(
          normalizeSiblingOrder(
            {
              ...document,
              nodes: nextNodes,
              updatedAt: stamp
            },
            parentId
          )
        );
      }
      case "nodes/reorder": {
        const nextNodes = { ...document.nodes };
        docOperation.orderedIds.forEach((id, index) => {
          if (nextNodes[id] && nextNodes[id].parentId === docOperation.parentId) {
            nextNodes[id] = { ...nextNodes[id], order: index, updatedAt: stamp };
          }
        });
        return arrangeDocument(
          {
            ...document,
            nodes: nextNodes,
            updatedAt: stamp
          },
          docOperation.parentId ?? rootId
        );
      }
      case "nodes/arrange":
        return arrangeDocument(document, docOperation.focusNodeId);
      default:
        return document;
    }
  }

  switch (operation.type) {
    case "workspace/set":
      return {
        ...operation.workspace,
        version: workspace.version + 1,
        updatedAt: stamp
      };
    case "folder/create": {
      const folderId = operation.folderId || uid("folder");
      return {
        ...workspace,
        folders: [
          ...workspace.folders,
          {
            id: folderId,
            name: operation.name || "New folder",
            noteIds: [],
            createdAt: stamp,
            updatedAt: stamp
          }
        ],
        version: workspace.version + 1,
        updatedAt: stamp
      };
    }
    case "folder/update":
      return {
        ...workspace,
        folders: workspace.folders.map((folder) =>
          folder.id === operation.folderId ? { ...folder, ...operation.changes, updatedAt: stamp } : folder
        ),
        version: workspace.version + 1,
        updatedAt: stamp
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
        updatedAt: stamp
      };
    }
    case "note/create": {
      const noteId = operation.noteId || uid("note");
      const title = operation.title || "Untitled note";
      const folderId = operation.folderId;
      const rootNode = createNode({ id: rootId, text: title, color: "#111111" });
      const note = {
        id: noteId,
        folderId,
        title,
        document: {
          id: uid("doc"),
          title,
          nodes: { [rootId]: rootNode },
          updatedAt: stamp
        },
        createdAt: stamp,
        updatedAt: stamp
      };
      return {
        ...workspace,
        folders: workspace.folders.map((folder) =>
          folder.id === folderId ? { ...folder, noteIds: [...folder.noteIds, noteId], updatedAt: stamp } : folder
        ),
        notes: {
          ...workspace.notes,
          [noteId]: note
        },
        version: workspace.version + 1,
        updatedAt: stamp
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
            ? { ...folder, noteIds: folder.noteIds.filter((id) => id !== operation.noteId), updatedAt: stamp }
            : folder
        ),
        notes: nextNotes,
        version: workspace.version + 1,
        updatedAt: stamp
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
            updatedAt: stamp
          }
        },
        version: workspace.version + 1,
        updatedAt: stamp
      };
    case "document/title":
    case "node/upsert":
    case "node/update":
    case "node/remove":
    case "nodes/reorder":
    case "nodes/arrange":
      return {
        ...withNote(operation.noteId, (note) => ({
          ...note,
          document: applyDocumentOperation(note.document, operation)
        })),
        version: workspace.version + 1
      };
    default:
      return workspace;
  }
}

async function postJson(url, payload) {
  if (state.personalMode) {
    return;
  }
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function ensureValidSelection() {
  if (!state.workspace) {
    return;
  }

  if (!state.workspace.notes[state.selectedNoteId]) {
    const fallbackNoteId =
      state.workspace.folders.find((folder) => folder.noteIds.length > 0)?.noteIds?.[0] ??
      Object.keys(state.workspace.notes)[0] ??
      null;
    state.selectedNoteId = fallbackNoteId;
    state.selectedNodeId = rootId;
  }
}

function commitOperation(operation, options = {}) {
  const shouldRender = options.render !== false;
  state.workspace = applyWorkspaceOperationLocally(state.workspace, operation);
  savePersonalWorkspace(state.workspace);
  ensureValidSelection();
  if (shouldRender) {
    render();
  }
  if (!state.personalMode) {
    postJson("/operation", { clientId: state.clientId, operation }).catch(console.error);
  }
}

function beginEditingNode(nodeId, selectAll = false) {
  state.selectedNodeId = nodeId;
  state.focusEditorNodeId = nodeId;
  state.editingNodeId = nodeId;
  state.selectAllOnFocus = selectAll;
  syncPresence();
  render();
}

function syncPresence() {
  if (state.personalMode) {
    return;
  }
  postJson("/presence", {
    clientId: state.clientId,
    name: state.user.name,
    color: state.user.color,
    selectedNoteId: state.selectedNoteId,
    selectedNodeId: state.selectedNodeId
  }).catch(console.error);
}

function setSelectedNote(noteId) {
  if (!state.workspace.notes[noteId]) {
    return;
  }
  state.selectedNoteId = noteId;
  state.selectedNodeId = rootId;
  state.viewport = { x: window.innerWidth * 0.34, y: 220, scale: 1 };
  syncPresence();
  render();
}

function createFolder() {
  const name = window.prompt("Folder name", "New folder");
  if (!name) {
    return;
  }
  commitOperation({ type: "folder/create", name });
}

function deleteFolder(folderId) {
  commitOperation({ type: "folder/delete", folderId });
}

function createNote(folderId) {
  const title = window.prompt("Note name", "Untitled note");
  if (!title) {
    return;
  }
  const noteId = uid("note");
  commitOperation({ type: "note/create", folderId, title, noteId });
  state.selectedNoteId = noteId;
  state.selectedNodeId = rootId;
  syncPresence();
  render();
}

function deleteNote(noteId) {
  commitOperation({ type: "note/delete", noteId });
}

function createChildNode(parentId) {
  const document = currentDocument();
  if (!document) {
    return;
  }

  const siblings = getChildren(document, parentId);
  const parent = document.nodes[parentId];
  const node = createNode({
    id: uid("node"),
    parentId,
    text: "New idea",
    order: siblings.length,
    color: parentId === rootId ? "#d1d5db" : "#ffffff",
    height: 52
  });
  state.selectedNodeId = node.id;
  state.focusEditorNodeId = node.id;
  commitOperation({ type: "node/upsert", noteId: state.selectedNoteId, node });
  syncPresence();
}

function createImageNode(parentId, image) {
  const document = currentDocument();
  if (!document) {
    return;
  }

  const siblings = getChildren(document, parentId);
  const node = createNode({
    id: uid("node"),
    parentId,
    text: "Image",
    order: siblings.length,
    color: parentId === rootId ? "#d1d5db" : "#ffffff",
    width: 280,
    height: 220,
    image
  });
  state.selectedNodeId = node.id;
  state.focusEditorNodeId = node.id;
  commitOperation({ type: "node/upsert", noteId: state.selectedNoteId, node });
  syncPresence();
}

function createSiblingNode(nodeId) {
  const document = currentDocument();
  if (!document) {
    return;
  }
  const current = document.nodes[nodeId];
  if (!current || !current.parentId) {
    return;
  }
  const siblingIds = getSiblingIds(document, current.parentId);
  const currentIndex = siblingIds.indexOf(nodeId);
  const newId = uid("node");
  siblingIds.splice(currentIndex + 1, 0, newId);
  const node = createNode({
    id: newId,
    parentId: current.parentId,
    text: "New sibling",
    order: currentIndex + 1,
    color: current.color,
    height: 52
  });
  state.selectedNodeId = newId;
  state.focusEditorNodeId = newId;
  const nextWorkspace = applyWorkspaceOperationLocally(
    applyWorkspaceOperationLocally(state.workspace, { type: "node/upsert", noteId: state.selectedNoteId, node }),
    { type: "nodes/reorder", noteId: state.selectedNoteId, parentId: current.parentId, orderedIds: siblingIds }
  );
  commitOperation({ type: "workspace/set", workspace: nextWorkspace });
  syncPresence();
}

function isAncestorNode(document, ancestorId, nodeId) {
  let current = document.nodes[nodeId];
  while (current && current.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = document.nodes[current.parentId];
  }
  return false;
}

function moveNodeToParent(nodeId, nextParentId) {
  const document = currentDocument();
  if (!document) {
    return;
  }

  const node = document.nodes[nodeId];
  const nextParent = document.nodes[nextParentId];
  if (!node || !nextParent || nodeId === rootId || node.parentId === nextParentId) {
    return;
  }
  if (isAncestorNode(document, nodeId, nextParentId)) {
    return;
  }

  const nextOrder = getChildren(document, nextParentId).length;
  const movedNode = {
    ...node,
    parentId: nextParentId,
    order: nextOrder
  };

  commitOperation({
    type: "node/upsert",
    noteId: state.selectedNoteId,
    node: movedNode
  });
}

function deleteSelectedNode() {
  if (state.selectedNodeId === rootId) {
    return;
  }
  commitOperation({ type: "node/remove", noteId: state.selectedNoteId, nodeId: state.selectedNodeId });
  state.selectedNodeId = rootId;
  syncPresence();
}

function toggleCollapse(nodeId) {
  const document = currentDocument();
  const node = document?.nodes?.[nodeId];
  if (!node) {
    return;
  }
  commitOperation({
    type: "node/update",
    noteId: state.selectedNoteId,
    nodeId,
    changes: { collapsed: !node.collapsed }
  });
  if (state.editingNodeId === nodeId) {
    state.editingNodeId = null;
  }
}

function moveSibling(nodeId, direction) {
  const document = currentDocument();
  if (!document) {
    return;
  }
  const node = document.nodes[nodeId];
  if (!node) {
    return;
  }
  const ids = getSiblingIds(document, node.parentId);
  const currentIndex = ids.indexOf(nodeId);
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= ids.length) {
    return;
  }
  const reordered = [...ids];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  commitOperation({
    type: "nodes/reorder",
    noteId: state.selectedNoteId,
    parentId: node.parentId,
    orderedIds: reordered
  });
}

function indentNode(nodeId) {
  const document = currentDocument();
  if (!document) {
    return;
  }
  const node = document.nodes[nodeId];
  if (!node?.parentId) {
    return;
  }
  const siblings = getSiblingIds(document, node.parentId);
  const currentIndex = siblings.indexOf(nodeId);
  if (currentIndex <= 0) {
    return;
  }
  const previousSibling = document.nodes[siblings[currentIndex - 1]];
  const nodeUpdate = {
    ...node,
    parentId: previousSibling.id,
    order: getChildren(document, previousSibling.id).length
  };
  commitOperation({ type: "node/upsert", noteId: state.selectedNoteId, node: nodeUpdate });
}

function outdentNode(nodeId) {
  const document = currentDocument();
  if (!document) {
    return;
  }
  const node = document.nodes[nodeId];
  if (!node?.parentId || node.parentId === rootId) {
    return;
  }
  const parent = document.nodes[node.parentId];
  if (!parent?.parentId) {
    return;
  }
  const upperIds = getSiblingIds(document, parent.parentId);
  const parentIndex = upperIds.indexOf(parent.id);
  upperIds.splice(parentIndex + 1, 0, nodeId);
  const nodeUpdate = {
    ...node,
    parentId: parent.parentId,
    order: parentIndex + 1
  };
  const nextWorkspace = applyWorkspaceOperationLocally(
    applyWorkspaceOperationLocally(state.workspace, { type: "node/upsert", noteId: state.selectedNoteId, node: nodeUpdate }),
    { type: "nodes/reorder", noteId: state.selectedNoteId, parentId: parent.parentId, orderedIds: upperIds.filter((id, index, array) => array.indexOf(id) === index) }
  );
  commitOperation({ type: "workspace/set", workspace: nextWorkspace });
}

function selectedNode() {
  const document = currentDocument();
  return document?.nodes?.[state.selectedNodeId] ?? document?.nodes?.[rootId] ?? null;
}

function screenToCanvas(clientX, clientY) {
  return {
    x: (clientX - state.viewport.x) / state.viewport.scale,
    y: (clientY - state.viewport.y) / state.viewport.scale
  };
}

function flattenDocumentForNotes(document, nodeId = rootId, depth = 0, rows = []) {
  const node = document.nodes[nodeId];
  if (!node) {
    return rows;
  }

  rows.push({ node, depth });
  getChildren(document, nodeId).forEach((child) => flattenDocumentForNotes(document, child.id, depth + 1, rows));
  return rows;
}

function renderNoteMode() {
  const note = currentNote();
  const documentModel = currentDocument();
  if (!note || !documentModel) {
    return;
  }

  const outlineEl = document.getElementById("note-mode-surface");
  if (!outlineEl) {
    return;
  }

  outlineEl.innerHTML = "";
  const rows = flattenDocumentForNotes(documentModel);

  rows.forEach(({ node, depth }) => {
    const row = document.createElement("div");
    row.className = `note-outline-row ${state.selectedNodeId === node.id ? "selected" : ""}`;
    row.style.setProperty("--note-depth", String(depth));

    row.innerHTML = `
      <div class="note-bullet">•</div>
      <textarea class="note-outline-editor" rows="1">${escapeHtml(node.text)}</textarea>
      ${node.image ? `<img class="note-outline-image" src="${node.image}" alt="${escapeHtml(node.text)}" />` : ""}
    `;

    const editor = row.querySelector(".note-outline-editor");
    const grow = () => {
      editor.style.height = "0px";
      editor.style.height = `${Math.max(24, editor.scrollHeight)}px`;
    };

    row.onpointerdown = (event) => {
      if (!event.target.closest(".note-outline-editor")) {
        state.selectedNodeId = node.id;
        state.editingNodeId = null;
        renderNoteMode();
      }
    };

    editor.onfocus = () => {
      state.selectedNodeId = node.id;
      state.editingNodeId = node.id;
    };

    editor.oninput = (event) => {
      const value = event.target.value;
      grow();
      if (node.id === rootId) {
        commitOperation({ type: "note/update", noteId: state.selectedNoteId, changes: { title: value } }, { render: false });
        commitOperation({ type: "node/update", noteId: state.selectedNoteId, nodeId: rootId, changes: { text: value } }, { render: false });
      } else {
        commitOperation({ type: "node/update", noteId: state.selectedNoteId, nodeId: node.id, changes: { text: value } }, { render: false });
      }
    };

    editor.onkeydown = (event) => {
      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        state.focusEditorNodeId = node.id;
        outdentNode(node.id);
      } else if (event.key === "Tab") {
        event.preventDefault();
        state.focusEditorNodeId = node.id;
        indentNode(node.id);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (node.id === rootId) {
          createChildNode(node.id);
        } else {
          createSiblingNode(node.id);
        }
      }
    };

    editor.onblur = () => {
      state.editingNodeId = null;
      commitOperation({ type: "nodes/arrange", noteId: state.selectedNoteId, focusNodeId: rootId });
    };

    outlineEl.appendChild(row);
    requestAnimationFrame(grow);
  });

  if (state.focusEditorNodeId) {
    const targetRow = Array.from(outlineEl.querySelectorAll(".note-outline-row")).find((row) => row.classList.contains("selected"));
    const targetEditor = targetRow?.querySelector(".note-outline-editor");
    if (targetEditor) {
      requestAnimationFrame(() => {
        targetEditor.focus();
        const length = targetEditor.value.length;
        targetEditor.setSelectionRange(length, length);
      });
    }
    state.focusEditorNodeId = null;
  }
}

function renderSidebar() {
  return `
    <div class="sidebar-rail">
      <button class="rail-button" id="toggle-sidebar">${state.sidebarCollapsed ? ">" : "<"}</button>
      <button class="rail-button" id="create-folder-rail">+</button>
    </div>
    <aside class="sidebar ${state.sidebarCollapsed ? "collapsed" : ""}">
      <div class="sidebar-top">
        <div class="sidebar-logo">
          <span class="logo-dot"></span>
          <strong>Geonius</strong>
        </div>
        <button class="dark-button" id="create-folder">New folder</button>
      </div>
      <div class="search-shell">
        <input class="search-input" id="search-input" placeholder="Search notes" value="${escapeHtml(state.search)}" />
      </div>
      <div class="folder-list" id="folder-list"></div>
      <div class="sidebar-footer">
        <div class="presence-strip" id="presence-strip"></div>
      </div>
    </aside>
  `;
}

function renderMainShell(note, folder) {
  return `
    <main class="workspace-main">
      <header class="topbar">
        <div class="topbar-left">
          <div class="breadcrumbs">${escapeHtml(folder?.name || "Folder")} /</div>
          <input class="note-title-input" id="note-title-input" value="${escapeHtml(note.title)}" />
        </div>
        <div class="topbar-right">
          <button class="mode-pill ${state.viewMode === "mindmap" ? "active" : ""}" id="mindmap-mode">Mind Map</button>
          <button class="mode-pill ${state.viewMode === "note" ? "active" : ""}" id="note-mode">Note Mode</button>
          <div class="avatar-stack" id="avatar-stack"></div>
        </div>
      </header>
      <section class="canvas-frame">
        ${state.viewMode === "mindmap" ? `<div class="canvas" id="canvas"><svg class="connections" id="connections"></svg><div class="canvas-viewport" id="canvas-viewport"></div></div>` : `<div class="note-mode-surface" id="note-mode-surface"></div>`}
      </section>
    </main>
  `;
}

function renderFolderTree() {
  const folderList = document.getElementById("folder-list");
  folderList.innerHTML = "";

  state.workspace.folders.forEach((folder) => {
    const noteIds = filteredNoteIds(folder);
    if (state.search.trim() && noteIds.length === 0 && !folder.name.toLowerCase().includes(state.search.toLowerCase())) {
      return;
    }

    const expanded = state.expandedFolders[folder.id] !== false;
    const folderEl = document.createElement("section");
    folderEl.className = "folder-card";

    const header = document.createElement("div");
    header.className = "folder-header";
    header.innerHTML = `
      <button class="folder-toggle">${expanded ? "v" : ">"}</button>
      <input class="folder-name-input" value="${escapeHtml(folder.name)}" />
      <div class="folder-tools">
        <button class="folder-add-note">+</button>
        <button class="folder-delete-button" title="Delete folder">x</button>
      </div>
    `;

    header.querySelector(".folder-toggle").onclick = () => {
      state.expandedFolders[folder.id] = !expanded;
      render();
    };

    header.querySelector(".folder-add-note").onclick = () => createNote(folder.id);
    header.querySelector(".folder-delete-button").onclick = () => deleteFolder(folder.id);

    header.querySelector(".folder-name-input").onchange = (event) => {
      commitOperation({
        type: "folder/update",
        folderId: folder.id,
        changes: { name: event.target.value }
      });
    };

    folderEl.appendChild(header);

    if (expanded) {
      const notesEl = document.createElement("div");
      notesEl.className = "note-list";

      noteIds.forEach((noteId) => {
        const note = state.workspace.notes[noteId];
        const noteUsers = state.presence.filter((member) => member.selectedNoteId === noteId);
        const row = document.createElement("div");
        row.className = "note-item-row";
        row.innerHTML = `
          <button class="note-item ${state.selectedNoteId === noteId ? "active" : ""}">
            <span class="note-item-title">${escapeHtml(note.title)}</span>
            <span class="note-user-count">${noteUsers.length > 0 ? noteUsers.length : ""}</span>
          </button>
          <button class="note-delete-button" title="Delete note">x</button>
        `;
        row.querySelector(".note-item").onclick = () => setSelectedNote(noteId);
        row.querySelector(".note-delete-button").onclick = () => deleteNote(noteId);
        notesEl.appendChild(row);
      });

      folderEl.appendChild(notesEl);
    }

    folderList.appendChild(folderEl);
  });
}

function renderPresence() {
  const strip = document.getElementById("presence-strip");
  const stack = document.getElementById("avatar-stack");
  if (strip) {
    strip.innerHTML = "";
  }
  if (stack) {
    stack.innerHTML = "";
  }

  state.presence.forEach((member) => {
    const avatar = document.createElement("div");
    avatar.className = "avatar-chip";
    avatar.style.background = member.color || "#111827";
    avatar.textContent = member.name.slice(0, 1).toUpperCase();
    avatar.title = member.name;
    strip?.appendChild(avatar.cloneNode(true));
    stack?.appendChild(avatar);
  });
}

function renderCanvas() {
  const note = currentNote();
  const documentModel = currentDocument();
  if (!note || !documentModel) {
    return;
  }

  const viewportEl = document.getElementById("canvas-viewport");
  const canvasEl = document.getElementById("canvas");
  const connectionsEl = document.getElementById("connections");
  const currentSelectedNode = selectedNode();
  const visibleNodes = Object.values(documentModel.nodes).filter((node) => isVisible(documentModel, node.id));
  const otherUsers = state.presence.filter((member) => member.socketId !== state.clientId && member.name !== state.user.name);
  const maxWidthByDepth = {};

  Object.values(documentModel.nodes).forEach((node) => {
    const depth = getNodeDepth(documentModel, node.id);
    const { width } = getNodeSize(node);
    maxWidthByDepth[depth] = Math.max(maxWidthByDepth[depth] ?? 0, width);
  });

  viewportEl.innerHTML = "";
  viewportEl.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`;
  connectionsEl.setAttribute("viewBox", `0 0 ${canvasEl.clientWidth || 1600} ${canvasEl.clientHeight || 900}`);

  connectionsEl.innerHTML = `<g transform="translate(${state.viewport.x} ${state.viewport.y}) scale(${state.viewport.scale})"></g>`;
  const group = connectionsEl.querySelector("g");

  visibleNodes
    .filter((node) => node.parentId)
    .forEach((node) => {
      const parent = documentModel.nodes[node.parentId];
      if (!parent) {
        return;
      }
      const childDepth = getNodeDepth(documentModel, node.id);
      const parentSize = getNodeSize(parent);
      const nodeSize = getNodeSize(node);
      const startX = parent.x + parentSize.width / 2;
      const endX = node.x - nodeSize.width / 2;
      const trunkX = node.x - (maxWidthByDepth[childDepth] ?? nodeSize.width) / 2 - 16;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${parent.y} H ${trunkX} V ${node.y} H ${endX}`);
      path.setAttribute("stroke", "#6b7280");
      path.setAttribute("stroke-width", String(2.4 / state.viewport.scale));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("opacity", "0.72");
      path.setAttribute("fill", "none");
      group.appendChild(path);

      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.setAttribute("d", `M ${startX} ${parent.y} H ${trunkX} V ${node.y} H ${endX}`);
      hitPath.setAttribute("stroke", "transparent");
      hitPath.setAttribute("stroke-width", String(18 / state.viewport.scale));
      hitPath.setAttribute("stroke-linecap", "round");
      hitPath.setAttribute("stroke-linejoin", "round");
      hitPath.setAttribute("fill", "none");
      hitPath.style.pointerEvents = "stroke";
      hitPath.onpointerenter = () => {
        if (state.hoveredConnectorNodeId !== node.id) {
          state.hoveredConnectorNodeId = node.id;
          renderCanvas();
        }
      };
      hitPath.onpointerleave = () => {
        if (state.hoveredConnectorNodeId === node.id) {
          state.hoveredConnectorNodeId = null;
          renderCanvas();
        }
      };
      group.appendChild(hitPath);
    });

  visibleNodes.forEach((node) => {
    const { width, height } = getNodeSize(node);
    const isDropTarget =
      dragState?.moved &&
      dragState?.nodeId !== node.id &&
      dragState?.dropTargetId === node.id;
    const connectorHovered = state.hoveredConnectorNodeId === node.id;
    const viewers = otherUsers.filter((member) => member.selectedNoteId === state.selectedNoteId && member.selectedNodeId === node.id);
    const hasChildren = getChildren(documentModel, node.id).length > 0;
    const hiddenCount = node.collapsed ? countDescendants(documentModel, node.id) : 0;
    const isSelected = state.selectedNodeId === node.id;
    const card = document.createElement("article");
    card.className = `map-node ${state.selectedNodeId === node.id ? "selected" : ""} ${node.id === rootId ? "root-node" : ""} ${isDropTarget ? "drop-target" : ""} ${connectorHovered ? "connector-hover" : ""} ${node.collapsed && hiddenCount > 0 ? "collapsed-node" : ""}`;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.borderColor = node.color || "#111827";
    card.style.width = `${width}px`;
    card.style.minHeight = `${height}px`;
    const actionMode = node.collapsed ? "expand" : isSelected ? "add" : hasChildren ? "collapse" : "add";
    const actionLabel = actionMode === "collapse" ? "−" : actionMode === "expand" && hiddenCount > 0 ? String(hiddenCount) : "+";
    const actionTitle = actionMode === "add" ? "Add branch" : actionMode === "expand" ? `Expand ${hiddenCount} hidden ${hiddenCount === 1 ? "node" : "nodes"}` : "Collapse";

    card.innerHTML = `
      <div class="node-row">
        <div class="node-presence">${state.personalMode ? "" : viewers.map((member) => `<span class="node-user-dot" style="background:${member.color}"></span>`).join("")}</div>
      </div>
      <div class="node-actions">
        <button class="node-action-button node-add-button" title="${actionTitle}">${actionLabel}</button>
      </div>
      <textarea class="node-editor" rows="${node.id === rootId ? 1 : Math.max(1, Math.min(6, node.text.length / 18 + 1))}">${escapeHtml(node.text)}</textarea>
      ${node.image ? `<img class="node-image" src="${node.image}" alt="${escapeHtml(node.text)}" />` : ""}
    `;

    card.onpointerdown = (event) => {
      if (event.target.closest(".node-editor") || event.target.closest(".node-action-button")) {
        return;
      }
      event.stopPropagation();
      state.selectedNodeId = node.id;
      syncPresence();
      const resizeDirection = getResizeDirection(event, card);
      if (resizeDirection) {
        resizeState = {
          nodeId: node.id,
          direction: resizeDirection,
          startX: event.clientX,
          startY: event.clientY,
          startNodeX: node.x,
          startNodeY: node.y,
          startWidth: width,
          startHeight: height
        };
        card.style.cursor = cursorForResizeDirection(resizeDirection);
        return;
      }
      dragState = {
        nodeId: node.id,
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        wasSelected: state.selectedNodeId === node.id,
        moved: false,
        dropTargetId: null
      };
    };

    card.onpointermove = (event) => {
      const direction = getResizeDirection(event, card);
      card.style.cursor = cursorForResizeDirection(direction) || "";

      if (dragState && dragState.nodeId === node.id) {
        dragState.pointerX = event.clientX;
        dragState.pointerY = event.clientY;
      }

      if (
        dragState &&
        dragState.nodeId !== node.id &&
        dragState.moved &&
        !isAncestorNode(documentModel, dragState.nodeId, node.id)
      ) {
        if (dragState.dropTargetId !== node.id) {
          dragState.dropTargetId = node.id;
          render();
        }
      }
    };

    card.onclick = (event) => {
      if (Date.now() < suppressNodeClickUntil) {
        return;
      }
      event.stopPropagation();
      if (state.selectedNodeId === node.id) {
        beginEditingNode(node.id, false);
        return;
      }
      state.selectedNodeId = node.id;
      state.editingNodeId = null;
      syncPresence();
      render();
    };

    card.ondblclick = (event) => {
      event.stopPropagation();
      beginEditingNode(node.id, true);
    };

    const editor = card.querySelector(".node-editor");
    editor.onpointerdown = (event) => {
      event.stopPropagation();
    };
    editor.onclick = (event) => {
      event.stopPropagation();
    };
    editor.ondblclick = (event) => {
      event.stopPropagation();
    };
    editor.onfocus = () => {
      state.selectedNodeId = node.id;
       state.editingNodeId = node.id;
      syncPresence();
    };
    editor.oninput = (event) => {
      const text = event.target.value;
      autoGrowNodeCard(card, editor, node, true);
      if (node.id === rootId) {
        commitOperation({
          type: "note/update",
          noteId: state.selectedNoteId,
          changes: { title: text }
        }, { render: false });
        commitOperation({
          type: "node/update",
          noteId: state.selectedNoteId,
          nodeId: rootId,
          changes: { text }
        }, { render: false });
      } else {
        commitOperation({
          type: "node/update",
          noteId: state.selectedNoteId,
          nodeId: node.id,
          changes: { text }
        }, { render: false });
      }
    };
    editor.onkeydown = (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        createSiblingNode(node.id);
      } else if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        outdentNode(node.id);
      } else if (event.key === "Tab") {
        event.preventDefault();
        indentNode(node.id);
      } else if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        moveSibling(node.id, -1);
      } else if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        moveSibling(node.id, 1);
      }
    };
    editor.onblur = () => {
      state.editingNodeId = null;
      commitOperation({
        type: "nodes/arrange",
        noteId: state.selectedNoteId,
        focusNodeId: rootId
      });
    };

    const addButton = card.querySelector(".node-add-button");
    addButton.onpointerdown = (event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    addButton.onpointerup = (event) => {
      event.stopPropagation();
      event.preventDefault();
      state.editingNodeId = null;
      if (actionMode === "add") {
        state.selectedNodeId = node.id;
        syncPresence();
        createChildNode(node.id);
      } else {
        toggleCollapse(node.id);
      }
    };

    if (state.focusEditorNodeId === node.id) {
      requestAnimationFrame(() => {
        editor.focus();
        if (state.selectAllOnFocus) {
          editor.select();
        } else {
          const length = editor.value.length;
          editor.setSelectionRange(length, length);
        }
        autoGrowNodeCard(card, editor, node, false);
      });
      state.focusEditorNodeId = null;
      state.selectAllOnFocus = false;
    }

    requestAnimationFrame(() => {
      autoGrowNodeCard(card, editor, node, false);
    });

    viewportEl.appendChild(card);
  });

  if (dragState?.moved && dragState.dropTargetId) {
    const target = documentModel.nodes[dragState.dropTargetId];
    const dragged = documentModel.nodes[dragState.nodeId];
    if (target && dragged) {
      const targetSize = getNodeSize(target);
      const previewStartX = target.x + targetSize.width / 2;
      const previewStartY = target.y;
      const previewEnd = screenToCanvas(dragState.pointerX, dragState.pointerY);
      const draggedSize = getNodeSize(dragged);
      const previewBoxX = previewEnd.x;
      const previewBoxY = previewEnd.y;
      const previewMidX = previewBoxX - draggedSize.width / 2 - 26;
      const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
      preview.setAttribute("d", `M ${previewStartX} ${previewStartY} H ${previewMidX} V ${previewBoxY} H ${previewBoxX - draggedSize.width / 2}`);
      preview.setAttribute("stroke", "#2563eb");
      preview.setAttribute("stroke-width", String(2.2 / state.viewport.scale));
      preview.setAttribute("stroke-dasharray", String(8 / state.viewport.scale) + " " + String(6 / state.viewport.scale));
      preview.setAttribute("stroke-linecap", "round");
      preview.setAttribute("stroke-linejoin", "round");
      preview.setAttribute("fill", "none");
      preview.setAttribute("opacity", "0.8");
      group.appendChild(preview);

      const ghost = document.createElement("article");
      ghost.className = "map-node drag-ghost";
      ghost.style.left = `${previewBoxX}px`;
      ghost.style.top = `${previewBoxY}px`;
      ghost.style.width = `${draggedSize.width}px`;
      ghost.style.minHeight = `${draggedSize.height}px`;
      ghost.style.borderColor = dragged.color || "#2563eb";
      ghost.innerHTML = `<div class="node-row"></div><div class="node-ghost-text">${escapeHtml(dragged.text || "")}</div>${dragged.image ? `<img class="node-image" src="${dragged.image}" alt="${escapeHtml(dragged.text || "")}" />` : ""}`;
      viewportEl.appendChild(ghost);
    }
  }

  document.getElementById("note-title-input").oninput = (event) => {
    const title = event.target.value;
    commitOperation({ type: "note/update", noteId: state.selectedNoteId, changes: { title } }, { render: false });
    commitOperation({ type: "node/update", noteId: state.selectedNoteId, nodeId: rootId, changes: { text: title } }, { render: false });
  };

  canvasEl.onpointerdown = (event) => {
    if (event.target === canvasEl) {
      state.selectedNodeId = rootId;
      state.editingNodeId = null;
      syncPresence();
      panState = { x: event.clientX, y: event.clientY };
      commitOperation({
        type: "nodes/arrange",
        noteId: state.selectedNoteId,
        focusNodeId: rootId
      });
      render();
    }
  };

  canvasEl.onpointermove = (event) => {
    if (resizeState) {
      const dx = (event.clientX - resizeState.startX) / state.viewport.scale;
      const dy = (event.clientY - resizeState.startY) / state.viewport.scale;
      let nextWidth = resizeState.startWidth;
      let nextHeight = resizeState.startHeight;

      if (resizeState.direction.includes("e")) {
        nextWidth = Math.max(120, resizeState.startWidth + dx);
      }
      if (resizeState.direction.includes("w")) {
        nextWidth = Math.max(120, resizeState.startWidth - dx);
      }
      if (resizeState.direction.includes("s")) {
        nextHeight = Math.max(56, resizeState.startHeight + dy);
      }
      if (resizeState.direction.includes("n")) {
        nextHeight = Math.max(56, resizeState.startHeight - dy);
      }

      commitOperation({
        type: "node/update",
        noteId: state.selectedNoteId,
        nodeId: resizeState.nodeId,
        changes: {
          width: nextWidth,
          height: nextHeight
        }
      });
      return;
    }

    if (dragState) {
      dragState.pointerX = event.clientX;
      dragState.pointerY = event.clientY;
      if (
        !dragState.moved &&
        (Math.abs(event.clientX - dragState.startX) > 4 || Math.abs(event.clientY - dragState.startY) > 4)
      ) {
        dragState.moved = true;
        document.body.classList.add("dragging-map");
        render();
      }
      return;
    }

    if (panState) {
      state.viewport.x += event.clientX - panState.x;
      state.viewport.y += event.clientY - panState.y;
      panState = { x: event.clientX, y: event.clientY };
      render();
    }
  };

  canvasEl.onpointerup = () => {
    const shouldRender = Boolean(resizeState || panState || dragState?.moved);
    resizeState = null;
    if (dragState?.moved && dragState.dropTargetId) {
      moveNodeToParent(dragState.nodeId, dragState.dropTargetId);
    }
    if (dragState?.moved) {
      suppressNodeClickUntil = Date.now() + 180;
    }
    dragState = null;
    panState = null;
    document.body.classList.remove("dragging-map");
    if (shouldRender) {
      render();
    }
  };

  canvasEl.onpointerleave = () => {
    const shouldRender = Boolean(resizeState || dragState?.moved || panState);
    resizeState = null;
    dragState = null;
    panState = null;
    document.body.classList.remove("dragging-map");
    if (shouldRender) {
      render();
    }
  };

  canvasEl.onwheel = (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.022 : 0.022;
      const mouseBefore = screenToCanvas(event.clientX, event.clientY);
      const nextScale = Math.max(0.4, Math.min(2, state.viewport.scale + delta));
      state.viewport.x = event.clientX - mouseBefore.x * nextScale;
      state.viewport.y = event.clientY - mouseBefore.y * nextScale;
      state.viewport.scale = nextScale;
      render();
      return;
    }

    event.preventDefault();
    const panFactor = 0.78;
    state.viewport.x -= event.deltaX * panFactor;
    state.viewport.y -= event.deltaY * panFactor;
    render();
  };
}

function renderEmptyState() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="empty-shell">
      <div class="empty-card">
        <h1>Loading Geonius</h1>
        <p>Preparing your shared mind map workspace.</p>
      </div>
    </div>
  `;
}

function render() {
  const app = document.getElementById("app");
  if (!state.workspace || !state.selectedNoteId || !currentNote()) {
    renderEmptyState();
    return;
  }

  const note = currentNote();
  const folder = currentFolder();
  app.innerHTML = `
    <div class="layout-shell ${state.sidebarCollapsed ? "sidebar-hidden" : ""}">
      ${renderSidebar()}
      ${renderMainShell(note, folder)}
    </div>
  `;

  document.getElementById("toggle-sidebar").onclick = () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    render();
  };
  document.getElementById("create-folder-rail").onclick = createFolder;
  document.getElementById("create-folder").onclick = createFolder;
  document.getElementById("mindmap-mode").onclick = () => {
    state.viewMode = "mindmap";
    localStorage.setItem(localViewModeKey, state.viewMode);
    render();
  };
  document.getElementById("note-mode").onclick = () => {
    state.viewMode = "note";
    localStorage.setItem(localViewModeKey, state.viewMode);
    render();
  };
  document.getElementById("search-input").oninput = (event) => {
    state.search = event.target.value;
    renderFolderTree();
  };

  renderFolderTree();
  if (!state.personalMode) {
    renderPresence();
  }
  if (state.viewMode === "note") {
    renderNoteMode();
  } else {
    renderCanvas();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
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
  if (!state.workspace || !state.selectedNoteId) {
    return;
  }

  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    createChildNode(state.selectedNodeId);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedNode();
  } else if (event.key === " ") {
    event.preventDefault();
    toggleCollapse(state.selectedNodeId);
  }
});

window.addEventListener("paste", async (event) => {
  if (!state.workspace || !state.selectedNoteId) {
    return;
  }

  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    return;
  }

  const file = imageItem.getAsFile();
  if (!file) {
    return;
  }

  event.preventDefault();
  const dataUrl = await fileToDataUrl(file);
  createImageNode(state.selectedNodeId, dataUrl);
});

async function start() {
  renderEmptyState();

  const localWorkspace = loadPersonalWorkspace();
  if (localWorkspace) {
    state.workspace = normalizeWorkspaceAppearance(localWorkspace);
  } else {
    state.workspace = normalizeWorkspaceAppearance(createLocalInitialWorkspace());
    savePersonalWorkspace(state.workspace);
  }
  state.presence = [];
  savePersonalWorkspace(state.workspace);

  const firstFolder = state.workspace.folders[0];
  state.selectedNoteId = firstFolder?.noteIds?.[0] ?? Object.keys(state.workspace.notes)[0] ?? null;
  if (firstFolder) {
    state.expandedFolders[firstFolder.id] = true;
  }

  render();
}

start().catch((error) => {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="empty-shell">
      <div class="empty-card">
        <h1>Unable to start Geonius</h1>
        <p>${escapeHtml(error.message)}</p>
      </div>
    </div>
  `;
});
