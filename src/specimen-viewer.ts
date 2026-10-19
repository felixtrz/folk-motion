import {
  CanvasTexture, Color, DirectionalLight, SRGBColorSpace, Fog, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera,
  PlaneGeometry, Quaternion, Vector3, Euler, createSystem,
} from '@iwsdk/core';
import { ContactShadow } from './contact-shadow.js';
import { Hud } from './hud.js';
import { InstructorRig } from './instructor-rig.js';
import { measure, type SpecimenStats } from './motion-stats.js';
import { MOVES, validateMotion, type Motion } from './motion.js';
import { SPECIMENS } from './specimens.js';

const PAPER = 0xf7f7f5;   // far floor, horizon and page; the light pool under the subject is brighter
const STAGE = new Vector3(.7, 0, -2.8);
const SPEEDS = [1, .5, .25];
const FOOTPRINTS = 0;   // footprints read as floor debris in review; the contact lanes carry that data
const AVATARS = ['instructor', 'robot', 'croc'] as const;

/**
 * Phone-first field-guide viewer (everything outside a headset session): plays the
 * selected specimen on loop in a white studio, frames it for the screen's aspect,
 * orbits on drag, stamps footprints at observed contacts and drives the HUD.
 */
export class SpecimenViewer extends createSystem({}) {
  private guide!: Object3D;
  private subjects: { id: string; object: Object3D; rig: InstructorRig; feet: Object3D[]; hips: Object3D }[] = [];
  private subject = 0;
  private frame = 0;
  private panel!: Object3D;
  private hud!: Hud;
  private motions: Motion[] = [];
  private stats: SpecimenStats[] = [];
  private ready = false;
  private selected = 0;
  private time = 0;
  private playing = true;
  private speedIndex = 0;
  private scrubbing = false;
  private presenting = false;
  private readonly points = Array.from({ length: 33 }, () => new Vector3());
  private readonly confidence = new Float32Array(33);
  private readonly target = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private azimuth = 0;
  private elevation = .23;
  private azimuthVelocity = 0;
  private idle = 0;
  private follow = 0;
  private shadow!: ContactShadow;
  private contact!: ContactShadow;
  private extents: number[] = [];
  private tops: number[] = [];
  private band = [.3, .74];
  private bandDirty = true;
  private prints: Mesh[] = [];
  private printCanvases: HTMLCanvasElement[] = [];
  private readonly lastPlant = [new Vector3(), new Vector3()];
  private printAge = new Float32Array(FOOTPRINTS);
  private nextPrint = 0;
  private wasContact = [false, false];
  private handSpeed = 0;
  private uiElapsed = 0;

