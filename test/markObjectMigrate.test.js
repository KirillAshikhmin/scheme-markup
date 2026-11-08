// Метка прибора получает вещь: миграция готовых объектов (требования G01,
// G01.1, G05).
//
// Слова заказчика о телевизоре и полотенцесушителе на готовых объектах:
// «Перевести миграцией сразу». Таск 186 увёл телевизор, полотенцесушитель и
// вытяжку из вещей чертежа в метки, и прибор потерял форму: угла у метки нет
// вовсе. Сборка «связь метки и вещи» вернула все три в каталог, и миграция
// **достраивает** метке вещь с тем же местом и габаритом, а не заменяет её.
//
// Что проверяется здесь, а не глазами:
//
//   1. вещь встала там, где стоит метка, с её габаритом и углом **привязанной
//      стены** — перевод осей считается в одном месте, и число в тесте
//      посчитано руками, а не взято у кода;
//   2. **сама метка не изменилась** ничем, кроме поля связи: номер, аксессуар,
//      связи «чем управляет», привязка к стене, высота — всё на месте, а значит
//      цел и дом (роль вытяжки в климате читается по коду типа);
//   3. объект, где таких меток нет, не меняется **вовсе** — тот же объект по
//      ссылке (G01.1);
//   4. второй проход ничего не делает (идемпотентность);
//   5. где моста мм ↔ доли нет, миграция молчит: выдумывать вещи место нельзя.
import test from "node:test";
import assert from "node:assert/strict";

import {
  FORMAT_VERSION,
  addMark,
  addSchemeObject,
  addScheme,
  addWall,
  createProject,
  deleteSchemeObject,
  findMark,
  findSchemeObject,
  markObjectId,
  markPlace,
  schemeObjectNameOf,
  setMarkControls,
  setMarkDevice,
  setMarkObject,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  updateMark,
} from "../src/model.js";
import { migrateThingMarks } from "../src/deviceMigrate.js";
import { buildHomeSpec, homeAccessories } from "../src/sim/home.js";
import { simClimateOf } from "../src/simulation.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { legacyIdsBefore } from "./fixtures/legacyIds.js";

// План 1200 × 800 точек, в метре сто точек (отрезок 0,1…0,6 по ширине — шесть
// метров), нуль чертежа — в точке (0,2; 0,8) плана, оси не повёрнуты. Стена
// идёт по `y = 0` от нуля на шесть метров.
//
// Отсюда считаются ожидания теста **руками**: метка в доле (0,5; 0,5) стоит в
// точке (600; 400) плана, нуль чертежа — в (240; 640), значит в миллиметрах это
// (3600; −2400). Метка лежит со стороны отрицательных `y`, то есть с левой
// стороны стены (левая нормаль — `(dy, −dx)/len` = `(0; −1)`), и перёд вещи
// смотрит туда же, прочь от стены: при нулевом повороте перёд уходит вниз по
// листу, поэтому угол здесь — 180°.
function scene(code, options = {}) {
  const added = addScheme(createProject({ name: "Приборы" }), { name: "1 этаж", imageId: "p", width: 1200, height: 800 });
  let project = added.project;
  const schemeId = added.scheme.id;
  if (options.bridge !== false) {
    project = setPlanScale(project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
    project = setPlanOrigin(project, schemeId, { at: { x: 0.2, y: 0.8 }, turn: 0 }).project;
  }
  const wall = addWall(project, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 6000, y: 0 }, thicknessMm: 100 });
  project = wall.project;
  const typeOf = (wanted) => project.markTypes.find((type) => type.code === wanted).id;
  const mark = addMark(project, { schemeId, typeId: typeOf(code), kind: "point", points: [{ x: 0.5, y: 0.5 }] });
  project = mark.project;
  if (options.wall !== false) project = setMarkWall(project, mark.mark.id, { wallId: wall.wall.id, atMm: 3600 }).project;
  return { project, schemeId, markId: mark.mark.id, wallId: wall.wall.id, typeOf };
}

