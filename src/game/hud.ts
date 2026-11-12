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
    Object.assign(this.root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '40', fontFamily: 'system-ui, sans-serif', color: '#f3eee6' });
    this.root.innerHTML = `
      <div style="position:absolute;left:16px;top:14px;width:240px">
        <div style="font-weight:700;letter-spacing:.08em;font-size:13px;text-shadow:0 1px 2px #000">HP <span data-hp></span></div>
        <div style="height:12px;background:#2a0d0d;border:1px solid #000;border-radius:3px;margin-top:4px;overflow:hidden">
          <div data-hpbar style="height:100%;width:100%;background:linear-gradient(#ff6a5a,#b8231a)"></div></div>
      </div>
      <div data-room style="position:absolute;right:16px;top:14px;text-align:right;max-width:46vw;text-shadow:0 1px 3px #000"></div>
      <div data-msg style="position:absolute;left:0;right:0;top:34%;text-align:center;font-size:42px;font-weight:800;letter-spacing:.04em;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .3s"></div>
      <div style="position:absolute;left:16px;bottom:12px;font-size:12px;opacity:.75;text-shadow:0 1px 2px #000">WASD walk · arrows/IJKL swing · Shift grip · 1-4 named attacks · Q/E reach · Space jump · RMB orbit · R restart · Esc pause · F1 debug · gamepad supported</div>
      <div data-pause style="position:absolute;inset:0;z-index:50;background:rgba(10,8,14,.78);display:none;pointer-events:auto;align-items:center;justify-content:center">
        <div style="max-width:820px;padding:24px 30px;background:#1b1622;border:1px solid #4a3d5c;border-radius:10px;line-height:1.5">
          <h1 style="margin:0 0 4px;font-size:30px">Really Big Sword</h1>
          <p style="margin:0 0 14px;opacity:.8">Your sword weighs more than you. Physics is not on your side, and nobody is cheating for you.</p>
          <style>.rbs-ctl td{padding:2px 14px 2px 0;vertical-align:top}.rbs-ctl td:first-child{white-space:nowrap}</style>
          <table class="rbs-ctl" style="border-collapse:collapse;font-size:14px">
            <tr><th></th><th style="text-align:left;padding:2px 14px 6px 0">Keyboard / mouse</th><th style="text-align:left">Gamepad</th></tr>
            <tr><td><b>Walk</b></td><td>WASD (camera relative)</td><td>left stick</td></tr>
            <tr><td><b>Swing</b></td><td>arrows or IJKL · or hold LMB + drag</td><td>face buttons (Y up, A down, X left, B right) · or right stick</td></tr>
            <tr><td><b>Grip (hold still)</b></td><td>Shift</td><td>RT</td></tr>
            <tr><td><b>Named attacks</b></td><td>1 slam · 2 sweep left · 3 sweep right · 4 spin (hold)</td><td>LT + Y / X / B / A</td></tr>
            <tr><td><b>Reach</b></td><td>Q / E or mouse wheel</td><td>D-pad up / down</td></tr>
            <tr><td><b>Jump</b></td><td>Space</td><td>RB</td></tr>
            <tr><td><b>Camera</b></td><td>RMB drag</td><td>D-pad left / right (or right stick, see F1)</td></tr>
            <tr><td><b>Menu</b></td><td>R restart room · Esc pause · F1 debug + tunables</td><td>Back restart · Start pause · L3 debug</td></tr>
          </table>
          <p style="margin:14px 0 0;opacity:.8;font-size:13px">A swing input pushes the sword one way and you the other. Let go and the blade keeps going until it stops or hits something; grip to stop it. Swinging braces your legs automatically. Big horizontal swings mostly spin <i>you</i>; slams work best close in. Holding the sword straight out will tip you over.</p>
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
      <div style="font-size:13px;opacity:.85">${goblinsLeft < 0 ? 'Practice dummies: they never fight back' : goblinsLeft > 0 ? `Goblins left: ${goblinsLeft}` : 'Cleared'}</div>
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
