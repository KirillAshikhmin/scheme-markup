// Шов холста: геометрия фигур и попадание по метке — чистые функции без DOM.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SHAPES,
  fitView,
  hitHandle,
  hitTest,
  drawLegend,
  labelBox,
  labelLayout,
  labelLead,
  labelOffsetOf,
  planToScreen,
  renderInternals,
  screenToPlan,
  visibleMarks,
} from "../src/render.js";
import {
  SHAPE_LEGACY,
  SHAPE_PALETTE,
  createProject,
  addScheme,
  addMark,
  addToGroup,
  addType,
  updateMark,
  labelOf,
  typesInOrder,
} from "../src/model.js";

const shapeGeometry = (...args) => renderInternals.shapeGeometry(...args);
const handlePositions = (...args) => renderInternals.handlePositions(...args);

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message + `: ${actual} ≈ ${expected}`);

// Различимость фигур проверяет test/shapes.test.js; здесь — что холст берёт
// список у модели и что прежние обозначения остались допустимыми.
test("фигуры холст берёт у модели, старые обозначения из списка не пропали", () => {
  assert.deepEqual(SHAPES, [...SHAPE_PALETTE, ...SHAPE_LEGACY]);
  for (const shape of ["circle", "circle-cross", "square", "triangle", "star", "diamond", "hexagon"]) {
    assert.ok(SHAPES.includes(shape), "обозначение пропало из списка: " + shape);
  }
});

test("круг — это круг, у круга с крестом стоит признак креста", () => {
  const circle = shapeGeometry("circle", 100, 50, 10);
  assert.equal(circle.kind, "circle");
  assert.equal(circle.cx, 100);
  assert.equal(circle.cy, 50);
  assert.equal(circle.r, 10);
  assert.equal(circle.cross, false);
  assert.equal(shapeGeometry("circle-cross", 0, 0, 10).cross, true);
});

test("квадрат вписан в окружность: полусторона — радиус делить на корень из двух", () => {
  const half = 10 / Math.SQRT2; // 7.0710678…
  const square = shapeGeometry("square", 100, 50, 10);
  assert.equal(square.kind, "polygon");
  assert.equal(square.points.length, 4);
  near(square.points[0].x, 100 - half, "левый верхний x");
  near(square.points[0].y, 50 - half, "левый верхний y");
  near(square.points[2].x, 100 + half, "правый нижний x");
  near(square.points[2].y, 50 + half, "правый нижний y");
});

test("треугольник стоит вершиной вверх", () => {
  const triangle = shapeGeometry("triangle", 0, 0, 12);
  assert.equal(triangle.points.length, 3);
  near(triangle.points[0].x, 0, "вершина x");
  near(triangle.points[0].y, -12, "вершина y");
  // Основание — две точки на одной высоте.
  near(triangle.points[1].y, triangle.points[2].y, "основание горизонтально");
});

test("ромб — четыре вершины по осям, шестиугольник — шесть", () => {
  const diamond = shapeGeometry("diamond", 0, 0, 10);
  assert.equal(diamond.points.length, 4);
  near(diamond.points[0].y, -10, "верхняя вершина ромба");
  near(diamond.points[1].x, 10, "правая вершина ромба");
  assert.equal(shapeGeometry("hexagon", 0, 0, 10).points.length, 6);
});

test("звезда — десять вершин, через одну ближе к центру", () => {
  const star = shapeGeometry("star", 0, 0, 10);
  assert.equal(star.points.length, 10);
  const radius = (point) => Math.hypot(point.x, point.y);
  near(radius(star.points[0]), 10, "внешний луч");
  assert.ok(radius(star.points[1]) < 10 * 0.6, "внутренняя вершина ближе к центру");
});

test("неизвестная форма рисуется кругом, а не падает", () => {
  assert.equal(shapeGeometry("ellipse", 0, 0, 10).kind, "circle");
});

// ——— попадание по метке ———————————————————————————————————————————————

