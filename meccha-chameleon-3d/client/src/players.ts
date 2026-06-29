import * as THREE from "three";
import type { World } from "./avatar_world";
import { Avatar } from "./avatar";
import { TUNING, GAME, pushOutCircle, type Role } from "shared";

const UP = new THREE.Vector3(0, 1, 0);
const PLAYER_R = 0.55;
const REMOTE_LERP = 14;

function damp(dt: number, rate: number) { return 1 - Math.exp(-rate * dt); }

/**
 * Drives the local player. Role-aware: hunters shoot (center-screen raycast,
 * confirmed by the server), hiders paint + taunt. Movement is frozen for
 * hunters during prep and for eliminated spectators.
 */
export class LocalController {
  readonly avatar: Avatar;
  private camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private world: World;

  role: Role = "hider";
  canMove = true;
  canAct = true;

  brushColor = 0xff5a47;
  brushSize = 14;
  eyedropper = false;

  onPaint?: (u: number, v: number, size: number, color: number) => void;
  onColorPicked?: (color: number) => void;
  onEyedropperChange?: (on: boolean) => void;
  onShoot?: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
  onTaunt?: () => void;

  private keys = new Set<string>();
  private leftDown = false;
  private rightDown = false;
  private ndc = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private lastShot = 0;

  private az = Math.PI;
  private el = 0.42;
  private dist = 8;
  private yaw = 0;
  private bound: { [k: string]: any } = {};

  constructor(avatar: Avatar, camera: THREE.PerspectiveCamera, dom: HTMLElement, world: World) {
    this.avatar = avatar;
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.avatar.setPosition(0, 0, 4);

    this.bound.kd = (e: KeyboardEvent) => this.onKey(e, true);
    this.bound.ku = (e: KeyboardEvent) => this.onKey(e, false);
    this.bound.pd = (e: PointerEvent) => this.onPointerDown(e);
    this.bound.pu = (e: PointerEvent) => this.onPointerUp(e);
    this.bound.pm = (e: PointerEvent) => this.onPointerMove(e);
    this.bound.wh = (e: WheelEvent) => { e.preventDefault(); this.dist = THREE.MathUtils.clamp(this.dist + e.deltaY * 0.01, 3, 13); };
    this.bound.ctx = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", this.bound.kd);
    window.addEventListener("keyup", this.bound.ku);
    dom.addEventListener("pointerdown", this.bound.pd);
    window.addEventListener("pointerup", this.bound.pu);
    window.addEventListener("pointermove", this.bound.pm);
    dom.addEventListener("wheel", this.bound.wh, { passive: false });
    dom.addEventListener("contextmenu", this.bound.ctx);
  }

  setRole(role: Role) { this.role = role; this.avatar.setRole(role); }

  /** where the player is looking (camera yaw) — the server uses this for sight */
  getAimYaw(): number { return this.az + Math.PI; }

  /** snap the avatar + camera to a spawn (used at round start) */
  teleport(x: number, z: number, ry: number) {
    this.avatar.setPosition(x, 0, z);
    this.avatar.group.rotation.y = ry;
    this.yaw = ry;
    this.az = ry - Math.PI;
  }

  setEyedropper(on: boolean) {
    if (this.eyedropper === on) return;
    this.eyedropper = on;
    this.onEyedropperChange?.(on);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (down && k === "e" && this.role === "hider") { this.setEyedropper(!this.eyedropper); return; }
    if (down && k === "t" && this.role === "hider" && this.canAct) { this.onTaunt?.(); return; }
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  private setNdc(e: PointerEvent) {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button === 2) { this.rightDown = true; return; }
    if (e.button !== 0) return;
    this.leftDown = true;
    if (!this.canAct) return;
    if (this.role === "hunter") { this.shoot(); return; }
    this.setNdc(e);
    if (this.eyedropper) this.pickColor(); else this.paintAtCursor();
  }
  private onPointerUp(e: PointerEvent) {
    if (e.button === 2) this.rightDown = false;
    if (e.button === 0) this.leftDown = false;
  }
  private onPointerMove(e: PointerEvent) {
    if (this.rightDown) {
      this.az -= e.movementX * 0.005;
      this.el = THREE.MathUtils.clamp(this.el + e.movementY * 0.005, 0.12, 1.3);
    }
    if (this.leftDown && this.canAct && this.role === "hider" && !this.eyedropper) {
      this.setNdc(e);
      this.paintAtCursor();
    }
  }

