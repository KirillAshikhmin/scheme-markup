// Объект в многоэтажном доме (правка без автопилота, 2026-11-20). Слова
// заказчика: «что бы указанный этаж у чертежа поднимал сам объект на нужную
// высоту — если объект квартира… Ну и, естественно, дом тоже отрисовать» и
// «в свойствах объекта добавить поле — количество этажей в здании».
import test from "node:test";
import assert from "node:assert/strict";
import {
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  createProject,
  projectBuilding,
  setPlanOrigin,
  setPlanScale,
  setProjectBuilding,
  setSchemeFloor,
} from "../src/model.js";
import { mergeProjects } from "../src/merge.js";
import {
  VOLUME_HOUSE_WING_MM,
  volumeGroundAim,
  volumeHallFaces,
  volumeHallSpan,
  volumeHallHolds,
  volumeHouseLift,
  volumeHouseOutline,
  volumeHouseParts,
  volumeScene,
} from "../src/volume.js";

function flat() {
  let project = createProject();
  const added = addScheme(project, { name: "План", imageId: "i", width: 1000, height: 1000 });
  project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meters: 10 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  const wall = (a, b) => {
    const made = addWall(project, { schemeId, aMm: a, bMm: b, thicknessMm: 200 });
    project = made.project;
    return made.wall.id;
  };
  // Комната 6 × 4 м, окно в северной стене.
  const north = wall({ x: 1000, y: 1000 }, { x: 7000, y: 1000 });
  wall({ x: 7000, y: 1000 }, { x: 7000, y: 5000 });
  wall({ x: 7000, y: 5000 }, { x: 1000, y: 5000 });
  wall({ x: 1000, y: 5000 }, { x: 1000, y: 1000 });
  project = addOpening(project, { wallId: north, kind: "window", atMm: 2000, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 900 }).project;
  const room = addRoom(project, { name: "Комната" });
  project = room.project;
  project = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: [{ x: 0.11, y: 0.11 }, { x: 0.69, y: 0.11 }, { x: 0.69, y: 0.49 }, { x: 0.11, y: 0.49 }],
  }).project;
  return { project, schemeId };
}

test("дом объекта — необязательный ключ: пустое убирает его, мусор читается как «не задано»", () => {
  const { project } = flat();
  assert.deepEqual(projectBuilding(project), { floors: null, storeyMm: null });
  assert.equal(Object.prototype.hasOwnProperty.call(project, "building"), false);
  assert.equal(setProjectBuilding(project, { floors: "" }).changed, false);
  const housed = setProjectBuilding(project, { floors: " 25 " }).project;
  assert.deepEqual(housed.building, { floors: 25 });
  assert.equal(setProjectBuilding(housed, { floors: 25 }).changed, false);
  const emptied = setProjectBuilding(housed, { floors: "" }).project;
  assert.equal(Object.prototype.hasOwnProperty.call(emptied, "building"), false);
  assert.throws(() => setProjectBuilding(project, { floors: "двадцать" }));
  assert.throws(() => setProjectBuilding(project, { floors: 0 }));
  assert.throws(() => setProjectBuilding(project, { floors: 2.5 }));
  assert.deepEqual(projectBuilding({ building: { floors: "много" } }), { floors: null, storeyMm: null });
  // Высота этажа без этажности не живёт.
  assert.deepEqual(projectBuilding({ building: { storeyMm: 3000 } }), { floors: null, storeyMm: null });
});

test("слияние: дом есть у одного — берут оба; нет ни у кого — не заводится", () => {
  const { project } = flat();
  const housed = setProjectBuilding(project, { floors: 17 }).project;
  assert.deepEqual(mergeProjects(project, housed, project).project.building, { floors: 17 });
  assert.deepEqual(mergeProjects(housed, project, project).project.building, { floors: 17 });
  assert.equal(Object.prototype.hasOwnProperty.call(mergeProjects(project, project, project).project, "building"), false);
});

test("главное: без названного дома номер этажа ничего не поднимает — сцена прежняя", () => {
  const { project, schemeId } = flat();
  const before = volumeScene(project, schemeId, {});
  const seventeen = setSchemeFloor(project, schemeId, 17).project;
  const after = volumeScene(seventeen, schemeId, {});
  assert.equal(after.groundMm, 0);
  assert.equal(after.house, null);
  assert.equal(after.faces.length, before.faces.length);
  assert.deepEqual(after.landMm, before.landMm);
  assert.equal(after.shadowBoxes.length, before.shadowBoxes.length);
  assert.equal(volumeHouseLift(seventeen, schemeId, 2700), null);
});

