// Данные для штампа: графы основной надписи у объекта.
//
// Главная опасность здесь — не в самих графах, а в том, что новое поле
// появится у объектов, которых никто не трогал. Правило заказчика (G68): «все
// изменения не должны ломать текущий проект». Поэтому проверяется не только
// «записали и прочли», но и обратное: пока графы не заполняли, объект остаётся
// побайтово прежним — и в памяти, и в файле.
import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_STAMP_FIELDS,
  PROJECT_STAMP_MAX,
  addMark,
  addScheme,
  createProject,
  projectHasStamp,
  projectStamp,
  setProjectStamp,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { mergeProjects } from "../src/merge.js";
import { STAMP_LABELS } from "../src/panels/stampForm.js";
import { strings } from "../src/strings.js";

// Объект «прежней разметки»: такой же, каким его оставила сборка до этого
// таска — без единого упоминания штампа.
function markedProject() {
  let project = createProject({ name: "Квартира на Ленина" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 500 });
  project = added.project;
  const typeId = project.markTypes[0].id;
  project = addMark(project, { schemeId: added.scheme.id, typeId, points: [{ x: 0.2, y: 0.3 }] }).project;
  return project;
}

test("у объекта без штампа все графы пустые, а поля в нём нет вовсе", () => {
  const project = markedProject();
  assert.equal(Object.prototype.hasOwnProperty.call(project, "stamp"), false);
  assert.deepEqual(projectStamp(project), {
    code: "",
    stage: "",
    author: "",
    checker: "",
    approver: "",
    org: "",
  });
  assert.equal(projectHasStamp(project), false);
});

test("G68: объект прежней разметки не меняется, пока графы не заполняли", () => {
  const project = markedProject();
  const before = JSON.stringify(project);
  const result = setProjectStamp(project, { code: "", stage: "", author: "", checker: "", approver: "", org: "" });
  assert.equal(result.changed, false);
  // Тот же объект, а не копия: правки не было, значит и времени правки нет.
  assert.equal(result.project, project);
  assert.equal(JSON.stringify(project), before);
});

test("G68: объект прежней разметки доезжает через файл без новых полей", async () => {
  const project = markedProject();
  const before = JSON.stringify(project);
  const file = await packProject(project, new Map());
  const { project: loaded } = await unpackProject(file);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded, "stamp"), false);
  assert.equal(JSON.stringify(project), before, "упаковка не правит объект в памяти");
  assert.deepEqual(projectStamp(loaded), projectStamp(project));
});

test("заполненные графы едут в файл и возвращаются оттуда", async () => {
  const project = setProjectStamp(markedProject(), {
    code: "2026-14-ЭОМ",
    stage: "Р",
    author: "Иванов",
    org: "ООО «Свет»",
  }).project;
  assert.equal(projectHasStamp(project), true);
  const { project: loaded } = await unpackProject(await packProject(project, new Map()));
  assert.deepEqual(projectStamp(loaded), projectStamp(project));
  assert.equal(projectStamp(loaded).code, "2026-14-ЭОМ");
  // Незаполненные графы в файл не кладутся — хранится только то, что сказали.
  assert.deepEqual(Object.keys(loaded.stamp).sort(), ["author", "code", "org", "stage"]);
});

test("очистка всех граф убирает поле, а не оставляет пустой объект", () => {
  const filled = setProjectStamp(markedProject(), { code: "2026-14-ЭОМ" }).project;
  assert.equal(filled.stamp.code, "2026-14-ЭОМ");
  const cleared = setProjectStamp(filled, { code: "" });
  assert.equal(cleared.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.project, "stamp"), false);
  assert.equal(projectHasStamp(cleared.project), false);
});

test("правка одной графы не трогает соседние", () => {
  const first = setProjectStamp(markedProject(), { code: "ЭОМ", org: "ООО «Свет»" }).project;
  const second = setProjectStamp(first, { author: "Иванов" }).project;
  assert.deepEqual(
    [projectStamp(second).code, projectStamp(second).org, projectStamp(second).author],
    ["ЭОМ", "ООО «Свет»", "Иванов"],
  );
});

test("мусор в графах не доезжает до чертежа", () => {
  const project = setProjectStamp(markedProject(), {
    code: "  2026-14-ЭОМ \n ",
    stage: "Р\nР",
    author: "и".repeat(PROJECT_STAMP_MAX + 50),
    org: 42,
  }).project;
  const stamp = projectStamp(project);
  assert.equal(stamp.code, "2026-14-ЭОМ");
  // Перевод строки из буфера схлопывается: графа штампа — одна строка.
  assert.equal(stamp.stage, "Р Р");
  assert.equal(stamp.author.length, PROJECT_STAMP_MAX);
  assert.equal(stamp.org, "42");
  // Испорченное поле читается как «граф нет», а не роняет лист.
  assert.deepEqual(projectStamp({ stamp: "ерунда" }), projectStamp({}));
  assert.deepEqual(projectStamp({ stamp: ["ерунда"] }), projectStamp({}));
  assert.deepEqual(projectStamp(null), projectStamp({}));
});

test("у каждой графы модели есть подпись в окне и строка в словаре", () => {
  for (const field of PROJECT_STAMP_FIELDS) {
    const row = STAMP_LABELS[field];
    assert.ok(row, "графа " + field + " без подписи в окне");
    assert.equal(typeof strings.gost[row.label], "string", "графа " + field + " без строки в словаре");
    if (row.hint) assert.equal(typeof strings.gost[row.hint], "string");
  }
});

// ——— слияние ————————————————————————————————————————————————————————

function pair() {
  const base = markedProject();
  return [JSON.parse(JSON.stringify(base)), JSON.parse(JSON.stringify(base))];
}

test("слияние: разные графы двоих складываются, ничья работа не пропадает", () => {
  const [ours, theirs] = pair();
  const mine = setProjectStamp(ours, { code: "2026-14-ЭОМ", author: "Иванов" }).project;
  const other = setProjectStamp(theirs, { org: "ООО «Свет»", checker: "Петров" }).project;
  const merged = mergeProjects(mine, other, null).project;
  assert.deepEqual(projectStamp(merged), {
    code: "2026-14-ЭОМ",
    stage: "",
    author: "Иванов",
    checker: "Петров",
    approver: "",
    org: "ООО «Свет»",
  });
});

test("слияние: одна и та же графа разной — побеждает тот, кто правил позже", () => {
  const [ours, theirs] = pair();
  const mine = setProjectStamp({ ...ours, updatedAt: "2026-10-01T10:00:00+03:00" }, { code: "старый" }).project;
  const other = setProjectStamp({ ...theirs, updatedAt: "2026-10-08T10:00:00+03:00" }, { code: "новый" }).project;
  mine.updatedAt = "2026-10-01T10:00:00+03:00";
  other.updatedAt = "2026-10-08T10:00:00+03:00";
  assert.equal(projectStamp(mergeProjects(mine, other, null).project).code, "новый");
  // Правило симметрично: с какой стороны ни сливай, ответ один.
  assert.equal(projectStamp(mergeProjects(other, mine, null).project).code, "новый");
});

test("слияние двух объектов без штампа поля не заводит", () => {
  const [ours, theirs] = pair();
  const merged = mergeProjects(ours, theirs, null);
  assert.equal(Object.prototype.hasOwnProperty.call(merged.project, "stamp"), false);
  assert.equal(merged.changed, false);
});
