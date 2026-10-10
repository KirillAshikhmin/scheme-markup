// Выгрузка развёрток листом на помещение (таск 130, требование G180).
//
// Проверяется прежде всего **правило отбора**: оно важнее самой выгрузки. У
// квартиры десятки стен, и «выгрузить все развёртки» без правила даёт пачку
// листов, половина которых пустая.
//
// Сцена одна на весь файл и нарочно неудобная: Г-образная кухня с нишей
// (невыпуклая — там обход контура единственный способ не запутаться), санузел
// со своей высотой потолка, перегородка внутри кухни, стена без всякого
// контура и метка на наружной грани. Каждый из этих случаев — отдельное
// решение, и каждое проверяется словами в своём тесте.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  applyRoomOutlines,
  createProject,
  elevationPlan,
  findWall,
  planMmToFraction,
  roomWallSides,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  wallElevation,
  wallElevations,
  wallLengthMm,
} from "../src/model.js";
import { DRAWING_PAPER, ELEVATION_FRAME_UNITS, ELEVATION_UNIT_MM, drawElevation } from "../src/render.js";
import {
  ELEVATION_MIN_WALL_MM,
  elevationFit,
  elevationSheetLayout,
  gostField,
  gostSheetSize,
} from "../src/gostSheet.js";
import { MONO_CLEAR, MONO_INK, MONO_PAPER, monoContext } from "../src/mono.js";

// ——— сцена ————————————————————————————————————————————————————————————

