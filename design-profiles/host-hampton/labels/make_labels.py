"""
Host Hampton price labels, drawn straight onto a label maker's own PDF template.

    python make_labels.py                       # labels.txt onto OL800.pdf
    python make_labels.py my-list.txt           # a different list
    python make_labels.py --skip 4              # half-used sheet: start at label 5
    python make_labels.py --nudge-x 0.03 --nudge-y -0.02   # printer offset, inches

Writes two files into out/:
    <list>-PRINT.pdf   the labels alone — this is what goes on the label sheet
    <list>-CHECK.pdf   the same labels on top of the template's outlines, to look at

Why a PDF and not the HTML page: a browser print adds its own margins and
"fit to page" scaling unless every box in the dialog is set just so, and then
the labels drift. A PDF printed at **Actual size** puts every point where it
says. The label positions are READ from the template PDF, not typed in, so a
different OnlineLabels/Avery template works with --template.

Look rules (same as brand.css): ivory label, inset rounded navy frame, gold
HOST HAMPTON mark, short gold rule, Playfair name and price, Montserrat small
print. Never invent a price: a blank prints $TBD, highlighted.
"""
import argparse
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF — reads the template's label outlines
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / 'fonts'
IN = 72.0

NAVY, GOLD, IVORY, MUTED, TBD = (HexColor(c) for c in ('#2F343B', '#C7A36B', '#F7F2E8', '#6b7178', '#fff3cd'))

# Playfair's default digits are old-style (the 4 and 5 drop below the line).
# The website asks for lining figures in CSS; a PDF can't, so this copy of the
# font maps 0-9 straight to Playfair's own lining glyphs (zero.lf …).
for name, file in (('Serif', 'PlayfairDisplay-Bold-LiningFigures'), ('Sans', 'Montserrat-Medium'),
                   ('SansSemi', 'Montserrat-SemiBold'), ('SansBold', 'Montserrat-Bold')):
    pdfmetrics.registerFont(TTFont(name, str(FONTS / f'{file}.ttf')))


def label_rects(template):
    """Every label on the template as (x0, y0, x1, y1) in points, top-left origin,
    in reading order. Built from the straight edges the template draws: vertical
    edges pair up into columns, horizontal edges into rows."""
    page = fitz.open(template)[0]
    xs, ys = set(), set()
    for d in page.get_drawings():
        for it in d['items']:
            if it[0] != 'l':
                continue
            a, b = it[1], it[2]
            if abs(a.x - b.x) < .01: xs.add(round(a.x, 2))
            if abs(a.y - b.y) < .01: ys.add(round(a.y, 2))
    xs, ys = sorted(xs), sorted(ys)
    if len(xs) % 2 or len(ys) % 2 or not xs or not ys:
        sys.exit(f'Could not read a label grid from {template} (x edges {xs}, y edges {ys}).')
    cols = list(zip(xs[0::2], xs[1::2]))
    rows = list(zip(ys[0::2], ys[1::2]))
    return page.rect.width, page.rect.height, [(c[0], r[0], c[1], r[1]) for r in rows for c in cols]


def format_price(raw):
    p = (raw or '').strip()
    if not p or re.fullmatch(r'\$?tbd', p, re.I):
        return None
    m = re.fullmatch(r'\$?(\d+)(?:\.(\d{1,2}))?', p)
    if not m:
        return p                      # "3 for $20" is printed as typed
    return '$' + m[1] + ('.' + m[2].ljust(2, '0') if m[2] else '')


def parse(path):
    items = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.strip().startswith('#'):
            continue
        name, price, note, qty = (line.split('|') + ['', '', '', ''])[:4]
        name = name.strip()
        if not name and not price.strip():
            continue                  # a blank name is a price-only label; blank both is nothing
        n = max(1, min(300, int(qty.strip()) if qty.strip().isdigit() else 1))
        items += [(name, format_price(price), note.strip())] * n
    return items


def tracked_width(text, font, size, track):
    return pdfmetrics.stringWidth(text, font, size) + track * (len(text) - 1)


def draw_tracked(c, text, font, size, track, cx, y):
    # Character spacing is canvas state and outlives the text object; without
    # save/restore it tracks out every name and price drawn after this.
    c.saveState()
    t = c.beginText()
    t.setFont(font, size)
    t.setCharSpace(track)
    t.setTextOrigin(cx - tracked_width(text, font, size, track) / 2, y)
    t.textLine(text)
    c.drawText(t)
    c.restoreState()


