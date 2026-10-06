#!/usr/bin/env python3
"""
Bullish charts for the top and bottom bands of the card back.

Writes eight vector files next to this script, every combination of
    bars | line      bar chart, or a line chart through the same values
    5 | 9           five points spaced like the reference card's pennant flags,
                     or nine: the same five with one more between each pair
    top | bottom     the bottom one is the top one turned 180 degrees, like the
                     rest of the card back
e.g. bars-5-top.svg, line-9-bottom.svg. guides/ has the same files plus a blue
outline of the band and the briefcase-handle tab, for lining them up; delete
the "guide" group once placed.

Every number is in card-image px, the scale where the card's outline stroke is
5 px and the stick of the corner candles' wicks is 10 px wide. That is the bar
width and the line weight. Corners are sharp (miter joins, butt ends).

Each canvas is its band's inside box plus 2.5 px on the side the bars stand
on, where they run into the card's orange so no seam shows (except over the
handle's opening; the tab already closes that gap). Top files: the canvas's top
edge and width match the band's inside top edge. Bottom files: the canvas's
bottom edge and width match the bottom band's inside bottom edge. The bottom
band measured 16 px wider than the top one, so its canvas is wider; the chart
itself is identical.

Five points: 73.4 px apart (the flags sit 18.2% of their band's bottom width
apart), centred on the handle tab, the tallest reaching the flags' height
(43 px, 77% of the band); the line's top edge stops there too and its bottom
edge stays 5 px off the band edge. The heights are a random walk filtered to
read as growth: lowest first, highest last, one shallow pullback in between.
The nine point version keeps those five and adds a value part way between each
pair.

    python3 make_chart.py              # the committed charts
    python3 make_chart.py --seed 7     # a different random pattern
"""

import argparse
import math
import os
import random

ORANGE = '#FF6F00'

# ------------------------------------------------- the bands (measured off the card)
BAND_H = 56.0          # inside height, both bands
SLOPE = 0.7679         # each slanted side moves in this much per 1 px of height
TAB_DEPTH = 4.82       # how far the handle tab pokes into the band
TAB_R = 4.0            # its corner rounding (guide only)
HOLE = 16.0            # half width of the handle's cream opening
TOP_W = 489.69         # top band, inside width along its wide (top) edge
TOP_TAB = (224.85, 265.31)
BOTTOM_W = 506.18      # bottom band, inside width along its wide (bottom) edge
BOTTOM_TAB = (233.84, 274.88)

# ------------------------------------------------- the chart
WEIGHT = 10.0          # bar width and line weight = the stick of the corner wicks
PITCH = 73.4           # five-point spacing, = the flags' spacing scaled to this band
MAX_H = 43.0           # = the flags' height; nothing goes higher
MIN_H = 15.0           # shortest bar
LINE_GAP = 5.0         # the line's lowest edge stays this far off the band edge
SINK = 2.5             # how far bars run past the band edge into the card's orange

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


def values(seed):
    """(five, nine): the walk, and the walk with a value part way between each pair."""
    rng = random.Random(seed)
    for _ in range(1000000):
        five = walk(rng, 5)
        if bullish(five):
            break
    else:
        raise SystemExit('no bullish walk found for seed %d' % seed)
    nine = [five[0]]
    for a, b in zip(five, five[1:]):
        nine += [a + rng.uniform(0.3, 0.7) * (b - a), b]
    return five, nine


def scale(vals, low, top):
    """Values -> heights above the band edge, lowest at low, highest at top."""
    lo, hi = min(vals), max(vals)
    return [low + (v - lo) / (hi - lo) * (top - low) for v in vals]


def xs(n):
    """Point centres in the top band, centred on the tab, the outer two at the flags' outer poles."""
    centre = sum(TOP_TAB) / 2
    pitch = PITCH * 4 / (n - 1)
    return [centre + (i - (n - 1) / 2) * pitch for i in range(n)]


# Shapes are built in the top band's canvas (base line at y = BAND_H, up = smaller y)
# as lists of points, then turned 180 degrees for the bottom band.

def bar_shapes(vals):
    shapes = []
    centre = sum(TOP_TAB) / 2
    for x, h in zip(xs(len(vals)), scale(vals, MIN_H, MAX_H)):
        l, r = x - WEIGHT / 2, x + WEIGHT / 2
        over_hole = l < centre + HOLE and r > centre - HOLE
        bottom = BAND_H if over_hole else BAND_H + SINK
        shapes.append([(l, bottom), (l, BAND_H - h), (r, BAND_H - h), (r, bottom)])
    return shapes


