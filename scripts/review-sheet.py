"""Compose phone captures into judge sheets: states.png (6 phone states), strip.png (playback)."""
import sys
from pathlib import Path
import cv2
import numpy as np
d = Path(sys.argv[1])
def load(name, w=393):
    im = cv2.imread(str(d / f'{name}.png')); h = int(im.shape[0] * w / im.shape[1])
    return cv2.resize(im, (w, h), interpolation=cv2.INTER_AREA)
states = ['phone-1-flash', 'phone-2-kick-robot', 'phone-3-bear-croc', 'phone-4-head', 'phone-3-bear', 'phone-notes']
cv2.imwrite(str(d / 'states.png'), np.vstack([np.hstack([load(n) for n in states[:3]]), np.hstack([load(n) for n in states[3:]])]))
strip = [load(f'strip-{i}', 262) for i in range(8)]
cv2.imwrite(str(d / 'strip.png'), np.vstack([np.hstack(strip[:4]), np.hstack(strip[4:])]))
cv2.imwrite(str(d / 'desktop.png'), cv2.resize(cv2.imread(str(d / 'desktop-3-bear.png')), (1200, 750), interpolation=cv2.INTER_AREA))
small = load('small-2-kick-robot', 393)
cv2.imwrite(str(d / 'small.png'), small)
print('ok')
