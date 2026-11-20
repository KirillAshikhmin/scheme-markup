// Бра «вверх и вниз» (правка без автопилота, 2026-11-21).
//
// Слова заказчика: «Бра сделай которые светят вверх и вниз» — на рендере
// кинозала это чёрный кубик на стене и два узких луча по стене от него.
//
// Что этот тест держит:
//
//   1. **Механика «Висячей» люстры повторена.** Отметка `mark.updown`
//      предлагается точечному светильнику, привязанному к стене; пишется
//      только поставленной; снятая убирает ключ.
//   2. **G68.** Метка без отметки получает прежнюю модель той же ссылкой и
//      прежний источник света — ключ в ключ.
//   3. **Свет у видеокарты — два луча по стене**, вверх и вниз, сила пополам;
//      прежней отрисовке источник остаётся один и на прежнем месте.
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
  markUpdown,
  markUpdownCan,
  planMmToFraction,
  setMarkUpdown,
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
  objectModelUpdown,
  objectModelUpdownKeys,
} from "../src/objectModels/registry.js";
import {
  volumeLampSources,
  volumeLiveLight,
  volumeMarkFaces,
  volumeMarkPlace,
  volumeMeshLampPick,
  volumeMeshLamps,
  volumeScene,
} from "../src/volume.js";
import { packProject, unpackProject } from "../src/projectFile.js";

// Комната 6 × 4: на северной стене бра «Бр», рядом розетка «Р»; посреди
// комнаты потолочный светильник «С» — он к стене не привязан.
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
  const made = addRoom(project, "Кинозал");
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
  put("sconce", "Бр", { x: 0, y: -1950 });
  put("socket", "Р", { x: 1500, y: -1950 });
  put("ceiling", "С", { x: 0, y: 0 });
  project = applyMarkWalls(project, schemeId).project;
  return { project, schemeId, marks, roomId: made.room.id };
}

function placeOf(project, schemeId, markId) {
  return volumeMarkPlace(volumeScene(project, schemeId, { roofOff: true }), markId);
}

test("вариант «вверх и вниз» есть у светильника и только у него; без отметки — та же ссылка", () => {
  const plain = objectModelByKey("lamp");
  assert.equal(objectModelUpdown(plain, false), plain, "без отметки описание подменилось");
  assert.equal(objectModelUpdown(plain, undefined), plain);
  assert.equal(objectModelUpdown(plain, true).key, "lampUpdown");
  const socket = objectModelByKey("socket");
  assert.equal(objectModelUpdown(socket, true), socket, "у розетки завёлся вариант бра");
  assert.equal(objectModelUpdown(null, true), null);
  assert.deepEqual(objectModelUpdownKeys(), ["lamp"]);
  const cube = objectModelByKey("lampUpdown");
  assert.deepEqual(cube.parts.map((part) => part.name), ["body", "glowUp", "glowDown"]);
  assert.deepEqual(cube.parts.map((part) => part.lit), [false, true, true], "светятся только пластины");
  assert.equal(objectModelFaceCount(cube), 18);
  assert.ok(cube.parts.length <= OBJECT_MODEL_BODY_MAX && objectModelFaceCount(cube) <= OBJECT_MODEL_FACE_MAX);
});

test("отметка предлагается светильнику на стене, пишется только поставленной, чужой метке — отказ", () => {
  const box = stand();
  const id = box.marks.sconce;
  assert.equal(typeViewName(box.project, findMark(box.project, id).typeId), "lamp");
  assert.equal(markUpdownCan(box.project, findMark(box.project, id)), true);
  assert.equal(markUpdownCan(box.project, findMark(box.project, box.marks.socket)), false, "розетке предложили светить");
  assert.equal(markUpdownCan(box.project, findMark(box.project, box.marks.ceiling)), false, "потолочному предложили лучи по стене");
  assert.equal(markUpdownCan(box.project, null), false);
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(box.project, id), "updown"), false);
  assert.equal(markUpdown(box.project, findMark(box.project, id)), false);
  const on = setMarkUpdown(box.project, id, true).project;
  assert.equal(findMark(on, id).updown, true);
  assert.equal(markUpdown(on, findMark(on, id)), true);
  const back = setMarkUpdown(on, id, false).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(back, id), "updown"), false, "снятая отметка осталась ключом");
  assert.deepEqual(findMark(back, id), findMark(box.project, id), "метка после снятия не та же");
  assert.throws(() => setMarkUpdown(box.project, box.marks.socket, true), (error) => error.code === "updownOnlyWallLamp");
  assert.throws(() => setMarkUpdown(box.project, box.marks.ceiling, true), (error) => error.code === "updownOnlyWallLamp");
});

