// Смыкание номеров идёт помещениями (G141).
//
// Слова заказчика: «„Сомкнуть номера“ — сделай что бы метки расположенные
// подряд были в одном помещении. То есть не просто рандомно по объекту, а то
// сперва по одному помещению, потом по другому, и все метки так в одном
// порядке».
//
// Проверяется не «функция что-то переставила», а четыре обещания:
//
// 1. **Порядок — помещениями, и порядок помещений его, а не наш**: список
//    помещений объекта, который пользователь сам и переставляет.
// 2. **Внутри помещения ничего не переставляется**: смыкание про дыры в
//    нумерации, а не про маршрут по комнате.
// 3. **Намеренный повтор номера переживает смыкание** — правило старше этой
//    задачи (G25, G96): новый номер выдаётся не метке, а старому номеру.
// 4. **Лист остаётся сплошным**: схема — старший ключ, и ряд номеров на одном
//    листе не рвётся из-за комнаты с соседнего этажа.
import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptProblem,
  acceptedProblems,
  addMark,
  addRoom,
  addScheme,
  compactAllNumbers,
  compactNumbers,
  createProject,
  deleteMark,
  deleteRoom,
  findMark,
  labelOf,
  marksInRoomOrder,
  problemAccepted,
  setMarkNumber,
  updateMark,
  validate,
} from "../src/model.js";
import { typesCompactPreview } from "../src/panels/types.js";

// Две комнаты и коридор, метки поставлены вперемешку — ровно то, на что
// жалуется заказчик: по объекту он ходит не комната за комнатой.
function flat() {
  let project = createProject({ name: "Квартира" });
  const rooms = {};
  for (const name of ["Спальная", "Коридор", "Кухня"]) {
    const added = addRoom(project, { name });
    project = added.project;
    rooms[name] = added.room.id;
  }
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  // `at` — доля плана: по ней видно, что порядок постановки и порядок на плане
  // разные, и смыкание идёт по первому.
  const put = (code, room, at = 0.5) => {
    const step = addMark(project, { schemeId, typeId: typeOf(code), kind: "point", points: [{ x: at, y: 0.5 }] });
    project = room ? updateMark(step.project, step.mark.id, { roomId: rooms[room] }).project : step.project;
    return step.mark.id;
  };
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    rooms,
    schemeId,
    typeOf,
    put,
  };
}

const labels = (project, ids) => ids.map((id) => labelOf(project, id));

test("после смыкания номера идут помещениями, в порядке списка помещений", () => {
  const box = flat();
  const first = box.put("Т", "Спальная");
  const second = box.put("Т", "Кухня");
  const third = box.put("Т", "Спальная");
  const fourth = box.put("Т", "Коридор");
  // До смыкания — порядок постановки: спальня, кухня, спальня, коридор.
  assert.deepEqual(labels(box.project, [first, second, third, fourth]), ["Т1", "Т2", "Т3", "Т4"]);

  const after = compactNumbers(box.project, box.typeOf("Т")).project;
  // Список помещений: Спальная, Коридор, Кухня — и номера идут по нему.
  assert.deepEqual(labels(after, [first, third, fourth, second]), ["Т1", "Т2", "Т3", "Т4"]);
  assert.deepEqual(labels(after, [second]), ["Т4"], "кухня стоит в списке последней — и номер у неё последний");
});

test("порядок помещений — их порядок в объекте: переставили список, переставился ряд", () => {
  const box = flat();
  const bedroom = box.put("Т", "Спальная");
  const kitchen = box.put("Т", "Кухня");

  const asIs = compactNumbers(box.project, box.typeOf("Т")).project;
  assert.deepEqual(labels(asIs, [bedroom, kitchen]), ["Т1", "Т2"]);

  // Пользователь переставил помещения — кухня стала первой.
  const moved = { ...box.project, rooms: [...box.project.rooms].reverse() };
  const after = compactNumbers(moved, box.typeOf("Т")).project;
  assert.deepEqual(labels(after, [kitchen, bedroom]), ["Т1", "Т2"], "ряд не пошёл за новым порядком помещений");
});

