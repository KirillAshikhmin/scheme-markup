// Настоящий масштаб: калибровка по отрезку (T111, требование G158 — снимает
// отложенное в первый день G13 «масштаба и длин пока не надо»).
//
// Заказчик: «давай делаем настоящий масштаб», способ назвал сам — показать на
// плане две точки и сказать, сколько между ними метров. Ради чего это
// делается: длина ленты, трека и тёплого пола в метрах, та самая, которую
// спрашивает закупка.
//
// Проверяется здесь ровно то, где легко соврать молча:
//
// 1. масштаб принадлежит **схеме** — у этажей свои планы и свои калибровки;
// 2. **поворот и обрезка** его не портят: точки отрезка лежат долями (ADR 002)
//    и пересчитываются тем же преобразованием, что метки, — метры те же;
// 3. точка отрезка **за рамкой** обрезки калибровку снимает: прижатая к краю
//    точка укоротила бы отрезок, и все длины уехали бы незаметно;
// 4. **замена подложки** снимает: пиксели те же, метры другие, и сравнить
//    кадры нечем;
// 5. **короткий отрезок** не проходит молча;
// 6. схема **без калибровки** работает как раньше (G68) — ни колонки в
//    таблице, ни строки в свойствах, и ни одна метка не изменилась.
import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAN_SCALE_METERS_MAX,
  PLAN_SCALE_SHORT_SHARE,
  addMark,
  addScheme,
  clearPlanScale,
  createProject,
  findMark,
  findScheme,
  formatMeters,
  markLengthMeters,
  planHasScale,
  planLengthMeters,
  planPixelsPerMeter,
  planScaleOf,
  planScaleShort,
  planSizeMeters,
  replaceSchemeImage,
  setMarkNumber,
  setPlanScale,
  updateMark,
} from "../src/model.js";
import { applyPlanEdit, schemesScaleView } from "../src/panels/schemes.js";
import { marksLengthText, marksRowModel } from "../src/panels/marks.js";
import { markCardModel } from "../src/panels/markCard.js";
import { CANVAS_MODE_SCALE, canvasGrabKind, canvasHintText, canvasScaleMeters, canvasTapKind } from "../src/canvas.js";
import { marksTable, toCsv } from "../src/tables.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { strings } from "../src/strings.js";

const PLAN = { width: 1000, height: 500 };
// Отрезок калибровки — половина ширины плана: 500 px на 5 м, то есть 100 px/м.
const CALIBRATION = { a: { x: 0.25, y: 0.5 }, b: { x: 0.75, y: 0.5 }, meters: 5 };
const close = (value, expected, what) =>
  assert.ok(Math.abs(value - expected) < 1e-6, what + ": " + value + " вместо " + expected);

// Схема с планом, лентой из двух отрезков и одной точкой.
function scene() {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "скан", ...PLAN });
  project = scheme.project;
  const tapeType = project.markTypes.find((type) => type.code === "Л");
  const socketType = project.markTypes.find((type) => type.code === "Р");
  // Лента: 300 px по ширине и 100 px по высоте — ровно 3 м и 1 м при 100 px/м.
  const tape = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: tapeType.id,
    kind: "line",
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.4, y: 0.4 },
    ],
  });
  project = tape.project;
  const socket = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: socketType.id,
    kind: "point",
    points: [{ x: 0.6, y: 0.6 }],
  });
  return {
    project: socket.project,
    schemeId: scheme.scheme.id,
    tapeId: tape.mark.id,
    socketId: socket.mark.id,
    tapeTypeId: tapeType.id,
  };
}

const calibrated = (base, patch = {}) => setPlanScale(base.project, base.schemeId, { ...CALIBRATION, ...patch }).project;

test("калибровка живёт у схемы и в долях плана, а px/м считается из них", () => {
  const base = scene();
  const project = calibrated(base);
  const scale = planScaleOf(project, base.schemeId);
  assert.deepEqual(scale.a, CALIBRATION.a);
  assert.deepEqual(scale.b, CALIBRATION.b);
  assert.equal(scale.meters, 5);
  assert.ok(scale.setAt, "калибровка помнит, когда её задали");
  close(planPixelsPerMeter(project, base.schemeId), 100, "пикселей на метр");
  const size = planSizeMeters(project, base.schemeId);
  close(size.width, 10, "ширина плана в метрах");
  close(size.height, 5, "высота плана в метрах");
  // Объект чистый: прежний снимок не тронут, Ctrl+Z вернёт «масштаба нет».
  assert.equal(planScaleOf(base.project, base.schemeId), null);
  assert.equal(planHasScale(base.project, base.schemeId), false);
});