const world = () => {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 500 });
  project = scheme.project;
  const type = project.markTypes.find((item) => item.code === "Р");
  return { project, schemeId: scheme.scheme.id, typeId: type.id };
};

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

test("клик по метке попадает в неё, мимо — ни во что", () => {
  const base = world();
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const scheme = added.project.schemes[0];
  // Доли 0,5 на плане 1000×500 — это пиксели 500 и 250.
  const hit = hitTest(added.project, scheme, { x: 500, y: 250 }, viewOf());
  assert.equal(hit.markId, added.mark.id);
  assert.equal(hit.part, "mark");
  assert.equal(hitTest(added.project, scheme, { x: 300, y: 250 }, viewOf()), null);
});

test("попадание считается в экранных пикселях: масштаб и сдвиг учитываются", () => {
  const base = world();
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const scheme = added.project.schemes[0];
  const view = viewOf({ zoom: 2, offsetX: 100, offsetY: 40 });
  // 100 + 0,5 × 1000 × 2 = 1100; 40 + 0,5 × 500 × 2 = 540.
  assert.equal(hitTest(added.project, scheme, { x: 1100, y: 540 }, view).part, "mark");
  assert.equal(hitTest(added.project, scheme, { x: 500, y: 250 }, view), null);
});

test("поздняя метка лежит выше ранней", () => {
  const base = world();
  const first = addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.5, y: 0.5 }] });
  const second = addMark(first.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.5, y: 0.5 }] });
  const scheme = second.project.schemes[0];
  assert.equal(hitTest(second.project, scheme, { x: 500, y: 250 }, viewOf()).markId, second.mark.id);
});

test("подпись ловится отдельно от метки", () => {
  const base = world();
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const moved = updateMark(added.project, added.mark.id, { labelOffset: { dx: 60, dy: -40 } });
  const scheme = moved.project.schemes[0];
  const hit = hitTest(moved.project, scheme, { x: 565, y: 210 }, viewOf());
  assert.equal(hit.part, "label");
  assert.equal(hit.markId, added.mark.id);
});

test("скрытая фильтром метка не кликается", () => {
  const base = world();
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const scheme = added.project.schemes[0];
  const filter = { typeIds: [] };
  assert.equal(hitTest(added.project, scheme, { x: 500, y: 250 }, viewOf(), filter), null);
  assert.equal(visibleMarks(added.project, scheme, filter).length, 0);
  assert.equal(visibleMarks(added.project, scheme, null).length, 1);
});

test("по ломаной попадает и вершина, и сегмент между вершинами", () => {
  const base = world();
  const type = base.project.markTypes.find((item) => item.code === "Л");
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: type.id,
    kind: "line",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
    ],
  });
  const scheme = added.project.schemes[0];
  // Вершины — пиксели (200, 100) и (800, 100); середина сегмента — (500, 100).
  assert.equal(hitTest(added.project, scheme, { x: 200, y: 100 }, viewOf()).part, "mark");
  const segment = hitTest(added.project, scheme, { x: 500, y: 100 }, viewOf());
  assert.equal(segment.part, "line");
  assert.equal(segment.markId, added.mark.id);
});

test("ручки блока стоят по четырём сторонам метки и ловят клик", () => {
  const base = world();
  const added = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const scheme = added.project.schemes[0];
  const handles = handlePositions(scheme, added.mark, viewOf());
  assert.deepEqual(handles.map((handle) => handle.side), ["left", "right", "up", "down"]);
  const right = handles.find((handle) => handle.side === "right");
  assert.ok(right.x > 500 && Math.abs(right.y - 250) < 1e-6, "правая ручка — строго по горизонтали");
  assert.equal(hitHandle(scheme, added.mark, { x: right.x, y: right.y }, viewOf()), "right");
  assert.equal(hitHandle(scheme, added.mark, { x: 500, y: 250 }, viewOf()), null);
});

// ——— перевод координат ————————————————————————————————————————————————

