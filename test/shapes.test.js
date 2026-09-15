// Палитра условных обозначений. Смысл фигуры — чтобы монтажник различил её на
// чёрно-белой распечатке в размере метки, поэтому проверка идёт не по списку
// имён, а по отпечатку: знак рисуется в настоящем размере на сетку пикселей, и
// отпечатки сравниваются так, как их видит глаз на бумаге. Холста в Node нет,
// поэтому краску кладёт тест — но по тому же описанию начинки
// (`renderInternals.shapeInternals`), по которому рисует `drawShape`:
// правила закраски записаны в сборке один раз.
import test from "node:test";
import assert from "node:assert/strict";
import { SHAPES, renderInternals } from "../src/render.js";
import { SHAPE_LEGACY, SHAPE_NAMES, SHAPE_PALETTE } from "../src/model.js";

const shapeGeometry = (...args) => renderInternals.shapeGeometry(...args);
const shapeInternals = (...args) => renderInternals.shapeInternals(...args);

// Радиус метки на распечатке — около пяти пикселей: в этом размере заказчик
// смотрит на план, а не в крупном предпросмотре.
const GLYPH_RADIUS = 5;
// Поле выборки в пикселях и число проб на пиксель: пробы мельче пикселя нужны,
// чтобы допуск сравнения можно было задать долей пикселя.
const FIELD_PX = 16;
const SUB = 3;
const GRID = FIELD_PX * SUB;
const CENTER = FIELD_PX / 2;
const GLYPH_AREA = Math.PI * GLYPH_RADIUS * GLYPH_RADIUS * SUB * SUB;
// Контур, сдвинутый меньше чем на 0,9 пикселя, читается как тот же контур:
// у шестиугольника сторона уходит внутрь круга на 0,7 пикселя, а у ромба —
// на 1,5, поэтому круг с шестиугольником сливается, а с ромбом нет.
const SILHOUETTE_TOL = 0.9 * SUB;
// Доля площади знака, на которую обязаны расходиться любые два обозначения.
const MIN_DIFFERENCE = 0.12;
// Две сплошные заливки различает только масса пятна.
const MIN_SOLID_AREA_GAP = 0.2;
const SOLID_KINDS = new Set(["fill", "half"]);

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function insidePolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function outlineDistance(point, geometry) {
  if (geometry.kind === "circle") return Math.abs(Math.hypot(point.x - geometry.cx, point.y - geometry.cy) - geometry.r);
  let best = Infinity;
  const points = geometry.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    best = Math.min(best, distanceToSegment(point, points[j], points[i]));
  }
  return best;
}

// Попадает ли точка под элемент начинки. Где и чем красить — сказано в самом
// элементе; тест только кладёт краску по этому описанию.
function coveredBy(part, point) {
  if (part.mask === "interior") return true;
  if (part.mask === "rect") {
    return (
      point.x >= part.x && point.x <= part.x + part.width && point.y >= part.y && point.y <= part.y + part.height
    );
  }
  if (part.mask === "disc") return Math.hypot(point.x - part.cx, point.y - part.cy) <= part.r;
  if (part.mask === "lines") {
    return part.segments.some(([from, to]) => distanceToSegment(point, from, to) <= part.width / 2);
  }
  return false;
}

// Отпечаток знака: единица там, где на бумаге останется краска.
// `outlineOnly` даёт силуэт без начинки — им проверяется, не совпал ли контур.
function inkOf(shape, outlineOnly = false) {
  const geometry = shapeGeometry(shape, CENTER, CENTER, GLYPH_RADIUS);
  const parts = outlineOnly ? [] : shapeInternals(geometry);
  const cells = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const point = { x: (x + 0.5) / SUB, y: (y + 0.5) / SUB };
      const inside =
        geometry.kind === "circle"
          ? Math.hypot(point.x - geometry.cx, point.y - geometry.cy) <= geometry.r
          : insidePolygon(point, geometry.points);
      let ink = outlineDistance(point, geometry) <= geometry.line / 2;
      if (!ink && inside) ink = parts.some((part) => coveredBy(part, point));
      cells.push(ink ? 1 : 0);
    }
  }
  return cells;
}

// Начинка знака: то, что видно внутри контура. Два обозначения с одинаковым
// силуэтом различает только она.
function interiorKind(shape) {
  const parts = shapeInternals(shapeGeometry(shape, CENTER, CENTER, GLYPH_RADIUS));
  return parts.length === 0 ? "empty" : parts.map((part) => part.role).join("+");
}

function area(cells) {
  return cells.filter((cell) => cell === 1).length;
}

function difference(first, second) {
  let count = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) count += 1;
  }
  return count;
}

function spread(cells) {
  const reach = Math.ceil(SILHOUETTE_TOL);
  const wide = new Array(cells.length).fill(0);
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!cells[y * GRID + x]) continue;
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          if (Math.hypot(dx, dy) > SILHOUETTE_TOL) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < GRID && nx >= 0 && nx < GRID) wide[ny * GRID + nx] = 1;
        }
      }
    }
  }
  return wide;
}

