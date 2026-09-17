// Начертание линии и новые обозначения.
//
// Линейной меткой рисуют ленту, трек и условные линии. Сплошная и пунктирная
// значат разное, и значит начертание — часть условного обозначения, а не
// украшение одной метки: иначе легенда объяснить его не сможет, а две метки
// одного типа будут означать разное.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LINE_STYLES,
  SHAPE_PALETTE,
  addCategory,
  addMark,
  addScheme,
  addType,
  createProject,
  defaultTemplate,
  styleOf,
  typesInOrder,
  updateCategory,
  updateType,
} from "../src/model.js";
import { dashPattern, drawScheme, lineStylePlan, lineStyleThreads } from "../src/render.js";
import { strings } from "../src/strings.js";

test("начертание линии живёт там же, где форма: у категории с перебивкой у типа", () => {
  const project = createProject();
  const light = project.categories.find((item) => item.name === "Свет");
  const track = project.markTypes.find((item) => item.code === "ТР");

  // По умолчанию линия сплошная — как было до пунктира.
  assert.equal(styleOf(project, track.id).lineStyle, "solid");

  // Категория задаёт начертание своим типам, тип его перебивает — тем же
  // правилом, что и форма. Третьего правила в сборке нет.
  const dashedCategory = updateCategory(project, light.id, { lineStyle: "dashed" }).project;
  assert.equal(styleOf(dashedCategory, track.id).lineStyle, "dashed");
  const solidType = updateType(dashedCategory, track.id, { lineStyle: "solid" }).project;
  assert.equal(styleOf(solidType, track.id).lineStyle, "solid");

  const added = addType(project, { code: "УЛ", name: "Условная линия", categoryId: light.id, lineStyle: "dashed" });
  assert.equal(styleOf(added.project, added.type.id).lineStyle, "dashed");
  // Сплошная и пунктирная стоят первыми и на прежних местах: объекты с ними
  // уже нарисованы, а `LINE_STYLES[0]` подставляется как умолчание.
  assert.deepEqual(LINE_STYLES.slice(0, 2), ["solid", "dashed"]);
  assert.equal(new Set(LINE_STYLES).size, LINE_STYLES.length);
});

test("чужое начертание модель не берёт", () => {
  const project = createProject();
  const light = project.categories.find((item) => item.name === "Свет").id;
  // Начертание, которого нет в палитре, рисовать нечем, и молчаливая подмена
  // на сплошную означала бы линию не того смысла.
  assert.throws(() => addType(project, { code: "ШТ", name: "Штрих", categoryId: light, lineStyle: "штрих" }), {
    code: "lineStyleUnknown",
  });
  // Точка-тире, наоборот, теперь настоящая: её заказывал пользователь.
  const dashDot = addType(project, { code: "ШТ", name: "Штрих", categoryId: light, lineStyle: "dash-dot" });
  assert.equal(styleOf(dashDot.project, dashDot.type.id).lineStyle, "dash-dot");
  assert.throws(() => addCategory(project, { name: "Слаботочка", color: "#1F6FEB", shape: "circle", lineStyle: 2 }), {
    code: "lineStyleUnknown",
  });
});

test("в справочник добавлен проходной переключатель, прежние типы не тронуты", () => {
  const { markTypes } = defaultTemplate();
  const codes = markTypes.map((type) => type.code);
  // Тринадцать типов заказчика целы и идут в прежнем порядке; новый встал в
  // свою категорию, рядом с выключателями, а не в хвост списка.
  const added = ["ВП", "RJ", "ДВ", "ДО", "ДП", "ДД", "Щ", "ЩС"];
  assert.deepEqual(
    codes.filter((code) => !added.includes(code)),
    ["Т", "С", "ПК", "ТР", "П", "Л", "ПШ", "В", "ВВ", "Р", "Б", "К", "W"],
  );
  assert.equal(codes.length, 21, "в шаблоне переключатель, витая пара, четыре датчика и два щита");

  const project = createProject();
  const way = project.markTypes.find((type) => type.code === "ВП");
  assert.ok(way, "проходного переключателя нет в шаблоне");
  assert.equal(way.name, strings.types.switchWay);
  const switches = typesInOrder(project).find((group) => group.category.name === "Выключатели");
  assert.deepEqual(switches.types.map((type) => type.code), ["В", "ВВ", "ВП"]);
  // Свой значок: иначе он рисуется тем же зелёным кругом, что и остальные два.
  assert.ok(SHAPE_PALETTE.includes(styleOf(project, way.id).shape), "значок переключателя не из палитры");
  assert.notEqual(styleOf(project, way.id).shape, styleOf(project, project.markTypes.find((t) => t.code === "В").id).shape);
});

