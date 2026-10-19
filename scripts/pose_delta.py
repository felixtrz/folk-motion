"""Side-by-side delta videos: source footage vs the reconstructed motion.

Usage: .venv-pose/bin/python -I scripts/pose_delta.py [move ...]
Needs .local/pose-solved-<id>.npz (pose_solve.py), .local/pose-raw/*.npz (pose_raw.py)
and .local/review/render/<id>/ (scripts/render-review.mjs).

Panel 1: footage with the RAW (unfiltered) MediaPipe ensemble in white and the solved rig
         projected back through the stage camera tilt in colour; red lines join
         corresponding joints, so every offset on screen is the delta. Each shot gets one
         constant alignment (scale from the torso, offset from the hips), never per frame,
         so root drift stays visible.
Panel 2: the skinned instructor, posed by the app's InstructorRig, from a stage-like camera.
Panel 3: the same pose from a three-quarter view (depth, which the footage cannot show).
Strip:   per-frame image-plane angle error of arm and leg segments; grey = legs estimated.
Writes .local/review/delta-<id>.mp4 and prints summary statistics.
"""
import json
import warnings
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from pose_solve import HEAD, NOSE  # noqa: E402

# (MediaPipe index, rig bone index) for joints drawn and measured.
PAIRS = {11: 5, 13: 6, 15: 7, 12: 8, 14: 9, 16: 10, 23: 11, 25: 12, 27: 13, 24: 14, 26: 15, 28: 16}
ARM_SEGS = [(11, 13), (13, 15), (12, 14), (14, 16)]
LEG_SEGS = [(23, 25), (25, 27), (24, 26), (26, 28)]
BODY_SEGS = [(11, 12), (11, 23), (12, 24), (23, 24)]
PITCH = {'flash-step': [.2042], 'ball-kick': [.1761], 'bear-shake': [.197, .1136, .1902], 'head-shake': [.1221, .0394, .1772]}
W, H, STRIP = 480, 360, 150


def angle(v):
    return np.degrees(np.arctan2(v[..., 1], v[..., 0]))


def wrap(d):
    return np.abs((d + 180) % 360 - 180)


