// Пара «метка + вещь» в списках и выгрузках (таск 02, R06): одна строка на
// прибор, а вещь без метки строки не даёт — как и до связи.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addEquipment,
  addMark,
  addPlacement,
  addScheme,
  addSchemeObject,
  addWall,
  createProject,
  labelOf,
  listedMarks,
  markPairLabel,
  setMarkControls,
  setMarkNumber,
  setMarkObject,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  wallElevation,
} from "../src/model.js";
import { equipmentTable, linksTable, marksTable, tableRowCount, toCsv } from "../src/tables.js";
import { filtersMarkRows } from "../src/panels/filters.js";

function world() {
  const added = addScheme(createProject({ name: "Пара" }), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = added.project;
  project = setPlanScale(project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  const make = (atMm) => {
    const result = addSchemeObject(project, {
      schemeId,
      catalogKey: "tv",
      shape: "rect",
      atMm,
      widthMm: 1240,
      depthMm: 80,
      heightMm: 720,
      heightAboveFloorMm: 500,
    });
    project = result.project;
    return result.schemeObject;
  };
  const paired = make({ x: 2000, y: 200 });
  make({ x: 3000, y: 200 }); // вещь без метки
  const type = project.markTypes.find((item) => item.code === "ТВ");
  const mark = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [{ x: 0.1, y: 0.1 }] });
  return { project: mark.project, schemeId, paired, mark: mark.mark };
}

test("пара даёт одну строку таблицы, а вещь без метки — ни одной", () => {
  const base = world();
  const before = marksTable(base.project, {}, "category");
  assert.equal(tableRowCount(before), 1);

  const linked = setMarkObject(base.project, base.mark.id, base.paired.id);
  const after = marksTable(linked.project, {}, "category");
  assert.equal(tableRowCount(after), 1, "связь добавила строку вещи");
  assert.equal(listedMarks(linked.project.marks).length, 1);
});

test("таблица объекта без связей не меняется от того, что связь ставили и снимали", () => {
  const base = world();
  const linked = setMarkObject(base.project, base.mark.id, base.paired.id);
  const off = setMarkObject(linked.project, base.mark.id, null);
  assert.equal(toCsv(marksTable(off.project, {}, "category")), toCsv(marksTable(base.project, {}, "category")));
});

test("строка связанного прибора называет и вещь, несвязанного — только обозначение", () => {
  const base = world();
  const plain = toCsv(marksTable(base.project, {}, "category"));
  const linked = setMarkObject(base.project, base.mark.id, base.paired.id);
  const csv = toCsv(marksTable(linked.project, {}, "category"));
  assert.ok(csv.includes(" · "), "имя вещи не попало в строку: " + csv);
  assert.ok(!plain.includes(" · "));
});

// **Один прибор — одно имя.** Имя пары стояло в двух местах из шести, и на
// одном листе прибор звался то «ТВ1», то «ТВ1 · Телевизор»: сведённая строка
// таблицы меток, первая колонка листов «Связи» и «Оборудование», список меток
// сбоку и лист развёртки брали голое обозначение.
test("имя прибора одно во всех списках и на всех листах", () => {
  const base = world();
  const linked = setMarkObject(base.project, base.mark.id, base.paired.id).project;
  const pair = markPairLabel(linked, linked.marks.find((mark) => mark.id === base.mark.id));
  assert.match(pair, / · /, "пример не тот: имя пары не собралось");
  assert.notEqual(pair, labelOf(linked, base.mark.id));

  // 1. Сведённая строка: вторая метка того же типа под тем же номером.
  const typeId = linked.marks[0].typeId;
  const twin = addMark(linked, { schemeId: base.schemeId, typeId, kind: "point", points: [{ x: 0.2, y: 0.2 }] });
  const merged = setMarkNumber(twin.project, twin.mark.id, linked.marks[0].number).project;
  const mergedCsv = toCsv(marksTable(merged, {}, "category"));
  assert.equal(tableRowCount(marksTable(merged, {}, "category")), 1, "пример не тот: строки не свелись");
  assert.ok(mergedCsv.includes(pair), "сведённая строка зовёт прибор голым обозначением: " + mergedCsv);

  // 2. Лист «Связи»: первая колонка строки самого прибора.
  const switcher = addMark(linked, { schemeId: base.schemeId, typeId: linked.markTypes.find((type) => type.code === "В").id, kind: "point", points: [{ x: 0.4, y: 0.4 }] });
  const wired = setMarkControls(switcher.project, switcher.mark.id, [base.mark.id]).project;
  const linksCsv = toCsv(linksTable(wired, {}));
  assert.ok(linksCsv.includes(pair), "лист «Связи» зовёт прибор голым обозначением: " + linksCsv);

  // 3. Лист «Оборудование»: та же первая колонка.
  const gear = addEquipment(linked, { name: "Щит 1" });
  const placed = addPlacement(gear.project, { equipmentId: gear.equipment.id, markId: base.mark.id }).project;
  const gearCsv = toCsv(equipmentTable(placed, {}));
  assert.ok(gearCsv.includes(pair), "лист «Оборудование» зовёт прибор голым обозначением: " + gearCsv);

  // 4. Список меток сбоку.
  const rows = filtersMarkRows(linked, base.schemeId, {});
  const row = rows.find((item) => item.mark.id === base.mark.id);
  assert.equal(row.label, pair, "список меток зовёт прибор голым обозначением");

  // 5. Лист развёртки: метка привязана к стене, с которой лист и снимается.
  const wall = addWall(linked, { schemeId: base.schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 6000, y: 0 }, thicknessMm: 100 });
  const bound = setMarkWall(wall.project, base.mark.id, { wallId: wall.wall.id, atMm: 2000 }).project;
  const sheet = wallElevation(bound, wall.wall.id, "right");
  const shown = sheet.marks.find((item) => item.id === base.mark.id);
  assert.ok(shown, "метка не попала на развёртку");
  assert.equal(shown.label, pair, "развёртка зовёт прибор голым обозначением");
});
