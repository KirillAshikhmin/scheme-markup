// Предпросмотр уплотнения: что и во что превратится. Команда разрушающая —
// после неё выданные распечатки врут, — поэтому пользователь смотрит замены
// до применения, а не узнаёт о них после.
//
// Шов чистый: предпросмотр собирается из ответа `compactNumbers`, своей
// нумерации у панели нет.
import test from "node:test";
import assert from "node:assert/strict";
import { addMark, addScheme, createProject, deleteMark, setMarkNumber, updateMark } from "../src/model.js";
import { typesCompactPreview, typesCompactSignature } from "../src/panels/types.js";
import { marksCompactPlan, marksCompactSignature, marksCompactTotals } from "../src/panels/marks.js";

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

// Пользователь подтверждает список, а применяется пересчёт по свежему объекту.
// Совпадают они или разошлись — решает подпись списка: по ней видно, что метку
// поставили или чужой Ctrl+Z вернул номера, пока окно висело открытым.
test("подпись списка замен ловит правку нумерации и не срабатывает на прочих", () => {
  const box = compactFixture();
  const project = deleteMark(box.project, box.ids[1]).project; // Т1 Т3 Т4
  const approved = typesCompactPreview(project, box.typeOf("Т"));

  // Пока окно открыто, поставили ещё одну метку — замены стали другими.
  const grown = addMark(project, {
    schemeId: box.schemeId,
    typeId: box.typeOf("Т"),
    kind: "point",
    points: [{ x: 0.7, y: 0.7 }],
  }).project;
  assert.notEqual(
    typesCompactSignature(typesCompactPreview(grown, box.typeOf("Т"))),
    typesCompactSignature(approved),
  );

  // Правка, не трогающая номера, списка не меняет — переспрашивать не о чем.
  const noted = updateMark(project, box.ids[0], { location: "у окна" }).project;
  assert.equal(
    typesCompactSignature(typesCompactPreview(noted, box.typeOf("Т"))),
    typesCompactSignature(approved),
  );
});

// ——— план смыкания по всему объекту ——————————————————————————————————

test("план смыкания: группа на тип, типы без дыр в него не попадают", () => {
  const box = compactFixture();
  let project = deleteMark(box.project, box.ids[1]).project; // Т1 Т3 Т4
  // Второй тип с дырой и третий — целый.
  const switchType = project.markTypes.find((type) => type.code === "В").id;
  const socketType = project.markTypes.find((type) => type.code === "Р").id;
  const put = (typeId, at) => {
    const step = addMark(project, { schemeId: box.schemeId, typeId, kind: "point", points: [{ x: at, y: 0.5 }] });
    project = step.project;
    return step.mark.id;
  };
  const first = put(switchType, 0.2);
  put(switchType, 0.4);
  put(socketType, 0.6);
  project = deleteMark(project, first).project; // В2

  const plan = marksCompactPlan(project);
  assert.deepEqual(
    plan.map((group) => [group.code, group.changes.length]),
    [
      ["Т", 2],
      ["В", 1],
    ],
    "в план попал тип без дыр или потерялся тип с дырами",
  );
  assert.deepEqual(marksCompactTotals(plan), { types: 2, changes: 3 });
  // Строки — те же, что в окне одиночного уплотнения: своей нумерации у панели нет.
  assert.deepEqual(
    plan[0].rows.map((row) => [row.fromLabel, row.toLabel]),
    [
      ["Т1", "Т1"],
      ["Т3", "Т2"],
      ["Т4", "Т3"],
    ],
  );
});

test("подпись плана ловит правку объекта, сделанную при открытом окне", () => {
  const box = compactFixture();
  const project = deleteMark(box.project, box.ids[1]).project;
  const plan = marksCompactPlan(project);
  assert.equal(marksCompactSignature(marksCompactPlan(project)), marksCompactSignature(plan));

  // Дыру закрыли руками, пока окно висело: подпись разошлась.
  const renumbered = setMarkNumber(project, box.ids[2], 2).project;
  assert.notEqual(marksCompactSignature(marksCompactPlan(renumbered)), marksCompactSignature(plan));
  // Правка, не трогающая номера, переспрашивать не заставляет.
  const renamed = updateMark(project, box.ids[0], { location: "у входа" }).project;
  assert.equal(marksCompactSignature(marksCompactPlan(renamed)), marksCompactSignature(plan));
});

test("плана нет, когда дыр нет ни у одного типа", () => {
  const box = compactFixture();
  assert.deepEqual(marksCompactPlan(box.project), []);
  assert.deepEqual(marksCompactPlan(null), []);
  assert.deepEqual(marksCompactTotals([]), { types: 0, changes: 0 });
});
