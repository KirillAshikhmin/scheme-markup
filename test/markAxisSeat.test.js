// Имена осей зависят от посадки вещи (таск 161, дефект D36).
//
// Таск 158 распутал имена размеров — и они верны для вещи **на стене**: вверх
// идёт `width` («Высота»), поперёк `depth` («Ширина»). У вещи **под потолком**
// лицо смотрит вниз: объём кладёт в план длину и `width`, а свешивает вниз
// `depth`. У люстры 500 × 400 при выступе 300 свисали 300, а карточка звала их
// «Шириной» и обещала «Высоту 400».
//
// Правка — **подпись, а не геометрия**: ни одного числа и ни одного пикселя
// таск не двигает, поэтому и проверяется здесь не картинка, а шов между
// картинкой и словом:
//
//   1. **правило посадки** — чистой функцией, на двух доводах;
//   2. **шов с объёмом** — подпись «Высота» обязана стоять у того поля, которое
//      объём рисует вверх. Это главный тест таска: разойдись слово с картинкой
//      снова, и чертёж прочтут неверно, а заметят это на монтаже;
//   3. **справочник типов**, где метки ещё нет: что он показывает и почему;
//   4. **G68** — объект прежнего формата читается ровно как читался, и его
//      чтение его не трогает.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MARK_AXIS_FLAT,
  MARK_AXIS_UPRIGHT,
  MARK_DIMENSION_SIGNED,
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  axisSeatOf,
  createProject,
  findMark,
  markAxisSeat,
  markOnWall,
  markSizes,
  planMmToFraction,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  typeAxisSeat,
  typeSizes,
} from "../src/model.js";
import { strings } from "../src/strings.js";
import { markSizesLabel, markSizesOrder, markSizesSummary } from "../src/panels/markSizes.js";
import { unpackProject, writeZip } from "../src/projectFile.js";
import {
  VOLUME_MARK_CEILING,
  VOLUME_MARK_ROOM,
  VOLUME_MARK_WALL,
  volumeScene,
} from "../src/volume.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ——— правило посадки ——————————————————————————————————————————————————————

test("посадку решают числа метки: нет высоты над полом — под потолком, ноль без стены — на полу", () => {
  // Под потолком: высоты над полом нет вовсе — то же правило, по которому
  // вещь туда ставит объём (`heightMm === null`).
  assert.equal(axisSeatOf(null, false), MARK_AXIS_FLAT);
  assert.equal(axisSeatOf(null, true), MARK_AXIS_FLAT, "стена потолочной вещи не поднимает");
  assert.equal(axisSeatOf(undefined, false), MARK_AXIS_FLAT, "поля нет вовсе — то же «не задано»");
  // На полу: ноль — это «низ на полу» (дефект D34), и вверх у такой вещи идёт
  // её выступ.
  assert.equal(axisSeatOf(0, false), MARK_AXIS_FLAT);
  // Но нулевая высота **у стены** — это розетка в полу: её объём ставит на
  // стену, и вверх у неё по-прежнему идёт высота.
  assert.equal(axisSeatOf(0, true), MARK_AXIS_UPRIGHT);
  assert.equal(axisSeatOf(900, true), MARK_AXIS_UPRIGHT);
  // Вещь на высоте без стены: объём кладёт её плашмя, а имена остаются
  // стенными — решение таска, разобранное у `markAxisSeat`. Пока чертежа нет,
  // не привязана ни одна метка, и подпись не имеет права переставлять местами
  // числа, набранные по паспорту.
  assert.equal(axisSeatOf(900, false), MARK_AXIS_UPRIGHT);
});

// ——— подписи ——————————————————————————————————————————————————————————————

