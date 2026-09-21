// Выгрузка помещений отдельными листами: из чего состоит архив, что попадает
// в кадр комнаты и как листы названы.
//
// Рисование в Node не проверить — холста нет; всё, что решает состав и кадр
// листа, здесь чистая геометрия, и она проверяется целиком. Сам PNG рисует тот
// же `schemePng`, что и общий лист, — отдельного рисования у комнат нет.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMark, addOutline, addRoom, addScheme, createProject } from "../src/model.js";
import {
  allSchemesPlan,
  exportRoomArea,
  exportRoomSheets,
  exportSheetName,
  exportSize,
} from "../src/exporter.js";

// Квартира: два этажа, на первом кухня и коридор с контурами, на втором
// спальня. У кладовой контура нет вовсе, но метка в ней стоит.
function flat() {
  let project = createProject({ name: "Квартира на Ленина" });
  const first = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = first.project;
  const second = addScheme(project, { name: "2 этаж", width: 1000, height: 800 });
  project = second.project;

  const rooms = {};
  for (const name of ["Кухня", "Коридор", "Кладовая", "Спальня"]) {
    const added = addRoom(project, { name });
    project = added.project;
    rooms[name] = added.room.id;
  }

  const outline = (schemeId, roomId, box) => {
    const added = addOutline(project, {
      schemeId,
      roomId,
      points: [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height },
      ],
    });
    project = added.project;
  };
  // Кухня — четверть плана слева сверху, коридор — узкая полоса справа.
  outline(first.scheme.id, rooms["Кухня"], { x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
  outline(first.scheme.id, rooms["Коридор"], { x: 0.6, y: 0.1, width: 0.1, height: 0.6 });
  outline(second.scheme.id, rooms["Спальня"], { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });

  const mark = (schemeId, roomId, point) => {
    const added = addMark(project, {
      schemeId,
      typeId: project.markTypes[0].id,
      kind: "point",
      points: [point],
    });
    project = added.project;
    if (roomId) {
      project = {
        ...project,
        marks: project.marks.map((item) => (item.id === added.mark.id ? { ...item, roomId } : item)),
      };
    }
    return added.mark.id;
  };
  mark(first.scheme.id, rooms["Кухня"], { x: 0.2, y: 0.2 });
  // Кладовая на первом этаже есть — метка в ней стоит, — а контура у неё нет.
  mark(first.scheme.id, rooms["Кладовая"], { x: 0.8, y: 0.8 });
  // Розетка коридора у самой стены кухни: она попадёт в кадр кухни, и это
  // помощь монтажнику, а не помеха.
  const neighbour = mark(first.scheme.id, rooms["Коридор"], { x: 0.41, y: 0.2 });
  mark(second.scheme.id, rooms["Спальня"], { x: 0.3, y: 0.3 });

  return { project, first: first.scheme, second: second.scheme, rooms, neighbour };
}

test("лист даёт каждая комната с контуром, в порядке справочника", () => {
  const { project, first, second } = flat();

  const one = exportRoomSheets(project, first);
  assert.deepEqual(
    one.sheets.map((sheet) => sheet.name),
    ["Кухня", "Коридор"],
    "листы первого этажа не те или не в том порядке",
  );
  for (const sheet of one.sheets) assert.ok(sheet.area && sheet.area.width > 0, "у листа нет кадра");

  const two = exportRoomSheets(project, second);
  assert.deepEqual(two.sheets.map((sheet) => sheet.name), ["Спальня"], "на втором этаже лишние листы");
});

test("комната без контура названа, а комната с другого этажа — нет", () => {
  const { project, first, second } = flat();

  // На первом этаже кладовая есть (в ней метка), а контура нет: листа не
  // будет, и человеку об этом говорят.
  assert.deepEqual(exportRoomSheets(project, first).missing, ["Кладовая"]);

  // На втором этаже кладовой нет вовсе — молчим: иначе список превратился бы
  // в перечень всех комнат объекта на каждом этаже.
  assert.deepEqual(exportRoomSheets(project, second).missing, []);
});

test("кадр комнаты режет план и держит поле тесным", () => {
  const { project, first, rooms, neighbour } = flat();
  const kitchen = exportRoomArea(project, first, rooms["Кухня"]);

  // Обрезка, а не весь план: иначе лист комнаты не отличался бы от общего.
  assert.ok(kitchen.width < first.width * 0.8, "кадр кухни занял почти весь план");
  assert.ok(kitchen.height < first.height * 0.8);

  // Контур кухни внутри кадра целиком, да ещё с полями.
  assert.ok(kitchen.x < 0.1 * first.width, "слева нет поля");
  assert.ok(kitchen.y < 0.1 * first.height, "сверху нет поля");
  assert.ok(kitchen.x + kitchen.width > 0.4 * first.width, "справа обрезано по контуру");
  assert.ok(kitchen.y + kitchen.height > 0.4 * first.height, "снизу обрезано по контуру");

  // «Чуть вокруг»: метка соседней комнаты в сотой доле плана за стеной в кадр
  // уже не попадает. Прежнее поле (6% длинной стороны) захватывало её и ещё
  // столько же соседней квартиры — на это и жаловался заказчик.
  const mark = project.marks.find((item) => item.id === neighbour);
  const at = { x: mark.points[0].x * first.width, y: mark.points[0].y * first.height };
  assert.ok(at.x > kitchen.x + kitchen.width, "кадр всё ещё дотягивается до соседней комнаты");
});

test("масштаб у всех листов один: у маленькой комнаты меньше лист, а не рисунок", () => {
  const { project, first, rooms } = flat();
  const kitchen = exportRoomArea(project, first, rooms["Кухня"]);
  const hall = exportRoomArea(project, first, rooms["Коридор"]);
  const scale = 2;

  const perUnit = (area) => exportSize(area.width, area.height, scale).width / area.width;
  assert.ok(Math.abs(perUnit(kitchen) - perUnit(hall)) < 0.01, "масштабы листов разошлись");
  assert.ok(
    exportSize(hall.width, hall.height, scale).width < exportSize(kitchen.width, kitchen.height, scale).width,
    "узкий коридор дал лист шире кухни",
  );
});

test("счёт листов виден до выгрузки, а без пункта архив прежний", () => {
  const { project } = flat();

  const plain = allSchemesPlan(project, {});
  assert.deepEqual(plain, { schemes: 2, rooms: 0, total: 2, missing: [] }, "без пункта архив изменился");

  const byRooms = allSchemesPlan(project, { rooms: true });
  assert.equal(byRooms.schemes, 2);
  assert.equal(byRooms.rooms, 3, "листов помещений не три");
  assert.equal(byRooms.total, 5, "общие листы пропали из счёта");
  assert.deepEqual(byRooms.missing, ["Кладовая"]);
});

test("листы комнат встают в папке сразу за своим этажом и по порядку", () => {
  const scheme = { name: "1 этаж" };
  const whole = exportSheetName(scheme, 0);
  const names = [whole];
  const rooms = ["Кухня", "Коридор", "Спальня", "Ванная", "Балкон", "Кладовая", "Гардероб", "Детская", "Кабинет", "Холл"];
  rooms.forEach((room, at) => names.push(exportSheetName(scheme, 0, room, at)));
  names.push(exportSheetName({ name: "2 этаж" }, 1));

  assert.equal(whole, "01-1 этаж.png");
  assert.equal(names[1], "01.01-1 этаж — Кухня.png");
  assert.equal(names[10], "01.10-1 этаж — Холл.png");

  // Порядок в папке загрузок — тот же, в котором листы клали в архив.
  const sorted = [...names].sort();
  assert.deepEqual(sorted, names, "в папке листы перемешались");
  assert.equal(sorted[0], "01-1 этаж.png", "общий лист этажа не первый");
  assert.equal(sorted[sorted.length - 1], "02-2 этаж.png");
});

test("запрещённые знаки в имени комнаты не ломают имя листа", () => {
  const name = exportSheetName({ name: "1 этаж" }, 0, 'Кухня/студия: "большая"', 0);
  assert.equal(name.includes("/"), false, name);
  assert.equal(name.includes(":"), false, name);
  assert.equal(name.includes('"'), false, name);
  assert.ok(name.startsWith("01.01-"), name);
  assert.ok(name.endsWith(".png"), name);
});

// ——— лист комнаты: только её метки и «чуть вокруг» (таск 93) ——————————
//
// Заказчик посмотрел листы и снял два прежних решения: «оставляй только её
// метки и обозначения комнаты только текущей, а так же не такой большой запас
// вокруг контура комнаты, а то видно слишком много».

import { exportFitArea, exportRoomFilter } from "../src/exporter.js";
import { labelBox, visibleMarks, visibleOutlines } from "../src/render.js";
import { updateMark } from "../src/model.js";

// План 2480×1754 и три комнаты разной стати: узкий коридор, маленький санузел
// и большая гостиная. Процент от размера ведёт себя на них по-разному — в этом
// и была прежняя беда.
function rooms() {
  let project = createProject({ name: "Квартира на Ленина" });
  const added = addScheme(project, { name: "1 этаж", width: 2480, height: 1754 });
  project = added.project;
  const scheme = added.scheme;
  const boxes = {
    Коридор: { x: 0.47, y: 0.06, width: 0.09, height: 0.86 },
    Санузел: { x: 0.58, y: 0.06, width: 0.12, height: 0.2 },
    Гостиная: { x: 0.04, y: 0.06, width: 0.42, height: 0.5 },
  };
  const ids = {};
  for (const [name, box] of Object.entries(boxes)) {
    const room = addRoom(project, { name });
    project = room.project;
    ids[name] = room.room.id;
    project = addOutline(project, {
      schemeId: scheme.id,
      roomId: room.room.id,
      points: [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height },
      ],
    }).project;
  }
  return { project, scheme, ids, boxes };
}

