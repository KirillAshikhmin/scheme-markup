// Разделы колонок и список помещений в панели.
//
// Разделы сворачиваются и помнят себя между сеансами, поэтому в хранилище
// попадает список свёрнутых. Из него же он и читается — в том числе из чужой
// версии и из мусора: схлопнуть панель на пустом месте нельзя.
import test from "node:test";
import assert from "node:assert/strict";

import {
  SECTION_DEFAULT_COLLAPSED,
  SECTION_IDS,
  sectionListFrom,
  sectionStartList,
  sectionsAfterToggle,
} from "../src/app.js";
import { roomsOutlineAction, roomsRows } from "../src/panels/rooms.js";
import { addMark, addOutline, addRoom, addScheme, createProject, updateMark } from "../src/model.js";

const SQUARE = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.6 },
  { x: 0.1, y: 0.6 },
];

test("из настроек берутся только известные разделы, мусор отбрасывается", () => {
  assert.deepEqual(sectionListFrom(null), []);
  assert.deepEqual(sectionListFrom("свёрнуто"), []);
  assert.deepEqual(sectionListFrom([SECTION_IDS.rooms, SECTION_IDS.rooms, "чужой раздел", 7, ""]), [
    SECTION_IDS.rooms,
  ]);
});

test("на первом запуске свёрнуто умолчание, а сохранённое пустое — это пусто", () => {
  assert.deepEqual(sectionStartList(undefined), SECTION_DEFAULT_COLLAPSED);
  assert.deepEqual(sectionStartList(null), [SECTION_IDS.sizes]);
  assert.deepEqual(sectionStartList([]), []);
  assert.deepEqual(sectionStartList([SECTION_IDS.rooms]), [SECTION_IDS.rooms]);
  // Умолчание не должно уехать вместе с возвращённым списком.
  sectionStartList(null).push(SECTION_IDS.marks);
  assert.deepEqual(SECTION_DEFAULT_COLLAPSED, [SECTION_IDS.sizes]);
});

test("свернуть и развернуть возвращает список к прежнему", () => {
  const collapsed = sectionsAfterToggle([], SECTION_IDS.sizes, true);
  assert.deepEqual(collapsed, [SECTION_IDS.sizes]);
  const both = sectionsAfterToggle(collapsed, SECTION_IDS.schemes, true);
  assert.deepEqual([...both].sort(), [SECTION_IDS.schemes, SECTION_IDS.sizes].sort());
  assert.deepEqual(sectionsAfterToggle(both, SECTION_IDS.sizes, false), [SECTION_IDS.schemes]);
  // Неизвестный раздел в список не попадает.
  assert.deepEqual(sectionsAfterToggle([], "чужой раздел", true), []);
});

function roomsFixture() {
  let project = createProject({ name: "Квартира" });
  const first = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = first.project;
  const second = addScheme(project, { name: "2 этаж", width: 1000, height: 800 });
  project = second.project;
  const bedroom = addRoom(project, "Спальная Оли");
  project = bedroom.project;
  const kitchen = addRoom(project, "Кухня");
  project = kitchen.project;
  // Контур спальной нарисован на первом этаже, у кухни его нет вовсе.
  project = addOutline(project, {
    schemeId: first.scheme.id,
    roomId: bedroom.room.id,
    points: SQUARE,
  }).project;
  const typeId = project.markTypes.find((type) => type.code === "В").id;
  const mark = addMark(project, {
    schemeId: first.scheme.id,
    typeId,
    kind: "point",
    points: [{ x: 0.2, y: 0.2 }],
  });
  project = updateMark(mark.project, mark.mark.id, { roomId: bedroom.room.id }).project;
  return { project, first: first.scheme.id, second: second.scheme.id, bedroom: bedroom.room, kitchen: kitchen.room };
}

test("строка помещения знает число меток и контур на этой схеме", () => {
  const { project, first, second, bedroom, kitchen } = roomsFixture();

  const rows = roomsRows(project, first);
  assert.deepEqual(
    rows.map((row) => row.room.name),
    ["Спальная Оли", "Кухня"],
  );
  assert.equal(rows[0].marks, 1);
  assert.equal(rows[1].marks, 0);
  assert.ok(rows[0].outlineId, "у спальной есть контур на первом этаже");
  assert.equal(rows[1].outlineId, null);
  assert.equal(rows[0].room.id, bedroom.id);
  assert.equal(rows[1].room.id, kitchen.id);

  // Контур принадлежит схеме: на втором этаже его нет, и кнопка ведёт в обводку.
  const other = roomsRows(project, second);
  assert.equal(other[0].outlineId, null);
  // Схема не выбрана — обводить негде, контуров не показываем.
  assert.equal(roomsRows(project, null)[0].outlineId, null);
});

test("кнопка контура ведёт в правку, когда контур уже есть, иначе в обводку", () => {
  const { project, first, second } = roomsFixture();
  const drawn = roomsRows(project, first)[0];
  const empty = roomsRows(project, second)[0];
  assert.equal(roomsOutlineAction(drawn), "edit");
  assert.equal(roomsOutlineAction(empty), "draw");
  assert.equal(roomsOutlineAction(null), "draw");
});
