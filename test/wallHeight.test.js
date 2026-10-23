// Своя высота стены, потолок по стенам и деление стены (правка после сборки
// сценариев).
//
// Слова заказчика: «Хочу сделать балкон, рисую стены, потом ставлю высоту
// помещения балкона в 10 см, в итоге стена всё равно есть. А ещё потолок надо
// убрать. А лучше высоту задавать не помещениям, а конкретным стенам. и, если
// высота стены 0, то там потолка нет, только пол, если не указано иное. В
// общем французский балкон, хочу у него убрать 3 стены (высоту 0 поставить)»;
// «по Белому дому, там есть помещение двусветное, и часть стен должны быть в 2
// этажа, а вот оно почему-то задевает лишние стены»; «Общую высоту схемы задать
// ок, а потом уже править для каждого отрезка стены».
import test from "node:test";
import assert from "node:assert/strict";

import {
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  createProject,
  findRoom,
  findWall,
  openingsInWall,
  planMmToFraction,
  roomHasCeiling,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setRoomCeiling,
  setRoomWallHeight,
  setSchemeWallHeight,
  setWallHeight,
  splitWall,
  wallElevation,
  wallHeightInheritedMm,
  wallHeightMm,
  wallSplitStops,
  addMark,
} from "../src/model.js";
import {
  VOLUME_CEILING_RGB,
  VOLUME_FLOOR_RGB,
  VOLUME_WALL_RGB,
  volumeClimateGeometry,
  volumeDayLevels,
  volumeRooms,
  volumeScene,
  volumeWallHeights,
} from "../src/volume.js";
import { workshopSplitAt, workshopWallNote } from "../src/panels/workshop.js";
import { elevationNote } from "../src/panels/elevation.js";
import { roomsRows } from "../src/panels/rooms.js";
import { drawDrawing } from "../src/render.js";

const at = (project, schemeId, point) => planMmToFraction(project, schemeId, point);

/**
 * Кухня 4 × 3 м и балкон 2 × 1,2 м на южной стене. Южная стена дома идёт от
 * (2000, 1500) к (−2000, 1500) — третья в кольце, — и к ней примыкают обе
 * боковые стены балкона: это и есть точки, где её удобно делить.
 */
function balconyHouse() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  const wall = (a, b) => {
    const put = addWall(project, { schemeId, aMm: a, bMm: b, thicknessMm: 200 });
    project = put.project;
    return put.wall.id;
  };
  const house = [
    wall({ x: -2000, y: -1500 }, { x: 2000, y: -1500 }),
    wall({ x: 2000, y: -1500 }, { x: 2000, y: 1500 }),
    wall({ x: 2000, y: 1500 }, { x: -2000, y: 1500 }),
    wall({ x: -2000, y: 1500 }, { x: -2000, y: -1500 }),
  ];
  const balcony = [
    wall({ x: -1000, y: 1500 }, { x: -1000, y: 2700 }),
    wall({ x: -1000, y: 2700 }, { x: 1000, y: 2700 }),
    wall({ x: 1000, y: 2700 }, { x: 1000, y: 1500 }),
  ];
  const room = (name, points) => {
    const put = addRoom(project, name);
    project = put.project;
    project = addOutline(project, { schemeId, roomId: put.room.id, points: points.map((point) => at(project, schemeId, point)) }).project;
    return put.room.id;
  };
  const kitchen = room("Кухня", [
    { x: -1900, y: -1400 },
    { x: 1900, y: -1400 },
    { x: 1900, y: 1400 },
    { x: -1900, y: 1400 },
  ]);
  const balconyId = room("Балкон", [
    { x: -900, y: 1600 },
    { x: 900, y: 1600 },
    { x: 900, y: 2600 },
    { x: -900, y: 2600 },
  ]);
  // Балконная дверь в южной стене дома: отступ 1500 от (2000, 1500) — x = 500…−300.
  project = addOpening(project, {
    wallId: house[2],
    kind: "door",
    atMm: 1500,
    widthMm: 800,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  }).project;
  return { project, schemeId, house, balcony, kitchen, balconyId };
}

/** Три стены балкона в ноль — французский балкон заказчика. */
function frenchBalcony(height = 0) {
  const scene = balconyHouse();
  let project = scene.project;
  for (const wallId of scene.balcony) project = setWallHeight(project, wallId, height).project;
  return { ...scene, project };
}

// Грани в плане балкона (x −1100…1100, y 1600…2800), выше пола.
// Стены — строго за гранью дома (y > 1600: там стоит его южная стена), пол и
// потолок балкона — от самой грани.
const inBalcony = (face, fromY = 1601) =>
  face.p.every((point) => point.x >= -1101 && point.x <= 1101 && point.y >= fromY && point.y <= 2801);
