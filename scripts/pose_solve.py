"""Stage 2: turn raw MediaPipe observations into rig-ready 3D motion.

Usage: .venv-pose/bin/python -I scripts/pose_solve.py [--only bear-shake]

Reads .local/pose-raw/{heavy,full}.npz (scripts/pose_raw.py), .local/camera.npz
(scripts/camera_track.py) and the move table in
scripts/motion-clips.json. For each move it writes public/motion/<id>.json with
per-frame root positions and local bone quaternions for the 17-bone instructor
rig, plus the FK positions of the coached joints.

Pipeline per frame/joint:
  1. Ensemble four passes (heavy, heavy-flipped, full, full-flipped) with a robust
     median-then-trimmed-mean; spread between passes becomes the noise estimate.
  2. Hampel outlier rejection over time, gap fill, then a zero-phase Butterworth
     low-pass per shot (never across a camera cut).
  3. Bone directions combine image-plane angles (precise) with model depth (the
     only depth cue available); bone lengths come from the rig, never the video.
  4. Hinge-aware retarget: elbows and knees bend in one plane, the bend-plane
     normal is blended to an anatomical fallback when the limb is nearly straight.
  5. Root height keeps the lowest sole on the floor, plus measured airborne lift.
Close-up shots only observe the upper body. Their legs and root are interpolated
between neighbouring full shots and the frames are flagged as estimated.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares
from scipy.signal import butter, filtfilt
from scipy.spatial.transform import Rotation, Slerp

# Mirrors src/scene-assets/instructor-proportions.ts. tests/motion.test.ts checks
# the exported FK joints against the TypeScript rig, so drift fails the build.
ARM_X = .53
ARM_Y = -np.sqrt(1 - ARM_X ** 2)
RIG = [
    ('Hips', -1, (0, .86, 0)), ('Spine', 0, (0, .24, 0)), ('Chest', 1, (0, .28, 0)), ('Neck', 2, (0, .09, 0)), ('Head', 3, (0, .08, 0)),
    ('LeftUpperArm', 2, (.18, 0, .015)), ('LeftForeArm', 5, (ARM_X * .255, ARM_Y * .255, 0)), ('LeftHand', 6, (ARM_X * .235, ARM_Y * .235, 0)),
    ('RightUpperArm', 2, (-.18, 0, .015)), ('RightForeArm', 8, (-ARM_X * .255, ARM_Y * .255, 0)), ('RightHand', 9, (-ARM_X * .235, ARM_Y * .235, 0)),
    ('LeftUpperLeg', 0, (.1, 0, 0)), ('LeftLowerLeg', 11, (0, -.39, 0)), ('LeftFoot', 12, (0, -.36, 0)),
    ('RightUpperLeg', 0, (-.1, 0, 0)), ('RightLowerLeg', 14, (0, -.39, 0)), ('RightFoot', 15, (0, -.36, 0)),
]
NB = len(RIG)
HIPS, SPINE, CHEST, NECK, HEAD = range(5)
LUA, LFA, LH, RUA, RFA, RH, LUL, LLL, LF, RUL, RLL, RF = range(5, 17)
UPPER = [HIPS, SPINE, CHEST, NECK, HEAD, LUA, LFA, LH, RUA, RFA, RH]
LEGS = [LUL, LLL, LF, RUL, RLL, RF]
SOLE = [np.array([0, -.105, .145]), np.array([0, -.105, -.063])]  # toe and heel of the authored shoe
NOSE = np.array([0, .09, .1])
UP = np.array([0., 1., 0.])
MAX_TWIST = np.radians(25)  # per frame at 30 fps
FACE = list(range(11))  # nose, eyes (inner/centre/outer), ears, mouth corners
FACE_WEIGHT = np.array([2, .4, .6, .4, .4, .6, .4, 1.2, 1.2, .8, .8])
# Generic adult face in the head frame (metres; +X = the dancer's left, +Y up, +Z forward),
# origin at the ear midpoint, in MediaPipe landmark order 0-10.
FACE_MODEL = np.array([
    [0, -.005, .105],
    [.015, .03, .088], [.032, .032, .082], [.047, .03, .072],
    [-.015, .03, .088], [-.032, .032, .082], [-.047, .03, .072],
    [.075, 0, 0], [-.075, 0, 0],
    [.025, -.045, .085], [-.025, -.045, .085],
])
HEAD_LIMITS = np.radians([[-70, 70], [-40, 45], [-35, 35]])  # yaw, pitch (+ = down), roll vs chest
ANKLE_FLAT = .105   # ankle height when the authored shoe sole is flat on the floor
LEG_REACH = .748    # hip-to-ankle limit used before IK (rig leg is 0.75 m)
EDGE = 4            # frames used to blend into and out of a contact
FOOT_CLEARANCE = .17  # minimum distance between two planted ankles (one shoe width)
LEG_CLEARANCE = .115  # minimum shin-to-shin centreline distance (two slim leg radii)
LOCAL_UP = UP

# Low-pass cutoffs (Hz) by landmark. Hands/feet keep more bandwidth for shakes and kicks.
CUTOFF = np.full(33, 5.0)
CUTOFF[[11, 12, 23, 24]] = 4.0
CUTOFF[[13, 14, 25, 26]] = 6.0
CUTOFF[[15, 16, 17, 18, 19, 20, 21, 22]] = 7.5
CUTOFF[[27, 28]] = 6.0
CUTOFF[[29, 30, 31, 32]] = 4.0


def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def basis(primary, secondary):
    """Rotation matrices whose first column is primary and second lies along secondary (orthogonalised)."""
    a = unit(primary)
    b = unit(secondary - a * np.sum(secondary * a, -1, keepdims=True))
    return np.stack([a, b, np.cross(a, b)], -1)


def ensemble(values, tol):
    """values: (K, N, 33, D). Median, then mean of members within tol of it."""
    med = np.nanmedian(values, 0)
    dist = np.linalg.norm(values - med[None], axis=-1)
    keep = (dist <= tol)[..., None]
    with np.errstate(invalid='ignore'):
        mean = np.nansum(np.where(keep, values, 0), 0) / np.maximum(np.sum(keep & ~np.isnan(values), 0), 1)
    spread = np.nanmedian(dist, 0)
    return np.where(np.isnan(med), np.nan, mean), spread


def hampel_fill(x, window=9, k=3.0, floor=0.0):
    """x: (N, D). Replace temporal outliers and NaNs by linear interpolation."""
    x = x.copy()
    n = len(x)
    half = window // 2
    for d in range(x.shape[1]):
        col = x[:, d]
        bad = np.isnan(col)
        for i in range(n):
            w = col[max(0, i - half):i + half + 1]
            w = w[~np.isnan(w)]
            if len(w) < 3 or np.isnan(col[i]):
                continue
            med = np.median(w)
            mad = 1.4826 * np.median(np.abs(w - med))
            if abs(col[i] - med) > max(k * mad, floor):
                bad[i] = True
        good = ~bad
        if good.sum() >= 2:
            col[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(good), col[good])
        x[:, d] = col
    return x


def lowpass(x, fs, cutoff):
    if len(x) < 16:
        return x
    b, a = butter(2, min(cutoff / (fs / 2), .95))
    return filtfilt(b, a, x, axis=0, padlen=min(len(x) - 1, 3 * max(len(a), len(b)) * 4), padtype='odd')


def clean_shot(points, fs, floor):
    """points: (N, 33, D) for one shot -> outlier-free, gap-filled, low-passed copy."""
    out = np.empty_like(points)
    for j in range(33):
        filled = hampel_fill(points[:, j], floor=floor)
        if np.isnan(filled).any():
            out[:, j] = filled
            continue
        out[:, j] = lowpass(filled, fs, CUTOFF[j])
    return out


def hinge_frames(a, f, rest_dir, rest_normal, fallback, twist_limit=np.radians(110)):
    """Global rotations for a two-bone hinge chain (upper, lower) over N frames."""
    n_raw = np.cross(a, f)
    bend = np.linalg.norm(n_raw, axis=-1, keepdims=True) / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True) * np.linalg.norm(f, axis=-1, keepdims=True), 1e-9)
    n_raw = unit(n_raw)
    au = unit(a)
    # Elbows and knees flex one way only, so a x f is the true bend axis, sign included.
    # A straight limb has no measurable axis: keep the previous one (parallel transport,
    # no added twist) and turn toward the measured axis as the bend becomes clear. All
    # turning happens about the bone itself and is rate-limited, never via a degenerate blend.
    w = np.clip((bend[:, 0] - .1) / .2, 0, 1)
    n = np.empty_like(n_raw)
    # Twist is tracked as an angle from the anatomical axis (fallback) about the bone. A
    # straight limb relaxes toward anatomical, and the angle is clamped to joint limits:
    # a single camera cannot tell a forearm twisted 170 degrees backwards from a natural one.
    theta = 0.0
    for t in range(len(a)):
        e1 = fallback[t] - au[t] * np.dot(fallback[t], au[t])
        e1 = unit(e1) if np.linalg.norm(e1) > 1e-6 else unit(np.cross(au[t], [0, 0, 1]))
        e2 = np.cross(au[t], e1)
        measured = np.arctan2(np.dot(n_raw[t], e2), np.dot(n_raw[t], e1))
        delta = (measured - theta + np.pi) % (2 * np.pi) - np.pi
        theta += np.clip(w[t] * delta, -MAX_TWIST, MAX_TWIST)
        theta -= (1 - w[t]) * .12 * theta
        theta = float(np.clip(theta, -twist_limit, twist_limit))
        n[t] = e1 * np.cos(theta) + e2 * np.sin(theta)
    # Smooth the bend plane over time to suppress twist flicker.
    n = unit(lowpass(n, 30, 3.0)) if len(n) >= 16 else n
    rest = basis(rest_dir[None], rest_normal[None])[0]
    upper = basis(a, n) @ rest.T
    # Pure hinge: the lower bone is the measured direction projected into the bend plane,
    # so the joint only ever rotates about n (no twist, no degeneracy when n drifts).
    # The flexion angle is a single scalar per frame: filter it directly so one blurred
    # frame with a flipped forearm depth cannot snap the joint.
    side = np.cross(n, au)
    phi = np.unwrap(np.arctan2(np.sum(f * side, -1), np.sum(f * au, -1)))
    if len(phi) >= 16:
        phi = lowpass(hampel_fill(phi[:, None], window=9, k=2.5, floor=np.radians(12))[:, 0], 30, 6.0)
    phi = np.clip(phi, 0, np.radians(160))
    fp = au * np.cos(phi)[:, None] + side * np.sin(phi)[:, None]
    lower = basis(fp, n) @ rest.T
    return upper, lower


def solve_shot(img, wld, s, framing, pitch=0.0):
    """Global bone rotations (N, 17, 3, 3), face offsets (N, 11, 2) and camera tilt (3, 3).
    Lower body omitted for close-ups.

    pitch (radians) rotates about +X to undo the camera looking down at the stage.
    """
    N = len(img)
    c, si = np.cos(pitch), -np.sin(pitch)  # rotate by -pitch to stand the body upright
    tilt = np.array([[1, 0, 0], [0, c, -si], [0, si, c]])

    def to3(dxy, dz):
        """Image-plane xy offset (pixels) + model depth (metres) -> rig-space metres."""
        return np.stack([dxy[:, 0] * s, -dxy[:, 1] * s, -dz], -1) @ tilt.T

    def vec(i, j):
        """Bone vector i->j. Depth is re-cleaned per bone: a blurred frame often corrupts one
        joint's depth in a way that is only obvious relative to its neighbour."""
        dz = wld[:, j, 2] - wld[:, i, 2]
        if N >= 16:
            dz = lowpass(hampel_fill(dz[:, None], window=11, k=2.5, floor=.04)[:, 0], 30, 5.0)
        return to3(img[:, j] - img[:, i], dz)

    G = np.tile(np.eye(3), (N, NB, 1, 1))
    hip_x = vec(24, 23)               # right hip -> left hip = rig +X
    sho_x = vec(12, 11)
    mid_img = lambda a, b: (img[:, a] + img[:, b]) / 2
    mid_w = lambda a, b: (wld[:, a] + wld[:, b]) / 2
    spine_up = to3(mid_img(11, 12) - mid_img(23, 24), mid_w(11, 12)[:, 2] - mid_w(23, 24)[:, 2])
    hips_up = unit(unit(spine_up) * .45 + UP * .55)
    G[:, HIPS] = xy_basis(hip_x, hips_up)
    G[:, CHEST] = xy_basis(sho_x, spine_up)
    G[:, SPINE] = slerp_mats(G[:, HIPS], G[:, CHEST], .5)
    # Head and neck are solved later from all face landmarks (solve_head); start at the chest.
    G[:, HEAD] = G[:, CHEST]
    G[:, NECK] = G[:, CHEST]
    # Face landmarks as camera-plane offsets from the ear midpoint (metres, +y up). Model
    # depth is deliberately unused: on a ~25 px face it is noise that swamps the 2D signal.
    d2 = (img[:, FACE] - mid_img(7, 8)[:, None]) * s
    face = np.stack([d2[..., 0], -d2[..., 1]], -1)
    for side, (sh, el, wr, ua, fa, hd) in {1: (11, 13, 15, LUA, LFA, LH), -1: (12, 14, 16, RUA, RFA, RH)}.items():
        rest = np.array([side * ARM_X, ARM_Y, 0])
        rest_n = np.cross(rest, [0, 0, 1])
        fallback = np.einsum('nij,j->ni', G[:, CHEST], rest_n)
        G[:, ua], G[:, fa] = hinge_frames(vec(sh, el), vec(el, wr), rest, rest_n, fallback)
        G[:, hd] = G[:, fa]
    if framing == 'full':
        for hp, kn, an, he, to, ul, ll, ft in [(23, 25, 27, 29, 31, LUL, LLL, LF), (24, 26, 28, 30, 32, RUL, RLL, RF)]:
            rest = np.array([0., -1, 0])
            rest_n = np.array([1., 0, 0])
            fallback = G[:, HIPS, :, 0]
            G[:, ul], G[:, ll] = hinge_frames(vec(hp, kn), vec(kn, an), rest, rest_n, fallback, np.radians(57))
            # Heel/toe landmarks are a few pixels apart and swap during stamps, so the foot
            # only gets ankle flexion and a little yaw relative to the shin, within joint limits.
            toe = unit(vec(he, to))
            sx, sy, sz = G[:, ll, :, 0], G[:, ll, :, 1], G[:, ll, :, 2]
            flex = np.arctan2(-np.sum(toe * sy, -1), np.sum(toe * sz, -1))
            yaw = np.arctan2(np.sum(toe * sx, -1), np.sum(toe * sz, -1))
            flex = np.clip(np.unwrap(flex), np.radians(-35), np.radians(55))
            yaw = np.clip(np.unwrap(yaw), np.radians(-20), np.radians(20))
            if N >= 16:
                flex, yaw = lowpass(flex, 30, 4.0), lowpass(yaw, 30, 3.0)
            local = Rotation.from_euler('YX', np.stack([yaw, flex], -1)).as_matrix()
            G[:, ft] = G[:, ll] @ local
    return G, face, tilt