def fit(text, font, size, max_w, floor):
    """Shrink a size until the text fits on one line, down to `floor`."""
    while size > floor and pdfmetrics.stringWidth(text, font, size) > max_w:
        size -= .25
    return size


def wrap(text, font, size, max_w):
    words, lines = text.split(), ['']
    for w in words:
        trial = (lines[-1] + ' ' + w).strip()
        if pdfmetrics.stringWidth(trial, font, size) <= max_w or not lines[-1]:
            lines[-1] = trial
        else:
            lines.append(w)
    return lines


def cut_grid(page_w, page_h, cols=3, rows=7, w=2.5, h=1.5):
    """Plain letter paper you cut yourself: labels butt edge to edge, centred,
    so every cut separates two labels and there is no gutter to trim twice."""
    gx = (page_w - cols * w * IN) / 2
    gy = (page_h - rows * h * IN) / 2
    return [(gx + c * w * IN, gy + r * h * IN, gx + (c + 1) * w * IN, gy + (r + 1) * h * IN)
            for r in range(rows) for c in range(cols)]


def draw_cut_lines(c, page_w, page_h, rects):
    """Grid lines run to the paper's edge, so a trimmer blade lines up on them."""
    xs = sorted({r[0] for r in rects} | {r[2] for r in rects})
    ys = sorted({r[1] for r in rects} | {r[3] for r in rects})
    c.saveState()
    c.setStrokeColor(HexColor('#b8bcc2'))
    c.setLineWidth(.5)
    for x in xs:
        c.line(x, 0, x, page_h)
    for y in ys:
        c.line(0, page_h - y, page_w, page_h - y)
    c.restoreState()


