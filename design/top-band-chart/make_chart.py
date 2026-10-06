#!/usr/bin/env python3
"""
Bullish bar chart for the top band of the card back.

Writes two vector files next to this script:
    bullish-chart.svg        the bars alone (orange, transparent background)
    bullish-chart-guide.svg  the same bars plus the band's inside edge and the
                             briefcase-handle tab, for lining it up; delete the
                             "guide" group once it is placed

Every number is in card-image px, the scale where the card's outline stroke is
5 px and the stick of the corner candles' wicks is 10 px wide. The canvas's top
left corner is the top left inside corner of the band, and its width is the
band's inside top width, so scaling the file to that width makes every bar
exactly as thick as the corner wick. The bars stand on the band's bottom line
and run 2.5 px into it so no seam shows; the middle one sits on the handle tab.

Five bars, spaced and sized like the five pennant flags across the top band of
the vintage baseball card back this design follows: poles 18.2% of the band's
bottom width apart, centred, the tallest reaching the flags' height (77% of the
band). The heights are a random walk filtered to read as growth: lowest first,
highest last, and one shallow pullback in between that holds above the low.

    python3 make_chart.py              # the committed chart
    python3 make_chart.py --seed 7     # a different random chart
"""

import argparse
import math
import os
import random

ORANGE = '#FF6F00'

# ------------------------------------------------- the band (measured off the card)
BAND_W = 489.69        # inside width along the top edge
BAND_H = 56.0          # inside height, thick top bar to bottom line
SLOPE = 0.7679         # each slanted side moves in this much per 1 px down
TAB = (224.85, 265.31, 51.18, 4.0)  # handle tab: left x, right x, top y, corner radius
HOLE = (229.08, 261.08)  # the handle's cream opening below the bottom line

# ------------------------------------------------- the bars
BAR = 10.0             # = the stick of the corner candles' wicks
BARS = 5               # odd, so the middle bar sits on the handle tab
PITCH = 73.4           # centre to centre, = the flags' spacing scaled to this band
MAX_BAR = 43.0         # = the flags' height
MIN_BAR = 15.0         # shortest bar
CLEAR = 6.0            # gap kept from the slanted sides
SINK = 2.5             # how far bars run into the bottom line (5 px thick)

DEFAULT_SEED = 1


def walk(rng, n):
    """Random prices with an upward drift."""
    p, path = 0.0, [0.0]
    for _ in range(1, n):
        p += 1.0 + rng.gauss(0, 0.9)
        path.append(p)
    return path


def bullish(path):
    """True if the walk reads as growth with one shallow pullback."""
    lo, hi = min(path), max(path)
    if path[0] != lo or path[-1] != hi:
        return False                          # lowest first, highest last
    steps = [b - a for a, b in zip(path, path[1:])]
    downs = [i for i, d in enumerate(steps) if d < 0]
    if len(downs) != 1 or downs[0] in (0, len(steps) - 1):
        return False                          # one pullback, not at either end
    i = downs[0]
    if -steps[i] > 0.6 * steps[i - 1] or -steps[i] < 0.1 * (hi - lo):
        return False                          # visible, but gives back under 60% of the rise before it
    return all(d > 0.15 * (hi - lo) for d in steps if d > 0)  # every rise is a clear step up


def layout(path):
    """(x, top, bottom) per bar, centred on the handle tab, standing on the bottom line."""
    n = len(path)
    lo, hi = min(path), max(path)
    centre = (TAB[0] + TAB[1]) / 2
    inset = CLEAR / math.cos(math.atan(SLOPE))  # perpendicular gap -> horizontal
    if centre - (n - 1) / 2 * PITCH - BAR / 2 < SLOPE * BAND_H + inset:
        raise SystemExit('%d bars do not fit between the slanted sides' % n)
    bars = []
    for i, v in enumerate(path):
        x = centre + (i - (n - 1) / 2) * PITCH - BAR / 2
        top = BAND_H - (MIN_BAR + (v - lo) / (hi - lo) * (MAX_BAR - MIN_BAR))
        # over the handle's opening the tab already joins bar and line, so don't sink into the hole
        bottom = BAND_H if x < HOLE[1] and x + BAR > HOLE[0] else BAND_H + SINK
        bars.append((x, top, bottom))
    return bars


def f(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def bar_path(x, top, bottom):
    return 'M%s %s V%s H%s V%s Z' % (f(x), f(bottom), f(top), f(x + BAR), f(bottom))


def svg(bars, seed, guide):
    w, h = f(BAND_W), f(BAND_H + SINK)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">' % (w, h, w, h),
        '  <title>Bullish bar chart, top band (seed %d)</title>' % seed,
    ]
    lines.append('  <g id="bars" fill="%s">' % ORANGE)
    for i, (x, top, bottom) in enumerate(bars):
        lines.append('    <path id="bar-%02d" d="%s"/>' % (i + 1, bar_path(x, top, bottom)))
    lines.append('  </g>')
    if guide:
        tl, tr, tt, r = TAB
        bh = f(BAND_H)
        band = 'M0 0 H%s L%s %s H%s Z' % (w, f(BAND_W - SLOPE * BAND_H), bh, f(SLOPE * BAND_H))
        tab = 'M%s %s V%s A%s %s 0 0 1 %s %s H%s A%s %s 0 0 1 %s %s V%s' % (
            f(tl), bh, f(tt + r), f(r), f(r), f(tl + r), f(tt), f(tr - r), f(r), f(r), f(tr), f(tt + r), bh)
        lines += [
            '  <g id="guide" fill="none" stroke="#00A3FF" stroke-width="0.75">',
            '    <path id="band-inside" d="%s"/>' % band,
            '    <path id="handle-tab" d="%s"/>' % tab,
            '  </g>',
        ]
    lines += ['</svg>', '']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=DEFAULT_SEED)
    ap.add_argument('--out', default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    rng = random.Random(args.seed)
    for _ in range(1000000):
        path = walk(rng, BARS)
        if bullish(path):
            break
    else:
        raise SystemExit('no bullish walk found for seed %d' % args.seed)
    bars = layout(path)
    for name, guide in (('bullish-chart.svg', False), ('bullish-chart-guide.svg', True)):
        with open(os.path.join(args.out, name), 'w') as fh:
            fh.write(svg(bars, args.seed, guide))
    print('seed %d: heights %s' % (args.seed, ', '.join(f(BAND_H - top) for _, top, _ in bars)))


if __name__ == '__main__':
    main()
