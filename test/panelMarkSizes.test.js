// Окно размеров метки: подписи полей, разбор введённого и подпись кнопки.
//
// Проверяется чистая часть — то, по чему видно, заданы ли у метки размеры,
// не открывая окна, и то, что окно примет, а что отвергнет. Сам диалог, как и
// остальные, живой приёмкой.
import test from "node:test";
import assert from "node:assert/strict";

import {
  fillTypeSizes,
  MARK_DIMENSION_FIELDS,
  MARK_DIMENSION_MAX,
  MARK_DIMENSION_SIGNED,
  MARK_DIMENSION_UNIT,
  addMark,
  addScheme,
  createProject,
  findMark,
  setMarkDimensions,
} from "../src/model.js";
import { strings } from "../src/strings.js";
import { markSizesLabel, markSizesParse, markSizesSummary } from "../src/panels/markSizes.js";

function markWith(values) {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const added = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.3, y: 0.3 }],
  });
  project = values ? setMarkDimensions(added.project, added.mark.id, values).project : added.project;
  return findMark(project, added.mark.id);
}

test("единица видна в каждой подписи и написана в словаре один раз", () => {
  // Единица в модели и единица на экране — одна и та же мера, объявленная в
  // двух местах: `MARK_DIMENSION_UNIT` говорит, что лежит в поле, строка
  // словаря — как это называется по-русски.
  assert.equal(MARK_DIMENSION_UNIT, "mm");
  assert.equal(strings.markSizes.unit, "мм");

  for (const field of MARK_DIMENSION_FIELDS) {
    const label = markSizesLabel(field);
    assert.ok(label.endsWith(strings.markSizes.unit), "в подписи не видно единицы: " + label);
    assert.ok(!label.includes("{"), "подстановка не сработала: " + label);
  }
  assert.equal(markSizesLabel("heightAboveFloor"), "Высота над полом, мм");

  // В самих строках словаря единица не написана словом — только подстановкой:
  // иначе смена меры стоила бы не одну правку.
  for (const field of MARK_DIMENSION_FIELDS) {
    assert.ok(strings.markSizes[field].includes("{unit}"), "единица вписана в подпись руками: " + field);
  }
});

test("подпись кнопки показывает заданные размеры и молчит о незаданных", () => {
  assert.equal(markSizesSummary(markWith(null)), "");
  // Габарит пишется как на чертеже — Д · Ш · В, — и посадка идёт за ним. У
  // высоты над полом буквы нет: «В» с таска 158 занято высотой вещи, и два
  // разных числа под одной буквой в одной строке читались бы как одно.
  assert.equal(
    markSizesSummary(markWith({ length: 900, depth: 200, width: 300, heightAboveFloor: 2300 })),
    "Д 900 · Ш 200 · В 300 · от пола 2300 мм",
  );
  // Заданные показываются, пустые пропускаются — а не встают прочерком.
  assert.equal(markSizesSummary(markWith({ heightAboveFloor: 300 })), "от пола 300 мм");
  assert.equal(markSizesSummary(markWith({ length: 1500, heightAboveFloor: 0 })), "Д 1500 · от пола 0 мм");
  // Вертикальная лента заказчика: «надо указать высоту от пола до потолка».
  assert.equal(markSizesSummary(markWith({ length: 40, width: 2700 })), "Д 40 · В 2700 мм");
  // Утопленное — минус у ширины: щит в нише уходит за плоскость стены.
  assert.equal(markSizesSummary(markWith({ depth: -30 })), "Ш -30 мм");
  // Дробное в подписи — через запятую, как его и набирают.
  assert.equal(markSizesSummary(markWith({ width: 1.5 })), "В 1,5 мм");
  // Метки нет вовсе (окно открыли, а метку успели удалить) — пустая строка.
  assert.equal(markSizesSummary(null), "");
});

