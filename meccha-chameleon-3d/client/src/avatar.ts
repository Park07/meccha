import * as THREE from "three";
import { colorToHex, TUNING } from "shared";

const TEX = TUNING.PAINT_TEX_SIZE; // per-avatar albedo canvas resolution (single source of truth)

/**
 * The iconic blobby figure. Its skin is a 2D canvas used as the albedo map —
 * painting is just drawing filled circles into that canvas at the UV the
 * cursor's ray hits, then flagging the texture for upload. Strokes are tiny
 * (u,v,size,color), so they sync trivially.
 */
export class Avatar {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private nameplate?: THREE.Sprite;
  private mark!: THREE.Mesh;   // hunter chevron
  private ring!: THREE.Mesh;   // taunt ping
  private ringT = -1;
  private t = Math.random() * 10;
  private baseY: number;

  constructor(name?: string, tint = 0xffffff) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = TEX;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = "#f3ece0"; // creamy "marble" start
    this.ctx.fillRect(0, 0, TEX, TEX);

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    const mat = new THREE.MeshStandardMaterial({
      map: this.tex,
      roughness: 0.62,
      metalness: 0.0,
      envMapIntensity: 0.85,
    });

    const geo = new THREE.SphereGeometry(0.62, 48, 40);
    geo.scale(1, 1.28, 1); // egg/bean
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.layers.enable(2); // layer 2 = silhouette pass for the vision probe
    this.baseY = 0.62 * 1.28; // so the bottom rests near y=0
    this.body.position.y = this.baseY;
    this.group.add(this.body);

    // dark little feet (not paintable)
    const footMat = new THREE.MeshStandardMaterial({ color: 0x2a2530, roughness: 0.9 });
    for (const sx of [-0.24, 0.24]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), footMat);
      foot.scale.set(1, 0.7, 1.25);
      foot.position.set(sx, 0.12, 0.18);
      foot.castShadow = true;
      this.group.add(foot);
    }

    // hunter chevron (shown above hunters so everyone can ID them)
    this.mark = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.36, 4),
      new THREE.MeshStandardMaterial({ color: 0xff5a47, emissive: 0xff5a47, emissiveIntensity: 1.3, roughness: 0.4 })
    );
    this.mark.rotation.x = Math.PI; // point down
    this.mark.position.y = this.baseY + 1.55;
    this.mark.visible = false;
    this.group.add(this.mark);

    // taunt ping ring
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.05, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc24b, transparent: true, opacity: 1 })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.12;
    this.ring.visible = false;
    this.group.add(this.ring);

    this.tintWash(tint);
    if (name) this.setName(name);
  }

  /** faint hue wash so fresh players read as slightly distinct, still mostly white */
  private tintWash(tint: number) {
    this.ctx.save();
    this.ctx.globalAlpha = 0.1;
    this.ctx.fillStyle = colorToHex(tint);
    this.ctx.fillRect(0, 0, TEX, TEX);
    this.ctx.restore();
    this.tex.needsUpdate = true;
  }

  setName(name: string) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "bold 30px 'Space Grotesk', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillText(name, 129, 34);
    g.fillStyle = "#ffffff";
    g.fillText(name, 128, 33);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })
    );
    spr.scale.set(1.7, 0.42, 1);
    spr.position.y = this.baseY + 1.05;
    if (this.nameplate) this.group.remove(this.nameplate);
    this.nameplate = spr;
    this.group.add(spr);
  }

  /** Paint a dab. u,v in 0..1 (from a raycast hit); size = radius in px. */
  applyDab(u: number, v: number, size: number, color: number) {
    const x = u * TEX;
    const y = (1 - v) * TEX; // canvas Y flipped vs UV
    this.ctx.fillStyle = colorToHex(color);
    const dab = (cx: number) => {
      this.ctx.beginPath();
      this.ctx.arc(cx, y, size, 0, Math.PI * 2);
      this.ctx.fill();
    };
    dab(x);
    if (x < size) dab(x + TEX);        // wrap across the seam
    if (x > TEX - size) dab(x - TEX);
    this.tex.needsUpdate = true;
  }

  clearPaint() {
    this.ctx.fillStyle = "#f3ece0";
    this.ctx.fillRect(0, 0, TEX, TEX);
    this.tex.needsUpdate = true;
  }

  /** show the coral chevron for hunters */
  setRole(role: string) {
    this.mark.visible = role === "hunter";
  }

  /** ghost out when eliminated */
  setGhost(on: boolean) {
    const m = this.body.material as THREE.MeshStandardMaterial;
    m.transparent = on;
    m.opacity = on ? 0.28 : 1;
    m.depthWrite = !on;
    if (this.nameplate) (this.nameplate.material as THREE.SpriteMaterial).opacity = on ? 0.4 : 1;
  }

  /** trigger the taunt ring */
  ping() {
    this.ringT = 0;
    this.ring.visible = true;
  }

  setPosition(x: number, y: number, z: number) { this.group.position.set(x, y, z); }
  setYaw(ry: number) { this.group.rotation.y = ry; }

  update(dt: number) {
    this.t += dt;
    const bob = Math.sin(this.t * 2.2) * 0.04;
    const squash = 1 + Math.sin(this.t * 2.2) * 0.03;
    this.body.position.y = this.baseY + bob;
    this.body.scale.set(1 / squash, squash, 1 / squash);

    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT / 0.6;
      if (k >= 1) { this.ring.visible = false; this.ringT = -1; }
      else {
        const sc = 1 + k * 2.4;
        this.ring.scale.set(sc, sc, sc);
        (this.ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      }
    }
  }

  dispose() {
    this.tex.dispose();
    (this.body.material as THREE.Material).dispose();
    this.body.geometry.dispose();
  }
}