// Силуэты одинаковы, если каждый попадает в след другого, расширенный на допуск.
function sameSilhouette(first, second) {
  const wideFirst = spread(first);
  const wideSecond = spread(second);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] && !wideSecond[index]) return false;
    if (second[index] && !wideFirst[index]) return false;
  }
  return true;
}

test("палитра выросла вдвое, старые значения остались допустимыми", () => {
  assert.ok(SHAPE_PALETTE.length >= 12, "палитра должна быть примерно вдвое больше прежних семи фигур");
  assert.equal(new Set(SHAPE_NAMES).size, SHAPE_NAMES.length);
  assert.deepEqual(SHAPES, SHAPE_NAMES);
  for (const old of ["circle", "circle-cross", "square", "triangle", "star", "diamond", "hexagon"]) {
    assert.ok(SHAPE_NAMES.includes(old), "старое значение формы перестало быть допустимым: " + old);
  }
  // Снятое с палитры продолжает рисоваться — объекты с ним уже существуют.
  for (const legacy of SHAPE_LEGACY) {
    assert.ok(!SHAPE_PALETTE.includes(legacy), "снятая фигура вернулась в палитру: " + legacy);
    assert.ok(area(inkOf(legacy)) > 0, "нечем рисовать: " + legacy);
  }
});

test("каждая фигура палитры оставляет свой отпечаток в размере метки", () => {
  const prints = SHAPE_PALETTE.map((shape) => ({
    shape,
    ink: inkOf(shape),
    outline: inkOf(shape, true),
    interior: interiorKind(shape),
  }));
  for (const { shape, ink } of prints) {
    assert.ok(area(ink) > GLYPH_AREA * 0.2, "фигура почти не видна: " + shape);
  }

  const merged = [];
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      const first = prints[i];
      const second = prints[j];
      const pair = first.shape + " / " + second.shape;
      const share = difference(first.ink, second.ink) / GLYPH_AREA;
      if (share < MIN_DIFFERENCE) {
        merged.push(pair + " — расходятся на " + Math.round(share * 100) + "% знака");
        continue;
      }
      const solids = SOLID_KINDS.has(first.interior) && SOLID_KINDS.has(second.interior);
      // Сплошное пятно узнают по массе, а не по углам: два залитых знака
      // одинаковой площади на бумаге — одно и то же.
      if (solids && Math.abs(area(first.ink) - area(second.ink)) < GLYPH_AREA * MIN_SOLID_AREA_GAP) {
        merged.push(pair + " — две сплошные заливки одной площади");
        continue;
      }
      // Одинаковый силуэт разрешён только семейству: контур тот же, начинка
      // разная — и не две заливки, которые дают одно пятно.
      if (!sameSilhouette(first.outline, second.outline)) continue;
      if (first.interior === second.interior) merged.push(pair + " — один силуэт и одна начинка");
      else if (solids) merged.push(pair + " — один силуэт и две сплошные заливки");
    }
  }
  assert.deepEqual(merged, [], "в размере метки эти обозначения сливаются");
});

test("старые обозначения рисуются как раньше: заливки и засечки у них не появилось", () => {
  assert.equal(shapeGeometry("circle-cross", 0, 0, 10).cross, true);
  assert.equal(shapeGeometry("circle", 0, 0, 10).cross, false);
  assert.equal(shapeGeometry("square", 0, 0, 10).points.length, 4);
  assert.equal(shapeGeometry("hexagon", 0, 0, 10).points.length, 6);
  for (const shape of ["circle", "circle-cross", "square", "triangle", "star", "diamond", "hexagon"]) {
    assert.ok(!shapeGeometry(shape, 0, 0, 10).decor, "старая фигура обзавелась заливкой: " + shape);
  }
});

test("новые фигуры устроены так, как обещано: крест, треугольник вниз, заливки, точка", () => {
  assert.equal(shapeGeometry("square-cross", 0, 0, 10).cross, true);
  assert.equal(shapeGeometry("square-cross", 0, 0, 10).points.length, 4);

  const down = shapeGeometry("triangle-down", 0, 0, 10);
  const up = shapeGeometry("triangle", 0, 0, 10);
  assert.ok(Math.max(...down.points.map((point) => point.y)) > 9);
  assert.ok(Math.min(...up.points.map((point) => point.y)) < -9);

  assert.equal(shapeGeometry("circle-fill", 0, 0, 10).decor, "fill");
  assert.equal(shapeGeometry("square-fill", 0, 0, 10).decor, "fill");
  assert.equal(shapeGeometry("circle-dot", 0, 0, 10).decor, "dot");
  assert.equal(shapeGeometry("circle-half", 0, 0, 10).decor, "half");
  assert.equal(shapeGeometry("plus", 0, 0, 10).points.length, 12);
});
