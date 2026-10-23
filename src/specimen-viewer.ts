import {
  CanvasTexture, Color, DirectionalLight, Vector2, SRGBColorSpace, Fog, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera,
  Quaternion, Vector3, Euler, createSystem,
} from '@iwsdk/core';
import { ContactShadow } from './contact-shadow.js';
import { Hud } from './hud.js';
import { InstructorRig } from './instructor-rig.js';
import { measure, type SpecimenStats } from './motion-stats.js';
import { MOVES, validateMotion, type Motion } from './motion.js';
import { SPECIMENS } from './specimens.js';
import { Sfx } from './sfx.js';
import { Trial, type Kind, type Prop } from './trial.js';
import { ITEMS, SLOTS } from './items.js';
import { composePlate, PLATE_W, SHOT_H } from './plate.js';
import { T } from './i18n.js';

const PAPER = 0xf7f7f5;   // far floor, horizon and page; the light pool under the subject is brighter
const STAGE = new Vector3(.7, 0, -2.8);
const AVATARS = ['instructor', 'robot', 'croc'] as const;
const KINDS: Kind[] = ['can', 'shuttle', 'balloon', 'flower'];   // tray slot order = trial log order
const BLEND = .28;          // seconds to fade from one recording into another
const TRIAL_HALF_WIDTH = .82;

// The recordings are fixed, so every throw is choreographed to one: the thing arrives on the
// clip's key frame. Times are seconds into each motion file (see scripts/motion-clips.json).
const IDLE = { clip: 0, start: .05, end: .6, speed: .3 };                     // flash step, standing
const DODGES = [{ key: 2.75, end: 3.65 }, { key: 4.35, end: 5.05 }, { key: 6.0, end: 6.8 }];   // the ducks of the flash step
const REACT = {
  can: { clip: 0, key: 0, end: 0, flight: .55 },
  // From 1.57 s, so his right leg's kick-up (1.9 s) plays in full before it swings forward to meet it.
  shuttle: { clip: 1, key: 2.87, end: 3.85, flight: 1.3 },
  balloon: { clip: 2, key: 1.1, end: 4.1, flight: .6 },      // hit just before the bear shakes
  flower: { clip: 3, key: 1.0, end: 4.4, flight: .6 },       // pinned just before the smug head-shake
};
const GLOAT = { clip: 3, start: 1.1, end: 4.4 };
const CHEST_FRONT = [.12, .145, .175];   // chest-bone origin to shirt front, per subject
// Flower spots on the chest (x toward his left, y down from the shoulder line): the lapel first,
// where his smug hands never cover it.
const PINS = [[.075, -.045], [-.07, -.06], [.02, -.15], [.1, -.17], [-.09, -.18], [-.01, -.03]];

// Flash-step windows that carry him sideways: used to step back to his mark after a dodge.
const SIDESTEPS = [{ start: .6, end: 1.8 }, { start: 2.2, end: 3.65 }, { start: 3.8, end: 5.05 }, { start: 5.45, end: 6.8 }];

type Role = 'idle' | 'dodge' | 'return' | 'react' | 'gloat' | 'plate';
/** A window of a recording being played. Root travel is relative to where he stood at the start
 *  (off) plus a correction (corr) spread along the clip's own travel (a0..a1), so he ends where
 *  the role needs him without his feet sliding while planted. */
type Play = { clip: number; start: number; end: number; t: number; speed: number; dir: number; loop: 'none' | 'pingpong' | 'wrap';
  offX: number; offZ: number; corrX: number; corrZ: number; a0: number; a1: number; role: Role };

/**
 * Phone-first field trial (everything outside a headset session): the specimen stands in a
 * white studio; the viewer throws things at it and it responds with the recorded moves.
 * Also frames the specimen for the screen, orbits on drag and drives the HUD.
 */
