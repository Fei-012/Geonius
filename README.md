# Geonius Live Mindmap

A shared mindmap website with a MuBu-style workspace layout: collapsible sidebar, folders, notes, a large white canvas, inline live editing, draggable nodes, and image attachments.

## What it does

- Shared workspace with folders and notes
- Left rail plus collapsible sidebar
- One click to create folders and notes
- Open any note into a full-screen mindmap canvas
- Edit text directly inside map nodes on the page
- Live collaboration for everyone on the same workspace link
- Drag nodes, collapse branches, reorder branches, indent and outdent
- Attach photos to any selected node
- Server-side persistence in `server/data/workspace.json`

## Run locally

```bash
node server/index.js
```

Then open:

- `http://localhost:3001` on your own computer

If other people are on the same local network, they can use your LAN address shown when the server starts.

## Keyboard shortcuts

- `Tab`: add a child from the canvas
- `Enter`: add a sibling while typing in a node
- `Shift+Tab`: outdent a node while typing
- `Alt+Up/Down`: reorder a node among siblings
- `Space`: collapse or expand the selected node
- `Backspace`: delete the selected node

## Current scope

- Mind map mode is implemented
- Note-mode conversion is intentionally left for later
- For true worldwide sharing, you still need deployment or a tunnel; local and LAN sharing work from this server

## Stable public deployment

For stable live collaboration with friends from anywhere, deploy this app as a single public Node web service with persistent storage.

The repo now includes [render.yaml](/Users/xiangtiange/Desktop/Geonius/render.yaml:1) for Render deployment.

### Why this is the right shape

- This app is a live Node server, not a static website
- It stores shared workspace data on disk
- It should run as one persistent instance so all collaborators see the same shared state

### Deploy on Render

1. Push this repo to GitHub.
2. In Render, create a new Blueprint and point it at this repo.
3. Render will read `render.yaml` automatically.
4. After deploy, open the generated `https://...onrender.com` URL and share that link with your friend.

### Important note

This deployment shape is good for a small shared group and stable co-editing, but it is still a single-server app using a JSON file as storage. If you later want stronger Google-Docs-style reliability, multi-instance scaling, and better conflict handling, the next upgrade is moving shared state into a real datastore and CRDT layer.
