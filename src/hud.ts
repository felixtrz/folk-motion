import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './hud.css';
import type { Specimen } from './specimens.js';
import type { SpecimenStats } from './motion-stats.js';
import { IN_APP, LANG, T } from './i18n.js';
import { MINITOOL, has, loadValue, miniTool, saveValue } from './platform.js';
import { REPORT_MIN_TRIALS, type Persona } from './persona.js';

/** What a lab report was made from: travels with a comment as its challenge. */
export type ReportMeta = { persona: Persona; counts: number[]; subject: number };
const statLine = (counts: readonly number[]) => counts.map((n, i) => `${T.log[i]} ${n}`).join(' · ');
import wordmarkUrl from './brand/elixr-games-black.svg?url';

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
// Inside the mini-tool container links cannot open, so the wordmark is a plain mark there.
const MARK = `<img src="${wordmarkUrl}" alt="EliXR Games" width="47" height="15">`;
const IMPRINT = MINITOOL
  ? `<span class="imprint" data-k="imprint" title="EliXR Games">${MARK}</span>`
  : `<a class="imprint" data-k="imprint" href="${STUDIO}" target="_blank" rel="noopener" aria-label="${T.studio}" title="${T.studio}">${MARK}</a>`;
const studioLink = (text: string) => MINITOOL ? text : `<a href="${STUDIO}" target="_blank" rel="noopener">${text}</a>`;
const SOURCE = MINITOOL ? 'bilibili BV1YMaA6jEpK' : '<a href="https://www.bilibili.com/video/BV1YMaA6jEpK/" target="_blank" rel="noopener">bilibili BV1YMaA6jEpK</a>';
// Line drawings of the throwables, drawn like specimen-plate figures: [slot][variant].
const ASK_AFTER = 5;    // throws before the tray asks for a follow
const ASKED_KEY = 'fms-follow-ask';   // 'declined' or 'followed': the tray never asks again

/**
 * A comment's snapshot, if the tool was opened from one. The platform documents writing it but
 * not where it comes back, so every launch source is searched for our own tagged object.
 */
