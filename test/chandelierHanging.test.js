// Висячая люстра вторым вариантом (таск 256, требование G397).
//
// Слова заказчика: «Люстре добавь другой вариант - висячая, [фото] вот типо
// такого, и что бы переключалось как и у тех же дверей опция Стеклянные».
//
// Что здесь закрыто:
//
//   1. **Механика двери повторена.** Отметка у метки (`mark.hanging`) живёт по
//      правилам `glazed` у проёма: вопрос «предлагается ли» и вопрос «стоит
//      ли» — разные двери, поле попадает в объект только поставленным, снятая
//      отметка **убирает** ключ, а поставить её там, где её не предлагают,
//      модель отказывается.
//   2. **G68.** Люстра без отметки рисуется **грань в грань** тем, чем
//      рисовалась до этой правки: отпечаток кадра снят на прежнем коде и лежит
//      в `fixtures/chandelier-volume-before.json`. Там же снимок лампы — свет
//      от варианта не зависит ни числом, ни местом.
//   3. **Обе трубы открытия.** Объект без отметки проходит и файл, и базу, не
//      получая ни ключа; объект **с** отметкой проходит их, не теряя ключа;
//      второе открытие не правит ничего.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  findMark,
  markHanging,
  markHangingCan,
  planMmToFraction,
  setMarkHanging,
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
  objectModelHanging,
  objectModelHangingKeys,
} from "../src/objectModels/registry.js";
import { volumeLampSources, volumeMarkFaces, volumeMarkPlace, volumeScene } from "../src/volume.js";
import { PROJECT_ENTRY, packProject, readZip, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";

const BEFORE = JSON.parse(readFileSync(new URL("./fixtures/chandelier-volume-before.json", import.meta.url), "utf8"));

// Комната 6 × 4 с потолком 2700, в середине люстра «ЛЮ», у стены — розетка
// «Р»: вторая метка нужна, чтобы проверить, кому отметку не предлагают.
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
  const made = addRoom(project, "Гостиная");
  project = made.project;
  project = addOutline(project, {
    schemeId,
    roomId: made.room.id,
    points: [{ x: -2900, y: -1900 }, { x: 2900, y: -1900 }, { x: 2900, y: 1900 }, { x: -2900, y: 1900 }].map(fr),
  }).project;
  const marks = {};
  const put = (key, code, at) => {
    const type = project.markTypes.find((item) => item.code === code);
    const made = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [fr(at)] });
    project = made.project;
    marks[key] = made.marks[0].id;
  };
  put("chandelier", "ЛЮ", { x: 0, y: 0 });
  put("socket", "Р", { x: -2950, y: 0 });
  project = applyMarkWalls(project, schemeId).project;
  return { project, schemeId, marks, roomId: made.room.id };
}

const round = (value) => Math.round(value * 1000) / 1000;

const printOf = (faces) =>
  faces.map((face) => ({
    name: face.name === undefined ? null : face.name,
    lit: face.lit === true,
    rgb: face.rgb,
    p: face.p.map((point) => [round(point.x), round(point.y), round(point.z)]),
  }));

const lampsOf = (place, scene) =>
  volumeLampSources(place, scene, null).map((source) => ({
    at: [round(source.at.x), round(source.at.y), round(source.at.z)],
    power: round(source.power),
    beam: round(source.beam),
    dir: source.dir ? [source.dir.x, source.dir.y, source.dir.z] : null,
  }));

function placeOf(project, schemeId, markId) {
  const scene = volumeScene(project, schemeId, { roofOff: true });
  return { scene, place: volumeMarkPlace(scene, markId) };
}

// ——— тело ————————————————————————————————————————————————————————————————