export class SpecimenViewer extends createSystem({}) {
  private guide!: Object3D;
  private subjects: { id: string; object: Object3D; rig: InstructorRig; hips: Object3D }[] = [];
  private subject = 0;
  private frame = 0;
  private panel!: Object3D;
  private hud!: Hud;
  private sfx!: Sfx;
  private trial!: Trial;
  private motions: Motion[] = [];
  private stats: SpecimenStats[] = [];
  private ready = false;
  private presenting = false;
  private manual = false;             // a plate played as recorded (review captures, old deep links)
  private cur: Play = { clip: 0, start: IDLE.start, end: IDLE.end, t: IDLE.start, speed: IDLE.speed, dir: 1, loop: 'pingpong', offX: 0, offZ: 0, corrX: 0, corrZ: 0, a0: 0, a1: 0, role: 'idle' };
  private travel: Float32Array[] = [];   // cumulative floor distance the hips cover, per clip frame
  private blendLeft = 0;
  private anchorX = 0;
  private anchorZ = 0;
  private busy = false;
  private streak = 0;
  private readonly counts = [0, 0, 0, 0];
  private trials = 0;
  private breath = 0;
  private readonly points = Array.from({ length: 33 }, () => new Vector3());
  private readonly confidence = new Float32Array(33);
  private readonly target = new Vector3();
  private readonly tmp = new Vector3();
  private readonly aim = new Vector3();
  private readonly from = new Vector3();
  private readonly toCamera = new Vector3();
  private readonly breathQ = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private azimuth = 0;
  private elevation = .23;
  private follow = 0;
  private shadow!: ContactShadow;
  private contact!: ContactShadow;
  private extents: number[] = [];
  private tops: number[] = [];
  private band = [.3, .74];
  private bandDirty = true;
  private bandOverride: number[] | null = null;   // review captures only
  private seekRequest: { clip: number; t: number } | null = null;
  private timeScale = 1;   // review only: slow motion for inspecting contacts
  private lastOutcome = -1;
  private readonly variant = [0, 0, 0, 0];   // which item each tray slot throws next
  private readonly size = new Vector2();

  init(): void {
    // Three subjects share one rig and motion; only the selected one is shown and posed.
    this.subjects = (['Instructor', 'Robot', 'Croc'] as const).map((node, i) => {
      const object = this.world.requireSceneObject(node);
      return { id: AVATARS[i], object, rig: new InstructorRig(object), hips: object.getObjectByName('Hips')! };
    });
    this.guide = this.subjects[0].object;
    this.panel = this.world.requireSceneObject('LessonControls');
    this.setupStudio();
    this.readUrl();
    this.sfx = new Sfx();
    this.cleanupFuncs.push(() => this.sfx.dispose());
    this.hud = new Hud(SPECIMENS, {
      throw: (i, x, y) => this.throwAt(i, x, y),
      subject: i => this.selectSubject(i),
      sound: on => this.sfx.setEnabled(on),
      plate: () => this.makePlate(),
      enterXR: () => { try { this.world.launchXR(); } catch { /* Unsupported: the button stays harmless. */ } },
    }, this.sfx.enabled);
    this.cleanupFuncs.push(() => this.hud.dispose());
    void navigator.xr?.isSessionSupported('immersive-vr').then(ok => this.hud.setXRAvailable(ok)).catch(() => undefined);
    this.bindInput();
    const resize = () => { this.bandDirty = true; };
    window.addEventListener('resize', resize);
    this.cleanupFuncs.push(() => window.removeEventListener('resize', resize));
    if (new URLSearchParams(location.search).get('review') === '1') this.exposeReview();
    this.selectSubject(this.subject);
    void this.load();
  }

