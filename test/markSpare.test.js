// Запасной габарит: одна новость на все поверхности (G230, таск 157).
//
// Слова заказчика: «да, и на развёртке тоже пиши про додуманную сторону».
//
// Объём говорил о догадке строкой под полем, а развёртка молчала — хотя считает
// тот же габарит тем же `markBoxMm`. Поэтому здесь проверяется не текст как
// таковой, а три обещания:
//
//   1. **текст один** — развёртка и объём на одной и той же вещи выдают
//      посимвольно одну строку, а не две похожих;
//   2. **счёт один** — список вещей с додуманной стороной берётся у общего
//      правила габарита, второго счёта нет;
//   3. **говорить не о чем — молчат все**: ни пустой строки, ни пустой плашки.
//
// И отдельно — лист выгрузки: на нём стоит голова строки, потому что по листу
// размечают стену, а хвост с объяснением остаётся экрану.
import test from "node:test";
import assert from "node:assert/strict";

import { MARK_BOX_FRAME_MM } from "../src/markBox.js";
import { MARK_LIST_SHOWN, markSpareLine, markSpareTitle } from "../src/markSpare.js";
import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  setTypeSizes,
  wallElevation,
} from "../src/model.js";
import { drawElevation } from "../src/render.js";
import { elevationNote } from "../src/panels/elevation.js";
import { volumeScene } from "../src/volume.js";
import { strings } from "../src/strings.js";

// ——— сама строка ——————————————————————————————————————————————————————————

test("строка называет вещи, обрывает длинный список и держит полный в подсказке", () => {
  assert.equal(markSpareLine([]), "", "говорить не о чем — строки нет вовсе");
  assert.equal(markSpareLine(null, { why: true }), "");
  const one = markSpareLine([{ markId: "1", label: "МВ1" }], { why: true });
  assert.ok(one.includes("МВ1"), one);
  // Числа общей рамки приходят из правила габарита, а не переписаны в словарь
  // второй раз.
  assert.ok(one.includes(String(MARK_BOX_FRAME_MM)), one);
  const many = [];
  for (let index = 0; index < MARK_LIST_SHOWN + 3; index += 1) {
    many.push({ markId: String(index), label: "Т" + index });
  }
  const line = markSpareLine(many, { why: true });
  assert.ok(line.includes("Т0") && !line.includes("Т10"), line);
  assert.ok(markSpareTitle(many).includes("Т10"), "все обозначения остаются в подсказке");
  assert.equal(markSpareTitle([{ markId: "1", label: "Т1" }]), "");
});

test("хвост с объяснением просит тот, у кого есть место под абзац", () => {
  const list = [{ markId: "1", label: "МВ1" }];
  const head = markSpareLine(list);
  const full = markSpareLine(list, { why: true });
  assert.ok(full.startsWith(head), "голова у обоих одна, а не переписана заново");
  assert.ok(full.length > head.length, "хвост с объяснением есть");
  assert.ok(!head.includes("Задайте размеры"), head);
  // Выступ в строке не назван нарочно: на листе развёртки его нет вовсе, и
  // обещать там третье измерение нельзя.
  assert.ok(!full.includes("× 80 × 10"), full);
});

// ——— одна вещь на двух поверхностях ———————————————————————————————————————

const fraction = (project, schemeId, mm) => planMmToFraction(project, schemeId, mm);

/**
 * Комната 4 × 3 м и в ней одна вещь, у типа которой **названа одна сторона**:
 * кондиционер со стёртой шириной. Длина своя (900), вторая сторона приходит из
 * габарита изображения (300) — ровно тот случай, о котором говорят обе
 * поверхности.
 */
function scene({ spare = true } = {}) {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  const schemeId = added.scheme.id;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  const corners = [
    { x: -2000, y: -1500 },
    { x: 2000, y: -1500 },
    { x: 2000, y: 1500 },
    { x: -2000, y: 1500 },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const wall = addWall(project, {
      schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    project = wall.project;
    walls.push(wall.wall.id);
  }
  const room = addRoom(project, "Кухня");
  project = room.project;
  project = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: [
      { x: -1900, y: -1400 },
      { x: 1900, y: -1400 },
      { x: 1900, y: 1400 },
      { x: -1900, y: 1400 },
    ].map((point) => fraction(project, schemeId, point)),
  }).project;
  const type = project.markTypes.find((item) => item.code === "К");
  if (spare) project = setTypeSizes(project, type.id, { width: null }).project;
  const put = addMark(project, {
    schemeId,
    typeId: type.id,
    kind: "point",
    points: [fraction(project, schemeId, { x: -500, y: -1100 })],
  });
  project = applyMarkWalls(put.project, schemeId).project;
  return { project, schemeId, wallId: walls[0], markId: put.marks[0].id };
}