test("висячая люстра рожковая: чашка, цепь, колонна и кольцо из пяти рожков с шариками", () => {
  const model = objectModelByKey("chandelierHanging");
  assert.ok(model, "висячего описания в реестре нет");
  const by = (name) => model.parts.find((part) => part.name === name);
  assert.deepEqual(
    model.parts.map((part) => part.name),
    ["canopy", "chain", "column", "horn1", "ball1", "horn2", "ball2", "horn3", "ball3", "horn4", "ball4", "horn5", "ball5"],
  );
  // Предел метки взят **не** целиком: запас оставлен нарочно — следующая
  // правка силуэта не должна начинаться с похода за новым пределом.
  assert.equal(model.parts.length, 13);
  assert.ok(model.parts.length <= OBJECT_MODEL_BODY_MAX, "тел больше предела метки");
  assert.equal(objectModelFaceCount(model), 97);
  assert.ok(objectModelFaceCount(model) <= OBJECT_MODEL_FACE_MAX, "граней больше предела метки");
  // Чашка — у самого потолка, под ней цепь, под цепью колонна: силуэт висячей
  // люстры — это порядок, а не ширина плафона.
  assert.equal(round(by("canopy").z + by("canopy").height), 1, "чашка не у потолка");
  assert.equal(round(by("chain").z + by("chain").height), round(by("canopy").z), "цепь не доходит до чашки");
  assert.equal(round(by("column").z + by("column").height), round(by("chain").z), "колонна не доходит до цепи");
  assert.ok(by("chain").width < by("column").width / 2, "цепь не тоньше колонны: " + by("chain").width);
  assert.equal(by("column").kind, "cyl", "колонна не круглая");
  // Пять рожков стоят кольцом, а не по осям габарита: ни один не смотрит
  // строго вдоль ширины или глубины — иначе это крестовина, а не люстра.
  const horns = model.parts.filter((part) => /^horn[0-9]$/.test(part.name));
  const balls = model.parts.filter((part) => /^ball[0-9]$/.test(part.name));
  assert.equal(horns.length, 5);
  assert.equal(balls.length, 5);
  const angles = balls
    .map((ball) => {
      const x = ball.x + ball.width / 2;
      const y = ball.y + ball.depth / 2;
      return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    })
    .sort((a, b) => a - b);
  for (let index = 1; index < angles.length; index += 1) {
    assert.equal(angles[index] - angles[index - 1], 72, "шарики стоят не через 72°: " + angles.join(", "));
  }
  // Шарик круглый и ростом со свой поперечник — иначе это шайба, а заказчик
  // просил шарики.
  for (const ball of balls) {
    assert.equal(ball.kind, "cyl", ball.name + ": шарик не круглый");
    assert.ok(Math.abs(ball.width * 500 - ball.depth * 400) < 1, ball.name + ": шарик овальный в миллиметрах");
    assert.ok(Math.abs(ball.width * 500 - ball.height * 300) < 20, ball.name + ": шарик не ростом со свой поперечник");
  }
  // Рожок прячется под шариком: его конец не торчит наружу (живой прогон —
  // торчащие концы читаются лопастями вентилятора).
  for (let index = 0; index < 5; index += 1) {
    const ball = balls[index];
    const horn = horns[index];
    assert.ok(horn.z >= ball.z, horn.name + ": рожок ниже шарика");
    assert.ok(horn.z + horn.height <= ball.z + ball.height, horn.name + ": рожок выше шарика");
    assert.ok(Math.hypot(horn.x + horn.width / 2, horn.y + horn.depth / 2) < Math.hypot(ball.x + ball.width / 2, ball.y + ball.depth / 2));
  }
  // Светятся шарики, а не железо с хрусталём: светится то, откуда идёт свет.
  assert.deepEqual(model.parts.filter((part) => part.lit).map((part) => part.name), ["ball1", "ball2", "ball3", "ball4", "ball5"]);
  assert.deepEqual([by("canopy").material, by("chain").material, by("column").material], ["metal", "metal", "glass"]);
});

