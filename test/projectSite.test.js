// Свойства объекта: адрес, координаты и направление верха чертежа (таск 188,
// требования G283 и G284).
//
// Здесь держатся четыре обещания, и три из них не про «функция вернула число»:
//
//   1. **Координаты принимаются в том виде, в каком их даёт карта.** «55.7558,
//      37.6173» — главный случай, и он обязан проходить без правки руками.
//      Мусор при этом не угадывается: молча подставленная точка увела бы солнце
//      в другую страну, и человек об этом не узнал бы.
//   2. **Направление ничего не рисует.** Решение заказчика: «направление живёт
//      в свойствах объекта и влияет по сути только на 3д сцену». Проверяется не
//      обещанием, а журналом вызовов холста: план, чертёж, развёртка, штамп и
//      CSV при повороте поля обязаны совпасть вызов в вызов. Сверху — сверка по
//      исходникам: ключ никому, кроме модели, окна свойств и объёма, не виден,
//      и случайно прочитать его выгрузке просто негде.
//   3. **Пустые поля в файл не пишутся** (G68, образец — этаж схемы): объект,
//      которому ничего не задавали, упаковывается байт в байт прежним файлом.
//   4. **Данные штампа живут у объекта, а выгрузка их читает.** Адрес при этом
//      заполняет графу «наименование здания» — но только когда лист не режется
//      по помещению: там здание называет комната.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AZIMUTH_RHUMBS,
  PROJECT_ADDRESS_MAX,
  PROJECT_TOP_AZIMUTH_DEFAULT,
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addWall,
  applyRoomOutlines,
  azimuthRhumb,
  createProject,
  formatCoords,
  labelOf,
  parseCoords,
  parseTopAzimuth,
  projectCoords,
  projectHasSite,
  projectSite,
  projectStamp,
  projectTopAzimuth,
  setProjectSite,
  setProjectStamp,
  setSchemeWallHeight,
  typesInOrder,
  wallElevation,
} from "../src/model.js";
import { drawDrawing, drawElevation, drawScheme, drawingUnitBridge } from "../src/render.js";
import {
  drawGostFrame,
  drawGostStamp,
  gostPixelsPerMm,
  gostSheetSize,
  gostStampValues,
} from "../src/gostSheet.js";
import { marksTable, toCsv } from "../src/tables.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { projectTopFacing } from "../src/panels/projectProps.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-project.json"), "utf8").replace(/\n$/, "");

// ——— разбор координат ————————————————————————————————————————————————

test("пара из карты принимается как есть — это главный случай", () => {
  assert.deepEqual(parseCoords("55.7558, 37.6173"), { lat: 55.7558, lon: 37.6173 });
  // Пробел вместо запятой, точка с запятой, лишние пробелы по краям — та же пара.
  assert.deepEqual(parseCoords("55.7558 37.6173"), { lat: 55.7558, lon: 37.6173 });
  assert.deepEqual(parseCoords(" 55.7558;37.6173 "), { lat: 55.7558, lon: 37.6173 });
  // Запятая как десятичная: так копирует карта в русской локали. Четыре числа
  // через запятую — это те же две координаты, а не четыре величины.
  assert.deepEqual(parseCoords("55,7558 37,6173"), { lat: 55.7558, lon: 37.6173 });
  assert.deepEqual(parseCoords("55,7558, 37,6173"), { lat: 55.7558, lon: 37.6173 });
  // Южное и западное полушария — минусом.
  assert.deepEqual(parseCoords("-33.8688, -151.2093"), { lat: -33.8688, lon: -151.2093 });
  // Неразрывный пробел и типографский минус из карты — невидимая глазом
  // разница, из-за которой вставка падать не должна.
  assert.deepEqual(parseCoords("55.7558,\u00a037.6173"), { lat: 55.7558, lon: 37.6173 });
  assert.deepEqual(parseCoords("\u221233.8688, 151.2093"), { lat: -33.8688, lon: 151.2093 });
  // Шесть знаков после точки — предел: это одиннадцать сантиметров на земле.
  assert.deepEqual(parseCoords("55.75581234, 37.61739999"), { lat: 55.755812, lon: 37.6174 });
});

