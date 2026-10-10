// Стопка совпавших меток и соседняя метка вплотную (таск 131, G181 и G182).
//
// Случай заказчика: «бывает, например у зоны ТВ когда снизу блок розеток
// расположен, и сверху под ТВ ещё один блок, в горизонтали они на одной оси,
// а по вертикали на разной. На развёртке стен всё корректно будет, а вот на
// основной схеме как это сделать?» До этого таска ответа не было вовсе:
// верхняя метка была **невидима** под нижней.
//
// Из трёх предложенных решений заказчик выбрал: стопкой, с высотой у каждой,
// **без схлопывания в счётчик**. Поэтому здесь проверяется и то, что счётчика
// нет ни при каком числе меток.
//
// Подписи высот он потом снял сам (G188, таск 136): «на схеме при расстановке
// в колонку не указывай их высоту». Стопка осталась, числа ушли — и теперь
// здесь проверяется обратное: на плане нет ни одного `h=`.
//
// Главное правило сборки, которое стопка обязана не сломать: попадание по
// клику считается тем же смещением, что отрисовка. Поэтому в каждом тесте,
// где знак уехал, рядом стоит `hitTest`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOCK_STEP_RATIO,
  addMark,
  addScheme,
  addToGroup,
  addWall,
  applyMarkWalls,
  blockStepPx,
  createProject,
  findMark,
  markDimensions,
  markWall,
  markWallSide,
  planMmToFraction,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import {
  drawScheme,
  hitHandle,
  hitTest,
  labelBounds,
  labelBox,
  markStackPoints,
  markStacks,
  planToScreen,
  renderInternals,
} from "../src/render.js";

const WIDTH = 1200;
const HEIGHT = 800;
const MARK_SIZE = 10;
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: MARK_SIZE, labelSize: 12, ...patch });
const handlePositions = (...args) => renderInternals.handlePositions(...args);

// Простой план без чертежа: ни стен, ни калибровки — так размечено
// большинство объектов, и стопка обязана работать и здесь.
function flat() {
  let project = createProject({ name: "Стопка" });
  const added = addScheme(project, { name: "1 этаж", width: WIDTH, height: HEIGHT });
  project = added.project;
  return { project, schemeId: added.scheme.id, scheme: added.scheme };
}

const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

// Метки в одной точке плана: `heights` — высота над полом каждой (null — не
// задана). Возвращает объект, схему и порядок постановки.
function pile(heights, at = { x: 0.5, y: 0.5 }, code = "Р") {
  const base = flat();
  let project = base.project;
  const ids = [];
  for (const height of heights) {
    const added = addMark(project, { schemeId: base.schemeId, typeId: typeId(project, code), kind: "point", points: [{ ...at }] });
    project = added.project;
    ids.push(added.mark.id);
    if (height !== null) project = setMarkDimensions(project, added.mark.id, { heightAboveFloor: height }).project;
  }
  return { project, scheme: project.schemes[0], ids };
}

// План с чертежом: сто точек на метр, нуль чертежа в середине, поворот —
// по просьбе теста (G178: план можно крутить, и чертёж крутится с ним).
function planProject(turn = 0) {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: WIDTH, height: HEIGHT });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn }).project;
  return { project, schemeId: added.scheme.id };
}

/**
 * Зона ТВ у **вертикальной** стены: стена идёт сверху вниз по экрану, от
 * (−2000, −1500) к (−2000, 1500). Её левая сторона (по направлению `a → b`) —
 * та, что справа на экране, то есть внутрь комнаты.
 *
 * Два блока розеток в одной точке плана: снизу 300 мм, под телевизором
 * 1100 мм. По горизонтали они на одной оси — ровно случай заказчика.
 */
