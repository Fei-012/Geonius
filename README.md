# Geonius Live Mindmap

A collaborative mindmap web app with live multi-user editing, image attachments, draggable nodes, collapse/expand behavior, outline-style editing, and shared presence.

## What it does

- Live sync between connected users with `Socket.IO`
- Operation-based sync instead of full-document replacement
- Mindmap nodes with parent/child structure
- Sidebar outline editor with keyboard shortcuts
- Drag nodes around the canvas
- Auto-arrange branches into a cleaner tree layout
- Collapse and expand branches
- Attach images directly to nodes
- Shared presence list plus collaborator indicators on active nodes
- Simple server-side JSON persistence in `server/data/document.json`

## Stack

- React + TypeScript + Vite
- Express + Socket.IO

## Run locally

1. Install a JavaScript package manager and project dependencies.
2. Start the frontend and backend together:

```bash
npm install
npm run dev
```

3. Open the frontend at `http://localhost:5173`
4. Open a second browser tab or device to test live collaboration

The Socket.IO server runs on `http://localhost:3001` by default.

## Keyboard shortcuts

- `Enter`: add sibling from the outline
- `Tab`: indent in the outline, or add child from the canvas
- `Shift+Tab`: outdent in the outline
- `Alt+Up/Down`: reorder within siblings
- `Space`: collapse or expand selected node
- `Backspace`: delete selected node

## Production build

```bash
npm run build
npm run start
```

## Notes

- The frontend reads `VITE_SOCKET_URL` if you want the client to connect to a different realtime server.
- The current collaboration model is operation-based and much safer than full-document syncing, but it is still not a full CRDT. For true Google-Docs-style concurrent text conflict handling, the next upgrade path would be a CRDT layer like `Yjs`.
