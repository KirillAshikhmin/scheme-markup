// Связь метки и вещи чертежа (требования R01, R02, R07, R08).
//
// Один и тот же прибор инженер рисует дважды: телевизор на чертеже —
// прямоугольник 1240 × 720, который разворачивают к дивану, он же в разметке —
// знак «ТВ1» с аксессуаром, который включается в имитации. До этой сборки две
// записи ничего друг о друге не знали: **угла у метки нет вовсе**, а у вещи нет
// ни номера, ни аксессуара, ни строки в таблице.
//
// Что проверяется здесь, а не глазами:
//
//   1. **Связь — одно поле у метки**, и правила её постановки: нельзя с вещью
//      другой схемы, нельзя с занятой, нельзя комментарием, и отказ **называет
//      причину словами** (R01.3) — молчаливой недоступной кнопки быть не должно.
//   2. **Без связи `markPlace` отдаёт ровно то, что сегодня.** Это главное его
//      свойство: кадр объекта без связей не меняется ни на вызов.
//   3. **Со связью место, габарит, угол и высоту даёт вещь**, с переводом осей
//      (у метки `heightAboveFloor` — середина, у вещи — низ), а `mark.points`
//      при этом **не переписывается**: правка вещи не трогает объект метки.
//   4. **Вещь удалили — связь снята, метка осталась** (R01.4): электрика не
//      теряется, потому что носитель её — метка.
//   5. **«Сделать устройством»** заводит метку выбранного типа на месте вещи и
//      связывает одним действием (R02.3).
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  setMarkWall,
  wallElevation,
  addSchemeObject,
  addToGroup,
  addWall,
  createProject,
  deleteSchemeObject,
  findMark,
  markObjectCan,
  markObjectId,
  markOfObject,
  markPairLabel,
  markPlace,
  markSizes,
  markSnapshot,
  schemeObjectPaired,
  objectDeviceDrop,
  objectDeviceMake,
  pasteMark,
  setMarkObject,
  setPlanOrigin,
  setPlanScale,
  updateMark,
  updateSchemeObject,
} from "../src/model.js";

// План 1200 × 800 точек, в метре ровно 100 точек, начало координат чертежа — в
// левом верхнем углу плана. Только с обеими половинами (калибровка и привязка)
// существует мост «миллиметры ↔ доли плана», без которого чертёж на подложку не
// ложится вовсе.
function scene({ bridge = true } = {}) {
  const added = addScheme(createProject({ name: "Связь" }), {
    name: "1 этаж",
    imageId: "plan-1",
    width: 1200,
    height: 800,
  });
  const schemeId = added.scheme.id;
  let project = added.project;
  if (bridge) {
    project = setPlanScale(project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
    project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  }
  project = addWall(project, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 100 }).project;
  return { project, schemeId };
}

function tvAt(base, patch = {}) {
  const added = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "tv",
    shape: "rect",
    atMm: { x: 2000, y: 200 },
    widthMm: 1240,
    depthMm: 80,
    heightMm: 720,
    heightAboveFloorMm: 500,
    turnDeg: 90,
    ...patch,
  });
  return { ...base, project: added.project, object: added.schemeObject };
}

function markOf(base, code, point = { x: 0.4, y: 0.4 }, kind = "point") {
  const type = base.project.markTypes.find((item) => item.code === code);
  const added = addMark(base.project, { schemeId: base.schemeId, typeId: type.id, kind, points: [point] });
  return { ...base, project: added.project, mark: added.mark };
}

// ——— связь: правила ————————————————————————————————————————————————————

