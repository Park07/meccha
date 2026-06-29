interface LobbyCbs {
  onSolo: () => void;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
}

interface ScoreRow { name: string; role: string; score: number; alive: boolean; me: boolean; }

const SWATCHES = ["#ff5a47", "#36d6c6", "#ffc24b", "#7be0ff", "#8a5aff", "#5aff9e", "#e7d8bd", "#2a2530"];

/** All DOM chrome. Emits intents; holds no game logic. */
export class UI {
  private layer: HTMLDivElement;
  private bannerTimer?: number;

  onColor?: (hex: string) => void;
  onBrush?: (size: number) => void;
  onEyedropper?: (on: boolean) => void;
  onClear?: () => void;
  onLeave?: () => void;
  onStart?: () => void;
  onTaunt?: () => void;

  constructor(root: HTMLElement) {
    const f = document.createElement("link");
    f.rel = "stylesheet";
    f.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;800&family=Space+Grotesk:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap";
    document.head.appendChild(f);
    this.layer = document.createElement("div");
    this.layer.className = "ui-layer";
    root.appendChild(this.layer);
  }

  // ---------------- lobby ----------------
  showLobby(cb: LobbyCbs) {
    this.layer.innerHTML = `
      <div class="screen"><div class="card">
        <div class="brandrow"><span class="dot"></span><span class="kicker">multiplayer · paint-to-blend</span></div>
        <h1>Meccha Chameleon <span class="d3">3D</span></h1>
        <p class="sub">Blend in or hunt them down. Hiders score while in a hunter's sight but unspotted — paint yourself into the room and dare them to notice.</p>
        <label class="field"><span>Your name</span><input id="name" maxlength="16" placeholder="Chameleon" /></label>
        <div class="row">
          <button id="create" class="btn primary">Create room</button>
          <button id="solo" class="btn ghost">Paint solo</button>
        </div>
        <div class="joinrow"><input id="code" placeholder="room code" /><button id="join" class="btn">Join</button></div>
        <p id="err" class="err"></p>
        <p class="credit">A fan tribute to <b>めっちゃカメレオン</b> by Lemorion_1224 &amp; Haganeiro. Unaffiliated.</p>
      </div></div>`;
    const name = () => (this.q<HTMLInputElement>("#name").value || "Chameleon").trim();
    this.q("#create").addEventListener("click", () => cb.onCreate(name()));
    this.q("#solo").addEventListener("click", () => cb.onSolo());
    this.q("#join").addEventListener("click", () => {
      const code = this.q<HTMLInputElement>("#code").value.trim();
      if (!code) { this.error("Enter a room code to join."); return; }
      cb.onJoin(name(), code);
    });
  }