test("G01: метка ТВ получает вещь с тем же местом и габаритом, а сама не меняется", () => {
  const box = scene("ТВ");
  // Свой габарит прибора: вдоль стены 1500, от стены 100, вверх 800, середина
  // на 1000 над полом.
  const before = updateMark(box.project, box.markId, { length: 1500, depth: 100, width: 800, heightAboveFloor: 1000 }).project;
  const after = migrateThingMarks(before);
  assert.equal(after.changed, true);
  assert.equal(after.made, 1);

  const mark = findMark(after.project, box.markId);
  const object = findSchemeObject(after.project, markObjectId(mark));
  assert.ok(object, "связь не поставлена");
  assert.equal(object.catalogKey, "tv");
  assert.equal(schemeObjectNameOf(after.project, object), "Телевизор");
  assert.equal(object.schemeId, box.schemeId);
  // Место и габарит — посчитанные руками (см. шапку `scene`).
  assert.deepEqual(object.atMm, { x: 3600, y: -2400 });
  assert.equal(object.widthMm, 1500, "длина вдоль стены");
  assert.equal(object.depthMm, 100, "глубина от стены");
  assert.equal(object.heightMm, 800, "высота вверх");
  assert.equal(object.heightAboveFloorMm, 600, "низ вещи — середина минус половина высоты");
  assert.equal(object.turnDeg, 180, "вещь смотрит не прочь от стены");

  // Сама метка не изменилась ничем, кроме поля связи.
  const was = findMark(before, box.markId);
  assert.deepEqual({ ...mark, objectId: undefined }, { ...was, objectId: undefined });
  assert.deepEqual(mark.points, was.points, "точки метки переписаны");

  // И пара читается как один прибор: место метка берёт у вещи.
  const place = markPlace(after.project, mark);
  assert.equal(place.from, "object");
  assert.equal(place.turnDeg, 180);
  assert.deepEqual(place.atMm, { x: 3600, y: -2400 });
});

test("G01: габарит метки без своих чисел берётся у типа, а место — у стены", () => {
  // Умолчания типа ПОС: вдоль 500, вверх 800, от стены 100, середина 900.
  const box = scene("ПОС");
  const after = migrateThingMarks(box.project);
  const object = findSchemeObject(after.project, markObjectId(findMark(after.project, box.markId)));
  assert.equal(object.catalogKey, "towelDryer");
  assert.deepEqual(object.atMm, { x: 3600, y: -2400 });
  assert.equal(object.widthMm, 500);
  assert.equal(object.depthMm, 100);
  assert.equal(object.heightMm, 800);
  assert.equal(object.heightAboveFloorMm, 500, "900 − 800 / 2");
  assert.equal(object.turnDeg, 180);

  // Метка без привязки к стене угла не получает: без стены направления не
  // знает никто, и выдумывать его нельзя.
  const loose = scene("ПОС", { wall: false });
  const made = migrateThingMarks(loose.project);
  const free = findSchemeObject(made.project, markObjectId(findMark(made.project, loose.markId)));
  assert.equal(free.turnDeg, 0);
});

test("G05: вытяжка стала парой, и климат по-прежнему видит её роль", () => {
  const box = scene("ВЫТ");
  const after = migrateThingMarks(box.project);
  const mark = findMark(after.project, box.markId);
  assert.equal(schemeObjectNameOf(after.project, findSchemeObject(after.project, markObjectId(mark))), "Вытяжка");

  // Роль читается по коду типа (`simClimateOf`), а носителем электрики
  // осталась метка — поэтому роль цела.
  const devices = simClimateOf(after.project, homeAccessories(after.project)).devices;
  const hood = devices.find((device) => device.markId === box.markId);
  assert.ok(hood, "вытяжка пропала из климата");
  assert.equal(hood.role, "hood");
});

test("G01: номер, аксессуар и связи после миграции те же", () => {
  const box = scene("ТВ");
  const lamp = addMark(box.project, { schemeId: box.schemeId, typeId: box.typeOf("Т"), kind: "point", points: [{ x: 0.2, y: 0.2 }] });
  let project = setMarkControls(lamp.project, box.markId, [lamp.mark.id]).project;
  project = setMarkDevice(project, box.markId, { kind: "tv" }).project;
  const before = findMark(project, box.markId);

  const after = migrateThingMarks(project).project;
  const mark = findMark(after, box.markId);
  assert.equal(mark.number, before.number);
  assert.deepEqual(mark.controls, before.controls, "связи «чем управляет» тронуты");
  assert.deepEqual(mark.device, before.device, "аксессуар тронут");
  assert.equal(mark.wallId, before.wallId, "привязка к стене тронута");
  // Дом собирается, и у метки по-прежнему есть аксессуар со своим адресом.
  const accessory = homeAccessories(after).find((item) => item.markId === box.markId);
  assert.ok(accessory, "прибор пропал из дома");
  assert.ok(buildHomeSpec(after).accessories.some((item) => item.markId === box.markId), "дом собрался без прибора");
});

