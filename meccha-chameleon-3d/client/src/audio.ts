/** Tiny procedural sound — no assets. Lazily inits on first user gesture. */
class GameAudio {
  private ctx?: AudioContext;

  init() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.2, slideTo?: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  private noise(dur: number, gain = 0.3) {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.ctx.destination);
    s.start();
  }

  shot() { this.noise(0.18, 0.35); this.tone(120, 0.18, "square", 0.18, 40); }
  tag() { this.tone(440, 0.35, "sawtooth", 0.22, 110); }
  taunt() { this.tone(720, 0.1, "square", 0.14); setTimeout(() => this.tone(940, 0.12, "square", 0.14), 110); }
  start() { [392, 523, 659].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.18), i * 90)); }
  end() { this.tone(330, 0.5, "sine", 0.18); this.tone(247, 0.5, "sine", 0.13); }
}

export const audio = new GameAudio();
