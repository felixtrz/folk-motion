import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './hud.css';
import type { Specimen } from './specimens.js';
import type { SpecimenStats } from './motion-stats.js';
import { LANG, T } from './i18n.js';

export type HudHandlers = {
  /** A throwable was tapped; x/y is the button centre in client pixels (where the throw starts). */
  throw(index: number, x: number, y: number): void;
  subject(index: number): void;
  sound(on: boolean): void;
  enterXR(): void;
};

const SUBJECTS = T.subjects;
const STUDIO = 'https://elixr.games/';
// The studio's wordmark, as a publisher's imprint: black on paper, links out.
const IMPRINT = `<a class="imprint" href="${STUDIO}" target="_blank" rel="noopener" aria-label="${T.studio}" title="${T.studio}">`
  + `<img src="${import.meta.env.BASE_URL}brand/elixr-games-black.svg" alt="EliXR Games" width="47" height="15"></a>`;
// Line drawings of the four throwables, drawn like specimen-plate figures.
const ICONS = [
  '<path d="M11 6.5h10l1.5 2v15l-1.5 2H11l-1.5-2v-15z"/><path d="M9.5 12.5h13M9.5 19.5h13M14 4.8h4"/>',
  '<path d="M12.5 26.5h7v-3.2h-7zM16 23.3V18M16 18L9 5M16 18l-3.5-13.5M16 18V4.5M16 18l3.5-13.5M16 18l7-13"/>',
  '<path d="M16 4.5c-5 0-8.5 4-8.5 9 0 5.6 4.4 9.6 8.5 10.5 4.1-.9 8.5-4.9 8.5-10.5 0-5-3.5-9-8.5-9z"/><path d="M14.6 24.6h2.8L16 26.4zM16 26.4c-1.2 1.6 1.2 2.4 0 4"/>',
  '<circle cx="16" cy="13" r="2.6"/><circle cx="16" cy="7.6" r="3.2"/><circle cx="20.7" cy="10.3" r="3.2"/><circle cx="20.7" cy="15.7" r="3.2"/><circle cx="16" cy="18.4" r="3.2"/><circle cx="11.3" cy="15.7" r="3.2"/><circle cx="11.3" cy="10.3" r="3.2"/><path d="M13.6 20.8l-2.2 7 2.3-1.1 1.3 2 .9-7.4M18.4 20.8l2.2 7-2.3-1.1-1.3 2-.9-7.4"/>',
].map(d => `<svg viewBox="0 0 32 32" aria-hidden="true">${d}</svg>`);

/** The 2D field-guide overlay. Writes to the DOM only when a value actually changes. */
export class Hud {
  readonly root = document.createElement('div');
  private readonly el: Record<string, HTMLElement> = {};
  private readonly last = new Map<string, string>();
  private notesOpen = false;
  private soundOn: boolean;

