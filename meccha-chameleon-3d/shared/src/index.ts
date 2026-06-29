/**
 * Shared protocol + level + tuning + pure game math.
 * Both client and server import these exact values and functions, so movement,
 * collision, and — critically — visibility/scoring can never disagree.
 */

export type Role = "hider" | "hunter";
export type Phase = "lobby" | "prep" | "hunt" | "ended";

export interface MoveMsg {
  x: number;
  y: number;
  z: number;
  ry: number;  // body yaw
  aim: number; // camera look yaw (where the player is looking) — used for hunter sight
}

export interface PaintMsg { u: number; v: number; size: number; color: number; }
export interface PaintRelay extends PaintMsg { id: string; }

export const PROTOCOL = {
  ROOM_NAME: "game",
  MAX_CLIENTS: 8,
  MOVE_HZ: 15,
} as const;

export const TUNING = {
  MOVE_SPEED: 4.2,
  SPRINT_SPEED: 6.6,
  TURN_LERP: 12,
  PAINT_TEX_SIZE: 512,
  ROOM_HALF: 12.4,
} as const;

/** Round/scoring tuning, shared so solo + multiplayer feel identical. */
export const GAME = {
  FOV_DEG: 72,        // hunter sight cone
  VIEW_RANGE: 17,     // how far a hunter can see/score/tag (m)
  TAG_RANGE: 17,      // max shot distance
  SCORE_RATE: 12,     // points/sec while a hider is in sight but un-tagged
  TAUNT_MULT: 2.6,    // score multiplier while taunting
  TAUNT_MS: 2600,
  TAUNT_COOLDOWN_MS: 7000,
  SHOOT_COOLDOWN_MS: 750,
  PREP_MS: 8000,      // hiders blend, hunters frozen
  HUNT_MS: 95000,
  END_MS: 9000,
  TAG_BONUS: 120,     // points a hunter earns per tag
} as const;

export interface AABB { minX: number; minZ: number; maxX: number; maxZ: number; }

/** Deterministic level: walls + cover props. Client renders from this; server
 * uses the same footprints for collision + line-of-sight. */
export const LEVEL = {
  SIZE: 26,
  WALL_H: 7,
  HALF: 13,
  props: [
    { x: -7, z: 4, w: 2.2, d: 2.2, h: 2.2, color: 0x4f7a52, shape: "box" },
    { x: 7.5, z: -3, w: 1.6, d: 1.6, h: 3.2, color: 0x3a6f8f, shape: "box" },
    { x: 5, z: 6, w: 3.4, d: 1.4, h: 1.2, color: 0xcaa24a, shape: "box" },
    { x: -6, z: -6, w: 1.4, d: 3.0, h: 1.4, color: 0xb6452f, shape: "box" },
    { x: 3.5, z: -7, w: 2.2, d: 2.2, h: 2.6, color: 0x8a5aff, shape: "cyl" },
    { x: -3, z: 7.5, w: 1.6, d: 1.6, h: 1.8, color: 0x36d6c6, shape: "cyl" },
    { x: -9.5, z: 0, w: 1.6, d: 4.5, h: 2.4, color: 0xb06a2f, shape: "box" },
    { x: 9.5, z: 7, w: 4.0, d: 1.4, h: 1.6, color: 0x7a3f6f, shape: "box" },
  ] as { x: number; z: number; w: number; d: number; h: number; color: number; shape: "box" | "cyl" }[],
} as const;

export const SPAWNS: { x: number; z: number }[] = [
  { x: 0, z: 10 }, { x: 10, z: 0 }, { x: 0, z: -10 }, { x: -10, z: 0 },
  { x: 9, z: 9 }, { x: -9, z: -9 }, { x: 9, z: -9 }, { x: -9, z: 9 },
];

export function propFootprint(p: { x: number; z: number; w: number; d: number }): AABB {
  return { minX: p.x - p.w / 2, minZ: p.z - p.d / 2, maxX: p.x + p.w / 2, maxZ: p.z + p.d / 2 };
}

const WT = 0.6;
/** Wall footprints + prop footprints — the occluders for LOS and collision. */
export function levelOccluders(): AABB[] {
  const h = LEVEL.HALF;
  const walls: AABB[] = [
    { minX: -h, maxX: h, minZ: -h - WT, maxZ: -h + WT },
    { minX: -h, maxX: h, minZ: h - WT, maxZ: h + WT },
    { minX: -h - WT, maxX: -h + WT, minZ: -h, maxZ: h },
    { minX: h - WT, maxX: h + WT, minZ: -h, maxZ: h },
  ];
  return [...walls, ...LEVEL.props.map(propFootprint)];
}

// ---- colour helpers ----
export function packColor(r: number, g: number, b: number): number {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}
export function unpackColor(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
export function hexToColor(hex: string): number { return parseInt(hex.replace("#", ""), 16) & 0xffffff; }
export function colorToHex(c: number): string { return "#" + (c & 0xffffff).toString(16).padStart(6, "0"); }

// ---- pure geometry (unit-tested) ----

/** Resolve a circle out of an AABB in XZ. Returns corrected [x, z]. */
export function pushOutCircle(
  px: number, pz: number, r: number, minX: number, minZ: number, maxX: number, maxZ: number
): [number, number] {
  const cx = Math.max(minX, Math.min(px, maxX));
  const cz = Math.max(minZ, Math.min(pz, maxZ));
  const dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 < r * r && d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return [cx + (dx / d) * r, cz + (dz / d) * r];
  }
  return [px, pz];
}

/** 2D segment vs AABB (Liang–Barsky). True if the segment touches the box. */
export function segAABB(x0: number, z0: number, x1: number, z1: number, b: AABB): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - b.minX, b.maxX - x0, z0 - b.minZ, b.maxZ - z0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return t0 <= t1;
}

/**
 * Is `hider` inside `hunter`'s sight: within range, inside the view cone around
 * the hunter's look yaw, and not occluded by any level box. Server-authoritative
 * — this is what makes "visible but unnoticed" scoring meaningful.
 */
export function isExposed(
  hx: number, hz: number, haim: number, tx: number, tz: number, occ: AABB[]
): boolean {
  const dx = tx - hx, dz = tz - hz;
  const dist = Math.hypot(dx, dz);
  if (dist > GAME.VIEW_RANGE) return false;
  if (dist < 1e-4) return true;
  const fx = Math.sin(haim), fz = Math.cos(haim);
  const cosA = (dx * fx + dz * fz) / dist;
  if (cosA < Math.cos((GAME.FOV_DEG * Math.PI) / 360)) return false; // FOV/2 in rad
  for (const b of occ) {
    // ignore a box the hider is essentially standing on/in (don't self-occlude)
    if (tx >= b.minX - 0.2 && tx <= b.maxX + 0.2 && tz >= b.minZ - 0.2 && tz <= b.maxZ + 0.2) continue;
    if (segAABB(hx, hz, tx, tz, b)) return false;
  }
  return true;
}