test("экранная точка переводится в доли плана и обратно без потерь", () => {
  const scheme = { id: "s", width: 1200, height: 800 };
  const view = viewOf({ zoom: 0.73, offsetX: -180, offsetY: 64 });
  for (const plan of [{ x: 0, y: 0 }, { x: 0.25, y: 0.9 }, { x: 1, y: 1 }]) {
    const back = screenToPlan(planToScreen(plan, scheme, view), scheme, view);
    near(back.x, plan.x, "доля x");
    near(back.y, plan.y, "доля y");
  }
});

test("клик под курсором становится долей плана с учётом сдвига и масштаба", () => {
  const scheme = { id: "s", width: 1000, height: 500 };
  const view = viewOf({ zoom: 2, offsetX: 100, offsetY: 40 });
  // Пиксель (1100, 540) — это 100 + 0,5 × 1000 × 2 и 40 + 0,5 × 500 × 2.
  const plan = screenToPlan({ x: 1100, y: 540 }, scheme, view);
  near(plan.x, 0.5, "доля x");
  near(plan.y, 0.5, "доля y");
});

test("«вписать план» показывает его целиком и по центру", () => {
  const scheme = { id: "s", width: 2000, height: 1000 };
  const view = fitView(scheme, { width: 800, height: 600 });
  // По ширине теснее: 800 / 2000 × 0,96.
  near(view.zoom, 0.384, "масштаб по узкой стороне");
  near(view.offsetX, (800 - 2000 * 0.384) / 2, "поля слева и справа равны");
  near(view.offsetY, (600 - 1000 * 0.384) / 2, "поля сверху и снизу равны");
  assert.ok(2000 * view.zoom <= 800 && 1000 * view.zoom <= 600, "план целиком внутри холста");
});

// ——— подписи ————————————————————————————————————————————————————————

test("у блока одна подпись на всех, у одиночных меток — своя у каждой", () => {
  const base = world();
  const block = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.25, y: 0.2 },
      { x: 0.3, y: 0.2 },
    ],
  });
  const alone = addMark(block.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.8, y: 0.8 }] });
  const scheme = alone.project.schemes[0];
  const targets = renderInternals.labelTargets(alone.project, scheme, null);
  assert.equal(targets.length, 2, "три метки блока дают одну подпись плюс одиночная");
  assert.equal(targets.filter((item) => item.markIds).length, 1, "одна цель — группа");
  assert.equal(labelOf(alone.project, targets.find((item) => item.markIds).id), "Р1Р2Р3");
});

test("смещение подписи блока берётся у первой метки, своё у группы важнее", () => {
  const base = world();
  const block = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.25, y: 0.2 },
    ],
  });
  const moved = updateMark(block.project, block.marks[0].id, { labelOffset: { dx: 40, dy: -20 } });
  const group = moved.project.groups[0];
  assert.deepEqual(labelOffsetOf(moved.project, group), { dx: 40, dy: -20 });
  assert.deepEqual(labelOffsetOf(moved.project, { ...group, labelOffset: { dx: 5, dy: 5 } }), { dx: 5, dy: 5 });
  assert.equal(labelOffsetOf(moved.project, moved.project.marks[1]), null);
});

test("подпись смешанного блока: ведёт первая по подписи метка, под фильтром — только видимые", () => {
  const base = world();
  const socket = addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.5, y: 0.5 }] });
  const switchType = base.project.markTypes.find((item) => item.code === "В").id;
  const mixed = addToGroup(socket.project, socket.mark.id, "right", { typeId: switchType }).project;
  const scheme = mixed.schemes[0];
  const group = mixed.groups[0];

  // Блок начат с розетки, а подпись читается «В1, Р1»: ведёт её выключатель,
  // его цветом подпись и красится — иначе красная подпись начиналась бы с «В».
  assert.equal(labelOf(mixed, group.id), "В1, Р1");
  assert.equal(labelLead(mixed, group).typeId, switchType);

  // Лист розеток: выключатель скрыт фильтром, значит и в подписи его нет,
  // а стоит она у оставшейся метки, а не посередине между видимой и скрытой.
  const targets = renderInternals.labelTargets(mixed, scheme, { typeIds: [base.typeId] });
  assert.equal(targets.length, 1);
  const shown = { typeIds: [base.typeId] };
  assert.equal(labelBox(mixed, scheme, targets[0], viewOf(), shown).text, "Р1");
  assert.equal(labelBox(mixed, scheme, targets[0], viewOf(), shown).x, 500 + 10 * renderInternals.LABEL_GAP);
  assert.equal(labelLead(mixed, targets[0]).typeId, base.typeId);
});