def lean(img, wld, s, a, b):
    """Median forward lean (radians, about +X) of the midpoint chain a-pair -> b-pair."""
    d = (img[:, b[0]] + img[:, b[1]]) / 2 - (img[:, a[0]] + img[:, a[1]]) / 2
    dz = (wld[:, b[0], 2] + wld[:, b[1], 2]) / 2 - (wld[:, a[0], 2] + wld[:, a[1], 2]) / 2
    return float(np.median(np.arctan2(-dz, -d[:, 1] * s)))


def flatten_feet(L, root, have_legs):
    """Feet on (or near) the floor are levelled; lifted feet keep their observed pitch."""
    G, P = fk(root, L)
    for foot, shin in ((LF, LLL), (RF, RLL)):
        z = G[:, foot, :, 2].copy()
        z[:, 1] = 0
        z = unit(z)
        flat = np.stack([np.cross(UP, z), np.broadcast_to(UP, z.shape), z], -1)
        h = P[:, foot, 1]
        w = np.clip((h - .13) / .1, 0, 1)
        for n in range(len(L)):
            if w[n] < 1:
                g = slerp_mats(flat[n:n + 1], G[n:n + 1, foot], w[n])[0]
                L[n, foot] = G[n, shin].T @ g


def segment_distance(p1, q1, p2, q2):
    """Closest distance between segments p1-q1 and p2-q2."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = np.dot(d1, d1), np.dot(d2, d2), np.dot(d2, r)
    c, b = np.dot(d1, r), np.dot(d1, d2)
    denom = a * e - b * b
    s = np.clip((b * f - c * e) / denom, 0, 1) if denom > 1e-9 else 0.0
    t = (b * s + f) / e if e > 1e-9 else 0.0
    if t < 0:
        t, s = 0.0, np.clip(-c / a, 0, 1) if a > 1e-9 else 0.0
    elif t > 1:
        t, s = 1.0, np.clip((b - c) / a, 0, 1) if a > 1e-9 else 0.0
    return float(np.linalg.norm((p1 + d1 * s) - (p2 + d2 * t)))


def runs(mask):
    """[(start, end)] of consecutive True values."""
    out, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j < len(mask) and mask[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def min_rotation(a, b):
    """Smallest rotation matrix taking unit vector a onto unit vector b."""
    v, c = np.cross(a, b), float(np.dot(a, b))
    if c < -.9999:
        return Rotation.from_rotvec(np.pi * unit(np.cross(a, [1, 0, 0]))).as_matrix()
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1 + c)


def fit_face(obs, guess):
    """Weak-perspective fit of FACE_MODEL to 2D face offsets (11, 2) in the camera plane.
    Returns the head rotation in camera space; starts from `guess` (a rotation vector)."""
    def residual(x):
        r = Rotation.from_rotvec(x[:3]).apply(FACE_MODEL)
        res = (x[3] * r[:, :2] + x[4:6] - obs) * np.sqrt(FACE_WEIGHT)[:, None]
        # Weak prior toward the previous frame keeps near-frontal pitch/yaw from flipping.
        return np.concatenate([res.ravel(), .002 * (x[:3] - guess)])
    x0 = np.concatenate([guess, [1.0, 0, 0]])
    return least_squares(residual, x0, method='lm').x[:3]


def solve_head(G, face, tilts, observed, neutral, fps):
    """Head orientation from the 11 face landmarks, relative to the chest.

    Each frame fits a generic 3D face to the 2D landmarks through the stage camera tilt,
    seeded by the previous frame. The dancer-specific bias (face shape, how the ear points
    sit) is removed by the median fit over the neutral frames (standing, looking ahead at
    the start and end of the clip), applied in the head's own frame. The result is
    outlier-filtered, low-passed and clamped to neck limits. Writes G[:, HEAD], G[:, NECK].
    """
    N = len(G)
    rel = np.tile(np.eye(3), (N, 1, 1))
    ok = np.zeros(N, bool)
    guess = np.zeros(3)
    for n in np.flatnonzero(observed):
        if np.isnan(face[n]).any():
            continue
        cam = Rotation.from_rotvec(fit_face(face[n], guess))
        guess = cam.as_rotvec()
        # Camera space -> rig space through the tilt the solver removed, then chest-relative.
        rel[n] = G[n, CHEST].T @ tilts[n] @ cam.as_matrix()
        ok[n] = True
    bias = Rotation.from_matrix(rel[neutral[ok[neutral]]]).mean().as_matrix()
    rel = rel @ bias.T
    euler = Rotation.from_matrix(rel).as_euler('YXZ')
    euler[~ok] = np.nan
    for k in range(3):
        col = euler[:, k]
        col[ok] = np.unwrap(col[ok])
        col = hampel_fill(col[:, None], window=9, k=2.5, floor=np.radians(6))[:, 0]
        euler[:, k] = np.clip(lowpass(col, fps, 4.0), *HEAD_LIMITS[k])
    rel = Rotation.from_euler('YXZ', euler).as_matrix()
    G[:, HEAD] = G[:, CHEST] @ rel
    G[:, NECK] = slerp_mats(G[:, CHEST], G[:, HEAD], .5)


def rot_y(yaw):
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def ramp(n):
    t = np.clip(n, 0, 1)
    return t * t * (3 - 2 * t)


def detect_contacts(img2d, have_legs, sole, fps):
    """Planted masks per foot from the footage: the foot's image keypoints are still and
    the solved sole is near the floor. Short gaps are closed and brief touches dropped."""
    torso = np.linalg.norm((img2d[:, 11] + img2d[:, 12]) / 2 - (img2d[:, 23] + img2d[:, 24]) / 2, axis=-1)
    # Floor line in stage coordinates: where the lowest foot point sits most of the time.
    feet_low = np.max(img2d[:, 27:33, 1], -1)
    floor_line = np.full(len(img2d), np.nan)
    for a, b in runs(have_legs):
        floor_line[a:b] = np.nanpercentile(feet_low[a:b], 90)
    masks = []
    for pts, h in (([27, 29, 31], sole[0]), ([28, 30, 32], sole[1])):
        # Horizontal stage speed only: a stamp in place moves the foot vertically, and that
        # must not break the contact's anchor (vertical lifts are handled by the planner).
        x = np.nanmean(img2d[:, pts, 0], 1)
        speed = np.full(len(x), np.inf)
        for a, b in runs(have_legs & ~np.isnan(x)):
            if b - a >= 16:
                speed[a:b] = np.abs(np.gradient(lowpass(x[a:b], fps, 5.0))) * fps / np.maximum(torso[a:b], 1)
        # Monocular depth can leave a still foot a few cm up in the solve; the footage
        # (foot on the floor line) is the better witness, and IK then grounds it.
        on_line = (floor_line - np.max(img2d[:, pts, 1], -1)) < .12 * torso
        m = (speed < .35) & ((h < .06) | on_line) & have_legs
        for a, b in runs(~m):
            if 0 < a and b < len(m) and b - a <= 3 and have_legs[a:b].all():
                m[a:b] = True
        for a, b in runs(m):
            if b - a < 5:
                m[a:b] = False
        masks.append(m)
    return masks


def ik_leg(L, G, P, n, ul, ll, foot, goal, foot_global):
    """Analytic two-bone IK: put the ankle on `goal`, knee bending forward."""
    thigh, shin = .39, .36
    hip = P[n, ul]
    d_vec = goal - hip
    d = np.clip(np.linalg.norm(d_vec), .05, thigh + shin - 1e-4)
    u = unit(d_vec)
    # The knee bends toward the thigh's own forward axis; a measured knee offset is too
    # small to trust when the leg is nearly straight and would flip the knee plane.
    pole = G[n, ul] @ np.array([0., 0, 1])
    pole = unit(pole - u * np.dot(pole, u))
    cos_a = (thigh ** 2 + d ** 2 - shin ** 2) / (2 * thigh * d)
    new_knee = hip + thigh * (cos_a * u + np.sqrt(max(0, 1 - cos_a ** 2)) * pole)
    new_ankle = hip + u * d
    down = np.array([0, -1, 0])
    g_ul = min_rotation(G[n, ul] @ down, unit(new_knee - hip)) @ G[n, ul]
    g_ll = g_ul @ L[n, ll]
    g_ll = min_rotation(g_ll @ down, unit(new_ankle - new_knee)) @ g_ll
    L[n, ul] = G[n, HIPS].T @ g_ul
    L[n, ll] = g_ul.T @ g_ll
    L[n, foot] = g_ll.T @ foot_global


def apply_contacts(L, root, planted, have_legs, fps):
    """Pin every contact to one fixed floor anchor (sole flat at y=0, fixed heading).

    Close-ups bridge the contacts on either side: the same anchor if the foot did not
    move, otherwise a synthesized step. The root is moved only as much as needed
    (planted-foot pull, then leg reach), then exact IK. Nothing moves the root after.
    Returns the final planted masks.
    """
    N = len(root)
    G, P = fk(root, L)
    feet = ((LF, LUL, LLL), (RF, RUL, RLL))
    plans = []
    for k, (foot, ul, ll) in enumerate(feet):
        m = planted[k].copy()
        yaw_now = np.arctan2(G[:, foot, 0, 2], G[:, foot, 2, 2])
        steps = []
        forced = np.full((N, 3), np.nan)
        landings = []
        for a, b in runs(~have_legs):
            if a == 0 or b == N:
                continue
            before = np.flatnonzero(m[max(0, a - 8):a])
            after = np.flatnonzero(m[b:b + 8])
            # Unseen legs: a foot on the floor at a boundary is planted through the close-up
            # (holding, stepping, or landing) instead of gliding with the interpolated pose.
            near_a = len(before) > 0 or P[a - 1, foot, 1] < ANKLE_FLAT + .08
            near_b = len(after) > 0 or P[b, foot, 1] < ANKLE_FLAT + .08
            if len(before) and len(after):
                lo, hi = max(0, a - 8) + before[-1], b + after[0]
            elif near_a and near_b:
                lo, hi = a - 1, b
            elif near_b:   # in the air going in: land early, then hold where it is next seen
                k = min(b, a + 10)
                m[k:b + 1] = True; forced[k:b + 1] = P[b, foot]
                landings.append((a, k, P[a - 1, foot].copy(), P[b, foot].copy()))
                continue
            elif near_a:   # planted going in: hold, then lift toward where it is next seen
                k = max(a, b - 10)
                m[a - 1:k] = True; forced[a - 1:k] = P[a - 1, foot]
                landings.append((k, b, P[a - 1, foot].copy(), P[b, foot].copy()))
                continue
            else:
                continue
            if np.linalg.norm((P[lo, foot] - P[hi, foot])[[0, 2]]) < .08:
                m[lo:hi + 1] = True
            else:
                k1, k2 = a + int(.35 * (b - a)), b - int(.35 * (b - a))
                m[lo:k1] = True
                m[k2:hi + 1] = True
                steps.append((k1, k2))
        tgt = P[:, foot].copy()
        yaw = yaw_now.copy()
        w = np.zeros(N)
        anchor_of = np.full(N, -1)
        anchors = []
        for a, b in runs(m):
            obs = [i for i in range(a, b) if have_legs[i]] or list(range(a, b))
            xz = np.median(P[obs, foot][:, [0, 2]], 0)
            if not np.isnan(forced[a:b, 0]).all():
                xz = np.nanmedian(forced[a:b][:, [0, 2]], 0)
            anchor = (np.array([xz[0], ANKLE_FLAT, xz[1]]), float(np.median(yaw_now[obs])))
            # Landing within 6 cm of the last spot is the same spot (a stamp, a weight shift):
            # re-measuring it each time is what makes feet creep across the floor.
            if anchors and np.linalg.norm(anchors[-1][0][[0, 2]] - anchor[0][[0, 2]]) < .06:
                anchor = anchors[-1]
            anchors.append(anchor)
            anchor_of[a:b] = len(anchors) - 1
            tgt[a:b] = anchors[-1][0]
            yaw[a:b] = anchors[-1][1]
            w[a:b] = 1
        for k1, k2, start, end in landings:
            if k2 <= k1:
                continue
            t = (np.arange(k1, k2) - k1 + 1) / (k2 - k1 + 1)
            e = ramp(t)
            end = end.copy(); end[1] = ANKLE_FLAT
            tgt[k1:k2] = start + (end - start) * e[:, None]
            tgt[k1:k2, 1] = np.maximum(tgt[k1:k2, 1], ANKLE_FLAT + .06 * np.sin(np.pi * t))
            w[k1:k2] = 1
        for k1, k2 in steps:
            A, ya = anchors[anchor_of[k1 - 1]]
            B, yb = anchors[anchor_of[k2]]
            t = (np.arange(k1, k2) - k1 + 1) / (k2 - k1 + 1)
            e = ramp(t)
            tgt[k1:k2] = A + (B - A) * e[:, None]
            tgt[k1:k2, 1] = ANKLE_FLAT + .08 * np.sin(np.pi * t)
            yaw[k1:k2] = ya + (yb - ya) * e
            w[k1:k2] = 1
        # Between two contacts on the same spot the foot lifts straight up and comes back
        # down: hold xz on the anchor and keep the observed lift height (at least an arc).
        contact_runs = runs(w >= 1)
        for (_, a), (b, _) in zip(contact_runs, contact_runs[1:]):
            if 0 < b - a <= 30 and anchor_of[a - 1] >= 0 and anchor_of[b] >= 0 \
                    and anchors[anchor_of[a - 1]] is anchors[anchor_of[b]]:
                t = (np.arange(a, b) - a + 1) / (b - a + 1)
                tgt[a:b] = anchors[anchor_of[b]][0]
                tgt[a:b, 1] = np.maximum(P[a:b, foot, 1], ANKLE_FLAT + .03 * np.sin(np.pi * t))
                yaw[a:b] = anchors[anchor_of[b]][1]
                w[a:b] = 1
        # Blend in/out over EDGE frames outside each contact (xz toward the anchor only).
        edge_w = np.zeros(N)
        for a, b in runs(w >= 1):
            for j in range(1, EDGE + 1):
                for i, src in ((a - j, a), (b - 1 + j, b - 1)):
                    if 0 <= i < N and w[i] < 1:
                        r = ramp(1 - j / (EDGE + 1))
                        if r > edge_w[i]:
                            edge_w[i] = r
                            tgt[i, [0, 2]] = tgt[src, [0, 2]]
                            tgt[i, 1] = P[i, foot, 1]
                            yaw[i] = yaw[src]
        w = np.maximum(w, edge_w)
        plans.append((m, tgt, yaw, w))

    # Two feet planted at once cannot share the same spot. One camera loses depth order when
    # the legs cross, so separate overlapping simultaneous anchors along depth, shifting every
    # frame that uses each anchor so a planted foot still never slides.
    for _ in range(3):
        (ml, tl, _, wl), (mr, tr, _, wr) = plans
        for n in np.flatnonzero((wl >= 1) & (wr >= 1)):
            d = tl[n, [0, 2]] - tr[n, [0, 2]]
            gap = np.hypot(*d)
            if gap >= FOOT_CLEARANCE:
                continue
            need = np.sqrt(max(FOOT_CLEARANCE ** 2 - d[0] ** 2, 0)) - abs(d[1])
            sign = 1 if d[1] >= 0 else -1
            for k, (t, shift) in enumerate(((tl, sign * need / 2), (tr, -sign * need / 2))):
                old = t[n, [0, 2]].copy()
                same = np.all(np.abs(t[:, [0, 2]] - old) < 1e-6, axis=1)
                t[same, 2] += shift
    # Root: pull toward the planted anchors (smoothed), then exactly as much as reach needs.
    pull = np.zeros((N, 3))
    total = np.zeros(N)
    for (m, tgt, yaw, w), (foot, _, _) in zip(plans, feet):
        pull[:, [0, 2]] += (tgt[:, [0, 2]] - P[:, foot][:, [0, 2]]) * w[:, None]
        total += w
    have = total > 1e-3
    pull[have] /= total[have, None]
    if have.sum() >= 2:
        for c in (0, 2):
            pull[~have, c] = np.interp(np.flatnonzero(~have), np.flatnonzero(have), pull[have, c])
    root += lowpass(pull, fps, 2.0)
    before = root.copy()
    for smooth in (True, False):
        for _ in range(4):
            G, P = fk(root, L)
            for (m, tgt, yaw, w), (foot, ul, _) in zip(plans, feet):
                v = tgt - P[:, ul]
                d = np.linalg.norm(v, axis=-1)
                over = (w >= 1) & (d > LEG_REACH)
                root[over] += v[over] * (1 - LEG_REACH / d[over])[:, None]
        if smooth:
            # Spread the reach correction over neighbouring frames, then re-enforce exactly.
            root[:] = before + lowpass(root - before, fps, 4.0)
    G, P = fk(root, L)
    for (m, tgt, yaw, w), (foot, ul, ll) in zip(plans, feet):
        for n in np.flatnonzero(w > 0):
            goal = P[n, foot] + (tgt[n] - P[n, foot]) * w[n]
            flat = rot_y(yaw[n])
            foot_global = flat if w[n] >= 1 else slerp_mats(G[n:n + 1, foot], flat[None], w[n])[0]
            ik_leg(L, G, P, n, ul, ll, foot, goal, foot_global)
    # Between two contacts the foot must visibly leave the floor (a low glide reads as
    # skating) and never dip below it. Raise the ankle by IK; never move the root.
    G, P = fk(root, L)
    for (m, tgt, yaw, w), (foot, ul, ll) in zip(plans, feet):
        low = np.min(np.stack([P[:, foot, 1] + (G[:, foot] @ c)[:, 1] for c in SOLE], -1), -1)
        need = np.maximum(-low, 0)
        # A foot travelling fast must be off the floor; otherwise the step reads as a skate.
        speed = np.linalg.norm(np.gradient(P[:, foot][:, [0, 2]], axis=0), axis=-1) * fps
        need = np.maximum(need, np.clip((speed - .3) * .03, 0, .06) - low)
        contact_runs = runs(w >= 1)
        for (_, a), (b, _) in zip(contact_runs, contact_runs[1:]):
            if b <= a:
                continue
            # Arc over horizontal progress, not time: real feet lift first, then travel.
            path = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P[a - 1:b + 1, foot][:, [0, 2]], axis=0), axis=-1))])
            progress = path[1:-1] / max(path[-1], 1e-6)
            step = np.linalg.norm((tgt[b, [0, 2]] - tgt[a - 1, [0, 2]]))
            arc = np.clip(.3 * step, .04, .08) * np.sin(np.pi * np.clip(progress, 0, 1))
            need[a:b] = np.maximum(need[a:b], arc - low[a:b])
        need = lowpass(need, fps, 6.0)
        for n in np.flatnonzero((w < 1) & (need > 1e-4)):
            ik_leg(L, G, P, n, ul, ll, foot, P[n, foot] + np.array([0, need[n], 0]), G[n, foot])
    # Legs cannot pass through each other. One camera loses which leg is in front when they
    # cross, so both shins can land at the same depth. Push the free leg further along the
    # depth it already has until the shins clear, smoothly, never moving a planted foot.
    G, P = fk(root, L)
    push = np.zeros((2, N))
    for n in range(N):
        d = segment_distance(P[n, LLL], P[n, LF], P[n, RLL], P[n, RF])
        d = min(d, segment_distance(P[n, LUL] * .5 + P[n, LLL] * .5, P[n, LLL], P[n, RLL], P[n, RF]),
                segment_distance(P[n, LLL], P[n, LF], P[n, RUL] * .5 + P[n, RLL] * .5, P[n, RLL]))
        if d >= LEG_CLEARANCE:
            continue
        wl, wr = plans[0][3][n], plans[1][3][n]
        free = 0 if wl < wr else 1 if wr < wl else (0 if P[n, LF, 1] > P[n, RF, 1] else 1)
        if min(wl, wr) >= 1:
            continue  # both planted: the footage shows them standing there
        other = 1 - free
        ahead = P[n, (LF, RF)[free], 2] - P[n, (LF, RF)[other], 2]
        push[free, n] = (LEG_CLEARANCE - d + .01) * (1 if ahead >= 0 else -1)
    for k, (foot, ul, ll) in enumerate(feet):
        if not push[k].any():
            continue
        # Smooth, then fade to zero inside contacts so a planted foot is never moved.
        z = lowpass(push[k], fps, 4.0) * (1 - np.clip(plans[k][3], 0, 1))
        G, P = fk(root, L)
        for n in np.flatnonzero(np.abs(z) > 1e-3):
            ik_leg(L, G, P, n, ul, ll, foot, P[n, foot] + np.array([0, 0, z[n]]), G[n, foot])
    return [p[0] for p in plans]


def xy_basis(x_axis, y_hint):
    x = unit(x_axis)
    y = unit(y_hint - x * np.sum(y_hint * x, -1, keepdims=True))
    return np.stack([x, y, np.cross(x, y)], -1)


def slerp_mats(A, B, t):
    ra, rb = Rotation.from_matrix(A), Rotation.from_matrix(B)
    rel = (ra.inv() * rb).as_rotvec() * t
    return (ra * Rotation.from_rotvec(rel)).as_matrix()


def to_local(G):
    """(N, 17, 3, 3) global -> local rotations; rig rest rotations are identity."""
    L = np.empty_like(G)
    for i, (_, parent, _) in enumerate(RIG):
        L[:, i] = G[:, i] if parent < 0 else np.swapaxes(G[:, parent], -1, -2) @ G[:, i]
    return L


def fk(root, L):
    """Root (N,3) + local rotations -> global rotations and bone positions (N,17,3)."""
    N = len(root)
    G = np.empty_like(L)
    P = np.empty((N, NB, 3))
    for i, (_, parent, off) in enumerate(RIG):
        if parent < 0:
            G[:, i] = L[:, i]
            P[:, i] = root
        else:
            G[:, i] = G[:, parent] @ L[:, i]
            P[:, i] = P[:, parent] + np.einsum('nij,j->ni', G[:, parent], np.array(off))
    return G, P


def sole_height(G, P):
    """Lowest shoe point per frame, given rig-space bone transforms."""
    pts = [P[:, f] + np.einsum('nij,j->ni', G[:, f], c) for f in (LF, RF) for c in SOLE]
    return np.min(np.stack([p[:, 1] for p in pts], -1), -1)


def interp_local(L, lo, hi, bones):
    """Slerp local rotations of `bones` across frames lo..hi (exclusive) from the anchors at lo-1 and hi."""
    a, b = lo - 1, hi
    for bone in bones:
        key = Rotation.from_matrix(np.stack([L[a, bone], L[b, bone]]))
        sl = Slerp([a, b], key)
        t = np.arange(lo, hi)
        s = (t - a) / (b - a)
        eased = a + (b - a) * (s * s * (3 - 2 * s))
        L[lo:hi, bone] = sl(eased).as_matrix()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    parser.add_argument("--video", type=Path, default=Path(".local/media/reference.mp4"))
    args = parser.parse_args()
    clips = json.loads(Path("scripts/motion-clips.json").read_text())
    shots = clips["shots"]
    raws = [np.load(f".local/pose-raw/{m}.npz") for m in ("heavy", "full")]
    fps = float(raws[0]["fps"])
    shot_of = raws[0]["shot"]
    img_all = np.stack([r[k][..., :2] for r in raws for k in ("image", "imageF")])
    vis_all = np.stack([r[k][..., 2] for r in raws for k in ("image", "imageF")])
    wld_all = np.stack([r[k] for r in raws for k in ("world", "worldF")])
    sha = hashlib.sha256(args.video.read_bytes()).hexdigest()
    # Stage-fixed coordinates: the camera pans to follow the dancer (scripts/camera_track.py).
    pan_all = np.load(".local/camera.npz")["to_stage"][:, :, 2]

    for move in clips["moves"]:
        if args.only and move["id"] != args.only:
            continue
        first = int(np.ceil(move["start"] * fps))
        last = int(np.floor(move["end"] * fps))
        frames = np.arange(first, last)
        N = len(frames)
        L = np.tile(np.eye(3), (N, NB, 1, 1))
        root = np.zeros((N, 3))
        lift = np.zeros(N)
        have_upper = np.zeros(N, bool)
        have_legs = np.zeros(N, bool)
        spread = np.zeros(N)
        Gall = np.tile(np.eye(3), (N, NB, 1, 1))
        face_all = np.full((N, len(FACE), 2), np.nan)
        tilt_all = np.tile(np.eye(3), (N, 1, 1))
        img2d = np.full((N, 33, 2), np.nan)     # frame pixels (for overlays)
        stage2d = np.full((N, 33, 2), np.nan)   # pan-compensated pixels (for travel and contacts)
        segments = []
        full_ref, pitches = [], []
        for s_idx, shot in enumerate(shots):
            sel = np.flatnonzero(shot_of[frames] == s_idx)
            if not len(sel):
                continue
            idx = frames[sel]
            torso_px = np.nanmedian(np.linalg.norm(np.nanmedian(img_all[:, idx][:, :, [11, 12]], 0).mean(1) - np.nanmedian(img_all[:, idx][:, :, [23, 24]], 0).mean(1), axis=-1))
            img, img_spread = ensemble(img_all[:, idx], .08 * torso_px)
            pan = pan_all[idx][:, None, :]
            img = img + pan
            wld, _ = ensemble(wld_all[:, idx], .06)
            vis = np.nanmean(vis_all[:, idx], 0)
            img = clean_shot(img, fps, .02 * torso_px)
            img2d[sel] = img - pan
            stage2d[sel] = img
            wld = clean_shot(wld, fps, .015)
            # Metres per pixel from the performer's own torso (world model) vs its image length.
            w_t = np.linalg.norm(((wld[:, 11] + wld[:, 12]) / 2 - (wld[:, 23] + wld[:, 24]) / 2)[:, :2], axis=-1)
            i_t = np.linalg.norm((img[:, 11] + img[:, 12]) / 2 - (img[:, 23] + img[:, 24]) / 2, axis=-1)
            s = float(np.median(w_t / i_t))
            spine = lean(img, wld, s, (23, 24), (11, 12))
            if shot["framing"] == "full":
                pitch = lean(img, wld, s, (27, 28), (11, 12))
                full_ref.append((pitch, spine))
            else:
                # No feet in a close-up: assume the same spine posture offset as the full shots.
                ref = full_ref[-1] if full_ref else (0.0, spine)
                pitch = ref[0] + (spine - ref[1])
            pitches.append(round(pitch, 4))
            G, face, tilt = solve_shot(img, wld, s, shot["framing"], pitch)
            Gall[sel] = G
            face_all[sel] = face
            tilt_all[sel] = tilt
            have_upper[sel] = True
            spread[sel] = np.nanmean(img_spread[:, [0, 11, 12, 13, 14, 15, 16]], -1) / torso_px
            hip_px = (img[:, 23] + img[:, 24]) / 2
            if shot["framing"] == "full":
                have_legs[sel] = True
                # Rig metres per pixel: map the performer's hip->ankle image chain onto the rig leg (0.75 m).
                leg_px = np.median(np.linalg.norm(img[:, 23] - img[:, 25], axis=-1) + np.linalg.norm(img[:, 25] - img[:, 27], axis=-1)
                                   + np.linalg.norm(img[:, 24] - img[:, 26], axis=-1) + np.linalg.norm(img[:, 26] - img[:, 28], axis=-1)) / 2
                k = .75 / max(leg_px, 1)
                root[sel, 0] = hip_px[:, 0] * k
                low = np.max(img[:, 27:33, 1], -1)
                floor_px = np.percentile(low, 92)
                lift[sel] = np.clip((floor_px - low) * k - .03, 0, None)
                segments.append({"start": round(sel[0] / fps, 3), "end": round((sel[-1] + 1) / fps, 3), "framing": "full", "scale": k})
            else:
                segments.append({"start": round(sel[0] / fps, 3), "end": round((sel[-1] + 1) / fps, 3), "framing": "closeup"})

        # Head from the face template; neutral = standing frames at the start and end.
        obs = np.flatnonzero(have_upper & have_legs)
        neutral = np.concatenate([obs[:15], obs[-15:]])
        solve_head(Gall, face_all, tilt_all, have_upper, neutral, fps)
        L[have_upper] = to_local(Gall[have_upper])

        # Re-anchor root x across camera cuts so the dancer never teleports, then centre the travel.
        full_segs = [g for g in segments if g["framing"] == "full"]
        offset = 0.0
        prev_end_x = None
        for g in segments:
            a, b = int(round(g["start"] * fps)), int(round(g["end"] * fps))
            if g["framing"] != "full":
                continue
            if prev_end_x is not None:
                offset = prev_end_x - root[a, 0]
            root[a:b, 0] += offset
            prev_end_x = root[b - 1, 0]
        xs = root[have_legs, 0]
        root[:, 0] -= (xs.min() + xs.max()) / 2

        # Fill everything that is not fully observed (cut frames, close-up legs) by eased slerp.
        missing_upper = ~have_upper
        missing_legs = ~have_legs
        for mask, bones in [(missing_upper, list(range(NB))), (missing_legs, LEGS)]:
            i = 0
            while i < N:
                if not mask[i]:
                    i += 1
                    continue
                j = i
                while j < N and mask[j]:
                    j += 1
                if i == 0 or j == N:
                    src = j if i == 0 else i - 1
                    L[i:j, bones] = L[src, bones]
                else:
                    interp_local(L, i, j, bones)
                i = j
        for arr in (root[:, 0], lift):
            ok = have_legs
            arr[~ok] = np.interp(np.flatnonzero(~ok), np.flatnonzero(ok), arr[ok])
        lift = lowpass(lift, fps, 3.0)
        root[:, 0] = lowpass(root[:, 0], fps, 3.0)

        # Floor contact: lowest sole touches the floor, plus measured airborne lift.
        root[:, 1] = 0
        G, P = fk(root, L)
        root[:, 1] = -sole_height(G, P) + np.clip(lift, 0, None)
        flatten_feet(L, root, have_legs)
        root[:, 1] = 0
        G, P = fk(root, L)
        root[:, 1] = -sole_height(G, P) + np.clip(lift, 0, None)
        root[:, 1] = lowpass(root[:, 1], fps, 6.0)
        root[:, 0] -= (root[have_legs, 0].min() + root[have_legs, 0].max()) / 2
        root[:, 2] -= np.median(root[have_legs, 2])
        G, P = fk(root, L)
        soles = [np.min(np.stack([P[:, f, 1] + (G[:, f] @ c)[:, 1] for c in SOLE], -1), -1) for f in (LF, RF)]
        planted = apply_contacts(L, root, detect_contacts(stage2d, have_legs, soles, fps), have_legs, fps)
        G, P = fk(root, L)

        quats = Rotation.from_matrix(L.reshape(-1, 3, 3)).as_quat().reshape(N, NB, 4)
        for b in range(NB):
            for t in range(1, N):
                if np.dot(quats[t, b], quats[t - 1, b]) < 0:
                    quats[t, b] *= -1
        head = P[:, HEAD] + np.einsum('nij,j->ni', G[:, HEAD], NOSE)
        joints = np.stack([head, P[:, LH], P[:, RH]], 1)
        estimated = []
        for i in range(N):
            flag = (0 if have_upper[i] else 1) | (0 if have_legs[i] else 2)
            if estimated and estimated[-1][2] == flag and estimated[-1][1] == i:
                estimated[-1][1] = i + 1
            elif flag:
                estimated.append([i, i + 1, flag])
        result = {
            "version": 2,
            "id": move["id"],
            "source": {"url": clips["source"], "sha256": sha, "fps": fps, "clipStart": round(first / fps, 4), "clipEnd": round(last / fps, 4), "teacher": move["teacher"]},
            "method": "MediaPipe Pose Landmarker Heavy+Full, flip-augmented ensemble; Hampel + zero-phase low-pass; image-plane angles with model depth; hinge-aware retarget to fixed rig proportions; floor-contact root.",
            "depth": "Estimated by a monocular model; treat forward/back limb placement as approximate.",
            "fps": fps,
            "duration": round(N / fps, 4),
            "frameCount": N,
            "bones": [r[0] for r in RIG],
            "segments": segments,
            "contacts": [{"foot": side, "start": round(a / fps, 4), "end": round(b / fps, 4)} for side, m in zip(("left", "right"), planted) for a, b in runs(m)],
            "estimated": [{"start": round(a / fps, 3), "end": round(b / fps, 3), "upper": bool(f & 1), "legs": bool(f & 2)} for a, b, f in estimated],
            "root": np.round(root, 4).ravel().tolist(),
            "rotations": np.round(quats, 4).ravel().tolist(),
            "joints": np.round(joints, 4).ravel().tolist(),
            "jointNames": ["nose", "leftWrist", "rightWrist"],
            "quality": {
                "observedUpper": round(float(have_upper.mean()), 4),
                "observedLegs": round(float(have_legs.mean()), 4),
                "ensembleSpread": round(float(np.median(spread[have_upper])), 4),
            },
        }
        out = Path(f"public/motion/{move['id']}.json")
        out.write_text(json.dumps(result, separators=(",", ":")))
        np.savez_compressed(f".local/pose-solved-{move['id']}.npz", frames=frames, root=root, L=L, P=P, G=G, img2d=img2d, pan=pan_all[frames], planted=np.stack(planted), have_upper=have_upper, have_legs=have_legs)
        print(move["id"], N, "frames", "pitch", pitches, result["quality"], "estimated", result["estimated"])


if __name__ == "__main__":
    main()
