/** Tiny procedural sound placeholders (WebAudio). Louder for harder hits. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  muted = false;

  /** Call from a user gesture. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  private gate(key: string, gap: number): boolean {
    const now = performance.now();
    if ((this.last.get(key) ?? 0) + gap * 1000 > now) return false;
    this.last.set(key, now);
    return true;
  }

  /** Metallic clang; speed in m/s sets loudness and brightness. */
  clang(speed: number, kind: 'stone' | 'shield' | 'flesh' = 'stone'): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.gate('clang' + kind, 0.05)) return;
    const t = ctx.currentTime;
    const vol = Math.min(1, 0.05 + speed / 30);
    const out = ctx.createGain();
    out.gain.setValueAtTime(vol, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'flesh' ? 0.18 : 0.6));
    out.connect(ctx.destination);
    // noise transient
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'flesh' ? 300 : 1800 + speed * 120;
    bp.Q.value = kind === 'flesh' ? 0.7 : 4;
    src.connect(bp).connect(out);
    src.start(t); src.stop(t + 0.15);
    if (kind !== 'flesh') {
      for (const f of kind === 'shield' ? [420, 690] : [880, 1320, 2150]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * (1 + Math.random() * 0.02);
        const g = ctx.createGain();
        g.gain.value = 0.25;
        o.connect(g).connect(out);
        o.start(t); o.stop(t + 0.6);
      }
    }
  }

  /** Soft scrape for slipping feet. */
  scrape(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.gate('scrape', 0.12)) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.25, intensity / 20000), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(t); src.stop(t + 0.16);
  }

  thud(v: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.gate('thud', 0.08)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, v / 10), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.26);
  }
}