test("у вещи лицом вниз высотой зовётся то поле, что свисает вниз", () => {
  // Вещь на стене — ровно как после таска 158: ни одна подпись не изменилась.
  assert.equal(markSizesLabel("length", MARK_AXIS_UPRIGHT), "Длина, мм");
  assert.equal(markSizesLabel("depth", MARK_AXIS_UPRIGHT), "Ширина, мм");
  assert.equal(markSizesLabel("width", MARK_AXIS_UPRIGHT), "Высота, мм");
  assert.equal(markSizesLabel("heightAboveFloor", MARK_AXIS_UPRIGHT), "Высота над полом, мм");
  // Без довода подпись остаётся стенной: так её спрашивали до этого таска.
  assert.equal(markSizesLabel("width"), markSizesLabel("width", MARK_AXIS_UPRIGHT));

  // Вещь лицом вниз: два поля поменялись именами, два остались при своих.
  assert.equal(markSizesLabel("depth", MARK_AXIS_FLAT), "Высота, мм");
  assert.equal(markSizesLabel("width", MARK_AXIS_FLAT), "Ширина, мм");
  assert.equal(markSizesLabel("length", MARK_AXIS_FLAT), "Длина, мм");
  assert.equal(markSizesLabel("heightAboveFloor", MARK_AXIS_FLAT), "Высота над полом, мм");

  // Порядок на экране — всегда Д · Ш · В: имена меняются местами, и поля
  // меняются местами за ними.
  assert.deepEqual(markSizesOrder(MARK_AXIS_UPRIGHT), ["length", "depth", "width", "heightAboveFloor"]);
  assert.deepEqual(markSizesOrder(MARK_AXIS_FLAT), ["length", "width", "depth", "heightAboveFloor"]);
  for (const seat of [MARK_AXIS_UPRIGHT, MARK_AXIS_FLAT]) {
    const trio = markSizesOrder(seat).slice(0, 3).map((field) => markSizesLabel(field, seat));
    assert.deepEqual(trio, ["Длина, мм", "Ширина, мм", "Высота, мм"], "тройка читается не Д · Ш · В: " + seat);
    assert.equal(markSizesOrder(seat)[3], "heightAboveFloor", "посадка стоит за габаритом");
  }
});

test("короткая подпись кнопки читается верно при обеих посадках", () => {
  // Люстра заказчика: 500 × 400 в плане, свисает 300.
  const chandelier = { length: 500, width: 400, depth: 300 };
  assert.equal(markSizesSummary(chandelier, MARK_AXIS_FLAT), "Д 500 · Ш 400 · В 300 мм");
  // Та же вещь стенными именами — то, как кнопка читалась до этого таска (и
  // как она читается у вещи на стене): свисающие 300 стояли под «Ш».
  assert.equal(markSizesSummary(chandelier, MARK_AXIS_UPRIGHT), "Д 500 · Ш 300 · В 400 мм");
  // Кондиционер на стене — подпись не изменилась ни буквой.
  const conditioner = { length: 900, width: 300, depth: 200, heightAboveFloor: 2300 };
  assert.equal(markSizesSummary(conditioner, MARK_AXIS_UPRIGHT), "Д 900 · Ш 200 · В 300 · от пола 2300 мм");
  assert.equal(markSizesSummary(conditioner), "Д 900 · Ш 200 · В 300 · от пола 2300 мм");
  // Незаданные поля пропускаются при любой посадке, а не встают прочерком.
  assert.equal(markSizesSummary({ depth: 300 }, MARK_AXIS_FLAT), "В 300 мм");
  assert.equal(markSizesSummary({ heightAboveFloor: 0 }, MARK_AXIS_FLAT), "от пола 0 мм");
  assert.equal(markSizesSummary(null, MARK_AXIS_FLAT), "");
});

test("минус остаётся у того же поля файла, и подсказка про утопленное не врёт", () => {
  // Знак привязан к ключу, а не к имени: файл один на обе посадки, и объект, в
  // котором минус уже лежит, обязан сохраняться.
  assert.deepEqual(MARK_DIMENSION_SIGNED, ["depth"]);
  // У вещи на стене это «Ширина» — про неё подсказка и говорит «утопленное».
  assert.equal(markSizesLabel("depth", MARK_AXIS_UPRIGHT), "Ширина, мм");
  assert.ok(strings.markSizes.hint.includes("Ширина — единственное поле с минусом"));
  assert.ok(strings.markSizes.hint.includes("утопленное"));
  // У вещи лицом вниз то же поле зовётся «Высотой» — и подсказка утопленного
  // ей не обещает: вниз объём откладывает число без знака.
  assert.equal(markSizesLabel("depth", MARK_AXIS_FLAT), "Высота, мм");
  assert.ok(
    strings.markSizes.flat.hint.includes("утопленное бывает только у стены"),
    "подсказка потолочной вещи обязана сказать, что знак здесь ничего не меняет",
  );
  assert.ok(!strings.markSizes.flat.hint.includes("Ширина — единственное"), "стенная оговорка уехала не туда");
});

