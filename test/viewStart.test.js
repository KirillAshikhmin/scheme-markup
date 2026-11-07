// Слот объекта на странице просмотра (таск 02 просмотра): разбор адреса, правило
// замены, дата выгрузки, что стирает «Забыть объект» и схема без подложки.
// Окна, файл и IndexedDB здесь не проверяются — это живой прогон.
import test from "node:test";
import assert from "node:assert/strict";

import { addScheme, addWall, createProject } from "../src/model.js";
import {
  viewStartBare,
  viewStartDateText,
  viewStartForget,
  viewStartLinkOf,
  viewStartMadeAt,
  viewStartReplace,
} from "../src/panels/viewStart.js";

test("viewStartLinkOf: нагрузка из части адреса после решётки", () => {
  assert.equal(viewStartLinkOf("#o=AbC-_9"), "AbC-_9");
  assert.equal(viewStartLinkOf("o=AbC"), "AbC");
  assert.equal(viewStartLinkOf("#x=1&o=Zz_-"), "Zz_-");
  assert.equal(viewStartLinkOf("#o=a=b"), "a=b");
  assert.equal(viewStartLinkOf(""), null);
  assert.equal(viewStartLinkOf("#"), null);
  assert.equal(viewStartLinkOf("#o="), null);
  assert.equal(viewStartLinkOf("#other=abc"), null);
  assert.equal(viewStartLinkOf(undefined), null);
});

test("viewStartReplace: нет сохранённого — fresh, то же имя — молча, другое — спросить", () => {
  const kept = { name: "Квартира на Тверской" };
  assert.equal(viewStartReplace(null, { name: "Любой" }), "fresh");
  assert.equal(viewStartReplace(kept, { name: "Квартира на Тверской" }), "silent");
  assert.equal(viewStartReplace(kept, { name: "  Квартира на Тверской " }), "silent");
  assert.equal(viewStartReplace(kept, { name: "Дом в Репино" }), "ask");
});

test("viewStartMadeAt: дата из ссылки, иначе из writer.json, иначе из объекта", () => {
  const project = { updatedAt: "2026-10-01T10:00:00.000Z" };
  assert.equal(viewStartMadeAt({ madeAt: "2026-11-05T08:00:00.000Z", writtenAt: "2026-11-01T00:00:00.000Z", project }), "2026-11-05T08:00:00.000Z");
  assert.equal(viewStartMadeAt({ writtenAt: "2026-11-01T00:00:00.000Z", project }), "2026-11-01T00:00:00.000Z");
  assert.equal(viewStartMadeAt({ madeAt: "мусор", project }), "2026-10-01T10:00:00.000Z");
  assert.equal(viewStartMadeAt({ project: {} }), null);
});

test("viewStartDateText: число, месяц, год по часовому поясу устройства; мусор — пустая строка", () => {
  const local = new Date(2026, 10, 5, 12, 0, 0).toISOString();
  assert.equal(viewStartDateText(local), "05.11.2026");
  assert.equal(viewStartDateText(null), "");
  assert.equal(viewStartDateText("не дата"), "");
});

test("viewStartForget: из карт настроек уходит только забытый объект", () => {
  const map = { a: { x: 1 }, b: { x: 2 } };
  assert.deepEqual(viewStartForget(map, "a"), { b: { x: 2 } });
  assert.deepEqual(map, { a: { x: 1 }, b: { x: 2 } }, "исходная карта не меняется");
  assert.deepEqual(viewStartForget(null, "a"), {});
  assert.deepEqual(viewStartForget({ b: 1 }, "a"), { b: 1 });
});

test("viewStartBare: схема без подложки и без стен — «голая»; стены или подложка — нет", () => {
  let project = createProject({ name: "О" });
  const bare = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = bare.project;
  const id = bare.scheme.id;
  assert.equal(viewStartBare(project, id), true);
  const walled = addWall(project, { schemeId: id, aMm: { x: 0, y: 0 }, bMm: { x: 3000, y: 0 }, thicknessMm: 200 });
  assert.equal(viewStartBare(walled.project, id), false);
  const photo = addScheme(project, { name: "2 этаж", imageId: "img", width: 1000, height: 800 });
  assert.equal(viewStartBare(photo.project, photo.scheme.id), false);
  assert.equal(viewStartBare(project, "нет-такой"), false);
  assert.equal(viewStartBare(null, id), false);
});