test("G68: бра без отметки — прежняя модель, прежние грани и прежний источник", () => {
  const box = stand();
  const scene = volumeScene(box.project, box.schemeId, { roofOff: true });
  const place = volumeMarkPlace(scene, box.marks.sconce);
  assert.equal(place.model, objectModelByKey("lamp"), "модель метки без отметки сменилась");
  assert.equal(Object.prototype.hasOwnProperty.call(place, "updown"), false, "месту без отметки записан признак");
  assert.equal(volumeMarkFaces(place, [], 1).length, 26);
  const sources = volumeLampSources(place, scene);
  assert.equal(sources.length, 1);
  assert.deepEqual(Object.keys(sources[0]).sort(), ["at", "beam", "dir", "power", "room", "wall"], "источнику без отметки дописан ключ");
});

test("тело бра «вверх и вниз» — кубик в габарите прежнего бра, место метки то же", () => {
  const box = stand();
  const id = box.marks.sconce;
  const before = placeOf(box.project, box.schemeId, id);
  const after = placeOf(setMarkUpdown(box.project, id, true).project, box.schemeId, id);
  assert.equal(after.model.key, "lampUpdown");
  assert.equal(after.updown, true);
  assert.deepEqual(after.anchor, before.anchor, "метка переехала");
  assert.deepEqual(after.sizes, before.sizes, "габарит метки тронут");
  const faces = volumeMarkFaces(after, [], 1);
  assert.equal(faces.length, 18);
  const zs = faces.flatMap((face) => face.p.map((point) => point.z));
  const old = volumeMarkFaces(before, [], 1).flatMap((face) => face.p.map((point) => point.z));
  assert.ok(Math.min(...zs) >= Math.min(...old) - 1 && Math.max(...zs) <= Math.max(...old) + 1, "кубик вылез из габарита бра по высоте");
  assert.ok(Math.max(...zs) - Math.min(...zs) < Math.max(...old) - Math.min(...old), "кубик не меньше прежнего бра");
});

test("свет видеокарты: два узких луча по стене — вверх и вниз, сила пополам; прежней отрисовке источник один", () => {
  const box = stand();
  const id = box.marks.sconce;
  const live = new Map([[id, { kind: "light", on: true, level: 1, roomId: box.roomId }]]);
  const lampsOf = (project) => {
    const scene = volumeScene(project, box.schemeId, { roofOff: true });
    return { scene, lamps: volumeMeshLamps(scene, volumeLiveLight(scene, live, { physical: true }), live) };
  };
  const plain = lampsOf(box.project);
  assert.equal(plain.lamps.length, 1, "обычное бра светит не одним источником");
  assert.equal(plain.lamps[0].aim, undefined);
  assert.equal(plain.lamps[0].down, false);

  const on = lampsOf(setMarkUpdown(box.project, id, true).project);
  assert.equal(on.lamps.length, 2, "лучей не два");
  const [up, down] = on.lamps;
  const place = volumeMarkPlace(on.scene, id);
  // Источник сцены один и на прежнем месте: прежняя отрисовка рисует прежнее пятно.
  const sources = volumeLampSources(place, on.scene);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].updown, true);
  assert.deepEqual(sources[0].at, volumeLampSources(volumeMarkPlace(plain.scene, id), plain.scene)[0].at);
  // Вверх и вниз, вдоль стены: цель по высоте далеко, а в плане — у стены.
  assert.ok(up.aim.z > up.z + 500, "первый луч не вверх");
  assert.ok(down.aim.z < down.z - 500, "второй луч не вниз");
  for (const lamp of on.lamps) {
    assert.equal(lamp.down, true, "луч не конусом");
    assert.equal(lamp.narrow, true);
    assert.equal(lamp.wall, true, "луч сольётся с соседями");
    const flat = Math.hypot(lamp.aim.x - lamp.x, lamp.aim.y - lamp.y);
    assert.ok(flat < Math.abs(lamp.aim.z - lamp.z) / 3, "луч идёт от стены, а не вдоль неё");
    // Северная стена: комната к югу (y больше). Цель — в сторону стены.
    assert.ok(lamp.aim.y < lamp.y, "луч целит в комнату, а не в стену");
  }
  assert.ok(Math.abs(up.power + down.power - plain.lamps[0].power) < 1e-9, "сила двух лучей не равна силе бра");
  assert.equal(up.power, down.power);
  // Оба — конусы: видеокарте они достаются в «спотах», не сливаясь.
  const pick = volumeMeshLampPick(on.lamps, { x: 0, y: 0 });
  assert.equal(pick.spots.length, 2);
  assert.equal(pick.points.length, 0);
  assert.equal(pick.fill, null, "настенные лучи дали отражённый свет в стене");
});

test("отметка переживает упаковку и открытие файла", async () => {
  const box = stand();
  const id = box.marks.sconce;
  const project = setMarkUpdown(box.project, id, true).project;
  const opened = await unpackProject(await packProject(project, new Map()));
  const mark = opened.project.marks.find((item) => item.typeId === findMark(project, id).typeId);
  assert.equal(mark.updown, true);
  assert.equal(markUpdown(opened.project, mark), true);
});