test("связь ставится и снимается, а поле у метки появляется и исчезает", () => {
  const withTv = tvAt(scene());
  const put = markOf(withTv, "ТВ");
  assert.equal(markObjectId(put.mark), null, "у новой метки взялась связь");
  assert.equal(Object.prototype.hasOwnProperty.call(put.mark, "objectId"), false, "поле есть у несвязанной метки");

  const linked = setMarkObject(put.project, put.mark.id, put.object.id);
  assert.equal(markObjectId(linked.mark), put.object.id);
  assert.equal(markOfObject(linked.project, put.object.id).id, put.mark.id, "обратный ответ не сошёлся");

  // Связь уже такая — тот же объект по ссылке: ни правки, ни шага истории.
  assert.equal(setMarkObject(linked.project, put.mark.id, put.object.id).project, linked.project);

  // Снятие **убирает поле**: метка без связи и метка со снятой связью обязаны
  // читаться одинаково (G68).
  const off = setMarkObject(linked.project, put.mark.id, null);
  assert.equal(markObjectId(off.mark), null);
  assert.equal(Object.prototype.hasOwnProperty.call(off.mark, "objectId"), false, "поле осталось обнулённым");
  assert.equal(markOfObject(off.project, put.object.id), null);
  assert.equal(setMarkObject(off.project, put.mark.id, null).project, off.project);
});

test("связать нельзя: другая схема, занятая вещь, комментарий — и причина названа словами", () => {
  const first = tvAt(scene());
  const put = markOf(first, "ТВ");
  assert.deepEqual(markObjectCan(put.project, put.mark.id, put.object.id), { ok: true });

  // Вещь другой схемы: прибор живёт на одном листе.
  const second = addScheme(put.project, { name: "2 этаж", imageId: "plan-2", width: 600, height: 400 });
  const alien = addSchemeObject(second.project, {
    schemeId: second.scheme.id,
    catalogKey: "tv",
    shape: "rect",
    atMm: { x: 100, y: 100 },
    widthMm: 1240,
    depthMm: 80,
  });
  const otherScheme = markObjectCan(alien.project, put.mark.id, alien.schemeObject.id);
  assert.equal(otherScheme.ok, false);
  assert.match(otherScheme.why, /схем/i, "причина не называет схему: " + otherScheme.why);
  assert.throws(() => setMarkObject(alien.project, put.mark.id, alien.schemeObject.id), { code: "markObjectRefused" });

  // Занятая вещь: связь у вещи одна, и причина называет метку, которая её заняла.
  const taken = setMarkObject(put.project, put.mark.id, put.object.id).project;
  const second2 = markOf({ ...put, project: taken }, "ТВ", { x: 0.7, y: 0.7 });
  const busy = markObjectCan(second2.project, second2.mark.id, put.object.id);
  assert.equal(busy.ok, false);
  assert.ok(busy.why.includes("ТВ1"), "причина не называет занявшую метку: " + busy.why);

  // Комментарий — надпись на чертеже, а не прибор.
  const plate = addMark(put.project, {
    schemeId: put.schemeId,
    typeId: "comment",
    kind: "comment",
    points: [{ x: 0.2, y: 0.2 }],
  });
  const comment = markObjectCan(plate.project, plate.mark.id, put.object.id);
  assert.equal(comment.ok, false);
  assert.ok(comment.why.length > 0);

  // И метки или вещи, которых нет, — тоже причина, а не падение.
  assert.equal(markObjectCan(put.project, "нет такой", put.object.id).ok, false);
  assert.equal(markObjectCan(put.project, put.mark.id, "нет такой").ok, false);
});

test("вещь удалили — связь снята, метка осталась там, где стояла", () => {
  const withTv = tvAt(scene());
  const put = markOf(withTv, "ТВ", { x: 0.33, y: 0.44 });
  const linked = setMarkObject(put.project, put.mark.id, put.object.id);
  const gone = deleteSchemeObject(linked.project, put.object.id);
  const mark = findMark(gone.project, put.mark.id);
  assert.ok(mark, "метка ушла вместе с вещью");
  assert.equal(markObjectId(mark), null, "связь осталась висеть в пустоте");
  assert.equal(Object.prototype.hasOwnProperty.call(mark, "objectId"), false);
  assert.deepEqual(mark.points, put.mark.points, "метка поехала от удаления вещи");
  // Объект без связей удаление вещи не правит вовсе.
  const plain = tvAt(scene());
  const quiet = deleteSchemeObject(plain.project, plain.object.id);
  assert.deepEqual(quiet.project.marks, plain.project.marks);
});

