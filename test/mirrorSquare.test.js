// Квадратное зеркало подсветки (правка без автопилота, 2026-11-21).
//
// Слова заказчика: «если какие-то есть на дизайн проекте объекты, но таких у
// нас нет — пусть добавит, если они важны. Например опция у зеркала —
// квадратное».
//
// Что этот тест держит:
//
//   1. **Механика «Висячей» люстры повторена.** Отметка `mark.square`
//      предлагается только метке, у изображения которой есть квадратный
//      вариант; пишется только поставленной; снятая убирает ключ.
//   2. **G68.** Метка без отметки получает прежнюю модель той же ссылкой и
//      рисуется теми же гранями, что и до правки.
//   3. **Квадрат занимает место круга.** Четыре грани по обводу, стороной к
//      полу, сторона равна диаметру прежнего круга — и при габарите-полосе
//      300 × 60 тоже.
//   4. Файл переживает упаковку и открытие.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  findMark,
  markSquare,
  markSquareCan,
  planMmToFraction,
  setMarkDimensions,
  setMarkSquare,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  typeViewName,
} from "../src/model.js";
import {
  OBJECT_MODEL_BODY_MAX,
  OBJECT_MODEL_FACE_MAX,
  objectModelByKey,
  objectModelFaceCount,
  objectModelSquare,
  objectModelSquareKeys,
} from "../src/objectModels/registry.js";
import { volumeMarkFaces, volumeMarkPlace, volumeRoundWith, volumeScene, VOLUME_ROUND_SIDES } from "../src/volume.js";
import { packProject, unpackProject } from "../src/projectFile.js";

// Комната 6 × 4: на северной стене зеркало «ПЗ», рядом розетка «Р».
function stand() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  const schemeId = added.scheme.id;
  const fr = (point) => planMmToFraction(project, schemeId, point);
  const outer = [
    { x: -3000, y: -2000 },
    { x: 3000, y: -2000 },
    { x: 3000, y: 2000 },
    { x: -3000, y: 2000 },
  ];
  outer.forEach((point, index) => {
    project = addWall(project, { schemeId, aMm: point, bMm: outer[(index + 1) % 4], thicknessMm: 200 }).project;
  });
  const made = addRoom(project, "Ванная");
  project = made.project;
  project = addOutline(project, {
    schemeId,
    roomId: made.room.id,
    points: [{ x: -2900, y: -1900 }, { x: 2900, y: -1900 }, { x: 2900, y: 1900 }, { x: -2900, y: 1900 }].map(fr),
  }).project;
  const marks = {};
  const put = (key, code, at) => {
    const type = project.markTypes.find((item) => item.code === code);
    const next = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [fr(at)] });
    project = next.project;
    marks[key] = next.marks[0].id;
  };
  put("mirror", "ПЗ", { x: 0, y: -1950 });
  put("socket", "Р", { x: 1500, y: -1950 });
  project = applyMarkWalls(project, schemeId).project;
  return { project, schemeId, marks };
}

function placeOf(project, schemeId, markId) {
  const scene = volumeScene(project, schemeId, { roofOff: true });
  return volumeMarkPlace(scene, markId);
}

const spanOf = (faces) => {
  const all = faces.flatMap((face) => face.p);
  const of = (axis) => Math.max(...all.map((point) => point[axis])) - Math.min(...all.map((point) => point[axis]));
  return { x: Math.round(of("x")), y: Math.round(of("y")), z: Math.round(of("z")) };
};

test("квадратный вариант есть у зеркала и только у него; без отметки — та же ссылка", () => {
  const plain = objectModelByKey("mirror");
  assert.equal(objectModelSquare(plain, false), plain, "без отметки описание подменилось");
  assert.equal(objectModelSquare(plain, undefined), plain);
  assert.equal(objectModelSquare(plain, true).key, "mirrorSquare");
  const socket = objectModelByKey("socket");
  assert.equal(objectModelSquare(socket, true), socket, "у розетки завёлся квадратный вариант");
  assert.equal(objectModelSquare(null, true), null);
  assert.deepEqual(objectModelSquareKeys(), ["mirror"]);
  // Те же тела с теми же долями, только обвод в четыре грани.
  const square = objectModelByKey("mirrorSquare");
  assert.deepEqual(square.parts.map((part) => part.name), plain.parts.map((part) => part.name));
  for (const part of square.parts) {
    assert.equal(part.kind, "tube");
    assert.equal(part.sides, 4, part.name + ": обвод не в четыре грани");
    assert.equal(part.round, true, part.name + ": сторона берётся не по большей стороне габарита");
  }
  for (const part of plain.parts) assert.equal(part.sides, null, "круглому зеркалу записали число сторон");
  assert.equal(objectModelFaceCount(square), 12, "у двух четырёхгранных тел двенадцать граней");
  assert.ok(square.parts.length <= OBJECT_MODEL_BODY_MAX && objectModelFaceCount(square) <= OBJECT_MODEL_FACE_MAX);
});

