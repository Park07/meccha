import { Room, Client } from "colyseus";
import type { MoveMsg, PaintMsg } from "shared";
import { GAME, SPAWNS, levelOccluders, isExposed, type AABB } from "shared";
import { GameState, Player } from "./schema/GameState.js";

const PALETTE = [0xff5a47, 0x36d6c6, 0xffc24b, 0x7be0ff, 0x8a5aff, 0x5aff9e, 0xff9ec4, 0xb06a2f];

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One GameRoom == one lobby/match. roomId is the shareable join code.
 * Authoritative: the server owns roles, scoring, tagging, and the round clock.
 */
export class GameRoom extends Room {
  maxClients = 8;
  state = new GameState();

  private occ: AABB[] = levelOccluders();
  private elapsed = 0;        // ms in the current timed phase
  private lastShot = new Map<string, number>();

  onCreate(_options: any) {
    this.autoDispose = true;

    this.onMessage("move", (client: Client, m: MoveMsg) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      // hunters are frozen during prep
      if (this.state.phase === "prep" && p.role === "hunter") { p.aim = m.aim; p.ry = m.ry; return; }
      const H = 12.4;
      let nx = Math.max(-H, Math.min(H, m.x));
      let nz = Math.max(-H, Math.min(H, m.z));
      const maxStep = 6.6 * 0.4;
      const dx = nx - p.x, dz = nz - p.z;
      const d = Math.hypot(dx, dz);
      if (d > maxStep) { nx = p.x + (dx / d) * maxStep; nz = p.z + (dz / d) * maxStep; }
      p.x = nx; p.y = 0; p.z = nz; p.ry = m.ry; p.aim = m.aim;
    });

    this.onMessage("paint", (client: Client, m: PaintMsg) => {
      this.broadcast("paint", { id: client.sessionId, ...m }, { except: client });
    });