def draw_label(c, page_h, rect, item, nudge, ivory, mark, cut=False):
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    # reportlab measures from the bottom of the page; the template from the top.
    left, bottom = x0 + nudge[0], page_h - y1 - nudge[1]
    em = min(w, h) * .085                          # one base size; everything is a multiple

    if cut:
        # The cut line IS the border: no frame, no fill, nothing to trim around.
        fx, fy, fw, fh = left, bottom, w, h
    else:
        inset = .07 * IN                           # room for a slightly off feed
        fx, fy, fw, fh = left + inset, bottom + inset, w - 2 * inset, h - 2 * inset
        c.setLineWidth(em * .12)
        c.setStrokeColor(NAVY)
        c.setFillColor(IVORY if ivory else HexColor('#ffffff'))
        c.roundRect(fx, fy, fw, fh, em * .4, stroke=1, fill=1)

    name, price, note = item
    inner = fw * .86
    price_text = price or '$TBD'

    name_size = em * 1.45
    name_lines = [name] if name else []
    if pdfmetrics.stringWidth(name, 'Serif', name_size) > inner:
        name_size = fit(name, 'Serif', name_size, inner, em * 1.15)
        if pdfmetrics.stringWidth(name, 'Serif', name_size) > inner:
            name_size = em * 1.15
            name_lines = wrap(name, 'Serif', name_size, inner)[:2]
    # With no name above it, the price gets the room.
    price_size = fit(price_text, 'Serif', em * (2.6 if name else 3.4), inner, em * 1.4)
    note_size = fit(note, 'SansSemi', em * .78, inner, em * .6) if note else 0
    mark_size, track = em * .7, em * .7 * .22

    # Stack top to bottom, then centre the whole stack in the frame.
    blocks = []                                   # (kind, height)
    if mark:
        blocks += [('mark', mark_size * .75), ('gap', em * .55), ('rule', em * .2), ('gap', em * .6)]
    for i, _ in enumerate(name_lines):
        blocks += [('name', name_size * .75)] + ([('gap', name_size * .3)] if i < len(name_lines) - 1 else [])
    blocks += [('gap', em * (.7 if name_lines else .1)), ('price', price_size * .72)]
    if note:
        blocks += [('gap', em * .65), ('note', note_size * .75)]
    total = sum(hh for _, hh in blocks)
    cx = fx + fw / 2
    y = fy + fh / 2 + total / 2                   # top of the stack
    line = 0
    for kind, hh in blocks:
        y -= hh
        if kind == 'mark':
            c.setFillColor(GOLD)
            draw_tracked(c, 'HOST HAMPTON', 'SansBold', mark_size, track, cx, y)
        elif kind == 'rule':
            c.setFillColor(GOLD)
            c.rect(cx - em * 1.8, y, em * 3.6, em * .2, stroke=0, fill=1)
        elif kind == 'name':
            c.setFillColor(NAVY)
            c.setFont('Serif', name_size)
            c.drawCentredString(cx, y, name_lines[line])
            line += 1
        elif kind == 'price':
            pw = pdfmetrics.stringWidth(price_text, 'Serif', price_size)
            if not price:                          # deliberately ugly, so it never ships
                c.setFillColor(TBD)
                c.rect(cx - pw / 2 - 2, y - price_size * .12, pw + 4, price_size * .9, stroke=0, fill=1)
                c.setFillColor(GOLD)
                c.rect(cx - pw / 2 - 2, y - price_size * .12, pw + 4, 1.2, stroke=0, fill=1)
            c.setFillColor(NAVY)
            c.setFont('Serif', price_size)
            c.drawCentredString(cx, y, price_text)
        elif kind == 'note':
            c.setFillColor(MUTED)
            c.setFont('SansSemi', note_size)
            c.drawCentredString(cx, y, note)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('list', nargs='?', default=str(HERE / 'labels.txt'))
    ap.add_argument('--template', default=str(HERE / 'OL800.pdf'))
    ap.add_argument('--skip', type=int, default=0, help='labels already used on the first sheet')
    ap.add_argument('--fill', action='store_true', help='repeat the list until the last sheet is full')
    ap.add_argument('--cut', action='store_true',
                    help='plain letter paper, 3 x 7 grid of 2.5 x 1.5 in, cut lines, no frame or fill')
    ap.add_argument('--nudge-x', type=float, default=0, help='inches; + moves everything right')
    ap.add_argument('--nudge-y', type=float, default=0, help='inches; + moves everything down')
    ap.add_argument('--white', action='store_true', help='no ivory fill')
    ap.add_argument('--no-mark', action='store_true', help='leave off HOST HAMPTON and the rule')
    a = ap.parse_args()

    if a.cut:
        page_w, page_h = 8.5 * IN, 11 * IN
        rects = cut_grid(page_w, page_h)
    else:
        page_w, page_h, rects = label_rects(a.template)
    items = parse(a.list)
    if not items:
        sys.exit(f'No labels in {a.list}.')
    skip = max(0, min(a.skip, len(rects) - 1))
    if a.fill:
        target = -(-(skip + len(items)) // len(rects)) * len(rects) - skip
        items = [items[i % len(items)] for i in range(target)]
    slots = [None] * skip + items
    nudge = (a.nudge_x * IN, a.nudge_y * IN)

    out = HERE / 'out'
    out.mkdir(exist_ok=True)
    stem = Path(a.list).stem
    print_pdf, check_pdf = out / f'{stem}-PRINT.pdf', out / f'{stem}-CHECK.pdf'

    c = canvas.Canvas(str(print_pdf), pagesize=(page_w, page_h))
    c.setTitle(f'Host Hampton price labels — {stem}')
    for start in range(0, len(slots), len(rects)):
        page = slots[start:start + len(rects)]
        if a.cut:
            draw_cut_lines(c, page_w, page_h, rects[:len(page)])
        for rect, item in zip(rects, page):
            if item:
                draw_label(c, page_h, rect, item, nudge, not a.white, not a.no_mark, cut=a.cut)
        c.showPage()
    c.save()

    if a.cut:
        check_pdf = None              # plain paper: the print file is the whole story
    else:
        # CHECK: each printed page laid over the template's own outlines.
        tpl = PdfReader(a.template).pages[0]
        w = PdfWriter()
        for pg in PdfReader(str(print_pdf)).pages:
            base = w.add_blank_page(width=page_w, height=page_h)
            base.merge_page(tpl)
            base.merge_page(pg)
        w.write(str(check_pdf))

    tbd = sum(1 for _, p, _ in items if not p)
    pages = -(-len(slots) // len(rects))
    print(f'{len(items)} labels on {pages} sheet(s), {len(rects)} per sheet.')
    if tbd:
        print(f'WARNING: {tbd} label(s) still say $TBD.')
    print(f'Print this at ACTUAL SIZE: {print_pdf}')
    if check_pdf:
        print(f'Look at this:               {check_pdf}')


if __name__ == '__main__':
    main()
