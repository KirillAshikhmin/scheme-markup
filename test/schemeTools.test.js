// Шов инструментов агента (`tools/scheme.mjs`): что инструмент отдаёт о
// собранном руками объекте.
//
// Проверяется чистая половина — та, которой браузер не нужен: открытие файла,
// сведения, метки с честными подписями размеров, помещения с площадью и
// периметром, чертёж, развёртки словами, сводки и печать таблиц. Картинки
// (PNG, лист ГОСТ, развёртки листами, кадр объёма) рисует холст, и их
// проверяет живой прогон, а не этот файл.
//
// Главное, что здесь держится: **инструмент не заводит второго счёта**. Итог
// по типам сверяется с итогом таблицы страницы, длина — с `markLengthMeters`,
// CSV — с `tables.toCsv` (BOM и точка с запятой), а площадь помещения, которой
// у страницы нет вовсе, считается на прямоугольнике с заранее известным
// ответом: 4 × 4 м — это 16 м² и 16 м периметра.
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  createProject,
  markLengthMeters,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  updateMark,
} from "../src/model.js";
import { marksTable } from "../src/tables.js";
import { packProject } from "../src/projectFile.js";
import {
  commandTables,
  objectDrawing,
  objectInfo,
  objectMarks,
  objectRooms,
  objectSummary,
  objectTypes,
  objectWalls,
  openObject,
  outlineAreaM2,
  outlinePerimeterM,
  pickRooms,
  pickSchemes,
  printTables,
  tableRecords,
} from "../tools/schemeData.mjs";
import { jobOf } from "../tools/schemeSheets.mjs";
import { parseArgs } from "../tools/scheme.mjs";

/**
 * Квартира на одну комнату с известными числами.
 *
 * План 1000 × 800, калибровка «0,1 доли ширины — это метр», то есть сто
 * пикселей плана на метр. Контур комнаты занимает 0,4 ширины и 0,5 высоты —
 * ровно 4 × 4 метра.
 */
function fixture() {
  let project = createProject({ name: "Объект для прогона" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 0.1, y: 0 }, meters: 1 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;

  const room = addRoom(project, "Комната");
  project = room.project;
  const roomId = room.room.id;
  project = addOutline(project, {
    schemeId,
    roomId,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.6 },
      { x: 0.1, y: 0.6 },
    ],
  }).project;

  const wall = addWall(project, {
    schemeId,
    aMm: { x: 1000, y: 1000 },
    bMm: { x: 5000, y: 1000 },
    thicknessMm: 100,
  });
  project = wall.project;
  const wallId = wall.wall.id;
  project = addOpening(project, {
    wallId,
    kind: "window",
    atMm: 1000,
    widthMm: 1400,
    heightMm: 1500,
    heightAboveFloorMm: 800,
  }).project;

  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const spot = addMark(project, {
    schemeId,
    typeId: typeOf("Т"),
    kind: "point",
    points: [{ x: 0.2, y: 0.2 }],
  });
  project = spot.project;
  project = updateMark(project, spot.mark.id, { roomId, location: "над столом" }).project;
  project = setMarkDimensions(project, spot.mark.id, {
    length: 120,
    depth: 60,
    width: 90,
    heightAboveFloor: 2500,
  }).project;

  // Линейная метка в два метра: 0,2 доли ширины — это двести пикселей плана.
  const tape = addMark(project, {
    schemeId,
    typeId: typeOf("Л"),
    kind: "line",
    points: [
      { x: 0.1, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
  });
  project = tape.project;
  project = updateMark(project, tape.mark.id, { roomId }).project;

  return { project, schemeId, roomId, wallId, spotId: spot.mark.id, tapeId: tape.mark.id };
}

test("файл объекта читается без браузера: что упаковано, то и прочитано", async () => {
  const { project } = fixture();
  const blob = await packProject(project, new Map());
  const dir = mkdtempSync(join(tmpdir(), "scheme-tools-test-"));
  const file = join(dir, "объект.zip");
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

  const before = readFileSync(file);
  const opened = await openObject(file);
  assert.equal(opened.project.name, "Объект для прогона");
  assert.equal(opened.project.marks.length, 2);
  // G68: чтение не трогает файл ни на байт.
  assert.deepEqual(readFileSync(file), before);

  const info = objectInfo(opened.project, { images: opened.images, file: "объект.zip" });
  assert.equal(info.counts.schemes, 1);
  assert.equal(info.counts.marks, 2);
  assert.equal(info.schemes[0].planPx.width, 1000);
  // Сто пикселей на метр: план в десять метров шириной и восемь высотой.
  assert.equal(info.schemes[0].pixelsPerMeter, 100);
  assert.deepEqual(info.schemes[0].planM, { width: 10, height: 8 });
  assert.equal(info.schemes[0].wallHeightMm, 2700);
  assert.equal(info.schemes[0].wallHeightKnown, true);
});

test("площадь и периметр помещения: 4 × 4 метра — это 16 м² и 16 м", () => {
  const { project } = fixture();
  const outline = project.outlines[0];
  assert.equal(outlineAreaM2(project, outline), 16);
  assert.equal(outlinePerimeterM(project, outline), 16);

  const rooms = objectRooms(project);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].areaM2, 16);
  assert.equal(rooms[0].perimeterM, 16);
  assert.equal(rooms[0].marks, 2);
  assert.equal(rooms[0].wallHeightMm, 2700);
});