test("названный дом поднимает схему: земля уходит вниз, сцена не двигается", () => {
  const { project, schemeId } = flat();
  const plain = volumeScene(project, schemeId, {});
  let lifted = setSchemeFloor(project, schemeId, 17).project;
  lifted = setProjectBuilding(lifted, { floors: 25 }).project;
  const scene = volumeScene(lifted, schemeId, {});
  const storey = scene.house.storeyMm;
  assert.equal(scene.groundMm, -16 * storey);
  assert.equal(scene.house.roofMm, scene.house.ceilingMm + 8 * storey);
  // Плиты-земли под квартирой нет — ровно одной гранью меньше; стены на месте.
  assert.equal(scene.faces.length, plain.faces.length - 1);
  assert.equal(scene.shadowBoxes.length, 0);
  // Схема без этажа и подвал не поднимаются.
  assert.equal(volumeHouseLift(setProjectBuilding(project, { floors: 25 }).project, schemeId, 2700), null);
  assert.equal(volumeHouseLift(setProjectBuilding(setSchemeFloor(project, schemeId, -1).project, { floors: 25 }).project, schemeId, 2700), null);
  // Первый этаж названного дома: земля на месте, плита цела, дом над головой.
  const first = volumeScene(setProjectBuilding(setSchemeFloor(project, schemeId, 1).project, { floors: 9 }).project, schemeId, {});
  assert.equal(first.groundMm, 0);
  assert.equal(first.faces.length, plain.faces.length);
  assert.ok(first.house && first.house.floors === 9);
  // Дом ниже этажа квартиры — рисуем по большему.
  assert.equal(volumeHouseLift(setProjectBuilding(setSchemeFloor(project, schemeId, 12).project, { floors: 9 }).project, schemeId, 2700).floors, 12);
});

test("контур дома: сторона с окном — фасад, глухие наращиваются; все или ни одной — по габариту", () => {
  const bounds = { minX: 0, minY: 0, maxX: 6000, maxY: 4000 };
  const one = volumeHouseOutline(bounds, { north: true, east: false, south: false, west: false });
  assert.equal(one.rect.minY, 0, "фасад застроен");
  assert.equal(one.rect.maxY, 4000 + VOLUME_HOUSE_WING_MM);
  assert.equal(one.rect.minX, -VOLUME_HOUSE_WING_MM);
  assert.deepEqual(one.wings.map((wing) => wing.side).sort(), ["east", "south", "west"]);
  // Ни один кусок дома не заходит в габарит квартиры.
  for (const wing of one.wings) {
    const overlapX = Math.min(wing.maxX, bounds.maxX) - Math.max(wing.minX, bounds.minX);
    const overlapY = Math.min(wing.maxY, bounds.maxY) - Math.max(wing.minY, bounds.minY);
    assert.ok(!(overlapX > 0 && overlapY > 0), wing.side + ": сосед залез в квартиру");
  }
  for (const windows of [{ north: true, east: true, south: true, west: true }, { north: false, east: false, south: false, west: false }, null]) {
    const flat2 = volumeHouseOutline(bounds, windows);
    assert.deepEqual(flat2.rect, { minX: 0, maxX: 6000, minY: 0, maxY: 4000 });
    assert.equal(flat2.wings.length, 0);
  }
  const { project, schemeId } = flat();
  const scene = volumeScene(setProjectBuilding(setSchemeFloor(project, schemeId, 5).project, { floors: 9 }).project, schemeId, {});
  assert.ok(!scene.house.wings.some((wing) => wing.side === "north"), "окно квартиры закрыто домом");
  assert.equal(scene.house.wings.length, 3);
});

test("порядок частей дома: низ до сцены, верх — после неё только сверху, сосед — со своей стороны", () => {
  const house = {
    floor: 5,
    floors: 9,
    groundMm: -12000,
    floorMm: -200,
    ceilingMm: 2700,
    roofMm: 14700,
    rect: { minX: -12000, maxX: 6000, minY: 0, maxY: 4000 },
    wings: [{ side: "west", minX: -12000, maxX: 0, minY: 0, maxY: 4000 }],
  };
  const pass = (eye, roofOff) => Object.fromEntries(volumeHouseParts(house, eye, roofOff).map((part) => [part.name, part.pass]));
  assert.deepEqual(pass({ x: 3000, y: 2000, z: 1600 }), { low: "before", wing: "before", high: "before" });
  assert.deepEqual(pass({ x: 3000, y: -30000, z: 30000 }), { low: "before", wing: "before", high: "after" });
  assert.deepEqual(pass({ x: -40000, y: 2000, z: 1600 }), { low: "before", wing: "after", high: "before" });
  // «Снять крышу» снимает верх дома и соседей.
  assert.deepEqual(pass({ x: 3000, y: -30000, z: 30000 }, true), { low: "before" });
  assert.deepEqual(volumeHouseParts(null, { x: 0, y: 0, z: 0 }), []);
  // Квартира на первом этаже: под ней дома нет.
  assert.ok(!volumeHouseParts({ ...house, floor: 1, groundMm: 0 }, { x: 0, y: 0, z: 0 }).some((part) => part.name === "low"));
});

test("фон знает высоту земли: у объекта на земле прицел прежний, у поднятого камера выше земли на подъём", () => {
  const camera = { at: { x: 1, y: 2, z: 1600 }, yaw: 0, pitch: 0 };
  const box = { width: 800, height: 600 };
  assert.equal(volumeGroundAim(camera, box).at, camera.at);
  assert.equal(volumeGroundAim(camera, box, 0).at, camera.at);
  assert.deepEqual(volumeGroundAim(camera, box, -44000).at, { x: 1, y: 2, z: 45600 });
});