function tvWall(turn = 0, heights = [1100, 300]) {
  const base = planProject(turn);
  const wall = addWall(base.project, {
    schemeId: base.schemeId,
    aMm: { x: -2000, y: -1500 },
    bMm: { x: -2000, y: 1500 },
    thicknessMm: 200,
  });
  let project = setSchemeWallHeight(wall.project, base.schemeId, 2700).project;
  const at = planMmToFraction(project, base.schemeId, { x: -1850, y: 0 });
  const ids = [];
  for (const height of heights) {
    const added = addMark(project, {
      schemeId: base.schemeId,
      typeId: typeId(project, "Р"),
      kind: "point",
      points: [{ ...at }],
    });
    project = added.project;
    ids.push(added.mark.id);
    if (height !== null) project = setMarkDimensions(project, added.mark.id, { heightAboveFloor: height }).project;
  }
  project = applyMarkWalls(project).project;
  return { project, scheme: project.schemes[0], schemeId: base.schemeId, wallId: wall.wall.id, ids, at };
}

// Запись холста: что нарисовано и каким текстом. Тот же приём, что у
// развёртки (`test/elevation.test.js`) — DOM и canvas тестами не покрываются,
// проверяется вызов.
function recorder() {
  const log = [];
  const ctx = new Proxy(
    { measureText: (value) => ({ width: String(value).length * 6 }) },
    {
      get: (target, key) => (key in target ? target[key] : (...args) => log.push(String(key) + ":" + args.join(","))),
      set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
    },
  );
  return { ctx, log };
}

const texts = (log) => log.filter((line) => line.startsWith("fillText:")).map((line) => line.slice(9).split(",")[0]);

// ——— стопка расходится, разметка не меняется —————————————————————————

test("совпавшие метки расходятся стопкой, а точки в объекте остаются на месте", () => {
  const built = pile([1100, 300]);
  const view = viewOf();
  const stacks = markStacks(built.project, built.scheme, null, view);
  assert.equal(stacks.size, 2, "стопка не собралась");

  // Знаки разъехались: у одного смещения нет вовсе, у второго — на шаг.
  const places = built.ids.map((id) => markStackPoints(findMark(built.project, id), stacks)[0]);
  assert.notDeepEqual(places[0], places[1], "знаки остались один под другим");
  // А точки метки — те же, что были: стопка это отрисовка (G68).
  for (const id of built.ids) {
    assert.deepEqual(findMark(built.project, id).points, [{ x: 0.5, y: 0.5 }], "метка переехала");
  }
});

test("G68: объект до и после показа стопки побайтно один", async () => {
  const built = pile([1100, 300, null]);
  const before = await packProject(built.project, new Map());
  const view = viewOf();
  // Всё, что умеет стопка, — на одном и том же объекте.
  markStacks(built.project, built.scheme, null, view);
  hitTest(built.project, built.scheme, { x: 600, y: 400 }, view, null);
  drawScheme(recorder().ctx, { project: built.project, scheme: built.scheme, filter: null, view, selectedIds: [] });
  const after = await packProject(built.project, new Map());
  assert.deepEqual(new Uint8Array(await after.arrayBuffer()), new Uint8Array(await before.arrayBuffer()), "выгрузка изменилась");
  // И то же самое после круга «упаковать — распаковать»: открытый объект
  // совпадает с закрытым меткой к метке.
  const opened = (await unpackProject(before)).project;
  assert.deepEqual(
    opened.marks.map((mark) => ({ id: mark.id, number: mark.number, points: mark.points })),
    built.project.marks.map((mark) => ({ id: mark.id, number: mark.number, points: mark.points })),
  );
});

test("стопки нет там, где её быть не должно: одна метка, далёкие соседи, блок вплотную", () => {
  const view = viewOf();
  const one = pile([300]);
  assert.equal(markStacks(one.project, one.scheme, null, view).size, 0, "одна метка собралась в стопку");

  // Соседи дальше порога (радиус знака — 10 пикселей плана): 15 пикселей
  // между центрами. Знаки наезжают, но различимы — это не одно место.
  const base = flat();
  let project = addMark(base.project, { schemeId: base.schemeId, typeId: typeId(base.project, "Р"), points: [{ x: 0.5, y: 0.5 }] }).project;
  project = addMark(project, { schemeId: base.schemeId, typeId: typeId(project, "Р"), points: [{ x: 0.5 + 15 / WIDTH, y: 0.5 }] }).project;
  assert.equal(markStacks(project, project.schemes[0], null, view).size, 0, "наехавшие знаки собрались в стопку");

  // Блок, собранный кнопкой «+»: знаки стоят вплотную (2,22 радиуса), и
  // стопка обязана их не трогать — иначе каждая рамка розеток разъезжалась бы.
  const first = addMark(base.project, { schemeId: base.schemeId, typeId: typeId(base.project, "Р"), points: [{ x: 0.4, y: 0.5 }] });
  const grown = addToGroup(first.project, first.mark.id, "right", { step: blockStepPx(MARK_SIZE) });
  assert.equal(markStacks(grown.project, grown.project.schemes[0], null, view).size, 0, "блок вплотную собрался в стопку");
  assert.ok(BLOCK_STEP_RATIO > renderInternals.MARK_STACK_REACH_RATIO, "порог стопки догнал шаг блока");
});