async function findSnapshot(api: ReturnType<typeof miniTool>): Promise<ReportMeta | null> {
  const search = (o: unknown, depth: number): ReportMeta | null => {
    if (depth > 5 || o == null) return null;
    if (typeof o === 'string') {
      if (o.indexOf('fms') < 0) return null;
      try { return search(JSON.parse(o), depth + 1); } catch {
        try { return search(JSON.parse(decodeURIComponent(o)), depth + 1); } catch { return null; }
      }
    }
    if (typeof o !== 'object') return null;
    const v = o as { fms?: number; p?: Persona; c?: number[]; s?: number };
    if (v.fms === 1 && typeof v.p === 'string' && Array.isArray(v.c) && v.c.length === 4) {
      return { persona: v.p, counts: v.c.map(n => Math.max(0, Math.min(999, Number(n) || 0))), subject: Number(v.s) || 0 };
    }
    for (const key of Object.keys(o as object)) {
      const hit = search((o as Record<string, unknown>)[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const xhs = (window as unknown as { xhs?: { launchOptions?: unknown } }).xhs;
  const params: string[] = [];
  new URLSearchParams(location.search).forEach(v => params.push(v));
  let hit = search(xhs && xhs.launchOptions, 0) || search(params, 0);
  if (!hit && api && typeof api.getLaunchOptions === 'function') {
    try { hit = search(await api.getLaunchOptions(), 0); } catch { /* not available */ }
  }
  return hit;
}

const ICONS = [
  [
    '<path d="M11 6.5h10l1.5 2v15l-1.5 2H11l-1.5-2v-15z"/><path d="M9.5 12.5h13M9.5 19.5h13M14 4.8h4"/>',
    '<path d="M14 3.5h4v4.5c0 1 3 2.5 3 5.5V28H11V13.5c0-3 3-4.5 3-5.5z"/><path d="M11 17h10M11 23h10"/>',
    '<path d="M16 3.5c4 0 6 3 6 8.5 0 6-1.5 9-1.5 12.5 0 2.5-2 4-4.5 4s-4.5-1.5-4.5-4c0-3.5-1.5-6.5-1.5-12.5 0-5.5 2-8.5 6-8.5z"/><path d="M10.4 10.5c3.4 2 7.8 2 11.2 0"/>',
    '<path d="M5 13h22v5H5zM6 18h20v4H6z"/><path d="M9 25.5h4M17 25.5h7"/>',
    '<path d="M16 29V15"/><path d="M16 15c-5-1-8-5-7-11 3 1 5 3 7 6 2-3 4-5 7-6 1 6-2 10-7 11z"/><path d="M12.5 8l3.5 4 3.5-4"/>',
  ],
  [
    '<path d="M12.5 26.5h7v-3.2h-7zM16 23.3V18M16 18L9 5M16 18l-3.5-13.5M16 18V4.5M16 18l3.5-13.5M16 18l7-13"/>',
    '<circle cx="16" cy="16" r="11.5"/><path d="M16 11.2l4.3 3.1-1.6 5h-5.4l-1.6-5zM16 4.5v6.7M20.3 14.3l6.4-2M18.7 19.3l3.9 5.4M13.3 19.3l-3.9 5.4M11.7 14.3l-6.4-2"/>',
    '<path d="M5 21.5c0-6.5 5-11.5 11-11.5s11 5 11 11.5c0 2-1.5 3-3.5 3h-15c-2 0-3.5-1-3.5-3z"/><path d="M13 11l3 2.5 3-2.5M16 13.5V9"/>',
    '<ellipse cx="16" cy="17" rx="11.5" ry="10.5"/><path d="M8 9.5c3 4 3 11 0 15M13 7c2 5 2 15 0 20M19 7c-2 5-2 15 0 20M24 9.5c-3 4-3 11 0 15M16 6.5V4"/>',
    '<circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="5.5"/><path d="M16 13.5v5M13.5 16h5"/>',
  ],
  [
    '<path d="M16 4.5c-5 0-8.5 4-8.5 9 0 5.6 4.4 9.6 8.5 10.5 4.1-.9 8.5-4.9 8.5-10.5 0-5-3.5-9-8.5-9z"/><path d="M14.6 24.6h2.8L16 26.4zM16 26.4c-1.2 1.6 1.2 2.4 0 4"/>',
    '<path d="M10 9.5h12l-1.6 18H11.6z"/><path d="M9 6.5h14v3H9zM10.8 15h10.4M11.2 21h9.6"/>',
    '<path d="M10 10h12l-1.8 18h-8.4z"/><path d="M9.5 8h13v2h-13zM17 8l2.5-5"/><circle cx="13.5" cy="24" r="1.1"/><circle cx="16.5" cy="25" r="1.1"/><circle cx="18.8" cy="23.2" r="1.1"/>',
    '<path d="M16 4c-4.6 0-8.5 6.8-8.5 13.5 0 5.6 3.8 10 8.5 10s8.5-4.4 8.5-10C24.5 10.8 20.6 4 16 4z"/>',
    '<path d="M16 9c-6.5 0-10 4.2-10 9s3.8 9 10 9 10-4.2 10-9-3.5-9-10-9z"/><path d="M11.5 8.5L16 11l4.5-2.5M16 11V6"/>',
  ],
  [
    '<circle cx="16" cy="13" r="2.6"/><circle cx="16" cy="7.6" r="3.2"/><circle cx="20.7" cy="10.3" r="3.2"/><circle cx="20.7" cy="15.7" r="3.2"/><circle cx="16" cy="18.4" r="3.2"/><circle cx="11.3" cy="15.7" r="3.2"/><circle cx="11.3" cy="10.3" r="3.2"/><path d="M13.6 20.8l-2.2 7 2.3-1.1 1.3 2 .9-7.4M18.4 20.8l2.2 7-2.3-1.1-1.3 2-.9-7.4"/>',
    '<path d="M11 3.5l5 8 5-8"/><circle cx="16" cy="20" r="7.5"/><path d="M16 15.8l1.3 2.7 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z"/>',
    '<rect x="9" y="4.5" width="14" height="23" rx="1.5"/><path d="M9 9.5l7 5 7-5"/><circle cx="16" cy="18" r="2.6"/>',
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
  private plateFiles: File[] = [];
  private plateUrls: string[] = [];
  private plateIndex = 0;
  private report: ReportMeta | null = null;
  private busy = false;
  private readonly pendingFlips = new Map<number, number>();
  // The follow prompt: after ASK_AFTER throws the tray's card pairs merge into "follow" and
  // "decline" (once a session, only in the container, only if not already following).
  private trials = 0;
  private subject = 0;
  private asked = false;
  private following = false;
  private follow: (() => Promise<boolean>) | null = null;

  constructor(private readonly specimens: readonly Specimen[], private readonly on: HudHandlers, soundOn: boolean) {
    this.soundOn = soundOn;
    this.root.className = `hud loading fresh${IN_APP ? ' in-app' : ''}`;
    document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
    document.title = T.title;
    this.root.innerHTML = `
      <header class="hud-top">
        <div class="masthead"><span><b>${T.brand}</b><span class="long"> · ${T.guide}</span></span><span data-k="count"></span></div>
        <div class="title fade">
          <div class="zh" data-k="zh" lang="zh"></div><div class="plate" data-k="plate"></div>
          <div class="binomial" data-k="binomial"></div>
          <div class="common" data-k="common"></div>
          <div class="class" data-k="legend"></div>
        </div>
        <div class="subjects" data-k="subjects" role="radiogroup" aria-label="${T.subject}"><span>${T.subject}</span></div>
        <div class="subject-label"><span>${T.subjectLabel}</span> · <b data-k="subjectName"></b> <span class="of" data-k="subjectOf"></span></div>
      </header>
      <button class="arrow prev" data-k="prevSubject" aria-label="${T.prevSubject}">‹</button>
      <button class="arrow next" data-k="nextSubject" aria-label="${T.nextSubject}">›</button>
      <footer class="hud-bottom">
        <section class="measures" aria-label="${T.measurements}"><h3>${T.measurements}</h3><table><tbody data-k="measures"></tbody></table></section>
        <p class="function"><span class="fn-head"><span data-k="fnLabel"></span><button class="plate-btn" data-k="plateBtn">${T.savePlate} ↗</button></span><em class="fade" data-k="function"></em></p>
        <div class="report-cta" data-k="reportCta">
          <span class="cta-head" aria-hidden="true"><span>${T.makeReport}</span><span>→</span></span>
          <dl class="telemetry log" aria-live="polite">
            ${T.log.map((label, i) => `<div><dt>${label}</dt><dd data-k="log${i}">00</dd></div>`).join('')}
          </dl>
        </div>
        <button class="challenge" data-k="challenge" hidden>
          <span class="kicker">${T.challengeFrom}</span><b data-k="challengeName"></b><span data-k="challengeStats"></span><span class="you">${T.challengeYou}</span>
        </button>
        <nav class="tray" data-k="tray">
          ${T.items.map((_, i) => `<button class="item" data-i="${i}"></button>`).join('')}
          <div class="ask" data-k="ask" aria-hidden="true">
            <button class="yes" data-k="askYes" tabindex="-1"><b data-k="askYesText">${T.askFollow}</b><span data-k="askYesSub">${T.askFollowSub}</span></button>
            <button class="no" data-k="askNo" tabindex="-1"><b>${T.askNo}</b><span>${T.askNoSub}</span></button>
          </div>
        </nav>
        <div class="foot-row">
          <button class="notes-toggle" data-k="notesToggle" aria-expanded="false">${T.notesButton}</button>
          ${IMPRINT}
          <button class="follow" data-k="follow" hidden>${T.follow}</button>
          <button class="sound" data-k="sound" aria-pressed="${soundOn}"></button>
        </div>
      </footer>
      <section class="sheet" data-k="sheet" aria-label="${T.notes}">
        <div class="masthead sheet-mast"><span><b>${T.brand}</b> · ${T.notes}</span><button class="close" data-k="close">${T.close}</button></div>
        <div class="sheet-head"><h2 data-k="sheetTitle"></h2></div>
        <div class="sub" data-k="sheetSub"></div>
        <table><tbody data-k="table"></tbody></table>
        <p class="foot">${T.method}${SOURCE}.</p>
        <p class="foot caution">${T.caution}</p>
        <p class="foot">${LANG === 'zh' ? `${studioLink('EliXR Games')} ${T.imprint}` : `${T.imprint} ${studioLink('EliXR Games')}`}</p>
        <button class="xr" data-k="xr" hidden>${T.xr}</button>
      </section>
      <section class="plate-sheet" data-k="plateSheet" aria-label="${T.savePlate}">
        <div class="plate-view" data-k="plateView"><div class="plate-track" data-k="plateTrack"></div></div>
        <div class="plate-dots" data-k="plateDots"></div>
        <p class="hint" data-k="plateHint">${MINITOOL ? '' : T.plateHint}</p>
        <div class="plate-actions">
          <button class="close" data-k="plateClose">${T.close}</button>
          ${MINITOOL
            ? `<button class="save" data-k="plateSave">${T.saveAlbum}</button><button class="post" data-k="plateNote">${T.postNote} ↗</button>`
            : `<a class="download" data-k="plateDownload" download="folk-motion-plate.png">${T.download}</a><button class="share" data-k="plateShare">${T.share} ↗</button>`}
        </div>
        ${MINITOOL ? `<button class="plate-comment" data-k="plateComment" hidden>${T.comment} ↗</button>` : ''}
      </section>`;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(node => { this.el[node.dataset.k!] = node; });
    // The notes sheet lists the subjects; the stage switcher steps through them.
    for (const group of [this.el.subjects]) {
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
    if (MINITOOL) this.bindContainer();
    else this.el.plateShare.addEventListener('click', () => {
      // Sharing needs a fresh tap, so the image is prepared before this button is pressed.
      const files = this.plateFiles;
      if (files.length && navigator.canShare?.({ files })) void navigator.share({ files, title: T.title }).catch(() => undefined);
      else (this.el.plateDownload as HTMLAnchorElement).click();
    });
    this.el.sound.addEventListener('click', () => { this.soundOn = !this.soundOn; this.paintSound(); this.on.sound(this.soundOn); });
    this.bindCarousel();
    this.el.reportCta.addEventListener('click', () => { if (this.el.reportCta.classList.contains('ready')) this.on.plate(); });
    this.el.prevSubject.addEventListener('click', () => this.on.subject((this.subject + SUBJECTS.length - 1) % SUBJECTS.length));
    this.el.nextSubject.addEventListener('click', () => this.on.subject((this.subject + 1) % SUBJECTS.length));
    this.el.challenge.addEventListener('click', () => { this.el.challenge.hidden = true; });
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
    this.subject = index;
    this.text('subjectName', SUBJECTS[index][0]);
    this.text('subjectOf', `${index + 1}/${SUBJECTS.length}`);
    for (const group of [this.el.subjects]) {
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
      // After the card flips have played.
      if (this.follow && !this.asked && !this.following && this.trials >= ASK_AFTER) { this.asked = true; setTimeout(() => this.ask(true), 480); }
    }
  }

  private ask(on: boolean): void {
    const tray = this.el.tray;
    tray.classList.toggle('asking', on);
    this.el.ask.setAttribute('aria-hidden', String(!on));
    for (const k of ['askYes', 'askNo']) this.el[k].tabIndex = on ? 0 : -1;
    if (!on) {
      // The cards slide back out of the merged buttons; 'returning' carries the slower timing.
      tray.classList.add('returning');
      setTimeout(() => tray.classList.remove('returning'), 700);
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
    if (index >= 0) this.el.challenge.hidden = true;
    this.root.classList.remove('fresh');
    this.el.tray.querySelectorAll('.item').forEach((b, i) => b.classList.toggle('active', i === index));
  }
  /** Counts per outcome; `changed` flashes the one that just went up. */
  setLog(counts: readonly number[], trials: number, changed = -1): void {
    this.trials = trials;
    // From the third throw the score row is the lab report's button (the small link retires).
    const ready = trials >= REPORT_MIN_TRIALS;
    if (ready !== this.el.reportCta.classList.contains('ready')) {
      this.el.reportCta.classList.toggle('ready', ready);
      this.el.reportCta.setAttribute('role', ready ? 'button' : '');
      this.el.reportCta.tabIndex = ready ? 0 : -1;
      this.el.plateBtn.hidden = ready;
    }
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
    // (No replaceChildren: it needs Chrome 86; the mini-tool container's floor is Chrome 61.)
    const fill = (el: HTMLElement, nodes: Node[]) => { el.textContent = ''; nodes.forEach(n => el.appendChild(n)); };
    fill(this.el.measures, rows.slice(zh ? 4 : 5).map(row));
    fill(this.el.table, rows.map(row));
  }

  /** The words on the plate: whatever the field guide is showing now. */
  plateText(): { brand: string; guide: string; zh: string; numeral: string; binomial: string; gloss: string; fnLabel: string; fnText: string; zhText: boolean } {
    const get = (k: string) => this.last.get(k) ?? '';
    return { brand: T.brand, guide: T.guide, zh: get('zh'), numeral: get('plate'), binomial: get('binomial'), gloss: this.gloss,
      fnLabel: get('fnLabel'), fnText: get('function'), zhText: LANG === 'zh' };
  }

  /** Opens the sheet on `cards`: one plate, or a lab report (personality card, then plates). */
  showPlate(cards: HTMLCanvasElement[], report: ReportMeta | null): void {
    this.plateUrls.forEach(u => URL.revokeObjectURL(u));
    this.plateUrls = []; this.plateFiles = []; this.report = report;
    const blobs = cards.map(c => new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png')));
    void Promise.all(blobs).then(list => {
      const ok = list.filter((b): b is Blob => !!b);
      this.plateFiles = ok.map((b, i) => new File([b], `folk-motion-${i + 1}.png`, { type: 'image/png' }));
      this.plateUrls = ok.map(b => URL.createObjectURL(b));
      this.el.plateTrack.innerHTML = this.plateUrls.map(u => `<div class="plate-slide"><img src="${u}" alt="" draggable="false"></div>`).join('');
      this.el.plateDots.innerHTML = this.plateUrls.length > 1 ? this.plateUrls.map(() => '<i></i>').join('') : '';
      if (this.el.plateComment) this.el.plateComment.hidden = !report || !has('interactionOpenApi');
      this.el.plateHint.textContent = MINITOOL ? '' : T.plateHint;
      this.goTo(0);
      this.el.plateSheet.dataset.open = 'true';
    });
  }

  private goTo(index: number): void {
    this.plateIndex = Math.max(0, Math.min(this.plateUrls.length - 1, index));
    const track = this.el.plateTrack;
    track.style.transition = ''; track.style.transform = `translateX(${-this.plateIndex * 100}%)`;
    this.el.plateDots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === this.plateIndex));
    // The website's download link (the mini-tool has none, and must not carry one).
    if (!MINITOOL && this.el.plateDownload) {
      const a = this.el.plateDownload as HTMLAnchorElement;
      a.href = this.plateUrls[this.plateIndex] ?? ''; a.download = `folk-motion-${this.plateIndex + 1}.png`;
    }
  }

  /** Swipe between the report's cards (no scroll-snap: the container's floor is Chrome 61). */
  private bindCarousel(): void {
    const view = this.el.plateView, track = this.el.plateTrack;
    let x0 = -1, dx = 0;
    view.addEventListener('pointerdown', e => {
      if (this.plateUrls.length < 2) return;
      x0 = e.clientX; dx = 0; track.style.transition = 'none';
      try { view.setPointerCapture(e.pointerId); } catch { /* the swipe still works without capture */ }
    });
    view.addEventListener('pointermove', e => {
      if (x0 < 0) return;
      dx = e.clientX - x0;
      track.style.transform = `translateX(calc(${-this.plateIndex * 100}% + ${dx}px))`;
    });
    const end = () => {
      if (x0 < 0) return;
      x0 = -1;
      this.goTo(this.plateIndex + (dx < -40 ? 1 : dx > 40 ? -1 : 0));
    };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    this.el.plateDots.addEventListener('click', e => {
      const i = [...this.el.plateDots.children].indexOf(e.target as Element);
      if (i >= 0) this.goTo(i);
    });
  }

  /** Someone opened the tool from a comment carrying a lab report: show their result. */
  showChallenge(meta: ReportMeta): void {
    const p = T.personas[meta.persona];
    if (!p) return;
    this.el.challengeName.textContent = `${T.challengeWas}「${p[0]}」`;
    this.el.challengeStats.textContent = statLine(meta.counts);
    this.el.challenge.hidden = false;
    if (meta.subject >= 0 && meta.subject < SUBJECTS.length) this.on.subject(meta.subject);
  }
  closePlate(): void { this.el.plateSheet.dataset.open = 'false'; }

  /**
   * Inside the container: the plate is saved with saveImageToPhotosAlbum and posted with
   * postNote (both via a temp file, as the container advises for large images); a follow
   * button appears where followAuthor exists (9.51+); the header clears the container's
   * menu buttons (getWindowInfo, 9.49+).
   */
  private bindContainer(): void {
    const api = miniTool();
    const say = (text: string) => { this.el.plateHint.textContent = text; };
    const tempFile = async (index = this.plateIndex): Promise<string> => {
      const img = this.el.plateTrack.querySelectorAll('img')[index] as HTMLImageElement;
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const data = c.toDataURL('image/jpeg', .92);
      if (api && typeof api.writeTempFile === 'function') return String((await api.writeTempFile({ data })).filePath);
      return data;
    };
    this.el.plateSave.addEventListener('click', async () => {
      if (!api || typeof api.saveImageToPhotosAlbum !== 'function') { say(T.failed); return; }
      try { await api.saveImageToPhotosAlbum({ filePath: await tempFile() }); say(T.saved); } catch { say(T.failed); }
    });
    this.el.plateNote.addEventListener('click', async () => {
      if (!api || typeof api.postNote !== 'function') { say(T.failed); return; }
      try {
        // A lab report posts as one carousel note, the personality card first.
        const urls: { url: string }[] = [];
        for (let i = 0; i < this.plateUrls.length; i++) urls.push({ url: await tempFile(i) });
        const r = this.report, p = r ? T.personas[r.persona] : null;
        await api.postNote(r && p
          ? { title: T.noteReportTitle(p[0]), content: `${T.shareText(p[0], statLine(r.counts))}\n${p[2]}\n${T.noteContent}`, pageType: 'photo_publish', mediaInfo: { image_resources: urls } }
          : { title: T.noteTitle, content: T.noteContent, pageType: 'photo_publish', mediaInfo: { image_resources: urls.slice(this.plateIndex, this.plateIndex + 1) } });
      } catch { say(T.failed); }
    });
    // The comment challenge (9.49+): the personality card and its numbers go into the comment
    // section; the report rides along as the comment's snapshot, for whoever opens it.
    this.el.plateComment.addEventListener('click', async () => {
      const r = this.report;
      if (!r || !api || typeof api.interactionOpenApi !== 'function' || typeof api.writeTempFile !== 'function') { say(T.failed); return; }
      try {
        const p = T.personas[r.persona];
        await api.interactionOpenApi({
          payload: {
            action: 'post_comment', content: T.shareText(p[0], statLine(r.counts)),
            media_bean: [{ media_type: 'image', cover_image_url: await tempFile(0) }],
            miniToolSnapshotInfo: JSON.stringify({ fms: 1, p: r.persona, c: r.counts, s: r.subject }),
          },
          saveToAlbum: false,
        });
      } catch { say(T.failed); }
    });
    void findSnapshot(api).then(meta => { if (meta) this.showChallenge(meta); });
    if (has('followAuthor')) {
      const button = this.el.follow as HTMLButtonElement;
      const paint = (status: unknown) => {
        const on = status === 1 || status === 2;
        button.textContent = on ? T.followed : T.follow; button.disabled = on; this.following = on;
        return on;
      };
      button.hidden = false; this.el.imprint.hidden = true;
      if (has('getFollowStatus')) api!.getFollowStatus!().then(r => paint(r.follow_status)).catch(() => undefined);
      this.follow = () => api!.followAuthor!().then(r => paint(r.follow_status)).catch(() => false);
      button.addEventListener('click', () => { void this.follow!(); });
      void loadValue(ASKED_KEY).then(v => { if (v) this.asked = true; });
      const settle = (answer: string) => { void saveValue(ASKED_KEY, answer); };
      this.el.askYes.addEventListener('click', () => {
        void this.follow!().then(on => {
          // Cancelling the container's confirmation counts as a decline.
          settle(on ? 'followed' : 'declined');
          if (!on) { this.ask(false); return; }
          // A beat of thanks on the button itself, then the cards come back.
          this.el.askYesText.textContent = T.followed; this.el.askYesSub.textContent = T.askThanks; this.el.askYes.classList.add('done');
          setTimeout(() => this.ask(false), 1100);
        });
      });
      this.el.askNo.addEventListener('click', () => { settle('declined'); this.ask(false); });
    }
    if (has('getWindowInfo')) {
      api!.getWindowInfo!().then(info => {
        const buttons = (info.menuButtons ?? {}) as Record<string, { bottom?: number } | null>;
        let bottom = 0;
        for (const b of Object.values(buttons)) if (b && typeof b.bottom === 'number') bottom = Math.max(bottom, b.bottom);
        if (bottom) { this.root.style.setProperty('--container-top', `${bottom + 6}px`); window.dispatchEvent(new Event('resize')); }
      }).catch(() => undefined);
    }
  }

  private paintSound(): void {
    this.el.sound.textContent = `${T.sound} ${this.soundOn ? '●' : '○'}`;
    this.el.sound.setAttribute('aria-pressed', String(this.soundOn));
  }
  private text(key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.el[key].textContent = value; this.last.set(key, value);
  }
  dispose(): void { this.plateUrls.forEach(u => URL.revokeObjectURL(u)); this.root.remove(); }
}