    // Hider taunt: scoring multiplier window + a ping everyone can see/hear.
    this.onMessage("taunt", (client: Client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.role !== "hider" || !p.alive || this.state.phase !== "hunt") return;
      const now = Date.now();
      if (now < p.tauntUntil - (GAME.TAUNT_MS - GAME.TAUNT_COOLDOWN_MS)) return; // on cooldown
      p.tauntUntil = now + GAME.TAUNT_MS;
      this.broadcast("taunt", { id: client.sessionId });
    });

    // Hunter shot: validated server-side (must be a hunter, target a live hider,
    // within range/cone, and not occluded — you cannot shoot through walls).
    this.onMessage("tag", (client: Client, data: { id: string }) => {
      if (this.state.phase !== "hunt") return;
      const shooter = this.state.players.get(client.sessionId);
      if (!shooter || shooter.role !== "hunter") return;
      const now = Date.now();
      if (now - (this.lastShot.get(client.sessionId) || 0) < GAME.SHOOT_COOLDOWN_MS) return;
      this.lastShot.set(client.sessionId, now);
      this.broadcast("shot", { id: client.sessionId }); // for muzzle/recoil/sfx

      const target = this.state.players.get(data?.id);
      if (!target || target.role !== "hider" || !target.alive) return;
      if (!isExposed(shooter.x, shooter.z, shooter.aim, target.x, target.z, this.occ)) return;

      target.alive = false;
      target.exposed = false;
      shooter.score += GAME.TAG_BONUS;
      this.broadcast("tagged", { id: target.id, by: shooter.id });

      // hunters win if no hiders remain
      if (this.aliveHiders() === 0) this.endRound();
    });

    this.onMessage("startRound", (client: Client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.phase === "prep" || this.state.phase === "hunt") return;
      if (this.state.players.size < 2) return;
      this.startRound();
    });

    this.setSimulationInterval((dt) => this.tick(dt), 100);
  }

  private aliveHiders(): number {
    let n = 0;
    this.state.players.forEach((p) => { if (p.role === "hider" && p.alive) n++; });
    return n;
  }

  private startRound() {
    const ids = shuffle([...this.state.players.keys()]);
    const n = ids.length;
    const hunters = Math.min(Math.max(1, Math.round(n / 4)), n - 1);
    const spawns = shuffle([...SPAWNS]);

    ids.forEach((id, i) => {
      const p = this.state.players.get(id)!;
      p.role = i < hunters ? "hunter" : "hider";
      p.alive = true;
      p.exposed = false;
      p.score = 0;
      p.tauntUntil = 0;
      const s = spawns[i % spawns.length];
      p.x = s.x; p.z = s.z; p.y = 0;
      p.ry = Math.atan2(-s.x, -s.z); // face roughly toward the centre
      p.aim = p.ry;
    });

    this.state.resultTeam = "";
    this.state.mvpName = "";
    this.state.mvpScore = 0;
    this.state.phase = "prep";
    this.elapsed = 0;
    this.state.secondsLeft = Math.ceil(GAME.PREP_MS / 1000);
  }

  private endRound() {
    const survived = this.aliveHiders();
    this.state.resultTeam = survived > 0 ? "Hiders survived" : "Hunters won";
    let mvp: Player | null = null;
    this.state.players.forEach((p) => { if (!mvp || p.score > mvp.score) mvp = p; });
    if (mvp) { this.state.mvpName = (mvp as Player).name; this.state.mvpScore = Math.round((mvp as Player).score); }
    this.state.phase = "ended";
    this.elapsed = 0;
    this.state.secondsLeft = 0;
  }

  private toLobby() {
    this.state.players.forEach((p) => {
      p.role = "hider"; p.alive = true; p.exposed = false; p.score = 0; p.tauntUntil = 0;
    });
    this.state.phase = "lobby";
    this.elapsed = 0;
    this.state.secondsLeft = 0;
  }

  private tick(dtMs: number) {
    const dt = dtMs / 1000;
    this.elapsed += dtMs;

    if (this.state.phase === "prep") {
      this.state.secondsLeft = Math.max(0, Math.ceil((GAME.PREP_MS - this.elapsed) / 1000));
      if (this.elapsed >= GAME.PREP_MS) { this.state.phase = "hunt"; this.elapsed = 0; this.state.secondsLeft = Math.ceil(GAME.HUNT_MS / 1000); }
      return;
    }

    if (this.state.phase === "hunt") {
      this.state.secondsLeft = Math.max(0, Math.ceil((GAME.HUNT_MS - this.elapsed) / 1000));
      const now = Date.now();

      // gather hunters once
      const hunters: Player[] = [];
      this.state.players.forEach((p) => { if (p.role === "hunter") hunters.push(p); });

      this.state.players.forEach((hider) => {
        if (hider.role !== "hider" || !hider.alive) { hider.exposed = false; return; }
        let seen = false;
        for (const h of hunters) {
          if (isExposed(h.x, h.z, h.aim, hider.x, hider.z, this.occ)) { seen = true; break; }
        }
        hider.exposed = seen;
        if (seen) {
          const mult = now < hider.tauntUntil ? GAME.TAUNT_MULT : 1;
          hider.score += GAME.SCORE_RATE * mult * dt;
        }
      });

      if (this.elapsed >= GAME.HUNT_MS || this.aliveHiders() === 0) this.endRound();
      return;
    }

    if (this.state.phase === "ended") {
      if (this.elapsed >= GAME.END_MS) this.toLobby();
    }
  }

  onJoin(client: Client, options: { name?: string }) {
    const p = new Player();
    p.id = client.sessionId;
    p.name = (options?.name || "Chameleon").slice(0, 16);
    p.role = "hider";
    p.tint = PALETTE[this.state.players.size % PALETTE.length];
    const s = SPAWNS[this.state.players.size % SPAWNS.length];
    p.x = s.x; p.z = s.z; p.y = 0; p.ry = Math.atan2(-s.x, -s.z); p.aim = p.ry;
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    console.log(`[room ${this.roomId}] ${p.name} joined (${this.state.players.size}/${this.maxClients})`);
  }

  onLeave(client: Client, _code?: number) {
    this.state.players.delete(client.sessionId);
    this.lastShot.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      const next = this.state.players.keys().next();
      this.state.hostId = next.done ? "" : next.value;
    }
    // if the round can no longer continue, wrap it up
    if ((this.state.phase === "hunt" || this.state.phase === "prep") &&
        (this.state.players.size < 2 || this.aliveHiders() === 0)) {
      this.endRound();
    }
  }

  onDispose() { console.log(`[room ${this.roomId}] disposed`); }
}