test("за входной дверью — коридор этажа: пол, потолок, три стены и пять дверей, весь снаружи квартиры", () => {
  const entry = { side: "south", x: 3000, y: 5100, out: { x: 0, y: 1 } };
  const faces = volumeHallFaces(entry, 2700);
  assert.equal(faces.filter((face) => face.color === "#8a6a4a").length, 5, "дверей не пять");
  for (const face of faces) {
    assert.equal(face.points.length, 4);
    for (const point of face.points) {
      assert.ok(point.y >= entry.y - 1e-6, "коридор залез в квартиру");
      assert.ok(point.z >= 0 && point.z <= 2700);
    }
  }
  assert.deepEqual(volumeHallFaces(null, 2700), []);
  // Вход находится сам: дверь в стене на глухой стороне габарита.
  let { project, schemeId } = flat();
  const south = project.walls.find((wall) => wall.aMm.y === 5000 && wall.bMm.y === 5000);
  project = addOpening(project, { wallId: south.id, kind: "door", atMm: 2000, widthMm: 900, heightMm: 2050, heightAboveFloorMm: 0 }).project;
  project = setProjectBuilding(setSchemeFloor(project, schemeId, 5).project, { floors: 9 }).project;
  const found = volumeScene(project, schemeId, {}).house.entry;
  assert.equal(found.side, "south");
  assert.deepEqual(found.out, { x: 0, y: 1 });
  assert.ok(Math.abs(found.y - 5100) < 1, "вход не на наружной грани стены: " + found.y);
});

test("вышедший за входную дверь стоит в коридоре: дом его не закрывает, коридор рисуется", () => {
  const house = {
    floor: 5,
    floors: 9,
    groundMm: -12000,
    floorMm: -200,
    ceilingMm: 2700,
    roofMm: 14700,
    rect: { minX: 0, maxX: 6000, minY: 0, maxY: 16000 },
    wings: [{ side: "south", minX: 0, maxX: 6000, minY: 4000, maxY: 16000 }],
    entry: { side: "south", x: 3000, y: 4000, out: { x: 0, y: 1 } },
  };
  const inFlat = { x: 3000, y: 3000, z: 1600 };
  const inHall = { x: 3500, y: 5000, z: 1600 };
  const beyond = { x: 3000, y: 9000, z: 1600 };
  assert.equal(volumeHallHolds(house, inHall), true);
  assert.equal(volumeHallHolds(house, beyond), false);
  assert.equal(volumeHallHolds(house, { ...inHall, z: 5000 }), false);
  assert.equal(volumeHallHolds({ ...house, entry: null }, inHall), false);
  const pass = (eye) => Object.fromEntries(volumeHouseParts(house, eye).map((part) => [part.name, part.pass]));
  assert.equal(pass(inFlat).wing, "before");
  // Главное: в коридоре сосед не ложится поверх сцены.
  assert.equal(pass(inHall).wing, "before");
  assert.equal(pass(inHall).high, "before");
  assert.equal(pass(beyond).wing, "after");
});

test("за входной дверью дом продолжается всегда, а коридор не длиннее дома", () => {
  const bounds = { minX: 0, maxX: 9000, minY: 0, maxY: 8000 };
  // Окна на всех сторонах: прежде соседей не было вовсе, и коридор висел в воздухе.
  const all = { north: true, east: true, south: true, west: true };
  assert.deepEqual(volumeHouseOutline(bounds, all).wings, []);
  const forced = volumeHouseOutline(bounds, all, "south");
  assert.deepEqual(forced.wings.map((wing) => wing.side), ["south"]);
  assert.equal(forced.rect.maxY, 8000 + 12000);
  // Коридор режется по корпусу и не короче прохода у двери.
  assert.deepEqual(volumeHallSpan({ fromMm: -1500, toMm: 2500 }), { from: -1500, to: 2500 });
  assert.deepEqual(volumeHallSpan({ fromMm: -100, toMm: 99999 }).from, -600);
  assert.ok(volumeHallSpan({}).to > 3000);
});

test("соседние секции рисуются от дальней к ближней", () => {
  const house = {
    floor: 5, floors: 9, groundMm: -12000, floorMm: -200, ceilingMm: 2700, roofMm: 14700,
    rect: { minX: 0, maxX: 18000, minY: 0, maxY: 16000 },
    wings: [
      { side: "east", minX: 6000, maxX: 18000, minY: 0, maxY: 16000 },
      { side: "south", minX: 0, maxX: 6000, minY: 4000, maxY: 16000 },
    ],
    entry: null,
  };
  const order = (eye) => volumeHouseParts(house, eye).filter((part) => part.name === "wing").map((part) => part.rect.side);
  assert.deepEqual(order({ x: 10000, y: 30000, z: 1000 }), ["south", "east"]);
  assert.deepEqual(order({ x: 3000, y: 30000, z: 1000 }), ["east", "south"]);
});
