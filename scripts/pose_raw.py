"""Stage 1: raw per-frame pose observations for every shot of the source video.

Usage: .venv-pose/bin/python -I scripts/pose_raw.py .local/media/reference.mp4 [--model heavy] [--crop]

Writes .local/pose-raw/<model>[-crop].npz with, for every native video frame:
  image  (N, 33, 3)  pixel x, pixel y, visibility           (normal pass)
  world  (N, 33, 3)  metric hip-centred landmarks           (normal pass)
  imageF / worldF    the same from a horizontally flipped pass, already un-flipped
                     and with left/right landmark indices swapped back
  shot   (N,)        shot index from scripts/motion-clips.json (-1 outside shots)
Each shot gets fresh landmarkers so tracking never leaks across a camera cut.
Nothing here is filtered; scripts/pose_solve.py owns all post-processing.
"""
import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

# MediaPipe landmark index pairs that swap under a horizontal flip.
FLIP = list(range(33))
for a, b in [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18), (19, 20), (21, 22),
             (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]:
    FLIP[a], FLIP[b] = b, a


def landmarker(model: Path):
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1, min_pose_detection_confidence=.4, min_pose_presence_confidence=.4, min_tracking_confidence=.4)
    return mp.tasks.vision.PoseLandmarker.create_from_options(options)


def detect(det, rgb, ms, box, width, height):
    """Run one detection, optionally on an upscaled square crop; returns pixel/world arrays or None."""
    x0 = y0 = 0
    scale = 1.0
    if box is not None:
        cx, cy, side = box
        side = max(side, 64)
        x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
        pad = cv2.copyMakeBorder(rgb, max(0, -y0), max(0, y0 + int(side) - height), max(0, -x0), max(0, x0 + int(side) - width), cv2.BORDER_REPLICATE)
        px, py = max(0, -x0), max(0, -y0)
        crop = pad[y0 + py:y0 + py + int(side), x0 + px:x0 + px + int(side)]
        scale = 512 / crop.shape[0]
        rgb = np.ascontiguousarray(cv2.resize(crop, (512, 512), interpolation=cv2.INTER_CUBIC))
    h, w = rgb.shape[:2]
    result = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ms)
    if not result.pose_landmarks:
        return None
    image = np.array([[p.x * w / scale + x0, p.y * h / scale + y0, p.visibility or 0] for p in result.pose_landmarks[0]])
    world = np.array([[p.x, p.y, p.z] for p in result.pose_world_landmarks[0]])
    return image, world


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--model", default="heavy", choices=["full", "heavy"])
    parser.add_argument("--crop", action="store_true", help="feed an upscaled person crop instead of the full frame")
    parser.add_argument("--clips", type=Path, default=Path("scripts/motion-clips.json"))
    args = parser.parse_args()
    shots = json.loads(args.clips.read_text())["shots"]
    model = Path(f".local/models/pose_landmarker_{args.model}.task")
    cap = cv2.VideoCapture(str(args.video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width, height = int(cap.get(3)), int(cap.get(4))
    N = count
    out = {k: np.full((N, 33, 3), np.nan) for k in ["image", "world", "imageF", "worldF"]}
    shot_of = np.full(N, -1, dtype=int)
    for s, shot in enumerate(shots):
        first, last = int(np.ceil(shot["start"] * fps)), min(N, int(np.floor(shot["end"] * fps)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, first)
        boxes = [None, None]
        with landmarker(model) as det, landmarker(model) as detF:
            for i in range(first, last):
                ok, bgr = cap.read()
                if not ok:
                    break
                shot_of[i] = s
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                ms = round(i * 1000 / fps)
                for flipped, d in [(False, det), (True, detF)]:
                    src = rgb[:, ::-1].copy() if flipped else rgb
                    hit = detect(d, src, ms, boxes[flipped] if args.crop else None, width, height)
                    if hit is None:
                        boxes[flipped] = None
                        continue
                    image, world = hit
                    if args.crop:
                        ok_pts = image[image[:, 2] > .3]
                        if len(ok_pts) > 8:
                            lo, hi = ok_pts[:, :2].min(0), ok_pts[:, :2].max(0)
                            boxes[flipped] = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, max(hi - lo) * 1.35)
                    if flipped:
                        image = image[FLIP]; world = world[FLIP]
                        image[:, 0] = width - image[:, 0]
                        world[:, 0] = -world[:, 0]
                        out["imageF"][i], out["worldF"][i] = image, world
                    else:
                        out["image"][i], out["world"][i] = image, world
        print(f"shot {s} {shot['label']}: frames {first}-{last}", flush=True)
    cap.release()
    dest = Path(f".local/pose-raw/{args.model}{'-crop' if args.crop else ''}.npz")
    dest.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(dest, fps=fps, width=width, height=height, shot=shot_of, **out)
    print("wrote", dest)


if __name__ == "__main__":
    main()