test("порог и шаг считаются в пикселях плана: приближение стопку не меняет", () => {
  const built = pile([1100, 300]);
  const near = markStacks(built.project, built.scheme, null, viewOf({ zoom: 1 }));
  const far = markStacks(built.project, built.scheme, null, viewOf({ zoom: 4, offsetX: 55, offsetY: -12 }));
  assert.equal(far.size, near.size, "приближение собрало другую стопку");
  for (const id of built.ids) {
    assert.deepEqual(far.get(id).at, near.get(id).at, "смещение знака зависит от приближения");
  }
  // На экране смещение растёт ровно с масштабом — значит выгрузка повторяет
  // то, что видел инженер (то же правило, что у раскладки подписей).
  const mark = findMark(built.project, built.ids[0]);
  const one = planToScreen(markStackPoints(mark, near)[0], built.scheme, viewOf({ zoom: 1 }));
  const four = planToScreen(markStackPoints(mark, far)[0], built.scheme, viewOf({ zoom: 4, offsetX: 55, offsetY: -12 }));
  const anchor = planToScreen(mark.points[0], built.scheme, viewOf({ zoom: 4, offsetX: 55, offsetY: -12 }));
  const plain = planToScreen(mark.points[0], built.scheme, viewOf({ zoom: 1 }));
  assert.ok(Math.abs((four.y - anchor.y) - 4 * (one.y - plain.y)) < 1e-6, "на выгрузке стопка разошлась иначе");
});

// ——— направление, порядок, порог ——————————————————————————————————————

test("у привязанной метки стопка уходит перпендикулярно стене, в сторону самой метки", () => {
  const scene = tvWall();
  // Стена вертикальная, метки — в комнате справа от неё: это её левая сторона
  // (слева, если идти от конца `a` к концу `b`).
  for (const id of scene.ids) {
    assert.ok(markWall(findMark(scene.project, id)), "метка не привязалась к стене");
    assert.equal(markWallSide(scene.project, findMark(scene.project, id)), "left");
  }
  const stacks = markStacks(scene.project, scene.scheme, null, viewOf());
  const dirs = scene.ids.map((id) => stacks.get(id).dir);
  for (const dir of dirs) assert.deepEqual(dir, { x: 1, y: 0 }, "стопка пошла не поперёк стены");
  // Отступ вдоль стены от этого не меняется: знак едет поперёк, и развёртка
  // с планом говорят об одном месте.
  const points = scene.ids.map((id) => markStackPoints(findMark(scene.project, id), stacks)[0]);
  for (const point of points) assert.equal(point.y, scene.at.y, "знак уехал вдоль стены");
});

test("поворот чертежа поворачивает и стопку", () => {
  const stacks = markStacks(...sceneArgs(tvWall(90)));
  const dirs = [...stacks.values()].map((shift) => shift.dir);
  for (const dir of dirs) assert.deepEqual(dir, { x: 0, y: 1 }, "стопка не повернулась вместе с чертежом");
});

function sceneArgs(scene) {
  return [scene.project, scene.scheme, null, viewOf()];
}

