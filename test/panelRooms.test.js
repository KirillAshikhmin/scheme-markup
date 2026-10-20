// Помещения объекта заводятся на ходу из поля «Помещение» в списке меток:
// одно и то же название не должно плодить двойников.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addRoom, createProject, findRoom, roomHasFloor, setRoomFloor } from "../src/model.js";
import { roomsEnsure, roomsRows, roomsTraceAction } from "../src/panels/rooms.js";

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

// ——— пол помещения (таск 209, G317) ——————————————————————————————————————

test("пол у помещения есть по умолчанию, снимается и возвращается без следа", () => {
  const added = addRoom(createProject({ name: "Тест" }), "Гостиная");
  const roomId = added.room.id;
  assert.equal(roomHasFloor(added.project, roomId), true, "по умолчанию пол есть");
  assert.equal(
    Object.prototype.hasOwnProperty.call(findRoom(added.project, roomId), "hasFloor"),
    false,
    "и ключа в комнате нет вовсе — иначе прежний объект изменился бы от чтения",
  );
  // Снять — ключ появляется ровно один.
  const off = setRoomFloor(added.project, roomId, false);
  assert.equal(off.changed, true);
  assert.equal(roomHasFloor(off.project, roomId), false);
  assert.equal(findRoom(off.project, roomId).hasFloor, false);
  assert.equal(setRoomFloor(off.project, roomId, false).changed, false, "второй раз снимать нечего");
  // Вернуть — ключ **удаляется**, а не ставится в `true`.
  const back = setRoomFloor(off.project, roomId, true);
  assert.equal(back.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(findRoom(back.project, roomId), "hasFloor"), false);
  assert.equal(JSON.stringify(back.project.rooms), JSON.stringify(added.project.rooms), "комната та же, что была");
  assert.equal(setRoomFloor(back.project, roomId, true).changed, false);
  assert.equal(roomHasFloor(added.project, "нет такой"), true, "у несуществующей комнаты пол не отнимается");
});

test("строка списка помещений знает про пол", () => {
  const added = addRoom(createProject({ name: "Тест" }), "Гостиная");
  const rows = roomsRows(added.project, null);
  assert.equal(rows[0].hasFloor, true);
  const off = setRoomFloor(added.project, added.room.id, false).project;
  assert.equal(roomsRows(off, null)[0].hasFloor, false);
});

test("G68: объект прежней сборки открывается с полами и не меняется от чтения", () => {
  const legacy = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "legacy-project.json"), "utf8"));
  const before = JSON.stringify(legacy);
  assert.ok(legacy.rooms.length > 0, "в прежнем объекте есть помещения");
  for (const room of legacy.rooms) {
    assert.equal(roomHasFloor(legacy, room.id), true, "у прежнего помещения пол есть");
    assert.equal(Object.prototype.hasOwnProperty.call(room, "hasFloor"), false);
  }
  assert.equal(roomsRows(legacy, legacy.schemes[0].id).every((row) => row.hasFloor), true);
  assert.equal(JSON.stringify(legacy), before, "объект изменился — это запрещено прямо (G68)");
});