// Холст-самописец: записывает всё, что ему сказали нарисовать.
function recorder() {
  const said = [];
  const ctx = new Proxy(
    {
      measureText: (value) => ({ width: String(value).length * 6 }),
      fillText: (value) => said.push(String(value)),
    },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => ((target[key] = value), true),
    },
  );
  return { ctx, said };
}

function drawn(built, options = {}) {
  const { ctx } = recorder();
  return drawElevation(ctx, built, { x: 0, y: 0, width: 900, height: 300 }, { views: true, ...options });
}

test("развёртка и объём говорят о додуманной стороне одной и той же строкой", () => {
  const built = scene();
  const view = wallElevation(built.project, built.wallId, "right");
  const sheet = drawn(view);
  const volume = volumeScene(built.project, built.schemeId, {});
  // Счёт один: обе поверхности назвали ту же самую метку.
  assert.deepEqual(
    sheet.spare.map((item) => item.markId),
    [built.markId],
  );
  assert.deepEqual(
    volume.spare.map((item) => item.markId),
    [built.markId],
  );
  const onElevation = markSpareLine(sheet.spare, { why: true });
  const inVolume = markSpareLine(volume.spare, { why: true });
  assert.ok(onElevation.length > 0);
  assert.equal(onElevation, inVolume, "две похожих строки — это и есть то, чего просили не писать");
  // И подпись под полосой говорит именно её, а не свою.
  assert.ok(elevationNote(view, sheet).includes(onElevation), elevationNote(view, sheet));
});

test("говорить не о чем — ни строки, ни плашки", () => {
  const built = scene({ spare: false });
  const view = wallElevation(built.project, built.wallId, "right");
  const sheet = drawn(view);
  const volume = volumeScene(built.project, built.schemeId, {});
  assert.deepEqual(sheet.spare, [], "у вещи названы обе стороны — догадки нет");
  assert.deepEqual(volume.spare, []);
  assert.equal(markSpareLine(sheet.spare, { why: true }), "");
  assert.ok(!elevationNote(view, sheet).includes("запасным габаритом"), elevationNote(view, sheet));
});

test("знаки вместо изображений — развёртка о габаритах не говорит вовсе", () => {
  const built = scene();
  const view = wallElevation(built.project, built.wallId, "right");
  // Отметка «изображения» снята: на чертеже условные знаки постоянного
  // размера, они размера вещи не обещают — и предупреждать не о чем.
  const sheet = drawn(view, { views: false });
  assert.deepEqual(sheet.spare, []);
  assert.ok(!elevationNote(view, sheet).includes("запасным габаритом"));
});

// ——— лист выгрузки ———————————————————————————————————————————————————————

test("на листе развёртки стоит голова строки, а хвост остаётся экрану", () => {
  const built = scene();
  const view = wallElevation(built.project, built.wallId, "right");
  const { ctx, said } = recorder();
  const label = "1. Стена АБ · 4000 мм";
  drawElevation(ctx, view, { x: 0, y: 0, width: 900, height: 300 }, { views: true, label });
  const caption = said.find((line) => line.includes("запасным габаритом"));
  assert.ok(caption, "лист молчит о догадке: " + said.join(" | "));
  assert.ok(caption.includes("К1"), caption);
  assert.ok(!caption.includes("Задайте размеры"), "абзац по ширине листа не ляжет: " + caption);
  // Подпись стены осталась своей строкой, а не слилась с предупреждением.
  assert.ok(
    said.some((line) => line.startsWith(label)),
    said.join(" | "),
  );
});

test("на листе без догадок предупреждения нет", () => {
  const built = scene({ spare: false });
  const view = wallElevation(built.project, built.wallId, "right");
  const { ctx, said } = recorder();
  drawElevation(ctx, view, { x: 0, y: 0, width: 900, height: 300 }, { views: true, label: "1. Стена АБ" });
  assert.ok(!said.some((line) => line.includes("запасным габаритом")), said.join(" | "));
});

test("строка о запасном габарите живёт в словаре одним местом", () => {
  assert.equal(typeof strings.spare.line, "string");
  assert.equal(typeof strings.spare.why, "string");
  assert.equal(strings.volume.spare, undefined, "у объёма своей копии больше нет");
  assert.equal(strings.elevation.spare, undefined, "и у развёртки своей не завелось");
});