test("без стены стопка уходит вверх, а у верхнего края плана — вниз", () => {
  const middle = pile([1100, 300]);
  const up = markStacks(middle.project, middle.scheme, null, viewOf());
  for (const shift of up.values()) assert.deepEqual(shift.dir, { x: 0, y: -1 }, "непривязанная стопка пошла не вверх");

  // Метки под самым верхом плана: вверху места нет, и стопка разворачивается.
  const top = pile([1100, 300, 900, null], { x: 0.5, y: 0.01 });
  for (const shift of markStacks(top.project, top.scheme, null, viewOf()).values()) {
    assert.deepEqual(shift.dir, { x: 0, y: 1 }, "стопка уехала за верхний край плана");
  }
});

test("порядок стопки: без высоты — у точки, дальше по возрастанию высоты над полом", () => {
  // Ставим нарочно не по порядку высот: порядок в стопке решают высоты, а не
  // порядок постановки.
  const built = pile([1100, 0, null, 300, null]);
  const stacks = markStacks(built.project, built.scheme, null, viewOf());
  const order = built.ids
    .map((id) => ({ id, shift: stacks.get(id) }))
    .sort((a, b) => a.shift.index - b.shift.index)
    .map((item) => item.shift.heightMm);
  // Две метки без высоты стоят первыми, между собой — в порядке постановки
  // (третья поставлена раньше пятой), дальше 0, 300, 1100.
  assert.deepEqual(order, [null, null, 0, 300, 1100]);
  assert.deepEqual(
    [stacks.get(built.ids[2]).index, stacks.get(built.ids[4]).index],
    [0, 1],
    "метки без высоты перемешались между собой",
  );
});

// ——— высота у каждой, без счётчика ————————————————————————————————————

test("G188: высота в стопке не подписана — ни числом, ни вопросом", () => {
  // Высоты нарочно разные, и одна метка без высоты: до G188 здесь стояли
  // «h=1100», «h=300» и «h=?».
  const built = pile([1100, 300, null]);
  const view = viewOf();
  const { ctx, log } = recorder();
  drawScheme(ctx, { project: built.project, scheme: built.scheme, filter: null, view, selectedIds: [] });
  const shown = texts(log);
  assert.deepEqual(shown.filter((value) => value.startsWith("h=")), [], "на плане осталась подпись высоты: " + shown.join(" "));
  // Обозначения меток при этом на месте: убраны числа, а не подписи.
  for (const label of ["Р1", "Р2", "Р3"]) {
    assert.ok(shown.includes(label), "обозначение " + label + " пропало вместе с высотой");
  }
  // И сама стопка цела: три знака в трёх разных местах.
  const stacks = markStacks(built.project, built.scheme, null, view);
  const places = built.ids.map((id) => {
    const point = markStackPoints(findMark(built.project, id), stacks)[0];
    return point.x.toFixed(6) + ":" + point.y.toFixed(6);
  });
  assert.equal(new Set(places).size, 3, "вместе с высотами разъехалась и стопка");
});

test("G188: высота метки не потерялась — она лежит в самой метке", () => {
  // Где смотреть высоту после G188: поле метки — источник, из него её берут
  // карточка метки, строка списка («В 900 мм») и развёртка стен.
  const built = pile([1100, 300, null]);
  const stacks = markStacks(built.project, built.scheme, null, viewOf());
  assert.deepEqual(
    built.ids.map((id) => markDimensions(findMark(built.project, id)).heightAboveFloor),
    [1100, 300, null],
    "высота пропала из метки, а не только с плана",
  );
  // Порядок стопки её по-прежнему решает: метка без высоты — у точки, дальше
  // по возрастанию.
  assert.deepEqual(
    built.ids
      .map((id) => stacks.get(id))
      .sort((a, b) => a.index - b.index)
      .map((shift) => shift.heightMm),
    [null, 300, 1100],
  );
});

test("ни у одинокой метки, ни у далёких соседей на плане нет ни одного числа высоты", () => {
  const built = pile([300]);
  const { ctx, log } = recorder();
  drawScheme(ctx, { project: built.project, scheme: built.scheme, filter: null, view: viewOf(), selectedIds: [] });
  assert.deepEqual(texts(log).filter((value) => value.startsWith("h=")), [], "высота подписана у одинокой метки");
});