  /** Deterministic capture hooks (scripts/*-shots.mjs, scripts/promo); only with ?review=1. */
  private exposeReview(): void {
    (window as unknown as { __review: object }).__review = {
      // Plays plate `specimen` as recorded, held at time t.
      seek: (specimen: number, t: number, az?: number, el?: number) => {
        this.showPlate(specimen - 1, t);
        if (az !== undefined) { this.azimuth = az * Math.PI / 180; }
        if (el !== undefined) this.elevation = el * Math.PI / 180;
      },
      play: (t: number) => { this.cur.t = t; },
      frame: (t: number, az: number, el?: number) => {
        this.cur.t = t; this.azimuth = az * Math.PI / 180;
        if (el !== undefined) this.elevation = el * Math.PI / 180;
      },
      throw: (i: number) => this.throwAt(i, innerWidth / 2, innerHeight * .88),
      timeScale: (k: number) => { this.timeScale = k; },
      state: () => ({ busy: this.busy, clip: this.cur.clip, t: this.cur.t, counts: [...this.counts], anchor: [this.anchorX, this.anchorZ], manual: this.manual }),
      subject: (i: number) => this.selectSubject(i),
      band: (band: number[] | null) => { this.bandOverride = band; this.bandDirty = true; },
      camera: () => { const c = this.world.camera as PerspectiveCamera; return { band: this.band, aspect: c.aspect, fov: c.fov, target: this.target.toArray(), player: this.world.player.position.toArray(), top: this.tops[this.cur.clip], span: this.halfWidth() }; },
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
    this.trial = new Trial();
    this.trial.onLand = cue => this.sfx.play(cue);
    group.add(this.trial.group);
    this.cleanupFuncs.push(() => this.trial.dispose());
    this.world.requireSceneObject('PracticeStage').getObjectByName('ShadowCatcher')!.visible = false;
    // The floor draws first and writes no depth, so the shadow overlays lying on it can never
    // z-fight with it (they would at a grazing angle, as radial streaks).
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
      this.travel = this.motions.map(m => {
        const out = new Float32Array(m.frameCount);
        for (let f = 1; f < m.frameCount; f++) out[f] = out[f - 1] + Math.hypot(m.root[f * 3] - m.root[f * 3 - 3], m.root[f * 3 + 2] - m.root[f * 3 - 1]);
        return out;
      });
      // Widest reach of the hands relative to the camera's follow point, over the whole clip.
      this.extents = this.motions.map((m, i) => {
        let reach = .55;
        for (let f = Math.floor(MOVES[i].watchStart * m.fps); f < Math.min(m.frameCount, MOVES[i].watchEnd * m.fps); f++) {
          const follow = m.root[f * 3] * .55;
          for (let w = 1; w <= 2; w++) reach = Math.max(reach, Math.abs(m.joints[f * 9 + w * 3] - follow));
        }
        return reach + .08;
      });
      // One specimen box for every plate (like specimens drawn to a common scale): the
      // typical tallest reach; rare overhead extremes may use the band's margin.
      let top = 1.8;
      this.motions.forEach((m, i) => {
        for (let f = Math.floor(MOVES[i].watchStart * m.fps); f < Math.min(m.frameCount, MOVES[i].watchEnd * m.fps); f++) {
          top = Math.max(top, m.joints[f * 9 + 1] + .2, m.joints[f * 9 + 4] + .1, m.joints[f * 9 + 7] + .1);
        }
      });
      this.tops = this.motions.map(() => Math.min(2.08, top));
      this.ready = true;
      this.hud.showNotes(0, this.stats[0]);
      if (this.seekRequest) this.showPlate(this.seekRequest.clip, this.seekRequest.t);
      else { this.hud.showBehaviour(null); this.startIdle(false); }
      this.hud.setLog(this.counts, this.trials);
    } catch (error) {
      console.warn('Specimen motion unavailable', error);
    }
  }

  /** Root position of a clip at time t (x, z on the floor). */
  private rootAt(clip: number, t: number, axis: 0 | 2): number {
    const m = this.motions[clip], f = Math.max(0, Math.min(m.frameCount - 1, t * m.fps));
    const a = Math.floor(f), b = Math.min(a + 1, m.frameCount - 1);
    return m.root[a * 3 + axis] + (m.root[b * 3 + axis] - m.root[a * 3 + axis]) * (f - a);
  }