const onBalcony = (face) => inBalcony(face, 1590);
const upright = (face) => face.p.some((point) => point.z > 1);

test("G68: без своей высоты стена считается как считалась — высота помещения только поднимает", () => {
  const scene = balconyHouse();
  const before = JSON.stringify(scene.project);
  // Тот самый случай заказчика: балкону задали 100 мм, а стены стоят. Правило
  // прежнее и названо в модели: улица держит стену высотой схемы.
  const low = setRoomWallHeight(scene.project, scene.balconyId, 100).project;
  const heights = volumeWallHeights(low, scene.schemeId, 2700);
  for (const wallId of scene.balcony) assert.equal(heights.get(wallId), 2700, "помещение опустило стену");
  for (const wallId of [...scene.house, ...scene.balcony]) {
    assert.equal(wallHeightMm(low, wallId), wallHeightInheritedMm(low, wallId));
    assert.equal(findWall(low, wallId).heightMm, undefined, "стене дописали поле, которого не было");
  }
  // Потолок у прежнего объекта — везде, ключа у помещений нет.
  assert.ok(volumeRooms(scene.project, scene.schemeId).every((room) => room.hasCeiling === true));
  assert.equal(findRoom(scene.project, scene.balconyId).hasCeiling, undefined);
  volumeScene(scene.project, scene.schemeId);
  assert.equal(JSON.stringify(scene.project), before, "сборка сцены изменила объект");
});

test("своя высота стены: ноль — значение, пусто снимает ключ, проём не даёт опустить стену", () => {
  const scene = balconyHouse();
  const zero = setWallHeight(scene.project, scene.balcony[0], "0");
  assert.equal(zero.changed, true);
  assert.equal(findWall(zero.project, scene.balcony[0]).heightMm, 0);
  assert.equal(wallHeightMm(zero.project, scene.balcony[0]), 0);
  assert.equal(setWallHeight(zero.project, scene.balcony[0], 0).changed, false, "то же число — пустой шаг истории");
  const back = setWallHeight(zero.project, scene.balcony[0], "");
  assert.equal(Object.prototype.hasOwnProperty.call(findWall(back.project, scene.balcony[0]), "heightMm"), false);
  assert.equal(setWallHeight(scene.project, scene.balcony[0], "").changed, false);
  assert.throws(() => setWallHeight(scene.project, scene.balcony[0], -5), /отрицательн/);
  // Дверь 2100 в южной стене: опустить стену под неё нельзя.
  assert.throws(() => setWallHeight(scene.project, scene.house[2], 2000), /Проём выше/);
  // Своя высота главнее схемы и в проверке проёма: окно на 5000 в стене двусвета.
  let tall = setWallHeight(scene.project, scene.house[0], 6000).project;
  tall = addOpening(tall, { wallId: scene.house[0], kind: "window", atMm: 1000, widthMm: 1000, heightMm: 1200, heightAboveFloorMm: 3800 }).project;
  assert.equal(openingsInWall(tall, scene.house[0]).length, 1);
  // И высота схемы со стеной своей высоты не спорит.
  assert.doesNotThrow(() => setSchemeWallHeight(tall, scene.schemeId, 2800));
  assert.throws(
    () => addOpening(scene.project, { wallId: scene.house[0], kind: "window", atMm: 1000, widthMm: 1000, heightMm: 1200, heightAboveFloorMm: 3800 }),
    /Проём выше/,
  );
});

