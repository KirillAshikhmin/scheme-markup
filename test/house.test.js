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
