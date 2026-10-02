# Travel Journal

A personal travel-planning app with three tabs:

- **🌍 Map** — a spinnable, zoomable 3D globe (powered by [react-globe.gl](https://github.com/vasturiano/react-globe.gl)). Click anywhere to drop a pin with a name, notes, and a color; click an existing pin to edit or delete it. A side panel lists and searches all pinned places.
- **🗓️ Activities** — pick any pinned location and plan activities for it: title, date, notes, and a status (idea / planned / done).
- **✨ Speculations & Wishes** — a freeform bucket list of dream destinations and ideas, optionally linked to a pinned location or just a place name, with tags and notes.

All data is stored locally in your browser (`localStorage`) — no backend or account required.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