// ——— фильтр и запас попадания ————————————————————————————————————————

test("поиск строкой ищет по обозначению, расположению и оригиналу", () => {
  const base = world();
  const added = addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.5, y: 0.5 }] });
  const filled = updateMark(added.project, added.mark.id, { location: "над Тумбой слева", original: "В34" });
  const mark = filled.project.marks[0];
  const seen = (query) => renderInternals.markVisible(filled.project, mark, { query });
  assert.equal(seen("р1"), true, "обозначение, регистр не важен");
  assert.equal(seen("тумбой"), true, "расположение");
  assert.equal(seen("в34"), true, "обозначение из оригинальной схемы");
  assert.equal(seen("кухня"), false, "чужое слово прячет метку");
  assert.equal(seen(""), true, "пустой поиск не прячет ничего");
});

test("по метке попадают с запасом, но не за его пределами", () => {
  const base = world();
  const added = addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.5, y: 0.5 }] });
  const scheme = added.project.schemes[0];
  const view = viewOf();
  // Метка — квадрат радиусом 10 в точке (500, 250); запас вокруг — HIT_SLACK_PX.
  const edge = 500 + 10 + renderInternals.HIT_SLACK_PX - 1;
  const beyond = 500 + 10 + renderInternals.HIT_SLACK_PX + 2;
  assert.ok(renderInternals.HIT_SLACK_PX > 0, "запас есть");
  assert.equal(hitTest(added.project, scheme, { x: edge, y: 250 }, view).part, "mark");
  assert.equal(hitTest(added.project, scheme, { x: beyond, y: 250 }, view), null);
});

// ——— порядок справочника ——————————————————————————————————————————————

test("справочник упорядочен один раз: категории и типы идут как у пользователя", () => {
  const base = world();
  const groups = typesInOrder(base.project);
  assert.deepEqual(
    groups.map((group) => group.category.name),
    ["Свет", "Выключатели", "Розетки", "Климат", "Сетевое оборудование"],
  );
  assert.deepEqual(groups[0].types.map((type) => type.code), ["Т", "С", "ПК", "ТР", "П", "Л", "ПШ"]);
  assert.deepEqual(groups[1].types.map((type) => type.code), ["В", "ВВ"]);
});

// Код типа бывает и в шестнадцать букв. У правого края плана такая подпись
// уезжала за картинку и на выгруженном PNG обрезалась — а выгрузка «весь план»
// рисует ровно прямоугольник плана.
test("длинная подпись у правого края встаёт слева от метки и остаётся на плане", () => {
  const base = world();
  const light = base.project.categories.find((item) => item.name === "Свет").id;
  const added = addType(base.project, { code: "ПОДСВЕТКАПОЛОВАЯ", name: "Подсветка ниши", categoryId: light });
  const long = addMark(added.project, {
    schemeId: base.schemeId,
    typeId: added.type.id,
    points: [{ x: 0.97, y: 0.5 }],
  });
  const scheme = long.project.schemes[0];

  const box = labelBox(long.project, scheme, long.mark, viewOf());
  assert.equal(box.text, "ПОДСВЕТКАПОЛОВАЯ1");
  assert.ok(box.x < 970, "подпись осталась справа от метки: " + box.x);
  assert.ok(box.x + box.width <= 1000, "подпись вылезла за правый край плана: " + (box.x + box.width));

  // Короткой подписи переезжать незачем — она стоит там же, где стояла.
  const socket = addMark(long.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.9, y: 0.6 }] });
  assert.equal(labelBox(socket.project, scheme, socket.mark, viewOf()).x, 900 + 10 * renderInternals.LABEL_GAP);

  // Оттащенную руками подпись не двигает никто: где поставили, там и стоит.
  const moved = updateMark(long.project, long.mark.id, { labelOffset: { dx: 40, dy: 0 } }).project;
  assert.equal(labelBox(moved, scheme, moved.marks[0], viewOf()).x, 1010);
});