function put(project, scheme, roomId, point) {
  const added = addMark(project, {
    schemeId: scheme.id,
    typeId: project.markTypes[0].id,
    kind: "point",
    points: [point],
  });
  const marks = added.project.marks.map((mark) => (mark.id === added.mark.id ? { ...mark, roomId } : mark));
  return { project: { ...added.project, marks }, markId: added.mark.id };
}

test("поле вокруг контура стало «чуть вокруг» на комнатах любой стати", () => {
  const { project, scheme, ids, boxes } = rooms();
  const plan = { width: scheme.width, height: scheme.height };
  // Прежняя мера: 6% большей стороны комнаты, но не меньше 24 px плана.
  const before = (box) => Math.max(24, Math.max(box.width * plan.width, box.height * plan.height) * 0.06);

  for (const [name, box] of Object.entries(boxes)) {
    const area = exportRoomArea(project, scheme, ids[name]);
    const pad = box.x * plan.width - area.x;
    const short = Math.min(box.width * plan.width, box.height * plan.height);

    assert.ok(pad < before(box), name + ": поле не уменьшилось (" + pad + " против " + before(box) + ")");
    // Стена видна: поле не меньше сотой доли плана.
    assert.ok(pad >= plan.width * 0.0079, name + ": поле схлопнулось до " + pad);
    // Половины квартиры не видно: поле не шире трети меньшей стороны комнаты
    // и не больше двадцать пятой доли плана.
    assert.ok(pad <= short / 3, name + ": поле шире трети комнаты — " + pad);
    assert.ok(pad <= plan.width * 0.0401, name + ": поле больше двадцать пятой доли плана");
  }

  // На узком коридоре и большой гостиной прежняя мера была втрое-вдвое больше.
  const corridorPad = boxes["Коридор"].x * plan.width - exportRoomArea(project, scheme, ids["Коридор"]).x;
  const livingPad = boxes["Гостиная"].x * plan.width - exportRoomArea(project, scheme, ids["Гостиная"]).x;
  assert.ok(corridorPad * 2 < before(boxes["Коридор"]), "у коридора поле не уполовинилось");
  assert.ok(livingPad * 2 < before(boxes["Гостиная"]), "у гостиной поле не уполовинилось");
});