test("французский балкон: три стены в ноль — стен и препятствий нет, пол есть, потолка нет", () => {
  const scene = frenchBalcony();
  const heights = volumeWallHeights(scene.project, scene.schemeId, 2700);
  for (const wallId of scene.balcony) assert.equal(heights.get(wallId), 0);
  const built = volumeScene(scene.project, scene.schemeId);
  const balconyWalls = built.faces.filter((face) => face.rgb === VOLUME_WALL_RGB && inBalcony(face) && upright(face));
  assert.deepEqual(balconyWalls, [], "у балкона остались стены");
  assert.ok(
    built.faces.some((face) => face.rgb === VOLUME_FLOOR_RGB && onBalcony(face) && !upright(face)),
    "у балкона пропал пол",
  );
  // Потолки — над полом: низ плиты перекрытия (под полом) того же цвета.
  const ceilings = built.faces.filter((face) => face.rgb === VOLUME_CEILING_RGB && face.p.every((point) => point.z > 0));
  assert.equal(ceilings.filter(onBalcony).length, 0, "у балкона потолок");
  assert.equal(ceilings.filter((face) => !onBalcony(face)).length, 1, "у кухни пропал потолок");
  // Ходить сквозь ноль можно: препятствий у балкона нет ни одного.
  assert.equal(built.solids.filter((solid) => solid.cy > 1700).length, 0, "стена в ноль держит человека");
  const rooms = volumeRooms(scene.project, scene.schemeId);
  assert.equal(rooms.find((room) => room.roomId === scene.balconyId).hasCeiling, false);
  assert.equal(rooms.find((room) => room.roomId === scene.kitchen).hasCeiling, true);
  // Под небом: грани балкона уличные — свет неба целиком, снег на них идёт.
  const day = volumeDayLevels(built, 1);
  assert.equal(day.has(scene.balconyId), false, "балкон светится светом окон, как комната");
  assert.equal(day.has(scene.kitchen), true);
  assert.ok(built.faces.filter((face) => face.room === scene.balconyId).every((face) => face.open === true));
  // Воздух: балкон — улица, балконная дверь ведёт наружу.
  const climate = volumeClimateGeometry(scene.project);
  assert.deepEqual(climate.rooms.map((room) => room.id), [scene.kitchen]);
  assert.equal(climate.ways.length, 1);
  assert.ok([climate.ways[0].a, climate.ways[0].b].includes(null), "дверь на балкон ведёт не на улицу");
});

test("потолок по стенам: парапет ниже этажа открывает небу, полустенка между помещениями — нет", () => {
  const parapet = frenchBalcony(1100);
  assert.equal(roomHasCeiling(parapet.project, parapet.balconyId, parapet.schemeId), false, "балкон с парапетом под крышей");
  assert.equal(roomHasCeiling(parapet.project, parapet.kitchen, parapet.schemeId), true);
  // Кусок южной стены между кухней и балконом ниже этажа — улицы за ним нет,
  // потолки на месте. Стену сперва делят по примыканиям: целиком она с краёв
  // выходит на улицу, и тогда кухня открылась бы честно.
  const scene = balconyHouse();
  const whole = setWallHeight(scene.project, scene.house[2], 2100).project;
  assert.equal(roomHasCeiling(whole, scene.kitchen, scene.schemeId), false, "кухня с низкой наружной стеной под крышей");
  const cut = splitWall(splitWall(scene.project, scene.house[2], 3000).project, scene.house[2], 1000);
  const middle = cut.second.id;
  const inner = setWallHeight(cut.project, middle, 2100).project;
  assert.equal(roomHasCeiling(inner, scene.kitchen, scene.schemeId), true);
  assert.equal(roomHasCeiling(inner, scene.balconyId, scene.schemeId), true);
  // Подшивной потолок 2500 у кухни и наружная стена своей высотой 2700: стена
  // не ниже этажа, потолок остаётся.
  let low = setRoomWallHeight(scene.project, scene.kitchen, 2500).project;
  low = setWallHeight(low, scene.house[0], 2700).project;
  assert.equal(roomHasCeiling(low, scene.kitchen, scene.schemeId), true, "подшивной потолок снял потолок");
  // Помещение, которому прежде задали 100 мм, открывается тем же парапетом.
  const legacy = setRoomWallHeight(parapet.project, parapet.balconyId, 100).project;
  assert.equal(roomHasCeiling(legacy, parapet.balconyId, parapet.schemeId), false);
});

test("«если не указано иное»: потолок ставят и снимают рукой, совпавший со стенами выбор снимает ключ", () => {
  const scene = frenchBalcony();
  // Крытая терраса: стены в ноль, а навес есть.
  const covered = setRoomCeiling(scene.project, scene.balconyId, true, scene.schemeId);
  assert.equal(covered.changed, true);
  assert.equal(findRoom(covered.project, scene.balconyId).hasCeiling, true);
  assert.equal(roomHasCeiling(covered.project, scene.balconyId, scene.schemeId), true);
  const built = volumeScene(covered.project, scene.schemeId);
  assert.equal(
    built.faces.filter((face) => face.rgb === VOLUME_CEILING_RGB && onBalcony(face) && face.p.every((point) => point.z > 0)).length,
    1,
  );
  // Обратно к стенам: «нет» совпадает с выводом — ключа нет.
  const back = setRoomCeiling(covered.project, scene.balconyId, false, scene.schemeId);
  assert.equal(Object.prototype.hasOwnProperty.call(findRoom(back.project, scene.balconyId), "hasCeiling"), false);
  assert.equal(setRoomCeiling(scene.project, scene.balconyId, false, scene.schemeId).changed, false);
  // Снять потолок у закрытой кухни — ключ `false`.
  const open = setRoomCeiling(scene.project, scene.kitchen, false, scene.schemeId);
  assert.equal(findRoom(open.project, scene.kitchen).hasCeiling, false);
  // Строка списка помещений говорит и что сейчас, и откуда.
  const rows = roomsRows(covered.project, scene.schemeId);
  const row = rows.find((item) => item.room.id === scene.balconyId);
  assert.equal(row.hasCeiling, true);
  assert.equal(row.ceilingChosen, true);
  const plain = roomsRows(scene.project, scene.schemeId).find((item) => item.room.id === scene.balconyId);
  assert.equal(plain.hasCeiling, false);
  assert.equal(plain.ceilingChosen, false);
});