// Ширина подписи — оценка: `labelBox` зовут и там, где холста нет (попадание
// по клику, тесты), измерителя под рукой нет. Значит, оценка обязана быть с
// запасом: коды заказчик пишет прописной кириллицей, а она шире строчной
// латиницы примерно на шестую часть. Занижение стоит дважды — подпись не
// уезжает от края плана, когда пора, и клик по ней промахивается.
test("ширина подписи считается с запасом на прописные буквы", () => {
  const base = world();
  const light = base.project.categories.find((item) => item.name === "Свет").id;
  const added = addType(base.project, { code: "ПОДСВЕТКАПОЛОВАЯ", name: "Подсветка ниши", categoryId: light });
  const mark = addMark(added.project, { schemeId: base.schemeId, typeId: added.type.id, points: [{ x: 0.3, y: 0.5 }] });
  const box = labelBox(mark.project, mark.project.schemes[0], mark.mark, viewOf());

  assert.equal(box.text, "ПОДСВЕТКАПОЛОВАЯ1");
  // 17 знаков кеглем 12. Прописная кириллица в system-ui занимает не меньше
  // 0,72 кегля на знак — оценка ниже промахивается мимо собственной подписи.
  assert.ok(box.width >= 17 * 12 * 0.72, "подпись померена уже, чем она есть: " + box.width);
  // Но и не вдвое шире: раздутый прямоугольник съедал бы клики по соседям.
  assert.ok(box.width <= 17 * 12, "подпись померена заметно шире, чем она есть: " + box.width);
});

// ——— разведение подписей ——————————————————————————————————————————————

// Все подписи схемы разом — так их видит и холст, и выгрузка: раскладка
// считается один раз на схему и передаётся в каждый прямоугольник.
const labelBoxes = (project, scheme, view, filter = null) =>
  renderInternals.labelTargets(project, scheme, filter).map((target) => labelBox(project, scheme, target, view, filter));

const boxesOverlap = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y - a.height / 2 < b.y + b.height / 2 &&
  b.y - b.height / 2 < a.y + a.height / 2;

// Ряд меток вдоль стены — обычное дело: три подсветки в сорока пяти пикселях
// друг от друга. Подпись шире этого шага, и без разведения на выгрузке
// получается «ПОДСВЕТКПОДСВЕТКПОДСВЕТКА3»: номера съедены, а номер — это
// единственное, ради чего подпись на плане стоит.
const rowOfThree = (code = "ПОДСВЕТКА", xs = [0.2, 0.245, 0.29]) => {
  const base = world();
  const light = base.project.categories.find((item) => item.name === "Свет").id;
  const added = addType(base.project, { code, name: "Подсветка", categoryId: light });
  let project = added.project;
  for (const x of xs) {
    project = addMark(project, { schemeId: base.schemeId, typeId: added.type.id, points: [{ x, y: 0.4 }] }).project;
  }
  return { project, scheme: project.schemes[0] };
};

// Куча меток в одной точке — крайний случай приёмки: щит, где два десятка
// линий сходятся на пятачке.
const pileOf = (count) => {
  const base = world();
  const light = base.project.categories.find((item) => item.name === "Свет").id;
  const added = addType(base.project, { code: "ПОДСВЕТКА", name: "Подсветка", categoryId: light });
  let project = added.project;
  for (let i = 0; i < count; i += 1) {
    project = addMark(project, {
      schemeId: base.schemeId,
      typeId: added.type.id,
      points: [{ x: 0.5, y: 0.5 }],
    }).project;
  }
  return { project, scheme: project.schemes[0] };
};