test("на листе комнаты только её метки, её контур и её название", () => {
  let { project, scheme, ids } = rooms();
  const mine = put(project, scheme, ids["Гостиная"], { x: 0.2, y: 0.2 });
  project = mine.project;
  // Розетка коридора у самой стены гостиной — в кадр попадает, а на лист нет.
  const neighbour = put(project, scheme, ids["Коридор"], { x: 0.465, y: 0.2 });
  project = neighbour.project;

  const filter = exportRoomFilter(null, ids["Гостиная"]);
  const marks = visibleMarks(project, scheme, filter);
  assert.deepEqual(marks.map((mark) => mark.id), [mine.markId], "на листе чужие метки");

  // Контур соседа уходит вместе с его метками: стены рисует сам план, а контур
  // с заливкой цветом чужой комнаты — это и есть «видно слишком много».
  const outlines = visibleOutlines(project, scheme, filter);
  assert.equal(outlines.length, 1, "на листе чужие контуры");
  assert.equal(outlines[0].roomId, ids["Гостиная"]);

  // Без фильтра — как на общем листе: всё на месте.
  assert.equal(visibleMarks(project, scheme, null).length, 2);
  assert.equal(visibleOutlines(project, scheme, null).length, 3);
});

test("фильтр листа не отменяет выбранное на экране", () => {
  const { ids } = rooms();
  const screen = { typeIds: ["a", "b"], query: "щит" };
  const sheet = exportRoomFilter(screen, ids["Кухня"] || "room-1");
  assert.deepEqual(sheet.typeIds, ["a", "b"], "отметки окна потерялись");
  assert.equal(sheet.query, "щит");
  assert.equal(sheet.roomId, "room-1");
  assert.equal(exportRoomFilter(screen, null), screen, "без комнаты фильтр не трогаем");
});