test("масштаб принадлежит схеме: у второго этажа свой план и своя калибровка", () => {
  const base = scene();
  const second = addScheme(calibrated(base), { name: "2 этаж", imageId: "фото", width: 2000, height: 1000 });
  const project = second.project;
  // Вторая схема откалибрована своим отрезком — вдвое длиннее в пикселях и
  // вдвое дороже в метрах.
  const both = setPlanScale(project, second.scheme.id, { a: { x: 0.25, y: 0.5 }, b: { x: 0.75, y: 0.5 }, meters: 20 }).project;
  close(planPixelsPerMeter(both, base.schemeId), 100, "px/м первого этажа");
  close(planPixelsPerMeter(both, second.scheme.id), 50, "px/м второго этажа");
  // Калибровка одной схемы не трогает другую.
  assert.deepEqual(planScaleOf(both, base.schemeId).b, CALIBRATION.b);
});

test("длина ломаной в метрах: прямая, ломаная и замкнутая", () => {
  const base = scene();
  const project = calibrated(base);
  // 300 px + 100 px при 100 px/м = 4 м.
  close(markLengthMeters(project, base.tapeId), 4, "длина ленты");
  // Замкнутая считается с последним отрезком: 300 + 100 + корень из 300²+100².
  const closed = updateMark(project, base.tapeId, { closed: true }).project;
  close(markLengthMeters(closed, base.tapeId), (300 + 100 + Math.hypot(300, 100)) / 100, "длина замкнутой ленты");
  // Диагональ считается по обеим осям, а не по одной: 300 px по ширине и
  // 100 px по высоте — это 3,16 м, а не 3 и не 4.
  const diagonal = planLengthMeters(project, base.schemeId, [
    { x: 0.1, y: 0.2 },
    { x: 0.4, y: 0.4 },
  ]);
  close(diagonal, Math.hypot(300, 100) / 100, "длина диагонали");
  // У точечной метки длины по плану нет: её «длина» — размер изделия в
  // миллиметрах, и путать их нельзя.
  assert.equal(markLengthMeters(project, base.socketId), null);
});

test("без калибровки длины просто нет — ни у метки, ни у ломаной", () => {
  const base = scene();
  assert.equal(markLengthMeters(base.project, base.tapeId), null);
  assert.equal(planLengthMeters(base.project, base.schemeId, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), null);
  assert.equal(marksLengthText(base.project, findMark(base.project, base.tapeId)), "");
});

test("поворот на 90° и обрезка переживаются: метры те же", () => {
  const base = scene();
  const project = calibrated(base);
  // Поворот: доли уезжают, размер плана меняется местами, а метры и длина
  // ленты остаются прежними — за это и плачено долями (ADR 002).
  const turned = applyPlanEdit(project, base.schemeId, {
    imageId: "повёрнутая",
    width: PLAN.height,
    height: PLAN.width,
    transform: { rotate: 90, crop: null },
  });
  assert.equal(turned.scaleLost, false);
  close(planPixelsPerMeter(turned.project, base.schemeId), 100, "px/м после поворота");
  close(markLengthMeters(turned.project, base.tapeId), 4, "длина ленты после поворота");
  close(planScaleOf(turned.project, base.schemeId).meters, 5, "метры отрезка после поворота");

  // Обрезка до левой половины: отрезок калибровки целиком в рамке — те же
  // пиксели, те же метры.
  const cropped = applyPlanEdit(project, base.schemeId, {
    imageId: "обрезанная",
    width: 800,
    height: PLAN.height,
    transform: { rotate: 0, crop: { x: 0.1, y: 0, width: 0.8, height: 1 } },
  });
  assert.equal(cropped.scaleLost, false);
  close(planPixelsPerMeter(cropped.project, base.schemeId), 100, "px/м после обрезки");
  close(markLengthMeters(cropped.project, base.tapeId), 4, "длина ленты после обрезки");
});