test("градусы с минутами тоже принимаются, и буквы говорят, где широта", () => {
  const dms = parseCoords("55°45′21″N 37°37′02″E");
  assert.ok(Math.abs(dms.lat - 55.755833) < 1e-6, "широта из минут: " + dms.lat);
  assert.ok(Math.abs(dms.lon - 37.617222) < 1e-6, "долгота из минут: " + dms.lon);
  // Машинописные кавычки вместо штрихов — то же самое.
  assert.deepEqual(parseCoords("55°45'21\"N 37°37'02\"E"), dms);
  assert.deepEqual(parseCoords("55°45'21''N 37°37'02''E"), dms);
  // Долготу написали первой — буквы сторон света разбираются сами.
  assert.deepEqual(parseCoords("37°37′02″E 55°45′21″N"), dms);
  assert.deepEqual(parseCoords("37.6173E, 55.7558N"), { lat: 55.7558, lon: 37.6173 });
  // Русские буквы сторон света — те же буквы.
  assert.deepEqual(parseCoords("55.7558С, 37.6173В"), { lat: 55.7558, lon: 37.6173 });
  assert.deepEqual(parseCoords("33.8688Ю, 151.2093З"), { lat: -33.8688, lon: -151.2093 });
  // Целые градусы без минут — грубо, но это координата.
  assert.deepEqual(parseCoords("55 37"), { lat: 55, lon: 37 });
});

test("пусто — это «не задано», а мусор отвергается вслух", () => {
  for (const empty of ["", "   ", null, undefined]) assert.equal(parseCoords(empty), null);
  const junk = [
    "Москва",
    "55.7558",
    "55.7558, 37.6173, 12",
    "55.7558, Москва",
    "55.7558N 37.6173N",
    "55.7558N 37.6173",
    "-55.7558S 37.6173E",
    "55°75′ 37°37′",
    "55°45′21″ 37°37′02″ 12°",
    "широта 55",
    "55/37",
  ];
  for (const bad of junk) {
    assert.throws(() => parseCoords(bad), /.+/, "принят мусор: " + bad);
  }
  // Вне круга земли — свой отказ: человек явно перепутал местами или единицы.
  assert.throws(() => parseCoords("137.6173, 55.7558"), /Широта/, "широта за полюсом принята");
  assert.throws(() => parseCoords("55.7558, 237.6173"), /долгота/, "долгота за меридианом принята");
});

test("координаты показываются тем же видом, которым их дала карта", () => {
  assert.equal(formatCoords({ lat: 55.7558, lon: 37.6173 }), "55.7558, 37.6173");
  assert.equal(formatCoords(null), "");
  assert.equal(formatCoords({ lat: 55.7558 }), "");
  // Круг «показали — разобрали» сходится: то, что человек видит в поле,
  // принимается обратно без правки.
  const coords = parseCoords("55°45′21″N 37°37′02″E");
  assert.deepEqual(parseCoords(formatCoords(coords)), coords);
});

// ——— направление верха чертежа ————————————————————————————————————————

test("направление — градусы от севера по часовой, умолчание ноль", () => {
  assert.equal(PROJECT_TOP_AZIMUTH_DEFAULT, 0);
  assert.equal(parseTopAzimuth(""), null, "пусто — не задано");
  assert.equal(parseTopAzimuth("0"), 0);
  assert.equal(parseTopAzimuth("90"), 90);
  assert.equal(parseTopAzimuth("90°"), 90, "градус из подписи поля набрали в самом поле");
  assert.equal(parseTopAzimuth("237,5"), 237.5, "запятая как десятичная");
  assert.equal(parseTopAzimuth(360), 0, "круг замкнут");
  assert.equal(parseTopAzimuth(-90), 270, "против часовой — это те же градусы");
  for (const bad of ["север", "9 0", "3600", "-400", "abc"]) {
    assert.throws(() => parseTopAzimuth(bad), /.+/, "принято негодное направление: " + bad);
  }
});