// ——— место: резолвер ————————————————————————————————————————————————————

test("без связи `markPlace` отдаёт ровно то, что отдаёт метка сама", () => {
  const base = scene();
  const put = markOf(base, "В", { x: 0.25, y: 0.75 });
  const place = markPlace(put.project, put.mark);
  assert.equal(place.from, "mark");
  assert.equal(place.object, null);
  assert.equal(place.bridged, false);
  assert.deepEqual(place.points, put.mark.points, "точки знака разошлись с точками метки");
  assert.equal(place.turnDeg, null, "у метки взялся угол, которого у неё нет");
  // Размеры — та же лестница наследования, что у `markSizes`: своё → группа →
  // тип. Второго счёта размеров резолвер не заводит.
  assert.deepEqual(place.sizes, markSizes(put.project, put.mark));
  assert.equal(place.heightAboveFloor, markSizes(put.project, put.mark).heightAboveFloor);
  // И высота группы доходит до резолвера той же ступенью.
  const grown = addToGroup(put.project, put.mark.id, "right");
  const sized = updateMark(grown.project, put.mark.id, { heightAboveFloor: 1234 });
  assert.equal(markPlace(sized.project, findMark(sized.project, grown.mark.id)).sizes.heightAboveFloorFrom, "group");
});

test("со связью место, габарит, угол и высоту даёт вещь, а точки метки не переписываются", () => {
  const withTv = tvAt(scene());
  const put = markOf(withTv, "ТВ", { x: 0.1, y: 0.1 });
  const linked = setMarkObject(put.project, put.mark.id, put.object.id);
  const place = markPlace(linked.project, linked.mark);

  assert.equal(place.from, "object");
  assert.equal(place.object.id, put.object.id);
  assert.equal(place.bridged, true);
  // Место — середина вещи, а не точка метки.
  assert.deepEqual(place.atMm, { x: 2000, y: 200 });
  assert.notDeepEqual(place.points, put.mark.points, "знак остался на точке метки");
  // Угол — у вещи; у метки своего угла по-прежнему нет вовсе (R05.1).
  assert.equal(place.turnDeg, 90);
  assert.equal(Object.prototype.hasOwnProperty.call(linked.mark, "turnDeg"), false, "у метки завёлся угол");
  // Габарит с переводом осей: `length` вдоль, `depth` от поверхности, `width`
  // вверх; высота над полом — **середина**, а у вещи записан низ.
  assert.equal(place.sizes.length, 1240);
  assert.equal(place.sizes.depth, 80);
  assert.equal(place.sizes.width, 720);
  assert.equal(place.heightAboveFloor, 500 + 720 / 2);
  assert.equal(place.sizes.lengthFrom, "object");
  assert.equal(place.sizes.lengthOwn, false);

  // Правка вещи едет в место, а объект метки не трогает (G68 и правило
  // «место считается, а не переписывается»).
  const moved = updateSchemeObject(linked.project, put.object.id, { atMm: { x: 3000, y: 900 }, turnDeg: 180 });
  const after = markPlace(moved.project, findMark(moved.project, put.mark.id));
  assert.deepEqual(after.atMm, { x: 3000, y: 900 });
  assert.equal(after.turnDeg, 180);
  assert.deepEqual(findMark(moved.project, put.mark.id).points, put.mark.points, "правка вещи переписала точки метки");
});