// Холста в Node нет, поэтому рисованию подставляется заглушка: она принимает
// любые вызовы и записывает узор пунктира. Это тот же приём, которым
// проверяются легенда и подсказка угла.
const drawProbe = () => {
  const target = {
    dashes: [],
    measureText: (value) => ({ width: String(value).length * 7 }),
    setLineDash: (pattern) => target.dashes.push(pattern),
  };
  return new Proxy(target, { get: (object, key) => (key in object ? object[key] : () => {}), set: () => true });
};

const drawnDashes = (project, scheme) => {
  const ctx = drawProbe();
  drawScheme(ctx, { project, scheme, view: { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 } });
  return ctx.dashes.filter((pattern) => Array.isArray(pattern) && pattern.length > 0);
};

test("пунктирный тип рисуется пунктиром, сплошной — сплошным", () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const light = made.project.categories.find((item) => item.name === "Свет").id;
  const dashed = addType(made.project, {
    code: "УЛ",
    name: "Условная линия",
    categoryId: light,
    lineStyle: "dashed",
  });
  const points = [
    { x: 0.2, y: 0.5 },
    { x: 0.8, y: 0.5 },
  ];
  const solidLine = addMark(made.project, {
    schemeId: made.scheme.id,
    typeId: made.project.markTypes.find((type) => type.code === "ТР").id,
    kind: "line",
    points,
  });
  const dashedLine = addMark(dashed.project, { schemeId: made.scheme.id, typeId: dashed.type.id, kind: "line", points });

  assert.deepEqual(drawnDashes(solidLine.project, solidLine.project.schemes[0]), [], "сплошная линия ушла в пунктир");
  const pattern = drawnDashes(dashedLine.project, dashedLine.project.schemes[0]);
  assert.equal(pattern.length, 1, "пунктирная линия нарисована сплошной");
  // Штрих и просвет заметны на бумаге и не сливаются: метка радиусом 10.
  assert.ok(pattern[0][0] >= 8 && pattern[0][1] >= 5, "узор пунктира: " + pattern[0].join("/"));
  // Узор растёт с масштабом вместе с меткой — иначе выгрузка разойдётся с экраном.
  assert.deepEqual(dashPattern(20), pattern[0].map((value) => value * 2));
});

// ——— отпечаток начертаний ————————————————————————————————————————————
//
// Начертание выбирают по изображению, и различать его должен глаз на
// чёрно-белой распечатке — там же, где различают фигуры. Поэтому проверка
// идёт не по списку имён, а по отпечатку: отрезок в толщине линии метки
// раскладывается на сетку пикселей, и отпечатки сравниваются попарно.
// Холста в Node нет, поэтому краску кладёт тест — но по тому же описанию
// (`lineStylePlan` + `lineStyleThreads`), по которому ведёт перо холст:
// правила записаны в сборке один раз.
//
// Начертание, неотличимое от соседа на бумаге, в палитру не попадает.