test("отметка «Квадратное» предлагается зеркалу, пишется только поставленной, чужой метке — отказ", () => {
  const box = stand();
  const id = box.marks.mirror;
  assert.equal(typeViewName(box.project, findMark(box.project, id).typeId), "mirror");
  assert.equal(markSquareCan(box.project, findMark(box.project, id)), true);
  assert.equal(markSquareCan(box.project, findMark(box.project, box.marks.socket)), false, "розетке предложили стать квадратной");
  assert.equal(markSquareCan(box.project, null), false);
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(box.project, id), "square"), false);
  assert.equal(markSquare(box.project, findMark(box.project, id)), false);
  const squared = setMarkSquare(box.project, id, true).project;
  assert.equal(findMark(squared, id).square, true);
  assert.equal(markSquare(squared, findMark(squared, id)), true);
  const back = setMarkSquare(squared, id, false).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(back, id), "square"), false, "снятая отметка осталась ключом");
  assert.deepEqual(findMark(back, id), findMark(box.project, id), "метка после круга не та же");
  assert.throws(() => setMarkSquare(box.project, box.marks.socket, true));
});

test("G68: зеркало без отметки — прежняя модель и прежние грани", () => {
  const box = stand();
  const place = placeOf(box.project, box.schemeId, box.marks.mirror);
  assert.equal(place.model, objectModelByKey("mirror"), "модель метки без отметки сменилась");
  // Два лежачих цилиндра по десять граней — как было с таска 177.
  assert.equal(volumeMarkFaces(place, [], 1).length, 20);
});

test("квадратное зеркало: двенадцать граней, сторона равна диаметру круглого, место то же", () => {
  const box = stand();
  const id = box.marks.mirror;
  const round = placeOf(box.project, box.schemeId, id);
  const squaredProject = setMarkSquare(box.project, id, true).project;
  const square = placeOf(squaredProject, box.schemeId, id);
  assert.equal(square.model.key, "mirrorSquare");
  assert.deepEqual(square.anchor, round.anchor, "метка переехала вместе с рисунком");
  assert.deepEqual(square.sizes, round.sizes, "габарит метки тронут");
  const faces = volumeMarkFaces(square, [], 1);
  assert.equal(faces.length, 12);
  // Габарит ПЗ в стартовом справочнике 600 × 600: свечение — во весь габарит.
  const span = spanOf(faces);
  assert.equal(span.x, 600, "квадрат вдоль стены не в диаметр круга");
  assert.equal(span.z, 600, "квадрат по высоте не в диаметр круга");
  // Стороной к полу: у каждой боковой грани две вершины на одной высоте.
  const glow = faces.slice(6, 10);
  for (const face of glow) {
    const heights = new Set(face.p.map((point) => Math.round(point.z)));
    const alongs = new Set(face.p.map((point) => Math.round(point.x)));
    assert.ok(heights.size === 1 || alongs.size === 1, "квадрат стоит на ребре, а не на стороне");
  }
  // Сборка «круглых тел» видеокарты квадрату граней не добавляет и бока не сглаживает.
  const smooth = volumeRoundWith(VOLUME_ROUND_SIDES, () => volumeMarkFaces(square, [], 1));
  assert.equal(smooth.length, 12);
  assert.ok(smooth.every((face) => face.smooth === undefined), "квадрату сгладили рёбра");
});

test("габарит-полоса 300 × 60: квадрат по большей стороне, как и круг", () => {
  const box = stand();
  const id = box.marks.mirror;
  let project = setMarkDimensions(box.project, id, { length: 300, width: 60, depth: 25 }).project;
  project = setMarkSquare(project, id, true).project;
  const span = spanOf(volumeMarkFaces(placeOf(project, box.schemeId, id), [], 1));
  assert.equal(span.x, 300);
  assert.equal(span.z, 300, "при полосе подсветки зеркало вышло полосой, а не квадратом");
});

test("отметка переживает упаковку и открытие файла", async () => {
  const box = stand();
  const id = box.marks.mirror;
  const project = setMarkSquare(box.project, id, true).project;
  const blob = await packProject(project, new Map());
  const opened = await unpackProject(blob);
  const mark = opened.project.marks.find((item) => item.typeId === findMark(project, id).typeId);
  assert.equal(mark.square, true);
  assert.equal(markSquare(opened.project, mark), true);
});
