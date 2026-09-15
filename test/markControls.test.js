// Связь «чем управляет»: выключатель держит список меток, которые включает.
// С рукописного листа заказчика: «В3 — на В33 (Т1, Т2, Т3)» — у одного
// выключателя их несколько, поэтому связь множественная и живёт в модели
// ссылками на метки, а не текстом: переименование типа и уплотнение номеров
// не должны её рвать.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addScheme,
  changeMarkType,
  compactNumbers,
  createProject,
  deleteMark,
  deleteScheme,
  labelOf,
  markControlIds,
  markControlledBy,
  markControls,
  setMarkControls,
  validate,
} from "../src/model.js";
import { packProject, unpackProject, writeZip } from "../src/projectFile.js";

function house() {
  let project = createProject({ name: "Квартира" });
  const first = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = first.project;
  const schemeId = first.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x) => {
    const result = addMark(project, { schemeId, typeId: typeOf(code), kind: "point", points: [{ x, y: 0.5 }] });
    project = result.project;
    return result.mark.id;
  };
  const switchOne = put("В", 0.1);
  const switchTwo = put("В", 0.2);
  const lampOne = put("Т", 0.3);
  const lampTwo = put("Т", 0.4);
  const lampThree = put("Т", 0.5);
  const socket = put("Р", 0.6);
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId,
    switchOne,
    switchTwo,
    lampOne,
    lampTwo,
    lampThree,
    socket,
    typeOf,
  };
}

test("выключатель управляет несколькими метками, порядок — порядок объекта", () => {
  const box = house();
  // Список задан вразнобой: хранится он в порядке объекта, чтобы строка
  // читалась одинаково после каждой правки.
  const result = setMarkControls(box.project, box.switchOne, [box.lampThree, box.lampOne, box.lampTwo]);
  box.project = result.project;
  assert.deepEqual(
    markControls(box.project, box.switchOne).map((mark) => labelOf(box.project, mark.id)),
    ["Т1", "Т2", "Т3"],
  );
  // Соседний выключатель не при чём: связь у метки своя.
  assert.deepEqual(markControls(box.project, box.switchTwo), []);
});

test("обратная сторона связи: у светильника видно, какие выключатели им управляют", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampTwo]).project;
  box.project = setMarkControls(box.project, box.switchTwo, [box.lampOne]).project;
  assert.deepEqual(
    markControlledBy(box.project, box.lampOne).map((mark) => labelOf(box.project, mark.id)),
    ["В1", "В2"],
  );
  assert.deepEqual(
    markControlledBy(box.project, box.lampTwo).map((mark) => labelOf(box.project, mark.id)),
    ["В1"],
  );
  assert.deepEqual(markControlledBy(box.project, box.lampThree), []);
});

test("список переписывается целиком: связь снимается пустым списком", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampTwo]).project;
  box.project = setMarkControls(box.project, box.switchOne, [box.lampTwo]).project;
  assert.deepEqual(
    markControls(box.project, box.switchOne).map((mark) => mark.id),
    [box.lampTwo],
  );
  box.project = setMarkControls(box.project, box.switchOne, []).project;
  assert.deepEqual(markControls(box.project, box.switchOne), []);
  assert.deepEqual(markControlledBy(box.project, box.lampTwo), []);
});

test("повтор в списке не плодит связь, метка не управляет сама собой", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampOne, box.lampOne]).project;
  assert.equal(markControls(box.project, box.switchOne).length, 1);
  assert.throws(() => setMarkControls(box.project, box.switchOne, [box.switchOne]), { code: "controlsSelf" });
  assert.throws(() => setMarkControls(box.project, box.switchOne, ["нет такой метки"]), { code: "markNotFound" });
});

test("объект не меняется на месте: старый снимок помнит прежние связи", () => {
  const box = house();
  const before = box.project;
  const after = setMarkControls(before, box.switchOne, [box.lampOne]).project;
  assert.notEqual(after, before);
  assert.deepEqual(markControls(before, box.switchOne), []);
  assert.equal(markControls(after, box.switchOne).length, 1);
});