test("внутри помещения порядок постановки не трогается — ни по алфавиту, ни по плану", () => {
  const box = flat();
  // Поставлены справа налево: по положению на плане порядок был бы обратным.
  const right = box.put("Т", "Спальная", 0.9);
  const middle = box.put("Т", "Спальная", 0.5);
  const left = box.put("Т", "Спальная", 0.1);

  const after = compactNumbers(box.project, box.typeOf("Т")).project;
  assert.deepEqual(
    labels(after, [right, middle, left]),
    ["Т1", "Т2", "Т3"],
    "смыкание переложило метки внутри комнаты — оно про дыры, а не про маршрут",
  );
});

test("метка без помещения уходит в конец, и метка с удалённым помещением — туда же", () => {
  const box = flat();
  const nowhere = box.put("Т", null);
  const bedroom = box.put("Т", "Спальная");
  const kitchen = box.put("Т", "Кухня");

  const after = compactNumbers(box.project, box.typeOf("Т")).project;
  assert.deepEqual(labels(after, [bedroom, kitchen, nowhere]), ["Т1", "Т2", "Т3"]);

  // Помещение удалили — у метки осталась ссылка в никуда. Это «без помещения»,
  // а не начало списка: номера комнат не должны ехать из-за недоделки.
  const gone = deleteRoom(box.project, box.rooms["Спальная"]).project;
  const orphan = { ...gone, marks: gone.marks.map((mark) => (mark.id === bedroom ? { ...mark, roomId: "нет-такой" } : mark)) };
  const tail = compactNumbers(orphan, box.typeOf("Т")).project;
  // Внутри хвоста решает порядок постановки, как и внутри комнаты: метка без
  // помещения поставлена первой, метка с потерянным помещением — второй.
  assert.deepEqual(labels(tail, [kitchen, nowhere, bedroom]), ["Т1", "Т2", "Т3"]);
});

test("намеренный повтор номера переживает смыкание и при новом порядке", () => {
  const box = flat();
  const bedroom = box.put("Т", "Спальная");
  const kitchenOne = box.put("Т", "Кухня");
  const kitchenTwo = box.put("Т", "Кухня");
  const kitchenThree = box.put("Т", "Кухня");
  // Три светильника кухни — одна группа под одним номером, приём заказчика.
  let project = setMarkNumber(box.project, kitchenTwo, 2).project;
  project = setMarkNumber(project, kitchenThree, 2).project;
  project = deleteMark(project, bedroom).project; // дыра: Т2 Т2 Т2 без Т1

  const result = compactNumbers(project, box.typeOf("Т"));
  const after = result.project;
  assert.deepEqual(
    labels(after, [kitchenOne, kitchenTwo, kitchenThree]),
    ["Т1", "Т1", "Т1"],
    "группа под одним номером распалась на три номера",
  );
  assert.equal(after.counters["Т"], 1, "счётчик считает номера, а не метки");
});

test("повтор номера в двух комнатах остаётся одним номером — тождество старше группировки", () => {
  const box = flat();
  const bedroom = box.put("Т", "Спальная");
  const corridor = box.put("Т", "Коридор");
  const kitchen = box.put("Т", "Кухня");
  // Один и тот же светильник размечен в двух комнатах под общим номером:
  // так бывает у сквозной ленты и у группы на границе комнат.
  let project = setMarkNumber(box.project, kitchen, 1).project;

  const after = compactNumbers(project, box.typeOf("Т")).project;
  assert.deepEqual(labels(after, [bedroom, kitchen]), ["Т1", "Т1"], "общий номер разъехался");
  assert.deepEqual(labels(after, [corridor]), ["Т2"]);
});