  /** Cuts to a window of a recording, fading in from the current pose, played where he stands. */
  private travelAt(clip: number, t: number): number {
    const a = this.travel[clip], f = Math.max(0, Math.min(a.length - 1, t * this.motions[clip].fps));
    const i = Math.floor(f), j = Math.min(i + 1, a.length - 1);
    return a[i] + (a[j] - a[i]) * (f - i);
  }

  /**
   * Cuts to a window of a recording, fading in from the current pose, played where he stands.
   * With `home`, the clip's net drift is corrected so he finishes on his mark (0, 0).
   */
  private startClip(clip: number, start: number, end: number, loop: Play['loop'], speed: number, role: Role, fade = true, home = false): void {
    if (fade) { this.subjects[this.subject].rig.snapshot(); this.blendLeft = BLEND; } else this.blendLeft = 0;
    const offX = this.manual ? 0 : this.anchorX - this.rootAt(clip, start, 0);
    const offZ = this.manual ? 0 : this.anchorZ - this.rootAt(clip, start, 2);
    const corrX = home ? -(this.anchorX + this.rootAt(clip, end, 0) - this.rootAt(clip, start, 0)) : 0;
    const corrZ = home ? -(this.anchorZ + this.rootAt(clip, end, 2) - this.rootAt(clip, start, 2)) : 0;
    this.cur = { clip, start, end, t: start, speed, dir: 1, loop, offX, offZ, corrX, corrZ, a0: this.travelAt(clip, start), a1: this.travelAt(clip, end), role };
  }

  /** Share of the correction applied by time t: it moves only while the recording itself is
   *  travelling, so planted feet stay put. */
  private shiftAt(t: number): number {
    const p = this.cur;
    if (!p.corrX && !p.corrZ) return 0;
    return p.a1 - p.a0 > .02 ? Math.max(0, Math.min(1, (this.travelAt(p.clip, t) - p.a0) / (p.a1 - p.a0))) : (t - p.start) / (p.end - p.start);
  }

  private startIdle(fade = true): void {
    this.startClip(IDLE.clip, IDLE.start, IDLE.end, 'pingpong', IDLE.speed, 'idle', fade);
    this.busy = false;
    this.hud?.setBusy(false);
  }

  /** A plate played as recorded, held at time t (review captures and old deep links). */
  private showPlate(index: number, t: number): void {
    if (!this.ready) { this.seekRequest = { clip: index, t }; return; }
    this.manual = true;
    const clip = (index + MOVES.length) % MOVES.length, move = MOVES[clip];
    this.anchorX = this.anchorZ = 0;
    this.startClip(clip, move.watchStart, move.watchEnd, 'wrap', 0, 'plate', false);
    this.cur.t = t;
    this.bandDirty = true;
    this.hud.showBehaviour(clip, this.stats[clip]);
  }

  private selectSubject(index: number): void {
    this.subject = (index + this.subjects.length) % this.subjects.length;
    this.guide.visible = false;
    this.guide = this.subjects[this.subject].object;
    this.guide.visible = true;
    this.blendLeft = 0;   // the held pose belonged to the previous subject's rig
    this.shadow.setSubject(this.guide); this.contact.setSubject(this.guide);
    this.hud.showSubject(this.subject);
    this.writeUrl();
  }

