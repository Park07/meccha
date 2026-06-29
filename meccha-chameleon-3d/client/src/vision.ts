import * as THREE from "three";
import type { World } from "./avatar_world";
import type { Avatar } from "./avatar";

const W = 84, H = 60; // tiny offscreen target — cheap to read back

export interface VisionResult {
  visibility: number;        // 0 = blended/unseen, 1 = glaring
  watching: boolean;         // is any vantage actually looking at you
  dir: THREE.Vector3 | null; // world-XZ direction toward the active watcher
}

/**
 * The 3D evolution of the original's pixel-matching. From a watcher's POV we
 * render three small frames: a silhouette mask of the hider, the scene WITHOUT
 * the hider (the background behind them), and the scene WITH the hider. For the
 * hider's footprint pixels we average the colour distance between "with" and
 * "without" — pixels you've painted to match their backdrop contribute ~0, so
 * the score falls as you blend. Throttled to ~5.5 Hz; renders are 84x60.
 */
export class ConspicuousnessProbe {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private world: World;
  private avatar: Avatar;

  private rt: THREE.WebGLRenderTarget;
  private cam: THREE.PerspectiveCamera;
  private maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private mask = new Uint8Array(W * H * 4);
  private bg = new Uint8Array(W * H * 4);
  private fg = new Uint8Array(W * H * 4);
  private ray = new THREE.Raycaster();

  private vantages: THREE.Vector3[];
  private markers: THREE.Mesh[] = [];
  private acc = 0;
  private last: VisionResult = { visibility: 0, watching: false, dir: null };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, world: World, avatar: Avatar) {
    this.renderer = renderer;
    this.scene = scene;
    this.world = world;
    this.avatar = avatar;

    this.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    this.cam = new THREE.PerspectiveCamera(55, W / H, 0.1, 80);

    this.vantages = [
      new THREE.Vector3(-10, 2.4, -10),
      new THREE.Vector3(10, 2.4, -10),
      new THREE.Vector3(10, 2.4, 10),
      new THREE.Vector3(-10, 2.4, 10),
      new THREE.Vector3(0, 3.4, 11.6),
    ];

    // glowing "eyes" so the player can see where they're being watched from
    const eye = new THREE.SphereGeometry(0.18, 16, 12);
    for (const v of this.vantages) {
      const m = new THREE.Mesh(
        eye,
        new THREE.MeshStandardMaterial({ color: 0x120e16, emissive: 0xff5a47, emissiveIntensity: 0.35, roughness: 0.4 })
      );
      m.position.copy(v);
      scene.add(m);
      this.markers.push(m);
    }
  }

  private hasLOS(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    this.ray.set(from, dir);
    this.ray.far = dist - 0.6;
    return this.ray.intersectObjects(this.world.paintTargets, false).length === 0;
  }

  /** Call every frame; throttles internally and returns the latest reading. */
  update(dt: number): VisionResult {
    this.acc += dt;
    if (this.acc < 0.18) return this.last;
    this.acc = 0;

    const g = this.avatar.group;
    const target = new THREE.Vector3(g.position.x, g.position.y + this.avatar.body.position.y, g.position.z);

    for (const m of this.markers) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;

    // pick the nearest vantage with a clear line of sight
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const v of this.vantages) {
      if (!this.hasLOS(v, target)) continue;
      const d = v.distanceToSquared(target);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return (this.last = { visibility: 0, watching: false, dir: null });

    this.cam.position.copy(best);
    this.cam.lookAt(target);

    const prevClear = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.rt);

    // (1) silhouette mask: only the body (layer 2), flat white on black
    this.cam.layers.set(2);
    this.scene.overrideMaterial = this.maskMat;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam);
    this.renderer.readRenderTargetPixels(this.rt, 0, 0, W, H, this.mask);
    this.scene.overrideMaterial = null;
    this.cam.layers.set(0);
    this.renderer.setClearColor(prevClear, prevAlpha);

    // (2) background without the hider
    this.avatar.group.visible = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam);
    this.renderer.readRenderTargetPixels(this.rt, 0, 0, W, H, this.bg);

    // (3) scene with the hider
    this.avatar.group.visible = true;
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam);
    this.renderer.readRenderTargetPixels(this.rt, 0, 0, W, H, this.fg);

    this.renderer.setRenderTarget(null);

    // diff over the true footprint (mask), including blended pixels
    let footprint = 0, distSum = 0;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (this.mask[o] < 40) continue; // not the body
      footprint++;
      const dr = this.fg[o] - this.bg[o];
      const dg = this.fg[o + 1] - this.bg[o + 1];
      const db = this.fg[o + 2] - this.bg[o + 2];
      distSum += Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 255);
    }

    const activeIdx = this.vantages.indexOf(best);
    if (activeIdx >= 0) (this.markers[activeIdx].material as THREE.MeshStandardMaterial).emissiveIntensity = 1.7;

    if (footprint < 10) return (this.last = { visibility: 0, watching: false, dir: null });

    const visibility = distSum / footprint; // 0 blended .. 1 glaring
    const dir = new THREE.Vector3().subVectors(best, target).setY(0).normalize();
    return (this.last = { visibility, watching: true, dir });
  }

  dispose() {
    this.rt.dispose();
    this.maskMat.dispose();
    for (const m of this.markers) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
  }
}
