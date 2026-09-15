// Помещения объекта заводятся на ходу из поля «Помещение» в списке меток:
// одно и то же название не должно плодить двойников.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject } from "../src/model.js";
import { roomsEnsure } from "../src/panels/rooms.js";

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
