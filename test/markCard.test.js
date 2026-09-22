// Карточка выделенной метки в просмотре и свёрнутые колонки.
//
// Обе вещи внешние, и глазами их проверяет приёмка. Но три решения здесь
// чистые, и разойтись они могут молча:
//
// 1. Что карточка показывает. Поля она берёт у той же модели, что раскрытая
//    строка списка, — заведись у неё своя, список и карточка говорили бы о
//    метке разное.
// 2. Подъём плана: метка не должна остаться под карточкой, но и дёргать план
//    на каждое нажатие нельзя.
// 3. Список свёрнутых колонок: он уезжает в настройки браузера и возвращается
//    оттуда, а мусор из хранилища не должен прятать колонки.
// 4. Показывать ли карточку. Заказчик попросил её «и с компа тоже», и правило
//    «где она есть и в каком виде» — единственное место, где это записано.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addEquipment,
  addMark,
  addPlacement,
  addRoom,
  addScheme,
  createProject,
  setMarkControls,
  setMarkDimensions,
  updateMark,
} from "../src/model.js";
import {
  MARK_CARD_FULL,
  MARK_CARD_MINI,
  MARK_CARD_NONE,
  markCardModel,
  markCardShift,
  markCardState,
} from "../src/panels/markCard.js";
import { PANEL_SIDES, panelListFrom, panelsAfterToggle } from "../src/app.js";
import { strings } from "../src/strings.js";

function scene() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const room = addRoom(project, "Спальня");
  project = room.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const lamp = addMark(project, { schemeId: scheme.scheme.id, typeId: typeOf("Т"), points: [{ x: 0.5, y: 0.5 }] });
  project = lamp.project;
  const switchMark = addMark(project, { schemeId: scheme.scheme.id, typeId: typeOf("В"), points: [{ x: 0.2, y: 0.6 }] });
  project = switchMark.project;
  return { project, schemeId: scheme.scheme.id, roomId: room.room.id, lamp: lamp.mark, switch: switchMark.mark };
}

test("карточка называет метку и её тип даже у пустой метки", () => {
  const made = scene();
  const card = markCardModel(made.project, made.lamp.id);
  assert.equal(card.id, made.lamp.id);
  assert.equal(card.label, "Т1");
  assert.equal(card.code, "Т");
  assert.ok(card.typeName.length > 0);
  assert.ok(card.style && card.style.color);
  // Пустых строк в карточке нет: «—» на восемь полей закрыли бы пол-плана.
  assert.deepEqual(card.rows, []);
});

test("карточка показывает поля метки и обе стороны связи", () => {
  const made = scene();
  let project = made.project;
  project = updateMark(project, made.lamp.id, {
    roomId: made.roomId,
    location: "над кроватью",
    original: "L-12",
  }).project;
  project = setMarkDimensions(project, made.lamp.id, { length: 600, width: 400 }).project;
  project = setMarkControls(project, made.switch.id, [made.lamp.id]).project;
  const equipment = addEquipment(project, { name: "Shelly 1PM" });
  project = equipment.project;
  project = addPlacement(project, { equipmentId: equipment.equipment.id, markId: made.lamp.id }).project;

  const card = markCardModel(project, made.lamp.id);
  const named = new Map(card.rows.map((row) => [row.label, row.value]));
  assert.equal(named.get(strings.marks.room), "Спальня");
  assert.equal(named.get(strings.marks.location), "над кроватью");
  assert.equal(named.get(strings.marks.originalPlaceholder), "L-12");
  assert.ok(named.get(strings.panels.sizes).includes("600"));
  // Управляется — со стороны светильника; управляет — со стороны выключателя.
  assert.ok(named.get(strings.marks.controlledByShort).includes("В1"));
  assert.equal(named.has(strings.marks.controls), false);
  assert.equal(named.get(strings.equipment.open), "1");

  const other = markCardModel(project, made.switch.id);
  const switchRows = new Map(other.rows.map((row) => [row.label, row.value]));
  assert.ok(switchRows.get(strings.marks.controls).includes("Т1"));
});

test("в карточке названа вся связка — включая связанных не напрямую", () => {
  const made = scene();
  let project = made.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const second = addMark(project, {
    schemeId: made.schemeId,
    typeId: typeOf("П"),
    points: [{ x: 0.3, y: 0.6 }],
  });
  project = second.project;
  // Два выключателя на одном светильнике: напрямую они не связаны.
  project = setMarkControls(project, made.switch.id, [made.lamp.id]).project;
  project = setMarkControls(project, second.mark.id, [made.lamp.id]).project;

  const card = markCardModel(project, made.switch.id);
  const named = new Map(card.rows.map((row) => [row.label, row.value]));
  assert.equal(named.get(strings.marks.linkedShort), "П1");
  // Светильник назван один раз — в «Чем управляет», а не дважды.
  assert.equal(named.get(strings.marks.controls), "Т1");
  // У светильника связка пуста: оба выключателя уже стоят в «Чем управляется».
  const lampRows = new Map(markCardModel(project, made.lamp.id).rows.map((row) => [row.label, row.value]));
  assert.equal(lampRows.has(strings.marks.linkedShort), false);
  // Подсказка объясняет, чем эта связь отличается от прямой.
  const linkedRow = card.rows.find((row) => row.label === strings.marks.linkedShort);
  assert.ok(linkedRow.title.includes(strings.marks.linkedTitle));
});

