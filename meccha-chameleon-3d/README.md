# Meccha Chameleon 3D

A from-scratch, **fully 3D, multiplayer** recreation of the paint-to-blend mechanic from
**めっちゃカメレオン (Meccha Chameleon)**. Paint your blobby body to melt into the room,
host a room and share the code, or play solo against a vision system that scores how well
you blend. Built as a real monorepo you open in VS Code.

> Fan tribute to *Meccha Chameleon* by **Lemorion_1224 & Haganeiro**. Unaffiliated, non-commercial.

---

## Why this stack

Picked for *this* game, not as a generic template:

| Layer | Choice | Why |
|---|---|---|
| Netcode | **Colyseus 0.17** | Authoritative rooms + binary delta state sync + matchmaking by room code. "Host a room, others join by code" is the framework's core model — not hand-rolled on raw WebSockets. |
| Rendering | **Three.js r185** (raw, no R3F) | The render loop owns paint render-targets **and** the vision probe's offscreen passes — leaner imperative than wrapped in React. WebGL2 for reach; WebGPU is a drop-in upgrade. |
| Look | Built-in postprocessing | ACES tone-mapping + IBL (`RoomEnvironment`) + soft shadows + restrained bloom — well past default Three, zero external assets. |
| Painting | Raycast → UV → 2D canvas albedo | Dabs are tiny `(u,v,size,color)` events, so they sync trivially; clients replay them to reconstruct each other's textures. No bitmaps on the wire. |
| Vision | Offscreen render-diff | The hider's silhouette is isolated and its painted pixels are diffed against the background behind them — the 3D evolution of the original's pixel-matching. |
| Build | npm workspaces + TS + Vite | `shared/` holds the wire protocol **and tuning** (speeds, turn rate, texture size, room bounds) — both sides import the same values, so they can't drift. |

```
meccha-chameleon-3d/
├─ shared/   # wire protocol + tuning constants + pure helpers (built first, unit-tested)
├─ server/   # Colyseus GameRoom (rooms, presence, validated movement, paint relay)
└─ client/   # Vite + Three.js + Colyseus SDK (engine, world, avatar, vision, controller, UI)
```

---

## Run it

Requires **Node ≥ 20.9**. (pnpm/yarn work too; commands below use npm.)

```bash
npm install      # installs workspaces; postinstall builds shared so the editor resolves types
npm run dev      # server :2567 + client :5173, concurrently
```

Open **http://localhost:5173**:

- **Create room** → a room code appears top-left (click to copy).
- Second tab / another machine → paste the code into **Join**.
- **Paint solo** → offline, with a live **visibility meter** driven by the vision system.

### Controls
`WASD` move · `Shift` sprint · **right-drag** orbit/aim · `wheel` zoom.
**As a hider:** **left-drag** to paint your body · `E` eyedropper (click a surface to sample its colour) · `T` to **taunt** (2.6× points, but it pings the hunters).
**As a hunter:** **left-click** to shoot the crosshair.

### How a round works
The host presses **Start**. The server assigns roles (~1 hunter per 4 players) and runs a short **prep** phase — hiders paint and reposition while hunters are frozen. Then the **hunt** begins: hiders score every second they're *in a hunter's line of sight but un-shot* — the braver the exposure, the more points, and taunting multiplies it. Hunters shoot to eliminate hiders. The round ends when the timer runs out (hiders survive) or every hider is tagged (hunters win); a scoreboard ranks everyone by score and crowns the top chameleon.

---

## Build, test & deploy

```bash
npm run build    # shared → client (vite) → server (tsc)
npm test         # unit tests for the pure helpers (color packing, circle-vs-AABB)
npm start        # NODE_ENV=production, one Node service on $PORT
```

The production server serves the built client **and** the websocket from the same origin —
the whole game is a **single deploy**:

- **Render / Railway / Fly**: build `npm run build`, start `npm start`. `PORT` is read from the env.
- **Docker**: `docker build -t meccha . && docker run -p 2567:2567 meccha` (Node pinned to 20.9.0).
- The client auto-targets same-origin `wss://` in prod, `ws://<host>:2567` in dev.
- **`/monitor`** (Colyseus dashboard) is open in dev, and in production is mounted **only** if
  `MONITOR_PASSWORD` is set, behind HTTP Basic auth — it is never public by default.
- CI (`.github/workflows/ci.yml`) typechecks, builds all three workspaces, and runs the tests.

---

## What's implemented

**Phase 1 — multiplayer 3D foundation**
- 3D world with IBL, soft shadows, bloom; procedural paintable blob avatar (eyedropper)
- Third-person controller, circle-vs-AABB collision (shared, tested resolver)
- Rooms: create / join by code, live presence, interpolated remotes
- Paint synced across clients as dab events; server-side movement validation (bounds + anti-teleport)

**Phase 2 — conspicuousness vision (solo)**
- Watcher vantage points with line-of-sight checks and visible "eyes"
- Per-tick offscreen render-diff → a live **visibility score** that falls as you blend

**Phase 3 — the game (server-authoritative)**
- **Roles** (hider / hunter) assigned at round start; host-controlled **prep → hunt → ended** round loop with a server clock
- The signature **"visible-but-unnoticed" scoring**: the *server* raycasts each hunter's sight against the shared level occluders, so a hider only scores while genuinely in view and un-occluded — not faked client-side
- **Hunter shooting** (center-crosshair raycast), validated server-side for range / cone / line-of-sight before a tag counts
- **Taunt** (risk/reward score multiplier + a ping everyone sees and hears), elimination, win/lose, and an end-of-round **scoreboard** with MVP
- Procedural audio cues; hunter chevrons, ghosted eliminations, taunt rings

## Roadmap
- **Phase 4 — robustness & reach:** snapshot interpolation on a render delay (vs lerp-to-latest),
  late-join paint catch-up (bounded dab log), `onDrop`/`onReconnect` using the `connected` field,
  on-screen **touch controls** for mobile, ESLint enforcement, WebGPU renderer, Infection mode (tagged hiders convert).

---

MIT for this original code. Not affiliated with the original game or its authors.