test("подписи меток, стоящих вплотную, не наезжают друг на друга", () => {
  const { project, scheme } = rowOfThree();
  const boxes = labelBoxes(project, scheme, viewOf());

  assert.deepEqual(boxes.map((box) => box.text), ["ПОДСВЕТКА1", "ПОДСВЕТКА2", "ПОДСВЕТКА3"]);
  // Шаг между метками — 45 пикселей плана, подпись шире: без разведения
  // прямоугольники пересекались бы попарно.
  assert.ok(boxes[0].width > 45, "подпись уже шага между метками, пример не тот: " + boxes[0].width);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(!boxesOverlap(boxes[i], boxes[j]), `подписи ${i + 1} и ${j + 1} наложились`);
    }
  }
});

test("подпись, оттащенную руками, раскладка не двигает — соседи обходят её", () => {
  const row = rowOfThree();
  // Пользователь оттащил подпись средней метки вниз и влево: это его решение,
  // и никакая раскладка не вправе его пересчитать.
  const own = { dx: -60, dy: 30 };
  const moved = updateMark(row.project, row.project.marks[1].id, { labelOffset: own }).project;
  const boxes = labelBoxes(moved, row.scheme, viewOf());
  const mine = boxes.find((box) => box.text === "ПОДСВЕТКА2");

  assert.deepEqual({ dx: mine.dx, dy: mine.dy }, own, "смещение подписи пересчитали за пользователя");
  assert.equal(mine.x, 245 + own.dx, "подпись уехала с места, куда её поставили");
  assert.equal(mine.y, 200 + own.dy);
  for (const other of boxes) {
    if (other === mine) continue;
    assert.ok(!boxesOverlap(mine, other), "соседняя подпись наехала на оттащенную: " + other.text);
  }
});

// Инженер размечает на экране, а монтажник держит в руках распечатку. Если
// раскладка считается «по случаю» — по экранным пикселям, — то выгрузка в
// двойном разрешении разойдётся с тем, что видели на экране. Поэтому места
// считаются в координатах плана, а масштаб только умножает.
test("раскладка подписей одна и та же на экране и в выгрузке", () => {
  const { project, scheme } = rowOfThree();
  const screen = labelBoxes(project, scheme, viewOf({ zoom: 1 }));
  const shot = labelBoxes(project, scheme, viewOf({ zoom: 2, offsetX: 17, offsetY: -9 }));

  assert.equal(shot.length, screen.length);
  for (let i = 0; i < screen.length; i += 1) {
    assert.equal(shot[i].text, screen[i].text);
    assert.deepEqual(
      { dx: shot[i].dx, dy: shot[i].dy },
      { dx: screen[i].dx, dy: screen[i].dy },
      "подпись «" + screen[i].text + "» отведена по-разному на экране и в выгрузке",
    );
    // Выгрузка «весь план» в масштабе 2: сдвиг подписи от метки ровно вдвое.
    const anchor = planToScreen(project.marks[i].points[0], scheme, viewOf({ zoom: 2, offsetX: 17, offsetY: -9 }));
    near(shot[i].x - anchor.x, 2 * screen[i].dx, "подпись «" + shot[i].text + "» по горизонтали");
    near(shot[i].y - anchor.y, 2 * screen[i].dy, "подпись «" + shot[i].text + "» по вертикали");
  }
});

// Одна и та же схема, открытая дважды, обязана выглядеть одинаково: раскладка
// зависит от того, где метки стоят, а не от того, в каком порядке их ставили
// и сколько раз её успели пересчитать.
test("раскладка повторяется: она от геометрии, а не от порядка постановки меток", () => {
  const straight = rowOfThree();
  const first = labelBoxes(straight.project, straight.scheme, viewOf());
  const again = labelBoxes(straight.project, straight.scheme, viewOf());
  assert.deepEqual(again, first, "второй расчёт той же схемы дал другую раскладку");

  // Те же три места на плане, размеченные справа налево: подписи достанутся
  // другим номерам, но стоять они будут там же.
  const reversed = rowOfThree("ПОДСВЕТКА", [0.29, 0.245, 0.2]);
  const places = (boxes) => boxes.map((box) => box.x + ":" + box.y).sort();
  assert.deepEqual(places(labelBoxes(reversed.project, reversed.scheme, viewOf())), places(first));
});