test("румб говорит словом то, что набрано числом", () => {
  assert.deepEqual(AZIMUTH_RHUMBS, ["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
  assert.equal(azimuthRhumb(0), "n");
  assert.equal(azimuthRhumb(22), "n");
  assert.equal(azimuthRhumb(23), "ne");
  assert.equal(azimuthRhumb(90), "e");
  assert.equal(azimuthRhumb(180), "s");
  assert.equal(azimuthRhumb(270), "w");
  assert.equal(azimuthRhumb(350), "n", "за северо-западом снова север");
  assert.equal(azimuthRhumb(-90), "w");
});

// ——— хранение ————————————————————————————————————————————————————————

test("новый объект поля не получает, а читается умолчаниями", () => {
  const project = createProject();
  assert.deepEqual(projectSite(project), { address: "", lat: null, lon: null, topAzimuthDeg: 0 });
  assert.equal(projectCoords(project), null);
  assert.equal(projectTopAzimuth(project), 0);
  assert.equal(projectHasSite(project), false);
  assert.equal(Object.prototype.hasOwnProperty.call(project, "site"), false, "умолчание уехало в объект");
});

test("заполненное живёт в объекте и доезжает через файл", async () => {
  const project = createProject();
  const set = setProjectSite(project, {
    address: "  Москва, ул. Ленина, 14,  кв. 56 ",
    coords: "55.7558, 37.6173",
    topAzimuthDeg: "90",
  });
  assert.equal(set.changed, true);
  assert.equal(set.site.address, "Москва, ул. Ленина, 14, кв. 56", "пробелы и переносы не схлопнулись");
  assert.deepEqual(set.project.site, { address: "Москва, ул. Ленина, 14, кв. 56", lat: 55.7558, lon: 37.6173, topAzimuthDeg: 90 });
  assert.equal(projectHasSite(set.project), true);
  const restored = await unpackProject(await packProject(set.project, new Map()));
  assert.deepEqual(projectSite(restored.project), projectSite(set.project), "свойства не доехали до файла");
  // Повторное сохранение того же — не правка: шага истории на неё не нужно.
  assert.equal(setProjectSite(set.project, { address: "Москва, ул. Ленина, 14, кв. 56" }).changed, false);
  assert.equal(setProjectSite(set.project, { coords: "55.7558,37.6173" }).changed, false);
  assert.equal(setProjectSite(set.project, { topAzimuthDeg: 90 }).changed, false);
  // Длинный адрес обрезается, а не раздувает файл.
  const long = setProjectSite(project, { address: "д".repeat(PROJECT_ADDRESS_MAX + 50) });
  assert.equal(long.site.address.length, PROJECT_ADDRESS_MAX);
});

test("пустое значение удаляет ключ, а опустевший раздел — сам себя", async () => {
  const filled = setProjectSite(createProject(), {
    address: "Москва",
    coords: "55.7558, 37.6173",
    topAzimuthDeg: "237,5",
  }).project;
  const noCoords = setProjectSite(filled, { coords: "" });
  assert.equal(noCoords.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(noCoords.project.site, "lat"), false, "широта осталась");
  assert.equal(Object.prototype.hasOwnProperty.call(noCoords.project.site, "lon"), false, "долгота осталась");
  assert.equal(projectCoords(noCoords.project), null);
  // Ноль градусов — это и есть север, то есть «не задано»: в файл он не пишется.
  const north = setProjectSite(noCoords.project, { topAzimuthDeg: "0" });
  assert.equal(Object.prototype.hasOwnProperty.call(north.project.site, "topAzimuthDeg"), false, "ноль уехал в файл");
  const empty = setProjectSite(north.project, { address: "" });
  assert.equal(empty.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(empty.project, "site"), false, "пустой раздел остался в объекте");
  assert.equal(projectHasSite(empty.project), false);
  // Снимать нечего — и шага истории на это не нужно.
  assert.equal(setProjectSite(empty.project, { address: "", coords: "", topAzimuthDeg: "" }).changed, false);
  const restored = await unpackProject(await packProject(empty.project, new Map()));
  assert.equal(Object.prototype.hasOwnProperty.call(restored.project, "site"), false, "раздел вернулся из файла");
});

test("мусор в ключе читается как «не задано» и объект не роняет", () => {
  const project = createProject();
  for (const junk of ["строка", 7, [], null]) {
    assert.deepEqual(projectSite({ ...project, site: junk }), projectSite(project), "мусор прочитан: " + String(junk));
  }
  // Половина пары — не точка: одна широта без долготы читается как «нет
  // координат», а не как точка на нулевом меридиане.
  assert.equal(projectCoords({ ...project, site: { lat: 55.7558 } }), null);
  assert.equal(projectCoords({ ...project, site: { lat: 55.7558, lon: "37.6173" } }), null);
  assert.equal(projectCoords({ ...project, site: { lat: 155, lon: 37 } }), null, "широта за полюсом принята из файла");
  assert.equal(projectTopAzimuth({ ...project, site: { topAzimuthDeg: "90" } }), 0, "строка из файла стала градусами");
  assert.equal(projectTopAzimuth({ ...project, site: { topAzimuthDeg: 450 } }), 90, "чужой круг не сложён");
  assert.equal(projectSite(null).address, "");
  assert.equal(projectTopAzimuth(undefined), 0);
});

test("негодное значение объект не трогает", () => {
  const project = setProjectSite(createProject(), { address: "Москва" }).project;
  assert.throws(() => setProjectSite(project, { coords: "Москва" }), /Координаты/);
  assert.throws(() => setProjectSite(project, { topAzimuthDeg: "север" }), /Направление/);
  assert.equal(projectSite(project).address, "Москва", "объект поправился на отказе");
});

// ——— G68: прежние объекты ————————————————————————————————————————————

test("G68: объект прежней сборки раздела не получает, разметка не меняется", async () => {
  const legacy = JSON.parse(LEGACY_TEXT);
  assert.deepEqual(projectSite(legacy), { address: "", lat: null, lon: null, topAzimuthDeg: 0 });
  assert.equal(projectHasSite(legacy), false);
  const labels = legacy.marks.map((mark) => labelOf(legacy, mark.id));
  const restored = await unpackProject(await packProject(legacy, new Map()));
  assert.equal(
    Object.prototype.hasOwnProperty.call(restored.project, "site"),
    false,
    "открытие дописало объекту свойства места",
  );
  assert.deepEqual(restored.project.marks.map((mark) => mark.id), legacy.marks.map((mark) => mark.id));
  assert.deepEqual(restored.project.marks.map((mark) => mark.number), legacy.marks.map((mark) => mark.number));
  assert.deepEqual(restored.project.marks.map((mark) => labelOf(restored.project, mark.id)), labels);
  assert.deepEqual(restored.project.counters, legacy.counters, "счётчики нумерации тронуты");
  // Заданные в таком объекте свойства остаются единственной правкой.
  const set = setProjectSite(legacy, { address: "Москва", coords: "55.7558, 37.6173", topAzimuthDeg: 90 }).project;
  assert.deepEqual(set.marks, legacy.marks);
  assert.deepEqual(set.schemes, legacy.schemes);
  assert.deepEqual(set.marks.map((mark) => labelOf(set, mark.id)), labels);
  assert.deepEqual(
    typesInOrder(set).flatMap((group) => group.types.map((type) => type.code)),
    typesInOrder(legacy).flatMap((group) => group.types.map((type) => type.code)),
  );
  // И штамп прежнего объекта остался прежним: адрес стоит рядом с графами, а
  // не вместо них.
  assert.deepEqual(projectStamp(set), projectStamp(legacy));
});

// ——— направление не рисует ничего ————————————————————————————————————

// Холст-писец: записывает каждый вызов и каждое присваивание. Тот же приём, что
// в `test/drawingHandles.test.js` и `test/elevationSheet.test.js`.
function scribe(log) {
  const impl = { measureText: (value) => ({ width: String(value).length * 6 }) };
  return new Proxy(impl, {
    get: (target, key) =>
      key in target ? target[key] : (...args) => log.push(String(key) + "(" + args.join(",") + ")"),
    set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
  });
}

// Объект, на котором видно всё сразу: комната со стенами и проёмом, вещь
// чертежа, контур помещения и метки с подписями.
function scene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 4000, height: 3000 });
  const schemeId = added.scheme.id;
  let project = setSchemeWallHeight(added.project, schemeId, 2700).project;
  const walls = [];
  for (const [aMm, bMm] of [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
    [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ]) {
    const wall = addWall(project, { schemeId, aMm, bMm, thicknessMm: 200 });
    project = wall.project;
    walls.push(wall.wall.id);
  }
  project = addOpening(project, { wallId: walls[0], kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100 }).project;
  project = addSchemeObject(project, {
    schemeId,
    catalogKey: "bathtub",
    shape: "rect",
    atMm: { x: 1200, y: 2800 },
    widthMm: 1700,
    depthMm: 700,
    turnDeg: 0,
  }).project;
  const room = addRoom(project, { name: "Кухня" });
  project = room.project;
  const outline = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
    closed: true,
  });
  project = applyRoomOutlines(outline.project, schemeId).project;
  const types = typesInOrder(project).flatMap((group) => group.types);
  for (const [index, type] of types.slice(0, 3).entries()) {
    project = addMark(project, {
      schemeId,
      typeId: type.id,
      points: [{ x: 0.2 + index * 0.2, y: 0.3 }],
      kind: "point",
    }).project;
  }
  return { project, schemeId, wallId: walls[1], scheme: project.schemes[0] };
}