test("без калибровки площади и длины наружу не выходят", () => {
  let project = createProject({ name: "Без масштаба" });
  const scheme = addScheme(project, { name: "План", width: 1000, height: 800 });
  project = scheme.project;
  const room = addRoom(project, "Комната");
  project = room.project;
  project = addOutline(project, {
    schemeId: scheme.scheme.id,
    roomId: room.room.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.6 },
    ],
  }).project;
  const rooms = objectRooms(project);
  assert.equal(rooms[0].areaM2, null);
  assert.equal(rooms[0].perimeterM, null);
});

test("метка отдаётся с честными подписями размеров", () => {
  const { project, spotId } = fixture();
  const marks = objectMarks(project);
  const spot = marks.find((mark) => mark.id === spotId);
  assert.equal(spot.typeCode, "Т");
  assert.equal(spot.room, "Комната");
  assert.equal(spot.location, "над столом");
  // Ключи файла — как в файле, и ни одного переименования.
  assert.deepEqual(spot.sizesMm, { length: 120, depth: 60, width: 90, heightAboveFloor: 2500 });
  // Подписи — как на странице: у вещи на стене `width` это «Высота»,
  // а `depth` — «Ширина» (таск 158).
  assert.equal(spot.sizesLabelled["Высота, мм"], 90);
  assert.equal(spot.sizesLabelled["Ширина, мм"], 60);
  assert.equal(spot.sizesLabelled["Длина, мм"], 120);
  assert.equal(spot.sizesLabelled["Высота над полом, мм"], 2500);
  assert.equal(spot.sizesFrom.length, "own");
});

test("длина линейной метки — та же, что у модели", () => {
  const { project, tapeId } = fixture();
  const tape = objectMarks(project).find((mark) => mark.id === tapeId);
  assert.equal(tape.kind, "line");
  assert.equal(tape.lengthM, 2);
  // То же число, что у модели: инструмент только округляет его до двух знаков —
  // дальше третьего у калибровки руками точности нет.
  assert.equal(tape.lengthM, Math.round(markLengthMeters(project, tapeId) * 100) / 100);
});

test("чертёж и развёртка словами: стена, проём и то, что на стене стоит", () => {
  const { project, schemeId } = fixture();
  const drawing = objectDrawing(project, { schemeId });
  assert.equal(drawing.walls.length, 1);
  assert.equal(drawing.walls[0].lengthMm, 4000);
  assert.equal(drawing.walls[0].thicknessMm, 100);
  assert.equal(drawing.openings.length, 1);
  assert.equal(drawing.openings[0].widthMm, 1400);
  assert.equal(drawing.openings[0].heightAboveFloorMm, 800);

  const walls = objectWalls(project, { schemeId });
  const sides = [...walls.rooms.flatMap((room) => room.sides), ...walls.loose];
  assert.ok(sides.length > 0);
  const withWindow = sides.find((side) => side.openings.length > 0);
  assert.equal(withWindow.lengthMm, 4000);
  assert.equal(withWindow.heightShownMm, 2700);
  assert.equal(withWindow.heightKnown, true);
  assert.equal(withWindow.openings[0].topMm, 2300);
});

test("сводка не заводит второго счёта: итог по типам — итог таблицы страницы", () => {
  const { project } = fixture();
  const summary = objectSummary(project);
  const table = marksTable(project, null, "category");
  assert.equal(summary.marks, table.totalCount);
  assert.equal(
    summary.byType.reduce((sum, row) => sum + row.marks, 0),
    table.totalCount,
  );
  assert.equal(summary.byRoom[0].areaM2, 16);
  assert.equal(summary.byFloor[0].scheme, "1 этаж");
  // Линейные метки свёрнуты по типу и считаны в метрах.
  assert.deepEqual(
    summary.lengths.map((row) => [row.code, row.marks, row.totalM]),
    [["Л", 1, 2]],
  );
});

test("справочник типов: порядок страницы и число меток у типа", () => {
  const { project } = fixture();
  const types = objectTypes(project);
  assert.ok(types.length > 0);
  assert.equal(types[0].category, "Свет");
  assert.equal(types.find((type) => type.code === "Т").marks, 1);
  assert.equal(types.find((type) => type.code === "Л").kind, "line");
});

test("таблицы печатает `tables.js`, а не инструмент", () => {
  const { project } = fixture();
  const rooms = objectRooms(project);
  const csv = printTables(commandTables("rooms", rooms, project), "csv");
  // Признаки CSV страницы: BOM в начале и точка с запятой разделителем.
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes("Помещение;Площадь, м²"));
  // Метры пишутся запятой — тем же `formatMeters`, что на странице.
  assert.ok(csv.includes("Комната;16;16;2700"));

  const md = printTables(commandTables("summary", objectSummary(project), project), "md");
  assert.ok(md.includes("# По помещениям"));
  assert.ok(md.includes("# Линейные метки"));
  assert.ok(md.includes("| Комната | 16 | 16 | 2700 | 2 |"));
});