def line_shape(vals):
    """The line's outline as one polygon: miter joins, butt ends, WEIGHT thick."""
    half = WEIGHT / 2
    pts = [(x, BAND_H - h) for x, h in zip(xs(len(vals)), scale(vals, LINE_GAP + half, MAX_H - half))]
    normals = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        normals.append(((y1 - y0) / d, -(x1 - x0) / d))   # points up and to the left

    def side(s):
        out = [(pts[0][0] + s * normals[0][0], pts[0][1] + s * normals[0][1])]
        for i in range(1, len(pts) - 1):
            (ax, ay), (bx, by) = normals[i - 1], normals[i]
            k = s / (1 + ax * bx + ay * by)
            out.append((pts[i][0] + k * (ax + bx), pts[i][1] + k * (ay + by)))
        out.append((pts[-1][0] + s * normals[-1][0], pts[-1][1] + s * normals[-1][1]))
        return out

    poly = side(half) + side(-half)[::-1]
    ys = [BAND_H - y for _, y in poly]
    assert max(ys) <= MAX_H + 0.01 and min(ys) >= LINE_GAP - 0.01, 'line leaves its range'
    return [poly]


def to_bottom(shapes):
    """Turn shapes 180 degrees about the tab centre into the bottom band's canvas."""
    cx = sum(TOP_TAB) / 2 + sum(BOTTOM_TAB) / 2
    return [[(cx - x, BAND_H + SINK - y) for x, y in s] for s in shapes]


def f(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def path_d(points):
    return 'M' + ' L'.join('%s %s' % (f(x), f(y)) for x, y in points) + ' Z'


def guide(band, w):
    """Outline of the band's inside and the handle tab, in the band's canvas."""
    inset, r = SLOPE * BAND_H, TAB_R
    if band == 'top':
        tl, tr = TOP_TAB
        edge, tip = BAND_H, BAND_H - TAB_DEPTH
        outline = [(0, 0), (w, 0), (w - inset, edge), (inset, edge)]
        sweep = 1
    else:
        tl, tr = BOTTOM_TAB
        edge, tip = SINK, SINK + TAB_DEPTH
        outline = [(inset, edge), (w - inset, edge), (w, edge + BAND_H), (0, edge + BAND_H)]
        sweep = 0
        r = min(r, TAB_DEPTH)
    step = r if band == 'top' else -r
    tab = 'M%s %s V%s A%s %s 0 0 %d %s %s H%s A%s %s 0 0 %d %s %s V%s' % (
        f(tl), f(edge), f(tip + step), f(r), f(r), sweep, f(tl + r), f(tip),
        f(tr - r), f(r), f(r), sweep, f(tr), f(tip + step), f(edge))
    return [
        '  <g id="guide" fill="none" stroke="#00A3FF" stroke-width="0.75">',
        '    <path id="band-inside" d="%s"/>' % path_d(outline),
        '    <path id="handle-tab" d="%s"/>' % tab,
        '  </g>',
    ]


def svg(kind, n, band, shapes, seed, with_guide):
    w = TOP_W if band == 'top' else BOTTOM_W
    h = BAND_H + SINK
    names = ['bar-%02d' % (i + 1) for i in range(len(shapes))] if kind == 'bars' else ['line']
    if band == 'bottom':
        shapes = shapes[::-1]                  # number the bars left to right as they sit in the file
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">'
        % (f(w), f(h), f(w), f(h)),
        '  <title>Bullish %s chart, %d points, %s band (seed %d)</title>'
        % ('bar' if kind == 'bars' else 'line', n, band, seed),
        '  <g id="chart" fill="%s">' % ORANGE,
    ]
    for name, s in zip(names, shapes):
        lines.append('    <path id="%s" d="%s"/>' % (name, path_d(s)))
    lines.append('  </g>')
    if with_guide:
        lines += guide(band, w)
    lines += ['</svg>', '']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=DEFAULT_SEED)
    ap.add_argument('--out', default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    five, nine = values(args.seed)
    os.makedirs(os.path.join(args.out, 'guides'), exist_ok=True)
    for kind, build in (('bars', bar_shapes), ('line', line_shape)):
        for n, vals in ((5, five), (9, nine)):
            top = build(vals)
            for band, shapes in (('top', top), ('bottom', to_bottom(top))):
                name = '%s-%d-%s' % (kind, n, band)
                for path, with_guide in ((name + '.svg', False), ('guides/%s-guide.svg' % name, True)):
                    with open(os.path.join(args.out, path), 'w') as fh:
                        fh.write(svg(kind, n, band, shapes, args.seed, with_guide))
    print('seed %d: bar heights %s' % (args.seed, ', '.join(f(h) for h in scale(nine, MIN_H, MAX_H))))


if __name__ == '__main__':
    main()
