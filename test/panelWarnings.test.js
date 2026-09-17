// Панель предупреждений: список того, что нашёл `validate`, и переход к
// виновнику.
//
// Проверяется чистая часть панели — состав списка, группировка одинаковых
// строк в счётчик и адрес виновника. Сам выпадающий список, клик и наведение
// холста — DOM, его проверяет приёмка.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addRoom,
  addScheme,
  closeTypeKindReview,
  createProject,
  migrateTypeKinds,
  setMarkNumber,
  updateMark,
  updateType,
} from "../src/model.js";
import { strings } from "../src/strings.js";
import { WARNING_TARGETS, warningPlace, warningWhere, warningsModel } from "../src/panels/warnings.js";

const LINE = [
  { x: 0.2, y: 0.4 },
  { x: 0.8, y: 0.4 },
];

function house() {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 600 });
  const schemeId = made.scheme.id;
  let project = made.project;
  const idOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const lamps = [];
  for (const at of [0.2, 0.4, 0.6]) {
    const added = addMark(project, { schemeId, typeId: idOf("Т"), kind: "point", points: [{ x: at, y: 0.3 }] });
    project = added.project;
    lamps.push(added.mark.id);
  }
  const track = addMark(project, { schemeId, typeId: idOf("ТР"), kind: "line", points: LINE });
  project = track.project;
  return { project, schemeId, idOf, lamps, track: track.mark.id };
}

test("чистый объект: смотреть нечего, и это видно", () => {
  const box = house();
  const model = warningsModel(box.project);
  assert.equal(model.total, 0);
  assert.equal(model.level, "ok");
  assert.deepEqual(model.groups, []);
  // Объекта нет вовсе — та же хорошая новость, а не поломка.
  assert.deepEqual(warningsModel(null), { total: 0, level: "ok", groups: [] });
});

test("одинаковые предупреждения сворачиваются в строку со счётчиком", () => {
  const box = house();
  // Так выглядит объект, у которого удалили помещение мимо модели.
  const broken = {
    ...box.project,
    marks: box.project.marks.map((mark) =>
      box.lamps.includes(mark.id) ? { ...mark, roomId: "помещения-нет" } : mark,
    ),
  };
  const model = warningsModel(broken);
  const group = model.groups.find((item) => item.code === "markWithoutRoom");
  assert.equal(group.count, 3);
  assert.equal(group.items.length, 3);
  assert.equal(group.title, "Меток с потерянным помещением: 3");
  assert.equal(model.total, 3);
  assert.equal(model.level, "error");
});

test("ошибки сверху, предупреждения под ними", () => {
  const box = house();
  // Повтор номера — приём заказчика: предупреждение. Потерянная связь — ошибка.
  let project = setMarkNumber(box.project, box.lamps[1], 1).project;
  project = {
    ...project,
    marks: project.marks.map((mark) =>
      mark.id === box.lamps[0] ? { ...mark, controls: ["потерянная-метка"] } : mark,
    ),
  };
  const model = warningsModel(project);
  assert.deepEqual(
    model.groups.map((group) => [group.level, group.code]),
    [
      ["error", "controlsMissing"],
      ["warning", "repeatedNumber"],
    ],
  );
  assert.equal(model.level, "error");
  // Одно предупреждение в группе — строка остаётся собой: сворачивать нечего.
  assert.equal(model.groups[1].count, 1);
  assert.equal(model.groups[1].items[0].message, "Т1 — таких меток 2");
});