test("удалённая метка не остаётся висеть в чужих связях", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampTwo]).project;
  box.project = setMarkControls(box.project, box.switchTwo, [box.lampTwo]).project;
  box.project = deleteMark(box.project, box.lampTwo).project;
  assert.deepEqual(
    markControls(box.project, box.switchOne).map((mark) => mark.id),
    [box.lampOne],
  );
  assert.deepEqual(markControls(box.project, box.switchTwo), []);
  // И в самих данных ссылки нет: иначе она вернётся при выгрузке в файл.
  for (const mark of box.project.marks) {
    assert.ok(!markControlIds(mark).includes(box.lampTwo), "висячая ссылка осталась в данных");
  }
  assert.deepEqual(validate(box.project).filter((item) => item.code === "controlsMissing"), []);
});

test("удаление самого выключателя уносит только его список", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne]).project;
  box.project = deleteMark(box.project, box.switchOne).project;
  assert.deepEqual(markControlledBy(box.project, box.lampOne), []);
  assert.deepEqual(markControls(box.project, box.switchOne), []);
});

test("схема уходит вместе с метками — и связи на них тоже", () => {
  const box = house();
  const second = addScheme(box.project, { name: "2 этаж", width: 800, height: 600 });
  box.project = second.project;
  const upstairs = addMark(box.project, {
    schemeId: second.scheme.id,
    typeId: box.typeOf("Т"),
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  box.project = upstairs.project;
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, upstairs.mark.id]).project;
  box.project = deleteScheme(box.project, second.scheme.id).project;
  assert.deepEqual(
    markControls(box.project, box.switchOne).map((mark) => mark.id),
    [box.lampOne],
  );
  assert.deepEqual(validate(box.project).filter((item) => item.code === "controlsMissing"), []);
});

test("связь переживает смену типа и уплотнение нумерации", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampThree]).project;
  // Т2 удалили — в нумерации дыра, которую потом уплотняют.
  box.project = deleteMark(box.project, box.lampTwo).project;
  // Светильник Т3 оказался розеткой: тип другой, номер новый, метка та же.
  box.project = changeMarkType(box.project, box.lampThree, box.typeOf("Р")).project;
  const compacted = compactNumbers(box.project, box.typeOf("Т"));
  box.project = compacted.project;
  assert.deepEqual(
    markControls(box.project, box.switchOne).map((mark) => mark.id),
    [box.lampOne, box.lampThree],
  );
  // Обозначения изменились, связь — нет: она держится за метку, а не за подпись.
  assert.deepEqual(
    markControls(box.project, box.switchOne).map((mark) => labelOf(box.project, mark.id)),
    ["Т1", "Р2"],
  );
});

test("битый файл с висячей ссылкой виден в проверке объекта", () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne]).project;
  // Так выглядит объект, которому правили JSON руками.
  const broken = {
    ...box.project,
    marks: box.project.marks.map((mark) =>
      mark.id === box.switchOne ? { ...mark, controls: [...mark.controls, "потерянная-метка"] } : mark,
    ),
  };
  const problems = validate(broken).filter((item) => item.code === "controlsMissing");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].ref, box.switchOne);
});

test("связи уезжают в файл и возвращаются оттуда", async () => {
  const box = house();
  box.project = setMarkControls(box.project, box.switchOne, [box.lampOne, box.lampThree]).project;
  const blob = await packProject(box.project, new Map());
  const restored = await unpackProject(blob);
  assert.deepEqual(
    markControls(restored.project, box.switchOne).map((mark) => mark.id),
    [box.lampOne, box.lampThree],
  );
  assert.deepEqual(
    markControlledBy(restored.project, box.lampOne).map((mark) => mark.id),
    [box.switchOne],
  );
});

test("старый файл без этого поля читается, связей в нём просто нет", async () => {
  const box = house();
  // Файл первой версии: у меток поля controls не существует вовсе.
  const old = {
    ...box.project,
    formatVersion: 1,
    marks: box.project.marks.map((mark) => {
      const copy = { ...mark };
      delete copy.controls;
      return copy;
    }),
  };
  const blob = await writeZip([{ name: "project.json", data: JSON.stringify(old) }]);
  const restored = await unpackProject(blob);
  for (const mark of restored.project.marks) {
    assert.deepEqual(markControlIds(mark), [], "поле должно доехать списком, а не «иногда undefined»");
  }
  assert.deepEqual(markControls(restored.project, box.switchOne), []);
  // И сразу после загрузки связь ставится как обычно.
  const linked = setMarkControls(restored.project, box.switchOne, [box.lampOne]).project;
  assert.deepEqual(
    markControls(linked, box.switchOne).map((mark) => mark.id),
    [box.lampOne],
  );
});
