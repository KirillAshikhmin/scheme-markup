// Замена подложки схемы: картинка другая, разметка та же.
//
// Координаты меток и контуров — доли плана, поэтому при той же пропорции всё
// встаёт на свои места само. Пересчитать нужно только смещения подписей: они
// заданы в пикселях плана, и на картинке другого разрешения тот же сдвиг
// означал бы другое расстояние на глаз.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  createProject,
  findScheme,
  replaceSchemeImage,
  updateMark,
} from "../src/model.js";
import { orphanImageIds, STORE_IMAGE_GRACE_MS } from "../src/store.js";
import { schemesSweepReady } from "../src/panels/schemes.js";
import { sameAspect } from "../src/imagePrep.js";

const SQUARE = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.6 },
  { x: 0.1, y: 0.6 },
];

// Объект с одной схемой 1000×500: метка со смещением подписи, вторая метка,
// контур помещения.
function projectWithPlan() {
  let step = createProject();
  const scheme = addScheme(step, { name: "1 этаж", imageId: "старая", width: 1000, height: 500 });
  step = scheme.project;
  const room = addRoom(step, { name: "Спальная Оли" });
  step = room.project;
  const outline = addOutline(step, { schemeId: scheme.scheme.id, roomId: room.room.id, points: SQUARE });
  step = outline.project;
  const typeId = step.markTypes.find((type) => type.code === "В").id;
  const first = addMark(step, { schemeId: scheme.scheme.id, typeId, kind: "point", points: [{ x: 0.25, y: 0.4 }] });
  step = updateMark(first.project, first.mark.id, { labelOffset: { dx: 12, dy: -10 }, location: "у двери" }).project;
  const second = addMark(step, { schemeId: scheme.scheme.id, typeId, kind: "point", points: [{ x: 0.8, y: 0.9 }] });
  return {
    project: second.project,
    schemeId: scheme.scheme.id,
    outlineId: outline.outline.id,
    markId: first.mark.id,
    otherMarkId: second.mark.id,
  };
}

test("замена подложки сохраняет метки, их номера, поля и контуры помещений", () => {
  const { project, schemeId, markId, otherMarkId, outlineId } = projectWithPlan();
  const before = JSON.parse(JSON.stringify({ marks: project.marks, outlines: project.outlines }));

  const result = replaceSchemeImage(project, schemeId, { imageId: "новая", width: 2000, height: 1000 });
  const scheme = findScheme(result.project, schemeId);

  assert.equal(scheme.imageId, "новая");
  assert.equal(scheme.width, 2000);
  assert.equal(scheme.height, 1000);
  assert.equal(result.project.marks.length, 2);
  // Доли не трогаются: при той же пропорции метка остаётся на том же месте плана.
  const moved = result.project.marks.find((mark) => mark.id === markId);
  const other = result.project.marks.find((mark) => mark.id === otherMarkId);
  assert.deepEqual(moved.points, before.marks[0].points);
  assert.deepEqual(other.points, before.marks[1].points);
  assert.equal(moved.number, before.marks[0].number);
  assert.equal(moved.location, "у двери");
  assert.deepEqual(
    result.project.outlines.find((outline) => outline.id === outlineId).points,
    before.outlines[0].points,
  );
  // Исходный объект не тронут.
  assert.equal(findScheme(project, schemeId).imageId, "старая");
});

test("смещение подписи пересчитывается по каждой оси: оно в пикселях плана", () => {
  const { project, schemeId, markId } = projectWithPlan();
  const twice = replaceSchemeImage(project, schemeId, { imageId: "новая", width: 2000, height: 1000 });
  assert.deepEqual(
    twice.project.marks.find((mark) => mark.id === markId).labelOffset,
    { dx: 24, dy: -20 },
  );
  // Другая пропорция: по горизонтали масштаб прежний, по вертикали — вдвое.
  const taller = replaceSchemeImage(project, schemeId, { imageId: "новая", width: 1000, height: 1000 });
  assert.deepEqual(
    taller.project.marks.find((mark) => mark.id === markId).labelOffset,
    { dx: 12, dy: -20 },
  );
});

