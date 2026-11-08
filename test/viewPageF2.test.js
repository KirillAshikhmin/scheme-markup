// Расхождения слепой приёмки страницы просмотра (F2): комментарий интегратора
// не уходит заказчику ни одним путём, список «Экспорта» знает про ссылку.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { appAllows, VIEW_ABILITIES } from "../src/app.js";
import { addMark, addScheme, createProject, searchProject, typesInOrder, updateMark } from "../src/model.js";
import { exportLinkAvailability } from "../src/panels/export.js";
import { strings } from "../src/strings.js";

function projectWithComment() {
  const added = addScheme(createProject({ name: "Объект" }), { name: "1 этаж", imageId: null, width: 4000, height: 3000 });
  const typeId = typesInOrder(added.project)[0].types[0].id;
  const marked = addMark(added.project, { schemeId: added.scheme.id, typeId, kind: "point", points: [{ x: 0.5, y: 0.5 }] });
  return updateMark(marked.project, marked.mark.id, { original: "секретнаязаписка" }).project;
}

test("комментарий интегратора — умение, которого у просмотра нет", () => {
  assert.equal(VIEW_ABILITIES.includes("integratorComment"), false);
  assert.equal(appAllows("integratorComment", { app: "view", layout: "desktop" }), false);
  assert.equal(appAllows("integratorComment", { app: "view", layout: "mobile" }), false);
  assert.equal(appAllows("integratorComment", { app: "edit", layout: "desktop" }), true);
  assert.equal(appAllows("integratorComment", { app: "edit", layout: "mobile" }), true);
});

test("поиск без комментариев не находит метку по тексту комментария и не показывает его", () => {
  const project = projectWithComment();
  assert.equal(searchProject(project, "секретнаязаписка").length, 1);
  assert.deepEqual(searchProject(project, "секретнаязаписка", { comments: false }), []);
});

test("пункт «Ссылкой» гаснет без объекта и живёт с объектом", () => {
  assert.equal(exportLinkAvailability(null), strings.exportPanel.linkNoProject);
  assert.equal(exportLinkAvailability({ project: null }), strings.exportPanel.linkNoProject);
});

test("у кнопки «Экспорт» есть список «В файл» и «Ссылкой»", () => {
  assert.equal(strings.file.saveToFile, "В файл");
  assert.equal(strings.file.saveLink, "Ссылкой");
  const source = readFileSync(new URL("../src/panels/file.js", import.meta.url), "utf8");
  assert.match(source, /click: \(\) => setSaveMenu\(!saveMenuOpen\)/);
  assert.match(source, /exportLinkDialog\(api\)/);
  assert.match(source, /event\.code !== "KeyS"[\s\S]{0,200}saveToFile\(\);/);
});
