/** Plain DOM HUD: health, room, messages, pause/controls screen. */
export class Hud {
  private root: HTMLDivElement;
  private hp: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private room: HTMLDivElement;
  private msg: HTMLDivElement;
  private pause: HTMLDivElement;
  private msgTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', fontFamily: 'system-ui, sans-serif', color: '#f3eee6' });
    this.root.innerHTML = `
      <div style="position:absolute;left:16px;top:14px;width:240px">
        <div style="font-weight:700;letter-spacing:.08em;font-size:13px;text-shadow:0 1px 2px #000">HP <span data-hp></span></div>
        <div style="height:12px;background:#2a0d0d;border:1px solid #000;border-radius:3px;margin-top:4px;overflow:hidden">
          <div data-hpbar style="height:100%;width:100%;background:linear-gradient(#ff6a5a,#b8231a)"></div></div>
      </div>
      <div data-room style="position:absolute;right:16px;top:14px;text-align:right;max-width:46vw;text-shadow:0 1px 3px #000"></div>
      <div data-msg style="position:absolute;left:0;right:0;top:34%;text-align:center;font-size:42px;font-weight:800;letter-spacing:.04em;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .3s"></div>
      <div style="position:absolute;left:16px;bottom:12px;font-size:12px;opacity:.75;text-shadow:0 1px 2px #000">WASD walk · hold LMB + drag to swing · wheel reach · Space jump · RMB orbit · R restart room · Esc pause · F1 debug</div>
      <div data-pause style="position:absolute;inset:0;background:rgba(10,8,14,.78);display:none;pointer-events:auto;align-items:center;justify-content:center">
        <div style="max-width:620px;padding:28px 34px;background:#1b1622;border:1px solid #4a3d5c;border-radius:10px;line-height:1.5">
          <h1 style="margin:0 0 4px;font-size:30px">Really Big Sword</h1>
          <p style="margin:0 0 14px;opacity:.8">Your sword weighs more than you. Physics is not on your side, and nobody is cheating for you.</p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:2px 14px 2px 0"><b>WASD</b></td><td>walk (camera relative). Your legs push only through foot friction.</td></tr>
            <tr><td><b>Hold LMB + drag</b></td><td>swing the sword in the drag direction; drag speed = swing speed. Hold still = hold the pose.</td></tr>
            <tr><td><b>Arrow keys</b></td><td>the same swings from the keyboard</td></tr>
            <tr><td><b>Mouse wheel</b></td><td>pull the sword in / push it out</td></tr>
            <tr><td><b>Space</b></td><td>jump (only with feet on the ground, no air control)</td></tr>
            <tr><td><b>RMB drag</b></td><td>orbit the camera</td></tr>
            <tr><td><b>R</b> / <b>Esc</b> / <b>F1</b></td><td>restart room / pause / debug overlay + tunables</td></tr>
          </table>
          <p style="margin:14px 0 0;opacity:.8;font-size:13px">Tips: a hard horizontal swing mostly spins <i>you</i>. Let gravity bring the blade down, or build up a spin over several seconds like a hammer thrower. Holding the sword straight out will tip you over.</p>
          <p style="margin:12px 0 0;font-size:15px"><b>Click or press Esc to play.</b></p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(`[data-${s}]`) as HTMLDivElement;
    this.hp = q('hpbar'); this.hpText = q('hp'); this.room = q('room'); this.msg = q('msg'); this.pause = q('pause');
  }

  set onResume(fn: () => void) { this.pause.addEventListener('click', fn); }

  setHealth(hp: number, max: number): void {
    this.hp.style.width = `${Math.max(0, (hp / max) * 100)}%`;
    this.hpText.textContent = `${Math.max(0, Math.ceil(hp))} / ${max}`;
  }

  setRoom(name: string, hint: string, goblinsLeft: number): void {
    this.room.innerHTML = `<div style="font-size:18px;font-weight:700">${name}</div>
      <div style="font-size:13px;opacity:.85">${goblinsLeft > 0 ? `Goblins left: ${goblinsLeft}` : 'Cleared'}</div>
      <div style="font-size:12px;opacity:.7;margin-top:4px">${hint}</div>`;
  }

  message(text: string, seconds = 2.2): void {
    this.msg.textContent = text;
    this.msg.style.opacity = '1';
    this.msgTimer = seconds;
  }

  showPause(v: boolean): void { this.pause.style.display = v ? 'flex' : 'none'; }

  update(dt: number): void {
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.msg.style.opacity = '0'; }
  }
}