// Лист как у мастерской: 4000 × 3000 точек, десять миллиметров на точку, нуль
// в середине.
function scene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 4000, height: 3000 });
  let project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 }, meters: 40 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 3000).project;
  const frac = (mm) => planMmToFraction(project, schemeId, mm);

  const chain = (points, thicknessMm, closed) => {
    const ids = [];
    const last = closed ? points.length : points.length - 1;
    for (let i = 0; i < last; i += 1) {
      const result = addWall(project, {
        schemeId,
        aMm: points[i],
        bMm: points[(i + 1) % points.length],
        thicknessMm,
      });
      project = result.project;
      ids.push(result.wall.id);
    }
    return ids;
  };

  // Г-образная кухня: вершина (−1000, −1000) — вход в нишу, угол невыпуклый.
  const kitchen = [
    { x: -5000, y: -3000 },
    { x: -1000, y: -3000 },
    { x: -1000, y: -1000 },
    { x: 3000, y: -1000 },
    { x: 3000, y: 2000 },
    { x: -5000, y: 2000 },
  ];
  const kitchenWalls = chain(kitchen, 200, true);
  const bath = [
    { x: 5000, y: -3000 },
    { x: 8000, y: -3000 },
    { x: 8000, y: 0 },
    { x: 5000, y: 0 },
  ];
  const bathWalls = chain(bath, 150, true);
  // Перегородка внутри кухни и стена вне всяких контуров.
  const partition = chain([{ x: 0, y: 500 }, { x: 2000, y: 500 }], 100, false);
  const orphan = chain([{ x: 5000, y: 2500 }, { x: 9000, y: 2500 }], 200, false);

  const kitchenRoom = addRoom(project, "Кухня");
  project = kitchenRoom.project;
  project = addOutline(project, { schemeId, roomId: kitchenRoom.room.id, points: kitchen.map(frac) }).project;
  project = setRoomWallHeight(project, kitchenRoom.room.id, 2700).project;
  const bathRoom = addRoom(project, "Санузел");
  project = bathRoom.project;
  project = addOutline(project, { schemeId, roomId: bathRoom.room.id, points: bath.map(frac) }).project;
  project = setRoomWallHeight(project, bathRoom.room.id, 2500).project;
  // Комната без стен — в выбор попасть не должна.
  const balcony = addRoom(project, "Балкон");
  project = balcony.project;

  // Окно в южной стене кухни, дверь в западной.
  project = addOpening(project, {
    wallId: kitchenWalls[4],
    kind: "window",
    atMm: 2000,
    widthMm: 1800,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  project = addOpening(project, {
    wallId: kitchenWalls[5],
    kind: "door",
    atMm: 800,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  }).project;

  const typeId = (project.markTypes.find((type) => type.name.indexOf("Розетка") >= 0) || project.markTypes[0]).id;
  const mark = (mm, heightMm) => {
    const result = addMark(project, { schemeId, typeId, kind: "point", points: [frac(mm)] });
    project = result.project;
    if (heightMm !== null) {
      project = setMarkDimensions(project, result.mark.id, { heightAboveFloor: heightMm }).project;
    }
    return result.mark.id;
  };
  // Три метки на южной стене кухни изнутри (одна без высоты) и одна снаружи.
  mark({ x: -2500, y: 1800 }, 300);
  mark({ x: -1000, y: 1800 }, 1100);
  mark({ x: 500, y: 1800 }, null);
  const outside = mark({ x: 1500, y: 2200 }, 1500);
  mark({ x: 6000, y: -2800 }, 1200);
  project = applyRoomOutlines(project, schemeId).project;
  project = applyMarkWalls(project, schemeId).project;
  return {
    project,
    schemeId,
    kitchenWalls,
    bathWalls,
    partition: partition[0],
    orphan: orphan[0],
    kitchenId: kitchenRoom.room.id,
    bathId: bathRoom.room.id,
    balconyId: balcony.room.id,
    outside,
  };
}

const lengthsOf = (project, sides) => sides.map((side) => wallLengthMm(findWall(project, side.wallId)));

// ——— порядок задаёт обход контура ——————————————————————————————————————

test("стены комнаты идут в порядке обхода её контура — и на невыпуклой тоже", () => {
  const made = scene();
  const sides = roomWallSides(made.project, made.schemeId, made.kitchenId);
  // Стены самого контура, без перегородки внутри него.
  const onOutline = sides.filter((side) => side.wallId !== made.partition);
  assert.deepEqual(
    onOutline.map((side) => side.wallId),
    made.kitchenWalls,
    "обход должен дать стены в том же порядке, в каком идёт контур: " + JSON.stringify(lengthsOf(made.project, onOutline)),
  );
  // Ниша не ломает обход: длины читаются одним кругом 4000 → 2000 → 4000 →
  // 3000 → 8000 → 5000, а не вразнобой, как дала бы габаритная рамка.
  assert.deepEqual(lengthsOf(made.project, onOutline), [4000, 2000, 4000, 3000, 8000, 5000]);
});

test("порядок не зависит от того, с какого угла обвели комнату", () => {
  // Контур, нарисованный с другой вершины и в другую сторону, даёт тот же
  // круг: обход нормализуется по часовой и начинается от левого верхнего угла.
  const made = scene();
  const sides = roomWallSides(made.project, made.schemeId, made.kitchenId);
  const outline = made.project.outlines.find((item) => item.roomId === made.kitchenId);
  const turned = {
    ...made.project,
    outlines: made.project.outlines.map((item) =>
      item.id === outline.id
        ? { ...item, points: [...outline.points].reverse() }
        : item,
    ),
  };
  const other = roomWallSides(turned, made.schemeId, made.kitchenId);
  const names = (list) => list.map((side) => side.wallId + "/" + side.side);
  assert.deepEqual(names(other), names(sides), "обход против часовой должен дать тот же круг");
  // И обведённая с другой вершины — тоже: круг начинается от левого верхнего
  // угла контура, а не от того места, где человек поставил первую точку.
  const shifted = {
    ...made.project,
    outlines: made.project.outlines.map((item) =>
      item.id === outline.id ? { ...item, points: [...outline.points.slice(3), ...outline.points.slice(0, 3)] } : item,
    ),
  };
  assert.deepEqual(names(roomWallSides(shifted, made.schemeId, made.kitchenId)), names(sides));
});

test("каждая стена показана стороной внутрь комнаты, а высота взята у комнаты", () => {
  const made = scene();
  for (const side of roomWallSides(made.project, made.schemeId, made.kitchenId)) {
    const view = wallElevation(made.project, side.wallId, side.side);
    assert.equal(view.roomId, made.kitchenId, "сторона смотрит не в ту комнату");
    // Высота этажа 3000, у кухни 2700 — на листе должна стоять кухонная.
    assert.equal(view.heightMm, 2700);
  }
  for (const side of roomWallSides(made.project, made.schemeId, made.bathId)) {
    assert.equal(wallElevation(made.project, side.wallId, side.side).heightMm, 2500);
  }
});

test("перегородка внутри комнаты идёт на лист дважды — по разу на сторону", () => {
  const made = scene();
  const mine = roomWallSides(made.project, made.schemeId, made.kitchenId).filter(
    (side) => side.wallId === made.partition,
  );
  assert.deepEqual(
    mine.map((side) => side.side).sort(),
    ["left", "right"],
    "у перегородки две грани, и на них разные метки",
  );
});

// ——— что попадает в выбор ——————————————————————————————————————————————

test("комната без стен в выбор не попадает, а комната без меток — попадает", () => {
  const made = scene();
  const plan = elevationPlan(made.project, made.schemeId);
  assert.deepEqual(plan.rooms.map((room) => room.name), ["Кухня", "Санузел"]);
  // У санузла меток ровно одна, а стен четыре — и ни одна развёртка не пустая
  // в смысле «не нужна»: пустая стена с проёмом это тоже чертёж.
  const bath = plan.rooms.find((room) => room.name === "Санузел");
  assert.equal(bath.sides.length, 4);
  const withMarks = bath.sides.filter(
    (side) => wallElevation(made.project, side.wallId, side.side).marks.length > 0,
  );
  assert.equal(withMarks.length, 1);
});

test("объект без чертежа не даёт ни одного листа (G68)", () => {
  const blank = addScheme(createProject(), { name: "1 этаж", imageId: "plan", width: 1200, height: 800 });
  const plan = elevationPlan(blank.project, blank.scheme.id);
  assert.deepEqual(plan, { rooms: [], loose: [] });
  const layout = elevationSheetLayout([], {});
  assert.equal(layout.pages.length, 0, "пустой лист с одной рамкой — мусор в папке, а не ответ");
});

// ——— стены вне контура ————————————————————————————————————————————————

test("стена без всякого контура не теряется — она на листе «вне помещений»", () => {
  const made = scene();
  const loose = elevationPlan(made.project, made.schemeId).loose;
  const orphanSides = loose.filter((side) => side.wallId === made.orphan);
  assert.deepEqual(
    orphanSides.map((side) => side.side).sort(),
    ["left", "right"],
    "у стены, которой нет ни в одном контуре, на лист идут обе грани",
  );
});

test("наружная грань стены комнаты идёт на лист только с метками на ней", () => {
  const made = scene();
  const loose = elevationPlan(made.project, made.schemeId).loose;
  const south = made.kitchenWalls[4];
  const outer = loose.filter((side) => side.wallId === south);
  assert.equal(outer.length, 1, "на наружной грани южной стены стоит метка — её нельзя потерять");
  assert.equal(wallElevation(made.project, south, outer[0].side).marks.length, 1);
  // Остальные стены кухни другой стороной смотрят на улицу, и там пусто:
  // развёртку фасада никто не просил, а сама стена уже на листе кухни.
  for (const wallId of made.kitchenWalls) {
    if (wallId === south) continue;
    assert.equal(loose.filter((side) => side.wallId === wallId).length, 0);
  }
  // Убрали метку снаружи — и грань пропала из списка: лист заводится только
  // под то, на чём что-то есть.
  const without = { ...made.project, marks: made.project.marks.filter((mark) => mark.id !== made.outside) };
  assert.equal(elevationPlan(without, made.schemeId).loose.filter((side) => side.wallId === south).length, 0);
});

// ——— сколько развёрток на листе ————————————————————————————————————————

const blocks = (count, lengthMm, heightMm) =>
  Array.from({ length: count }, () => ({ lengthMm, heightMm }));

test("на лист идёт столько развёрток, сколько остаётся читаемыми", () => {
  const field = gostField(gostSheetSize("A4", "portrait"), "form3");
  // Четыре стены по четыре метра: на один лист читаемо встают три, но листов
  // всё равно выходит два — значит делим поровну, 2 + 2, и масштаб крупнее.
  const four = elevationFit(blocks(4, 4000, 2700), field);
  assert.equal(four.pages.length, 2);
  assert.deepEqual(four.pages, [{ from: 0, to: 2 }, { from: 2, to: 4 }]);
  assert.equal(four.perSheet, 2);
  assert.ok(four.wallMm >= ELEVATION_MIN_WALL_MM, "стена на бумаге " + four.wallMm.toFixed(1) + " мм");
  // Две короткие стены влезают на один лист целиком.
  const two = elevationFit(blocks(2, 1500, 2700), field);
  assert.equal(two.pages.length, 1);
  assert.equal(two.perSheet, 2);
  // Чем больше на листе, тем мельче — и ниже мерки читаемости не опускаемся.
  const many = elevationFit(blocks(12, 4000, 2700), field);
  assert.ok(many.wallMm >= ELEVATION_MIN_WALL_MM, "мелкий шрифт вместо второго листа");
  assert.ok(many.pages.length > 1);
});

test("масштаб на листе один, и он настоящий", () => {
  const made = scene();
  const sides = roomWallSides(made.project, made.schemeId, made.kitchenId);
  const elevations = wallElevations(made.project, sides);
  const layout = elevationSheetLayout(
    elevations.map((item) => ({ lengthMm: item.lengthMm, heightMm: item.heightShownMm })),
    { format: "A4" },
  );
  // Знаменатель выведен из того же `scale`, которым лист рисуется: второй
  // формулы для одного числа в сборке нет (G169).
  assert.ok(Math.abs(layout.denominator - 1 / layout.scale) < 1e-9);
  assert.match(layout.scaleText, /^М 1:/);
  // Самая длинная стена влезает в поле целиком — обрезать чертёж нельзя.
  const longest = Math.max(...elevations.map((item) => item.lengthMm));
  const sideMm = ELEVATION_FRAME_UNITS.side * ELEVATION_UNIT_MM;
  assert.ok(longest * layout.scale <= layout.field.width - sideMm + 1e-9);
  // И обещанный масштаб — тот, которым нарисовано: миллиметр стены ложится
  // ровно в `scale` миллиметра бумаги.
  const log = [];
  const ctx = scribe(log);
  const box = { x: 0, y: 0, width: layout.field.width, height: layout.boxMm.height };
  const drawn = drawElevation(ctx, elevations[0], box, { unit: ELEVATION_UNIT_MM, scale: layout.scale });
  assert.ok(Math.abs(drawn.width - elevations[0].lengthMm * layout.scale) < 1e-9);
  assert.ok(Math.abs(drawn.height - elevations[0].heightShownMm * layout.scale) < 1e-9);
});

test("мелкий лист поднимает формат, а не шрифт", () => {
  // Стена двадцать метров: на A4 она ниже мерки, и подбор уходит на формат
  // крупнее — вместо того чтобы молча отдать нечитаемый чертёж.
  const picked = elevationSheetLayout(blocks(1, 20000, 2700), {});
  assert.notEqual(picked.sheet.format, "A4");
  assert.equal(picked.tooSmall, false);
  // Заданный руками формат остаётся заданным, но о мелкоте говорится вслух.
  const forced = elevationSheetLayout(blocks(1, 20000, 2700), { format: "A4" });
  assert.equal(forced.sheet.format, "A4");
  assert.equal(forced.tooSmall, true);
});

// ——— отрисовка: один вызов на экран и на бумагу ————————————————————————

function scribe(log) {
  const impl = { measureText: (value) => ({ width: String(value).length * 6 }) };
  return new Proxy(impl, {
    get: (target, key) =>
      key in target ? target[key] : (...args) => log.push(String(key) + "(" + args.join(",") + ")"),
    set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
  });
}

test("экранная развёртка не изменилась: единица по умолчанию — точка", () => {
  const made = scene();
  const view = wallElevation(made.project, made.kitchenWalls[4], "right");
  const box = { x: 0, y: 0, width: 900, height: 300 };
  const plain = [];
  const withUnit = [];
  drawElevation(scribe(plain), view, box);
  drawElevation(scribe(withUnit), view, box, { unit: 1 });
  assert.deepEqual(withUnit, plain, "`unit: 1` обязан рисовать точно то же, что рисовалось до таска 130");
  assert.ok(plain.length > 50);
});

test("подпись над чертежом — номер по обходу, и только когда её просят", () => {
  const made = scene();
  const view = wallElevation(made.project, made.kitchenWalls[4], "right");
  const box = { x: 0, y: 0, width: 900, height: 300 };
  const without = [];
  const withLabel = [];
  drawElevation(scribe(without), view, box);
  drawElevation(scribe(withLabel), view, box, { label: "7. Стена 8000 мм" });
  assert.ok(
    withLabel.some((line) => line.indexOf("7. Стена 8000 мм") >= 0),
    "номер обхода на бумаге и есть порядок: без него ряд чертежей — россыпь",
  );
  assert.ok(!without.some((line) => line.indexOf("Стена 8000 мм") >= 0), "на экране подпись стоит строкой над полосой");
});

// Кисть со стопкой: `save`/`restore` работают по-настоящему, и видно, каким
// цветом на самом деле проведена каждая линия.
function strokeColors(elevation, box, options) {
  const stack = [];
  let state = {};
  const log = [];
  const impl = {
    measureText: (value) => ({ width: String(value).length * 6 }),
    save: () => stack.push({ ...state }),
    restore: () => {
      state = stack.pop() || state;
    },
  };
  const ctx = new Proxy(impl, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "stroke" || key === "strokeRect") return () => log.push(state.strokeStyle);
      return () => {};
    },
    set(target, key, value) {
      state[key] = value;
      return true;
    },
  });
  drawElevation(ctx, elevation, box, options);
  return log;
}

