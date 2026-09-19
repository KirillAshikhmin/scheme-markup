// Окно выбора меток открывается «для метки», и помещение этой метки — то, с
// которым фильтр должен стоять при открытии. Слова заказчика: «при открытии
// окна Чем управляет у метки — сразу фильтруй по метке комнаты, для которой
// выбираем». Само окно — DOM и тестами не покрыто намеренно; проверяется
// чистый кусок, который отвечает на вопрос «с какого помещения открывать».
import test from "node:test";
import assert from "node:assert/strict";
import { addMark, addRoom, addScheme, createProject, labelOf, updateMark } from "../src/model.js";
import {
  markControlsCandidates,
  markControlsHiddenCount,
  markControlsInitialRoom,
  markControlsMatches,
  markControlsView,
} from "../src/panels/markControls.js";

function pickerHouse() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  const bedroom = addRoom(project, "Спальная");
  project = bedroom.project;
  const hall = addRoom(project, "Холл");
  project = hall.project;

  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x, roomId) => {
    const added = addMark(project, { schemeId, typeId: typeOf(code), kind: "point", points: [{ x, y: 0.5 }] });
    project = roomId ? updateMark(added.project, added.mark.id, { roomId }).project : added.project;
    return added.mark.id;
  };

  const marks = {
    switchBedroom: put("В", 0.1, bedroom.room.id),
    lampBedroom: put("Т", 0.2, bedroom.room.id),
    lampHall: put("Т", 0.3, hall.room.id),
    switchNowhere: put("В", 0.4, null),
  };
  return { project, marks, bedroom: bedroom.room.id, hall: hall.room.id };
}

test("окно открывается с помещением той метки, для которой его открыли", () => {
  const box = pickerHouse();
  assert.equal(markControlsInitialRoom(box.project, box.marks.switchBedroom), box.bedroom);
  assert.equal(markControlsInitialRoom(box.project, box.marks.lampHall), box.hall);
});

test("у метки без помещения фильтр остаётся на «Все помещения»", () => {
  const box = pickerHouse();
  // Пустая строка — значение пункта «Все помещения» в том же select.
  assert.equal(markControlsInitialRoom(box.project, box.marks.switchNowhere), "");
});

test("потерянная ссылка на помещение не сужает список в никуда", () => {
  const box = pickerHouse();
  // Объект, у которого помещения уже нет, а метка на него ещё ссылается:
  // фильтр по нему показал бы пустой список без единого способа понять, чей
  // он. «Все помещения» — единственный честный ответ.
  const broken = { ...box.project, rooms: box.project.rooms.filter((room) => room.id !== box.bedroom) };
  assert.equal(markControlsInitialRoom(broken, box.marks.switchBedroom), "");
});

test("метки нет — открываем как раньше, полным списком", () => {
  const box = pickerHouse();
  assert.equal(markControlsInitialRoom(box.project, null), "");
  assert.equal(markControlsInitialRoom(box.project, "нет такой метки"), "");
});

test("начальное помещение сужает список ровно так же, как выбранное руками", () => {
  const box = pickerHouse();
  const roomId = markControlsInitialRoom(box.project, box.marks.switchBedroom);
  // Открытое окно показывает то же, что показал бы выбор «Спальная» руками:
  // саму метку список исключает, светильник из холла — фильтр.
  const rows = markControlsCandidates(box.project, box.marks.switchBedroom, roomId);
  assert.deepEqual(rows.map((row) => row.mark.id), [box.marks.lampBedroom]);

  // Фильтр живой: «Все помещения» возвращают полный список, как до правки.
  const all = markControlsCandidates(box.project, box.marks.switchBedroom, "");
  assert.deepEqual(all.map((row) => row.mark.id), [box.marks.lampBedroom, box.marks.lampHall, box.marks.switchNowhere]);
});

