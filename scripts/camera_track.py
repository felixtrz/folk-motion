"""Stage 1b: camera motion per shot (the stage camera pans and zooms to follow the dancer).

Usage: .venv-pose/bin/python -I scripts/camera_track.py .local/media/reference.mp4

Takes the median dense optical flow (DIS) over textured background pixels, masking out
the dancer (from the raw pose), the black letterbox, the channel logo and the caption box
(all screen-fixed, so they would read as "no motion"). Zoom stays under 3%, so the model
is translation only. Close-ups are left at identity.
Writes .local/camera.npz: to_stage (N, 2, 3) maps a frame's pixels into the coordinates
of its shot's first frame, so landmarks become stage-fixed. Identity outside shots.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

OVERLAYS = [(0, 0, 260, 85), (0, 565, 380, 675)]  # x0, y0, x1, y1 at 960x720: logo, caption
BORDER = 24  # the frame has a 10-15 px black letterbox whose edges never move


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    shots = json.loads(Path("scripts/motion-clips.json").read_text())["shots"]
    raw = np.load(".local/pose-raw/heavy.npz")
    body = np.nanmedian(np.stack([raw["image"][..., :2], raw["imageF"][..., :2]]), 0)
    cap = cv2.VideoCapture(str(args.video))
    fps, count = cap.get(cv2.CAP_PROP_FPS), int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width, height = int(cap.get(3)), int(cap.get(4))
    to_stage = np.tile(np.array([[1., 0, 0], [0, 1, 0]]), (count, 1, 1))
    quality = np.zeros(count)
    for shot in shots:
        first, last = int(np.ceil(shot["start"] * fps)), min(count, int(np.floor(shot["end"] * fps)))
        if shot["framing"] != "full":
            # A close-up shows too little backdrop to track; it only feeds upper-body angles,
            # which do not depend on camera translation.
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, first)
        prev = None
        dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        acc = np.array([[1., 0, 0], [0, 1, 0]])
        for i in range(first, last):
            ok, bgr = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            mask = np.zeros(gray.shape, np.uint8)
            mask[BORDER:-BORDER, BORDER:-BORDER] = 255
            for x0, y0, x1, y1 in OVERLAYS:
                mask[y0:y1, x0:x1] = 0
            pts = body[i][~np.isnan(body[i, :, 0])]
            if len(pts):
                lo, hi = pts.min(0), pts.max(0)
                pad = (hi - lo) * .35 + 25
                x0, y0 = np.maximum(lo - pad, 0).astype(int)
                x1, y1 = np.minimum(hi + pad, [width, height]).astype(int)
                mask[y0:y1, x0:x1] = 0
            if prev is not None:
                # Median dense flow over textured background pixels. Sparse corners on this
                # low-texture backdrop under-read the pan by 10-50% (checked against seams).
                flow = dis.calc(prev[0], gray, None)
                use = (prev[1] > 0) & (mask > 0) & (np.abs(cv2.Sobel(prev[0], cv2.CV_32F, 1, 0)) + np.abs(cv2.Sobel(prev[0], cv2.CV_32F, 0, 1)) > 8)
                if use.sum() > 50:
                    dx, dy = np.median(flow[..., 0][use]), np.median(flow[..., 1][use])
                    quality[i] = use.mean()
                else:
                    dx = dy = 0.0
                acc = acc + np.array([[0, 0, -dx], [0, 0, -dy]])
            to_stage[i] = acc
            prev = (gray, mask)
        t = to_stage[first:last]
        print(f"{shot['label']:14s} pan x {t[:, 0, 2].min():7.1f}..{t[:, 0, 2].max():6.1f}px  pan y {t[:, 1, 2].min():6.1f}..{t[:, 1, 2].max():5.1f}px  background used {quality[first + 1:last].mean():.2f}")
    np.savez_compressed(".local/camera.npz", to_stage=to_stage, fps=fps)


if __name__ == "__main__":
    main()