test("без моста «миллиметры ↔ доли» знак остаётся у метки, а габарит всё равно от вещи", () => {
  const withTv = tvAt(scene({ bridge: false }));
  const put = markOf(withTv, "ТВ", { x: 0.15, y: 0.25 });
  const linked = setMarkObject(put.project, put.mark.id, put.object.id);
  const place = markPlace(linked.project, linked.mark);
  assert.equal(place.from, "object");
  assert.equal(place.bridged, false, "доли плана посчитались без калибровки");
  assert.deepEqual(place.points, put.mark.points, "знаку выдумали место");
  assert.equal(place.sizes.length, 1240);
  assert.equal(place.turnDeg, 90);
});

test("у полосы угла нет, а место — середина её габарита", () => {
  const base = scene();
  const strip = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "counter",
    shape: "polyline",
    pointsMm: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 600 },
    ],
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
  });
  const put = markOf({ ...base, project: strip.project }, "Р", { x: 0.2, y: 0.2 });
  const linked = setMarkObject(put.project, put.mark.id, strip.schemeObject.id);
  const place = markPlace(linked.project, linked.mark);
  assert.equal(place.from, "object");
  assert.equal(place.turnDeg, null, "у полосы взялся угол");
  assert.deepEqual(place.atMm, { x: 500, y: 300 });
  // Длина полосы — её протяжённость, ширина — записанная.
  assert.equal(place.sizes.length, 1600);
  assert.equal(place.sizes.depth, 600);
});

// ——— связь в правках метки ——————————————————————————————————————————————

test("связь едет через те же двери, что остальные поля метки", () => {
  const withTv = tvAt(scene());
  const put = markOf(withTv, "ТВ");
  // Белый список правки: без него поле исчезло бы на первой же правке карточки.
  const patched = updateMark(put.project, put.mark.id, { objectId: put.object.id, location: "над диваном" });
  assert.equal(markObjectId(patched.mark), put.object.id);
  assert.equal(patched.mark.location, "над диваном");
  // И правило у двери одно: занятую вещь `updateMark` тоже не пускает.
  const second = markOf({ ...put, project: patched.project }, "ТВ", { x: 0.8, y: 0.8 });
  assert.throws(() => updateMark(second.project, second.mark.id, { objectId: put.object.id }), {
    code: "markObjectRefused",
  });

  // Снимок носит связь всегда — как размеры: «связи нет» приходит `null`.
  assert.equal(markSnapshot(patched.project, put.mark.id).objectId, put.object.id);
  assert.equal(markSnapshot(put.project, put.mark.id).objectId, null);

  // Копия, поставленная при живом исходнике, выходит **без** связи: вещь
  // занята, и двух строк у одного прибора быть не должно.
  const copy = pasteMark(patched.project, markSnapshot(patched.project, put.mark.id), {
    schemeId: put.schemeId,
    point: { x: 0.6, y: 0.6 },
  });
  assert.equal(markObjectId(copy.mark), null, "копия забрала связь у исходника");
  // А «скопировал, удалил, вставил» — перенос прибора, и там связь доезжает.
  const snapshot = markSnapshot(patched.project, put.mark.id);
  const without = setMarkObject(patched.project, put.mark.id, null).project;
  const back = pasteMark(without, snapshot, { schemeId: put.schemeId, point: { x: 0.6, y: 0.6 } });
  assert.equal(markObjectId(back.mark), put.object.id, "связь не доехала до переноса");
});

// ——— пара одной строкой (R06, история 14) ——————————————————————————————

