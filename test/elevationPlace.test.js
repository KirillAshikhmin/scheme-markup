// Где метка стоит на развёртке — дефект D27 и требование G203 (таск 143).
//
// D27, слова заказчика: «Метки по горизонтали должны быть ровно в том месте,
// как и на схеме, сейчас могут разъезжаться». Разъезжались они из-за того, что
// «вплотную» (G190) применялось всегда: ряд целиком вставал серединой в
// середину группы и раскладывался от края, то есть расстояния между метками
// брались не с плана, а из ширины знаков. Здесь это проверяется **числом**:
// отступ знака на развёртке против настоящего отступа метки на плане.
//
// G203: «вертикальные и горизонтальные группы должны поддерживаться». Чем
// группа различается на плане — отступом или высотой, — тем и строится.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addToGroup,
  addWall,
  applyMarkWalls,
  blockStepPx,
  createProject,
  findMark,
  markDimensions,
  markSizes,
  markWall,
  planMmToFraction,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  updateMark,
  wallElevation,
} from "../src/model.js";
import { drawElevation, elevationMarkBox, elevationPack, elevationRows } from "../src/render.js";
import { elevationNote } from "../src/panels/elevation.js";
import { volumeScene } from "../src/volume.js";

// ——— чистая раскладка по оси ——————————————————————————————————————————

test("ряд, нарисованный врозь, раскладка не трогает вовсе", () => {
  // Главное свойство: пока знаки не налезают, место каждого — его собственное.
  // Это и есть D27 — «ровно в том месте, как и на схеме».
  const places = [100, 300, 500];
  assert.deepEqual(elevationPack(places, [80, 80, 80]), places);
  // Край к краю — ещё не налезание: двести между центрами при ширине сто.
  assert.deepEqual(elevationPack([0, 200], [100, 100]), [0, 200]);
  // И одиночка сама по себе.
  assert.deepEqual(elevationPack([777], [18]), [777]);
});

test("налезающие расходятся вплотную, а середина ряда остаётся на месте", () => {
  // Три подрозетника, нарисованные на плане в сорока миллиметрах друг от
  // друга, шириной по восемьдесят: встают край к краю.
  const packed = elevationPack([1000, 1040, 1080], [80, 80, 80]);
  assert.deepEqual(packed, [960, 1040, 1120], "рамка встала не вплотную");
  const middle = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.equal(middle(packed), middle([1000, 1040, 1080]), "середина ряда уехала с места");
  // Раздвигается ровно столько, сколько надо: просвет, который был, остаётся.
  const mixed = elevationPack([0, 50, 400], [80, 80, 80]);
  assert.deepEqual(mixed, [-10, 70, 390], "раздвинулось больше необходимого");
  assert.equal(middle(mixed), middle([0, 50, 400]));
});

// ——— ось ряда: вдоль стены или по высоте ——————————————————————————————

test("группа строится тем, чем различается: отступом — ряд, высотой — столбик", () => {
  const frame = elevationRows([
    { id: "a", label: "Р1", groupId: "g", groupLabel: "Р1Р2", fromMm: 1000, heightMm: 300 },
    { id: "b", label: "Р2", groupId: "g", groupLabel: "Р1Р2", fromMm: 1080, heightMm: 300 },
  ]);
  assert.equal(frame[0].axis, "row", "рамка подрозетников перестала быть рядом");

  const column = elevationRows([
    { id: "b", label: "Р2", groupId: "g", groupLabel: "Р1Р2", fromMm: 1000, heightMm: 1100 },
    { id: "a", label: "Р1", groupId: "g", groupLabel: "Р1Р2", fromMm: 1000, heightMm: 300 },
  ]);
  assert.equal(column[0].axis, "column", "столбик не распознан");
  assert.deepEqual(column[0].members.map((mark) => mark.id), ["a", "b"], "столбик читается снизу вверх");

  // Одиночка и группа без разброса — ряд: ряд умолчание, столбик случай.
  assert.equal(elevationRows([{ id: "x", label: "В1", groupId: null, fromMm: 500, heightMm: 900 }])[0].axis, "row");
});

// ——— число: отступ на развёртке против отступа на плане ————————————————