// Всё, что рисуется и выгружается, одной строкой: журнал холста плюс CSV.
// Поворот направления обязан дать ровно тот же текст.
function everything(project, schemeId, wallId) {
  const scheme = project.schemes.find((item) => item.id === schemeId);
  const log = [];
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };
  drawScheme(scribe(log), {
    project,
    scheme,
    image: null,
    filter: null,
    view,
    legend: { x: 10, y: 10 },
    outlines: "pale",
    drawing: true,
    links: true,
  });
  drawDrawing(scribe(log), { project, schemeId, bridge: drawingUnitBridge({ zoom: 0.1, offsetX: 0, offsetY: 0 }) });
  drawElevation(scribe(log), wallElevation(project, wallId, "left"), { x: 0, y: 0, width: 900, height: 300 });
  const sheet = gostSheetSize("A4", "landscape");
  const mm = gostPixelsPerMm(150);
  drawGostFrame(scribe(log), sheet, mm);
  drawGostStamp(
    scribe(log),
    sheet,
    "form3",
    gostStampValues(projectStamp(project), {
      object: project.name,
      address: projectSite(project).address,
      drawing: scheme.name,
      scale: "М 1:100",
      sheet: 1,
      sheets: 1,
      date: "20.10.2026",
    }),
    mm,
  );
  log.push(toCsv(marksTable(project, null, "category", {})));
  return log;
}