test("строку даёт метка: имя прибора — обозначение плюс имя вещи, а вещь второй строки не получает", () => {
  const withTv = tvAt(scene());
  const put = markOf(withTv, "ТВ");

  // Без связи имя прибора — **ровно** обозначение метки: список и таблицы
  // объекта без связей не меняются ни на знак (G68).
  assert.equal(markPairLabel(put.project, put.mark), "ТВ1");
  assert.equal(schemeObjectPaired(put.project, put.object), false, "несвязанная вещь сочлась парой");

  const linked = setMarkObject(put.project, put.mark.id, put.object.id);
  assert.equal(markPairLabel(linked.project, linked.mark), "ТВ1 · Телевизор");
  assert.equal(schemeObjectPaired(linked.project, put.object), true);

  // Связь сняли — имя и ответ вернулись к прежним.
  const off = setMarkObject(linked.project, put.mark.id, null);
  assert.equal(markPairLabel(off.project, off.mark), "ТВ1");
  assert.equal(schemeObjectPaired(off.project, put.object), false);

  // Вещь, которой нет, и метка, которой нет, отвечают, а не падают.
  assert.equal(schemeObjectPaired(linked.project, null), false);
  assert.equal(schemeObjectPaired(linked.project, { id: "нет такой" }), false);
  assert.equal(markPairLabel(linked.project, null), "");
});

// ——— развёртка знает угол и место вещи (история 12) ——————————————————————

test("развёртка получает угол вещи и место прибора, а без связи лист не меняется", () => {
  const withTv = tvAt(scene(), { atMm: { x: 2000, y: 50 }, turnDeg: 0 });
  const put = markOf(withTv, "ТВ", { x: 0.3, y: 0.05 });
  const wallId = withTv.project.walls[0].id;
  const bound = setMarkWall(put.project, put.mark.id, { wallId, atMm: 2000 }, { manual: true });

  const before = wallElevation(bound.project, wallId, "right").marks.find((row) => row.id === put.mark.id);
  assert.ok(before, "метка не попала на развёртку — пример не тот");
  // Своего угла у метки нет вовсе: без связи разворачивать нечего.
  assert.equal(before.turnDeg, null);
  assert.equal(before.placeFrom, "mark");
  assert.equal(before.objectName, "");

  const linked = setMarkObject(bound.project, put.mark.id, put.object.id);
  const after = wallElevation(linked.project, wallId, "right").marks.find((row) => row.id === put.mark.id);
  assert.equal(after.turnDeg, 0, "угол вещи не доехал до развёртки");
  assert.equal(after.placeFrom, "object");
  assert.equal(after.objectName, "Телевизор");
  // Габарит и посадку на листе теперь меряет вещь: 1240 вдоль, 720 вверх,
  // середина на 500 + 720 / 2.
  assert.deepEqual(after.sizeMm, { width: 1240, height: 720 });
  assert.equal(after.heightMm, 860);
  // Повернули вещь — поехал и угол на листе, и больше ничего.
  const turned = updateSchemeObject(linked.project, put.object.id, { turnDeg: 30 });
  const spun = wallElevation(turned.project, wallId, "right").marks.find((row) => row.id === put.mark.id);
  assert.equal(spun.turnDeg, 30);
  assert.deepEqual({ ...spun, turnDeg: 0 }, { ...after, turnDeg: 0 }, "от поворота вещи на листе поехало что-то ещё");

  // А лист объекта **без связей** остаётся прежним до поля: это и есть G68.
  const plain = markOf(scene(), "В", { x: 0.3, y: 0.05 });
  const plainBound = setMarkWall(plain.project, plain.mark.id, { wallId: plain.project.walls[0].id, atMm: 2000 }, { manual: true });
  const row = wallElevation(plainBound.project, plain.project.walls[0].id, "right").marks[0];
  const sizes = markSizes(plainBound.project, findMark(plainBound.project, plain.mark.id));
  assert.deepEqual(row.sizeMm, { width: sizes.length, height: sizes.width });
  assert.equal(row.heightMm, sizes.heightAboveFloor);
  assert.equal(row.heightFrom, sizes.heightAboveFloorFrom);
  assert.equal(row.heightOwn, sizes.heightAboveFloorOwn);
});

// ——— вещь становится устройством (R02.3) ————————————————————————————————