test("каждая строка в группе называет виновника, а не повторяет соседку", () => {
  const box = house();
  const project = {
    ...box.project,
    marks: box.project.marks.map((mark) =>
      box.lamps.includes(mark.id) ? { ...mark, roomId: "помещения-нет" } : mark,
    ),
  };
  const group = warningsModel(project).groups.find((item) => item.code === "markWithoutRoom");
  assert.deepEqual(
    group.items.map((item) => item.message),
    [
      "Т1 — ссылается на несуществующее помещение",
      "Т2 — ссылается на несуществующее помещение",
      "Т3 — ссылается на несуществующее помещение",
    ],
    "три одинаковые строки: непонятно, о какой метке речь",
  );
  // Ни одна строка с переходом не должна быть безымянной.
  for (const item of warningsModel(project).groups.flatMap((item) => item.items)) {
    if (!item.place || item.code === "typeKind") continue;
    assert.notEqual(item.message.trim(), "", item.code + ": строка без текста");
    assert.ok(/^[^—]+ — |\{|[А-ЯЁ]/.test(item.message), item.code + ": строка не называет виновника");
  }
});

test("контур зовётся помещением, группа — подписью блока, тип — кодом", () => {
  const box = house();
  const room = addRoom(box.project, { name: "Спальная" });
  const outline = {
    id: "контур-1",
    schemeId: box.schemeId,
    roomId: room.room.id,
    points: [{ x: 0.1, y: 0.1 }],
  };
  const broken = {
    ...room.project,
    outlines: [outline],
    groups: [{ id: "группа-1", schemeId: box.schemeId, markIds: [box.lamps[0]] }],
    markTypes: room.project.markTypes.map((type) =>
      type.code === "Т" ? { ...type, categoryId: "категории-нет" } : type,
    ),
  };
  const messages = warningsModel(broken)
    .groups.flatMap((group) => group.items)
    .map((item) => item.message);
  assert.ok(messages.includes("Спальная — в контуре помещения меньше трёх вершин"), messages.join(" | "));
  assert.ok(messages.includes("Т1 — в группе меньше двух меток"), messages.join(" | "));
  assert.ok(messages.includes("Т — у типа нет категории из справочника"), messages.join(" | "));
});

test("под строкой сказано, где это: помещение и схема", () => {
  const box = house();
  const room = addRoom(box.project, { name: "Спальная" });
  let project = updateMark(room.project, box.lamps[0], { roomId: room.room.id }).project;
  const place = { markId: box.lamps[0], schemeId: box.schemeId };
  // План один — схему называть незачем, она в каждой строке одна и та же.
  assert.equal(warningWhere(project, place), "Спальная");
  project = addScheme(project, { name: "2 этаж", width: 800, height: 600 }).project;
  assert.equal(warningWhere(project, place), "Спальная · 1 этаж");
  assert.equal(warningWhere(project, null), "");
});

test("строка ведёт к виновнику: метка, её схема и точка на плане", () => {
  const box = house();
  const project = {
    ...box.project,
    marks: box.project.marks.map((mark) =>
      mark.id === box.lamps[2] ? { ...mark, roomId: "помещения-нет" } : mark,
    ),
  };
  const place = warningsModel(project).groups[0].items[0].place;
  assert.equal(place.markId, box.lamps[2]);
  assert.equal(place.schemeId, box.schemeId);
  assert.deepEqual(place.point, { x: 0.6, y: 0.3 });
});

test("предупреждение о типе ведёт к метке не того вида", () => {
  const box = house();
  // Лентой размечали и линию, и отдельную точку: тип стал смешанным.
  const line = addMark(box.project, { schemeId: box.schemeId, typeId: box.idOf("Л"), kind: "line", points: LINE });
  const dot = addMark(line.project, {
    schemeId: box.schemeId,
    typeId: box.idOf("Л"),
    kind: "point",
    points: [{ x: 0.7, y: 0.7 }],
  });
  const project = updateType(dot.project, box.idOf("Л"), { kind: "line" }).project;
  const group = warningsModel(project).groups.find((item) => item.code === "typeKindMixed");
  assert.equal(group.count, 1);
  assert.equal(group.items[0].place.typeId, box.idOf("Л"));
  // Виновник — точка у линейного типа, а не первая метка типа подряд.
  assert.equal(group.items[0].place.markId, dot.mark.id);
});

test("виновника уже нет — перехода нет, а не переход в никуда", () => {
  const box = house();
  const project = {
    ...box.project,
    groups: [{ id: "группа-призрак", schemeId: box.schemeId, markIds: ["нет-такой-метки"] }],
  };
  const group = warningsModel(project).groups.find((item) => item.code === "smallGroup");
  assert.equal(group.items[0].place, null);
  // Ссылки без цели у проблемы быть не должно: код без адресата — это строка,
  // по которой некуда идти.
  assert.deepEqual(warningPlace(box.project, { code: "markWithoutRoom", ref: null }), null);
});

test("каждый код проблемы знает, кто её виновник, и как называться во множественном числе", () => {
  assert.deepEqual(
    Object.keys(strings.problems).sort(),
    Object.keys(strings.warnings.groups).sort(),
    "у кода проблемы нет строки для свёрнутой группы — счётчик выйдет пустым",
  );
  assert.deepEqual(
    Object.keys(strings.problems).sort(),
    Object.keys(WARNING_TARGETS).sort(),
    "у кода проблемы не назван виновник — строка будет без перехода",
  );
});

test("типы с выведенным видом — строки панели; ответ убирает строку", () => {
  const box = house();
  // Так выглядел объект до того, как у типа появился вид.
  const old = {
    ...box.project,
    formatVersion: 2,
    markTypes: box.project.markTypes.map((type) => {
      const copy = { ...type };
      delete copy.kind;
      delete copy.kindGuessed;
      return copy;
    }),
  };
  const migrated = migrateTypeKinds(old).project;
  const model = warningsModel(migrated);
  const ask = model.groups[model.groups.length - 1];
  assert.equal(ask.level, "ask");
  assert.equal(ask.code, "typeKind");
  assert.ok(ask.count > 1, "в стартовом справочнике типов без меток много");
  assert.equal(ask.title, "Типов с выведенным видом: " + ask.count);
  // Вопрос ведёт к типу, а строка объясняет, почему спрашивают.
  assert.equal(ask.items[0].place.typeId, ask.items[0].typeId);
  assert.equal(ask.items[0].message, strings.warnings.kindNoMarks);

  // Ответ — та же команда справочника: вид записан, отметка снята, строка ушла.
  const answered = updateType(migrated, ask.items[0].typeId, { kind: "point" }).project;
  const after = warningsModel(answered).groups[warningsModel(answered).groups.length - 1];
  assert.equal(after.count, ask.count - 1);
  assert.ok(!after.items.some((item) => item.typeId === ask.items[0].typeId));

  // «Все верны» убирает остаток — и на этом вопросы кончаются.
  const closed = closeTypeKindReview(answered).project;
  assert.equal(warningsModel(closed).total, 0);
});

test("панель ничего не правит сама: объект после подсчёта тот же", () => {
  const box = house();
  const old = {
    ...box.project,
    formatVersion: 2,
    markTypes: box.project.markTypes.map((type) => {
      const copy = { ...type };
      delete copy.kind;
      delete copy.kindGuessed;
      return copy;
    }),
  };
  const migrated = migrateTypeKinds(old).project;
  const before = JSON.stringify(migrated);
  warningsModel(migrated);
  warningsModel(box.project);
  assert.equal(JSON.stringify(migrated), before, "подсчёт предупреждений тронул объект");
});

test("метка без помещения — это метка без ссылки, а не предупреждение", () => {
  const box = house();
  // Пустое помещение — норма разметки: половина меток так и стоит.
  assert.equal(warningsModel(box.project).total, 0);
  const room = addRoom(box.project, { name: "Спальная" });
  const project = updateMark(room.project, box.lamps[0], { roomId: room.room.id }).project;
  assert.equal(warningsModel(project).total, 0);
});