// ——— поиск в окне ————————————————————————————————————————————————————
//
// В комнате с двумя десятками меток нужную ищут глазами — поэтому в окне есть
// строка поиска. Само окно по-прежнему тестами не покрыто: проверяется то, что
// вынесено чистыми функциями, — по чему ищем, как поиск живёт вместе с
// фильтром помещения и что отмеченное при сужении не теряется.
function searchHouse() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  const rooms = {};
  for (const name of ["Спальная", "Холл", "Кухня"]) {
    const added = addRoom(project, name);
    project = added.project;
    rooms[name] = added.room.id;
  }
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const ids = [];
  const put = (code, room, patch) => {
    const added = addMark(project, {
      schemeId,
      typeId: typeOf(code),
      kind: "point",
      points: [{ x: 0.1 + ids.length * 0.01, y: 0.5 }],
    });
    project = updateMark(added.project, added.mark.id, { roomId: rooms[room], ...(patch || {}) }).project;
    ids.push(added.mark.id);
    return added.mark.id;
  };
  // Два десятка меток в трёх помещениях — та самая комната, где глазами уже
  // не ищут.
  const marks = { switchBedroom: put("В", "Спальная") };
  for (let index = 0; index < 6; index += 1) marks["lamp" + index] = put("Т", "Спальная");
  marks.lampDesk = put("Т", "Спальная", { location: "над столом", original: "L-12" });
  for (let index = 0; index < 2; index += 1) marks["socketBedroom" + index] = put("Р", "Спальная");
  marks.switchHall = put("В", "Холл");
  for (let index = 0; index < 4; index += 1) marks["lampHall" + index] = put("Т", "Холл");
  marks.socketHall = put("Р", "Холл");
  marks.switchKitchen = put("В", "Кухня");
  for (let index = 0; index < 4; index += 1) marks["lampKitchen" + index] = put("Т", "Кухня");
  for (let index = 0; index < 2; index += 1) marks["socketKitchen" + index] = put("Р", "Кухня");
  const label = (id) => labelOf(project, id);
  return { project, marks, rooms, label, count: ids.length };
}

// Что показывает окно при таком запросе и таком помещении.
function shown(box, options) {
  return markControlsView(box.project, { exclude: box.marks.switchBedroom, ...options }).rows.map((row) =>
    box.label(row.mark.id),
  );
}

test("поиск ищет по обозначению метки", () => {
  const box = searchHouse();
  assert.deepEqual(shown(box, { query: "Т1" }), ["Т1", "Т10", "Т11", "Т12", "Т13", "Т14", "Т15"]);
  assert.deepEqual(shown(box, { query: "Р3" }), ["Р3"]);
});

test("поиск ищет по коду и по названию типа — «светильник» находит светильники", () => {
  const box = searchHouse();
  const lamps = shown(box, { query: "светильник" });
  assert.equal(lamps.length, 15, "пятнадцать светильников на трёх комнатах");
  assert.ok(lamps.every((label) => label.startsWith("Т")));
  // Код набирают вместо названия: «В» — это выключатели, и ничего сверх них.
  // Середину слова поиск не ловит намеренно — иначе одна буква «В» поднимала
  // бы весь свет: «с-в-етильник».
  assert.deepEqual(shown(box, { query: "В" }), ["В2", "В3"]);
});

test("поиск ищет по расположению словами и по обозначению из оригинала", () => {
  const box = searchHouse();
  assert.deepEqual(shown(box, { query: "над столом" }), [box.label(box.marks.lampDesk)]);
  assert.deepEqual(shown(box, { query: "l-12" }), [box.label(box.marks.lampDesk)]);
  // Регистр не важен, пробелы по краям запроса — тоже.
  assert.deepEqual(shown(box, { query: "  НАД СТОЛОМ  " }), [box.label(box.marks.lampDesk)]);
});

test("по помещению поиск намеренно не ищет — у помещения свой фильтр рядом", () => {
  const box = searchHouse();
  // Иначе два способа сузить по комнате дрались бы: «Кухня» в поиске при
  // фильтре «Спальная» не нашла бы ничего, и объяснить это было бы нечем.
  assert.deepEqual(shown(box, { query: "Кухня" }), []);
  assert.equal(shown(box, { roomId: box.rooms["Кухня"] }).length, 7);
});

test("пустой запрос ничего не сужает — окно открывается как раньше", () => {
  const box = searchHouse();
  const all = markControlsCandidates(box.project, box.marks.switchBedroom, "");
  assert.deepEqual(shown(box, { query: "" }), all.map((row) => box.label(row.mark.id)));
  assert.deepEqual(shown(box, { query: "   " }), all.map((row) => box.label(row.mark.id)));
  assert.equal(all.length, box.count - 1, "сама метка в кандидаты не входит");
});

