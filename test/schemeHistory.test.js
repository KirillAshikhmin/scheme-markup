// Правки схемы идут через отмену (таск 172, находка 4 разбора).
//
// Правило сборки одно: всё, что должен отменять Ctrl+Z, идёт через
// `canvas.canvasCommit` — единственное место, которое зовёт `pushCommand`.
// Соблюдено оно было везде, кроме операций со схемой: завести, переименовать,
// переставить — простой `setState({ project })`. А стек истории **один на
// объект**, поэтому Ctrl+Z после такой правки отменял не её, а предыдущую:
// перенос метки, поставленную линию. Молча и не там, куда человек смотрит.
//
// Переименование помещения при этом отменялось всегда, и разницы в деле между
// ними нет: оба — имя сущности в `project.json`.
//
// Окно и состояние сеанса тестами не покрыты, поэтому держится здесь то, что
// покрыть можно: ярлыки шагов (их человек читает в подсказке отмены) и то, что
// ни одна правка схемы не ходит мимо команды. Единственное исключение —
// удаление схемы — названо в коде, и тест следит, чтобы объяснение не пропало.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMES_SRC = join(HERE, "..", "src", "panels", "schemes.js");
const source = readFileSync(SCHEMES_SRC, "utf8");

const bodyOf = (head) => {
  const from = source.indexOf(head);
  assert.ok(from > 0, "пропала дверь: " + head);
  const rest = source.slice(from + head.length);
  const end = rest.indexOf("\n  }\n");
  return rest.slice(0, end > 0 ? end : rest.length);
};

test("у каждого шага правки схемы есть своё имя, и оно не повторяет чужое", () => {
  const steps = ["addScheme", "renameScheme", "schemeProps", "schemeOrder", "schemeFloor"];
  const said = steps.map((key) => strings.history[key]);
  for (const [index, key] of steps.entries()) {
    assert.ok(said[index] && said[index].length > 3, "нет имени шага: " + key);
  }
  assert.equal(new Set(said).size, steps.length, "два шага названы одинаково: " + said.join(" / "));
  // Переименование схемы названо так же понятно, как переименование помещения:
  // в подсказке отмены стоят они рядом.
  assert.match(strings.history.renameScheme, /схем/);
  assert.match(strings.history.renameRoom, /помещени/);
});

test("завести, переименовать и переставить схему — через команду отмены", () => {
  for (const head of [
    "async function addPlanFromFile(file) {",
    "async function addBlankScheme() {",
    "    function apply() {",
    "function moveScheme(schemeId, delta) {",
  ]) {
    const body = bodyOf(head);
    assert.ok(body.includes("canvasCommit("), "правка схемы снова идёт мимо истории: " + head);
    assert.ok(!/setState\(\s*\{[^}]*project:/.test(body), "правка схемы снова пишет объект напрямую: " + head);
  }
});

test("мимо истории — только удаление схемы, и причина написана рядом", () => {
  // Единственный `setState` с объектом на всю панель, и он внутри удаления.
  const direct = [...source.matchAll(/setState\(\s*\{[^}]*project:/g)];
  assert.equal(direct.length, 1, "правок объекта мимо истории стало " + direct.length);
  const from = source.indexOf("async function removeScheme(");
  const until = source.indexOf("async function loadSchemeImage(");
  assert.ok(from > 0 && until > from);
  assert.ok(direct[0].index > from && direct[0].index < until, "объект правят напрямую вне удаления схемы");
  // Объяснение — в коде, чтобы следующий не «починил»: названы и `deleteImage`,
  // и то, что место это стоит вне отмены нарочно.
  const why = source.slice(source.lastIndexOf("/**", from), from);
  assert.match(why, /вне отмены/);
  assert.match(why, /deleteImage/);
  assert.ok(bodyOf("async function removeScheme(schemeId, marks) {").includes("deleteImage("));
});