const WIDTH = 1200;
const HEIGHT = 800;
const MARK_SIZE = 10;
const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

// Комната с нижней стеной 4000 мм; нуль чертежа в середине, сто точек плана на
// метр. Розетки собраны ручкой «+» в одну группу и расставлены по чертежу
// точно — так же, как их расставляет рука, только без промаха мышью.
function frame(offsets, heights) {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: WIDTH, height: HEIGHT });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  const schemeId = added.scheme.id;
  const wall = addWall(project, {
    schemeId,
    aMm: { x: -2000, y: 1500 },
    bMm: { x: 2000, y: 1500 },
    thicknessMm: 200,
  });
  project = setSchemeWallHeight(wall.project, schemeId, 2700).project;
  const first = addMark(project, {
    schemeId,
    typeId: typeId(project, "Р"),
    points: [planMmToFraction(project, schemeId, { x: -2000 + offsets[0], y: 1300 })],
  });
  project = first.project;
  const ids = [first.mark.id];
  let previous = first.mark.id;
  for (let index = 1; index < offsets.length; index += 1) {
    const next = addToGroup(project, previous, "right", { step: blockStepPx(MARK_SIZE) });
    project = next.project;
    ids.push(next.mark.id);
    previous = next.mark.id;
  }
  // Ставим каждую метку на свой отступ вдоль стены: стена идёт слева направо
  // от x = −2000, значит отступ вдоль неё — это x + 2000.
  offsets.forEach((offset, index) => {
    project = updateMark(project, ids[index], {
      points: [planMmToFraction(project, schemeId, { x: -2000 + offset, y: 1300 })],
    }).project;
    // `null` — высоту этой метке не задавали вовсе: так проверяется ступень
    // наследования, а не подстановка.
    if (heights[index] !== null) {
      project = setMarkDimensions(project, ids[index], { heightAboveFloor: heights[index] }).project;
    }
  });
  project = applyMarkWalls(project).project;
  return { project, schemeId, wallId: wall.wall.id, ids };
}

// Запись холста: сюда попадают и координаты, а не только имена вызовов, —
// проверяется именно место знака.
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

// Центры знаков, нарисованных кружками: `drawShape` рисует круг через `arc`.
// Знаки берутся без изображений (`views` не включён) нарочно — у кружка место
// видно числом, а не рисунком. У розетки кружков три (сам знак и два гнезда),
// и берётся внешний — тот, у которого радиус равен размеру знака.
const circles = (log, radius) =>
  log
    .filter((line) => line.startsWith("arc:"))
    .map((line) => line.slice(4).split(","))
    .filter((parts) => Math.abs(Number(parts[2]) - radius) < 1e-9)
    .map((parts) => Number(parts[0]))
    .sort((first, second) => first - second);

// Размер знака на развёртке — `9 * unit` (см. `drawElevation`).
const SIGN_RADIUS = 9;

test("D27: отступ знака на развёртке равен отступу метки на плане", () => {
  // Розетки собраны ручкой «+»: шаг блока — 2,22 знака, то есть 222 мм на
  // этом плане. Это и есть случай заказчика — на плане они врозь.
  const built = frame([2000, 2222, 2444], [300, 300, 300]);
  const offsets = built.ids.map((id) => markWall(findMark(built.project, id)).atMm);
  assert.deepEqual(offsets, [2000, 2222, 2444], "метки встали на плане не туда");

  // Взгляд с левой стороны стены зеркалит отсчёт (таск 129): «от угла А» на
  // листе — это «4000 минус отступ» на плане. Другого превращения между планом
  // и развёрткой быть не должно, и оно проверяется тем же числом.
  const elevation = wallElevation(built.project, built.wallId, "left");
  const mirrored = offsets.map((at) => elevation.lengthMm - at).sort((first, second) => first - second);
  assert.deepEqual(elevation.marks.map((mark) => mark.fromMm), mirrored);

  const { ctx, log } = recorder();
  const box = { x: 0, y: 0, width: 1000, height: 600 };
  const drawn = drawElevation(ctx, elevation, box, { unit: 1 });
  const expected = mirrored.map((at) => drawn.x + at * drawn.scale);
  const places = circles(log, SIGN_RADIUS);
  assert.equal(places.length, 3, "нарисовано не три знака: " + places.length);
  places.forEach((place, index) => {
    const off = Math.abs(place - expected[index]) / drawn.scale;
    assert.ok(off < 0.5, "знак " + index + " уехал от плана на " + Math.round(off) + " мм");
  });
});