test("отведённая подпись остаётся рядом со своей меткой", () => {
  const { project, scheme } = pileOf(12);
  const boxes = labelBoxes(project, scheme, viewOf());
  assert.equal(boxes.length, 12);
  for (const box of boxes) {
    // Метка одна на всех — пиксели (500, 250) на плане 1000×500.
    const away = Math.max(0, Math.abs(box.y - 250) - box.height / 2);
    // Дальше пяти строк подпись перестаёт читаться как «эта, у этой метки»:
    // монтажник с листом в руках приписывает её соседнему устройству.
    assert.ok(away <= box.height * 5, "подпись «" + box.text + "» ушла от метки на " + away);
    const side = box.x < 500 ? 500 - (box.x + box.width) : box.x - 500;
    assert.ok(side >= 0 && side < 40, "подпись «" + box.text + "» отъехала вбок на " + side);
  }
});

// Двадцать меток в одной точке развести некуда: свободных мест вокруг метки
// меньше, чем подписей. Здесь важно, что именно происходит — подписи не
// пропадают и метки не разъезжаются, а последним достаётся место с наименьшим
// наложением, и они честно помечены `crowded`.
test("когда разводить некуда — подписи остаются на месте меток, а не пропадают", () => {
  const { project, scheme } = pileOf(20);
  const boxes = labelBoxes(project, scheme, viewOf());

  assert.equal(boxes.length, 20, "подпись пропала с плана");
  assert.ok(boxes.every((box) => box.text.length > 0), "подпись осталась без текста");
  assert.equal(new Set(boxes.map((box) => box.text)).size, 20, "две подписи слились в одну");
  assert.ok(boxes.some((box) => box.crowded), "теснота не помечена: разбирать выгрузку будет нечем");
  // Метка стоит там, где стоит железка: раскладка двигает только подпись.
  for (const mark of project.marks) assert.deepEqual(mark.points, [{ x: 0.5, y: 0.5 }]);
});

// Фильтр меняет состав подписей, а значит и места, которые они делят. Если
// картинку считать с фильтром, а попадание по клику — без него, подпись
// нарисуется в одном месте, а ловиться будет в другом: расхождение тихое, и
// видно его только руками. Поэтому `labelBox` берёт фильтр — тот же, что
// `hitTest` и `drawScheme`, — и своего «посчитаю без фильтра» у него нет.
test("подпись считается по тому же фильтру, что и картинка: клик попадает туда, где нарисовано", () => {
  const base = world();
  const light = base.project.categories.find((item) => item.name === "Свет").id;
  const wide = addType(base.project, { code: "ПОДСВЕТКА", name: "Подсветка", categoryId: light });
  const tape = addType(wide.project, { code: "ЛЕНТА", name: "Лента", categoryId: light });
  let project = addMark(tape.project, {
    schemeId: base.schemeId,
    typeId: wide.type.id,
    points: [{ x: 0.2, y: 0.4 }],
  }).project;
  const added = addMark(project, { schemeId: base.schemeId, typeId: tape.type.id, points: [{ x: 0.23, y: 0.4 }] });
  project = added.project;
  const scheme = project.schemes[0];
  const view = viewOf();
  const shown = { typeIds: [tape.type.id] };

  // Сосед виден — подписи делят места, и «ЛЕНТА1» отведена от своего места.
  const crowded = labelBox(project, scheme, added.mark, view, null);
  // Сосед скрыт — делить не с кем, подпись стоит где положено: метка (230, 200).
  const free = labelBox(project, scheme, added.mark, view, shown);
  assert.equal(free.x, 230 + 10 * renderInternals.LABEL_GAP);
  assert.equal(free.y, 200 - 10 * renderInternals.LABEL_GAP);
  assert.notEqual(crowded.y, free.y, "пример не тот: без фильтра подпись никуда не отводится");

  // И там, и там клик ловит подпись ровно на её месте.
  for (const [filter, box] of [[null, crowded], [shown, free]]) {
    const hit = hitTest(project, scheme, { x: box.x + 2, y: box.y }, view, filter);
    assert.equal(hit && hit.part, "label", "клик не нашёл подпись там, где она нарисована");
    assert.equal(hit.markId, added.mark.id, "клик попал в чужую подпись");
  }
});

