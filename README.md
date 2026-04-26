# Geonius Live Mindmap

A collaborative mindmap web app with live multi-user editing, image attachments, draggable nodes, collapse/expand behavior, and simple shared presence.

## What it does

- Live sync between connected users with `Socket.IO`
- Mindmap nodes with parent/child structure
- Drag nodes around the canvas
- Collapse and expand branches
- Attach images directly to nodes
- Shared presence list showing active collaborators
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

## Production build

```bash
npm run build
npm run start
```

## Notes

- The frontend reads `VITE_SOCKET_URL` if you want the client to connect to a different realtime server.
- The current collaboration model is full-document sync, which is good for an MVP. If you want true Google-Docs-style conflict handling later, the next upgrade path would be a CRDT layer like `Yjs`.
