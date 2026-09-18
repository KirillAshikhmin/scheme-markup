// Окно выбора меток открывается «для метки», и помещение этой метки — то, с
// которым фильтр должен стоять при открытии. Слова заказчика: «при открытии
// окна Чем управляет у метки — сразу фильтруй по метке комнаты, для которой
// выбираем». Само окно — DOM и тестами не покрыто намеренно; проверяется
// чистый кусок, который отвечает на вопрос «с какого помещения открывать».
import test from "node:test";
import assert from "node:assert/strict";
import { addMark, addRoom, addScheme, createProject, updateMark } from "../src/model.js";
import { markControlsCandidates, markControlsInitialRoom } from "../src/panels/markControls.js";

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
