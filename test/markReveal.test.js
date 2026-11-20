// Метка в откосе (правка без автопилота, 2026-11-20). Слова заказчика: «про
// розетки в откосах — надо сделать как-то… параметр "В откосе", а на схеме
// ставить рядом с краем окна на нужную высоту и тогда в рендере они
// переносятся на откос».
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addOpening,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  findMark,
  markInReveal,
  markLocationText,
  markRevealCan,
  markRevealOpening,
  setMarkReveal,
  setPlanOrigin,
  setPlanScale,
  updateMark,
  validate,
} from "../src/model.js";
import { volumeScene } from "../src/volume.js";

function home() {
  let project = createProject();
  const added = addScheme(project, { name: "План", imageId: "i", width: 1000, height: 1000 });
  project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meters: 10 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  // Стена вдоль верха листа, 200 мм, окно с 2000 по 3500, подоконник 900.
  const wall = addWall(project, { schemeId, aMm: { x: 1000, y: 1000 }, bMm: { x: 6000, y: 1000 }, thicknessMm: 200 });
  project = wall.project;
  project = addOpening(project, { wallId: wall.wall.id, kind: "window", atMm: 1000, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 900 }).project;
  const socket = project.markTypes.find((type) => type.code === "Р");
  const put = (xMm, height) => {
    const made = addMark(project, { schemeId, typeId: socket.id, kind: "point", points: [{ x: xMm / 10000, y: 0.115 }] });
    project = updateMark(made.project, made.mark.id, { heightAboveFloor: height }).project;
    project = applyMarkWalls(project, schemeId).project;
    return made.mark.id;
  };
  return { get project() { return project; }, set project(value) { project = value; }, schemeId, wallId: wall.wall.id, put };
}

test("откос предлагается метке у края проёма и на его высоте", () => {
  const h = home();
  const near = h.put(3650, 1200); // 150 мм за правым краем окна (стена начинается с 1000)
  const far = h.put(4500, 1200);
  const low = h.put(3650, 300); // под подоконником откоса нет
  const found = markRevealOpening(h.project, findMark(h.project, near));
  assert.equal(found.edge, "to");
  assert.equal(found.atMm, 2500);
  assert.equal(markRevealCan(h.project, findMark(h.project, far)), false);
  assert.equal(markRevealCan(h.project, findMark(h.project, low)), false);
});

test("отметка ставится только у проёма, снятая убирает ключ, расположение дописывается", () => {
  const h = home();
  const near = h.put(3650, 1200);
  const far = h.put(4500, 1200);
  assert.throws(() => setMarkReveal(h.project, far, true));
  h.project = setMarkReveal(h.project, near, true).project;
  assert.equal(findMark(h.project, near).reveal, true);
  assert.equal(markInReveal(h.project, findMark(h.project, near)), true);
  assert.equal(markLocationText(h.project, findMark(h.project, near)), "в откосе");
  h.project = updateMark(h.project, near, { location: "у окна" }).project;
  assert.equal(markLocationText(h.project, findMark(h.project, near)), "у окна, в откосе");
  h.project = setMarkReveal(h.project, near, false).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(h.project, near), "reveal"), false);
  assert.equal(markLocationText(h.project, findMark(h.project, near)), "у окна");
});

test("метка в самом проёме с отметкой не считается находкой", () => {
  const h = home();
  const inside = h.put(3400, 1200);
  const warns = () => validate(h.project).filter((problem) => problem.code === "markInOpening").length;
  assert.equal(warns(), 1);
  h.project = setMarkReveal(h.project, inside, true).project;
  assert.equal(warns(), 0);
});

test("в объёме метка с отметкой стоит на откосе лицом в проём, без отметки — на стене", () => {
  const h = home();
  const id = h.put(3650, 1200);
  const placeOf = () => volumeScene(h.project, h.schemeId, {}).marks.find((place) => place.markId === id);
  const onWall = placeOf();
  // Стена идёт вдоль x: на стене лицо смотрит поперёк неё.
  assert.ok(Math.abs(onWall.face.normal.y) > 0.99);
  h.project = setMarkReveal(h.project, id, true).project;
  const inReveal = placeOf();
  // Правый край окна на x = 3500: лицо смотрит в проём, то есть к меньшим x.
  assert.ok(inReveal.face.normal.x < -0.99, "лицо не в проём");
  assert.ok(Math.abs(inReveal.anchor.x - 3500) < 30, "метка не на грани откоса: " + inReveal.anchor.x);
  // На комнатной половине толщины: стена 200, ось y = 1000.
  assert.ok(Math.abs(inReveal.anchor.y - 1000) > 20 && Math.abs(inReveal.anchor.y - 1000) < 100, "не на своей половине: " + inReveal.anchor.y);
  assert.equal(inReveal.anchor.z, onWall.anchor.z);
});