test("раскладку вместо фильтра labelBox не принимает", () => {
  const { project, scheme } = rowOfThree();
  const layout = labelLayout(project, scheme, null, viewOf());
  assert.ok(layout.size > 0, "раскладка пустая — проверять нечего");
  // Map молча сошла бы за «фильтра нет»: подпись встала бы по одной раскладке,
  // а ловилась по другой. Лучше отказ, чем тихое расхождение.
  assert.throws(
    () => labelBox(project, scheme, project.marks[0], viewOf(), layout),
    (error) => error.code === "label-layout-instead-of-filter",
  );
});

// ——— легенда ——————————————————————————————————————————————————————————

// Холста в тестах нет, поэтому легенде подставляется измеритель-заглушка:
// знак ровно в 7 единиц. Она же записывает рамку и строки, которые легенда
// нарисовала, — по ним и видно, совпала ли рамка с текстом.
const legendProbe = (charWidth = 7) => {
  const base = {
    rects: [],
    texts: [],
    measureText: (value) => ({ width: String(value).length * charWidth }),
    rect: (x, y, w, h) => base.rects.push({ x, y, w, h }),
    fillText: (value, x) => base.texts.push({ value, x, width: String(value).length * charWidth }),
  };
  return new Proxy(base, {
    get: (obj, key) => (key in obj ? obj[key] : () => {}),
    set: (obj, key, value) => ((obj[key] = value), true),
  });
};

const legendOf = (project, scheme) => {
  const probe = legendProbe();
  drawLegend(probe, { project, scheme, filter: null, view: viewOf() });
  return probe;
};

// Рамка легенды стояла шириной «на глазок» (шестнадцать высот строки), и
// «ПОДСВЕТКАПОЛОВАЯ — Подсветка ниши» ложилась из неё прямо на план.
test("рамка легенды растёт с самой длинной строкой и держит её внутри", () => {
  const base = world();
  const socket = addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.2, y: 0.2 }] });
  const scheme = socket.project.schemes[0];
  const short = legendOf(socket.project, scheme);
  assert.equal(short.texts.length, 1);
  assert.equal(short.texts[0].value, "Р — Розетка");

  const light = socket.project.categories.find((item) => item.name === "Свет").id;
  const added = addType(socket.project, { code: "ПОДСВЕТКАПОЛОВАЯ", name: "Подсветка ниши", categoryId: light });
  const long = addMark(added.project, {
    schemeId: base.schemeId,
    typeId: added.type.id,
    points: [{ x: 0.3, y: 0.3 }],
  });
  const wide = legendOf(long.project, scheme);
  assert.equal(wide.texts.length, 2);

  // «ПОДСВЕТКАПОЛОВАЯ — Подсветка ниши» — 33 знака по 7 единиц, то есть 231:
  // в прежнюю рамку «на глазок» (176) строка не влезала и ложилась на план.
  assert.ok(wide.rects[0].w >= 33 * 7, "рамка уже своей самой длинной строки: " + wide.rects[0].w);
  assert.ok(wide.rects[0].w > short.rects[0].w, "рамка не растёт со строкой: " + wide.rects[0].w);
  for (const row of wide.texts) {
    assert.ok(
      row.x + row.width <= wide.rects[0].x + wide.rects[0].w,
      "строка легенды вылезла из рамки: " + row.value,
    );
  }
});