test("счётчика нет ни при каком числе меток: десять выводов щитка стоят десятью знаками", () => {
  const built = pile(new Array(10).fill(null).map((_, index) => 100 * (index + 1)));
  const view = viewOf();
  const stacks = markStacks(built.project, built.scheme, null, view);
  assert.equal(stacks.size, 10);
  // Десять разных мест и ни одного повтора: ни одна метка не спряталась.
  const places = built.ids.map((id) => {
    const point = markStackPoints(findMark(built.project, id), stacks)[0];
    return point.x.toFixed(6) + ":" + point.y.toFixed(6);
  });
  assert.equal(new Set(places).size, 10, "знаки стопки встали друг на друга");
  // Подписи — десять обозначений и ни одного «×10». Высот на плане нет (G188).
  const { ctx, log } = recorder();
  drawScheme(ctx, { project: built.project, scheme: built.scheme, filter: null, view, selectedIds: [] });
  const shown = texts(log);
  for (let index = 1; index <= 10; index += 1) {
    assert.ok(shown.includes("Р" + index), "обозначение Р" + index + " пропало с плана");
  }
  assert.ok(!shown.some((value) => value.includes("×")), "на плане появился счётчик: " + shown.join(" "));
  assert.deepEqual(shown.filter((value) => value.startsWith("h=")), [], "в гребне щитка осталась подпись высоты");
});

// ——— клик там, где нарисовано ——————————————————————————————————————————

test("клик попадает в тот знак стопки, который на этом месте нарисован", () => {
  const built = pile([1100, 300, null, 0]);
  const view = viewOf();
  const stacks = markStacks(built.project, built.scheme, null, view);
  for (const id of built.ids) {
    const mark = findMark(built.project, id);
    const at = planToScreen(markStackPoints(mark, stacks)[0], built.scheme, view);
    const hit = hitTest(built.project, built.scheme, at, view, null);
    assert.ok(hit, "клик по знаку стопки никуда не попал");
    assert.equal(hit.part, "mark");
    assert.equal(hit.markId, id, "клик по знаку стопки попал в соседа");
  }
  // На настоящей точке стоит первый знак стопки — он же и выбирается.
  const first = built.ids.find((id) => stacks.get(id).index === 0);
  const origin = planToScreen({ x: 0.5, y: 0.5 }, built.scheme, view);
  assert.equal(hitTest(built.project, built.scheme, origin, view, null).markId, first);
});

test("стопка считается по тому же фильтру, что и картинка", () => {
  const built = pile([1100, 300]);
  const view = viewOf();
  // Фильтр оставил одну метку — совпадать стало не с кем, и знак вернулся на
  // свою точку. Клик по ней при том же фильтре попадает туда же.
  const filter = { query: "Р1" };
  const stacks = markStacks(built.project, built.scheme, filter, view);
  assert.equal(stacks.size, 0, "спрятанная фильтром метка всё ещё накрывает соседа");
  const at = planToScreen({ x: 0.5, y: 0.5 }, built.scheme, view);
  assert.equal(hitTest(built.project, built.scheme, at, view, filter).markId, built.ids[0]);
});

// ——— подписи по-прежнему разводятся ———————————————————————————————————

test("подписи стопки не налезают на знаки", () => {
  const built = pile([1100, 300, null]);
  const view = viewOf();
  const stacks = markStacks(built.project, built.scheme, null, view);
  const boxes = renderInternals
    .labelTargets(built.project, built.scheme, null)
    .map((target) => labelBounds(labelBox(built.project, built.scheme, target, view, null)));
  assert.equal(boxes.length, 3);
  assert.equal(new Set(boxes.map((box) => box.x + ":" + box.y)).size, 3, "две подписи встали в одно место");

  // Прямоугольников высот в занятых местах больше нет (G188) — проверяется
  // только то, что осталось: подпись обходит знаки.
  for (const id of built.ids) {
    const mark = findMark(built.project, id);
    const glyph = planToScreen(markStackPoints(mark, stacks)[0], built.scheme, view);
    for (const box of boxes) {
      const onGlyph =
        box.x < glyph.x + MARK_SIZE &&
        glyph.x - MARK_SIZE < box.x + box.width &&
        box.y < glyph.y + MARK_SIZE &&
        glyph.y - MARK_SIZE < box.y + box.height;
      assert.ok(!onGlyph, "подпись легла на знак стопки");
    }
  }
});