  // ---------------- HUD ----------------
  showHUD(info: { solo: boolean; code: string }) {
    const swatches = SWATCHES.map((c) => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join("");
    this.layer.innerHTML = `
      <div class="hud">
        <div class="topbar">
          <div class="chip ${info.solo ? "solo" : ""}" id="codechip" title="click to copy">
            <span class="lbl">${info.solo ? "MODE" : "ROOM"}</span><span class="val" id="codeval">${info.code}</span></div>
          <div class="chip"><span class="lbl">PLAYERS</span><span class="val" id="count">1</span></div>
          <div class="chip" id="rolechip" style="display:none"><span class="lbl">ROLE</span><span class="val" id="role"></span></div>
          <div class="chip" id="timerchip" style="display:none"><span class="lbl">TIME</span><span class="val" id="timer"></span></div>
          <div class="chip" id="scorechip" style="display:none"><span class="lbl" id="scorelbl">SCORE</span><span class="val" id="scoreval">0</span></div>
          <button class="chip leave" id="leave">Leave</button>
        </div>

        <div id="crosshair" style="display:none"></div>
        <div id="insight" style="display:none">● IN SIGHT — SCORING</div>

        <div id="banner" style="display:none"><div id="banner-title"></div><div id="banner-sub"></div></div>

        <div class="dock" id="dock" style="display:none">
          <div class="tools">
            <input type="color" id="color" value="#ff5a47" />
            <button id="eye" class="tbtn" title="Eyedropper (E)">⤓ pick</button>
            <button id="clear" class="tbtn" title="Clear paint">↺ clear</button>
            <button id="taunt" class="tbtn taunt" title="Taunt (T)" style="display:none">◎ taunt</button>
          </div>
          <div class="swatches">${swatches}</div>
          <label class="size"><span>brush</span><input type="range" id="size" min="4" max="40" value="14" /></label>
        </div>

        <button id="startbtn" class="bigbtn" style="display:none">Start round</button>
        <div id="hint" class="hint"></div>

        <div id="scoreboard" style="display:none"><div class="sbcard">
          <div id="sb-result" class="sb-result"></div>
          <div id="sb-mvp" class="sb-mvp"></div>
          <div id="sb-list"></div>
        </div></div>
      </div>`;

    const color = this.q<HTMLInputElement>("#color");
    color.addEventListener("input", () => this.onColor?.(color.value));
    this.q("#size").addEventListener("input", (e) => this.onBrush?.(parseInt((e.target as HTMLInputElement).value, 10)));
    this.q("#eye").addEventListener("click", () => this.onEyedropper?.(true));
    this.q("#clear").addEventListener("click", () => this.onClear?.());
    this.q("#taunt").addEventListener("click", () => this.onTaunt?.());
    this.q("#leave").addEventListener("click", () => this.onLeave?.());
    this.q("#startbtn").addEventListener("click", () => this.onStart?.());
    this.layer.querySelectorAll<HTMLButtonElement>(".sw").forEach((b) =>
      b.addEventListener("click", () => { color.value = b.dataset.c!; this.onColor?.(b.dataset.c!); }));

    if (!info.solo) {
      this.q("#codechip").addEventListener("click", () => {
        navigator.clipboard?.writeText(info.code).catch(() => {});
        this.toast("Room code copied");
      });
    } else {
      const hud = this.q(".hud");
      const v = document.createElement("div");
      v.className = "vision";
      v.innerHTML = `<div class="vrow"><span class="lbl">VISIBILITY</span><span class="vstat" id="vstat">HIDDEN</span></div><div class="vbar"><div class="vfill" id="vfill"></div></div>`;
      hud.appendChild(v);
    }
  }

  // ---- HUD updates ----
  setCount(n: number) { this.text("#count", String(n)); }

  setRole(role: string) {
    const chip = this.q("#rolechip"); const el = this.q("#role");
    chip.style.display = "";
    el.textContent = role === "hunter" ? "HUNTER" : "HIDER";
    el.style.color = role === "hunter" ? "var(--hot)" : "var(--cool)";
  }
  hideRole() { const c = this.layer.querySelector<HTMLElement>("#rolechip"); if (c) c.style.display = "none"; }

  setScore(value: number) { this.q("#scorechip").style.display = ""; this.text("#scoreval", String(Math.round(value))); }
  hideScore() { const c = this.layer.querySelector<HTMLElement>("#scorechip"); if (c) c.style.display = "none"; }

  showTimer(on: boolean) { const c = this.layer.querySelector<HTMLElement>("#timerchip"); if (c) c.style.display = on ? "" : "none"; }
  setTimer(sec: number) {
    const m = Math.floor(sec / 60), s = sec % 60;
    this.text("#timer", `${m}:${String(s).padStart(2, "0")}`);
  }

  setExposed(on: boolean) { const el = this.layer.querySelector<HTMLElement>("#insight"); if (el) el.style.display = on ? "" : "none"; }
  showCrosshair(on: boolean) { const el = this.layer.querySelector<HTMLElement>("#crosshair"); if (el) el.style.display = on ? "" : "none"; }
  shootFlash() { const c = this.layer.querySelector<HTMLElement>("#crosshair"); if (c) { c.classList.add("fire"); setTimeout(() => c.classList.remove("fire"), 90); } }

  showPaintDock(on: boolean) { const d = this.layer.querySelector<HTMLElement>("#dock"); if (d) d.style.display = on ? "" : "none"; }
  showTaunt(on: boolean) { const t = this.layer.querySelector<HTMLElement>("#taunt"); if (t) t.style.display = on ? "" : "none"; }
  showStart(on: boolean) { const b = this.layer.querySelector<HTMLElement>("#startbtn"); if (b) b.style.display = on ? "" : "none"; }
  setHint(html: string) { const h = this.layer.querySelector<HTMLElement>("#hint"); if (h) h.innerHTML = html; }

  banner(title: string, sub: string, color: string, persist = false) {
    const b = this.q("#banner");
    this.q("#banner-title").textContent = title;
    this.q("#banner-title").style.color = color;
    this.q("#banner-sub").textContent = sub;
    b.style.display = "";
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    if (!persist) this.bannerTimer = window.setTimeout(() => (b.style.display = "none"), 2200);
  }
  hideBanner() { const b = this.layer.querySelector<HTMLElement>("#banner"); if (b) b.style.display = "none"; }

  showScoreboard(rows: ScoreRow[], resultTeam: string, mvpName: string, mvpScore: number) {
    const sb = this.q("#scoreboard");
    this.q("#sb-result").textContent = resultTeam;
    this.q("#sb-mvp").innerHTML = mvpName ? `Top chameleon: <b>${mvpName}</b> · ${mvpScore} pts` : "";
    this.q("#sb-list").innerHTML = rows.map((r) => `
      <div class="sb-row ${r.me ? "me" : ""}">
        <span class="sb-name">${r.name}${r.me ? " (you)" : ""}</span>
        <span class="sb-role ${r.role}">${r.role === "hunter" ? "HUNTER" : r.alive ? "SURVIVED" : "TAGGED"}</span>
        <span class="sb-score">${Math.round(r.score)}</span>
      </div>`).join("");
    sb.style.display = "";
  }
  hideScoreboard() { const s = this.layer.querySelector<HTMLElement>("#scoreboard"); if (s) s.style.display = "none"; }

  // ---- solo visibility meter ----
  setVisibility(v: number, watching: boolean) {
    const fill = this.layer.querySelector<HTMLElement>("#vfill");
    const stat = this.layer.querySelector<HTMLElement>("#vstat");
    if (!fill || !stat) return;
    const c = Math.min(1, Math.max(0, v));
    let col = "#36d6c6", label = "HIDDEN";
    if (watching) {
      if (c < 0.34) { col = "#36d6c6"; label = "BLENDED"; }
      else if (c < 0.64) { col = "#ffc24b"; label = "NOTICEABLE"; }
      else { col = "#ff5a47"; label = "EXPOSED"; }
    }
    fill.style.width = (watching ? Math.max(6, Math.round(c * 100)) : 0) + "%";
    fill.style.background = col;
    stat.textContent = label;
    stat.style.color = watching ? col : "var(--muted)";
  }

  color(): string { return this.layer.querySelector<HTMLInputElement>("#color")?.value ?? "#ff5a47"; }
  setColor(hex: string) { const el = this.layer.querySelector<HTMLInputElement>("#color"); if (el) el.value = hex; }
  setEyedropper(on: boolean) { const e = this.layer.querySelector("#eye"); if (e) e.classList.toggle("armed", on); }
  error(msg: string) { this.text("#err", msg); }

  toast(msg: string) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    this.layer.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T { return this.layer.querySelector(sel) as T; }
  private text(sel: string, v: string) { const el = this.layer.querySelector(sel); if (el) el.textContent = v; }
}