test("поиск и фильтр помещения сужают вместе, а не отменяют друг друга", () => {
  const box = searchHouse();
  // Порядок остаётся порядком списка сбоку: поиск не перетасовывает строки,
  // иначе галочки прыгали бы под курсором от каждой буквы.
  assert.deepEqual(shown(box, { roomId: box.rooms["Спальная"], query: "светильник" }), [
    "Т1",
    "Т2",
    "Т3",
    "Т4",
    "Т5",
    "Т6",
    "Т7",
  ]);
  assert.deepEqual(shown(box, { roomId: box.rooms["Холл"], query: "светильник" }), ["Т8", "Т9", "Т10", "Т11"]);
  assert.deepEqual(shown(box, { roomId: box.rooms["Холл"], query: "Т1" }), ["Т10", "Т11"]);
});

test("в этом помещении пусто, а в других есть — окну есть что сказать", () => {
  const box = searchHouse();
  // Молча пустой список заставлял бы гадать, кто виноват — поиск или фильтр.
  const view = markControlsView(box.project, {
    exclude: box.marks.switchBedroom,
    roomId: box.rooms["Спальная"],
    query: "Т9",
  });
  assert.deepEqual(view.rows, []);
  assert.equal(view.elsewhere, 1, "в других помещениях Т9 есть — окно предложит снять фильтр");
});

test("не нашлось нигде — предлагать снять фильтр незачем", () => {
  const box = searchHouse();
  const view = markControlsView(box.project, {
    exclude: box.marks.switchBedroom,
    roomId: box.rooms["Спальная"],
    query: "провод",
  });
  assert.deepEqual(view.rows, []);
  assert.equal(view.elsewhere, 0);
});

test("без фильтра помещения снимать нечего: elsewhere остаётся нулём", () => {
  const box = searchHouse();
  const view = markControlsView(box.project, { exclude: box.marks.switchBedroom, roomId: "", query: "провод" });
  assert.deepEqual(view.rows, []);
  assert.equal(view.elsewhere, 0);
});

test("отмеченное не теряется при сужении: счётчик знает, сколько скрыто", () => {
  const box = searchHouse();
  const chosen = [box.marks.lamp0, box.marks.lampHall0, box.marks.lampKitchen0];
  // В помещении видна одна из трёх отмеченных — две другие не пропали, а
  // скрыты, и счётчик обязан сказать об этом.
  const room = markControlsView(box.project, {
    exclude: box.marks.switchBedroom,
    roomId: box.rooms["Спальная"],
    chosen,
  });
  assert.ok(room.rows.some((row) => row.mark.id === box.marks.lamp0));
  assert.equal(room.hidden, 2);
  // Поиск сужает сильнее — скрытыми становятся все три.
  const query = markControlsView(box.project, { exclude: box.marks.switchBedroom, query: "Р", chosen });
  assert.equal(query.hidden, 3);
  // Сужение снято — скрытых нет, отмеченные все на месте.
  const back = markControlsView(box.project, { exclude: box.marks.switchBedroom, chosen });
  assert.equal(back.hidden, 0);
});

test("счётчик скрытых не двоится от повторов и не считает ничего лишнего", () => {
  const box = searchHouse();
  const rows = markControlsCandidates(box.project, box.marks.switchBedroom, box.rooms["Спальная"]);
  assert.equal(markControlsHiddenCount(rows, [box.marks.lampHall0, box.marks.lampHall0]), 1);
  assert.equal(markControlsHiddenCount(rows, []), 0);
  assert.equal(markControlsHiddenCount([], [box.marks.lamp0]), 1);
});

test("строка подходит под запрос по любому из своих полей", () => {
  const box = searchHouse();
  const rows = markControlsCandidates(box.project, box.marks.switchBedroom, "");
  const desk = rows.find((row) => row.mark.id === box.marks.lampDesk);
  assert.ok(markControlsMatches(desk, "т7"));
  assert.ok(markControlsMatches(desk, "точечный"));
  assert.ok(markControlsMatches(desk, "столом"));
  assert.ok(markControlsMatches(desk, "L-12"));
  // Цифры из обозначения оригинала ловятся за дефисом: дефис — граница слова.
  assert.ok(markControlsMatches(desk, "12"));
  assert.ok(!markControlsMatches(desk, "розетка"));
  // Середина слова не ловится намеренно: «в» не должно поднимать светильники.
  assert.ok(!markControlsMatches(desk, "тильник"));
  // Пустой запрос подходит всему: поиск сужает список, а не заменяет его.
  assert.ok(markControlsMatches(desk, ""));
  assert.ok(markControlsMatches(desk, null));
});
