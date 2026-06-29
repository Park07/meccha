import "./style.css";
import * as THREE from "three";
import { Engine } from "./engine";
import { buildWorld } from "./avatar_world";
import { Avatar } from "./avatar";
import { LocalController, RemotePlayer } from "./players";
import { ConspicuousnessProbe } from "./vision";
import { Net } from "./net";
import { UI } from "./ui";
import { audio } from "./audio";
import { hexToColor, colorToHex, PROTOCOL, GAME, type Role } from "shared";

const app = document.getElementById("app")!;
const engine = new Engine(app);
const world = buildWorld(engine.scene);
const ui = new UI(app);
const raycaster = new THREE.Raycaster();

let controller: LocalController | null = null;
let net: Net | null = null;
let probe: ConspicuousnessProbe | null = null;
const remotes = new Map<string, RemotePlayer>();

let lastPhase = "";
let lastRole: Role | "" = "";
let lastAlive = true;

startLobby();

function startLobby() {
  ui.showLobby({
    onSolo: () => startSolo(),
    onCreate: (name) => startMultiplayer(name, null),
    onJoin: (name, code) => startMultiplayer(name, code),
  });
}

function spawnLocal(name: string, tint: number): Avatar {
  const avatar = new Avatar(name, tint);
  engine.scene.add(avatar.group);
  controller = new LocalController(avatar, engine.camera, engine.renderer.domElement, world);
  controller.brushColor = hexToColor(ui.color());
  controller.onColorPicked = (c) => ui.setColor(colorToHex(c));
  controller.onEyedropperChange = (on) => ui.setEyedropper(on);
  return avatar;
}

function wireHud() {
  if (!controller) return;
  ui.onColor = (hex) => { controller!.brushColor = hexToColor(hex); };
  ui.onBrush = (size) => { controller!.brushSize = size; };
  ui.onEyedropper = (on) => controller!.setEyedropper(on);
  ui.onClear = () => controller!.avatar.clearPaint();
  ui.onLeave = () => { probe?.dispose(); net?.leave(); location.reload(); };
  ui.onStart = () => net?.startRound();
  ui.onTaunt = () => net?.sendTaunt();
}

function startSolo() {
  audio.init();
  const avatar = spawnLocal("You", 0x36d6c6);
  probe = new ConspicuousnessProbe(engine.renderer, engine.scene, world, avatar);
  ui.showHUD({ solo: true, code: "SOLO" });
  wireHud();
  ui.showPaintDock(true);
  ui.setHint("Paint yourself to match the room · walk into a watcher's view to test your visibility");
}

async function startMultiplayer(name: string, code: string | null) {
  audio.init();
  net = new Net();

  net.onAdd = (id, p) => {
    if (id === net!.sessionId) return;
    const rp = new RemotePlayer(p.name, p.tint);
    rp.setTarget(p.x, p.y, p.z, p.ry);
    rp.updateMeta(p.role, p.alive);
    engine.scene.add(rp.avatar.group);
    remotes.set(id, rp);
  };
  net.onRemove = (id) => {
    const rp = remotes.get(id);
    if (rp) { engine.scene.remove(rp.avatar.group); rp.dispose(); remotes.delete(id); }
  };
  net.onPaint = (r) => remotes.get(r.id)?.applyDab(r.u, r.v, r.size, r.color);
  net.onShot = (id) => { if (id !== net!.sessionId) audio.shot(); };
  net.onTagged = ({ id }) => {
    audio.tag();
    if (id === net!.sessionId) eliminateLocal();
    else remotes.get(id)?.avatar.setGhost(true);
  };
  net.onTauntPing = (id) => {
    audio.taunt();
    if (id === net!.sessionId) controller?.avatar.ping();
    else remotes.get(id)?.ping();
  };

  try {
    let roomCode: string;
    if (code) { await net.join(code, name); roomCode = code; }
    else { roomCode = await net.create(name); }

    spawnLocal(name, 0x36d6c6);
    controller!.onPaint = (u, v, size, color) => net!.sendPaint({ u, v, size, color });
    controller!.onTaunt = () => net!.sendTaunt();
    controller!.onShoot = (origin, dir) => shoot(origin, dir);

    ui.showHUD({ solo: false, code: roomCode });
    wireHud();
  } catch (err) {
    console.error(err);
    net = null;
    ui.error("Couldn't reach that room. Is the server running, and is the code right?");
  }
}

function shoot(origin: THREE.Vector3, dir: THREE.Vector3) {
  audio.shot();
  ui.shootFlash();
  if (!net) return;
  raycaster.set(origin, dir);
  raycaster.far = GAME.TAG_RANGE;
  let hitId = "";
  let best = Infinity;
  remotes.forEach((rp, id) => {
    const ps = net!.state.players.get(id);
    if (!ps || ps.role !== "hider" || !ps.alive) return;
    const hit = raycaster.intersectObject(rp.avatar.body, false)[0];
    if (hit && hit.distance < best) { best = hit.distance; hitId = id; }
  });
  net.sendTag(hitId); // server validates LOS/range/cone; "" still broadcasts the shot sfx
}

function eliminateLocal() {
  if (!controller) return;
  controller.canMove = false;
  controller.canAct = false;
  controller.avatar.setGhost(true);
  ui.showPaintDock(false);
  ui.showCrosshair(false);
  ui.showTaunt(false);
  ui.setExposed(false);
  ui.banner("ELIMINATED", "Spectating — you can still watch the round play out", "var(--hot)", true);
}

