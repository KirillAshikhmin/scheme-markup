// Предпросмотр уплотнения: что и во что превратится. Команда разрушающая —
// после неё выданные распечатки врут, — поэтому пользователь смотрит замены
// до применения, а не узнаёт о них после.
//
// Шов чистый: предпросмотр собирается из ответа `compactNumbers`, своей
// нумерации у панели нет.
import test from "node:test";
import assert from "node:assert/strict";
import { addMark, addScheme, createProject, deleteMark, setMarkNumber } from "../src/model.js";
import { typesCompactPreview } from "../src/panels/types.js";

function compactFixture() {
  let project = createProject({ name: "Квартира" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = added.project;
  const schemeId = added.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    const step = addMark(project, {
      schemeId,
      typeId: typeOf("Т"),
      kind: "point",
      points: [{ x: 0.1 * (i + 1), y: 0.2 }],
    });
    project = step.project;
    ids.push(step.mark.id);
  }
  return { project, schemeId, typeOf, ids };
}

test("предпросмотр показывает замены обозначениями и сохраняет намеренный повтор", () => {
  const box = compactFixture();
  let project = setMarkNumber(box.project, box.ids[1], 1).project; // Т1 Т1 Т3 Т4
  project = deleteMark(project, box.ids[2]).project; // Т1 Т1 Т4

  const preview = typesCompactPreview(project, box.typeOf("Т"));
  assert.equal(preview.code, "Т");
  assert.deepEqual(
    preview.rows.map((row) => [row.fromLabel, row.toLabel, row.count]),
    [
      ["Т1", "Т1", 2],
      ["Т4", "Т2", 1],
    ],
  );
  // Меток меняет номер ровно одна — та, что была Т4.
  assert.equal(preview.changes.length, 1);
  assert.deepEqual(preview.changes.map((change) => [change.fromLabel, change.toLabel]), [["Т4", "Т2"]]);
});

test("уплотнять нечего: дыр нет — замен нет", () => {
  const box = compactFixture();
  const preview = typesCompactPreview(box.project, box.typeOf("Т"));
  assert.deepEqual(preview.changes, []);
  assert.deepEqual(
    preview.rows.map((row) => row.fromLabel + "→" + row.toLabel),
    ["Т1→Т1", "Т2→Т2", "Т3→Т3", "Т4→Т4"],
  );
});
