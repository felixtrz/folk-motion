"""Compose avatar close-ups into one judge sheet: rows = poses, columns = angles."""
import sys
from pathlib import Path
import cv2
import numpy as np
d, avatar = Path(sys.argv[1]), sys.argv[2]
poses = [(1, 2.67), (2, 2.33), (3, 3.43), (3, 7.7), (4, 3.0), (4, 4.2)]
rows = []
for s, t in poses:
    tiles = [cv2.resize(cv2.imread(str(d / f'{avatar}-s{s}-t{t:g}-az{az}.png')), (353, 520), interpolation=cv2.INTER_AREA) for az in (0, 40, -140)]
    rows.append(np.hstack(tiles))
cv2.imwrite(str(d / f'{avatar}-sheet.png'), np.vstack([np.hstack(rows[i:i + 2]) for i in range(0, 6, 2)]))
print('ok')