  constructor(private readonly specimens: readonly Specimen[], private readonly on: HudHandlers, soundOn: boolean) {
    this.soundOn = soundOn;
    this.root.className = 'hud loading fresh';
    document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
    document.title = T.title;
    this.root.innerHTML = `
      <header class="hud-top">
        <div class="masthead"><span><b>${T.brand}</b><span class="long"> · ${T.guide}</span></span><span data-k="count"></span><div class="mast-subjects" data-k="mastSubjects" role="radiogroup" aria-label="${T.subject}"></div></div>
        <div class="title fade">
          <div class="zh" data-k="zh" lang="zh"></div><div class="plate" data-k="plate"></div>
          <div class="binomial" data-k="binomial"></div>
          <div class="common" data-k="common"></div>
          <div class="class" data-k="legend"></div>
        </div>
        <div class="subjects" data-k="subjects" role="radiogroup" aria-label="${T.subject}"><span>${T.subject}</span></div>
      </header>
      <footer class="hud-bottom">
        <section class="measures" aria-label="${T.measurements}"><h3>${T.measurements}</h3><table><tbody data-k="measures"></tbody></table></section>
        <p class="function"><span data-k="fnLabel"></span><em class="fade" data-k="function"></em></p>
        <dl class="telemetry log" aria-live="polite">
          ${T.log.map((label, i) => `<div><dt>${label}</dt><dd data-k="log${i}">00</dd></div>`).join('')}
        </dl>
        <nav class="tray" data-k="tray">
          ${T.items.map(([label, title], i) => `<button class="item" data-i="${i}" aria-label="${title}" title="${title}"><span class="code">${String(i + 1).padStart(2, '0')}</span>${ICONS[i]}<span class="label">${label}</span></button>`).join('')}
        </nav>
        <div class="foot-row">
          <button class="notes-toggle" data-k="notesToggle" aria-expanded="false">${T.notesButton}</button>
          ${IMPRINT}
          <button class="sound" data-k="sound" aria-pressed="${soundOn}"></button>
        </div>
      </footer>
      <section class="sheet" data-k="sheet" aria-label="${T.notes}">
        <div class="masthead sheet-mast"><span><b>${T.brand}</b> · ${T.notes}</span><button class="close" data-k="close">${T.close}</button></div>
        <div class="sheet-head"><h2 data-k="sheetTitle"></h2></div>
        <div class="sub" data-k="sheetSub"></div>
        <table><tbody data-k="table"></tbody></table>
        <p class="foot">${T.method}<a href="https://www.bilibili.com/video/BV1YMaA6jEpK/" target="_blank" rel="noopener">bilibili BV1YMaA6jEpK</a>.</p>
        <p class="foot caution">${T.caution}</p>
        <p class="foot">${LANG === 'zh' ? `<a href="${STUDIO}" target="_blank" rel="noopener">EliXR Games</a> ${T.imprint}` : `${T.imprint} <a href="${STUDIO}" target="_blank" rel="noopener">EliXR Games</a>`}</p>
        <button class="xr" data-k="xr" hidden>${T.xr}</button>
      </section>`;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(node => { this.el[node.dataset.k!] = node; });
    // The subject switch is drawn twice: a row under the title (desktop) and in the masthead (phones).
    for (const group of [this.el.subjects, this.el.mastSubjects]) {
      SUBJECTS.forEach(([label, title], i) => {
        const b = document.createElement('button');
        b.textContent = label; b.title = title; b.setAttribute('role', 'radio');
        b.addEventListener('click', () => this.on.subject(i));
        group.append(b);
      });
    }
    this.el.tray.querySelectorAll<HTMLButtonElement>('.item').forEach(b => b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      this.on.throw(Number(b.dataset.i), r.left + r.width / 2, r.top + r.height * .45);
    }));
    this.el.notesToggle.addEventListener('click', () => this.setNotes(!this.notesOpen));
    this.el.close.addEventListener('click', () => this.setNotes(false));
    this.el.xr.addEventListener('click', () => this.on.enterXR());
    this.el.sound.addEventListener('click', () => { this.soundOn = !this.soundOn; this.paintSound(); this.on.sound(this.soundOn); });
    this.paintSound();
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
    // The fitted height already includes headroom for raised arms, so the margins stay small.
    // Raised hands may brush the header's fade; the shadow keeps clear of the caption below.
    return [Math.min(.5, top / h - .012), Math.max(.55, bottom / h - .035)];
  }

  showSubject(index: number): void {
    for (const group of [this.el.subjects, this.el.mastSubjects]) {
      [...group.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-checked', String(i === index)));
    }
  }
  setXRAvailable(available: boolean): void { this.el.xr.hidden = !available; }
  setVisible(visible: boolean): void { this.root.style.display = visible ? '' : 'none'; }
  /** While the specimen is busy reacting, the tray rests. */
  setBusy(busy: boolean): void {
    this.el.tray.classList.toggle('busy', busy);
    if (!busy) this.setActive(-1);
  }
  /** The card just thrown stays inked while the specimen responds ("recording"). */
  setActive(index: number): void {
    this.root.classList.remove('fresh');
    this.el.tray.querySelectorAll('.item').forEach((b, i) => b.classList.toggle('active', i === index));
  }
  /** Counts per outcome; `changed` flashes the one that just went up. */
  setLog(counts: readonly number[], trials: number, changed = -1): void {
    counts.forEach((n, i) => this.text(`log${i}`, String(n).padStart(2, '0')));
    this.text('count', `${T.trial} ${String(trials).padStart(3, '0')}`);
    if (changed >= 0) {
      const cell = this.el[`log${changed}`];
      cell.classList.remove('bump'); void cell.offsetWidth; cell.classList.add('bump');
    }
  }

  /** The plate shows the behaviour last observed, or the resting specimen (index null). */
  showBehaviour(index: number | null, stats?: SpecimenStats): void {
    this.root.classList.remove('loading');
    const zh = LANG === 'zh';
    this.root.classList.toggle('resting', index === null);
    if (index === null) {
      // Specimen zero: the control, before any stimulus.
      this.text('zh', T.idleZh); this.text('plate', '0'); this.text('binomial', T.idleBinomial);
      this.el.common.innerHTML = `${T.idleCommon} <i>· dài jī</i>`;
      this.text('fnLabel', T.protocol); this.text('function', T.idleFunction); this.text('legend', T.idleClass);
      return;
    }
    const s = this.specimens[index];
    const copy = zh ? s.zhCopy : { classification: s.classification, origin: s.origin, subject: s.subject, function: s.function };
    this.text('zh', s.zh); this.text('plate', s.plate); this.text('binomial', s.binomial);
    // Second line: the English common name (English) or the tradition (Chinese), then pinyin.
    this.el.common.innerHTML = `${zh ? copy.origin : s.common} <i>· ${s.pinyin}</i>`;
    this.text('fnLabel', T.function); this.text('function', copy.function); this.text('legend', copy.classification);
    if (stats) this.showNotes(index, stats);
  }

  /** Field notes for one specimen (the sheet and the desktop measurements table). */
  showNotes(index: number, stats: SpecimenStats): void {
    const zh = LANG === 'zh', s = this.specimens[index];
    const copy = zh ? s.zhCopy : { classification: s.classification, origin: s.origin, subject: s.subject, function: s.function };
    this.text('sheetTitle', `${s.binomial}`);
    this.el.sheetSub.innerHTML = `<span lang="zh" class="zh-sub">${s.zh}</span><br>${zh ? copy.origin : s.common} · <i>${s.pinyin}</i>`;
    const values = [copy.classification, copy.origin, s.originZh, copy.subject, copy.function,
      `${stats.duration.toFixed(2)} s`, `${stats.contacts}`, `${stats.lateral.toFixed(2)} m`,
      `${stats.pelvisLow.toFixed(2)}–${stats.pelvisHigh.toFixed(2)} m`, `${stats.wristPeak.toFixed(1)} m/s`,
      `${stats.wristHz.toFixed(1)} Hz`, `${stats.headYaw.toFixed(0)}°`];
    // In Chinese the tradition already names the genre, so that row is dropped.
    const rows = T.rows.map((k, i): [string, string] => [k, values[i]]).filter((_, i) => !(zh && i === 2));
    const row = ([k, v]: [string, string]) => {
      const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
      a.textContent = k; b.textContent = v; if (/[一-鿿]/.test(v)) b.lang = 'zh';
      tr.append(a, b); return tr;
    };
    this.el.measures.replaceChildren(...rows.slice(zh ? 4 : 5).map(row));
    this.el.table.replaceChildren(...rows.map(row));
  }

  private paintSound(): void {
    this.el.sound.textContent = `${T.sound} ${this.soundOn ? '●' : '○'}`;
    this.el.sound.setAttribute('aria-pressed', String(this.soundOn));
  }
  private text(key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.el[key].textContent = value; this.last.set(key, value);
  }
  dispose(): void { this.root.remove(); }
}