// ——— имена осей (таск 158, требование G233) ——————————————————————————————
//
// Слова заказчика: «у меток ещё должна быть характеристика Высота. И в
// интерфейсе сделай 3 поля рядом : Длина, Ширина, Высота». Высота в объекте
// лежала с самого начала — звалась «Шириной», а ширина звалась «Выступом от
// стены». Тест держит подписи: разойдись они с осями снова, и чертёж прочтут
// неверно, а заметят это на монтаже.
test("подписи полей названы по осям, а тройка габаритов стоит перед посадкой", () => {
  assert.deepEqual(MARK_DIMENSION_FIELDS, ["length", "depth", "width", "heightAboveFloor"]);
  assert.equal(markSizesLabel("length"), "Длина, мм");
  assert.equal(markSizesLabel("depth"), "Ширина, мм");
  assert.equal(markSizesLabel("width"), "Высота, мм");
  assert.equal(markSizesLabel("heightAboveFloor"), "Высота над полом, мм");
  // Высота над полом — не габарит, и в тройку не входит: окно ставит её своей
  // строкой под ней.
  assert.deepEqual(MARK_DIMENSION_FIELDS.slice(0, 3), ["length", "depth", "width"]);
  // Минус бывает только у ширины: утопленное — та же ось в другую сторону.
  assert.deepEqual(MARK_DIMENSION_SIGNED, ["depth"]);
  assert.equal(markSizesParse({ depth: "-30" }).values.depth, -30);
  assert.deepEqual(markSizesParse({ width: "-30" }).invalid.map((item) => item.field), ["width"]);
});

test("окно разбирает поля по правилам модели: пусто — не задано, ноль — значение", () => {
  const empty = markSizesParse({ length: "", width: "   ", heightAboveFloor: "" });
  assert.deepEqual(empty.values, { length: null, width: null, depth: null, heightAboveFloor: null });
  assert.deepEqual(empty.invalid, []);

  const filled = markSizesParse({ length: "600", width: "1,5", heightAboveFloor: "0" });
  assert.deepEqual(filled.values, { length: 600, width: 1.5, depth: null, heightAboveFloor: 0 });
  assert.deepEqual(filled.invalid, []);

  // Поля, которого в форме нет, — то же «не задано», а не поломка.
  assert.deepEqual(markSizesParse({}).values, { length: null, width: null, depth: null, heightAboveFloor: null });
  assert.deepEqual(markSizesParse(null).values, { length: null, width: null, depth: null, heightAboveFloor: null });
});

test("негодное поле называет себя и не закрывает окно молча", () => {
  const bad = markSizesParse({ length: "-1", width: "абв", heightAboveFloor: String(MARK_DIMENSION_MAX + 1) });
  assert.deepEqual(bad.invalid.map((item) => item.field), ["length", "width", "heightAboveFloor"]);
  for (const item of bad.invalid) {
    assert.ok(item.message.length > 0, "негодное поле без объяснения: " + item.field);
    assert.ok(!item.message.includes("{"), "подстановка не сработала: " + item.message);
  }
  // Годное поле рядом с негодным не теряется: окно вернёт его в поле ввода.
  const mixed = markSizesParse({ length: "600", width: "-2", heightAboveFloor: "" });
  assert.equal(mixed.values.length, 600);
  assert.deepEqual(mixed.invalid.map((item) => item.field), ["width"]);
});

// ——— умолчания доходят до справочника, заведённого раньше них ———————————
//
// Дефект D28: у заказчика сорок девять своих типов и ни у одного нет размеров,
// потому что умолчания (таск 139) прописаны в шаблоне и достаются только
// новому объекту. Наследование при этом исправно — наследовать нечего.
test("тип без размеров получает их по коду, а незнакомый остаётся пустым", () => {
  const project = {
    markTypes: [
      { id: "a", code: "Р", name: "Розетка" },
      { id: "b", code: "ЧЕГОНЕТ", name: "Своё" },
      { id: "c", code: "В", name: "Выключатель", sizes: { length: 55 } },
    ],
    marks: [{ id: "m", typeId: "a", points: [{ x: 0.1, y: 0.1 }] }],
  };
  const { project: filled, changed, filled: count } = fillTypeSizes(project);
  assert.equal(changed, true);
  assert.equal(count, 1, "проставить надо ровно тому, у кого пусто");

  const socket = filled.markTypes[0];
  assert.ok(socket.sizes && socket.sizes.length > 0, "розетка обязана получить размеры по коду");

  assert.equal(filled.markTypes[1].sizes, undefined, "незнакомому коду размер не выдумывается");
  assert.deepEqual(filled.markTypes[2].sizes, { length: 55 }, "свой размер не перебивается шаблонным");
  assert.deepEqual(filled.marks, project.marks, "метки не трогаются вовсе");
});

test("повторный проход ничего не меняет — миграция идемпотентна", () => {
  const once = fillTypeSizes({ markTypes: [{ id: "a", code: "Р", name: "Розетка" }], marks: [] });
  const twice = fillTypeSizes(once.project);
  assert.equal(twice.changed, false);
  assert.equal(twice.project, once.project, "второй проход обязан вернуть тот же объект");
});