test("деление стены: куски по месту, проёмы и метки уходят в свой кусок, по проёму не режут", () => {
  const scene = balconyHouse();
  const wallId = scene.house[2];
  // Розетка у западного конца южной стены — она уйдёт во второй кусок.
  const placed = addMark(scene.project, {
    schemeId: scene.schemeId,
    typeId: scene.project.markTypes[0].id,
    points: [at(scene.project, scene.schemeId, { x: -1500, y: 1400 })],
  });
  let project = setMarkWall(placed.project, placed.marks[0].id, { wallId, atMm: 3500 }).project;
  project = setWallHeight(project, wallId, 2600).project;
  const stops = wallSplitStops(project, wallId);
  assert.deepEqual(stops, [1000, 3000], "примыкания стен балкона не нашлись");
  assert.throws(() => splitWall(project, wallId, 1800), /проём/, "разрезали дверь");
  assert.throws(() => splitWall(project, wallId, 20), /не ближе/);
  const split = splitWall(project, wallId, 3000);
  assert.equal(split.first.id, wallId, "первый кусок потерял своё имя");
  assert.deepEqual(split.first.bMm, { x: -1000, y: 1500 });
  assert.deepEqual(split.second.aMm, { x: -1000, y: 1500 });
  assert.deepEqual(split.second.bMm, { x: -2000, y: 1500 });
  assert.equal(split.second.heightMm, 2600, "своя высота не досталась второму куску");
  assert.equal(split.second.thicknessMm, 200);
  assert.equal(openingsInWall(split.project, wallId).length, 1, "дверь ушла не туда");
  assert.equal(openingsInWall(split.project, wallId)[0].atMm, 1500);
  const mark = split.project.marks.find((item) => item.id === placed.marks[0].id);
  assert.equal(mark.wallId, split.second.id);
  assert.equal(mark.wallAtMm, 500);
  // Сумма длин — та же стена.
  const length = (wall) => Math.hypot(wall.bMm.x - wall.aMm.x, wall.bMm.y - wall.aMm.y);
  assert.equal(length(split.first) + length(split.second), 4000);
});

test("двусвет: высота помещения поднимает стену по её середине — разделённый фасад поднимается только у холла", () => {
  // Фасад 8 м одним росчерком, вдоль него холл (запад) и кабинет (восток);
  // перегородка между ними примыкает к фасаду в x = 0.
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 3000).project;
  const facade = addWall(project, { schemeId, aMm: { x: -3000, y: -1500 }, bMm: { x: 5000, y: -1500 }, thicknessMm: 200 });
  project = facade.project;
  project = addWall(project, { schemeId, aMm: { x: 0, y: -1500 }, bMm: { x: 0, y: 1500 }, thicknessMm: 200 }).project;
  const room = (name, from, to) => {
    const put = addRoom(project, name);
    project = put.project;
    project = addOutline(project, {
      schemeId,
      roomId: put.room.id,
      points: [
        { x: from, y: -1400 },
        { x: to, y: -1400 },
        { x: to, y: 1400 },
        { x: from, y: 1400 },
      ].map((point) => at(project, schemeId, point)),
    }).project;
    return put.room.id;
  };
  room("Холл", -2900, -100);
  const study = room("Кабинет", 100, 4900);
  // Двусветным заказчик делает кабинет: середина фасада (x = 1000) у него, и
  // весь фасад, включая холл, уходит на 6000 — «задевает лишние стены».
  project = setRoomWallHeight(project, study, 6000).project;
  assert.equal(wallHeightMm(project, facade.wall.id), 6000);
  const stops = wallSplitStops(project, facade.wall.id);
  assert.deepEqual(stops, [3000]);
  const split = splitWall(project, facade.wall.id, stops[0]);
  assert.equal(wallHeightMm(split.project, split.first.id), 3000, "кусок у холла остался в два этажа");
  assert.equal(wallHeightMm(split.project, split.second.id), 6000, "кусок у кабинета опустился");
  // Холл переходит в кабинет без перегородки (так на объекте заказчика холл
  // переходит в гостиную): примыкания нет, а граница помещений — место деления.
  const open = { ...project, walls: project.walls.filter((wall) => wall.id === facade.wall.id) };
  const outlines = open.outlines.map((outline, index) => {
    const [from, to] = index === 0 ? [-2900, 0] : [0, 4900];
    return {
      ...outline,
      points: [
        { x: from, y: -1400 },
        { x: to, y: -1400 },
        { x: to, y: 1400 },
        { x: from, y: 1400 },
      ].map((point) => at(open, schemeId, point)),
    };
  });
  assert.deepEqual(wallSplitStops({ ...open, outlines }, facade.wall.id), [3000], "граница помещений не нашлась");
});

