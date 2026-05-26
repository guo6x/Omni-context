# 90-Second Demo Script

**Goal**: Show someone what Omni-Context does and convince them to install it.

**What you need**: Windows machine with Omni-Context installed, Claude Desktop with MCP configured, 3 sample files ready.

**Recording tool**: [OBS Studio](https://obsproject.com/) (free) or [Loom](https://www.loom.com/) (quick). Record 1920x1080 at 30fps. No audio needed — captions optional.

---

## Shot list

### 00:00 — The problem (5s)

| Screen | Action |
|--------|--------|
| Claude Desktop, fresh conversation | Type: "Tell me about me — what projects am I working on? What decisions have I made recently?" |

Claude responds: *"I don't know anything about you. I can only work with what you share in this conversation."*

### 00:05 — The setup (10s)

| Screen | Action |
|--------|--------|
| Omni-Context main window | Switch to Omni. Show the MCP tab in Settings — Claude Desktop is already configured (one click). |

Caption: *"Omni-Context — local knowledge graph over MCP. Download, install, 2 clicks to plug into any AI."*

### 00:15 — Feed it (30s)

| Screen | Action |
|--------|--------|
| Omni graph view (empty) | Drag 3 files onto the window: (1) a project README, (2) a technical decision log, (3) a code review note. |

Show the file drop feedback. Switch to graph view. **Show the graph populating** — entities and relationships appearing in the 3D visualization. Click one node to show its details (type, connections, description).

Caption: *"Drag anything in. Files, screenshots, web pages. It extracts entities and relationships into a local knowledge graph."*

### 00:45 — The payoff (25s)

| Screen | Action |
|--------|--------|
| Switch back to Claude Desktop | New conversation. Type the exact same question: "Tell me about me — what projects am I working on? What decisions have I made recently?" |

Claude calls `unified_memory_search` and responds with:
- Your role and current projects
- Recent decisions you've made
- Key principles you follow
- Cites specific entities by name

Caption: *"Every MCP-compatible AI now shares the same brain. Same knowledge. Forever yours."*

### 01:10 — Close (10s)

| Screen | Action |
|--------|--------|
| Full-screen card | Text: "Omni-Context — Long-term memory for any AI. Runs on your machine." |
| | Below: GitHub URL + "Download for Windows" |

Fade to black.

---

## Pre-flight checklist

- [ ] Claude Desktop installed and MCP configured for Omni-Context
- [ ] Omni-Context running (brain-server online)
- [ ] Graph is initially empty (reset if needed)
- [ ] 3 sample files ready on desktop: one project doc, one decision log, one code note
- [ ] OBS/Loom set to 1920x1080, 30fps
- [ ] Close unnecessary windows, notifications silenced
- [ ] Test run once before recording

## Tips

- **Don't narrate live.** Record the screen, then add captions. Keeps it clean.
- **15s clip for README.** Cut a 15-second excerpt (00:15-00:30 — the graph populating) for the README hero GIF.
- **Keep it under 100s.** If it goes over, speed up the drag-and-drop section.
- **Show the graph.** That's the visual hook — people need to *see* the knowledge graph growing.
