#!/usr/bin/env python3
# Дорисовывает в «GOST type A» знаки, которых в нём нет, и чинит два,
# которые в нём неверны. Знаки строятся из размеров самого шрифта —
# штриха дефиса и кольца буквы «О», — поэтому начертание остаётся его
# собственным, а не заимствованным у другого шрифта.
#
# Что чинится: коды 0xC0-0xFF в этом шрифте отданы кириллице по CP1251,
# поэтому «×» рисовался как «Ч», а «Ø» как «Ш». Кириллические коды букв
# при этом не трогаются — «Ч» и «Ш» остаются на своих местах.
import math, sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import RecordingPen

K = 0.5523  # вынос контрольной точки для окружности кубическими кривыми
SUPER_SCALE = 0.62  # доля от цифры у надстрочной степени

def contour_area(points):
    s = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]; x2, y2 = points[(i + 1) % len(points)]
        s += x1 * y2 - x2 * y1
    return s / 2

def bar(pen, x1, y1, x2, y2, width, clockwise):
    """Полоса толщиной width вдоль отрезка — ею рисуются тире и перечёркивания."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * width / 2, dx / length * width / 2
    pts = [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)]
    if (contour_area(pts) > 0) != (not clockwise):
        pts.reverse()
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()

def circle(pen, cx, cy, radius, counter):
    """Окружность кубическими дугами. counter — против часовой стрелки.
    Направление обхода решает, зальётся контур или вычтется из внешнего."""
    step = math.pi / 2 * (1 if counter else -1)
    start = (cx + radius, cy)
    pen.moveTo(start)
    for i in range(4):
        a0, a1 = i * step, (i + 1) * step
        p0 = (cx + radius * math.cos(a0), cy + radius * math.sin(a0))
        p1 = (cx + radius * math.cos(a1), cy + radius * math.sin(a1))
        t0 = (-math.sin(a0), math.cos(a0)) if counter else (math.sin(a0), -math.cos(a0))
        t1 = (-math.sin(a1), math.cos(a1)) if counter else (math.sin(a1), -math.cos(a1))
        c0 = (p0[0] + K * radius * t0[0], p0[1] + K * radius * t0[1])
        c1 = (p1[0] - K * radius * t1[0], p1[1] - K * radius * t1[1])
        pen.curveTo(c0, c1, p1 if i < 3 else start)
    pen.closePath()

def ring(pen, cx, cy, outer, stroke, outer_clockwise):
    """Кольцо — им рисуется знак градуса."""
    circle(pen, cx, cy, outer, not outer_clockwise)
    circle(pen, cx, cy, outer - stroke, outer_clockwise)

def main(src, out):
    font = TTFont(src)
    cmap = font.getBestCmap()
    glyphs = font["glyf"]
    hmtx = font["hmtx"]
    hyphen = glyphs[cmap[ord("-")]]
    stroke = hyphen.yMax - hyphen.yMin          # 100 — толщина штриха
    middle = (hyphen.yMax + hyphen.yMin) / 2    # 500 — высота середины тире
    cap = glyphs[cmap[ord("0")]].yMax           # 1400 — высота заглавной
    o_name = cmap[ord("О")]                     # кольцо буквы «О»
    o_glyph = glyphs[o_name]
    o_width = hmtx[o_name][0]

    # направление внешнего контура «О» — чтобы перечёркивание заливалось,
    # а не вычиталось по правилу ненулевого числа оборотов
    coords, ends = o_glyph.getCoordinates(glyphs)[0], o_glyph.endPtsOfContours
    outer = list(coords[: ends[0] + 1])
    o_clockwise = contour_area(outer) < 0

    added = {}

    def put(name, code, width, draw):
        pen = TTGlyphPen(None)
        draw(Cu2QuPen(pen, max_err=1.0))
        glyph = pen.glyph()
        glyph.recalcBounds(glyphs)
        glyphs.glyphs[name] = glyph
        hmtx.metrics[name] = (width, glyph.xMin if glyph.numberOfContours else 0)
        added[code] = name

    # тире: та же толщина и высота, что у дефиса, разной длины
    put("endash", 0x2013, 900, lambda p: bar(p, 50, middle, 850, middle, stroke, True))
    put("emdash", 0x2014, 1250, lambda p: bar(p, 50, middle, 1200, middle, stroke, True))
    # градус: кольцо под верхней линией заглавных
    put("degree", 0x00B0, 560, lambda p: ring(p, 280, cap - 230, 230, stroke, o_clockwise))
    # умножение: косой крест по середине высоты цифры
    def cross(p):
        cx, cy, r = 450, cap / 2, 260
        bar(p, cx - r, cy - r, cx + r, cy + r, stroke, True)
        bar(p, cx - r, cy + r, cx + r, cy - r, stroke, True)
    put("multiply.sign", 0x00D7, 900, cross)
    # надстрочные степени: цифра шрифта, уменьшенная и поднятая под верх
    # заглавной. Нужны для сечения кабеля «мм²» и объёма воздуха «м³» —
    # в исходном шрифте эти коды вели на украинские «І» и «і» (CP1251).
    def superscript(digit):
        name = cmap[ord(digit)]
        glyph = glyphs[name]
        def draw(pen):
            rec = RecordingPen()
            glyph.draw(rec, glyphs)
            rec.replay(TransformPen(pen, (SUPER_SCALE, 0, 0, SUPER_SCALE, 0, cap - cap * SUPER_SCALE)))
        return draw

    for digit, code in (("2", 0x00B2), ("3", 0x00B3)):
        name = cmap[ord(digit)]
        put(f"uni00B{digit}", code, round(hmtx[name][0] * SUPER_SCALE), superscript(digit))

    # диаметр и пустое множество: кольцо «О» с перечёркиванием
    def slashed(p):
        rec = RecordingPen()
        o_glyph.draw(rec, glyphs)
        rec.replay(p)
        bar(p, 40, -70, o_glyph.xMax + 60, cap + 70, stroke, o_clockwise)
    for name, code in (("Oslash.sign", 0x00D8), ("uni2300", 0x2300), ("emptyset", 0x2205)):
        put(name, code, o_width, slashed)

    order = list(font.getGlyphOrder())
    for name in added.values():
        if name not in order:
            order.append(name)
    font.setGlyphOrder(order)
    glyphs.glyphOrder = order
    font["maxp"].numGlyphs = len(order)
    for sub in font["cmap"].tables:
        if sub.isUnicode():
            for code, name in added.items():
                sub.cmap[code] = name
    if "hdmx" in font:
        del font["hdmx"]
    font.save(out)
    print(f"штрих {stroke}, середина тире {middle}, высота заглавной {cap}")
    for code, name in added.items():
        print(f"  {chr(code)} ({code:#06x}) → {name}")

if __name__ == "__main__":
    main(*sys.argv[1:3])