test("G01.1: объект без меток приборов не меняется вовсе, а второй проход ничего не делает", () => {
  const plain = scene("Т");
  const idle = migrateThingMarks(plain.project);
  assert.equal(idle.changed, false);
  assert.equal(idle.made, 0);
  assert.equal(idle.project, plain.project, "объект без таких меток вернулся не тем же");

  // Идемпотентность: связь уже есть — переводить нечего.
  const box = scene("ТВ");
  const once = migrateThingMarks(box.project);
  const twice = migrateThingMarks(once.project);
  assert.equal(twice.changed, false);
  assert.equal(twice.project, once.project, "второй проход переписал объект");
  // И правка разметки от миграции не записывается: это открытие, а не правка.
  assert.equal(once.project.updatedAt, box.project.updatedAt, "миграция тронула updatedAt");
});

test("G01: вещь того же вида, уже стоящая под меткой, второй не обрастает", () => {
  // Телевизор и полотенцесушитель были вещами до таска 186, и на готовом
  // объекте заказчика встречаются и вещью, и меткой сразу: в одном из четырёх
  // нарисованный телевизор стоит в 239 мм от своего знака.
  const box = scene("ТВ");
  const put = addSchemeObject(box.project, {
    schemeId: box.schemeId,
    catalogKey: "tv",
    atMm: { x: 3600, y: -2200 },
    widthMm: 1240,
    depthMm: 80,
    heightMm: 720,
    heightAboveFloorMm: 500,
  });
  const after = migrateThingMarks(put.project);
  assert.equal(after.made, 0, "вещь построена заново, хотя она уже стоит");
  assert.equal(after.linked, 1);
  assert.equal(after.project.schemeObjects.length, 1, "на плане стало две вещи");
  assert.equal(markObjectId(findMark(after.project, box.markId)), put.schemeObject.id);
  // Стоявшая вещь не тронута ничем: ни местом, ни габаритом.
  assert.deepEqual(findSchemeObject(after.project, put.schemeObject.id), put.schemeObject);

  // А вещь того же вида в другом конце схемы — другой прибор: метке строится
  // своя, и чужая связь к ней не едет.
  const far = addSchemeObject(box.project, {
    schemeId: box.schemeId,
    catalogKey: "tv",
    atMm: { x: 0, y: -2400 },
    widthMm: 1240,
    depthMm: 80,
    heightMm: 720,
    heightAboveFloorMm: 500,
  });
  const built = migrateThingMarks(far.project);
  assert.equal(built.made, 1);
  assert.equal(built.linked, 0);
  assert.equal(built.project.schemeObjects.length, 2);
  assert.notEqual(markObjectId(findMark(built.project, box.markId)), far.schemeObject.id);
});

test("G01: код типа узнаётся без учёта регистра — «Пос» это ПОС", () => {
  // В модели коды уникальны без учёта регистра (`validate` сравнивает
  // `code.toUpperCase()`), и у заказчика полотенцесушитель назван «Пос»: с
  // учётом регистра его метка не переводилась бы, хотя вещь рядом нарисована.
  const box = scene("ПОС");
  const renamed = {
    ...box.project,
    markTypes: box.project.markTypes.map((type) => (type.code === "ПОС" ? { ...type, code: "Пос", name: "Полотенцесушитель" } : type)),
  };
  const after = migrateThingMarks(renamed);
  assert.equal(after.changed, true, "метка с кодом «Пос» не переведена");
  const object = findSchemeObject(after.project, markObjectId(findMark(after.project, box.markId)));
  assert.equal(object.catalogKey, "towelDryer");

  // А переименованное **имя** типа по-прежнему ни на что не влияет: узнаётся
  // только код, и чужой код вещи не получает.
  const alien = {
    ...box.project,
    markTypes: box.project.markTypes.map((type) => (type.code === "ПОС" ? { ...type, code: "СУШ" } : type)),
  };
  assert.equal(migrateThingMarks(alien).changed, false, "метка с чужим кодом переведена догадкой по имени");
});

