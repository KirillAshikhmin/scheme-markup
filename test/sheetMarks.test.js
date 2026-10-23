// Таск 220 — два дефекта, найденные замерами в чужих тасках.
//
// **D67: метки разъезжались, когда у схемы появлялся лист.** У схемы без
// подложки размеры нулевые, и доля метки считалась от запасного квадрата
// `SCHEME_FALLBACK_PX` (1000 × 1000). Первая стена или первая вещь заводит
// схеме лист 4000 × 3000 (`workshopEnsureSheet`) — и та же доля начинала
// значить другое место. Замер исполнителя таска 217: три метки в 60–70 точках
// друг от друга оказались в 2,4 м и 1,2 м, да ещё и с перекошенной пропорцией
// (лист 4:3 против квадрата 1:1).
//
// Решение — пересчитывать доли в ту же минуту и тем же шагом истории
// (`model.resizeSchemePlan`), а не запрещать метки на схеме без размера: схема
// без подложки — рабочий путь («можно создавать схему без подложки», слова
// заказчика), таск 217 только что проверил живьём, что метка на неё ставится,
// а отказ ещё и не помог бы тем меткам, которые у людей уже стоят.
//
// Числа «до» в тестах вписаны руками — это замер дефекта, а не вывод кода.
//
// **D68: «+» и «−» в чертеже не делали ничего.** Клавиатурного масштаба у
// чертежа не было вовсе, при том что кнопки «−»/«+» в «Интерфейсе» работали, а
// на плане те же клавиши работают и обещаны подсказкой. Здесь держится и
// поведение (набор клавиш со шагом — один на две поверхности), и слова: о
// клавише, про которую негде прочитать, см. правило таска 213.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCHEME_FALLBACK_PX,
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addSchemeGuide,
  createProject,
  findMark,
  findOutline,
  findScheme,
  planFractionToMm,
  planOriginOf,
  planPixelsPerMeter,
  planScaleOf,
  resizeSchemePlan,
  schemeGuides,
  setPlanOrigin,
  setPlanScale,
} from "../src/model.js";
import { canvasZoomKey } from "../src/canvas.js";
import {
  WORKSHOP_SHEET,
  workshopAddChain,
  workshopEnsureSheet,
  workshopHint,
} from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "src");
const read = (name) => readFileSync(join(SRC_DIR, name), "utf8");

// Объект прежней сборки с подложкой, метками, контуром и калибровкой — на нём
// держится G68: у обоих объектов заказчика подложка есть, и ни один из них
// этот таск не имеет права сдвинуть ни на долю.
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-project.json"), "utf8");
const legacy = () => JSON.parse(LEGACY_TEXT);

// Схема без подложки — та самая, у которой размер появится позже.
function blankProject() {
  const added = addScheme(createProject(), { name: "от руки" });
  return { project: added.project, schemeId: added.scheme.id };
}

// Три метки в точках запасного квадрата: по горизонтали 60, по вертикали 70.
const PLACED_PX = [
  { x: 450, y: 450 },
  { x: 510, y: 450 },
  { x: 510, y: 520 },
];

function threeMarks() {
  const base = blankProject();
  const typeId = base.project.markTypes[0].id;
  let project = base.project;
  const ids = [];
  for (const point of PLACED_PX) {
    const added = addMark(project, {
      schemeId: base.schemeId,
      typeId,
      points: [{ x: point.x / SCHEME_FALLBACK_PX, y: point.y / SCHEME_FALLBACK_PX }],
    });
    project = added.project;
    ids.push(added.mark.id);
  }
  return { project, schemeId: base.schemeId, ids };
}

const ROOM = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
  { x: 0, y: 0 },
];

test("D67: метки, поставленные до листа, остаются на тех же расстояниях", () => {
  const placed = threeMarks();
  const result = workshopAddChain(placed.project, placed.schemeId, ROOM, 100);
  const mm = placed.ids.map((id) => {
    const mark = findMark(result.project, id);
    return planFractionToMm(result.project, placed.schemeId, mark.points[0]);
  });
  // Сантиметр на пиксель плана: 60 точек запасного квадрата — 600 мм, 70 — 700.
  // Было до правки: 2400 мм и 2100 мм — то есть вчетверо и втрое больше.
  assert.equal(mm[1].x - mm[0].x, 600, "горизонтальный разбег уехал");
  assert.equal(mm[2].y - mm[1].y, 700, "вертикальный разбег уехал");
  assert.equal(mm[0].y, mm[1].y, "две метки стояли на одной высоте — и обязаны стоять");
  assert.equal(mm[1].x, mm[2].x, "две метки стояли на одной вертикали — и обязаны стоять");
  // Пропорция: 60 к 70 была и осталась. Перекос 4:3 дал бы 240 к 210.
  assert.equal((mm[1].x - mm[0].x) / (mm[2].y - mm[1].y), 60 / 70, "пропорция перекошена");
});