// ——— шов: подпись против картинки ————————————————————————————————————————

// План 1200 × 800 точек, сто точек на метр, нуль чертежа в середине — тот же
// стенд, что у объёма и развёртки.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id };
}

/** Комната 4 × 3 м из четырёх стен с обведённым контуром. */
function roomScene() {
  const base = planProject();
  let project = base.project;
  const half = { x: 2000, y: 1500 };
  const corners = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];
  for (let index = 0; index < corners.length; index += 1) {
    project = addWall(project, {
      schemeId: base.schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    }).project;
  }
  const room = addRoom(project, "Кухня");
  project = room.project;
  const inner = [
    { x: -half.x + 100, y: -half.y + 100 },
    { x: half.x - 100, y: -half.y + 100 },
    { x: half.x - 100, y: half.y - 100 },
    { x: -half.x + 100, y: half.y - 100 },
  ];
  project = addOutline(project, {
    schemeId: base.schemeId,
    roomId: room.room.id,
    points: inner.map((point) => planMmToFraction(project, base.schemeId, point)),
  }).project;
  return { project, schemeId: base.schemeId };
}

function typeByCode(project, code) {
  return project.markTypes.find((type) => type.code === code);
}

function markAt(project, schemeId, code, pointsMm, sizes) {
  const added = addMark(project, {
    schemeId,
    typeId: typeByCode(project, code).id,
    points: pointsMm.map((point) => planMmToFraction(project, schemeId, point)),
  });
  let next = added.project;
  if (sizes) next = setMarkDimensions(next, added.marks[0].id, sizes).project;
  next = applyMarkWalls(next, schemeId).project;
  return { project: next, markId: added.marks[0].id };
}

/** Что рисует объём: сколько вещь занимает вверх и каким режимом поставлена. */
function drawn(project, schemeId, markId) {
  const place = volumeScene(project, schemeId, {}).marks.find((item) => item.markId === markId);
  const prism = place.prisms[0];
  return { mode: place.mode, upMm: Math.round(prism.topMm - prism.bottomMm), bottomMm: Math.round(prism.bottomMm) };
}

/**
 * Поле, которое объём рисует **вверх**: то из двух, чьё число равно высоте
 * нарисованного тела. Спрашивается у призмы, а не у полей размещения:
 * рисуется именно призма, и сверять надо то, что видит глаз.
 */
function fieldDrawnUp(project, mark, upMm) {
  const sizes = markSizes(project, mark);
  const found = ["width", "depth"].filter((field) => Math.round(Math.abs(sizes[field])) === upMm);
  assert.equal(found.length, 1, "по числам не видно, какое поле нарисовано вверх: " + JSON.stringify(sizes));
  return found[0];
}