test("точка отрезка за рамкой обрезки — калибровка честно снимается", () => {
  const base = scene();
  const project = calibrated(base);
  // Рамка оставляет левую треть: точка `b` (0,75) окажется за ней, её прижало
  // бы к краю — отрезок стал бы короче, а масштаб соврал бы молча.
  const result = applyPlanEdit(project, base.schemeId, {
    imageId: "обрезанная",
    width: 300,
    height: PLAN.height,
    transform: { rotate: 0, crop: { x: 0, y: 0, width: 0.3, height: 1 } },
  });
  assert.equal(result.scaleLost, true);
  assert.equal(planScaleOf(result.project, base.schemeId), null);
  assert.equal(markLengthMeters(result.project, base.tapeId), null);
  // Поле убрано, а не обнулено: схема вернулась в прежнее состояние.
  assert.equal("scale" in findScheme(result.project, base.schemeId), false);
});

test("замена подложки снимает масштаб — и говорит об этом вызывающему", () => {
  const base = scene();
  const project = calibrated(base);
  const result = replaceSchemeImage(project, base.schemeId, { imageId: "другой скан", width: 2000, height: 1000 });
  assert.equal(result.scaleDropped, true);
  assert.equal(planScaleOf(result.project, base.schemeId), null);
  assert.equal("scale" in findScheme(result.project, base.schemeId), false);
  // Разметка при этом вся на месте: доли меток замена не двигает.
  assert.deepEqual(findMark(result.project, base.tapeId).points, findMark(project, base.tapeId).points);
  // На схеме без калибровки замена ничего не «снимает» и молчит.
  assert.equal(replaceSchemeImage(base.project, base.schemeId, { imageId: "ещё", width: 100, height: 50 }).scaleDropped, false);
});

test("короткий отрезок калибровки не проходит молча", () => {
  const base = scene();
  const diagonal = Math.hypot(PLAN.width, PLAN.height);
  const shortShare = PLAN_SCALE_SHORT_SHARE / 2;
  const longShare = PLAN_SCALE_SHORT_SHARE * 2;
  const along = (share) => ({
    a: { x: 0.5, y: 0.5 },
    b: { x: 0.5 + (diagonal * share) / PLAN.width, y: 0.5 },
  });
  assert.equal(planScaleShort(base.project, base.schemeId, along(shortShare)), true);
  assert.equal(planScaleShort(base.project, base.schemeId, along(longShare)), false);
  // Предупреждение — не отказ: по короткому отрезку калибровать можно, если
  // человек на это согласился.
  const project = setPlanScale(base.project, base.schemeId, { ...along(shortShare), meters: 0.5 }).project;
  assert.ok(planHasScale(project, base.schemeId));
});

test("калибровке нужны две разные точки и расстояние больше нуля", () => {
  const base = scene();
  const at = (patch) => () => setPlanScale(base.project, base.schemeId, { ...CALIBRATION, ...patch });
  assert.throws(at({ meters: 0 }), { code: "scaleMetersInvalid" });
  assert.throws(at({ meters: -3 }), { code: "scaleMetersInvalid" });
  assert.throws(at({ meters: "четыре" }), { code: "scaleMetersInvalid" });
  assert.throws(at({ meters: PLAN_SCALE_METERS_MAX + 1 }), { code: "scaleMetersTooBig" });
  assert.throws(at({ b: null }), { code: "scalePointsInvalid" });
  assert.throws(at({ b: { x: 0.25, y: 0.5 } }), { code: "scaleSegmentEmpty" });
  assert.throws(() => setPlanScale(base.project, "нет такой", CALIBRATION), { code: "schemeNotFound" });
});

test("масштаб снимается руками — и поле уходит целиком", () => {
  const base = scene();
  const project = calibrated(base);
  const cleared = clearPlanScale(project, base.schemeId);
  assert.equal(cleared.cleared, true);
  assert.equal(planScaleOf(cleared.project, base.schemeId), null);
  assert.deepEqual(findScheme(cleared.project, base.schemeId), findScheme(base.project, base.schemeId));
  // Снимать нечего — и объект не меняется: пустой шаг отмены не нужен.
  const again = clearPlanScale(cleared.project, base.schemeId);
  assert.equal(again.cleared, false);
  assert.equal(again.project, cleared.project);
});

