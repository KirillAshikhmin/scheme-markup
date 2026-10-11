// Помещения объекта заводятся на ходу из поля «Помещение» в списке меток:
// одно и то же название не должно плодить двойников.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addRoom, createProject } from "../src/model.js";
import { roomsEnsure, roomsTraceAction } from "../src/panels/rooms.js";

test("новое название заводит помещение, повторное — находит прежнее", () => {
  const project = createProject({ name: "Тест" });
  const first = roomsEnsure(project, "Спальная Оли");
  assert.equal(first.room.name, "Спальная Оли");
  assert.equal(first.project.rooms.length, 1);

  const again = roomsEnsure(first.project, "  спальная оли ");
  assert.equal(again.room.id, first.room.id);
  assert.equal(again.project, first.project);
  assert.equal(again.project.rooms.length, 1);
});

test("пустое название — это «без помещения», а не новая комната", () => {
  const project = createProject({ name: "Тест" });
  const empty = roomsEnsure(project, "   ");
  assert.equal(empty.room, null);
  assert.equal(empty.project, project);
  assert.equal(empty.project.rooms.length, 0);
});

// ——— кнопка «по чертежу» (таск 138) ————————————————————————————————————
//
// Проверок у неё четыре, и порядок важен: сперва то, что мешает вообще (нет
// схемы, нет чертежа), потом то, что мешает этому помещению (нет названия).
// Разойдись порядок — человек получил бы «впишите название» там, где чертежа
// нет вовсе, и искал бы беду не в том месте.

const ready = { ok: true, reason: null };

test("кнопка «по чертежу»: со схемой и чертежом новое название заводит комнату", () => {
  const project = createProject({ name: "Тест" });
  assert.deepEqual(roomsTraceAction(project, "scheme-1", "Кухня", ready), {
    kind: "create",
    roomId: null,
    name: "Кухня",
  });
});

test("кнопка «по чертежу»: заведённое название берёт прежнюю комнату", () => {
  const made = addRoom(createProject({ name: "Тест" }), "Кухня");
  assert.deepEqual(roomsTraceAction(made.project, "scheme-1", " кухня ", ready), {
    kind: "trace",
    roomId: made.room.id,
    name: "кухня",
  });
});

test("кнопка «по чертежу»: чертежа нет — говорится об этом, а не о названии", () => {
  const project = createProject({ name: "Тест" });
  const said = roomsTraceAction(project, "scheme-1", "", { ok: false, reason: "noBridge" });
  assert.equal(said.kind, "tell");
  assert.equal(said.reason, "noBridge");
});

test("кнопка «по чертежу»: схемы нет — просим план, объекта нет — молчим", () => {
  const project = createProject({ name: "Тест" });
  assert.equal(roomsTraceAction(project, null, "Кухня", ready).kind, "scheme");
  assert.equal(roomsTraceAction(null, "scheme-1", "Кухня", ready).kind, "none");
});

test("кнопка «по чертежу»: пустое название просит название, а не молчит", () => {
  const project = createProject({ name: "Тест" });
  assert.equal(roomsTraceAction(project, "scheme-1", "   ", ready).kind, "name");
});
