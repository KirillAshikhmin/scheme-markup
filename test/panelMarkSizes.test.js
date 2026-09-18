// Окно размеров метки: подписи полей, разбор введённого и подпись кнопки.
//
// Проверяется чистая часть — то, по чему видно, заданы ли у метки размеры,
// не открывая окна, и то, что окно примет, а что отвергнет. Сам диалог, как и
// остальные, живой приёмкой.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MARK_DIMENSION_FIELDS,
  MARK_DIMENSION_MAX,
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
  assert.equal(markSizesSummary(markWith({ length: 600, width: 400, heightAboveFloor: 900 })), "Д 600 · Ш 400 · В 900 мм");
  // Заданные показываются, пустые пропускаются — а не встают прочерком.
  assert.equal(markSizesSummary(markWith({ heightAboveFloor: 300 })), "В 300 мм");
  assert.equal(markSizesSummary(markWith({ length: 1500, heightAboveFloor: 0 })), "Д 1500 · В 0 мм");
  // Дробное в подписи — через запятую, как его и набирают.
  assert.equal(markSizesSummary(markWith({ width: 1.5 })), "Ш 1,5 мм");
  // Метки нет вовсе (окно открыли, а метку успели удалить) — пустая строка.
  assert.equal(markSizesSummary(null), "");
});

test("окно разбирает поля по правилам модели: пусто — не задано, ноль — значение", () => {
  const empty = markSizesParse({ length: "", width: "   ", heightAboveFloor: "" });
  assert.deepEqual(empty.values, { length: null, width: null, heightAboveFloor: null });
  assert.deepEqual(empty.invalid, []);

  const filled = markSizesParse({ length: "600", width: "1,5", heightAboveFloor: "0" });
  assert.deepEqual(filled.values, { length: 600, width: 1.5, heightAboveFloor: 0 });
  assert.deepEqual(filled.invalid, []);

  // Поля, которого в форме нет, — то же «не задано», а не поломка.
  assert.deepEqual(markSizesParse({}).values, { length: null, width: null, heightAboveFloor: null });
  assert.deepEqual(markSizesParse(null).values, { length: null, width: null, heightAboveFloor: null });
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