test("подпись «Высота» стоит у того поля, которое объём рисует вверх", () => {
  const scene = roomScene();
  let project = scene.project;
  // Кондиционер у стены: 900 вдоль стены, 300 вверх, 200 от стены.
  const conditioner = markAt(project, scene.schemeId, "К", [{ x: 0, y: -1400 }]);
  project = conditioner.project;
  // Люстра под потолком — высоты над полом у неё нет вовсе: 500 × 400 в плане,
  // свисает 300. Это та самая вещь из дефекта D36.
  const chandelier = markAt(project, scene.schemeId, "ЛЮ", [{ x: 0, y: 0 }]);
  project = chandelier.project;
  // Вещь на полу посреди комнаты: высота над полом ровно ноль, и три стороны
  // нарочно разные — иначе не видно, какая из них нарисована вверх.
  const vacuum = markAt(project, scene.schemeId, "РП", [{ x: 800, y: 600 }], {
    length: 400,
    width: 300,
    depth: 150,
    heightAboveFloor: 0,
  });
  project = vacuum.project;

  const cases = [
    { markId: conditioner.markId, mode: VOLUME_MARK_WALL, seat: MARK_AXIS_UPRIGHT, upMm: 300 },
    { markId: chandelier.markId, mode: VOLUME_MARK_CEILING, seat: MARK_AXIS_FLAT, upMm: 300 },
    { markId: vacuum.markId, mode: VOLUME_MARK_ROOM, seat: MARK_AXIS_FLAT, upMm: 150 },
  ];
  for (const item of cases) {
    const mark = findMark(project, item.markId);
    const picture = drawn(project, scene.schemeId, item.markId);
    assert.equal(picture.mode, item.mode, "вещь поставлена не туда, куда задумано: " + item.markId);
    assert.equal(picture.upMm, item.upMm, "вещь нарисована другой высоты: " + item.markId);
    const seat = markAxisSeat(project, mark);
    assert.equal(seat, item.seat, "посадка разошлась с картинкой: " + item.markId);
    // Вот он, шов: поле, нарисованное вверх, обязано быть подписано высотой.
    const up = fieldDrawnUp(project, mark, picture.upMm);
    assert.equal(
      markSizesLabel(up, seat),
      "Высота, мм",
      "вверх рисуется поле " + up + ", а высотой подписано другое",
    );
  }

  // Люстра на стенных именах и врала: 400 звались высотой, а свисали 300.
  const chandelierMark = findMark(project, chandelier.markId);
  assert.deepEqual(
    (({ length, width, depth }) => ({ length, width, depth }))(markSizes(project, chandelierMark)),
    { length: 500, width: 400, depth: 300 },
    "габарит люстры взят у стартового справочника и не менялся",
  );
  assert.equal(markSizesSummary(chandelierMark, markAxisSeat(project, chandelierMark)), "");
  // Вещь на полу стоит низом на нуле (дефект D34) — таск этого не трогал.
  assert.equal(drawn(project, scene.schemeId, vacuum.markId).bottomMm, 0);
  // Привязка к стене читается одним местом и у потолочной вещи её нет.
  assert.equal(markOnWall(project, findMark(project, conditioner.markId)), true);
  assert.equal(markOnWall(project, chandelierMark), false);
});

test("вещь на высоте без стены: объём кладёт её плашмя, а имена остаются стенными", () => {
  // Единственное место, где слово и картинка расходятся намеренно. Такая вещь
  // — это чаще всего стена, которую ещё не начертили: пока чертежа нет, не
  // привязана ни одна метка, и подпись, пойди она за догадкой сборки, звала бы
  // высоту корпуса шириной у каждого объекта без чертежа.
  const scene = roomScene();
  const air = markAt(scene.project, scene.schemeId, "К", [{ x: 1200, y: 400 }]);
  const mark = findMark(air.project, air.markId);
  assert.equal(markOnWall(air.project, mark), false, "вещь нарочно поставлена вдали от стен");
  assert.equal(markSizes(air.project, mark).heightAboveFloor, 2300, "высота унаследована от типа");
  assert.equal(markAxisSeat(air.project, mark), MARK_AXIS_UPRIGHT);
  const picture = drawn(air.project, scene.schemeId, air.markId);
  assert.equal(picture.mode, VOLUME_MARK_ROOM);
  // Вверх нарисован выступ (200), а высотой подписано поле `width` (300) —
  // расхождение названо здесь вслух, чтобы его не нашли снова как дефект.
  assert.equal(picture.upMm, 200);
  assert.equal(markSizesLabel("width", MARK_AXIS_UPRIGHT), "Высота, мм");
});

// ——— справочник типов, где метки ещё нет —————————————————————————————————