test("D27: подрозетники вплотную — но серединой там, где они на плане", () => {
  // Та же группа, расставленная вплотную по-настоящему: по сорок миллиметров
  // между центрами при знаке в 18 точек холста. Здесь «вплотную» и работает —
  // и обязано держать середину группы на месте.
  const built = frame([2000, 2040, 2080], [300, 300, 300]);
  const elevation = wallElevation(built.project, built.wallId, "left");
  const { ctx, log } = recorder();
  const drawn = drawElevation(ctx, elevation, { x: 0, y: 0, width: 1000, height: 600 }, { unit: 1 });
  const places = circles(log, SIGN_RADIUS);
  assert.equal(places.length, 3);
  const middle = places.reduce((sum, value) => sum + value, 0) / places.length;
  const expected = drawn.x + (elevation.lengthMm - 2040) * drawn.scale;
  assert.ok(Math.abs(middle - expected) < 1e-6, "середина рамки уехала с места, где она на плане");
  // И расходятся они ровно на ширину знака — вплотную, без просвета.
  assert.ok(Math.abs(places[1] - places[0] - 18) < 1e-6, "подрозетники встали не вплотную");
  assert.ok(Math.abs(places[2] - places[1] - 18) < 1e-6);
});

// ——— G203: высота группы ———————————————————————————————————————————————
//
// Слова заказчика: «если в группе у хотя бы одной метки есть высота, то она
// распространяется на все метки». Распространяется именно **недостающая**:
// метка со своей высотой её не теряет, иначе столбик подрозетников, который
// заказчик просил тем же письмом, собрать было бы нельзя.

// Высоты здесь нарочно не 300: у розетки в стартовом справочнике умолчание
// типа — ровно 300 (G192), и на нём не видно, чья высота победила.
const heightsOf = (project, ids) => ids.map((id) => markSizes(project, findMark(project, id)).heightAboveFloor);

test("G203: высота одной метки группы становится высотой тех, у кого своей нет", () => {
  const built = frame([2000, 2222, 2444], [null, 1100, null]);
  assert.deepEqual(heightsOf(built.project, built.ids), [1100, 1100, 1100], "высота по группе не разошлась");

  // Но в объекте она **не записана**: это ступень наследования, а не правка
  // данных (G68 — метка осталась такой, какой её оставил человек).
  const bare = built.ids.filter((id) => markDimensions(findMark(built.project, id)).heightAboveFloor === null);
  assert.equal(bare.length, 2, "высота проставлена в метки, а не унаследована");
  for (const id of bare) {
    const sizes = markSizes(built.project, findMark(built.project, id));
    assert.equal(sizes.heightAboveFloorOwn, false, "унаследованная высота выдана за свою");
    assert.equal(sizes.heightAboveFloorFrom, "group", "высота пришла не от группы");
  }

  // И на стене стоят все три — до этого две из них уходили полосой «высота не
  // задана» под пол.
  const elevation = wallElevation(built.project, built.wallId, "left");
  assert.deepEqual(elevation.marks.map((mark) => mark.heightMm), [1100, 1100, 1100]);
  // Подпись листа не называет их догадкой: число записал человек, просто у
  // соседней метки той же группы.
  assert.equal(elevationNote(elevation, null), "", "развёртка назвала высоту группы умолчанием типа");
});

