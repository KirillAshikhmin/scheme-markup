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
import { SHAPE_LEGACY, SHAPE_NAMES, SHAPE_PALETTE, defaultTemplate } from "../src/model.js";
import { strings } from "../src/strings.js";

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

// Семь типов света сидят в одной категории и в одном синем цвете: на бумаге их
// различает только форма. Круг с крестом, закрашенный круг и круг с точкой —
// родня, и в размере метки они ближе всего друг к другу, поэтому проверка идёт
// не по списку имён, а тем же отпечатком.
test("семь типов света расходятся на бумаге, а не только по букве", () => {
  const light = defaultTemplate().markTypes.filter((type) =>
    ["Т", "С", "ПК", "ТР", "П", "Л", "ПШ"].includes(type.code),
  );
  assert.equal(light.length, 7, "типы света потерялись из шаблона");

  const shapes = light.map((type) => type.shape);
  assert.equal(new Set(shapes).size, 7, "два типа света рисуются одной формой: " + shapes.join(", "));
  for (const shape of shapes) {
    assert.ok(SHAPE_PALETTE.includes(shape), "форма типа света не из палитры: " + shape);
  }

  const prints = light.map((type) => ({ code: type.code, ink: inkOf(type.shape) }));
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      const share = difference(prints[i].ink, prints[j].ink) / GLYPH_AREA;
      assert.ok(
        share >= MIN_DIFFERENCE,
        prints[i].code + " и " + prints[j].code + " на бумаге расходятся на " + Math.round(share * 100) + "% знака",
      );
    }
  }
});

// Название фигуры видит человек: оно стоит в выборе обозначения и в справочнике.
// Новая фигура без строки показывала бы ключ вроде «square-bolt» — проверка
// держит палитру и словарь вместе.
test("у каждого обозначения есть человеческое название", () => {
  const missing = SHAPE_NAMES.filter((shape) => typeof strings.shapes[shape] !== "string");
  assert.deepEqual(missing, [], "обозначение без названия в словаре");
  const dead = Object.keys(strings.shapes).filter((key) => key !== "inherit" && !SHAPE_NAMES.includes(key));
  assert.deepEqual(dead, [], "название есть, а такой фигуры нет");
});

// Название описывает саму фигуру, а не то, чем её принято помечать. Заказчик:
// «убери применение в скобках, просто пусть будет круг с кольцом без уточнения
// что это датчик». Приписка вроде «(потолочный датчик: дым, движение)» сужала
// фигуру до одного применения — а круг с кольцом ставят и на датчик дыма, и на
// что угодно ещё. Раз пояснений нет, название обязано различать фигуры само:
// два одинаковых названия в сетке выбора не развести ничем.
test("название фигуры описывает фигуру: ни скобок, ни тёзок", () => {
  const named = SHAPE_NAMES.map((shape) => ({ shape, name: strings.shapes[shape] }));
  const withHint = named.filter((item) => /[()]/.test(item.name));
  assert.deepEqual(withHint.map((item) => item.shape), [], "в названии фигуры осталось применение в скобках");

  const twins = [];
  const seen = new Map();
  for (const { shape, name } of named) {
    if (seen.has(name)) twins.push(seen.get(name) + " и " + shape + " — «" + name + "»");
    else seen.set(name, shape);
  }
  assert.deepEqual(twins, [], "две фигуры зовутся одинаково");
});

// Датчики сидят в одной категории и в одном цвете — на чёрно-белой распечатке
// их различает только форма. Один из них берёт форму категории, остальные свои;
// проверка считает форму так же, как холст, и гоняет её через тот же отпечаток.
test("четыре датчика расходятся на бумаге, а не только по букве", () => {
  const { categories, markTypes } = defaultTemplate();
  const sensors = categories.find((category) => category.name === "Датчики");
  assert.ok(sensors, "категории датчиков нет в шаблоне");
  const types = markTypes.filter((type) => type.categoryId === sensors.id);
  assert.deepEqual(types.map((type) => type.code), ["ДВ", "ДО", "ДП", "ДД"]);

  const shapes = types.map((type) => type.shape || sensors.shape);
  assert.equal(new Set(shapes).size, types.length, "два датчика рисуются одной формой: " + shapes.join(", "));
  const prints = types.map((type, index) => ({ code: type.code, ink: inkOf(shapes[index]) }));
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      const share = difference(prints[i].ink, prints[j].ink) / GLYPH_AREA;
      assert.ok(
        share >= MIN_DIFFERENCE,
        prints[i].code + " и " + prints[j].code + " расходятся на " + Math.round(share * 100) + "% знака",
      );
    }
  }
});