test("испорченная калибровка читается как «масштаба нет», а не как длина из мусора", () => {
  const base = scene();
  const broken = (scale) => ({
    ...base.project,
    schemes: base.project.schemes.map((scheme) => ({ ...scheme, scale })),
  });
  assert.equal(planScaleOf(broken({ a: CALIBRATION.a, b: CALIBRATION.b, meters: 0 }), base.schemeId), null);
  assert.equal(planScaleOf(broken({ a: CALIBRATION.a, meters: 5 }), base.schemeId), null);
  assert.equal(planScaleOf(broken({ a: CALIBRATION.a, b: CALIBRATION.a, meters: 5 }), base.schemeId), null);
  assert.equal(planScaleOf(broken("да"), base.schemeId), null);
  assert.equal(markLengthMeters(broken({ meters: "много" }), base.tapeId), null);
});

test("метры показываются с запятой и без лишней точности", () => {
  assert.equal(formatMeters(12), "12");
  assert.equal(formatMeters(12.4), "12,4");
  assert.equal(formatMeters(12.456), "12,46");
  assert.equal(formatMeters(0.5), "0,5");
  assert.equal(formatMeters("нет"), "");
});

test("расстояние, набранное руками: запятая и точка равноправны, мусор не проходит", () => {
  assert.equal(canvasScaleMeters("4,2"), 4.2);
  assert.equal(canvasScaleMeters("4.2"), 4.2);
  assert.equal(canvasScaleMeters(" 4,2 "), 4.2);
  assert.equal(canvasScaleMeters(",5"), 0.5);
  assert.equal(canvasScaleMeters("0"), null);
  assert.equal(canvasScaleMeters("-4"), null);
  assert.equal(canvasScaleMeters("4,2 м"), null);
  assert.equal(canvasScaleMeters("четыре"), null);
  assert.equal(canvasScaleMeters(""), null);
  assert.equal(canvasScaleMeters(null), null);
  assert.equal(canvasScaleMeters(String(PLAN_SCALE_METERS_MAX + 1)), null);
});

test("в калибровке рука показывает точки отрезка, а не берёт метки", () => {
  const base = scene();
  const state = {
    project: calibrated(base),
    schemeId: base.schemeId,
    layout: "desktop",
    mode: CANVAS_MODE_SCALE,
    selectedMarkIds: [base.tapeId],
    activeTypeId: base.tapeTypeId,
  };
  // Тап — точка отрезка, и раньше любой ручки: ручка поворота подписи под
  // пальцем не должна отбирать клик у масштаба.
  assert.equal(canvasTapKind(state, { labelTurn: true, markId: base.tapeId }), "scalePoint");
  // Долгое нажатие не берёт ничего: рука занята отрезком.
  assert.equal(canvasGrabKind(state, { markId: base.tapeId }), null);
  // Подсказка над планом рассказывает про калибровку, а не про метки.
  assert.equal(canvasHintText(state), strings.scale.hint);
  // Режим просмотра калибровать не даёт — там правок нет вовсе.
  assert.equal(canvasTapKind({ ...state, layout: "mobile" }, {}), "select");
});

test("длина видна в свойствах метки и в её карточке", () => {
  const base = scene();
  const project = calibrated(base);
  const row = (source, markId) => {
    const mark = findMark(source, markId);
    return marksRowModel(
      source,
      { mark, type: source.markTypes.find((type) => type.id === mark.typeId), style: { shape: "circle", color: "#000" }, label: "Л1" },
      { open: true },
    );
  };
  assert.equal(row(project, base.tapeId).fields.lengthText, "4 м");
  // У точки длины по плану нет — строки в свойствах не будет.
  assert.equal(row(project, base.socketId).fields.lengthText, "");
  // Карточка метки берёт поля у той же `marksRowModel`: второй правды о метке
  // в сборке быть не должно.
  const card = markCardModel(project, base.tapeId);
  assert.ok(
    card.rows.some((item) => item.label === strings.scale.lengthLabel && item.value === "4 м"),
    "в карточке нет длины: " + JSON.stringify(card.rows),
  );
  // Без калибровки карточка ровно такая, какой была до этой задачи.
  assert.equal(
    markCardModel(base.project, base.tapeId).rows.some((item) => item.label === strings.scale.lengthLabel),
    false,
  );
});

