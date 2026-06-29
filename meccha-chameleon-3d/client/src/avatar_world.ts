import * as THREE from "three";
import { LEVEL, propFootprint } from "shared";

export interface World {
  group: THREE.Group;
  colliders: THREE.Box3[];
  paintTargets: THREE.Object3D[];
}

function mat(color: number, rough = 0.85, emissive = 0) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0,
    emissive, emissiveIntensity: emissive ? 1.4 : 0,
  });
}

/**
 * "The Gallery" — built from the SHARED level definition so the props that
 * provide cover here are the exact same footprints the server uses for
 * line-of-sight and collision. Decorative-only bits (bookshelf, neon, rug) are
 * client-side and don't affect gameplay.
 */
export function buildWorld(scene: THREE.Scene): World {
  const group = new THREE.Group();
  const colliders: THREE.Box3[] = [];
  const paintTargets: THREE.Object3D[] = [];

  const ROOM = LEVEL.SIZE, WALL_H = LEVEL.WALL_H, half = LEVEL.HALF;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), mat(0x6e4a30, 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor); paintTargets.push(floor);

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), mat(0x9b3b4b, 1));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.01; rug.receiveShadow = true;
  group.add(rug); paintTargets.push(rug);

  // walls
  const wallMat = mat(0xe7d8bd, 0.95);
  const walls: [number, number, number, number, number, number][] = [
    [ROOM, WALL_H, 0.6, 0, WALL_H / 2, -half],
    [ROOM, WALL_H, 0.6, 0, WALL_H / 2, half],
    [0.6, WALL_H, ROOM, -half, WALL_H / 2, 0],
    [0.6, WALL_H, ROOM, half, WALL_H / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z); m.receiveShadow = true;
    group.add(m); paintTargets.push(m);
    colliders.push(new THREE.Box3().setFromObject(m));
  }

  // decorative bookshelf along the back wall
  const spineColors = [0xb6452f, 0x2f6f8f, 0xcaa24a, 0x3f7a4a, 0x7a3f6f, 0x2f5f8f, 0x8f3f3f, 0x5f7a2f];
  let seed = 1337;
  const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let row = 0; row < 5; row++) {
    let bx = -3;
    while (bx < 3) {
      const bw = 0.22 + rng() * 0.22, bh = 0.9 + rng() * 0.3;
      const spine = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.32), mat(spineColors[(rng() * spineColors.length) | 0], 0.7));
      spine.position.set(bx + bw / 2, 0.6 + row * 1.05 + bh / 2, -half + 0.5);
      spine.castShadow = true; spine.receiveShadow = true;
      group.add(spine); paintTargets.push(spine);
      bx += bw + 0.04;
    }
  }

  // cover props — from the shared level (gameplay-affecting)
  for (const p of LEVEL.props) {
    let m: THREE.Mesh;
    if (p.shape === "cyl") {
      m = new THREE.Mesh(new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 24), mat(p.color, 0.8));
      m.position.set(p.x, p.h / 2, p.z);
    } else {
      m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat(p.color, 0.82));
      m.position.set(p.x, p.h / 2, p.z);
    }
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); paintTargets.push(m);
    const f = propFootprint(p);
    colliders.push(new THREE.Box3(new THREE.Vector3(f.minX, -1, f.minZ), new THREE.Vector3(f.maxX, p.h, f.maxZ)));
  }

  // neon accents (bloom)
  group.add(new THREE.Mesh(new THREE.BoxGeometry(ROOM - 1, 0.12, 0.12), mat(0x36d6c6, 0.5, 0x36d6c6)).translateY(WALL_H - 0.6).translateZ(-half + 0.4));
  const coral = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, ROOM - 1), mat(0xff5a47, 0.5, 0xff5a47));
  coral.position.set(-half + 0.4, WALL_H - 0.6, 0);
  group.add(coral);

  // lighting
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2c20, 0.5));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
  key.position.set(8, 14, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 50;
  const s = 18;
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.bias = -0.0004;
  scene.add(key);

  scene.add(group);
  return { group, colliders, paintTargets };
}