def main():
    warnings.filterwarnings('ignore', category=RuntimeWarning)
    clips = json.loads(Path("scripts/motion-clips.json").read_text())
    shots = clips["shots"]
    raws = [np.load(f".local/pose-raw/{m}.npz") for m in ("heavy", "full")]
    raw_img = np.nanmedian(np.stack([r[k][..., :2] for r in raws for k in ("image", "imageF")]), 0)
    shot_of = raws[0]["shot"]
    cap = cv2.VideoCapture(".local/media/reference.mp4")
    sx, sy = W / cap.get(3), H / cap.get(4)
    ids = sys.argv[1:] or [m["id"] for m in clips["moves"]]
    for move in ids:
        d = np.load(f".local/pose-solved-{move}.npz")
        frames, P, G, legs = d["frames"], d["P"], d["G"], d["have_legs"]
        N = len(frames)
        obs = raw_img[frames]                                  # (N, 33, 2) pixels
        # Rig -> camera: re-apply the stage camera tilt that the solver removed.
        proj = np.full((N, 33, 2), np.nan)
        move_shots = sorted(set(shot_of[frames]) - {-1})
        for k, s in enumerate(move_shots):
            sel = shot_of[frames] == s
            p = PITCH[move][min(k, len(PITCH[move]) - 1)]
            c, si = np.cos(p), np.sin(p)
            tilt = np.array([[1, 0, 0], [0, c, -si], [0, si, c]])
            rig = {mp: P[sel, b] @ tilt.T for mp, b in PAIRS.items()}
            rig[0] = (P[sel, HEAD] + np.einsum('nij,j->ni', G[sel, HEAD], NOSE)) @ tilt.T
            mid = lambda q, a, b: (q[a] + q[b]) / 2
            omid = lambda q, a, b: (q[:, a] + q[:, b]) / 2
            torso_obs = np.linalg.norm(omid(obs[sel], 11, 12) - omid(obs[sel], 23, 24), axis=-1)
            torso_rig = np.linalg.norm((mid(rig, 11, 12) - mid(rig, 23, 24))[:, :2], axis=-1)
            ppm = np.nanmedian(torso_obs / torso_rig)
            to_px = lambda q: np.stack([q[:, 0] * ppm, -q[:, 1] * ppm], -1)
            pan = d["pan"][sel]   # the rig travels in stage coordinates; the footage pans
            if legs[sel].any():
                offset = np.nanmedian(omid(obs[sel], 23, 24) + pan - to_px(mid(rig, 23, 24)), 0) - pan
            else:
                # Close-up: travel is unobservable and the root is interpolated, so align the
                # shoulders every frame; the overlay then shows pose delta only.
                offset = omid(obs[sel], 11, 12) - to_px(mid(rig, 11, 12))
            for mp, q in rig.items():
                proj[sel, mp] = to_px(q) + offset
        # Image-plane angle error per segment (proportion-independent).
        def seg_err(segs, mask):
            e = np.stack([wrap(angle(obs[:, b] - obs[:, a]) - angle(proj[:, b] - proj[:, a])) for a, b in segs], -1)
            e[~mask] = np.nan
            return np.nanmean(e, -1)
        observed = shot_of[frames] >= 0
        arm = seg_err(ARM_SEGS, observed)
        leg = seg_err(LEG_SEGS, observed & legs)
        torso_px = np.linalg.norm((obs[:, 11] + obs[:, 12]) / 2 - (obs[:, 23] + obs[:, 24]) / 2, axis=-1)
        drift = np.linalg.norm((proj[:, 23] + proj[:, 24]) / 2 - (obs[:, 23] + obs[:, 24]) / 2, axis=-1) / torso_px
        stats = {
            "armAngleErrDeg": {"median": round(float(np.nanmedian(arm)), 1), "p90": round(float(np.nanpercentile(arm, 90)), 1)},
            "legAngleErrDeg": {"median": round(float(np.nanmedian(leg)), 1), "p90": round(float(np.nanpercentile(leg, 90)), 1)},
            "hipDriftTorso": {"median": round(float(np.nanmedian(drift[legs])), 3), "p90": round(float(np.nanpercentile(drift[legs], 90)), 3)},
        }
        print(move, json.dumps(stats))

        out = Path(f".local/review/delta-{move}.mp4")
        ff = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W * 3}x{H + STRIP}",
                               "-r", "30", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(out)], stdin=subprocess.PIPE)
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frames[0]))
        ymax = 45.0
        for n in range(N):
            ok, bgr = cap.read()
            if not ok:
                break
            src = cv2.resize(bgr, (W, H))
            S = np.array([sx, sy])
            show_legs = bool(legs[n])
            for a, b in ARM_SEGS + BODY_SEGS + (LEG_SEGS if show_legs else []):
                if not np.isnan(obs[n, [a, b]]).any():
                    cv2.line(src, tuple((obs[n, a] * S).astype(int)), tuple((obs[n, b] * S).astype(int)), (255, 255, 255), 1, cv2.LINE_AA)
            for a, b in ARM_SEGS + BODY_SEGS + LEG_SEGS:
                if (a, b) in LEG_SEGS and not show_legs:
                    colour = (150, 150, 150)
                else:
                    colour = (60, 170, 255) if a % 2 == 1 else (110, 230, 120) if a % 2 == 0 and b % 2 == 0 else (230, 230, 230)
                if not np.isnan(proj[n, [a, b]]).any():
                    cv2.line(src, tuple((proj[n, a] * S).astype(int)), tuple((proj[n, b] * S).astype(int)), colour, 2, cv2.LINE_AA)
            for mp in PAIRS:
                if mp >= 23 and not show_legs:
                    continue
                if not np.isnan(obs[n, mp]).any() and not np.isnan(proj[n, mp]).any():
                    cv2.line(src, tuple((obs[n, mp] * S).astype(int)), tuple((proj[n, mp] * S).astype(int)), (40, 40, 255), 1, cv2.LINE_AA)
            cv2.putText(src, f"{move}  {n / 30:5.2f}s", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, .6, (0, 240, 255), 2)
            cv2.putText(src, "white: footage (raw)   colour: reconstruction   red: delta", (8, H - 10), cv2.FONT_HERSHEY_SIMPLEX, .42, (255, 255, 255), 1)
            if not show_legs:
                cv2.putText(src, "close-up: legs estimated, aligned per frame on shoulders", (8, 44), cv2.FONT_HERSHEY_SIMPLEX, .5, (180, 180, 180), 1)
            render = cv2.imread(f".local/review/render/{move}/{n:04d}.jpg")
            if render is None:
                render = np.zeros((H, W * 2, 3), np.uint8)
            cv2.putText(render, "reconstruction: stage camera", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, .55, (220, 220, 220), 1)
            cv2.putText(render, "reconstruction: 3/4 view (depth)", (W + 8, 22), cv2.FONT_HERSHEY_SIMPLEX, .55, (220, 220, 220), 1)
            strip = np.full((STRIP, W * 3, 3), 24, np.uint8)
            x = lambda i: int(40 + (W * 3 - 60) * i / max(N - 1, 1))
            y = lambda v: int(STRIP - 20 - (STRIP - 40) * min(v, ymax) / ymax)
            for i in range(N):
                if not legs[i]:
                    cv2.line(strip, (x(i), 20), (x(i), STRIP - 20), (60, 60, 60), 1)
            for v in (0, 15, 30, 45):
                cv2.line(strip, (40, y(v)), (W * 3 - 20, y(v)), (55, 55, 55), 1)
                cv2.putText(strip, f"{v}", (8, y(v) + 4), cv2.FONT_HERSHEY_SIMPLEX, .38, (160, 160, 160), 1)
            for series, colour in ((arm, (60, 170, 255)), (leg, (110, 230, 120))):
                pts = [(x(i), y(v)) for i, v in enumerate(series) if not np.isnan(v)]
                for p0, p1 in zip(pts, pts[1:]):
                    if p1[0] - p0[0] <= x(1) - x(0) + 1:
                        cv2.line(strip, p0, p1, colour, 1, cv2.LINE_AA)
            cv2.line(strip, (x(n), 12), (x(n), STRIP - 12), (0, 240, 255), 1)
            label = f"image-plane angle error (deg)   arms {arm[n]:4.1f}  legs {'  --' if np.isnan(leg[n]) else f'{leg[n]:4.1f}'}   " \
                    f"| clip median arms {stats['armAngleErrDeg']['median']} legs {stats['legAngleErrDeg']['median']}   grey = legs estimated"
            cv2.putText(strip, label, (40, 14), cv2.FONT_HERSHEY_SIMPLEX, .42, (220, 220, 220), 1)
            ff.stdin.write(np.vstack([np.hstack([src, render]), strip]).tobytes())
        ff.stdin.close()
        ff.wait()
        print("wrote", out)


if __name__ == "__main__":
    main()
