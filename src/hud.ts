import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './hud.css';
import type { Specimen } from './specimens.js';
import type { SpecimenStats } from './motion-stats.js';
import { IN_APP, LANG, T } from './i18n.js';

export type HudHandlers = {
  /** A throwable was tapped; x/y is the button centre in client pixels (where the throw starts). */
  throw(index: number, x: number, y: number): void;
  subject(index: number): void;
  sound(on: boolean): void;
  /** Make a shareable plate of this moment. */
  plate(): void;
  enterXR(): void;
};

const SUBJECTS = T.subjects;
const STUDIO = 'https://elixr.games/';
// The studio's wordmark, as a publisher's imprint: black on paper, links out.
const IMPRINT = `<a class="imprint" href="${STUDIO}" target="_blank" rel="noopener" aria-label="${T.studio}" title="${T.studio}">`
  + `<img src="${import.meta.env.BASE_URL}brand/elixr-games-black.svg" alt="EliXR Games" width="47" height="15"></a>`;
// Line drawings of the throwables, drawn like specimen-plate figures: [slot][variant].
const ICONS = [
  [
    '<path d="M11 6.5h10l1.5 2v15l-1.5 2H11l-1.5-2v-15z"/><path d="M9.5 12.5h13M9.5 19.5h13M14 4.8h4"/>',
    '<path d="M14 3.5h4v4.5c0 1 3 2.5 3 5.5V28H11V13.5c0-3 3-4.5 3-5.5z"/><path d="M11 17h10M11 23h10"/>',
    '<path d="M5 13h22v5H5zM6 18h20v4H6z"/><path d="M9 25.5h4M17 25.5h7"/>',
    '<path d="M16 29V15"/><path d="M16 15c-5-1-8-5-7-11 3 1 5 3 7 6 2-3 4-5 7-6 1 6-2 10-7 11z"/><path d="M12.5 8l3.5 4 3.5-4"/>',
  ],
  [
    '<path d="M12.5 26.5h7v-3.2h-7zM16 23.3V18M16 18L9 5M16 18l-3.5-13.5M16 18V4.5M16 18l3.5-13.5M16 18l7-13"/>',
    '<circle cx="16" cy="16" r="11.5"/><path d="M16 11.2l4.3 3.1-1.6 5h-5.4l-1.6-5zM16 4.5v6.7M20.3 14.3l6.4-2M18.7 19.3l3.9 5.4M13.3 19.3l-3.9 5.4M11.7 14.3l-6.4-2"/>',
    '<ellipse cx="16" cy="17" rx="11.5" ry="10.5"/><path d="M8 9.5c3 4 3 11 0 15M13 7c2 5 2 15 0 20M19 7c-2 5-2 15 0 20M24 9.5c-3 4-3 11 0 15M16 6.5V4"/>',
    '<circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="5.5"/><path d="M16 13.5v5M13.5 16h5"/>',
  ],
  [
    '<path d="M16 4.5c-5 0-8.5 4-8.5 9 0 5.6 4.4 9.6 8.5 10.5 4.1-.9 8.5-4.9 8.5-10.5 0-5-3.5-9-8.5-9z"/><path d="M14.6 24.6h2.8L16 26.4zM16 26.4c-1.2 1.6 1.2 2.4 0 4"/>',
    '<path d="M10 9.5h12l-1.6 18H11.6z"/><path d="M9 6.5h14v3H9zM10.8 15h10.4M11.2 21h9.6"/>',
    '<path d="M16 4c-4.6 0-8.5 6.8-8.5 13.5 0 5.6 3.8 10 8.5 10s8.5-4.4 8.5-10C24.5 10.8 20.6 4 16 4z"/>',
    '<path d="M16 9c-6.5 0-10 4.2-10 9s3.8 9 10 9 10-4.2 10-9-3.5-9-10-9z"/><path d="M11.5 8.5L16 11l4.5-2.5M16 11V6"/>',
  ],
  [
    '<circle cx="16" cy="13" r="2.6"/><circle cx="16" cy="7.6" r="3.2"/><circle cx="20.7" cy="10.3" r="3.2"/><circle cx="20.7" cy="15.7" r="3.2"/><circle cx="16" cy="18.4" r="3.2"/><circle cx="11.3" cy="15.7" r="3.2"/><circle cx="11.3" cy="10.3" r="3.2"/><path d="M13.6 20.8l-2.2 7 2.3-1.1 1.3 2 .9-7.4M18.4 20.8l2.2 7-2.3-1.1-1.3 2-.9-7.4"/>',
    '<path d="M11 3.5l5 8 5-8"/><circle cx="16" cy="20" r="7.5"/><path d="M16 15.8l1.3 2.7 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z"/>',
    '<path d="M7 5h18M9.5 5v17L16 27l6.5-5V5"/><path d="M12.5 10h7M16 13v7"/>',
    '<path d="M16 4.5l3.4 7 7.6 1.1-5.5 5.4 1.3 7.6L16 22l-6.8 3.6 1.3-7.6-5.5-5.4 7.6-1.1z"/>',
  ],
].map(slot => slot.map(d => `<svg viewBox="0 0 32 32" aria-hidden="true">${d}</svg>`));