// ——— ручка «+» у знака, метка под ручкой ——————————————————————————————

test("ручка «+» стоит у знака стопки, и новая метка встаёт ровно под неё", () => {
  const built = pile([1100, 300]);
  const view = viewOf();
  const stacks = markStacks(built.project, built.scheme, null, view);
  // Берём ту метку, которую стопка отодвинула: её ручки обязаны уехать с ней.
  const movedId = built.ids.find((id) => stacks.get(id).index > 0);
  const mark = findMark(built.project, movedId);
  const glyph = planToScreen(markStackPoints(mark, stacks)[0], built.scheme, view);
  const handles = handlePositions(built.scheme, mark, view, stacks);
  const right = handles.find((handle) => handle.side === "right");
  assert.ok(Math.abs(right.y - glyph.y) < 1e-6, "ручка осталась у настоящей точки, а не у знака");
  assert.equal(hitHandle(built.scheme, mark, { x: right.x, y: right.y }, view, 0, stacks), "right");

  // Новая метка встаёт туда, где нарисована ручка: холст передаёт модели то же
  // смещение, которым отодвинул знак.
  const grown = addToGroup(built.project, movedId, "right", { step: blockStepPx(MARK_SIZE), fromPx: stacks.get(movedId).px });
  const at = planToScreen(grown.mark.points[0], built.scheme, view);
  assert.ok(Math.abs(at.x - right.x) < 1e-6, "метка встала не под ручку по горизонтали");
  assert.ok(Math.abs(at.y - right.y) < 1e-6, "метка встала не под ручку по вертикали");
  // Прежние метки при этом не двинулись (G68).
  for (const id of built.ids) {
    assert.deepEqual(findMark(grown.project, id).points, findMark(built.project, id).points, "старая метка сдвинулась");
  }
});

// ——— G68: объект прежнего формата ——————————————————————————————————————

test("G68: у объекта прежнего формата стопка не заводит ни одного поля", async () => {
  const old = {
    formatVersion: 1,
    id: "old-project",
    name: "Объект прежнего формата",
    createdAt: "2026-01-01T00:00:00+03:00",
    updatedAt: "2026-01-01T00:00:00+03:00",
    categories: [{ id: "cat-1", name: "Розетки", color: "#D1242F", shape: "circle-socket", order: 0 }],
    markTypes: [{ id: "type-1", categoryId: "cat-1", code: "Р", name: "Розетка", shape: null, blockMode: "each", order: 0 }],
    rooms: [],
    schemes: [{ id: "scheme-1", name: "1 этаж", imageId: null, width: 1000, height: 1000, order: 0 }],
    // Две розетки в одной точке: до этого таска вторая была невидима.
    marks: [
      { id: "mark-1", schemeId: "scheme-1", typeId: "type-1", number: 1, kind: "point", points: [{ x: 0.5, y: 0.5 }], groupId: null, labelOffset: null },
      { id: "mark-2", schemeId: "scheme-1", typeId: "type-1", number: 2, kind: "point", points: [{ x: 0.5, y: 0.5 }], groupId: null, labelOffset: null },
    ],
    groups: [],
    counters: { Р: 2 },
    view: { markSize: 10, labelSize: 12 },
  };
  const opened = (await unpackProject(await packProject(old, new Map()))).project;
  const scheme = opened.schemes[0];
  const view = viewOf();
  const stacks = markStacks(opened, scheme, null, view);
  // Стопка собралась — это и есть починка невидимости…
  assert.equal(stacks.size, 2);
  // …и при этом ни одна метка не изменилась ни на поле, ни на долю.
  assert.deepEqual(
    opened.marks,
    old.marks.map((mark) => ({ ...mark })),
    "метка старого объекта изменилась",
  );
  // И на плане у них нет ни числа, ни вопроса: подписи высот сняты (G188).
  const { ctx, log } = recorder();
  drawScheme(ctx, { project: opened, scheme, filter: null, view, selectedIds: [] });
  assert.deepEqual(texts(log).filter((value) => value.startsWith("h=")), []);
});
