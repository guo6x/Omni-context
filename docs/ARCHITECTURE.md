# Architecture

For product vision and feature status, see [PRODUCT-VISION.md](./PRODUCT-VISION.md).

## System overview

Five components, one brain:

```
        [Browser Extension]   [Mobile App]   [ESP32 Button]
              \                    |              /
               \                   |             /
              HTTP/LAN           HTTP/LAN      UDP:9090
                 \                 |           /
                  v                v          v
              ┌─────────────────────────────────────┐
              │         Brain Server (local)         │   ← single source of truth
              │   HTTP API · MCP · SQLite            │
              │   Vector search · Graph · Agent Loop │
              └─────────────────────────────────────┘
                          ^
                          | embedded launch / HTTP
                          v
                  [Desktop Tauri App]   ← main console + system capture

                          ↑
                          | mcp-proxy.js (stdio ↔ HTTP)
                          |
                [Claude Desktop / Cursor / Cline / ...]
                12+ MCP clients, one shared knowledge graph
```

- **Brain Server** is the single data authority. All other components are its "senses" or "interfaces."
- Desktop app launches Brain Server as a child process (bundled Node.js runtime).
- Mobile, extension, and hardware connect over LAN to Brain Server — no local DB.
- External AI clients use `mcp-proxy.js` over stdio, which forwards to local brain-server — all clients share one DB + one LLM config.

## Component stack

| Component | Stack | Purpose |
|---|---|---|
| **Brain Server** | Node.js + SQLite (FTS5 + sqlite-vec) | Entity/relation CRUD, vector search, GraphRAG extraction, proactive agent, blind spot detection, graph-driven insights |
| **Desktop App** | Tauri 1.x + Next.js 14 + Tailwind | Main console, 3D/2D knowledge graph visualizer, floating HUD |
| **Browser Extension** | Manifest V3 (Chrome/Edge) | One-click page/selection capture |
| **MCP Proxy** | Node.js stdio server | Bridges MCP stdio clients to Brain Server HTTP |
| **Mobile App** | React Native + Expo | Read-only search (MVP) |
| **ESP32** | Arduino C++ | Physical trigger button over UDP |

## Communication protocols (actual implementation)

| From → To | Protocol | Notes |
|---|---|---|
| Desktop UI → Brain Server | HTTP (3001) | fetch calls with local API token |
| Browser Extension → Brain Server | HTTP (3001) | LAN, CORS allowed, local token auth |
| Mobile → Brain Server | HTTP (3001) | LAN, pair code auth |
| ESP32 → Desktop | UDP (9090) | One-way trigger only |
| MCP Clients → mcp-proxy.js → Brain Server | stdio + HTTP (3001) | Proxy reads local token from disk |

There is no WebSocket, no mDNS, no cross-process push channel. Clients poll Brain Server's HTTP API. UDP 9090 listens on `127.0.0.1` by default.

## Repository structure

```
omni-context-release/
├── brain-server/              # Brain: HTTP API + MCP + proxy + SQLite + Agent
│   ├── src/mcp-server.ts           # MCP stdio + HTTP dual-mode (desktop embedded entry)
│   ├── src/mcp-proxy.ts            # MCP proxy (clients spawn this)
│   ├── src/mcp-tools.ts            # MCP definitions; generated count in /mcp_tool_manifest.json
│   ├── src/agent/agent-loop.ts     # Agent cycle: consolidate → insight → blind spot → decay
│   ├── src/agent/blindspot-detector.ts  # Cognitive blind spot detection (task 35-1)
│   ├── src/agent/graph-insight.ts       # Graph-driven insight generation (task 35-2)
│   └── src/api/handlers/           # All HTTP endpoints
├── desktop-daemon/            # Desktop: Tauri (Rust) + Next.js frontend
│   └── src-tauri/             # Rust: screen/clipboard capture, UDP, brain-server lifecycle
├── browser-extension/         # Browser extension (Manifest V3)
├── mobile-app/                # Mobile React Native (read-only MVP)
├── hardware/esp32-firmware/   # ESP32 firmware + wiring/BOM docs
├── shared/                    # Shared types/constants across components
├── scripts/                   # Build/packaging scripts
└── docs/
    ├── PRODUCT-VISION.md      # North star document
    ├── ARCHITECTURE.md        # This document
    ├── MCP-INTEGRATION.md     # Third-party AI integration guide
    └── BUILDING.md            # Dev setup
```

## Permissions

| Component | Permissions | Purpose |
|---|---|---|
| Desktop | Screen capture, clipboard, UDP, fs.readFile, window control, open_trusted_external_url (semantic https target ids only) | Capture screen, read clipboard, receive ESP32, drag-and-drop, HUD window, open data dir |
| Extension | Tabs, context menus, notifications | Capture pages, entry points, status |
| Mobile | Local network | Sync with Brain Server (read-only) |