test("карточка есть во всех раскладках, а сворачивается только на компьютере", () => {
  const made = scene();
  const desktop = { project: made.project, layout: "desktop", selectedMarkIds: [made.lamp.id] };
  const mobile = { project: made.project, layout: "mobile", selectedMarkIds: [made.lamp.id] };
  // Заказчик: «ту плашку с информацией по метке отображай и в других режимах и
  // с компа тоже».
  assert.equal(markCardState(desktop), MARK_CARD_FULL);
  assert.equal(markCardState(mobile), MARK_CARD_FULL);
  // На компьютере её можно свернуть в ярлычок — в просмотре нельзя: там
  // карточка единственный способ прочитать метку, а закрывают её снятием
  // выделения.
  assert.equal(markCardState(desktop, true), MARK_CARD_MINI);
  assert.equal(markCardState(mobile, true), MARK_CARD_FULL);
  // Карточка про одну метку: пачка и пустое выделение её не поднимают.
  assert.equal(markCardState({ ...desktop, selectedMarkIds: [] }), MARK_CARD_NONE);
  assert.equal(
    markCardState({ ...desktop, selectedMarkIds: [made.lamp.id, made.switch.id] }),
    MARK_CARD_NONE,
  );
  assert.equal(markCardState({ ...desktop, project: null }), MARK_CARD_NONE);
  assert.equal(markCardState(null), MARK_CARD_NONE);
});

test("карточка понимает линию и метку блока", () => {
  const made = scene();
  let project = made.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const line = addMark(project, {
    schemeId: made.schemeId,
    typeId: typeOf("Л"),
    kind: "line",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
    ],
  });
  project = line.project;
  const card = markCardModel(project, line.mark.id);
  assert.equal(card.kind, "line");
  assert.equal(card.code, "Л");

  const block = addMark(project, {
    schemeId: made.schemeId,
    typeId: typeOf("Р"),
    points: [
      { x: 0.7, y: 0.7 },
      { x: 0.75, y: 0.7 },
    ],
  });
  project = block.project;
  const member = block.marks[0];
  const blockCard = markCardModel(project, member.id);
  assert.equal(blockCard.id, member.id);
  assert.ok(blockCard.label.length > 0);
});

test("нет метки — нет карточки", () => {
  const made = scene();
  assert.equal(markCardModel(made.project, "нет такой"), null);
  assert.equal(markCardModel(null, made.lamp.id), null);
  assert.equal(markCardModel(made.project, null), null);
});

test("план подвигается только тогда, когда метка ушла под карточку", () => {
  // Метка выше карточки — план не трогаем: рывок на каждое нажатие раздражает
  // сильнее, чем закрытая метка.
  assert.equal(markCardShift(100, 400), 0);
  assert.equal(markCardShift(376, 400, 24), 0);
  // Метка под карточкой — поднимаем ровно настолько, чтобы она встала над ней
  // с зазором.
  assert.equal(markCardShift(500, 400, 24), 124);
  assert.equal(markCardShift(400, 400, 0), 0);
  assert.equal(markCardShift(Number.NaN, 400), 0);
});

test("список свёрнутых колонок переживает мусор из хранилища", () => {
  assert.deepEqual(panelListFrom(["left", "right"]), ["left", "right"]);
  assert.deepEqual(panelListFrom(["left", "left"]), ["left"]);
  assert.deepEqual(panelListFrom(["чужое", 7, null]), []);
  assert.deepEqual(panelListFrom("left"), []);
  assert.deepEqual(panelListFrom(null), []);
});

test("колонка прячется и возвращается по одному правилу", () => {
  assert.deepEqual(panelsAfterToggle([], "left", true), ["left"]);
  assert.deepEqual(panelsAfterToggle(["left"], "left", true), ["left"]);
  assert.deepEqual(panelsAfterToggle(["left"], "left", false), []);
  assert.deepEqual(panelsAfterToggle(["left"], "right", true), ["left", "right"]);
  // Неизвестная сторона ничего не меняет: опечатка не должна прятать колонку.
  assert.deepEqual(panelsAfterToggle(["left"], "верх", true), ["left"]);
  assert.deepEqual(PANEL_SIDES, ["left", "right"]);
});