test("висячая люстра крупнее габарита вдвое, и растёт она вниз от потолка", () => {
  // Слова заказчика: «сделай её побольше, раза в 2». Растёт **рисунок**:
  // габарит метки остаётся её габаритом (G68, проверено ниже кадром — место,
  // размеры и лампа не тронуты).
  const model = objectModelByKey("chandelierHanging");
  const xs = model.parts.flatMap((part) => [part.x, part.x + part.width]);
  const ys = model.parts.flatMap((part) => [part.y, part.y + part.depth]);
  const zs = model.parts.flatMap((part) => [part.z, part.z + part.height]);
  // Вверх не уходит ничего: верх габарита стоит у потолка.
  assert.equal(round(Math.max(...zs)), 1, "люстра полезла выше потолка");
  assert.ok(Math.min(...zs) >= -1, "люстра свесилась больше чем на вторую высоту габарита");
  assert.ok(Math.min(...zs) < -0.5, "люстра не выросла вниз: " + Math.min(...zs));
  for (const span of [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]) {
    assert.ok(span > 1.2 && span <= 2, "в плане люстра выросла не вдвое: " + round(span));
  }
  // А обычная люстра из габарита не выходит ни одной долей — вариантом правится
  // только висячая.
  for (const part of objectModelByKey("chandelier").parts) {
    assert.ok(part.x >= -0.5 && part.x + part.width <= 0.5, part.name + ": обычная люстра вылезла из габарита");
    assert.ok(part.z >= 0 && part.z + part.height <= 1, part.name + ": обычная люстра вылезла по высоте");
  }
});

test("вариант подменяет модель и ничего больше: без отметки — та же ссылка", () => {
  const plain = objectModelByKey("chandelier");
  assert.equal(objectModelHanging(plain, false), plain, "без отметки описание подменилось");
  assert.equal(objectModelHanging(plain, undefined), plain);
  assert.equal(objectModelHanging(plain, true).key, "chandelierHanging");
  // У модели без варианта отметка не значит ничего — и та же ссылка.
  const socket = objectModelByKey("socket");
  assert.equal(objectModelHanging(socket, true), socket, "у розетки завёлся висячий вариант");
  assert.equal(objectModelHanging(null, true), null);
  // Список «у кого вариант есть» один на сборку, и ведёт он в живой ключ.
  assert.deepEqual(objectModelHangingKeys(), ["chandelier"]);
  for (const key of objectModelHangingKeys()) {
    assert.ok(objectModelByKey(objectModelHanging(objectModelByKey(key), true).key), key + ": вариант ведёт в пустоту");
  }
});

// ——— отметка у метки: механика стеклянной двери ——————————————————————————

test("отметка «Висячая» предлагается люстре и только ей", () => {
  const box = stand();
  const mark = (key) => findMark(box.project, box.marks[key]);
  assert.equal(typeViewName(box.project, mark("chandelier").typeId), "chandelier");
  assert.equal(markHangingCan(box.project, mark("chandelier")), true);
  assert.equal(markHangingCan(box.project, mark("socket")), false, "розетке предложили повисеть");
  assert.equal(markHangingCan(box.project, null), false);
});

test("отметка пишется только поставленной, снятая убирает ключ, чужой метке — отказ", () => {
  const box = stand();
  const id = box.marks.chandelier;
  // Пока не ставили — поля нет вовсе, и люстра обычная.
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(box.project, id), "hanging"), false);
  assert.equal(markHanging(box.project, findMark(box.project, id)), false);
  const hung = setMarkHanging(box.project, id, true).project;
  assert.equal(findMark(hung, id).hanging, true);
  assert.equal(markHanging(hung, findMark(hung, id)), true);
  // Снятая **убирает** ключ: метка без отметки и метка со снятой обязаны
  // читаться одинаково, иначе упаковка дописала бы старому объекту поле.
  const back = setMarkHanging(hung, id, false).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(back, id), "hanging"), false, "снятая отметка осталась ключом");
  assert.deepEqual(findMark(back, id), findMark(box.project, id), "метка после круга не та же");
  // Той, кому отметку не предлагают, модель её не пишет — отказывает.
  assert.throws(() => setMarkHanging(box.project, box.marks.socket, true));
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(setMarkHanging(box.project, box.marks.socket, false).project, box.marks.socket), "hanging"), false);
});

// ——— кадр и свет ——————————————————————————————————————————————————————————