  /** World point on the line of sight through a screen pixel, `distance` metres from the camera. */
  private screenToWorld(x: number, y: number, distance: number, out: Vector3): Vector3 {
    const camera = this.world.camera as PerspectiveCamera;
    camera.getWorldPosition(this.tmp);
    out.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1, .5).unproject(camera).sub(this.tmp).normalize();
    return out.multiplyScalar(distance).add(this.tmp);
  }

  /** Bone world position at clip time t (poses the rig; the next frame re-poses it). */
  private probe(t: number, bone: number, local: Vector3, out: Vector3): Vector3 {
    const s = this.subjects[this.subject];
    s.rig.apply(this.motions[this.cur.clip], t, true, this.points, this.confidence);
    const w = this.shiftAt(t);
    s.rig.shiftRoot(this.cur.offX + this.cur.corrX * w, this.cur.offZ + this.cur.corrZ * w);
    this.guide.updateMatrixWorld(true);
    return s.rig.bone(bone).localToWorld(out.copy(local));
  }

  /** Throws thing `index` from screen point (x, y): the specimen responds on the key frame. */
  private throwAt(index: number, x: number, y: number): void {
    if (!this.ready || this.presenting || this.busy) return;
    const slot = SLOTS[index];
    if (!slot) return;
    const item = slot[this.variant[index] % slot.length], kind = ITEMS[item].kind;
    if (!this.trial.available(item)) return;
    if (this.manual) { this.manual = false; this.anchorX = this.anchorZ = 0; this.bandDirty = true; }
    this.sfx.wake(); this.sfx.play('throw');
    navigator.vibrate?.(8);
    this.busy = true; this.hud.setBusy(true);
    this.trials++;
    const s = this.subjects[this.subject], depth = CHEST_FRONT[this.subject];
    this.screenToWorld(x, y, 1.4, this.from);
    let clip: number, key: number, end: number, flight: number;
    if (kind === 'can') {
      // Aimed at where his chest is now; he is somewhere else when it gets there. Prefer the
      // flash that carries him back toward the middle of the floor.
      flight = REACT.can.flight;
      const toward = DODGES.filter(d => {
        const shift = this.rootAt(0, d.end, 0) - this.rootAt(0, d.key - flight, 0);
        return Math.abs(this.anchorX) < .12 || Math.sign(shift) === -Math.sign(this.anchorX);
      });
      const pick = toward[Math.floor(Math.random() * toward.length)] ?? DODGES[0];
      clip = 0; key = pick.key; end = pick.end;
      // At his head as he stands now, nudged against the way he will lean: it visibly
      // passes just beside his ear at the bottom of the duck.
      const lean = Math.sign(this.rootAt(0, pick.end, 0) - this.rootAt(0, pick.key - flight, 0));
      s.rig.bone(4).localToWorld(this.aim.set(0, .02, .02)).x -= lean * .1;
    } else {
      ({ clip, key, end, flight } = REACT[kind]);
    }
    // A dodge keeps its sideways leap (the gag); everything else finishes on his mark.
    this.startClip(clip, key - flight, end, 'none', 1, kind === 'can' ? 'dodge' : 'react', true, kind !== 'can');
    if (kind === 'shuttle') this.probe(key, 16, this.tmp.set(0, -.04, .07), this.aim);   // on the right instep
    else if (kind === 'balloon') this.probe(key, 2, this.tmp.set(0, -.12, depth), this.aim);
    else if (kind === 'flower') {
      const [px, py] = PINS[this.trial.pinnedOn(s.rig.bone(2)) % PINS.length];
      this.probe(key, 2, this.tmp.set(px, py, depth + .01), this.aim);
    }
    this.trial.launch(item, this.from, this.aim, flight, prop => this.arrive(kind, prop));
    // The card flips to the next thing in its family.
    this.variant[index] = (this.variant[index] + 1) % slot.length;
    this.hud.flipCard(index, this.variant[index]);
    this.hud.setActive(index);
    this.hud.showBehaviour(clip, this.stats[clip]);
  }

  private arrive(kind: Kind, prop: Prop): void {
    const s = this.subjects[this.subject];
    (this.world.camera as PerspectiveCamera).getWorldPosition(this.toCamera);
    this.toCamera.sub(prop.p).setY(0).normalize();
    switch (kind) {
      case 'can':
        this.sfx.play('swoosh'); this.counts[0]++; this.streak++;
        break;
      case 'shuttle':
        // Kicked forward and up, straight back at whoever threw it.
        this.sfx.play('kick'); this.counts[1]++; this.streak++;
        this.trial.release(prop, this.tmp.copy(this.toCamera).multiplyScalar(1.1).setY(5.4).add(this.aim.set((Math.random() - .5) * .4, 0, 0)));
        navigator.vibrate?.(12);
        break;
      case 'balloon':
        this.sfx.play('splash'); this.counts[2]++; this.streak = 0;
        this.trial.burst(prop, this.toCamera);
        this.trial.dropPinned();
        this.trial.shake([s.rig.bone(4), s.rig.bone(7), s.rig.bone(10), s.rig.bone(2)], 2.6);
        navigator.vibrate?.([10, 30, 10]);
        break;
      case 'flower':
        this.sfx.play('chime'); this.counts[3]++;
        this.trial.pin(prop, s.rig.bone(2));
        break;
    }
    this.lastOutcome = KINDS.indexOf(kind);
    this.hud.setLog(this.counts, this.trials, this.lastOutcome);
  }

  /**
   * Renders this instant at plate resolution, framed on the specimen, and sets it as a
   * field-guide plate. The renderer is resized for one frame inside this call, so the
   * screen never shows it.
   */
  private async makePlate(): Promise<void> {
    if (!this.ready || this.presenting) return;
    const r = this.world.renderer, camera = this.world.camera as PerspectiveCamera;
    const ratio = r.getPixelRatio(); r.getSize(this.size);
    const aspect = camera.aspect, fov = camera.fov;
    r.setPixelRatio(1); r.setSize(PLATE_W, SHOT_H, false);
    camera.aspect = PLATE_W / SHOT_H; camera.fov = 30; camera.updateProjectionMatrix();
    this.subjects[this.subject].hips.getWorldPosition(this.tmp);
    const height = 2.35, distance = height / 2 / Math.tan(15 * Math.PI / 180);
    this.aim.set(this.tmp.x, 1.12, this.tmp.z);
    this.world.player.position.set(
      this.aim.x + Math.sin(this.azimuth) * distance * Math.cos(this.elevation),
      this.aim.y + Math.sin(this.elevation) * distance,
      this.aim.z + Math.cos(this.azimuth) * distance * Math.cos(this.elevation));
    this.world.player.updateMatrixWorld(true);
    camera.position.set(0, 0, 0); camera.lookAt(this.aim);
    r.render(this.world.scene, camera);
    const shot = document.createElement('canvas'); shot.width = PLATE_W; shot.height = SHOT_H;
    shot.getContext('2d')!.drawImage(r.domElement, 0, 0, PLATE_W, SHOT_H);
    r.setPixelRatio(ratio); r.setSize(this.size.x, this.size.y, false);
    camera.aspect = aspect; camera.fov = fov; camera.updateProjectionMatrix();
    this.sfx.play('chime');
    const text = this.hud.plateText();
    const k = this.lastOutcome;
    const card = await composePlate(shot, {
      ...text, trial: `${T.trial} ${String(this.trials).padStart(3, '0')}`, site: T.site,
      result: k >= 0 ? `${T.log[k]} · ${String(this.counts[k]).padStart(2, '0')}` : '',
    });
    this.hud.showPlate(card);
  }

  /**
   * A reaction finished. After a dodge he flash-steps back to his mark; three clean dodges or
   * returns in a row then earn a gloat; then he rests.
   */
  private clipEnded(): void {
    const p = this.cur;
    this.anchorX = p.offX + p.corrX + this.rootAt(p.clip, p.end, 0);
    this.anchorZ = p.offZ + p.corrZ + this.rootAt(p.clip, p.end, 2);
    if (p.role === 'dodge' && Math.hypot(this.anchorX, this.anchorZ) > .06) {
      // The sidestep that carries him most nearly back; its residue is corrected on the way.
      const back = SIDESTEPS.map(w => ({ ...w, d: this.rootAt(0, w.end, 0) - this.rootAt(0, w.start, 0) }))
        .sort((a, b) => Math.abs(this.anchorX + a.d) - Math.abs(this.anchorX + b.d))[0];
      this.startClip(0, back.start, back.end, 'none', 1, 'return', true, true);
      return;
    }
    if (this.streak >= 3 && p.role !== 'gloat') {
      this.streak = 0;
      this.startClip(GLOAT.clip, GLOAT.start, GLOAT.end, 'none', 1, 'gloat', true, true);
      this.hud.showBehaviour(GLOAT.clip, this.stats[GLOAT.clip]);
      this.sfx.play('chime');
      return;
    }
    this.startIdle();
  }

  private bindInput(): void {
    const canvas = this.world.renderer.domElement;
    // The camera is fixed; a horizontal swipe on the stage changes subject.
    let dragging = -1, startX = 0, startY = 0;
    const down = (e: PointerEvent) => {
      if (this.presenting) return;
      dragging = e.pointerId; startX = e.clientX; startY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== dragging) return;
      dragging = -1;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (e.type === 'pointerup' && Math.abs(dx) > 40 && Math.abs(dx) > 1.2 * Math.abs(dy)) this.selectSubject(this.subject + (dx < 0 ? 1 : -1));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    const key = (e: KeyboardEvent) => {
      if (this.presenting || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (/^Digit[1-4]$/.test(e.code)) this.throwAt(Number(e.code.slice(-1)) - 1, innerWidth / 2, innerHeight * .88);
      else if (e.code === 'Space') this.throwAt(Math.floor(Math.random() * 4), innerWidth / 2, innerHeight * .88);
      else if (e.code === 'ArrowRight') this.selectSubject(this.subject + 1);
      else if (e.code === 'ArrowLeft') this.selectSubject(this.subject - 1);
      else if (e.code === 'KeyN') this.hud.setNotes(!this.hud.open);
      else if (e.code === 'Escape') this.hud.setNotes(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
    });
  }

  private readUrl(): void {
    const q = new URLSearchParams(location.search);
    // Old plate links (?specimen=N&t=...&paused=1) still open that plate as recorded.
    const s = Number(q.get('specimen')), t = Number(q.get('t'));
    if (s >= 1 && s <= MOVES.length && q.has('t') && Number.isFinite(t)) this.seekRequest = { clip: s - 1, t };
    const avatar = AVATARS.indexOf((q.get('avatar') ?? '') as typeof AVATARS[number]);
    if (avatar >= 0) this.subject = avatar;
    const az = Number(q.get('az'));
    if (q.has('az') && Number.isFinite(az)) this.azimuth = az * Math.PI / 180;
  }
  private writeUrl(): void {
    const q = new URLSearchParams(location.search);
    if (this.subject) q.set('avatar', AVATARS[this.subject]); else q.delete('avatar');
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  }

  update(delta: number): void {
    delta *= this.timeScale;
    const presenting = this.world.renderer.xr.isPresenting;
    if (presenting !== this.presenting) {
      this.presenting = presenting;
      this.hud.setVisible(!presenting);
      this.trial.group.visible = !presenting;
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
    this.advance(delta);
    const s = this.subjects[this.subject], motion = this.motions[this.cur.clip];
    this.guide.visible = true;
    s.rig.apply(motion, this.cur.t, true, this.points, this.confidence);
    const w = this.shiftAt(this.cur.t);
    s.rig.shiftRoot(this.cur.offX + this.cur.corrX * w, this.cur.offZ + this.cur.corrZ * w);
    if (this.blendLeft > 0) {
      const k = this.blendLeft / BLEND;
      s.rig.blend(k * k * (3 - 2 * k));
      this.blendLeft -= delta;
    }
    // At rest he breathes: a slow chest rise and a little weight shift, so he never freezes.
    if (!this.manual && this.cur.loop === 'pingpong') {
      this.breath += delta;
      this.breathQ.setFromEuler(this.euler.set(Math.sin(this.breath * 1.6) * .014, Math.sin(this.breath * .55) * .03, Math.sin(this.breath * .8) * .008));
      s.rig.bone(2).quaternion.multiply(this.breathQ);
    }
    this.guide.updateMatrixWorld(true);
    this.trial.update(delta);
    this.updateMarks();
    this.updateCamera(delta);
  }

  private advance(delta: number): void {
    const p = this.cur;
    if (p.speed === 0) return;
    p.t += delta * p.speed * p.dir;
    if (p.loop === 'pingpong') {
      if (p.t > p.end) { p.t = 2 * p.end - p.t; p.dir = -1; }
      if (p.t < p.start) { p.t = 2 * p.start - p.t; p.dir = 1; }
    } else if (p.loop === 'wrap') {
      if (p.t > p.end) p.t = p.start;
    } else if (p.t >= p.end) {
      p.t = p.end;
      this.clipEnded();
    }
  }

  private setMarks(visible: boolean): void {
    this.shadow.plane.visible = visible; this.contact.plane.visible = visible;
  }

  private updateMarks(): void {
    this.subjects[this.subject].hips.getWorldPosition(this.tmp);
    this.shadow.plane.visible = this.contact.plane.visible = true;
    // The wide ambient layer is heavily blurred, so refreshing it every other frame is invisible.
    if ((this.frame++ & 1) === 0 || this.cur.speed === 0) this.shadow.update(this.world.renderer, this.tmp.x, this.tmp.z);
    this.contact.update(this.world.renderer, this.tmp.x, this.tmp.z);
  }

  /** Half-width kept in view: a plate's own reach, or room for any dodge during trials. */
  private halfWidth(): number { return this.manual ? (this.extents[this.cur.clip] ?? 1) : TRIAL_HALF_WIDTH; }

  /** Share of the screen width taken by the desktop text column (0 on phones). */
  private columnFraction(): number {
    const w = window.innerWidth;
    return w < 760 ? 0 : Math.min(600, .4 * w + 40) / w;
  }
  /** Fraction of the half-width left for the specimen beside the text column. */
  private fieldFraction(aspect: number): number { return aspect < .9 ? 1 : (1 - this.columnFraction()) * .72; }

  private updateCamera(delta: number): void {
    const camera = this.world.camera as PerspectiveCamera;
    const aspect = camera.aspect || 1, portrait = aspect < .9;
    // Fit the dancer into the band the HUD leaves free.
    const fov = portrait ? 30 : 26;
    // The XR config uses a 1 mm near plane for hands; the flat viewer needs depth precision.
    if (camera.fov !== fov || camera.near !== .1) { camera.fov = fov; camera.near = .1; camera.updateProjectionMatrix(); }
    // Fit floor..clip top into the band the HUD actually leaves free (measured, so it holds on
    // every screen size), centred in it, and wide enough for the clip's widest reach.
    if (this.bandDirty && this.bandOverride) { this.band = this.bandOverride; this.bandDirty = false; }
    if (this.bandDirty) { if (portrait) this.band = this.hud.freeBand(); else { this.hud.freeBand(); this.band = [.14, .9]; } this.bandDirty = false; }
    const [a, b] = this.band, top = this.tops[this.cur.clip] ?? 2;
    const height = Math.max(top / Math.max(.2, b - a), 2 * this.halfWidth() / (aspect * (portrait ? .94 : this.fieldFraction(aspect))));
    const distance = height / 2 / Math.tan(fov * Math.PI / 360);
    const targetY = top / 2 - (.5 - (a + b) / 2) * height;
    // Follow the specimen's hips loosely, so dodges read as movement against the room.
    this.subjects[this.subject].hips.getWorldPosition(this.tmp);
    this.follow += ((this.tmp.x - STAGE.x) * .55 - this.follow) * Math.min(1, delta * 2.5);
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