test("D67: пересчёт идёт одним шагом — лист, метки и стены в одном объекте", () => {
  // Правка объекта через историю и одним шагом: `workshopAddChain` отдаёт один
  // объект, в котором уже всё — лист, переложенные метки и стены. Вызывающий
  // кладёт его в `canvasCommit` один раз, и Ctrl+Z возвращает всё целиком.
  const placed = threeMarks();
  const result = workshopAddChain(placed.project, placed.schemeId, ROOM, 100);
  const scheme = findScheme(result.project, placed.schemeId);
  assert.equal(scheme.width, WORKSHOP_SHEET.width);
  assert.equal(scheme.height, WORKSHOP_SHEET.height);
  assert.equal(result.added, 4, "стены встали тем же шагом");
  assert.equal(result.marks, 3, "о пересчёте не сказано наружу — значит плашка промолчит");
  const before = findMark(placed.project, placed.ids[0]).points[0];
  const after = findMark(result.project, placed.ids[0]).points[0];
  assert.notDeepEqual(after, before, "доля не пересчитана вовсе");
  // Отмена — дело истории, а здесь главное: прежний объект цел, его не правили
  // на месте (каждая функция модели возвращает новый объект).
  assert.deepEqual(findMark(placed.project, placed.ids[0]).points[0], {
    x: PLACED_PX[0].x / SCHEME_FALLBACK_PX,
    y: PLACED_PX[0].y / SCHEME_FALLBACK_PX,
  });
});

test("D67: о пересчёте есть что сказать словом — лист заводится молча, он нет", () => {
  assert.match(strings.workshop.sheetMarks, /\{count\}/, "число меток в известии не названо");
  const text = read(join("panels", "workshop.js"));
  // Двое заводят лист — первая стена и первая вещь, — и оба обязаны сказать.
  assert.equal(
    (text.match(/workshop\.sheetMarks/g) || []).length,
    2,
    "известие о пересчёте пропало у одного из двух путей (стена и вещь)",
  );
});

test("D67: вещь заводит лист так же, как стена, и метки переносит так же", () => {
  // Второй путь: человек начал не со стены, а с мебели. Лист заводит та же
  // функция, поэтому и пересчёт тот же — иначе два пути разошлись бы.
  const placed = threeMarks();
  const sheet = workshopEnsureSheet(placed.project, placed.schemeId);
  assert.equal(sheet.added, true);
  assert.equal(sheet.marks, 3);
  const mm = placed.ids.map((id) =>
    planFractionToMm(sheet.project, placed.schemeId, findMark(sheet.project, id).points[0]),
  );
  assert.equal(mm[1].x - mm[0].x, 600);
  assert.equal(mm[2].y - mm[1].y, 700);
});

test("D67: метки встают вокруг нуля чертежа, а не в пятнадцати метрах от него", () => {
  // Почему вокруг середины, а не от угла: середина листа — это начало
  // координат чертежа, то есть место, вокруг которого человек сейчас рисует.
  // От угла эти же метки оказались бы в (−15,5 м; −10,5 м) — формально «на
  // своём пикселе», а по делу в пустом поле.
  const placed = threeMarks();
  const sheet = workshopEnsureSheet(placed.project, placed.schemeId).project;
  for (const id of placed.ids) {
    const mm = planFractionToMm(sheet, placed.schemeId, findMark(sheet, id).points[0]);
    assert.ok(Math.abs(mm.x) < 1000 && Math.abs(mm.y) < 1000, "метка уехала от нуля чертежа: " + JSON.stringify(mm));
  }
});