test("замена без картинки или с пустым размером отвергается", () => {
  const { project, schemeId } = projectWithPlan();
  assert.throws(() => replaceSchemeImage(project, "нет такой", { imageId: "новая", width: 10, height: 10 }), {
    code: "schemeNotFound",
  });
  assert.throws(() => replaceSchemeImage(project, schemeId, { imageId: "", width: 10, height: 10 }), {
    code: "imageRequired",
  });
  assert.throws(() => replaceSchemeImage(project, schemeId, { imageId: "новая", width: 0, height: 10 }), {
    code: "planSizeInvalid",
  });
});

test("прежняя подложка становится ничьей, чужая — нет", () => {
  const { project, schemeId } = projectWithPlan();
  const after = replaceSchemeImage(project, schemeId, { imageId: "новая", width: 1000, height: 500 }).project;
  const second = addScheme(createProject(), { name: "Дача", imageId: "чужая", width: 800, height: 600 }).project;

  assert.deepEqual(orphanImageIds([after, second], ["старая", "новая", "чужая", "ничья"]), ["старая", "ничья"]);
  // Пока замену не применили, прежняя картинка ещё нужна.
  assert.deepEqual(orphanImageIds([project, second], ["старая", "новая", "чужая"]), ["новая"]);
});

test("пропорция считается с допуском на округление пикселей", () => {
  assert.equal(sameAspect({ width: 1000, height: 500 }, { width: 1600, height: 800 }), true);
  assert.equal(sameAspect({ width: 1000, height: 500 }, { width: 999, height: 500 }), true);
  assert.equal(sameAspect({ width: 1000, height: 500 }, { width: 1000, height: 600 }), false);
  assert.equal(sameAspect({ width: 1000, height: 500 }, { width: 500, height: 1000 }), false);
  // Прежнего размера нет (схема без плана) — сравнивать не с чем, спрашивать не о чем.
  assert.equal(sameAspect({ width: 0, height: 0 }, { width: 800, height: 600 }), true);
});

// Уборка — единственное место, которое удаляет данные заказчика, поэтому
// «не знаю» здесь означает «ничего не трогаю», и решает это сама функция,
// а не её обёртка в хранилище.
test("без списка объектов сирот нет: неизвестное не удаляется", () => {
  const stored = ["старая", "новая"];
  assert.deepEqual(orphanImageIds(null, stored), []);
  assert.deepEqual(orphanImageIds(undefined, stored), []);
  assert.deepEqual(orphanImageIds([], stored), []);
  assert.deepEqual(orphanImageIds("не список", stored), []);
});

test("свежая картинка неприкосновенна: её объект может дописываться в другой вкладке", () => {
  const { project } = projectWithPlan();
  const now = 1_000_000_000_000;
  const images = [
    { id: "только что", createdAt: now - 1000 },
    { id: "на грани", createdAt: now - STORE_IMAGE_GRACE_MS + 1000 },
    { id: "давняя", createdAt: now - STORE_IMAGE_GRACE_MS - 1000 },
    "без отметки",
  ];
  assert.deepEqual(orphanImageIds([project], images, { now }), ["давняя", "без отметки"]);
  // Часы вкладок разошлись и отметка из будущего — это тоже «не знаю».
  assert.deepEqual(orphanImageIds([project], [{ id: "из будущего", createdAt: now + 60000 }], { now }), []);
});

test("уборка запускается один раз за сеанс и только когда отменять нечего", () => {
  const project = createProject({ name: "Квартира" });
  assert.equal(schemesSweepReady({ project, swept: false, canUndo: false }), true);
  assert.equal(schemesSweepReady({ project, swept: false, canUndo: true }), false);
  assert.equal(schemesSweepReady({ project, swept: true, canUndo: false }), false);
  assert.equal(schemesSweepReady({ project: null, swept: false, canUndo: false }), false);
});
