// Поиск по объекту: «где Р14», «что за метка у тумбы», «что стоит в спальной».
//
// Ищем по всему объекту, а не по открытой схеме: когда этажей три, вопрос
// «где Р14» иначе остаётся без ответа. Поэтому и порядок выдачи важен —
// сперва то, что человек набрал как обозначение, потом описания и помещения.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addRoom,
  addScheme,
  createProject,
  searchProject,
  updateMark,
} from "../src/model.js";

// Два этажа: на первом розетка у тумбы в спальной, на втором — розетка
// с тем же типом и выключатель с «оригиналом» из чужого проекта.
function searchFixture() {
  let project = createProject({ name: "Квартира" });
  const first = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = first.project;
  const second = addScheme(project, { name: "2 этаж", width: 1000, height: 800 });
  project = second.project;
  const bedroom = addRoom(project, "Спальная Оли");
  project = bedroom.project;
  const hall = addRoom(project, "Прихожая");
  project = hall.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;

  const socket = addMark(project, {
    schemeId: first.scheme.id,
    typeId: typeOf("Р"),
    kind: "point",
    points: [{ x: 0.2, y: 0.2 }],
  });
  project = updateMark(socket.project, socket.mark.id, {
    roomId: bedroom.room.id,
    location: "над тумбой слева",
    original: "В31",
  }).project;

  const upstairs = addMark(project, {
    schemeId: second.scheme.id,
    typeId: typeOf("Р"),
    kind: "point",
    points: [{ x: 0.4, y: 0.4 }],
  });
  project = updateMark(upstairs.project, upstairs.mark.id, { roomId: hall.room.id }).project;

  const switchMark = addMark(project, {
    schemeId: second.scheme.id,
    typeId: typeOf("В"),
    kind: "point",
    points: [{ x: 0.6, y: 0.6 }],
  });
  project = updateMark(switchMark.project, switchMark.mark.id, {
    roomId: bedroom.room.id,
    original: "Р1",
  }).project;

  return {
    project,
    schemes: { first: first.scheme.id, second: second.scheme.id },
    marks: { socket: socket.mark.id, upstairs: upstairs.mark.id, switchMark: switchMark.mark.id },
  };
}

test("поиск по обозначению находит метку на любой схеме", () => {
  const { project, marks, schemes } = searchFixture();
  const found = searchProject(project, "Р2");
  assert.equal(found.length, 1, "Р2 — вторая розетка, она на втором этаже");
  assert.equal(found[0].markId, marks.upstairs);
  assert.equal(found[0].schemeId, schemes.second);
  assert.equal(found[0].label, "Р2");
  assert.equal(found[0].schemeName, "2 этаж");
  assert.equal(found[0].roomName, "Прихожая");
  assert.equal(found[0].field, "label");
});

test("поиск по расположению, по оригиналу и по помещению", () => {
  const { project, marks } = searchFixture();
  const byLocation = searchProject(project, "тумбой");
  assert.deepEqual(byLocation.map((row) => row.markId), [marks.socket]);
  assert.equal(byLocation[0].field, "location");

  const byOriginal = searchProject(project, "в31");
  assert.deepEqual(byOriginal.map((row) => row.markId), [marks.socket]);
  assert.equal(byOriginal[0].field, "original");

  // Помещение отвечает на «покажи метки этой комнаты» — списком её меток.
  const byRoom = searchProject(project, "спальная");
  assert.deepEqual(new Set(byRoom.map((row) => row.markId)), new Set([marks.socket, marks.switchMark]));
  assert.ok(byRoom.every((row) => row.field === "room"));
});

test("своё обозначение сильнее чужого описания и оригинала", () => {
  const { project, marks } = searchFixture();
  // «Р1» — обозначение первой розетки и «оригинал» выключателя со второго этажа.
  const found = searchProject(project, "Р1");
  assert.equal(found[0].markId, marks.socket, "сперва метка, которая так и обозначена");
  assert.equal(found[0].field, "label");
  assert.ok(
    found.some((row) => row.markId === marks.switchMark && row.field === "original"),
    "метка с таким оригиналом тоже в списке, но ниже",
  );
});

test("внутри одной силы совпадения порядок — по схемам и номерам", () => {
  const { project, marks, schemes } = searchFixture();
  const found = searchProject(project, "р");
  const sockets = found.filter((row) => row.field === "label").map((row) => row.markId);
  assert.deepEqual(sockets, [marks.socket, marks.upstairs], "первый этаж раньше второго");
  assert.equal(found[0].schemeId, schemes.first);
});

test("пустой запрос ничего не ищет, регистр и пробелы не мешают", () => {
  const { project, marks } = searchFixture();
  assert.deepEqual(searchProject(project, ""), []);
  assert.deepEqual(searchProject(project, "   "), []);
  assert.deepEqual(searchProject(null, "Р1"), []);
  assert.deepEqual(
    searchProject(project, "  НАД ТУМБОЙ  ").map((row) => row.markId),
    [marks.socket],
  );
});

test("в строке результата видно, что это и где", () => {
  const { project } = searchFixture();
  const row = searchProject(project, "Р1")[0];
  assert.equal(row.label, "Р1");
  assert.equal(row.typeName, "Розетка");
  assert.equal(row.roomName, "Спальная Оли");
  assert.equal(row.schemeName, "1 этаж");
  assert.equal(row.value, "Р1");
  assert.ok(row.typeId);
});
