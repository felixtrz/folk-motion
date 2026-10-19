import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './hud.css';
import type { Specimen } from './specimens.js';
import type { SpecimenStats } from './motion-stats.js';

export type HudHandlers = {
  select(index: number): void;
  togglePlay(): void;
  cycleSpeed(): void;
  scrub(fraction: number, done: boolean): void;
  enterXR(): void;
  subject(index: number): void;
};
type Contact = { foot: 'left' | 'right'; start: number; end: number };

const SUBJECTS: [string, string][] = [['Human', 'Homo sapiens, folk-trained'], ['Robot', 'Automaton, general purpose'], ['Croc', 'Homo sapiens in Crocodylus costume']];
const PLAY = '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z"/></svg>';

/** The 2D field-guide overlay. Writes to the DOM only when a value actually changes. */
export class Hud {
  readonly root = document.createElement('div');
  private readonly el: Record<string, HTMLElement> = {};
  private readonly last = new Map<string, string>();
  private lanes: HTMLElement[] = [];
  private notesOpen = false;

  constructor(private readonly specimens: readonly Specimen[], private readonly on: HudHandlers) {
    this.root.className = 'hud loading';
    this.root.innerHTML = `
      <header class="hud-top">
        <div class="masthead"><span><b>Folk Motion Studies</b><span class="long"> · Field Guide</span></span><span data-k="count"></span></div>
        <div class="title fade">
          <div class="zh" data-k="zh" lang="zh"></div><div class="plate" data-k="plate"></div>
          <div class="binomial" data-k="binomial"></div>
          <div class="common" data-k="common"></div>
          <div class="class" data-k="legend"></div>
        </div>
        <div class="subjects" data-k="subjects" role="radiogroup" aria-label="Subject"><span>Subject</span></div>
      </header>
      <footer class="hud-bottom">
        <section class="measures" aria-label="Measurements"><h3>Measurements</h3><table><tbody data-k="measures"></tbody></table></section>
        <p class="function fade"><span>Observed function</span><em data-k="function"></em></p>
        <dl class="telemetry" aria-hidden="true">
          <div><dt>t</dt><dd data-k="t"></dd></div>
          <div><dt>pelvis</dt><dd data-k="pelvis"></dd></div>
          <div><dt>hand</dt><dd data-k="hand"></dd></div>
          <div><dt>planted · own</dt><dd class="feet" title="Filled: foot planted. Outline: foot in the air.">L<i class="dot" data-k="footL"></i> R<i class="dot" data-k="footR"></i></dd></div>
        </dl>
        <div class="gait hit" data-k="gait" role="slider" aria-label="Scrub through the movement" tabindex="0">
          <span class="lane-label l">L</span><span class="lane-label r">R</span>
          <div class="lane l" data-k="laneL"></div><div class="lane r" data-k="laneR"></div>
          <div class="playhead" data-k="playhead"></div>
        </div>
        <div class="scale"><span data-k="scale0">0.00 s</span><span>foot contact</span><span data-k="scale1"></span></div>
        <nav class="controls">
          <div class="index" data-k="index"></div>
          <button class="speed" data-k="speed" aria-label="Playback speed"></button>
          <button class="notes-toggle" data-k="notesToggle" aria-expanded="false">Notes</button>
          <button class="play" data-k="play" aria-label="Pause"></button>
        </nav>
      </footer>
      <section class="sheet" data-k="sheet" aria-label="Field notes">
        <div class="masthead sheet-mast"><span><b>Folk Motion Studies</b> · Field notes</span><button class="close" data-k="close">Close</button></div>
        <div class="sheet-head"><h2 data-k="sheetTitle"></h2></div>
        <div class="sub" data-k="sheetSub"></div>
        <table><tbody data-k="table"></tbody></table>
        <p class="foot">Method. Reconstructed from a single 720p teaching video by monocular pose estimation. Depth is
          estimated, feet are pinned to observed contacts, and legs in close-up shots are inferred.
          Source: <a href="https://www.bilibili.com/video/BV1YMaA6jEpK/" target="_blank" rel="noopener">bilibili BV1YMaA6jEpK</a>.</p>
        <p class="foot caution">Not a substitute for an instructor. Do not attempt the bear near furniture.</p>
        <button class="xr" data-k="xr" hidden>View in headset ↗</button>
      </section>`;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(node => { this.el[node.dataset.k!] = node; });
    specimens.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = String(i + 1).padStart(2, '0');
      b.setAttribute('aria-label', `${s.common}`);
      b.addEventListener('click', () => this.on.select(i));
      this.el.index.append(b);
    });
    SUBJECTS.forEach(([label, title], i) => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title; b.setAttribute('role', 'radio');
      b.addEventListener('click', () => this.on.subject(i));
      this.el.subjects.append(b);
    });
    this.el.play.addEventListener('click', () => this.on.togglePlay());
    this.el.speed.addEventListener('click', () => this.on.cycleSpeed());
    this.el.notesToggle.addEventListener('click', () => this.setNotes(!this.notesOpen));
    this.el.close.addEventListener('click', () => this.setNotes(false));
    this.el.xr.addEventListener('click', () => this.on.enterXR());
    const gait = this.el.gait;
    const scrub = (event: PointerEvent, done: boolean) => {
      const box = this.el.laneL.getBoundingClientRect();
      this.on.scrub(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), done);
    };
    gait.addEventListener('pointerdown', e => { gait.setPointerCapture(e.pointerId); scrub(e, false); });
    gait.addEventListener('pointermove', e => { if (gait.hasPointerCapture(e.pointerId)) scrub(e, false); });
    gait.addEventListener('pointerup', e => { scrub(e, true); gait.releasePointerCapture(e.pointerId); });
    document.body.append(this.root);
  }

  get open(): boolean { return this.notesOpen; }
  setNotes(open: boolean): void {
    this.notesOpen = open;
    this.el.sheet.dataset.open = String(open);
    this.el.notesToggle.setAttribute('aria-expanded', String(open));
  }
  /** Screen fractions [top, bottom] of the area the HUD leaves free for the specimen. */
  freeBand(): [number, number] {
    const h = window.innerHeight || 1;
    this.root.style.setProperty('--header-h', `${(this.root.querySelector('.hud-top') as HTMLElement).offsetHeight}px`);
    const top = this.root.querySelector('.hud-top')!.getBoundingClientRect().bottom;
    const bottom = this.root.querySelector('.function')!.getBoundingClientRect().top;
    return [Math.min(.5, top / h + .025), Math.max(.55, bottom / h - .02)];
  }

  showSubject(index: number): void {
    [...this.el.subjects.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-checked', String(i === index)));
  }
  setXRAvailable(available: boolean): void { this.el.xr.hidden = !available; }
  setVisible(visible: boolean): void { this.root.style.display = visible ? '' : 'none'; }

  /** Static content for one specimen: titles, notes table, gait lanes. */
  showSpecimen(index: number, stats: SpecimenStats, contacts: Contact[], start: number, end: number): void {
    const s = this.specimens[index];
    this.root.classList.remove('loading');
    this.text('count', `Pl. ${s.plate} / ${['I', 'II', 'III', 'IV'][this.specimens.length - 1]}`);
    this.text('zh', s.zh); this.text('plate', s.plate); this.text('binomial', s.binomial);
    this.el.common.innerHTML = `${s.common} <i>· ${s.pinyin}</i>`;
    this.text('function', s.function);
    this.text('legend', s.classification);
    this.text('scale1', `${(end - start).toFixed(2)} s`);
    this.text('sheetTitle', `${s.binomial}`);
    this.el.sheetSub.innerHTML = `<span lang="zh" class="zh-sub">${s.zh}</span><br>${s.common} · <i>${s.pinyin}</i>`;
    const rows: [string, string][] = [
      ['Classification', s.classification],
      ['Tradition', `${s.origin}`],
      ['Genre', s.originZh],
      ['Observed subject', s.subject],
      ['Observed function', s.function],
      ['Duration', `${stats.duration.toFixed(2)} s`],
      ['Foot contacts', `${stats.contacts}`],
      ['Lateral excursion', `${stats.lateral.toFixed(2)} m`],
      ['Pelvis height', `${stats.pelvisLow.toFixed(2)}–${stats.pelvisHigh.toFixed(2)} m`],
      ['Peak hand speed', `${stats.wristPeak.toFixed(1)} m/s`],
      ['Hand oscillation', `${stats.wristHz.toFixed(1)} Hz`],
      ['Head yaw range', `${stats.headYaw.toFixed(0)}°`],
    ];
    const row = ([k, v]: [string, string]) => {
      const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
      a.textContent = k; b.textContent = v; tr.append(a, b); return tr;
    };
    this.el.measures.replaceChildren(...rows.slice(5).map(row));
    this.el.table.replaceChildren(...rows.map(([k, v]) => {
      const tr = document.createElement('tr');
      const a = document.createElement('td'), b = document.createElement('td');
      a.textContent = k; b.textContent = v; if (/[\u4e00-\u9fff]/.test(v)) b.lang = 'zh';
      tr.append(a, b); return tr;
    }));
    this.lanes.forEach(n => n.remove());
    this.lanes = contacts.filter(c => c.end > start && c.start < end).map(c => {
      const bar = document.createElement('i');
      const a = Math.max(c.start, start), b = Math.min(c.end, end);
      bar.style.left = `${(a - start) / (end - start) * 100}%`;
      bar.style.width = `${Math.max(.4, (b - a) / (end - start) * 100)}%`;
      (c.foot === 'left' ? this.el.laneL : this.el.laneR).append(bar);
      return bar;
    });
    [...this.el.index.children].forEach((b, i) => b.setAttribute('aria-current', String(i === index)));
  }

  /** Per-frame values; cheap when nothing changed. */
  tick(fraction: number, time: number, pelvis: number, hand: number, left: boolean, right: boolean, playing: boolean, speed: number): void {
    const x = `calc(14px + (100% - 14px) * ${fraction.toFixed(4)})`;
    if (this.last.get('ph') !== x) { this.el.playhead.style.left = x; this.last.set('ph', x); }
    this.text('t', `${time.toFixed(2)} s`);
    this.text('pelvis', `${pelvis.toFixed(2)} m`);
    this.text('hand', `${hand.toFixed(2)} m/s`);
    this.toggle('footL', left); this.toggle('footR', right);
    const icon = playing ? PAUSE : PLAY;
    if (this.last.get('play') !== icon) { this.el.play.innerHTML = icon; this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); this.last.set('play', icon); }
    this.text('speed', `${speed}×`);
  }

  private text(key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.el[key].textContent = value; this.last.set(key, value);
  }
  private toggle(key: string, on: boolean): void {
    const v = String(on);
    if (this.last.get(key) === v) return;
    this.el[key].classList.toggle('on', on); this.last.set(key, v);
  }
  dispose(): void { this.root.remove(); }
}
