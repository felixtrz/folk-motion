import type { Vector3, WebXRManager } from '@iwsdk/core';

// Confidence is stored in Float32Array; include the representable 0.65 boundary.
const MIN_REFERENCE_CONFIDENCE = Math.fround(0.65);

/** Front-plane wrist guidance only; this does not measure footwork or depth. */
export type HandFeedback = {
  match: number;
  leftError: number;
  rightError: number;
  left: string;
  right: string;
  reason: string;
  available: boolean;
};

/** Samples native poses together, avoiding the SDK's ray and grip scene objects. */
export class HandCoach {
  calibrated = false;
  readonly feedback: HandFeedback = {
    match: -1, leftError: -1, rightError: -1, left: '', right: '', reason: 'Enter the headset to begin hand guidance.', available: false,
  };

  private session: XRSession | null = null;
  private sampleValid = false;
  private sampleReason = 'Enter the headset to begin hand guidance.';
  private calibrationReason = 'Face the guide with both hands visible, then calibrate.';
  private readonly viewer = { x: 0, y: 0, z: 0 };
  private readonly left = { x: 0, y: 0, z: 0 };
  private readonly right = { x: 0, y: 0, z: 0 };
  private viewerYaw = 0;
  private inverseYawCos = 1;
  private inverseYawSin = 0;
  private heightScale = 1;

