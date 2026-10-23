import {
  CanvasTexture, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from '@iwsdk/core';
import { ITEMS, type ItemId, type Kind, type LandCue } from './items.js';

export type { Kind };
const GRAVITY = -9.8;

type Prop = {
  item: ItemId; kind: Kind; object: Object3D; blob: Mesh; landed: boolean; pinnedAt: number;
  phase: 'idle' | 'flight' | 'free' | 'pinned';
  p: Vector3; v: Vector3; spin: Vector3; age: number; flight: number; fade: number;
  p0: Vector3; v0: Vector3; p1: Vector3; v1: Vector3; split: number;
  onArrive: ((prop: Prop) => void) | null;
};

/**
 * Things thrown at the specimen: ballistic flights timed to land on a clip's key frame,
 * then whatever each thing does next (bounce, get kicked, burst, get pinned on).
 * Everything is pooled; nothing allocates per frame.
 */
export class Trial {
  readonly group = new Group();
  /** Called the first time a free prop strikes the floor hard. */
  onLand: ((cue: LandCue) => void) | null = null;
  private readonly props: Prop[] = [];
  private readonly drops: InstancedMesh;
  private readonly dropP: Float32Array;
  private readonly dropV: Float32Array;
  private readonly dropLife: Float32Array;
  private readonly dropSize: Float32Array;
  private readonly color = new Color();
  private shakeColor = 0x6fb8f2;
  private nextDrop = 0;
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly t1 = new Vector3();
  private readonly t2 = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly emitters: Object3D[] = [];
  private readonly lastEmit: Vector3[] = [0, 1, 2, 3].map(() => new Vector3());
  private shakeLeft = 0;
  private emitDebt = 0;

  constructor() {
    this.group.name = 'TrialProps';
    // Soft round floor shadow shared by every prop.
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(20,20,19,.55)'); grad.addColorStop(.5, 'rgba(20,20,19,.2)'); grad.addColorStop(1, 'rgba(20,20,19,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const blobMap = new CanvasTexture(c);
    const blobGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (const it of Object.values(ITEMS)) for (let i = 0; i < it.pool; i++) {
      const object = it.proto.clone(true); object.visible = false; object.userData.scale = object.scale.x;
      const blob = new Mesh(blobGeometry, new MeshBasicMaterial({ map: blobMap, transparent: true, depthWrite: false, opacity: 0, fog: false }));
      blob.renderOrder = 3; blob.visible = false;
      this.group.add(object, blob);
      this.props.push({ item: it.id, kind: it.kind, object, blob, landed: false, pinnedAt: 0, phase: 'idle', p: new Vector3(), v: new Vector3(), spin: new Vector3(), age: 0, flight: 0, fade: 0, p0: new Vector3(), v0: new Vector3(), p1: new Vector3(), v1: new Vector3(), split: 0, onArrive: null });
    }
    // Droplets (water, coffee, milk tea and its pearls): one instanced mesh, recycled ring buffer.
    const N = 240;
    this.drops = new InstancedMesh(new SphereGeometry(.016, 8, 6), new MeshStandardMaterial({ color: 0xffffff, roughness: .15, transparent: true, opacity: .9 }), N);
    this.drops.name = 'Droplets'; this.drops.frustumCulled = false;
    this.dropP = new Float32Array(N * 3); this.dropV = new Float32Array(N * 3); this.dropLife = new Float32Array(N); this.dropSize = new Float32Array(N);
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) { this.drops.setMatrixAt(i, this.m4); this.drops.setColorAt(i, this.color.set(0x6fb8f2)); }
    this.group.add(this.drops);
  }

  /** Is one of these free to throw? */
  available(item: ItemId): boolean { return this.props.some(p => p.item === item && p.phase === 'idle'); }

  /**
   * Throws `kind` from `from` so it reaches `to` exactly `duration` seconds from now, then
   * calls onArrive (the moment the clip's key frame plays).
   */
  launch(item: ItemId, from: Vector3, to: Vector3, duration: number, onArrive: (prop: Prop) => void, via?: Vector3, viaTime = 0): void {
    const prop = this.props.find(p => p.item === item && p.phase === 'idle');
    if (!prop) return;
    prop.phase = 'flight'; prop.age = 0; prop.flight = duration; prop.fade = 0; prop.onArrive = onArrive; prop.landed = false;
    prop.p0.copy(from); prop.p.copy(from);
    // Optionally two arcs joined at `via` (off screen): up and over, then a near-vertical drop.
    prop.split = via ? viaTime : duration;
    const end = via ?? to;
    this.ballistic(from, end, prop.split, prop.v0);
    if (via) { prop.p1.copy(via); this.ballistic(via, to, duration - viaTime, prop.v1); }
    prop.v.copy(prop.v0);
    const spin = ITEMS[item].spin;
    if (spin) prop.spin.set(...spin); else prop.spin.set((Math.random() - .5) * 14, (Math.random() - .5) * 10, (Math.random() - .5) * 14);
    prop.object.position.copy(from); prop.object.quaternion.identity(); prop.object.scale.setScalar(prop.object.userData.scale);
    prop.object.visible = true;
    if (prop.object.parent !== this.group) this.group.attach(prop.object);
  }

  /** Launch velocity that carries a body from `a` to `b` in `t` seconds under gravity. */
  private ballistic(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
    out.subVectors(b, a).divideScalar(t); out.y -= .5 * GRAVITY * t;
    return out;
  }

  /** Lets a prop that has arrived carry on under gravity with a new velocity. */
  release(prop: Prop, velocity?: Vector3, spin?: Vector3): void {
    if (prop.object.parent !== this.group) this.group.attach(prop.object);
    prop.object.getWorldPosition(prop.p);
    prop.phase = 'free'; prop.age = 0;
    if (velocity) prop.v.copy(velocity);
    if (spin) prop.spin.copy(spin);
  }

  /** Pins a prop to a bone, keeping its world placement (the flower on the chest). */
  pin(prop: Prop, bone: Object3D): void { bone.attach(prop.object); prop.phase = 'pinned'; prop.pinnedAt = ++this.pins; prop.blob.visible = false; }
  private pins = 0;

  /** The oldest thing pinned to this bone falls off (his chest has room for six). */
  dropOldest(bone: Object3D): void {
    let oldest: Prop | null = null;
    for (const p of this.props) if (p.phase === 'pinned' && p.object.parent === bone && (!oldest || p.pinnedAt < oldest.pinnedAt)) oldest = p;
    if (oldest) this.release(oldest, this.t1.set((Math.random() - .5) * .8, .8, .5), this.t2.set(5, 0, 4));
  }

  /** Splashes a prop's contents away from the body, toward `away`. A balloon bursts; a cup
   *  survives and drops to the floor; milk tea throws its pearls too. */
  burst(prop: Prop, away: Vector3): void {
    const splash = ITEMS[prop.item].splash ?? { color: 0x6fb8f2 };
    this.shakeColor = splash.color;
    const at = this.s.copy(prop.p);
    if (splash.shell) this.release(prop, this.t2.copy(away).multiplyScalar(.6).setY(.8), this.t1.set(7, 0, 5));
    else { prop.object.visible = false; prop.blob.visible = false; prop.phase = 'idle'; }
    const extra = splash.extra;
    for (let i = 0; i < 70 + (extra?.count ?? 0); i++) {
      const bit = extra && i >= 70;
      this.t1.set(Math.random() - .5, Math.random() * .9 + .1, Math.random() - .5).normalize().multiplyScalar(1.2 + Math.random() * 2.2);
      this.t1.addScaledVector(away, .8 + Math.random() * 1.4);
      this.spawnDrop(at, this.t1, bit ? extra.color : splash.color, bit ? extra.size : 1);
    }
  }

  /** Flowers fall off when the specimen shakes himself dry. */
  dropPinned(): void {
    for (const p of this.props) if (p.phase === 'pinned') {
      this.release(p, this.t1.set((Math.random() - .5) * 1.2, 1 + Math.random(), .6 + Math.random() * .6), this.t2.set(Math.random() * 6, 0, Math.random() * 6));
    }
  }

  /** Removes everything pinned to the specimen (subject change). */
  clearPinned(): void { for (const p of this.props) if (p.phase === 'pinned') this.retire(p); }
  /** How many props are pinned to this bone. */
  pinnedOn(bone: Object3D): number { let n = 0; for (const p of this.props) if (p.phase === 'pinned' && p.object.parent === bone) n++; return n; }

  /** Sheds droplets from these bones for `seconds` (the bear shaking itself dry). */
  shake(emitters: Object3D[], seconds: number): void {
    this.emitters.length = 0; this.emitters.push(...emitters);
    this.emitters.forEach((e, i) => e.getWorldPosition(this.lastEmit[i]));
    this.shakeLeft = seconds;
  }

  /** Real elapsed time (flights must land on the clip's key frame even at low frame rates),
   *  integrated in small steps so bounces stay stable. */
  update(dt: number): void {
    const steps = Math.min(8, Math.max(1, Math.ceil(dt * 60))), h = Math.min(dt, .25) / steps;
    for (let i = 0; i < steps; i++) {
      for (const prop of this.props) this.step(prop, h);
      this.stepDrops(h);
    }
  }

  private step(prop: Prop, dt: number): void {
    if (prop.phase === 'idle' || prop.phase === 'pinned') return;
    prop.age += dt;
    if (prop.phase === 'flight') {
      const t = Math.min(prop.age, prop.flight), late = t > prop.split;
      const t0 = late ? t - prop.split : t, a = late ? prop.p1 : prop.p0, v = late ? prop.v1 : prop.v0;
      prop.p.copy(a).addScaledVector(v, t0); prop.p.y += .5 * GRAVITY * t0 * t0;
      prop.v.copy(v); prop.v.y += GRAVITY * t0;
      this.orient(prop, dt);
      prop.object.position.copy(prop.p);
      if (prop.age >= prop.flight) { const done = prop.onArrive; prop.onArrive = null; prop.phase = 'free'; prop.age = 0; done?.(prop); }
    } else {
      prop.v.y += GRAVITY * dt;
      prop.p.addScaledVector(prop.v, dt);
      const rest = ITEMS[prop.item].rest;
      if (prop.p.y < rest) {
        prop.p.y = rest;
        if (prop.v.y < -.6) {
          if (!prop.landed) { prop.landed = true; this.onLand?.(ITEMS[prop.item].land); }
          prop.v.y *= -ITEMS[prop.item].bounce; prop.v.x *= .7; prop.v.z *= .7; prop.spin.multiplyScalar(.6);
        }
        else { prop.v.y = 0; prop.v.x *= Math.pow(.05, dt); prop.v.z *= Math.pow(.05, dt); prop.spin.multiplyScalar(Math.pow(.02, dt)); }
      }
      this.orient(prop, dt);
      prop.object.position.copy(prop.p);
      if (prop.age > 2.6) {
        prop.fade += dt / .35;
        prop.object.scale.setScalar(Math.max(.001, 1 - prop.fade) * prop.object.userData.scale);
        if (prop.fade >= 1) this.retire(prop);
      }
    }
    // Floor shadow: tighter and darker as the prop comes down.
    const h = Math.max(0, prop.p.y);
    prop.blob.visible = prop.object.visible;
    prop.blob.position.set(prop.p.x, .003, prop.p.z);
    prop.blob.scale.setScalar(.18 + h * .12);
    (prop.blob.material as MeshBasicMaterial).opacity = Math.max(0, .55 - h * .22) * (1 - Math.min(1, prop.fade));
  }

  private orient(prop: Prop, dt: number): void {
    const trail = ITEMS[prop.item].trail;
    if (trail && prop.v.lengthSq() > .5) {
      // A shuttlecock flies base first: its feathers (+Y) trail the velocity.
      this.t1.copy(prop.v).normalize().negate();
      this.q.setFromUnitVectors(this.up, this.t1);
      prop.object.quaternion.slerp(this.q, Math.min(1, dt * 10));
      return;
    }
    if (trail && prop.p.y <= ITEMS[prop.item].rest + .001) {
      this.q.identity(); prop.object.quaternion.slerp(this.q, Math.min(1, dt * 8)); return;
    }
    const w = prop.spin.length();
    if (w > 1e-3) { this.q.setFromAxisAngle(this.t1.copy(prop.spin).divideScalar(w), w * dt); prop.object.quaternion.premultiply(this.q); }
  }

  private retire(prop: Prop): void {
    if (prop.object.parent !== this.group) this.group.attach(prop.object);
    prop.object.visible = false; prop.blob.visible = false; prop.phase = 'idle'; prop.onArrive = null;
  }

  private spawnDrop(at: Vector3, velocity: Vector3, color = this.shakeColor, size = 1): void {
    const i = this.nextDrop; this.nextDrop = (this.nextDrop + 1) % this.dropLife.length;
    this.drops.setColorAt(i, this.color.set(color)); this.dropSize[i] = size;
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;
    this.dropP[i * 3] = at.x; this.dropP[i * 3 + 1] = at.y; this.dropP[i * 3 + 2] = at.z;
    this.dropV[i * 3] = velocity.x; this.dropV[i * 3 + 1] = velocity.y; this.dropV[i * 3 + 2] = velocity.z;
    this.dropLife[i] = 2.2;
  }

  private stepDrops(dt: number): void {
    if (this.shakeLeft > 0 && this.emitters.length) {
      this.shakeLeft -= dt;
      this.emitDebt += dt * 70;
      this.emitters.forEach((e, k) => {
        e.getWorldPosition(this.t1);
        this.t2.subVectors(this.t1, this.lastEmit[k]).divideScalar(Math.max(dt, 1e-3));
        this.lastEmit[k].copy(this.t1);
        // Faster-moving parts fling more water.
        const share = Math.floor(this.emitDebt / this.emitters.length * Math.min(2, this.t2.length() / 1.5));
        for (let n = 0; n < share; n++) {
          this.s.copy(this.t2).multiplyScalar(.9).add(this.t1.set((Math.random() - .5) * 1.4, Math.random() * 1.2, (Math.random() - .5) * 1.4));
          e.getWorldPosition(this.t1);
          this.spawnDrop(this.t1, this.s);
        }
      });
      this.emitDebt %= this.emitters.length;
    }
    let any = false;
    for (let i = 0; i < this.dropLife.length; i++) {
      if (this.dropLife[i] <= 0) continue;
      any = true;
      this.dropLife[i] -= dt;
      const o = i * 3;
      if (this.dropP[o + 1] > .004) {
        this.dropV[o + 1] += GRAVITY * dt;
        this.dropP[o] += this.dropV[o] * dt; this.dropP[o + 1] += this.dropV[o + 1] * dt; this.dropP[o + 2] += this.dropV[o + 2] * dt;
        if (this.dropP[o + 1] <= .004) { this.dropP[o + 1] = .004; this.dropLife[i] = Math.min(this.dropLife[i], 1.1); }
      }
      const onFloor = this.dropP[o + 1] <= .004;
      const life = Math.max(0, this.dropLife[i]);
      const k = Math.min(1, life / .5) * this.dropSize[i];
      // On the floor a drop spreads into a flat spot and fades.
      this.s.set(onFloor ? 2.2 * k : k, onFloor ? .15 * k : k, onFloor ? 2.2 * k : k);
      this.m4.compose(this.t1.set(this.dropP[o], this.dropP[o + 1], this.dropP[o + 2]), this.q.identity(), this.s);
      this.drops.setMatrixAt(i, this.m4);
    }
    if (any) this.drops.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.drops.geometry.dispose(); (this.drops.material as MeshStandardMaterial).dispose();
    for (const p of this.props) { (p.blob.material as MeshBasicMaterial).map?.dispose(); (p.blob.material as MeshBasicMaterial).dispose(); }
    this.props[0]?.blob.geometry.dispose();
  }
}

export type { Prop };
