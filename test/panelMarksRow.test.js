// Строка списка меток: свёрнутая и раскрытая.
//
// Заказчик просил свернуть метку в одну строку — значок и обозначение — и
// раскрывать её нажатием. Что именно показывает строка, решает чистая функция,
// а не разметка: «в модели полей нет» означает «в строке их не будет», и это
// проверяется без браузера.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addEquipment,
  addMark,
  addPlacement,
  addRoom,
  addScheme,
  createProject,
  setMarkControls,
  setMarkDimensions,
  setMarkNumber,
  updateMark,
} from "../src/model.js";
import { filtersMarkRows } from "../src/panels/filters.js";
import { marksControllerIndex, marksLabelList, marksRowModel } from "../src/panels/marks.js";

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
    equipment: 0,
    roomId: box.roomId,
    roomManual: true,
    location: "над тумбой слева",
    original: "В31",
    sizes: "",
    controls: [],
    // Тот же перечень строкой, сгруппированный по каналам: связей нет —
    // и строка пуста.
    controlsText: "",
    controlledBy: ["В1"],
  });
  const switchRow = marksRowModel(box.project, rowOf(box, box.switchOne), { open: true, controllers });
  assert.deepEqual(switchRow.fields.controls, ["Т1", "Т2"]);
  // Каналы не назначены — перечень читается ровно как читался до них.
  assert.equal(switchRow.fields.controlsText, "Т1, Т2");
  assert.deepEqual(switchRow.fields.controlledBy, []);
  assert.equal(switchRow.label, "В1");
});

test("раскрытая строка знает код и название типа: по значку тип угадывается не всегда", () => {
  const box = flat();
  const open = marksRowModel(box.project, rowOf(box, box.lampOne), { open: true });
  const shut = marksRowModel(box.project, rowOf(box, box.lampOne), { open: false });
  assert.equal(open.code, "Т");
  assert.equal(open.typeName, "Точечный светильник");
  // Код тот же, что в свёрнутой строке: на раскрытии он остаётся на месте, а
  // номер уходит в поле правки — вместе они дают прежнее обозначение «Т1».
  assert.equal(open.code, shut.code);
  assert.equal(shut.label, open.code + open.fields.number);
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

test("в раскрытой строке видно, сколько оборудования стоит на метке", () => {
  const box = flat();
  const model = addEquipment(box.project, { name: "Shelly 1PM" });
  box.project = model.project;
  box.project = addPlacement(box.project, {
    equipmentId: model.equipment.id,
    markId: box.lampOne,
    links: [box.switchOne],
  }).project;
  const view = marksRowModel(box.project, rowOf(box, box.lampOne), { open: true });
  assert.equal(view.fields.equipment, 1);
  // Связанная метка — не место: на выключателе ничего не стоит.
  assert.equal(marksRowModel(box.project, rowOf(box, box.switchOne), { open: true }).fields.equipment, 0);
});

// Размеры показываются в строке так же, как связи и оборудование у соседних
// кнопок: по ней видно, заданы они или нет, до всякого окна.
test("в раскрытой строке видно, заданы ли у метки размеры", () => {
  const box = flat();
  assert.equal(marksRowModel(box.project, rowOf(box, box.lampOne), { open: true }).fields.sizes, "");

  box.project = setMarkDimensions(box.project, box.lampOne, { length: 600, heightAboveFloor: 0 }).project;
  const view = marksRowModel(box.project, rowOf(box, box.lampOne), { open: true });
  assert.equal(view.fields.sizes, "Д 600 · В 0 мм");
  // Соседней метке чужие размеры не приписываются.
  assert.equal(marksRowModel(box.project, rowOf(box, box.lampTwo), { open: true }).fields.sizes, "");
  // В свёрнутой строке полей нет вовсе — размеры их не заводят.
  assert.equal(marksRowModel(box.project, rowOf(box, box.lampOne), { open: false }).fields, null);
});

// ——— перечень связей ——————————————————————————————————————————————————
//
// Заказчик вешает на один номер группу светильников, и перечень в строке
// свойств выглядел так: «Управляет: Т3, Т3, Т3, ППл1, ППл1, ППл2, ППл1…».
// Его слова: «если метки с одинаковым номером, то в интерфейсе указывай
// только 1 раз».
test("повторяющиеся обозначения в перечне связей названы один раз и с числом", () => {
  const box = flat();
  // Третий светильник — чтобы под номером «Т1» их стало три.
  const third = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: box.project.markTypes.find((type) => type.code === "Т").id,
    kind: "point",
    points: [{ x: 0.4, y: 0.5 }],
  });
  box.project = third.project;
  box.project = setMarkNumber(box.project, box.lampTwo, 1).project;
  box.project = setMarkNumber(box.project, third.mark.id, 1).project;
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampTwo, third.mark.id]).project;

  const view = marksRowModel(box.project, rowOf(box, box.switchOne), { open: true });
  assert.deepEqual(view.fields.controls, ["Т1 ×3"], "повторы в перечне не свернулись");

  // Разные номера остаются перечнем, одиночный номер числа не получает.
  box.project = setMarkNumber(box.project, third.mark.id, 5).project;
  assert.deepEqual(marksRowModel(box.project, rowOf(box, box.switchOne), { open: true }).fields.controls, [
    "Т1 ×2",
    "Т5",
  ]);
});

test("обратная сторона связи сворачивается так же: два проходных под одним номером", () => {
  const box = flat();
  const twin = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: box.project.markTypes.find((type) => type.code === "В").id,
    kind: "point",
    points: [{ x: 0.15, y: 0.5 }],
  });
  box.project = twin.project;
  // Проходные выключатели одной группы носят один номер — это приём заказчика.
  box.project = setMarkNumber(box.project, twin.mark.id, 1).project;
  box.project = setMarkControls(box.project, twin.mark.id, [box.lampOne]).project;

  const controllers = marksControllerIndex(box.project);
  const view = marksRowModel(box.project, rowOf(box, box.lampOne), { open: true, controllers });
  assert.deepEqual(view.fields.controlledBy, ["В1 ×2"]);
  // У метки без управляющих строка по-прежнему пуста.
  assert.deepEqual(
    marksRowModel(box.project, rowOf(box, box.switchOne), { open: true, controllers }).fields.controlledBy,
    [],
  );
});

test("перечень обозначений считается отдельно от строки: пустой список — пустой перечень", () => {
  assert.deepEqual(marksLabelList([]), []);
  assert.deepEqual(marksLabelList(null), []);
  assert.deepEqual(marksLabelList(["Р1", "Р2", "Р1", "Р1"]), ["Р1 ×3", "Р2"]);
});
