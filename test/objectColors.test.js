// Цвета вещи чертежа (правка без автопилота, 2026-11-20). Слова заказчика:
// «для объектов чертежа сделай выбор цвета… можно просто цвет 1 и цвет 2».
import test from "node:test";
import assert from "node:assert/strict";
import {
  addScheme,
  addSchemeObject,
  createProject,
  findSchemeObject,
  schemeObjectColors,
  setPlanOrigin,
  setPlanScale,
  setSchemeObjectColor,
  updateSchemeObject,
} from "../src/model.js";
import { VOLUME_OBJECT_RGB, volumeScene } from "../src/volume.js";

function home() {
  let project = createProject();
  const added = addScheme(project, { name: "План", imageId: "i", width: 1000, height: 1000 });
  project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meters: 10 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  const made = addSchemeObject(project, { schemeId, catalogKey: "cabinet", atMm: { x: 2000, y: 2000 }, widthMm: 1000, depthMm: 600, turnDeg: 0, heightMm: 2000 });
  return { project: made.project, schemeId, id: made.schemeObject.id };
}

test("вещь без цветов — без ключа; цвет ставится, переживает правку габарита и снимается вместе с ключом", () => {
  let { project, id } = home();
  assert.equal(Object.prototype.hasOwnProperty.call(findSchemeObject(project, id), "colors"), false);
  assert.deepEqual(schemeObjectColors(findSchemeObject(project, id)), { main: null, second: null });
  project = setSchemeObjectColor(project, id, "main", "#8a6a4a").project;
  project = setSchemeObjectColor(project, id, "second", "#F0F0EB").project;
  assert.deepEqual(schemeObjectColors(findSchemeObject(project, id)), { main: "#8A6A4A", second: "#F0F0EB" });
  project = updateSchemeObject(project, id, { widthMm: 1200 }).project;
  assert.deepEqual(schemeObjectColors(findSchemeObject(project, id)), { main: "#8A6A4A", second: "#F0F0EB" });
  assert.equal(setSchemeObjectColor(project, id, "main", "#8A6A4A").changed, false);
  project = setSchemeObjectColor(project, id, "main", null).project;
  project = setSchemeObjectColor(project, id, "second", "").project;
  assert.equal(Object.prototype.hasOwnProperty.call(findSchemeObject(project, id), "colors"), false);
  assert.throws(() => setSchemeObjectColor(project, id, "third", "#000000"));
  assert.throws(() => setSchemeObjectColor(project, id, "main", "красный"));
});

test("в объёме основной цвет красит корпус, второй — фасад; без цветов вещь прежняя", () => {
  let { project, schemeId, id } = home();
  const rgbs = () => new Set(volumeScene(project, schemeId, {}).faces.filter((face) => face.thing === id).map((face) => face.rgb.join(",")));
  const before = rgbs();
  assert.ok(before.has(VOLUME_OBJECT_RGB.join(",")));
  project = setSchemeObjectColor(project, id, "main", "#8A6A4A").project;
  const main = rgbs();
  assert.ok(main.has("138,106,74") && !main.has(VOLUME_OBJECT_RGB.join(",")));
  assert.ok(!main.has("240,240,235"));
  project = setSchemeObjectColor(project, id, "second", "#F0F0EB").project;
  const both = rgbs();
  assert.ok(both.has("138,106,74") && both.has("240,240,235"));
});
