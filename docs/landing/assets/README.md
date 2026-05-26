# Assets

Place the following files here for the landing page and README:

- **demo.gif** — A 15-second excerpt from the demo video showing the knowledge graph populating. See [docs/DEMO_SCRIPT.md](../DEMO_SCRIPT.md) for recording instructions.
- **social-preview.svg** — Already present. Used by GitHub for link previews.

To generate demo.gif from a video:
```bash
ffmpeg -i demo.mp4 -vf "fps=15,scale=720:-1" -loop 0 demo.gif
```