  init(): void {
    // Three subjects share one rig and motion; only the selected one is shown and posed.
    this.subjects = (['Instructor', 'Robot', 'Croc'] as const).map((node, i) => {
      const object = this.world.requireSceneObject(node);
      return { id: AVATARS[i], object, rig: new InstructorRig(object), feet: ['LeftFoot', 'RightFoot'].map(n => object.getObjectByName(n)!), hips: object.getObjectByName('Hips')! };
    });
    this.guide = this.subjects[0].object;
    this.panel = this.world.requireSceneObject('LessonControls');
    this.setupStudio();
    this.readUrl();
    this.hud = new Hud(SPECIMENS, {
      select: i => this.select(i),
      togglePlay: () => { this.playing = !this.playing; this.writeUrl(); },
      cycleSpeed: () => { this.speedIndex = (this.speedIndex + 1) % SPEEDS.length; },
      scrub: (fraction, done) => this.scrub(fraction, done),
      subject: i => this.selectSubject(i),
      enterXR: () => { try { this.world.launchXR(); } catch { /* Unsupported: the button stays harmless. */ } },
    });
    this.cleanupFuncs.push(() => this.hud.dispose());
    void navigator.xr?.isSessionSupported('immersive-vr').then(ok => this.hud.setXRAvailable(ok)).catch(() => undefined);
    this.bindInput();
    const resize = () => { this.bandDirty = true; };
    window.addEventListener('resize', resize);
    this.cleanupFuncs.push(() => window.removeEventListener('resize', resize));
    // Review hook for deterministic captures (scripts/phone-shots.mjs); off unless ?review=1.
    if (new URLSearchParams(location.search).get('review') === '1') {
      (window as unknown as { __review: object }).__review = {
        seek: (specimen: number, t: number, az?: number, el?: number) => {
          this.playing = true; this.select(specimen - 1, t); this.playing = false; this.clearPrints();
          if (az !== undefined) { this.azimuth = az * Math.PI / 180; this.idle = -1e9; }
          if (el !== undefined) this.elevation = el * Math.PI / 180;
        },
        play: (t: number) => { this.time = t; },
        camera: () => { const c = this.world.camera as PerspectiveCamera; return { band: this.band, aspect: c.aspect, fov: c.fov, target: this.target.toArray(), player: this.world.player.position.toArray(), top: this.tops[this.selected], span: this.extents[this.selected] }; },
        shadows: () => [this.shadow.probe(this.world.renderer), this.contact.probe(this.world.renderer)],
        light: () => {
          const out: number[][] = [];
          this.world.requireSceneObject('KeyLight').traverse(o => {
            const l = o as DirectionalLight;
            if (l.isDirectionalLight) out.push(l.getWorldPosition(new Vector3()).toArray(), l.target.getWorldPosition(new Vector3()).toArray(), [l.target.parent ? 1 : 0]);
          });
          return out;
        },
      };
    }
    this.selectSubject(this.subject);
    void this.load();
  }