test("поворот направления не сдвигает ни план, ни чертёж, ни развёртку, ни выгрузки", () => {
  const made = scene();
  const before = everything(made.project, made.schemeId, made.wallId);
  assert.ok(before.length > 200, "сцена нарисовалась не вся — пример не тот: " + before.length);
  for (const deg of [90, 180, 237.5, 359]) {
    const turned = setProjectSite(made.project, { topAzimuthDeg: deg }).project;
    assert.equal(projectTopAzimuth(turned), deg === 359 ? 359 : deg);
    assert.deepEqual(
      everything(turned, made.schemeId, made.wallId),
      before,
      "поворот верха на " + deg + "° изменил нарисованное",
    );
  }
  // Координаты тоже ничего не рисуют: их читает объём, когда считает рассвет.
  const located = setProjectSite(made.project, { coords: "55.7558, 37.6173" }).project;
  assert.deepEqual(everything(located, made.schemeId, made.wallId), before, "координаты изменили нарисованное");
});

test("направление не видно никому, кроме модели, окна свойств и объёма", () => {
  // Сверка по исходникам, а не по обещанию: прочитать ключ выгрузке просто
  // негде. Когда таск 181 заведёт солнце, объём окажется в списке — это и есть
  // то единственное место, где направление работает.
  const allowed = new Set(["model.js", "panels/projectProps.js", "volume.js", "panels/volume.js"]);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(SRC);
  assert.ok(files.length > 20, "исходники не нашлись: " + files.length);
  const seen = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/topAzimuth|projectCoords/.test(source)) continue;
    seen.push(relative(SRC, file).split("\\").join("/"));
  }
  const stray = seen.filter((name) => !allowed.has(name));
  assert.deepEqual(stray, [], "направление или координаты читает тот, кто рисует лист");
  assert.ok(seen.includes("model.js"), "сканер ничего не нашёл — проверять было бы нечего");
});