// Внутри категории цвет общий, и на чёрно-белой распечатке типы различает
// только форма. Проверка идёт по всему шаблону сразу, а не по списку кодов:
// заказчик просил «значки разведи», и новая категория или новый тип обязаны
// приезжать уже разведёнными, без правки теста.
test("в каждой категории шаблона типы расходятся на бумаге", () => {
  const { categories, markTypes } = defaultTemplate();
  const merged = [];
  for (const category of categories) {
    const types = markTypes.filter((type) => type.categoryId === category.id);
    assert.ok(types.length > 0, "категория без типов: " + category.name);
    // Форма считается так же, как её считает холст: своя, иначе категорийная.
    const prints = types.map((type) => ({
      code: type.code,
      shape: type.shape || category.shape,
      ink: inkOf(type.shape || category.shape),
    }));
    for (const print of prints) {
      assert.ok(SHAPE_PALETTE.includes(print.shape), "форма не из палитры: " + print.code + " — " + print.shape);
    }
    for (let i = 0; i < prints.length; i += 1) {
      for (let j = i + 1; j < prints.length; j += 1) {
        const share = difference(prints[i].ink, prints[j].ink) / GLYPH_AREA;
        if (share < MIN_DIFFERENCE) {
          merged.push(
            category.name + ": " + prints[i].code + " и " + prints[j].code +
              " расходятся на " + Math.round(share * 100) + "% знака",
          );
        }
      }
    }
  }
  assert.deepEqual(merged, [], "в размере метки эти типы сливаются");
});

// Выключатели, розетка и два климатических прибора — то, что заказчик назвал
// поимённо: «значки разведи», а потом и сами значки. Формы пришпилены, потому
// что выбраны по виду устройства (пустой квадрат, квадрат с чертой и с двумя
// чертами — одна, две и три клавиши; круг с двумя отверстиями — евророзетка;
// поток воздуха и настенный блок), а не по свободному месту в палитре.
test("выключатели, розетка, климат и щит нарисованы каждый своим знаком", () => {
  const { categories, markTypes } = defaultTemplate();
  const shapeOf = (code) => {
    const type = markTypes.find((item) => item.code === code);
    const category = categories.find((item) => item.id === type.categoryId);
    return type.shape || category.shape;
  };
  assert.deepEqual(
    ["В", "ВВ", "ВВВ", "ВП"].map(shapeOf),
    ["square", "square-bar", "square-bar-two", "square-chevron"],
  );
  // Розетка своей формы не имеет: в своей категории она одна и берёт форму
  // категории — тот самый круг с двумя отверстиями.
  assert.equal(shapeOf("Р"), "circle-socket");
  assert.equal(markTypes.find((item) => item.code === "Р").shape, null);
  assert.deepEqual(["Б", "К"].map(shapeOf), ["triangle", "square-wave"]);
  assert.deepEqual(["Щ", "ЩС"].map(shapeOf), ["square-bolt", "square-cross"]);
  // Щит — узел питания, и знак у него силовой: молния в квадрате.
  const panel = categories.find((category) => category.name === "Щит");
  assert.ok(panel, "категории щита нет в шаблоне");
  assert.equal(panel.shape, "square-bolt");
});

// Цвет разводит категории только на экране: на чёрно-белой распечатке два
// точечных типа с одним знаком различает лишь код рядом. Так и вышло у «ЛВ»
// (лента вертикальная, свет) с «ДВ» (датчик движения) — обоим достался
// треугольник с точкой, и заказчик попросил развести. Проверка идёт по всему
// шаблону сразу, через категории: новый точечный тип обязан приезжать со
// своим знаком. Линейные типы сюда не входят — их обозначение не форма, а
// начертание, и разводит их `test/lineStyle.test.js`.
test("точечные типы шаблона не повторяют знак друг за другом", () => {
  const { categories, markTypes } = defaultTemplate();
  const points = markTypes
    .filter((type) => (type.kind || "point") === "point")
    .map((type) => ({
      code: type.code,
      shape: type.shape || categories.find((category) => category.id === type.categoryId).shape,
    }));
  assert.ok(points.length >= 20, "точечные типы потерялись из шаблона");

  const twins = [];
  const seen = new Map();
  for (const { code, shape } of points) {
    if (seen.has(shape)) twins.push(seen.get(shape) + " и " + code + " — «" + strings.shapes[shape] + "»");
    else seen.set(shape, code);
  }
  assert.deepEqual(twins, [], "два точечных типа шаблона рисуются одним знаком");

  // Знак не только свой, но и различимый в размере метки — тем же отпечатком.
  const merged = [];
  const prints = points.map((item) => ({ code: item.code, ink: inkOf(item.shape) }));
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      const share = difference(prints[i].ink, prints[j].ink) / GLYPH_AREA;
      if (share < MIN_DIFFERENCE) {
        merged.push(prints[i].code + " и " + prints[j].code + " — " + Math.round(share * 100) + "% знака");
      }
    }
  }
  assert.deepEqual(merged, [], "в размере метки эти типы сливаются");
});