test("пересчёт достаёт всё, что задано долями этого плана", () => {
  const added = addScheme(createProject(), { name: "квадрат", width: 1000, height: 1000 });
  const schemeId = added.scheme.id;
  const room = addRoom(added.project, "Зал");
  let project = addOutline(room.project, {
    schemeId,
    roomId: room.room.id,
    points: [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
    ],
  });
  const outlineId = project.outline.id;
  let next = project.project;
  const guideH = addSchemeGuide(next, schemeId, { axis: "h", at: 0.6 });
  next = guideH.project;
  const guideV = addSchemeGuide(next, schemeId, { axis: "v", at: 0.3 });
  next = guideV.project;
  next = setPlanScale(next, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  const perMeterBefore = planPixelsPerMeter(next, schemeId);
  next = setPlanOrigin(next, schemeId, { at: { x: 0.25, y: 0.75 }, turn: 90 }).project;

  const grown = resizeSchemePlan(next, schemeId, { width: 4000, height: 3000 });
  assert.equal(grown.changed, true);
  assert.equal(grown.outlines, 1);

  // Контур: отступ от середины в пикселях тот же — 100 и 100 было, 100 и 100 стало.
  const points = findOutline(grown.project, outlineId).points;
  assert.deepEqual(points[0], { x: 0.5 - 100 / 4000, y: 0.5 - 100 / 3000 });
  assert.deepEqual(points[2], { x: 0.5 + 100 / 4000, y: 0.5 + 100 / 3000 });
  // Направляющая: горизонтальная мерится высотой, вертикальная — шириной.
  const guides = schemeGuides(grown.project, schemeId);
  assert.equal(guides.find((guide) => guide.axis === "h").at, 0.5 + 100 / 3000);
  assert.equal(guides.find((guide) => guide.axis === "v").at, 0.5 - 200 / 4000);
  // Калибровка: пиксельная длина отрезка и метры те же — значит и px/м тот же.
  assert.equal(planPixelsPerMeter(grown.project, schemeId), perMeterBefore);
  const scale = planScaleOf(grown.project, schemeId);
  assert.equal(scale.meters, 6);
  // Привязка чертежа: тот же пересчёт и тот же поворот.
  assert.deepEqual(planOriginOf(grown.project, schemeId), {
    at: { x: 0.5 - 250 / 4000, y: 0.5 + 250 / 3000 },
    turn: 90,
  });
});

test("пиксельные величины не трогаются ни одна — ровно потому, что пиксель остался собой", () => {
  const placed = threeMarks();
  const moved = resizeSchemePlan(placed.project, placed.schemeId, { width: 4000, height: 3000 });
  for (const id of placed.ids) {
    const before = findMark(placed.project, id);
    const after = findMark(moved.project, id);
    assert.equal(after.labelOffset, before.labelOffset, "смещение подписи задано в пикселях плана и не пересчитывается");
  }
  assert.deepEqual(moved.project.view, placed.project.view, "размер знака и подписи — пиксельные, их не трогают");
});

test("G68: размер тот же — тот же объект по ссылке", () => {
  const added = addScheme(createProject(), { name: "лист", width: 4000, height: 3000 });
  const same = resizeSchemePlan(added.project, added.scheme.id, { width: 4000, height: 3000 });
  assert.equal(same.project, added.project, "новый объект на пустом месте — это лишний шаг истории и новый updatedAt");
  assert.equal(same.changed, false);
  assert.equal(same.marks, 0);
});

test("G68: объект прежней сборки с подложкой не меняется ни на долю", () => {
  const project = legacy();
  const schemeId = project.schemes[0].id;
  assert.ok(project.schemes[0].imageId, "фикстура обязана быть с подложкой — в ней весь смысл проверки");
  const marksBefore = JSON.stringify(project.marks);
  const outlinesBefore = JSON.stringify(project.outlines);
  const schemeBefore = JSON.stringify(project.schemes[0]);

  // Лист такой схеме не заводится вовсе: тот же объект по ссылке.
  const sheet = workshopEnsureSheet(project, schemeId);
  assert.equal(sheet.project, project);
  assert.equal(sheet.added, false);
  assert.equal(sheet.marks, 0);

  // И первая стена, нарисованная в чужом объекте, не двигает ни метку, ни
  // контур, ни размер плана, ни калибровку.
  const drawn = workshopAddChain(project, schemeId, ROOM, 100);
  assert.equal(drawn.added, 4, "стены не встали — проверять нечего");
  assert.equal(drawn.marks, 0, "в объекте с подложкой пересчитывать нечего");
  assert.equal(JSON.stringify(drawn.project.marks), marksBefore, "метки чужого объекта сдвинулись");
  assert.equal(JSON.stringify(drawn.project.outlines), outlinesBefore, "контуры чужого объекта сдвинулись");
  const schemeAfter = findScheme(drawn.project, schemeId);
  const { origin, ...rest } = schemeAfter;
  assert.equal(JSON.stringify(rest), schemeBefore, "схема чужого объекта изменилась не только привязкой");
  // Файл фикстуры не тронут — в тестах его читают ещё четверо.
  assert.equal(JSON.stringify(legacy()), JSON.stringify(JSON.parse(LEGACY_TEXT)));
});

// ——— D68: «+» и «−» в чертеже ——————————————————————————————————————————

test("D68: набор клавиш масштаба и шаг — один на план и на чертёж", () => {
  // Своего списка кодов у чертежа нет: разойдись они — «+» на цифровой
  // клавиатуре работал бы на одной поверхности и молчал на другой.
  assert.equal(canvasZoomKey({ code: "Equal", key: "=" }), canvasZoomKey({ code: "NumpadAdd", key: "+" }));
  assert.ok(canvasZoomKey({ code: "Equal", key: "=" }) > 1, "«+» не приближает");
  assert.ok(canvasZoomKey({ code: "Minus", key: "-" }) < 1, "«−» не отдаляет");
  assert.equal(
    canvasZoomKey({ code: "Equal", key: "=" }) * canvasZoomKey({ code: "Minus", key: "-" }),
    1,
    "«+» и «−» не возвращают масштаб на место",
  );
  assert.equal(canvasZoomKey({ code: "KeyA", key: "a" }), 0, "буква стала масштабом");

  // Клавиши масштаба чертёж берёт у общего хода полей (`planNav.js`, правка
  // после сборки сценариев) — тем же разбором, что `canvasZoomKey` плана.
  const workshop = read(join("panels", "workshop.js"));
  assert.ok(workshop.includes("nav.zoomKey(event)"), "чертёж снова не знает про клавиши масштаба");
  for (const own of ["NumpadAdd", "NumpadSubtract", "ZOOM_KEY_STEP"]) {
    assert.ok(!workshop.includes(own), "у чертежа завёлся свой список клавиш масштаба: " + own);
  }
  // Мёртвой константы не осталось: шаг живёт ровно в одном месте и работает.
  for (const name of ["canvas.js", join("panels", "workshop.js")]) {
    assert.ok(!/WORKSHOP_ZOOM_KEY_STEP/.test(read(name)), name + ": мёртвая константа вернулась");
  }
});

test("D68: масштаб чертежа идёт после отсечения полей, как ход", () => {
  const text = read(join("panels", "workshop.js"));
  const down = text.slice(text.indexOf("function onKeyDown"), text.indexOf("function panKeyDown"));
  const field = down.indexOf("uiFieldTarget(event.target)");
  const pan = down.indexOf("panKeyDown(event.code)");
  const zoom = down.indexOf("nav.zoomKey(event)");
  assert.ok(field > 0 && pan > field, "ход идёт раньше, чем отсечены поля");
  assert.ok(zoom > pan, "масштаб стоит раньше хода — порядок обеих поверхностей один");
  // Сама ветка, без строк пояснений: закомментированный зов — это тот же
  // мёртвый масштаб, с которого таск и начался.
  const branch = down
    .slice(zoom, down.indexOf("}", down.indexOf("return;", zoom)))
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  // Масштабирует сам общий ход (`zoomKey` приближает середину поля); ветке
  // остаётся снять клавишу у браузера.
  assert.match(down.slice(zoom), /^nav\.zoomKey\(event\)\) \{/, "клавиша масштаба ничего не делает — ровно дефект D68");
  assert.match(branch, /preventDefault\(\)/, "браузер уведёт «+» себе (масштаб страницы)");
});

test("D68: про стрелки и «+» написано в подсказке каждого занятия", () => {
  // Правило таска 213: горячий ключ, о котором негде прочитать, всё равно что
  // его нет. До этого таска подсказки чертежа не обещали «+» вовсе — то есть
  // не врали, но и не говорили; стрелки работали и тоже были не названы.
  for (const [tool, way] of [
    ["walls", null],
    ["openings", null],
    ["objects", "rect"],
    ["objects", "contour"],
    ["objects", "polyline"],
    ["edit", null],
  ]) {
    const line = workshopHint(tool, way);
    assert.match(line, /«\+» и «−» меняют масштаб/, tool + "/" + way + ": про «+» не сказано");
    assert.match(line, /Стрелки листают чертёж/, tool + "/" + way + ": про стрелки не сказано");
  }
  // Слова одни на все занятия и лежат одной строкой: шесть копий разошлись бы.
  assert.equal(
    (read("strings.js").match(/меняют масштаб/g) || []).length,
    3,
    "про «+» снова написано в каждой подсказке врозь (плану нужны две строки, чертежу одна)",
  );
  // Привычные слова занятий не переписаны (правило таска 182).
  assert.match(strings.workshop.hint, /перетаскивание с Shift — сдвиг/);
  assert.match(strings.workshop.hint, /вершина стены/);
});