  private setupStudio(): void {
    const renderer = this.world.renderer, scene = this.world.scene;
    // Phones report a device pixel ratio of 3; 2 is indistinguishable here and renders 2.25x fewer pixels.
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(PAPER, 1);
    scene.background = new Color(PAPER);
    scene.fog = new Fog(PAPER, 10, 18);
    renderer.shadowMap.enabled = false;
    const group = new Group(); group.name = 'StudioMarks';
    this.world.createTransformEntity(group);
    // Two layers, as in product photography: a wide faint ambient shadow of the whole body
    // and a tight dark occlusion that only sees the bottom 25 cm, so soles read as planted.
    this.shadow = new ContactShadow(this.guide, 2.8, 1.3, 256, 2.6, .42, 1.3);
    this.contact = new ContactShadow(this.guide, 1.6, .2, 512, 1.6, 1, 1);
    this.contact.plane.renderOrder = 2;
    group.add(this.shadow.plane, this.contact.plane);
    this.cleanupFuncs.push(() => { this.shadow.dispose(); this.contact.dispose(); });
    // Gait trace: a printed sole and a label (L1, R2, ...) where each contact began.
    const printGeometry = new PlaneGeometry(.36, .36).rotateX(-Math.PI / 2);
    for (let i = 0; i < FOOTPRINTS; i++) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const texture = new CanvasTexture(canvas); texture.anisotropy = 8;
      const m = new Mesh(printGeometry, new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      m.name = `Footprint${i}`; m.renderOrder = 3; m.visible = false; group.add(m); this.prints.push(m); this.printCanvases.push(canvas);
    }
    this.world.requireSceneObject('PracticeStage').getObjectByName('ShadowCatcher')!.visible = false;
    // The floor draws first and writes no depth, so the shadow and footprint overlays lying
    // on it can never z-fight with it (they would at a grazing angle, as radial streaks).
    const floor = this.world.requireSceneObject('PracticeStage').getObjectByName('StudioFloor') as Mesh;
    (floor.material as MeshBasicMaterial).depthWrite = false;
    floor.renderOrder = -1;
    // A soft pool of light under the subject that falls off into the page colour: the floor
    // reads as a lit studio cove rather than flat paper.
    const pool = document.createElement('canvas'); pool.width = pool.height = 512;
    const pg = pool.getContext('2d')!, grad = pg.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, '#fbfbfa'); grad.addColorStop(.3, '#f9f9f7'); grad.addColorStop(.6, '#f7f7f5'); grad.addColorStop(1, '#f7f7f5');
    pg.fillStyle = grad; pg.fillRect(0, 0, 512, 512);
    const poolMap = new CanvasTexture(pool); poolMap.colorSpace = SRGBColorSpace;
    (floor.material as MeshBasicMaterial).map = poolMap;
    (floor.material as MeshBasicMaterial).color.set(0xffffff);
    (floor.material as MeshBasicMaterial).needsUpdate = true;
    this.cleanupFuncs.push(() => { scene.fog = null; });
  }

  private async load(): Promise<void> {
    try {
      this.motions = await Promise.all(MOVES.map(async move => {
        const response = await fetch(`${import.meta.env.BASE_URL}motion/${move.id}.json`);
        if (!response.ok) throw new Error(`Missing motion: ${move.id}`);
        return validateMotion(await response.json());
      }));
      this.stats = this.motions.map((m, i) => measure(m, MOVES[i].watchStart, MOVES[i].watchEnd));
      // Widest reach of the hands relative to the camera's follow point, over the whole clip.
      this.extents = this.motions.map((m, i) => {
        let reach = .55;
        for (let f = Math.floor(MOVES[i].watchStart * m.fps); f < Math.min(m.frameCount, MOVES[i].watchEnd * m.fps); f++) {
          const follow = m.root[f * 3] * .55;
          for (let w = 1; w <= 2; w++) reach = Math.max(reach, Math.abs(m.joints[f * 9 + w * 3] - follow));
        }
        return reach + .08;
      });
      // Highest point over the clip (raised hands, or the head plus the tallest headgear).
      this.tops = this.motions.map((m, i) => {
        let top = 1.8;
        for (let f = Math.floor(MOVES[i].watchStart * m.fps); f < Math.min(m.frameCount, MOVES[i].watchEnd * m.fps); f++) {
          top = Math.max(top, m.joints[f * 9 + 1] + .2, m.joints[f * 9 + 4] + .1, m.joints[f * 9 + 7] + .1);
        }
        return top;
      });
      // One specimen box for every plate (like specimens drawn to a common scale): the tallest
      // reach and widest span over all clips, so the figure's scale never drifts between plates.
      // Common height for every plate; only a clip whose arms fly wider steps back.
      // Fit the typical tallest pose; rare overhead extremes may use the band's margin.
      const top = Math.min(2.08, Math.max(...this.tops));
      this.tops = this.tops.map(() => top);
      this.ready = true;
      this.select(this.selected, this.time);
    } catch (error) {
      console.warn('Specimen motion unavailable', error);
    }
  }

  private select(index: number, time?: number): void {
    if (!this.ready) { this.selected = index; return; }
    this.selected = (index + MOVES.length) % MOVES.length;
    const move = MOVES[this.selected];
    this.time = time !== undefined && time >= move.watchStart && time <= move.watchEnd ? time : move.watchStart;
    this.clearPrints();
    this.bandDirty = true;
    this.hud.showSpecimen(this.selected, this.stats[this.selected], this.motions[this.selected].contacts ?? [], move.watchStart, move.watchEnd);
    this.writeUrl();
  }

  private selectSubject(index: number): void {
    this.subject = (index + this.subjects.length) % this.subjects.length;
    this.guide.visible = false;
    this.guide = this.subjects[this.subject].object;
    this.guide.visible = true;
    this.shadow.setSubject(this.guide); this.contact.setSubject(this.guide);
    this.hud.showSubject(this.subject);
    this.writeUrl();
  }

  private scrub(fraction: number, done: boolean): void {
    if (!this.ready) return;
    const move = MOVES[this.selected];
    this.scrubbing = !done;
    this.time = move.watchStart + fraction * (move.watchEnd - move.watchStart);
    this.clearPrints();
    if (done) this.writeUrl();
  }

  private bindInput(): void {
    const canvas = this.world.renderer.domElement;
    let dragging = -1, lastX = 0, lastY = 0;
    const down = (e: PointerEvent) => { if (this.presenting) return; dragging = e.pointerId; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== dragging) return;
      const dx = (e.clientX - lastX) / Math.max(1, canvas.clientWidth), dy = (e.clientY - lastY) / Math.max(1, canvas.clientHeight);
      lastX = e.clientX; lastY = e.clientY;
      this.azimuth -= dx * 4; this.azimuthVelocity = -dx * 4 * 60;
      this.elevation = Math.min(1.45, Math.max(.05, this.elevation + dy * 1.5));
      this.idle = 0;
    };
    const up = (e: PointerEvent) => { if (e.pointerId === dragging) dragging = -1; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    const key = (e: KeyboardEvent) => {
      if (this.presenting || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.code === 'ArrowRight') this.select(this.selected + 1);
      else if (e.code === 'ArrowLeft') this.select(this.selected - 1);
      else if (e.code === 'Space') { this.playing = !this.playing; this.writeUrl(); }
      else if (/^Digit[1-4]$/.test(e.code)) this.select(Number(e.code.slice(-1)) - 1);
      else if (e.code === 'KeyN') this.hud.setNotes(!this.hud.open);
      else if (e.code === 'Escape') this.hud.setNotes(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
    });
  }

  private readUrl(): void {
    const q = new URLSearchParams(location.search);
    const s = Number(q.get('specimen'));
    if (s >= 1 && s <= MOVES.length) this.selected = s - 1;
    const t = Number(q.get('t'));
    if (q.has('t') && Number.isFinite(t)) this.time = t;
    if (q.get('paused') === '1') this.playing = false;
    const avatar = AVATARS.indexOf((q.get('avatar') ?? '') as typeof AVATARS[number]);
    if (avatar >= 0) this.subject = avatar;
    const az = Number(q.get('az'));
    if (q.has('az') && Number.isFinite(az)) this.azimuth = az * Math.PI / 180;
  }
  private writeUrl(): void {
    const q = new URLSearchParams(location.search);
    q.set('specimen', String(this.selected + 1));
    if (this.subject) q.set('avatar', AVATARS[this.subject]); else q.delete('avatar');
    if (this.playing) { q.delete('paused'); q.delete('t'); } else { q.set('paused', '1'); q.set('t', this.time.toFixed(2)); }
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }

  /** Crisp gait-lab mark: a clean sole outline, toe toward -v. Contacts are labelled in the HUD lanes. */
  private drawPrint(canvas: HTMLCanvasElement): void {
    const g = canvas.getContext('2d')!, k = canvas.width / 256, cx = 128 * k, toe = 46 * k, heel = 168 * k;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.beginPath();
    g.moveTo(cx, toe);
    g.bezierCurveTo(cx + 26 * k, toe, cx + 30 * k, toe + 46 * k, cx + 22 * k, toe + 70 * k);
    g.bezierCurveTo(cx + 15 * k, toe + 90 * k, cx + 20 * k, heel - 12 * k, cx, heel);
    g.bezierCurveTo(cx - 20 * k, heel - 12 * k, cx - 17 * k, toe + 90 * k, cx - 22 * k, toe + 70 * k);
    g.bezierCurveTo(cx - 30 * k, toe + 46 * k, cx - 26 * k, toe, cx, toe);
    g.filter = `blur(${3 * k}px)`;
    g.fillStyle = 'rgba(20,20,19,0.22)'; g.fill();
    g.filter = 'none';
  }

  private clearPrints(): void {
    for (const p of this.prints) { p.visible = false; }
    this.printAge.fill(0);
    this.wasContact[0] = this.wasContact[1] = false;
  }

  update(delta: number): void {
    const presenting = this.world.renderer.xr.isPresenting;
    if (presenting !== this.presenting) {
      this.presenting = presenting;
      this.hud.setVisible(!presenting);
      if (presenting) {
        this.world.player.position.set(0, 0, 0); this.world.camera.quaternion.identity();
        const camera = this.world.camera as PerspectiveCamera; camera.near = .001; camera.updateProjectionMatrix();
      }
      // The headset lesson always uses the human instructor and its wrist guides.
      for (const s of this.subjects) s.object.visible = presenting ? s.id === 'instructor' : false;
      const human = this.subjects[0].object;
      human.getObjectByName('LeftWristGuide')!.visible = presenting;
      human.getObjectByName('RightWristGuide')!.visible = presenting;
    }
    this.panel.visible = presenting;
    if (presenting) { this.setMarks(false); return; }
    for (const s of this.subjects) {
      s.object.getObjectByName('LeftWristGuide')!.visible = false;
      s.object.getObjectByName('RightWristGuide')!.visible = false;
      if (s.object !== this.guide) s.object.visible = false;
    }
    if (!this.ready) { this.guide.visible = false; return; }
    const move = MOVES[this.selected], motion = this.motions[this.selected];
    if (this.playing && !this.scrubbing) {
      this.time += delta * SPEEDS[this.speedIndex];
      if (this.time > move.watchEnd) { this.time = move.watchStart; this.clearPrints(); }
    }
    this.guide.visible = true;
    this.subjects[this.subject].rig.apply(motion, this.time, true, this.points, this.confidence);
    this.guide.updateMatrixWorld(true);
    this.updateMarks(motion, delta);
    this.updateCamera(motion, delta);
    this.uiElapsed += delta;
    if (this.uiElapsed > 1 / 20) {
      this.uiElapsed = 0;
      const f = Math.min(motion.frameCount - 2, Math.floor(this.time * motion.fps));
      let speed = 0;
      for (let w = 1; w <= 2; w++) {
        const o = f * 9 + w * 3;
        speed = Math.max(speed, Math.hypot(motion.joints[o + 9] - motion.joints[o], motion.joints[o + 10] - motion.joints[o + 1], motion.joints[o + 11] - motion.joints[o + 2]) * motion.fps);
      }
      this.handSpeed = this.playing ? this.handSpeed + (speed - this.handSpeed) * .35 : speed;
      this.hud.tick((this.time - move.watchStart) / (move.watchEnd - move.watchStart), this.time - move.watchStart,
        motion.root[f * 3 + 1], this.handSpeed, this.wasContact[0], this.wasContact[1], this.playing, SPEEDS[this.speedIndex]);
    }
  }

  private setMarks(visible: boolean): void {
    this.shadow.plane.visible = visible; this.contact.plane.visible = visible;
    for (const p of this.prints) if (!visible) p.visible = false;
  }

  private updateMarks(motion: Motion, delta: number): void {
    const contacts = motion.contacts ?? [];
    for (let i = 0; i < 2; i++) {
      const foot = this.subjects[this.subject].feet[i];
      foot.getWorldPosition(this.tmp);
      foot.getWorldQuaternion(this.tmpQ); this.euler.setFromQuaternion(this.tmpQ);
      // The readout must agree with what the viewer sees: a foot resting on the floor reads as
      // planted (sole within 1.5 cm of it), whether or not the solver locked that contact.
      let inContact = this.tmp.y - .105 < .015;
      const side = i === 0 ? 'left' : 'right';
      for (const c of contacts) if (c.foot === side && this.time >= c.start && this.time < c.end) { inContact = true; break; }
      if (inContact) { this.lastPlant[i].set(this.tmp.x, this.euler.y, this.tmp.z); }
      // The print is left behind when the foot lifts, so it never sits under a planted shoe.
      if (!inContact && this.wasContact[i] && this.prints.length) {
        const p = this.prints[this.nextPrint];
        this.drawPrint(this.printCanvases[this.nextPrint]);
        ((p.material as MeshBasicMaterial).map as CanvasTexture).needsUpdate = true;
        p.position.set(this.lastPlant[i].x, .002, this.lastPlant[i].z); p.rotation.y = this.lastPlant[i].y;
        p.visible = true; this.printAge[this.nextPrint] = 0;
        this.nextPrint = (this.nextPrint + 1) % FOOTPRINTS;
      }
      this.wasContact[i] = inContact;
    }
    for (let i = 0; i < FOOTPRINTS; i++) {
      const p = this.prints[i];
      if (!p.visible) continue;
      if (this.playing) this.printAge[i] += delta;
      (p.material as MeshBasicMaterial).opacity = Math.max(0, 1 - this.printAge[i] / 4.5);
      if (this.printAge[i] > 4.5) p.visible = false;
    }
    this.subjects[this.subject].hips.getWorldPosition(this.tmp);
    this.shadow.plane.visible = this.contact.plane.visible = true;
    // The wide ambient layer is heavily blurred, so refreshing it every other frame is invisible.
    if ((this.frame++ & 1) === 0 || !this.playing) this.shadow.update(this.world.renderer, this.tmp.x, this.tmp.z);
    this.contact.update(this.world.renderer, this.tmp.x, this.tmp.z);
  }

  /** Share of the screen width taken by the desktop text column (0 on phones). */
  private columnFraction(): number {
    const w = window.innerWidth;
    return w < 760 ? 0 : Math.min(600, .4 * w + 40) / w;
  }
  /** Fraction of the half-width left for the specimen beside the text column. */
  private fieldFraction(aspect: number): number { return aspect < .9 ? 1 : (1 - this.columnFraction()) * .72; }

  private updateCamera(motion: Motion, delta: number): void {
    const camera = this.world.camera as PerspectiveCamera;
    const aspect = camera.aspect || 1, portrait = aspect < .9;
    // Fit the dancer into the band the HUD leaves free.
    const fov = portrait ? 30 : 26;
    // The XR config uses a 1 mm near plane for hands; the flat viewer needs depth precision.
    if (camera.fov !== fov || camera.near !== .1) { camera.fov = fov; camera.near = .1; camera.updateProjectionMatrix(); }
    // Fit floor..clip top into the band the HUD actually leaves free (measured, so it holds on
    // every screen size), centred in it, and wide enough for the clip's widest reach.
    if (this.bandDirty) { if (portrait) this.band = this.hud.freeBand(); else { this.hud.freeBand(); this.band = [.27, .8]; } this.bandDirty = false; }
    const [a, b] = this.band, top = this.tops[this.selected] ?? 2;
    const halfWidth = this.extents[this.selected] ?? 1;
    const height = Math.max(top / Math.max(.2, b - a), 2 * halfWidth / (aspect * (portrait ? .94 : this.fieldFraction(aspect))));
    const distance = height / 2 / Math.tan(fov * Math.PI / 360);
    const targetY = top / 2 - (.5 - (a + b) / 2) * height;
    // After a few idle seconds the specimen eases back to the front view.
    if (this.idle > 4) {
      this.azimuth = Math.atan2(Math.sin(this.azimuth), Math.cos(this.azimuth));
      this.azimuth -= this.azimuth * Math.min(1, delta * .8);
    } else if (this.idle > .05) this.azimuth += this.azimuthVelocity * delta;   // release inertia
    this.azimuthVelocity *= Math.pow(.02, delta);
    if (Math.abs(this.azimuthVelocity) < .01) this.azimuthVelocity = 0;
    this.idle += delta;
    const f = Math.min(motion.frameCount - 1, Math.floor(this.time * motion.fps));
    this.follow += (motion.root[f * 3] * .55 - this.follow) * Math.min(1, delta * 2.5);
    this.target.set(STAGE.x + this.follow, targetY, STAGE.z);
    // Move the whole player rig, not just the camera: its controller/pointer visuals live
    // at the rig origin and would otherwise sit in front of a camera pulled back from it.
    this.world.player.position.set(
      this.target.x + Math.sin(this.azimuth) * distance * Math.cos(this.elevation),
      this.target.y + Math.sin(this.elevation) * distance,
      this.target.z + Math.cos(this.azimuth) * distance * Math.cos(this.elevation));
    this.world.player.updateMatrixWorld(true);
    camera.position.set(0, 0, 0);
    camera.lookAt(this.target);
    // Landscape: compose a two-column plate, text on the left, specimen right of centre.
    const column = portrait ? 0 : this.columnFraction();
    const shift = column * Math.tan(fov * Math.PI / 360) * distance * aspect;
    if (shift) { this.tmp.set(-shift, 0, 0).applyQuaternion(camera.quaternion); this.tmp.add(this.target); camera.lookAt(this.tmp); }
  }
}