test("«Сделать устройством» заводит метку на месте вещи и связывает её", () => {
  const withTv = tvAt(scene());
  const type = withTv.project.markTypes.find((item) => item.code === "ТВ");
  const made = objectDeviceMake(withTv.project, withTv.object.id, type.id);

  assert.equal(markObjectId(made.mark), withTv.object.id);
  assert.equal(made.mark.typeId, type.id);
  assert.equal(made.mark.number, 1, "номер выдан не правилами нумерации типа");
  // Точка метки — середина вещи: по ней работает автоматика помещения и
  // привязки к стене, а место прибора всё равно считается у вещи.
  const place = markPlace(made.project, made.mark);
  assert.equal(place.from, "object");
  assert.deepEqual(place.atMm, { x: 2000, y: 200 });

  // Доступно **любой** вещи каталога, а не только трём приборам.
  const sofa = addSchemeObject(made.project, {
    schemeId: withTv.schemeId,
    catalogKey: "sofa",
    shape: "rect",
    atMm: { x: 1000, y: 1000 },
    widthMm: 2200,
    depthMm: 900,
    heightMm: 850,
  });
  const lit = objectDeviceMake(sofa.project, sofa.schemeObject.id, withTv.project.markTypes.find((item) => item.code === "Р").id);
  assert.equal(markObjectId(lit.mark), sofa.schemeObject.id);

  // Второе устройство той же вещи не заводится: связь у вещи одна.
  assert.throws(() => objectDeviceMake(lit.project, withTv.object.id, type.id), { code: "markObjectRefused" });

  // Обратное действие — связь снята и метка удалена, вещь осталась.
  const dropped = objectDeviceDrop(lit.project, withTv.object.id);
  assert.equal(dropped.deleted.id, made.mark.id);
  assert.equal(findMark(dropped.project, made.mark.id), null);
  assert.ok(dropped.project.schemeObjects.some((object) => object.id === withTv.object.id), "вещь ушла вместе с меткой");
  // Устройства нет — тот же объект и честный `null`.
  const again = objectDeviceDrop(dropped.project, withTv.object.id);
  assert.equal(again.project, dropped.project);
  assert.equal(again.deleted, null);
});

test("линейный тип проводится по вещи, а форму ленты вещь потом не стирает", () => {
  const base = scene();
  const cabinet = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "cabinet",
    shape: "rect",
    atMm: { x: 1000, y: 1000 },
    widthMm: 1000,
    depthMm: 600,
    heightMm: 2000,
  });
  const strip = base.project.markTypes.find((item) => item.code === "ПШ");
  assert.equal(strip.kind, "line", "пример не тот: тип не линейный");
  const made = objectDeviceMake(cabinet.project, cabinet.schemeObject.id, strip.id);
  // Лента легла **по вещи** — двумя вершинами по передней кромке габарита, а не
  // одной точкой в её середине: линия в одну вершину не линия вовсе.
  assert.equal(made.mark.kind, "line");
  assert.equal(made.mark.points.length, 2);
  assert.equal(markObjectId(made.mark), cabinet.schemeObject.id);

  // Форму ленты вещь не переписывает: она про прибор, а не про рисунок.
  // Габарит, угол и высоту связанная линия при этом берёт у вещи наравне с
  // точечной меткой.
  const place = markPlace(made.project, made.mark);
  assert.equal(place.from, "object");
  assert.deepEqual(place.points, made.mark.points, "резолвер стёр форму ленты");
  assert.equal(place.bridged, false);
  assert.equal(place.sizes.length, 1000);
  assert.equal(place.sizes.width, 2000);
});

test("без калибровки плана «Сделать устройством» отказывает вслух, а не кладёт метку куда-нибудь", () => {
  const withTv = tvAt(scene({ bridge: false }));
  const type = withTv.project.markTypes.find((item) => item.code === "ТВ");
  assert.throws(() => objectDeviceMake(withTv.project, withTv.object.id, type.id), {
    code: "objectDeviceNoPlan",
  });
});