test("G68: люстра без отметки рисуется и светит ровно как до правки", () => {
  const box = stand();
  const { scene, place } = placeOf(box.project, box.schemeId, box.marks.chandelier);
  assert.equal(place.model.key, BEFORE.model, "модель метки без отметки сменилась");
  // Та же ссылка на общее описание — значит ни одного нового тела.
  assert.equal(place.model, objectModelByKey("chandelier"));
  const faces = volumeMarkFaces(place, [], 1);
  assert.equal(faces.length, BEFORE.faces);
  assert.deepEqual(printOf(faces), BEFORE.print, "кадр люстры без отметки поехал");
  assert.deepEqual(lampsOf(place, scene), BEFORE.lamps, "лампа люстры без отметки поехала");
});

test("висячая люстра: тело другое, а лампа та же — свет от варианта не зависит", () => {
  const box = stand();
  const id = box.marks.chandelier;
  const plain = placeOf(box.project, box.schemeId, id);
  const hung = placeOf(setMarkHanging(box.project, id, true).project, box.schemeId, id);
  assert.equal(hung.place.model.key, "chandelierHanging");
  // Место, габарит и посадка метки не тронуты ничем (G68): переехал рисунок.
  assert.deepEqual(hung.place.anchor, plain.place.anchor);
  assert.deepEqual(hung.place.sizes, plain.place.sizes);
  assert.deepEqual(lampsOf(hung.place, hung.scene), lampsOf(plain.place, plain.scene), "свет поехал за телом");
  assert.deepEqual(lampsOf(hung.place, hung.scene), BEFORE.lamps);
  // Тело при этом другое, и висит оно ниже потолка: цепь тонкая, а самая
  // широкая грань плафона лежит ниже чашки.
  const faces = volumeMarkFaces(hung.place, [], 1);
  assert.notDeepEqual(printOf(faces), BEFORE.print, "висячая нарисовалась обычной");
  const top = Math.max(...faces.flatMap((face) => face.p.map((point) => point.z)));
  const litLow = Math.max(...faces.filter((face) => face.lit).flatMap((face) => face.p.map((point) => point.z)));
  assert.ok(litLow < top - 50, "плафон не опустился под чашку: " + round(top - litLow) + " мм");
  // Знак на плане и изображение у обеих люстр одно: отметка меняет тело.
  assert.equal(hung.place.view.name, plain.place.view.name);
});

// ——— обе трубы открытия ——————————————————————————————————————————————————

test("G68: обе трубы открытия не трогают отметку — ни дописывают, ни теряют", async () => {
  const box = stand();
  const id = box.marks.chandelier;
  const date = new Date("2026-11-09T10:00:00Z");
  const through = async (project) => {
    const blob = await packProject(project, new Map(), { date });
    const packed = new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY));
    const file = (await unpackProject(blob)).project;
    const stored = projectsMigrateStored(project);
    return { packed, file, stored };
  };
  // Объект без отметки: в файл не дописано ни ключа, обе трубы дали то же.
  const plain = await through(box.project);
  assert.ok(!plain.packed.includes('"hanging"'), "в файл объекта без отметки дописана отметка");
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(plain.file, id), "hanging"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(plain.stored, id), "hanging"), false);
  assert.equal(JSON.stringify(plain.file.marks), JSON.stringify(plain.stored.marks), "файл и база разошлись");
  // Идемпотентность: второе открытие не правит ничего (объект тем же по ссылке).
  assert.equal(projectsMigrateStored(plain.stored), plain.stored, "второе открытие что-то переписало");
  // Объект с отметкой: обе трубы её донесли, и люстра осталась висячей.
  const hungProject = setMarkHanging(box.project, id, true).project;
  const hung = await through(hungProject);
  assert.ok(hung.packed.includes('"hanging": true'), "отметка не доехала до файла");
  for (const project of [hung.file, hung.stored]) {
    assert.equal(findMark(project, id).hanging, true);
    assert.equal(markHanging(project, findMark(project, id)), true);
    assert.equal(placeOf(project, box.schemeId, id).place.model.key, "chandelierHanging");
  }
  assert.equal(projectsMigrateStored(hung.stored), hung.stored, "второе открытие объекта с отметкой что-то переписало");
});