test("кнопка масштаба в панели схем говорит размер плана в метрах", () => {
  const base = scene();
  const empty = schemesScaleView(base.project, base.schemeId, "1 этаж");
  assert.equal(empty.set, false);
  assert.equal(empty.label, strings.scale.notSet);
  const view = schemesScaleView(calibrated(base), base.schemeId, "1 этаж");
  assert.equal(view.set, true);
  // Размер всего плана — то, что инженер сверяет с чертежом глазом.
  assert.ok(view.label.includes("10") && view.label.includes("5"), "кнопка без размера плана: " + view.label);
  assert.ok(view.title.includes("1 этаж"), "подсказка без имени схемы: " + view.title);
});

test("колонка «Длина, м» появляется только там, где есть что в неё писать", () => {
  const base = scene();
  // Без калибровки лист прежний: шесть колонок, ни одной про длину.
  const before = marksTable(base.project, null, "category");
  assert.deepEqual(before.columns, [
    strings.tables.label,
    strings.tables.points,
    strings.tables.type,
    strings.tables.room,
    strings.tables.location,
    strings.tables.comment,
  ]);

  const table = marksTable(calibrated(base), null, "category");
  assert.deepEqual(table.columns, [
    strings.tables.label,
    strings.tables.points,
    strings.tables.length,
    strings.tables.type,
    strings.tables.room,
    strings.tables.location,
    strings.tables.comment,
  ]);
  const rows = table.groups.flatMap((group) => group.rows);
  const tape = rows.find((row) => row.cells[0] === "Л1");
  const socket = rows.find((row) => row.cells[0] === "Р1");
  assert.equal(tape.cells[2], "4");
  // У точечной позиции ячейка пустая, а не «0»: длины у неё не бывает.
  assert.equal(socket.cells[2], "");
  // CSV несёт ту же шапку и те же ячейки — лист один на все выгрузки.
  const csv = toCsv(table);
  assert.ok(csv.includes(strings.tables.length), "в CSV нет колонки длины");
});

test("сведённые метки одного обозначения складываются: закупке нужна сумма", () => {
  const base = scene();
  const project = calibrated(base);
  // Второй кусок той же ленты с тем же номером — 200 px, то есть 2 м.
  const second = addMark(project, {
    schemeId: base.schemeId,
    typeId: base.tapeTypeId,
    kind: "line",
    points: [
      { x: 0.6, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ],
  });
  // Повтор номера — приём заказчика, и ставится он той же командой модели.
  const merged = setMarkNumber(second.project, second.mark.id, findMark(project, base.tapeId).number).project;
  const table = marksTable(merged, null, "category");
  const row = table.groups.flatMap((group) => group.rows).find((item) => item.cells[0] === "Л1");
  assert.equal(row.cells[2], "6");
});

// G68: главное правило сборки. У схем прежней разметки поля `scale` нет вовсе.
test("размеченный объект прежнего формата открывается без изменений", async () => {
  const base = scene();
  const legacy = {
    ...base.project,
    schemes: base.project.schemes.map(({ scale, ...rest }) => rest),
  };
  assert.equal("scale" in legacy.schemes[0], false, "пример не тот: поля и не должно быть");
  // Ни одной догадки: масштаба нет, длин нет, лист прежний.
  assert.equal(planScaleOf(legacy, base.schemeId), null);
  assert.equal(markLengthMeters(legacy, base.tapeId), null);
  assert.equal(marksTable(legacy, null, "category").columns.includes(strings.tables.length), false);
  // И через файл проекта: метки, номера и подписи те же до последней доли.
  const restored = await unpackProject(await packProject(legacy, new Map()));
  assert.deepEqual(restored.project.marks, legacy.marks);
  assert.deepEqual(restored.project.schemes, legacy.schemes);
});

test("калибровка уезжает в файл проекта и возвращается оттуда", async () => {
  const base = scene();
  const project = calibrated(base);
  const restored = await unpackProject(await packProject(project, new Map()));
  assert.deepEqual(planScaleOf(restored.project, base.schemeId), planScaleOf(project, base.schemeId));
  close(markLengthMeters(restored.project, base.tapeId), 4, "длина ленты после файла");
});