test("развёртка стены высотой ноль: лист пустой, и об этом сказано словом", () => {
  const scene = frenchBalcony();
  const elevation = wallElevation(scene.project, scene.balcony[1], "left");
  assert.equal(elevation.heightShownMm, 0);
  assert.equal(elevation.heightKnown, true);
  assert.equal(elevation.heightMm, 0);
  assert.match(elevationNote(elevation, null), /стены нет/);
  // Своя высота у стены двусвета — на листе она же, с обеих сторон.
  const tall = setWallHeight(scene.project, scene.house[0], 5800).project;
  for (const side of ["left", "right"]) assert.equal(wallElevation(tall, scene.house[0], side).heightShownMm, 5800);
});

test("чертёж: стена высотой ноль — пунктир по граням, без заливки; подпись в списке говорит о ней", () => {
  const scene = frenchBalcony();
  const calls = [];
  const ctx = new Proxy(
    { lineWidth: 1 },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args) => {
              calls.push({ call: String(key), args, lineWidth: target.lineWidth });
              return { width: 10 };
            },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    },
  );
  const bridge = { toScreen: (point) => ({ x: point.x / 10, y: point.y / 10 }), pxPerMm: 0.1 };
  const only = { ...scene.project, walls: scene.project.walls.filter((wall) => wall.id === scene.balcony[1]), openings: [] };
  drawDrawing(ctx, { project: only, schemeId: scene.schemeId, bridge, labels: false });
  const dashed = calls.filter((item) => item.call === "setLineDash" && item.args[0].length > 0);
  assert.ok(dashed.length > 0, "стена в ноль нарисована сплошной");
  const strokes = calls.filter((item) => item.call === "stroke");
  assert.ok(strokes.every((item) => item.lineWidth < 5), "стена в ноль залита во всю толщину");
  const wall = findWall(scene.project, scene.balcony[1]);
  assert.match(workshopWallNote(wall), /высота 0/);
  assert.match(workshopWallNote(findWall(setWallHeight(scene.project, scene.balcony[1], 1100).project, scene.balcony[1])), /высота 1100/);
  assert.doesNotMatch(workshopWallNote(findWall(scene.project, scene.house[0])), /высота/);
});

test("мастерская: место деления притягивается к примыканию, у конца и по проёму — отказ", () => {
  const scene = balconyHouse();
  const wall = findWall(scene.project, scene.house[2]);
  const stops = wallSplitStops(scene.project, wall.id);
  const openings = openingsInWall(scene.project, wall.id);
  // Отступ 2970 у руки — притянулся к примыканию в 3000.
  const near = workshopSplitAt(wall, { x: -970, y: 1530 }, { stops, snapMm: 50, openings });
  assert.deepEqual(near, { atMm: 3000, snapped: true, ok: true, code: null });
  // Alt — миллиметр под рукой.
  assert.equal(workshopSplitAt(wall, { x: -970, y: 1500 }, { stops, snapMm: 50, free: true, openings }).atMm, 2970);
  // Вне притяжки — до десяти миллиметров.
  assert.equal(workshopSplitAt(wall, { x: 1263, y: 1500 }, { stops, snapMm: 50, openings }).atMm, 740);
  assert.equal(workshopSplitAt(wall, { x: 100, y: 1500 }, { stops, snapMm: 50, openings }).code, "wallSplitOpening");
  assert.equal(workshopSplitAt(wall, { x: 1990, y: 1500 }, { stops, snapMm: 5, openings }).code, "wallSplitEnd");
});