test("G01: без моста мм ↔ доли вещь не выдумывается", () => {
  // У схемы нет ни калибровки, ни привязки начала координат: доли плана в
  // миллиметры не переводятся, и места для вещи не существует.
  const box = scene("ТВ", { bridge: false });
  const after = migrateThingMarks(box.project);
  assert.equal(after.changed, false);
  assert.equal(after.project, box.project);
  assert.equal(markObjectId(findMark(after.project, box.markId)), null);
});

// Переводится **объект прежней сборки**, и фикстура здесь именно такая
// (`legacyIdsBefore`): объект, собранный нынешней моделью, пронумерован от
// рождения, то есть версии 8 — а значит эту сборку он уже прошёл, и
// достраивать ему нечего (`thingMarksMigrated`).
test("G01: обе трубы открытия достраивают вещь одинаково", async () => {
  const box = scene("ТВ");
  // Версия прежней сборки стоит и полем: таким объект и лежит в базе браузера.
  const legacy = { ...legacyIdsBefore(box.project), formatVersion: FORMAT_VERSION };
  const typeCode = box.project.markTypes.find((type) => type.id === findMark(box.project, box.markId).typeId).code;
  const fromFile = (await unpackProject(await packProject(legacy, new Map()))).project;
  const stored = projectsMigrateStored(legacy);
  for (const project of [fromFile, stored]) {
    const code = (mark) => project.markTypes.find((type) => type.id === mark.typeId).code;
    const mark = project.marks.find((item) => code(item) === typeCode);
    const object = findSchemeObject(project, markObjectId(mark));
    assert.ok(object, "труба открытия вещь не достроила");
    assert.equal(object.catalogKey, "tv");
    assert.deepEqual(object.atMm, { x: 3600, y: -2400 });
    assert.equal(object.turnDeg, 180);
  }
  assert.equal(
    JSON.stringify({ ...fromFile, formatVersion: null }),
    JSON.stringify({ ...stored, formatVersion: null }),
    "трубы достроили по-разному",
  );
  // И версию формата дописывают обе: объект, прошедший трубу, пронумерован
  // целиком и потому всегда версии 8 (ADR 030). Базе это не формальность —
  // по версии объект и называет себя переведённым.
  assert.equal(fromFile.formatVersion, 8, "файл открылся без версии 8");
  assert.equal(stored.formatVersion, 8, "база открыла объект прежней версией");
});

// Перевод случается **один раз на объект**. Признак «связи нет» это не ловил, и
// заказчик терял работу: отвязал метку рукой — открытие связало её снова;
// удалил достроенную вещь — открытие достроило новую; отвязал и увёл метку —
// на плане появилась вторая вещь.
test("G01 (история 2): снятая рукой связь и удалённая вещь переживают любое число открытий", async () => {
  const box = scene("ТВ");
  const legacy = { ...legacyIdsBefore(box.project), formatVersion: FORMAT_VERSION };
  for (const open of [
    async (project) => (await unpackProject(await packProject(project, new Map()))).project,
    async (project) => projectsMigrateStored(project),
  ]) {
    // Первое открытие: вещь достроена и связана.
    const first = await open(legacy);
    const markId = first.marks[0].id;
    assert.ok(markObjectId(findMark(first, markId)), "первое открытие вещь не достроило");
    assert.equal(first.schemeObjects.length, 1);

    // Человек снял связь руками — и открыл объект снова.
    const unlinked = setMarkObject(first, markId, null).project;
    const again = await open(unlinked);
    assert.equal(markObjectId(findMark(again, markId)), null, "открытие вернуло снятую рукой связь");
    assert.equal(again.schemeObjects.length, 1, "открытие достроило вторую вещь");

    // Человек удалил достроенную вещь — и открыл объект снова.
    const dropped = deleteSchemeObject(unlinked, first.schemeObjects[0].id).project;
    const third = await open(dropped);
    assert.equal((third.schemeObjects || []).length, 0, "открытие достроило удалённую вещь заново");
    assert.equal(markObjectId(findMark(third, markId)), null, "открытие связало метку заново");
  }
});