test("размерная цепочка проведена краской, а не бумагой", () => {
  // Подпись размера рисует подложку цветом бумаги, и без возврата кисти этим
  // же цветом уходила следующая линия: размерная цепочка под стеной была
  // бледно-серой на цветном листе и пропадала на чёрно-белом.
  const made = scene();
  const view = wallElevation(made.project, made.kitchenWalls[4], "right");
  const colors = strokeColors(view, { x: 0, y: 0, width: 900, height: 320 });
  assert.ok(colors.length > 8);
  assert.deepEqual(
    colors.filter((color) => color === DRAWING_PAPER),
    [],
    "линия цветом бумаги — это линия, которой на листе нет",
  );
});

test("в чёрно-белом развёртка идёт тушью: ни одной цветной краски", () => {
  const made = scene();
  const sides = roomWallSides(made.project, made.schemeId, made.kitchenId);
  const log = [];
  const ctx = monoContext(scribe(log));
  for (const elevation of wallElevations(made.project, sides)) {
    drawElevation(ctx, elevation, { x: 0, y: 0, width: 600, height: 200 }, { unit: 0.32 });
  }
  const paints = log.filter((line) => line.startsWith("fillStyle=") || line.startsWith("strokeStyle="));
  assert.ok(paints.length > 20);
  const allowed = new Set([MONO_INK, MONO_PAPER, MONO_CLEAR]);
  const colored = paints.filter((line) => !allowed.has(line.slice(line.indexOf("=") + 1)));
  assert.deepEqual(colored, [], "на чёрно-белом листе краске места нет");
});

// ——— G68 ——————————————————————————————————————————————————————————————

test("G68: выгрузка развёрток ничего не пишет в объект", () => {
  const made = scene();
  const before = JSON.stringify(made.project);
  const plan = elevationPlan(made.project, made.schemeId);
  for (const room of plan.rooms) wallElevations(made.project, room.sides);
  wallElevations(made.project, plan.loose);
  assert.equal(JSON.stringify(made.project), before);
});