  private shoot() {
    const now = performance.now();
    if (now - this.lastShot < GAME.SHOOT_COOLDOWN_MS) return;
    this.lastShot = now;
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera); // center crosshair
    this.onShoot?.(this.ray.ray.origin.clone(), this.ray.ray.direction.clone());
  }

  private paintAtCursor() {
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObject(this.avatar.body, false)[0];
    if (hit && hit.uv) {
      this.avatar.applyDab(hit.uv.x, hit.uv.y, this.brushSize, this.brushColor);
      this.onPaint?.(hit.uv.x, hit.uv.y, this.brushSize, this.brushColor);
    }
  }

  private pickColor() {
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObjects(this.world.paintTargets, false)[0];
    if (hit) {
      const m = (hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (m && m.color) { this.brushColor = m.color.getHex(); this.onColorPicked?.(this.brushColor); }
    }
    this.setEyedropper(false);
  }

  update(dt: number) {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();

    const g = this.avatar.group;
    if (this.canMove) {
      const dir = new THREE.Vector3();
      if (this.keys.has("w") || this.keys.has("arrowup")) dir.add(fwd);
      if (this.keys.has("s") || this.keys.has("arrowdown")) dir.sub(fwd);
      if (this.keys.has("d") || this.keys.has("arrowright")) dir.add(right);
      if (this.keys.has("a") || this.keys.has("arrowleft")) dir.sub(right);
      if (dir.lengthSq() > 0) {
        dir.normalize();
        const speed = this.keys.has("shift") ? TUNING.SPRINT_SPEED : TUNING.MOVE_SPEED;
        g.position.addScaledVector(dir, speed * dt);
        this.yaw = Math.atan2(dir.x, dir.z);
      }
      for (const b of this.world.colliders) {
        const [nx, nz] = pushOutCircle(g.position.x, g.position.z, PLAYER_R, b.min.x, b.min.z, b.max.x, b.max.z);
        g.position.x = nx; g.position.z = nz;
      }
      const H = TUNING.ROOM_HALF;
      g.position.x = THREE.MathUtils.clamp(g.position.x, -H, H);
      g.position.z = THREE.MathUtils.clamp(g.position.z, -H, H);
      g.position.y = 0;

      let dyaw = this.yaw - g.rotation.y;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      g.rotation.y += dyaw * damp(dt, TUNING.TURN_LERP);
    }

    this.avatar.update(dt);

    const head = g.position.y + this.avatar.body.position.y + 0.25;
    const cx = Math.sin(this.az) * Math.cos(this.el) * this.dist;
    const cy = Math.sin(this.el) * this.dist;
    const cz = Math.cos(this.az) * Math.cos(this.el) * this.dist;
    this.camera.position.set(g.position.x + cx, head + cy, g.position.z + cz);
    this.camera.lookAt(g.position.x, head, g.position.z);
  }

  dispose() {
    window.removeEventListener("keydown", this.bound.kd);
    window.removeEventListener("keyup", this.bound.ku);
    this.dom.removeEventListener("pointerdown", this.bound.pd);
    window.removeEventListener("pointerup", this.bound.pu);
    window.removeEventListener("pointermove", this.bound.pm);
    this.dom.removeEventListener("wheel", this.bound.wh);
    this.dom.removeEventListener("contextmenu", this.bound.ctx);
  }
}

/** A networked player we only observe: interpolate + reflect role/alive. */
export class RemotePlayer {
  readonly avatar: Avatar;
  private target = new THREE.Vector3();
  private targetYaw = 0;

  constructor(name: string, tint: number) { this.avatar = new Avatar(name, tint); }

  setTarget(x: number, y: number, z: number, ry: number) { this.target.set(x, y, z); this.targetYaw = ry; }
  updateMeta(role: string, alive: boolean) { this.avatar.setRole(role); this.avatar.setGhost(!alive); }
  applyDab(u: number, v: number, size: number, color: number) { this.avatar.applyDab(u, v, size, color); }
  ping() { this.avatar.ping(); }

  update(dt: number) {
    const g = this.avatar.group;
    g.position.lerp(this.target, damp(dt, REMOTE_LERP));
    let d = this.targetYaw - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * damp(dt, REMOTE_LERP);
    this.avatar.update(dt);
  }

  dispose() { this.avatar.dispose(); }
}
