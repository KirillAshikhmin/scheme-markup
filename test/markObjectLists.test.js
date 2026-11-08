// Пара «метка + вещь» в списках и выгрузках (таск 02, R06): одна строка на
// прибор, а вещь без метки строки не даёт — как и до связи.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addSchemeObject,
  createProject,
  listedMarks,
  setMarkObject,
  setPlanOrigin,
  setPlanScale,
} from "../src/model.js";
import { marksTable, tableRowCount, toCsv } from "../src/tables.js";

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