  update(xr: WebXRManager, visible: boolean): void {
    this.sampleValid = false;
    try {
      const session = xr.getSession();
      if (session !== this.session) {
        this.invalidate();
        this.session = session;
        if (session) this.calibrationReason = 'New headset session. Face the guide with both hands visible, then calibrate.';
      }
      if (!session) {
        this.unavailable('Enter the headset to begin hand guidance.');
        return;
      }
      if (!visible || (session.visibilityState !== undefined && session.visibilityState !== 'visible')) {
        this.invalidate();
        this.calibrationReason = 'Headset view resumed. Face the guide with both hands visible, then calibrate again.';
        this.unavailable('Headset view paused. Return to the lesson and calibrate again.');
        return;
      }
      const frame = xr.getFrame();
      const space = xr.getReferenceSpace();
      if (!frame || !space) {
        this.unavailable('Headset tracking is unavailable. Wait for a fresh frame.');
        return;
      }
      const viewer = frame.getViewerPose(space);
      if (!viewer || !this.copyPosition(this.viewer, viewer.transform.position)) {
        this.unavailable('Headset position is unavailable. Restore tracking before continuing.');
        return;
      }
      const q = viewer.transform.orientation;
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)) {
        this.unavailable('Headset orientation is unavailable. Restore tracking before continuing.');
        return;
      }
      this.viewerYaw = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      let leftValid = false;
      let rightValid = false;
      for (const source of session.inputSources) {
        if (source.handedness !== 'left' && source.handedness !== 'right') continue;
        // A tracked hand must have a native wrist pose. Never fall back to its
        // grip or target ray, which may exist even when that wrist is untracked.
        let pose: XRPose | null | undefined = null;
        if (source.hand) {
          const wrist = source.hand.get('wrist');
          if (wrist && frame.getJointPose) pose = frame.getJointPose(wrist, space);
        } else if (source.gripSpace) {
          pose = frame.getPose(source.gripSpace, space);
        }
        if (!pose) continue;
        if (source.handedness === 'left') leftValid = this.copyPosition(this.left, pose.transform.position) || leftValid;
        else rightValid = this.copyPosition(this.right, pose.transform.position) || rightValid;
      }
      if (!leftValid || !rightValid) {
        this.unavailable(!leftValid && !rightValid
          ? 'Both hands are untracked. Bring both hands or controllers into view.'
          : !leftValid ? 'Left hand is untracked. Bring your left hand or controller into view.'
            : 'Right hand is untracked. Bring your right hand or controller into view.');
        return;
      }
      this.sampleValid = true;
      this.sampleReason = '';
    } catch {
      // WebXR poses are legal only during an active frame. A suspended or stale
      // frame must never leave a previous score looking current.
      this.unavailable('Tracking frame expired. Keep both hands visible and wait for tracking.');
    }
  }

  calibrate(): boolean {
    if (!this.sampleValid) {
      this.calibrated = false;
      this.unavailable(this.sampleReason || 'Keep both hands visible before calibrating.');
      return false;
    }
    this.heightScale = Math.max(0.65, Math.min(1.3, this.viewer.y / 1.7));
    this.inverseYawCos = Math.cos(this.viewerYaw);
    this.inverseYawSin = Math.sin(this.viewerYaw);
    this.calibrated = true;
    this.clearFeedback('Calibrated. Copy the paused pose with both hands visible.');
    return true;
  }

  invalidate(): void {
    this.calibrated = false;
    this.sampleValid = false;
    this.calibrationReason = 'Face the guide with both hands visible, then calibrate.';
    this.sampleReason = this.calibrationReason;
    this.clearFeedback(this.sampleReason);
  }

  evaluate(points: Vector3[], confidence: Float32Array, mirror: boolean, referenceValid: boolean): HandFeedback {
    if (!this.sampleValid) {
      this.clearFeedback(this.sampleReason);
      return this.feedback;
    }
    if (!this.calibrated) {
      this.clearFeedback(this.calibrationReason);
      return this.feedback;
    }
    const leftIndex = mirror ? 16 : 15;
    const rightIndex = mirror ? 15 : 16;
    const head = points[0];
    const left = points[leftIndex];
    const right = points[rightIndex];
    if (!referenceValid) {
      this.clearFeedback('Reference pose is unavailable here. Choose another pose for hand guidance.');
      return this.feedback;
    }
    if (!head || !left || !right) {
      this.clearFeedback('Reference hand landmarks are missing. Choose another pose for hand guidance.');
      return this.feedback;
    }
    if (!(confidence[0] >= MIN_REFERENCE_CONFIDENCE && confidence[leftIndex] >= MIN_REFERENCE_CONFIDENCE && confidence[rightIndex] >= MIN_REFERENCE_CONFIDENCE)) {
      this.clearFeedback('Reference hands are unclear here. Choose another pose for hand guidance.');
      return this.feedback;
    }
    if (!Number.isFinite(head.x) || !Number.isFinite(head.y) ||
        !Number.isFinite(left.x) || !Number.isFinite(left.y) ||
        !Number.isFinite(right.x) || !Number.isFinite(right.y)) {
      this.clearFeedback('Reference pose coordinates are invalid. Choose another pose for hand guidance.');
      return this.feedback;
    }
    const leftX = (this.left.x - this.viewer.x) * this.inverseYawCos - (this.left.z - this.viewer.z) * this.inverseYawSin;
    const rightX = (this.right.x - this.viewer.x) * this.inverseYawCos - (this.right.z - this.viewer.z) * this.inverseYawSin;
    const leftDx = (left.x - head.x) * this.heightScale - leftX;
    const rightDx = (right.x - head.x) * this.heightScale - rightX;
    const leftDy = (left.y - head.y) * this.heightScale - (this.left.y - this.viewer.y);
    const rightDy = (right.y - head.y) * this.heightScale - (this.right.y - this.viewer.y);
    const leftError = Math.hypot(leftDx, leftDy);
    const rightError = Math.hypot(rightDx, rightDy);
    this.feedback.match = Math.max(0, 1 - (leftError + rightError) / 2 / 0.7);
    this.feedback.leftError = leftError;
    this.feedback.rightError = rightError;
    this.feedback.left = this.guidance(leftDx, leftDy, leftError);
    this.feedback.right = this.guidance(rightDx, rightDy, rightError);
    this.feedback.reason = 'Front-plane hand placement only; depth and footwork are not scored.';
    this.feedback.available = true;
    return this.feedback;
  }

  private copyPosition(target: { x: number; y: number; z: number }, source: DOMPointReadOnly): boolean {
    if (!Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(source.z)) return false;
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
    return true;
  }

  private guidance(dx: number, dy: number, error: number): string {
    if (error <= 0.14) return 'In place';
    if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'Raise your hand' : 'Lower your hand';
    return dx > 0 ? 'Move your hand right' : 'Move your hand left';
  }

  private unavailable(reason: string): void {
    this.sampleValid = false;
    this.sampleReason = reason;
    this.clearFeedback(reason);
  }

  private clearFeedback(reason: string): void {
    this.feedback.match = -1;
    this.feedback.leftError = -1;
    this.feedback.rightError = -1;
    this.feedback.left = '';
    this.feedback.right = '';
    this.feedback.reason = reason;
    this.feedback.available = false;
  }
}