// Радиус метки на распечатке — около пяти пикселей, как у фигур: в этом
// размере заказчик смотрит на план.
const LINE_RADIUS = 5;
// Отрезок разумной длины: короче периода самой редкой волны сравнивать нечего.
const LINE_LENGTH = 16 * LINE_RADIUS;
const LINE_PAD = 8;
const LINE_FIELD_W = LINE_LENGTH + LINE_PAD * 2;
const LINE_FIELD_H = 26;
// Проб на пиксель: мельче пикселя нужно, чтобы допуск задавался его долей.
const LINE_SUB = 2;
const LINE_GRID_W = LINE_FIELD_W * LINE_SUB;
const LINE_GRID_H = LINE_FIELD_H * LINE_SUB;
// Шаг пера вдоль нитки: реже — и пунктир начинает крошиться на отпечатке.
const LINE_PEN_STEP = 0.25;
const LINE_PROBE = [
  { x: LINE_PAD, y: LINE_FIELD_H / 2 },
  { x: LINE_PAD + LINE_LENGTH, y: LINE_FIELD_H / 2 },
];
// Площадь сплошной линии в пробах: доля от неё — мера расхождения.
const LINE_AREA = LINE_LENGTH * Math.max(2, LINE_RADIUS * 0.5) * LINE_SUB * LINE_SUB;
// Порог взят не с потолка: на столько расходятся сплошная и пунктирная —
// пара, которая в сборке была с самого начала и которую заказчик принял.
// Ближе них — значит на бумаге одно и то же.
const LINE_MIN_DIFFERENCE = 0.3;

function linePathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

function linePointAt(points, distance) {
  let left = distance;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (left <= length || index === points.length - 1) {
      const t = length === 0 ? 0 : left / length;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
    left -= length;
  }
  return points[points.length - 1];
}

// Куски нитки, по которым перо и правда идёт: узор `setLineDash` разложен в
// промежутки по пройденному пути. Кусок нулевой длины — точка: круглый торец
// пера рисует её сам, и так задана точечная линия.
function lineDashSpans(total, dash) {
  const spans = [];
  let position = 0;
  let slot = 0;
  let on = true;
  let guard = 0;
  while (position <= total && guard < 100000) {
    guard += 1;
    const length = dash[slot % dash.length];
    if (on) spans.push([position, Math.min(position + length, total)]);
    position += length;
    slot += 1;
    on = !on;
  }
  return spans;
}

function linePaint(cells, point, radius) {
  const reach = radius * LINE_SUB;
  const cx = point.x * LINE_SUB;
  const cy = point.y * LINE_SUB;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(LINE_GRID_H - 1, Math.ceil(cy + reach)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(LINE_GRID_W - 1, Math.ceil(cx + reach)); x += 1) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= reach) cells[y * LINE_GRID_W + x] = 1;
    }
  }
}

// Отпечаток начертания: единица там, где на бумаге останется краска.
function lineInkOf(style) {
  const plan = lineStylePlan(style, LINE_RADIUS);
  const threads = lineStyleThreads(LINE_PROBE, false, plan);
  const cells = new Uint8Array(LINE_GRID_W * LINE_GRID_H);
  for (const thread of threads) {
    const total = linePathLength(thread);
    const spans = plan.dash ? lineDashSpans(total, plan.dash) : [[0, total]];
    for (const [from, to] of spans) {
      const steps = Math.max(1, Math.ceil((to - from) / LINE_PEN_STEP));
      for (let index = 0; index <= steps; index += 1) {
        linePaint(cells, linePointAt(thread, from + ((to - from) * index) / steps), plan.pen / 2);
      }
    }
  }
  return cells;
}

const lineArea = (cells) => cells.reduce((sum, cell) => sum + cell, 0);

function lineDifference(first, second) {
  let count = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) count += 1;
  }
  return count;
}

test("каждое начертание оставляет свой отпечаток в толщине линии метки", () => {
  assert.ok(LINE_STYLES.length >= 5, "начертаний меньше пяти: " + LINE_STYLES.length);
  for (const must of ["solid", "dashed", "wave", "dash-dot"]) {
    assert.ok(LINE_STYLES.includes(must), "начертание, названное пользователем, пропало: " + must);
  }

  const prints = LINE_STYLES.map((style) => ({ style, ink: lineInkOf(style) }));
  for (const { style, ink } of prints) {
    assert.ok(lineArea(ink) > LINE_AREA * 0.15, "начертание почти не видно: " + style);
  }

  const merged = [];
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      const share = lineDifference(prints[i].ink, prints[j].ink) / LINE_AREA;
      if (share < LINE_MIN_DIFFERENCE) {
        merged.push(prints[i].style + " / " + prints[j].style + " — расходятся на " + Math.round(share * 100) + "%");
      }
    }
  }
  assert.deepEqual(merged, [], "в толщине линии метки эти начертания сливаются");
});