// ——— данные штампа: одно место, выгрузка читает ————————————————————————

test("адрес заполняет графу «наименование здания», когда её нечем занять", () => {
  const project = setProjectSite(createProject(), { address: "Москва, ул. Ленина, 14" }).project;
  const stamp = projectStamp(project);
  const info = { object: project.name, address: projectSite(project).address };
  assert.equal(gostStampValues(stamp, info).building, "Москва, ул. Ленина, 14");
  // Лист по помещению: здание называет комната, адрес не спорит с ней.
  assert.equal(gostStampValues(stamp, { ...info, building: "Кухня" }).building, "Кухня");
  // Адреса нет — графа пустая, как была всегда.
  assert.equal(gostStampValues(projectStamp(createProject()), { object: "Квартира" }).building, "");
});

test("графы штампа остаются там же, где лежали, и читаются оттуда", () => {
  const project = setProjectStamp(createProject(), { code: "2026-14-ЭОМ", org: "ООО «Свет»" }).project;
  const values = gostStampValues(projectStamp(project), { object: project.name, sheet: 1, sheets: 1 });
  assert.equal(values.code, "2026-14-ЭОМ");
  assert.equal(values.org, "ООО «Свет»");
  // Свойства места графы штампа не подменяют: это разные поля объекта.
  const located = setProjectSite(project, { address: "Москва", coords: "55.7558, 37.6173" }).project;
  assert.deepEqual(projectStamp(located), projectStamp(project));
  assert.equal(projectSite(located).address, "Москва");
});

// ——— подпись у направления ————————————————————————————————————————————

test("подпись объясняет, как считать градусы — без неё поле бесполезно", () => {
  // Это не придирка к тексту: половина людей отсчитает градусы в другую
  // сторону, и окна южной стороны будут освещены как северные. Подпись обязана
  // назвать и начало отсчёта, и направление, и пример.
  const hint = strings.projectProps.topHint;
  assert.match(hint, /по часовой/, "не сказано, в какую сторону считать: " + hint);
  assert.match(hint, /север/, "не сказано, откуда считать");
  assert.match(hint, /0°/);
  assert.match(hint, /90° — на восток/, "нет примера, по которому сверяются: " + hint);
  // И вслух сказано, что направление ничего не рисует, кроме объёма.
  assert.match(strings.projectProps.topOnlyVolume, /объём/);
  assert.match(strings.projectProps.topOnlyVolume, /не меняются/);
  // Подсказка координат называет вид из карты и говорит, что будет без них.
  assert.match(strings.projectProps.coordsHint, /9:00/);
  assert.match(strings.projectProps.coordsHint, /21:00/);
  assert.equal(strings.projectProps.coordsPlaceholder, "55.7558, 37.6173", "в поле стоит не тот вид, что в карте");
});

test("живая подпись называет сторону словом, а мусор молчит", () => {
  // Два мнения о том, как считать градусы, развелись бы молча: подпись у поля
  // и румб обязаны сойтись на одном числе.
  for (const rhumb of AZIMUTH_RHUMBS) {
    assert.equal(typeof strings.projectProps.rhumbs[rhumb], "string", "румб без строки: " + rhumb);
  }
  assert.equal(projectTopFacing("0"), "Верх чертежа смотрит на север");
  assert.equal(projectTopFacing("90"), "Верх чертежа смотрит на восток");
  assert.equal(projectTopFacing("90°"), "Верх чертежа смотрит на восток");
  assert.equal(projectTopFacing("237,5"), "Верх чертежа смотрит на юго-запад");
  assert.equal(projectTopFacing("-90"), "Верх чертежа смотрит на запад");
  // Пустое поле молчит: «не задано» значит север, но говорить это человеку,
  // который ещё ничего не ввёл, незачем.
  assert.equal(projectTopFacing(""), "");
  assert.equal(projectTopFacing(null), "");
  assert.equal(projectTopFacing("север"), "", "мусор получил подпись, как будто он число");
});
