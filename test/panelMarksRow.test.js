// Строка списка меток: свёрнутая и раскрытая.
//
// Заказчик просил свернуть метку в одну строку — значок и обозначение — и
// раскрывать её нажатием. Что именно показывает строка, решает чистая функция,
// а не разметка: «в модели полей нет» означает «в строке их не будет», и это
// проверяется без браузера.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addRoom,
  addScheme,
  createProject,
  setMarkControls,
  setMarkNumber,
  updateMark,
} from "../src/model.js";
import { filtersMarkRows } from "../src/panels/filters.js";
import { marksControllerIndex, marksRowModel } from "../src/panels/marks.js";

function flat() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const room = addRoom(project, "Прихожая");
  project = room.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x) => {
    const result = addMark(project, { schemeId: scheme.scheme.id, typeId: typeOf(code), kind: "point", points: [{ x, y: 0.5 }] });
    project = result.project;
    return result.mark.id;
  };
  const switchOne = put("В", 0.1);
  const lampOne = put("Т", 0.2);
  const lampTwo = put("Т", 0.3);
  project = updateMark(project, lampOne, {
    roomId: room.room.id,
    roomManual: true,
    location: "над тумбой слева",
    original: "В31",
  }).project;
  project = setMarkControls(project, switchOne, [lampOne, lampTwo]).project;
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId: scheme.scheme.id,
    roomId: room.room.id,
    switchOne,
    lampOne,
    lampTwo,
  };
}

const rowOf = (box, markId) =>
  filtersMarkRows(box.project, box.schemeId, null).find((row) => row.mark.id === markId);

test("свёрнутая строка несёт значок и обозначение — и ничего больше", () => {
  const box = flat();
  const view = marksRowModel(box.project, rowOf(box, box.lampOne), { open: false });
  assert.equal(view.open, false);
  assert.equal(view.label, "Т1");
  assert.ok(view.style.shape && view.style.color, "значок рисуется формой и цветом категории");
  // Ни помещения, ни расположения, ни связей: строка свёрнута.
  assert.equal(view.fields, null);
  assert.equal(view.repeat, 0);
});

test("выделенная метка раскрыта: помещение, расположение, оригинал, номер и связи", () => {
  const box = flat();
  const controllers = marksControllerIndex(box.project);
  const lamp = marksRowModel(box.project, rowOf(box, box.lampOne), { open: true, controllers });
  assert.deepEqual(lamp.fields, {
    number: 1,
    roomId: box.roomId,
    roomManual: true,
    location: "над тумбой слева",
    original: "В31",
    controls: [],
    controlledBy: ["В1"],
  });
  const switchRow = marksRowModel(box.project, rowOf(box, box.switchOne), { open: true, controllers });
  assert.deepEqual(switchRow.fields.controls, ["Т1", "Т2"]);
  assert.deepEqual(switchRow.fields.controlledBy, []);
  assert.equal(switchRow.label, "В1");
});

test("повтор номера виден и в свёрнутой строке: три «Т1» подряд иначе выглядят ошибкой", () => {
  const box = flat();
  box.project = setMarkNumber(box.project, box.lampTwo, 1).project;
  const view = marksRowModel(box.project, rowOf(box, box.lampTwo), { open: false, repeat: 2 });
  assert.equal(view.label, "Т1");
  assert.equal(view.repeat, 2);
  // Одиночный номер отметки не получает.
  assert.equal(marksRowModel(box.project, rowOf(box, box.switchOne), { open: false, repeat: 1 }).repeat, 0);
});

test("обратная сторона связи собирается одним проходом по объекту", () => {
  const box = flat();
  const index = marksControllerIndex(box.project);
  assert.deepEqual(index.get(box.lampOne), ["В1"]);
  assert.deepEqual(index.get(box.lampTwo), ["В1"]);
  assert.equal(index.has(box.switchOne), false);
  assert.deepEqual(marksControllerIndex(null).size, 0);
});