/** React to authoritative state each frame; only act on phase/role/alive changes. */
function applyState() {
  const state = net!.state;
  ui.setCount(state.players.size);
  const me = state.players.get(net!.sessionId);
  if (!me) return;

  // remotes follow + reflect role/alive
  remotes.forEach((rp, id) => {
    const ps = state.players.get(id);
    if (ps) { rp.setTarget(ps.x, ps.y, ps.z, ps.ry); rp.updateMeta(ps.role, ps.alive); }
  });

  if (state.phase !== lastPhase) { onPhaseChange(state.phase, me); lastPhase = state.phase; }
  if (me.role !== lastRole) { controller?.setRole(me.role); ui.setRole(me.role); lastRole = me.role; }
  if (me.alive !== lastAlive) {
    if (!me.alive && state.phase === "hunt") eliminateLocal();
    if (me.alive) controller?.avatar.setGhost(false);
    lastAlive = me.alive;
  }

  if (state.phase === "prep" || state.phase === "hunt") {
    ui.setTimer(state.secondsLeft);
    ui.setScore(me.score);
  }
  if (state.phase === "hunt" && me.role === "hider" && me.alive) ui.setExposed(me.exposed);
}

function onPhaseChange(phase: string, me: any) {
  const host = net!.sessionId === net!.state.hostId;
  const enough = net!.state.players.size >= 2;

  if (phase === "lobby") {
    if (controller) { controller.canMove = true; controller.canAct = true; controller.setRole("hider"); controller.avatar.setGhost(false); }
    lastRole = "hider";
    ui.hideRole(); ui.hideScore(); ui.showTimer(false); ui.showCrosshair(false);
    ui.setExposed(false); ui.showPaintDock(true); ui.showTaunt(false); ui.hideScoreboard(); ui.hideBanner();
    ui.showStart(host && enough);
    ui.setHint(host ? (enough ? "You're the host — press <b>Start round</b> when everyone's in." : "Waiting for one more player to start a round…")
                     : "Paint yourself while you wait for the host to start.");
    return;
  }

  if (phase === "prep") {
    audio.start();
    ui.hideScoreboard(); ui.showStart(false); ui.showTimer(true); ui.setScore(me.score);
    controller?.teleport(me.x, me.z, me.ry);
    if (me.role === "hunter") {
      if (controller) { controller.canMove = false; controller.canAct = false; }
      ui.showPaintDock(false); ui.showCrosshair(false); ui.showTaunt(false); ui.setExposed(false);
      ui.banner("PREP", "You're a HUNTER — locked until the hunt begins", "var(--hot)");
      ui.setHint("Watch where the hiders go. You unlock when the hunt starts.");
    } else {
      if (controller) { controller.canMove = true; controller.canAct = true; }
      ui.showPaintDock(true); ui.showCrosshair(false); ui.showTaunt(false); ui.setExposed(false);
      ui.banner("PREP", "You're a HIDER — blend into the room, fast", "var(--cool)");
      ui.setHint("Left-click to paint · <b>E</b> eyedropper to sample a surface");
    }
    return;
  }

  if (phase === "hunt") {
    if (controller) { controller.canMove = true; controller.canAct = me.alive; }
    ui.showTimer(true);
    if (me.role === "hunter") {
      ui.showPaintDock(false); ui.showCrosshair(true); ui.showTaunt(false);
      ui.banner("HUNT!", "Spot the painted hiders and shoot", "var(--hot)");
      ui.setHint("Left-click to shoot · right-drag to aim");
    } else {
      ui.showPaintDock(me.alive); ui.showCrosshair(false); ui.showTaunt(me.alive);
      ui.banner("HUNT!", "Stay in sight but unspotted to score — taunt for bonus", "var(--cool)");
      ui.setHint("Score while seen-but-unspotted · <b>T</b> to taunt (2.6× points, risky)");
    }
    return;
  }

  if (phase === "ended") {
    audio.end();
    if (controller) { controller.canMove = false; controller.canAct = false; }
    ui.showCrosshair(false); ui.setExposed(false); ui.showPaintDock(false); ui.showTaunt(false); ui.showTimer(false);
    const rows = [...net!.state.players.values()]
      .map((p: any) => ({ name: p.name, role: p.role, score: p.score, alive: p.alive, me: p.id === net!.sessionId }))
      .sort((a, b) => b.score - a.score);
    ui.showScoreboard(rows, net!.state.resultTeam, net!.state.mvpName, net!.state.mvpScore);
    ui.banner(net!.state.resultTeam || "Round over", "", "var(--gold)");
    ui.showStart(host);
    ui.setHint(host ? "Press <b>Start round</b> to play again." : "Waiting for the host to start the next round…");
    return;
  }
}

// ---------------- render loop ----------------
let last = performance.now();
let moveAcc = 0;
const MOVE_DT = 1 / PROTOCOL.MOVE_HZ;
const sent = { x: Infinity, z: Infinity, ry: Infinity, aim: Infinity };

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (controller) {
    controller.update(dt);
    if (net) {
      moveAcc += dt;
      if (moveAcc >= MOVE_DT) {
        moveAcc = 0;
        const g = controller.avatar.group;
        const x = g.position.x, z = g.position.z, ry = g.rotation.y, aim = controller.getAimYaw();
        if (Math.abs(x - sent.x) + Math.abs(z - sent.z) + Math.abs(ry - sent.ry) + Math.abs(aim - sent.aim) > 0.002) {
          net.sendMove({ x, y: g.position.y, z, ry, aim });
          sent.x = x; sent.z = z; sent.ry = ry; sent.aim = aim;
        }
      }
    }
  }

  if (probe) { const r = probe.update(dt); ui.setVisibility(r.visibility, r.watching); }
  if (net?.state) applyState();
  remotes.forEach((rp) => rp.update(dt));

  engine.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
