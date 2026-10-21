// **Показанная высота стены — одна на объём и развёртку** (таск 228, G340).
//
// Шов, который этот файл держит, стоил сборке двух расхождений подряд. Сперва
// было два числа и два способа: объём рисовал комнату плоскими 2700, развёртка
// выводила «не ниже 2000 и на 300 выше верхнего проёма», и про одну стену
// человек читал «показано 2300» на полосе и «комната показана высотой 2700» в
// окне. Таск 173 свёл **число** (2800, слово заказчика), но не **вывод**: лист
// по-прежнему поднимался над тем, что стоит на этой стене, а комната оставалась
// плоской — то есть у стены с высоким шкафом числа снова были разные, и объём
// срезал потолком дверь, которую лист рисовал целиком.
//
// Поэтому проверяется не значение, а **согласие**: что бы ни стояло на схеме,
// развёртка любой её стены и комната объёма показывают одно число. Проверять
// согласие, а не числа, важно: числа заказчик вправе поменять одним словом,
// согласие — нет.
import test from "node:test";
import assert from "node:assert/strict";

import {
  WALL_HEIGHT_AIR_MM,
  WALL_HEIGHT_FALLBACK_MM,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  createProject,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  wallElevation,
  wallHeightShownMm,
  wallsOnScheme,
} from "../src/model.js";
import { volumeHeightMm, volumeRooms, volumeScene } from "../src/volume.js";
import { volumeNotes } from "../src/panels/volume.js";
import { elevationNote } from "../src/panels/elevation.js";

// Комната 4 × 3 м двумя стенами: нижняя и правая. Высота схемы не задана —
// именно этот случай и расходился.
function scene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  const schemeId = added.scheme.id;
  const bottom = addWall(project, {
    schemeId,
    aMm: { x: 2000, y: 1500 },
    bMm: { x: -2000, y: 1500 },
    thicknessMm: 200,
  });
  const right = addWall(bottom.project, {
    schemeId,
    aMm: { x: 2000, y: -1500 },
    bMm: { x: 2000, y: 1500 },
    thicknessMm: 200,
  });
  const room = addRoom(right.project, "Кухня");
  const outlined = addOutline(room.project, {
    schemeId,
    roomId: room.room.id,
    points: [
      { x: -1900, y: -1400 },
      { x: 1900, y: -1400 },
      { x: 1900, y: 1400 },
      { x: -1900, y: 1400 },
    ].map((point) => ({
      x: 0.5 + point.x / 12000,
      y: 0.5 + point.y / 12000,
    })),
  });
  return {
    project: outlined.project,
    schemeId,
    roomId: room.room.id,
    wallIds: [bottom.wall.id, right.wall.id],
  };
}

// Все числа, какими поверхности описывают одну схему: развёртка каждой стороны
// каждой стены, комната объёма и сама схема.
function shownNumbers(project, schemeId) {
  const out = new Set();
  for (const wall of wallsOnScheme(project, schemeId)) {
    for (const side of ["left", "right"]) {
      const view = wallElevation(project, wall.id, side);
      if (view) out.add(view.heightShownMm);
    }
  }
  for (const room of volumeRooms(project, schemeId)) out.add(room.heightMm);
  out.add(volumeHeightMm(project, schemeId, null).mm);
  return [...out];
}

test("высота не задана и ничего высокого нет — одно умолчание у всех", () => {
  const box = scene();
  assert.deepEqual(shownNumbers(box.project, box.schemeId), [WALL_HEIGHT_FALLBACK_MM]);
});

test("высокая дверь на одной стене поднимает и соседнюю стену, и комнату объёма", () => {
  const box = scene();
  // Дверь ростом в умолчание: плоским числом ей срезало бы верхний косяк.
  const tall = addOpening(box.project, {
    wallId: box.wallIds[0],
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: WALL_HEIGHT_FALLBACK_MM,
    heightAboveFloorMm: 0,
  }).project;
  const raised = WALL_HEIGHT_FALLBACK_MM + WALL_HEIGHT_AIR_MM;
  // Одно число на всё: и на стену с дверью, и на пустую соседнюю, и на комнату.
  // До этого таска здесь было два — 3100 у стены с дверью и 2800 у всех прочих.
  assert.deepEqual(shownNumbers(tall, box.schemeId), [raised]);
  // Пустая соседняя стена — та, из-за которой правка и сделана: лист комнаты
  // рисовал бы её на 300 мм ниже стены с дверью, то есть два потолка в одной
  // комнате.
  const bare = wallElevation(tall, box.wallIds[1], "right");
  assert.equal(bare.heightShownMm, raised, "соседняя стена той же комнаты — того же потолка");
  assert.equal(bare.openings.length, 0, "на ней действительно ничего не стоит");
});

