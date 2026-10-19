"""Stage 3: visual review of solved motion against the source footage.

Usage: .venv-pose/bin/python -I scripts/pose_review.py <move-id> [--sheet]

Writes .local/review/<id>.mp4 (source | rig front | rig side, frame-locked) and,
with --sheet, artifacts/motion-review-<id>.jpg with 12 evenly spaced frames.
Estimated (unobserved) limbs are drawn dashed-grey so they are never mistaken for data.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from pose_solve import RIG, LH, RH, LF, RF, HEAD, SOLE, NOSE

EDGES = [(i, p) for i, (_, p, _) in enumerate(RIG) if p >= 0]
LEFT = {5, 6, 7, 11, 12, 13}
RIGHT = {8, 9, 10, 14, 15, 16}
LEG = {11, 12, 13, 14, 15, 16}


def draw_rig(P, G, have_legs, view, size=360):
    canvas = np.full((size, size, 3), 32, np.uint8)
    cv2.line(canvas, (0, size - 30), (size, size - 30), (90, 90, 90), 1)
    px = size / 2.2

    def project(p):
        x = p[0] if view == 'front' else p[2]
        return int(size / 2 + x * px), int(size - 30 - p[1] * px)

    points = {i: P[i] for i in range(len(RIG))}
    for f in (LF, RF):
        points[f'toe{f}'] = P[f] + G[f] @ SOLE[0]
        points[f'heel{f}'] = P[f] + G[f] @ SOLE[1]
    for i, p in EDGES:
        colour = (130, 200, 255) if i in LEFT else (150, 240, 160) if i in RIGHT else (230, 230, 230)
        if i in LEG and not have_legs:
            colour = (110, 110, 110)
        cv2.line(canvas, project(points[p]), project(points[i]), colour, 3, cv2.LINE_AA)
    for f in (LF, RF):
        colour = (110, 110, 110) if not have_legs else (130, 200, 255) if f == LF else (150, 240, 160)
        cv2.line(canvas, project(points[f'heel{f}']), project(points[f'toe{f}']), colour, 3, cv2.LINE_AA)
    cv2.circle(canvas, project(P[HEAD] + G[HEAD] @ np.array([0, .1, 0])), 14, (230, 230, 230), 2, cv2.LINE_AA)
    cv2.circle(canvas, project(P[HEAD] + G[HEAD] @ NOSE), 4, (80, 160, 255), -1)
    cv2.putText(canvas, view, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, .55, (200, 200, 200), 1)
    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("move")
    parser.add_argument("--sheet", action="store_true")
    parser.add_argument("--at", type=float, nargs="*", help="also save full-size review frames at these clip times")
    parser.add_argument("--video", type=Path, default=Path(".local/media/reference.mp4"))
    args = parser.parse_args()
    solved = np.load(f".local/pose-solved-{args.move}.npz")
    frames, P, G, legs = solved["frames"], solved["P"], solved["G"], solved["have_legs"]
    cap = cv2.VideoCapture(str(args.video))
    tiles = []
    out_dir = Path(".local/review"); out_dir.mkdir(parents=True, exist_ok=True)
    writer = None
    pick = set(np.linspace(0, len(frames) - 1, 12).round().astype(int)) if args.sheet else set()
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(frames[0]))
    for n, f in enumerate(frames):
        ok, bgr = cap.read()
        if not ok:
            break
        for a, b in [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24), (23, 25), (25, 27), (24, 26), (26, 28), (27, 29), (29, 31), (28, 30), (30, 32)]:
            pa, pb = solved["img2d"][n, a], solved["img2d"][n, b]
            if np.isnan(pa).any() or np.isnan(pb).any() or (b >= 25 and not legs[n]):
                continue
            colour = (130, 200, 255) if a % 2 == 1 and b % 2 == 1 else (150, 240, 160) if a % 2 == 0 and b % 2 == 0 else (230, 230, 230)
            cv2.line(bgr, tuple(pa.astype(int)), tuple(pb.astype(int)), colour, 2, cv2.LINE_AA)
        src = cv2.resize(bgr, (480, 360))
        cv2.putText(src, f"{n / 30:.2f}s", (8, 20), cv2.FONT_HERSHEY_SIMPLEX, .6, (0, 240, 255), 2)
        row = np.hstack([src, draw_rig(P[n], G[n], legs[n], 'front'), draw_rig(P[n], G[n], legs[n], 'side')])
        if writer is None:
            writer = cv2.VideoWriter(str(out_dir / f"{args.move}.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), 30, (row.shape[1], row.shape[0]))
        writer.write(row)
        if args.at and any(abs(n / 30 - t) < 1 / 60 for t in args.at):
            cv2.imwrite(str(out_dir / f"{args.move}-{n / 30:.2f}.jpg"), row)
        if n in pick:
            tiles.append(cv2.resize(row, (row.shape[1] // 2, row.shape[0] // 2)))
    writer.release()
    if args.sheet and tiles:
        sheet = np.vstack([np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles) - 1, 2)])
        Path("artifacts").mkdir(exist_ok=True)
        cv2.imwrite(f"artifacts/motion-review-{args.move}.jpg", sheet)
    print("wrote", out_dir / f"{args.move}.mp4")


if __name__ == "__main__":
    main()