test("принятые предупреждения переезжают на новые номера", () => {
  const box = flat();
  const bedroom = box.put("Т", "Спальная");
  const kitchenOne = box.put("Т", "Кухня");
  const kitchenTwo = box.put("Т", "Кухня");
  let project = setMarkNumber(box.project, kitchenTwo, 2).project; // кухня: Т2 Т2
  project = deleteMark(project, bedroom).project; // дыра перед ними

  const repeat = validate(project).find((item) => item.code === "repeatedNumber");
  assert.ok(repeat, "повтор номера не найден — тест проверял бы пустоту");
  project = acceptProblem(project, repeat).project;

  const after = compactNumbers(project, box.typeOf("Т")).project;
  assert.deepEqual(labels(after, [kitchenOne, kitchenTwo]), ["Т1", "Т1"]);
  const fresh = validate(after).find((item) => item.code === "repeatedNumber");
  assert.equal(problemAccepted(after, fresh.key), true, "принятое не переехало на новый номер");
  assert.equal(problemAccepted(after, repeat.key), false, "старый ключ остался висеть");
  // Кроме этой записи в объекте лежат принятые строки справочника — их новый
  // объект получает при создании, чтобы встречать тишиной. Смыкание номеров их
  // не касается: считаем только повторы номера.
  assert.deepEqual(
    acceptedProblems(after).filter((record) => record.code === "repeatedNumber").length,
    1,
  );
});

test("предпросмотр совпадает с результатом, а оба пути смыкания дают одно и то же", () => {
  const box = flat();
  const kitchen = box.put("Т", "Кухня");
  const bedroom = box.put("Т", "Спальная");
  const corridor = box.put("Т", "Коридор");
  const socket = box.put("Р", "Кухня");
  box.project = deleteMark(box.project, corridor).project;

  const preview = typesCompactPreview(box.project, box.typeOf("Т"));
  const single = compactNumbers(box.project, box.typeOf("Т"));
  // Предпросмотр собран из ответа модели — значит и порядок в нём тот же.
  assert.deepEqual(
    preview.rows.map((row) => [row.fromLabel, row.toLabel]),
    single.changes.map((change) => [change.fromLabel, change.toLabel]),
  );
  assert.deepEqual(labels(single.project, [bedroom, kitchen]), ["Т1", "Т2"]);

  const all = compactAllNumbers(box.project);
  for (const id of [bedroom, kitchen, socket]) {
    assert.equal(
      findMark(all.project, id).number,
      findMark(single.project, id).number === undefined ? null : findMark(single.project, id).number,
      "смыкание всех типов разошлось со смыканием одного",
    );
  }
  assert.deepEqual(labels(all.project, [bedroom, kitchen, socket]), ["Т1", "Т2", "Р1"]);
});

test("несколько схем: ряд на каждом листе сплошной, схема — старший ключ", () => {
  const box = flat();
  const second = addScheme(box.project, { name: "2 этаж", width: 1000, height: 800 });
  box.project = second.project;
  const upstairs = second.scheme.id;

  const firstFloor = box.put("Т", "Кухня");
  const bedroom = box.put("Т", "Спальная");
  // Спальная размечена и на втором этаже: помещение в модели принадлежит
  // объекту, а не листу.
  const upstairsStep = addMark(box.project, {
    schemeId: upstairs,
    typeId: box.typeOf("Т"),
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  box.project = updateMark(upstairsStep.project, upstairsStep.mark.id, { roomId: box.rooms["Спальная"] }).project;

  const after = compactNumbers(box.project, box.typeOf("Т")).project;
  // Первый лист: спальная (в списке первая), потом кухня — и ряд сплошной.
  assert.deepEqual(labels(after, [bedroom, firstFloor, upstairsStep.mark.id]), ["Т1", "Т2", "Т3"]);
  // То же самое словами: второй этаж начинается там, где кончился первый, а не
  // втискивается в спальную первого.
  assert.deepEqual(
    marksInRoomOrder(after, (mark) => mark.typeId === box.typeOf("Т")).map((mark) => mark.schemeId),
    [box.schemeId, box.schemeId, upstairs],
  );
});