test("справочник типов: посадку решает умолчание высоты над полом", () => {
  const project = createProject();
  const flat = project.markTypes.filter((type) => typeAxisSeat(type) === MARK_AXIS_FLAT).map((type) => type.code);
  // Стартовый справочник отвечает за правило числами, а не рассуждением: лицом
  // вниз вышли ровно восемь светильников с подсветками — у них нет умолчания
  // высоты над полом — и три напольные вещи, у которых она ровно ноль
  // (осушитель, датчик протечки, робот-пылесос). Остальные сорок типов
  // стенные, и ни одна их подпись не изменилась. Сороковой и тридцать девятый
  // — телевизор с полотенцесушителем (таск 186): оба висят на стене, у обоих
  // высота над полом задана, и подписи у них стенные.
  assert.deepEqual(flat, ["Т", "С", "ПК", "ТР", "ПС", "Л", "ПШ", "ЛЮ", "ОВ", "ДПр", "РП"]);
  assert.equal(project.markTypes.length - flat.length, 40);
  for (const code of ["В", "Р", "К", "Щ", "СУШ", "ЛВ", "ТВ", "ПОС"]) {
    const type = typeByCode(project, code);
    assert.equal(typeAxisSeat(type), MARK_AXIS_UPRIGHT, "вещь на стене прочлась потолочной: " + code);
    assert.ok(typeSizes(type).heightAboveFloor !== null, "у стенного типа обязана быть высота над полом: " + code);
  }
  // Люстра в справочнике читается так же, как её метка: свисающие 300 — высота.
  const chandelier = typeByCode(project, "ЛЮ");
  assert.equal(markSizesSummary(typeSizes(chandelier), typeAxisSeat(chandelier)), "Д 500 · Ш 400 · В 300 мм");
  // Кондиционер в справочнике не изменился ни буквой.
  const conditioner = typeByCode(project, "К");
  assert.equal(
    markSizesSummary(typeSizes(conditioner), typeAxisSeat(conditioner)),
    "Д 900 · Ш 200 · В 300 · от пола 2300 мм",
  );
});

test("тип, который не сказал о себе ничего, остаётся стенным", () => {
  // Сорок девять своих типов заказчика (дефект D28) пусты во всех четырёх
  // полях, и «высоты нет» значит у них «ещё не заполняли». Окно у такого типа
  // открывается пустым — в него набирают по паспорту, Д × Ш × В.
  assert.equal(typeAxisSeat({ id: "a", code: "ЧТОТО", name: "Своё" }), MARK_AXIS_UPRIGHT);
  assert.equal(typeAxisSeat({ id: "a", code: "ЧТОТО", name: "Своё", sizes: {} }), MARK_AXIS_UPRIGHT);
  assert.equal(typeAxisSeat(null), MARK_AXIS_UPRIGHT);
  // Сказал про габарит, но не про высоту над полом — потолочная вещь.
  assert.equal(typeAxisSeat({ id: "b", code: "ЛЮ", sizes: { length: 500, width: 400, depth: 300 } }), MARK_AXIS_FLAT);
  // Сказал только про высоту над полом — стенная.
  assert.equal(typeAxisSeat({ id: "c", code: "Р", sizes: { heightAboveFloor: 300 } }), MARK_AXIS_UPRIGHT);
});

// ——— G68: объект прежнего формата ————————————————————————————————————————

test("объект прежнего формата читается ровно как читался, и чтение его не трогает", async () => {
  const raw = readFileSync(join(HERE, "legacy-height-project.json"), "utf8");
  const blob = await writeZip([{ name: "project.json", data: raw }]);
  const project = (await unpackProject(blob)).project;
  const before = JSON.stringify(project);

  const seats = new Map();
  for (const mark of project.marks) seats.set(mark.number + "/" + mark.kind, markAxisSeat(project, mark));
  // Все три метки фикстуры — на стене: у кондиционера высота унаследована от
  // типа (2300), у сушилки от типа (900), у ленты своя (1300). Подписи у них
  // те же, что до таска 161.
  for (const [key, seat] of seats) {
    assert.equal(seat, MARK_AXIS_UPRIGHT, "метка прежнего объекта прочлась потолочной: " + key);
  }
  const conditioner = project.marks[0];
  assert.equal(markSizesSummary(conditioner, seats.get("1/point")), "", "своих размеров у метки не было и не появилось");
  assert.equal(
    markSizesSummary(markSizes(project, conditioner), markAxisSeat(project, conditioner)),
    "Д 900 · Ш 200 · В 300 · от пола 2300 мм",
    "унаследованный габарит кондиционера читается как читался",
  );
  const strip = project.marks[1];
  assert.equal(
    markSizesSummary(strip, markAxisSeat(project, strip)),
    "В 2600 · от пола 1300 мм",
    "вертикальная лента заказчика: 2600 — её высота",
  );
  assert.equal(JSON.stringify(project), before, "чтение посадки тронуло объект — это запрещено прямо (G68)");
});