/** The 2D field-guide overlay. Writes to the DOM only when a value actually changes. */
export class Hud {
  readonly root = document.createElement('div');
  private readonly el: Record<string, HTMLElement> = {};
  private readonly last = new Map<string, string>();
  private notesOpen = false;
  private soundOn: boolean;
  private gloss = '';
  private plateFile: File | null = null;
  private busy = false;
  private readonly pendingFlips = new Map<number, number>();
  private plateUrl = '';

  constructor(private readonly specimens: readonly Specimen[], private readonly on: HudHandlers, soundOn: boolean) {
    this.soundOn = soundOn;
    this.root.className = `hud loading fresh${IN_APP ? ' in-app' : ''}`;
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
        <p class="function"><span class="fn-head"><span data-k="fnLabel"></span><button class="plate-btn" data-k="plateBtn">${T.savePlate} ↗</button></span><em class="fade" data-k="function"></em></p>
        <dl class="telemetry log" aria-live="polite">
          ${T.log.map((label, i) => `<div><dt>${label}</dt><dd data-k="log${i}">00</dd></div>`).join('')}
        </dl>
        <nav class="tray" data-k="tray">
          ${T.items.map((_, i) => `<button class="item" data-i="${i}"></button>`).join('')}
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
      </section>
      <section class="plate-sheet" data-k="plateSheet" aria-label="${T.savePlate}">
        <img data-k="plateImg" alt="">
        <p class="hint">${T.plateHint}</p>
        <div class="plate-actions">
          <button class="close" data-k="plateClose">${T.close}</button>
          <a class="download" data-k="plateDownload" download="folk-motion-plate.png">${T.download}</a>
          <button class="share" data-k="plateShare">${T.share} ↗</button>
        </div>
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
    this.el.tray.querySelectorAll<HTMLButtonElement>('.item').forEach((b, i) => this.paintCard(i, 0));
    this.el.tray.querySelectorAll<HTMLButtonElement>('.item').forEach(b => b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      this.on.throw(Number(b.dataset.i), r.left + r.width / 2, r.top + r.height * .45);
    }));
    this.el.notesToggle.addEventListener('click', () => this.setNotes(!this.notesOpen));
    this.el.close.addEventListener('click', () => this.setNotes(false));
    this.el.xr.addEventListener('click', () => this.on.enterXR());
    this.el.plateBtn.addEventListener('click', () => this.on.plate());
    this.el.plateClose.addEventListener('click', () => this.closePlate());
    this.el.plateShare.addEventListener('click', () => {
      // Sharing needs a fresh tap, so the image is prepared before this button is pressed.
      const file = this.plateFile;
      if (file && navigator.canShare?.({ files: [file] })) void navigator.share({ files: [file], title: T.title }).catch(() => undefined);
      else (this.el.plateDownload as HTMLAnchorElement).click();
    });
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
    this.busy = busy;
    if (!busy) {
      this.setActive(-1);
      // Cards flip to their next item once he has finished responding.
      this.pendingFlips.forEach((variant, slot) => this.flipNow(slot, variant));
      this.pendingFlips.clear();
    }
  }

  /** Shows the next thing in a slot's family (flips when the specimen is free again). */
  flipCard(slot: number, variant: number): void {
    if (this.busy) this.pendingFlips.set(slot, variant); else this.flipNow(slot, variant);
  }
  private flipNow(slot: number, variant: number): void {
    const card = this.el.tray.querySelectorAll<HTMLElement>('.item')[slot];
    card.classList.add('flip-out');
    setTimeout(() => {
      this.paintCard(slot, variant);
      card.classList.remove('flip-out'); card.classList.add('flip-in');
      setTimeout(() => card.classList.remove('flip-in'), 220);
    }, 200);
  }
  private paintCard(slot: number, variant: number): void {
    const card = this.el.tray.querySelectorAll<HTMLElement>('.item')[slot];
    const [label, title] = T.items[slot][variant];
    card.setAttribute('aria-label', title); card.title = title;
    const dots = T.items[slot].map((_, k) => `<i class="${k === variant ? 'on' : ''}"></i>`).join('');
    card.innerHTML = `<span class="code">${String(slot + 1).padStart(2, '0')}</span><span class="dots">${dots}</span>${ICONS[slot][variant]}<span class="label">${label}</span>`;
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
      this.gloss = `${T.idleCommon} · dài jī`;
      this.text('fnLabel', T.protocol); this.text('function', T.idleFunction); this.text('legend', T.idleClass);
      return;
    }
    const s = this.specimens[index];
    const copy = zh ? s.zhCopy : { classification: s.classification, origin: s.origin, subject: s.subject, function: s.function };
    this.text('zh', s.zh); this.text('plate', s.plate); this.text('binomial', s.binomial);
    // Second line: the English common name (English) or the tradition (Chinese), then pinyin.
    this.el.common.innerHTML = `${zh ? copy.origin : s.common} <i>· ${s.pinyin}</i>`;
    this.gloss = `${zh ? copy.origin : s.common} · ${s.pinyin}`;
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

  /** The words on the plate: whatever the field guide is showing now. */
  plateText(): { brand: string; guide: string; zh: string; numeral: string; binomial: string; gloss: string; fnLabel: string; fnText: string; zhText: boolean } {
    const get = (k: string) => this.last.get(k) ?? '';
    return { brand: T.brand, guide: T.guide, zh: get('zh'), numeral: get('plate'), binomial: get('binomial'), gloss: this.gloss,
      fnLabel: get('fnLabel'), fnText: get('function'), zhText: LANG === 'zh' };
  }

  showPlate(card: HTMLCanvasElement): void {
    if (this.plateUrl) URL.revokeObjectURL(this.plateUrl);
    this.plateFile = null;
    card.toBlob(blob => {
      if (!blob) return;
      this.plateFile = new File([blob], 'folk-motion-plate.png', { type: 'image/png' });
      this.plateUrl = URL.createObjectURL(blob);
      (this.el.plateImg as HTMLImageElement).src = this.plateUrl;
      (this.el.plateDownload as HTMLAnchorElement).href = this.plateUrl;
      this.el.plateSheet.dataset.open = 'true';
    }, 'image/png');
  }
  closePlate(): void { this.el.plateSheet.dataset.open = 'false'; }

  private paintSound(): void {
    this.el.sound.textContent = `${T.sound} ${this.soundOn ? '●' : '○'}`;
    this.el.sound.setAttribute('aria-pressed', String(this.soundOn));
  }
  private text(key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.el[key].textContent = value; this.last.set(key, value);
  }
  dispose(): void { if (this.plateUrl) URL.revokeObjectURL(this.plateUrl); this.root.remove(); }
}