test("JSON связей и оборудования собирается из колонок таблицы страницы", () => {
  const { project } = fixture();
  const [table] = commandTables("links", null, project, {});
  const records = tableRecords(table);
  for (const record of records) {
    for (const column of table.columns) assert.ok(column in record);
  }
});

test("выбор схемы и помещения: по номеру, по части имени и `all`", () => {
  const { project, roomId } = fixture();
  assert.equal(pickSchemes(project, "1").length, 1);
  assert.equal(pickSchemes(project, "all").length, 1);
  assert.equal(pickSchemes(project, "этаж")[0].name, "1 этаж");
  assert.equal(pickSchemes(project)[0].name, "1 этаж");
  assert.throws(() => pickSchemes(project, "второй этаж"), /схема не найдена/);
  assert.equal(pickRooms(project, "комн")[0].id, roomId);
  assert.throws(() => pickRooms(project, "кухня"), /помещение не найдено/);
});

test("ключи командной строки разбираются тремя видами записи", () => {
  const parsed = parseArgs(["marks", "объект.zip", "--format", "csv", "--scheme=2", "--mono"]);
  assert.equal(parsed.command, "marks");
  assert.equal(parsed.file, "объект.zip");
  assert.equal(parsed.keys.get("format"), "csv");
  assert.equal(parsed.keys.get("scheme"), "2");
  assert.equal(parsed.keys.get("mono"), true);
});

test("задание для страницы-оснастки: камера считается моделью, а не на глаз", () => {
  const { project, schemeId } = fixture();
  const keys = new Map([["size", "800x600"], ["time", "09:30"]]);
  const job = jobOf("volume-png", project, keys);
  assert.equal(job.kind, "volume");
  assert.deepEqual(job.schemeIds, [schemeId]);
  assert.deepEqual(job.size, { width: 800, height: 600 });
  assert.equal(job.minutes, 9 * 60 + 30);
  // Камера смотрит вверх по листу и сверху вниз — значит стоит ниже и южнее
  // середины чертежа, а высота у неё больше человеческого роста.
  assert.ok(job.camera.at.y > 1000);
  assert.ok(job.camera.at.z > 1600);
  assert.ok(job.camera.pitch < 0);

  const placed = jobOf("volume-png", project, new Map([["camera", "100,200,300,45,-20"]]));
  assert.deepEqual(placed.camera.at, { x: 100, y: 200, z: 300 });
  assert.ok(Math.abs(placed.camera.yaw - Math.PI / 4) < 1e-12);

  assert.throws(() => jobOf("volume-png", project, new Map([["time", "полдень"]])), /час пишется/);
  assert.throws(() => jobOf("volume-png", project, new Map([["size", "большой"]])), /размер пишется/);
  assert.throws(() => jobOf("нет-такой", project, new Map()), /мост не знает команды/);
});

test("лист просит у моста свой формат и множитель", () => {
  const { project } = fixture();
  const job = jobOf("gost-png", project, new Map([["sheet", "A3"], ["scale", "4"], ["mono", true]]));
  assert.equal(job.kind, "gost");
  assert.equal(job.format, "A3");
  assert.equal(job.scale, 4);
  assert.equal(job.mono, true);
  assert.equal(job.plan, true);
  const bare = jobOf("plan-png", project, new Map([["no-plan", true], ["no-legend", true]]));
  assert.equal(bare.plan, false);
  assert.equal(bare.legend, false);
  assert.equal(bare.scale, 2);
});

// ——— границы оснастки ——————————————————————————————————————————————————

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) jsFiles(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

test("страница не знает про инструменты: `src` ничего из `tools` не ввозит", () => {
  for (const path of jsFiles(join(ROOT, "src"))) {
    const source = readFileSync(path, "utf8");
    const found = source.match(/from\s+["'][^"']*tools\/[^"']*["']/g);
    assert.equal(found, null, path + " ввозит что-то из tools/");
  }
});

test("у страницы-оснастки есть охрана по адресу, и она стоит до первого запроса", () => {
  const page = readFileSync(join(ROOT, "tools", "schemeSheets.html"), "utf8");
  // Два условия сразу: свой хост и тот самый адрес, которым страницу подняли.
  assert.ok(page.includes('location.hostname === "127.0.0.1"'));
  assert.ok(page.includes("home === location.origin"));
  // Охрана обязана стоять **до** первого обращения к серверу: иначе чужая
  // вкладка успеет сходить за объектом прежде, чем её остановят.
  const guard = page.indexOf("const guarded =");
  const stop = page.indexOf("throw new Error(\"оснастка инструмента");
  const firstFetch = page.indexOf("fetch(");
  assert.ok(guard > 0 && stop > guard, "охраны нет или она не роняет страницу");
  assert.ok(stop < firstFetch, "первый запрос к серверу стоит раньше охраны");
});