test("G203: своя высота старше группы — на этом держится столбик", () => {
  // Две розетки в одном месте стены и на разных высотах: на плане это стопка
  // (G181), на развёртке — столбик.
  const built = frame([2000, 2000], [300, 1100]);
  assert.deepEqual(heightsOf(built.project, built.ids), [300, 1100], "своя высота метки потерялась");

  const elevation = wallElevation(built.project, built.wallId, "left");
  const rows = elevationRows(elevation.marks);
  assert.equal(rows.length, 1, "группа разъехалась на два ряда");
  assert.equal(rows[0].axis, "column");

  const { ctx, log } = recorder();
  const drawn = drawElevation(ctx, elevation, { x: 0, y: 0, width: 1000, height: 600 }, { unit: 1 });
  const floor = drawn.y + drawn.height;
  // Знаки стоят друг над другом: каждый на своей высоте, оба на одном месте
  // стены. Это и есть «вертикальные группы поддерживаются».
  const signs = log
    .filter((line) => line.startsWith("arc:"))
    .map((line) => line.slice(4).split(","))
    .filter((parts) => Math.abs(Number(parts[2]) - SIGN_RADIUS) < 1e-9)
    .map((parts) => ({ x: Number(parts[0]), mm: (floor - Number(parts[1])) / drawn.scale }));
  assert.equal(signs.length, 2);
  assert.ok(Math.abs(signs[0].x - signs[1].x) < 1e-6, "столбик разъехался по горизонтали");
  assert.ok(Math.abs(signs[0].mm - 300) < 0.5, "нижний знак не на своей высоте: " + signs[0].mm);
  assert.ok(Math.abs(signs[1].mm - 1100) < 0.5, "верхний знак не на своей высоте: " + signs[1].mm);
});

// ——— D34 на листе: ноль — это низ (таск 269) ———————————————————————————
//
// Высота над полом — середина вещи, но у вещи с высотой **нуль** на нуле стоит
// её низ: объём это знал с дефекта D34, а лист центрировал силуэт на записанном
// числе всегда — и вертикальная лента 6000 мм висела на три метра под полом, а
// датчик протечки — на половину себя.
//
// Правило живёт у посадки в `model.js` (`axisOnFloor`), и спрашивают его оба.
// Здесь проверяется то, ради чего его зовёт лист: где знак, где силуэт и
// сходится ли лист с объёмом в миллиметрах.

// Вещь ростом 600 мм, стоящая на полу: вертикальная лента заказчика в
// уменьшенном виде (у него это 2800…6000 мм при нулевой высоте).
function standing(heightAboveFloor) {
  const built = frame([2000], [heightAboveFloor]);
  const project = setMarkDimensions(built.project, built.ids[0], { length: 40, width: 600 }).project;
  return { ...built, project };
}

// Высота знака над полом в миллиметрах: знаки рисуются кружком радиуса
// `SIGN_RADIUS`, и место видно числом, а не рисунком.
function signHeightsMm(log, drawn) {
  const floor = drawn.y + drawn.height;
  return log
    .filter((line) => line.startsWith("arc:"))
    .map((line) => line.slice(4).split(","))
    .filter((parts) => Math.abs(Number(parts[2]) - SIGN_RADIUS) < 1e-9)
    .map((parts) => (floor - Number(parts[1])) / drawn.scale);
}

test("D34 на листе: знак метки с нулевой высотой стоит на полу, а не половиной под ним", () => {
  const built = standing(0);
  assert.equal(markSizes(built.project, findMark(built.project, built.ids[0])).heightAboveFloor, 0);
  const elevation = wallElevation(built.project, built.wallId, "left");
  assert.equal(elevation.marks[0].heightMm, 0, "ноль не доехал до листа");
  // Вверх у вещи на стене идёт `width` — и правило картинки записанных чисел не
  // трогает (G68).
  assert.equal(elevation.marks[0].sizeMm.height, 600, "вверх на листе пошло не то поле");

  const { ctx, log } = recorder();
  const drawn = drawElevation(ctx, elevation, { x: 0, y: 0, width: 1000, height: 600 }, { unit: 1 });
  const signs = signHeightsMm(log, drawn);
  assert.equal(signs.length, 1, "нарисован не один знак: " + signs.length);
  // Низ знака — на линии пола: середина поднята на половину его меры (у знака
  // она своя, квадрат `elevationMarkBox`), и в пол не ушла ни одна его точка.
  assert.ok(signs[0] > 0, "знак остался серединой на нуле: " + signs[0]);
  assert.ok(Math.abs(signs[0] * drawn.scale - SIGN_RADIUS) < 1e-6, "знак встал не низом на полу: " + signs[0]);
});