test("заданная высота выводом не перебивается — ни схемы, ни комнаты (G68)", () => {
  const box = scene();
  const own = setSchemeWallHeight(box.project, box.schemeId, 2400).project;
  assert.deepEqual(shownNumbers(own, box.schemeId), [2400], "число человека, и ничьё больше");
  // Даже ниже того, что стоит на схеме: задать высоту под уже стоящим проёмом
  // модель не даёт, а своё число ниже умолчания — право человека.
  const low = setRoomWallHeight(own, box.roomId, 2100).project;
  assert.equal(volumeHeightMm(low, box.schemeId, box.roomId).mm, 2100);
  assert.equal(volumeHeightMm(low, box.schemeId, null).mm, 2400, "вне комнаты — высота схемы");
});

test("строка объёма и строка развёртки говорят одно число", () => {
  const box = scene();
  const tall = addOpening(box.project, {
    wallId: box.wallIds[0],
    kind: "window",
    atMm: 500,
    widthMm: 900,
    heightMm: 1400,
    heightAboveFloorMm: 1600,
  }).project;
  const raised = 3000 + WALL_HEIGHT_AIR_MM;
  const built = volumeScene(tall, box.schemeId);
  assert.equal(built.heightMm, raised);
  assert.ok(built.notes.includes("noHeight"));
  const volumeLine = volumeNotes(built).join(" ");
  const elevationLine = elevationNote(wallElevation(tall, box.wallIds[1], "right"));
  assert.match(volumeLine, new RegExp(String(raised)), "окно объёма: " + volumeLine);
  assert.match(elevationLine, new RegExp(String(raised)), "полоса развёртки: " + elevationLine);
});

test("вывод только поднимает: ниже того, что на стене стоит, он не опускается", () => {
  const box = scene();
  const tall = addOpening(box.project, {
    wallId: box.wallIds[0],
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: 3400,
    heightAboveFloorMm: 0,
  }).project;
  for (const wall of wallsOnScheme(tall, box.schemeId)) {
    for (const side of ["left", "right"]) {
      const view = wallElevation(tall, wall.id, side);
      for (const opening of view.openings) {
        assert.ok(view.heightShownMm >= opening.topMm, "проём выше листа: " + opening.topMm);
      }
    }
  }
  assert.equal(wallHeightShownMm(tall, { schemeId: box.schemeId }).mm, 3400 + WALL_HEIGHT_AIR_MM);
});

test("показанного в объекте не остаётся: выведенное число никуда не пишется (G68)", () => {
  const box = scene();
  const before = JSON.stringify(box.project);
  const tall = addOpening(box.project, {
    wallId: box.wallIds[0],
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: 3000,
    heightAboveFloorMm: 0,
  }).project;
  volumeScene(tall, box.schemeId);
  wallElevation(tall, box.wallIds[0], "right");
  assert.equal(wallHeightShownMm(tall, { schemeId: box.schemeId }).known, false);
  for (const scheme of tall.schemes) {
    assert.ok(!Object.prototype.hasOwnProperty.call(scheme, "wallHeightMm"), "схеме высоту не дописали");
  }
  for (const room of tall.rooms) {
    assert.ok(!Object.prototype.hasOwnProperty.call(room, "wallHeightMm"), "комнате высоту не дописали");
  }
  // И сам объект до проёма — тот же: показ в него не пишет ничего.
  volumeScene(box.project, box.schemeId);
  wallElevation(box.project, box.wallIds[0], "right");
  assert.equal(JSON.stringify(box.project), before);
});