test("подпись метки у стены остаётся на листе комнаты, а не уезжает за обрез", () => {
  let { project, scheme, ids } = rooms();
  // Метка у правой стены санузла: подпись рисуется правее метки и при тесном
  // поле ушла бы за обрез — ради таких мест лист и печатают.
  const edge = put(project, scheme, ids["Санузел"], { x: 0.6985, y: 0.16 });
  project = edge.project;

  const filter = exportRoomFilter(null, ids["Санузел"]);
  const area = exportRoomArea(project, scheme, ids["Санузел"]);
  const fitted = exportFitArea(project, scheme, { area, filter });

  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: project.view.markSize, labelSize: project.view.labelSize };
  const mark = project.marks.find((item) => item.id === edge.markId);
  const box = labelBox(project, scheme, mark, view, filter);
  assert.ok(box.text, "у метки нет подписи — проверять нечего");
  assert.ok(
    box.x + box.width <= fitted.area.x + fitted.area.width,
    "подпись уехала за правый обрез: " + (box.x + box.width) + " > " + (fitted.area.x + fitted.area.width),
  );
  assert.deepEqual(fitted.missed, [], "подпись попала в потерянные");
});

test("общий лист не изменился: его кадр растёт по прежнему потолку", () => {
  let { project, scheme, ids } = rooms();
  const mine = put(project, scheme, ids["Гостиная"], { x: 0.2, y: 0.2 });
  project = mine.project;
  // Подпись, оттащенную на полплана, потолок обязан подрезать там же, где и
  // раньше: на четверти стороны листа.
  project = updateMark(project, mine.markId, { labelOffset: { dx: 4000, dy: 0 } }).project;

  const fitted = exportFitArea(project, scheme, { area: "all" });
  const grown = fitted.area.x + fitted.area.width - scheme.width;
  assert.ok(grown > 0, "кадр общего листа не вырос вовсе");
  assert.ok(
    Math.abs(grown - scheme.width * 0.25) < 1,
    "потолок роста общего листа сдвинулся: вырос на " + grown,
  );
});