// Волна и зигзаг — соседи по смыслу, и слить их проще всего: заказчик просил
// обе, но одинаковая амплитуда с периодом дала бы одну мохнатую линию.
test("волна и зигзаг разведены амплитудой и периодом, а не только названием", () => {
  const wave = lineStylePlan("wave", LINE_RADIUS).wave;
  const zigzag = lineStylePlan("zigzag", LINE_RADIUS).wave;
  assert.equal(wave.kind, "sine");
  assert.equal(zigzag.kind, "zigzag");
  assert.ok(wave.amplitude > zigzag.amplitude * 1.8, "волна не выше зигзага: " + wave.amplitude + " / " + zigzag.amplitude);
  assert.ok(wave.period > zigzag.period * 2, "волна не реже зигзага: " + wave.period + " / " + zigzag.period);
  const share = lineDifference(lineInkOf("wave"), lineInkOf("zigzag")) / LINE_AREA;
  assert.ok(share > 1, "волна и зигзаг расходятся всего на " + Math.round(share * 100) + "%");
});

// Начертание растёт вместе с меткой — иначе выгрузка разойдётся с экраном.
// Пунктир при этом остался буквально прежним: объекты с ним уже нарисованы.
test("узор растёт с меткой, а прежний пунктир не сдвинулся ни на волос", () => {
  assert.deepEqual(lineStylePlan("dashed", 10).dash, dashPattern(10));
  assert.deepEqual(lineStylePlan("dashed", 40).dash, dashPattern(40));
  assert.equal(lineStylePlan("solid", 10).dash, null);
  const small = lineStylePlan("wave", 5).wave;
  const big = lineStylePlan("wave", 10).wave;
  assert.equal(big.amplitude, small.amplitude * 2);
  assert.equal(big.period, small.period * 2);
});

// Название начертания видит человек: оно стоит в подсказке клетки, в строке
// справочника и в выгружаемой таблице типов. Новое начертание без строки
// показало бы ключ вроде «dash-dot-dot».
test("у каждого начертания есть человеческое название", () => {
  const missing = LINE_STYLES.filter((style) => typeof strings.lineStyles[style] !== "string");
  assert.deepEqual(missing, [], "начертание без названия в словаре");
  const service = ["inherit", "title", "hint"];
  const dead = Object.keys(strings.lineStyles).filter((key) => !service.includes(key) && !LINE_STYLES.includes(key));
  assert.deepEqual(dead, [], "название есть, а такого начертания нет");
});

// Замкнутый контур и ломаная — те же нитки: волна ложится по пути, а двойная
// линия расходится на две по обе стороны от него.
test("нитки начертания считаются по пути, а не по прямой", () => {
  const corner = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
  ];
  const solid = lineStyleThreads(corner, false, lineStylePlan("solid", 5));
  assert.deepEqual(solid, [corner], "сплошная линия ведётся по самим вершинам");

  const double = lineStyleThreads(corner, false, lineStylePlan("double", 5));
  assert.equal(double.length, 2, "двойная линия — две нитки");
  assert.equal(double[0].length, corner.length);
  // Нитки расходятся по обе стороны пути и не сливаются.
  assert.ok(Math.hypot(double[0][0].x - double[1][0].x, double[0][0].y - double[1][0].y) > 4);

  const waved = lineStyleThreads(corner, false, lineStylePlan("wave", 5));
  assert.ok(waved[0].length > corner.length * 4, "волна не разложена на пробы");
  // Волна начинается и кончается на самом пути: период подогнан под длину.
  assert.ok(Math.hypot(waved[0][0].x - corner[0].x, waved[0][0].y - corner[0].y) < 0.001);
  const last = waved[0][waved[0].length - 1];
  assert.ok(Math.hypot(last.x - corner[2].x, last.y - corner[2].y) < 0.001);
});