test("D34 на листе: пятьдесят миллиметров человек написал сам — середина остаётся на пятидесяти", () => {
  const built = standing(50);
  const elevation = wallElevation(built.project, built.wallId, "left");
  const { ctx, log } = recorder();
  const drawn = drawElevation(ctx, elevation, { x: 0, y: 0, width: 1000, height: 600 }, { unit: 1 });
  const signs = signHeightsMm(log, drawn);
  assert.equal(signs.length, 1);
  // Правило, сработай оно здесь, поставило бы знак в другое место — иначе
  // проверка ниже не различала бы ничего.
  const onFloorMm = SIGN_RADIUS / drawn.scale;
  assert.ok(Math.abs(onFloorMm - 50) > 1, "масштаб подобран так, что проверять нечего: " + onFloorMm);
  // Ровно пятьдесят: правило узкое — двигается только нуль.
  assert.ok(Math.abs(signs[0] - 50) < 0.5, "число человека перетолковали: " + signs[0]);
});

// Силуэт, нарисованный изображением вещи: его середина снимается с записи
// холста (изображение розетки симметрично по вертикали), а мера — у той же
// `elevationMarkBox`, которой его рисует лист. Правило здесь не повторяется:
// место берётся с картинки, размер — у двери листа.
function silhouetteMm(project, wallId, markId) {
  const elevation = wallElevation(project, wallId, "left");
  const mark = elevation.marks.find((item) => item.id === markId);
  const { ctx, log } = recorder();
  const drawn = drawElevation(ctx, elevation, { x: 0, y: 0, width: 1000, height: 600 }, { unit: 1, views: true });
  const floor = drawn.y + drawn.height;
  // Изображение рисуется внутри своей пары `save`/`restore` — единственной
  // вложенной в развёртке без проёмов и поворотов.
  const opened = log.indexOf("save:", log.indexOf("save:") + 1);
  assert.ok(opened > 0, "изображение вещи не нарисовано");
  const closed = log.indexOf("restore:", opened);
  const ys = [];
  for (const line of log.slice(opened, closed)) {
    if (!line.startsWith("moveTo:") && !line.startsWith("lineTo:")) continue;
    ys.push(Number(line.split(":")[1].split(",")[1]));
  }
  assert.ok(ys.length > 0, "у изображения не нашлось ни одной точки");
  const centreMm = (floor - (Math.min(...ys) + Math.max(...ys)) / 2) / drawn.scale;
  const halfMm = elevationMarkBox(mark, drawn.scale, 1, true).height / 2 / drawn.scale;
  return { centreMm, bottomMm: centreMm - halfMm, topMm: centreMm + halfMm };
}

// Тело вещи в объёме: низ, верх и середина — те же три числа.
function bodyMm(project, schemeId, markId) {
  const place = volumeScene(project, schemeId, {}).marks.find((item) => item.markId === markId);
  const prism = place.prisms[0];
  return { centreMm: place.heightMm, bottomMm: prism.bottomMm, topMm: prism.topMm };
}

test("D34: лист и объём говорят об одной метке одно — и у нуля, и у высоты", () => {
  for (const heightAboveFloor of [0, 1100]) {
    const built = standing(heightAboveFloor);
    const sheet = silhouetteMm(built.project, built.wallId, built.ids[0]);
    const body = bodyMm(built.project, built.schemeId, built.ids[0]);
    for (const key of ["bottomMm", "topMm", "centreMm"]) {
      assert.ok(
        Math.abs(sheet[key] - body[key]) < 1,
        "при высоте " +
          heightAboveFloor +
          " лист и объём разошлись в " +
          key +
          ": " +
          Math.round(sheet[key]) +
          " против " +
          body[key],
      );
    }
    // И числа те самые: у нуля вещь занимает от нуля до своего роста, у
    // заданной высоты — половину роста в обе стороны от неё.
    const expected = heightAboveFloor === 0 ? { bottomMm: 0, topMm: 600 } : { bottomMm: 800, topMm: 1400 };
    assert.equal(body.bottomMm, expected.bottomMm, "объём поставил тело не туда");
    assert.equal(body.topMm, expected.topMm);
  }
});
