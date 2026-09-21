// Панель предупреждений: список того, что нашёл `validate`, и переход к
// виновнику.
//
// Со стартовым справочником заказчика панель показывает ещё и сведения о самом
// справочнике: повторы знака и похожие цвета категорий. Их проверяет свой тест,
// а остальные смотрят на объект через `panelModel` — без этих строк.
//
// Проверяется чистая часть панели — состав списка, группировка одинаковых
// строк в счётчик и адрес виновника. Сам выпадающий список, клик и наведение
// холста — DOM, его проверяет приёмка.
import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptProblem,
  addMark,
  addRoom,
  addScheme,
  closeTypeKindReview,
  compactAllNumbers,
  createProject,
  migrateTypeKinds,
  setMarkNumber,
  unacceptProblem,
  updateMark,
  updateType,
  validate,
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

// Стартовый справочник — справочник рабочего объекта заказчика, и он приезжает
// со своими сведениями: пять знаков, которые носят по нескольку типов, и пять
// пар категорий с похожим цветом. Это выбор заказчика, сделанный по числам, в
// каждом новом объекте он один и тот же, и отдельный тест ниже смотрит именно
// на него. Остальные тесты этого файла — про метки, связи и виды, поэтому
// строки справочника снимаются с модели одним местом.
const DICTIONARY_CODES = ["sharedShape", "closeColors"];

function panelModel(project) {
  const model = warningsModel(project);
  const groups = model.groups.filter((group) => !DICTIONARY_CODES.includes(group.code));
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  return { ...model, groups, total, level: total === 0 ? "ok" : groups[0].level };
}

// Справочник заказчика — в панели предупреждений, как и просил тикет: строками,
// которые видно, а не падением сборки. Каждую можно закрыть «так и задумано» —
// и тогда панель у нового объекта снова говорит «смотреть нечего».
test("новый объект рассказывает о своём справочнике: повторы знака и похожие цвета", () => {
  const model = warningsModel(createProject());
  const shapes = model.groups.find((group) => group.code === "sharedShape");
  const colors = model.groups.find((group) => group.code === "closeColors");
  assert.ok(shapes, "повторы знака не доехали до панели");
  assert.ok(colors, "похожие цвета не доехали до панели");
  assert.equal(shapes.level, "warning", "повтор знака — не ошибка объекта");
  assert.equal(colors.level, "warning", "похожий цвет — не ошибка объекта");
  assert.equal(shapes.count, 5, "знаков, которые носят несколько типов: " + shapes.count);
  assert.equal(colors.count, 5, "пар категорий с похожим цветом: " + colors.count);
  assert.equal(shapes.title, "Знаков, которые носят несколько типов: 5");
  assert.equal(colors.title, "Пар категорий с похожим цветом: 5");
  // Семь типов света названы поимённо: строку читают, а не считают.
  assert.ok(shapes.items.some((item) => item.message.includes("Т, С, ПК, ПС, ППл, ЛЮ, Бр")));
  assert.ok(colors.items.some((item) => item.message.includes("Не назначено") && item.message.includes("21,4")));
  // Ошибок среди них нет: объект цел.
  assert.equal(model.groups.every((group) => group.level !== "error"), true);

  // Переход ведёт к виновнику на плане: у знака — к метке его типа, у цвета —
  // к метке любого типа этой категории. Меток нет — перехода нет, и это не
  // поломка: строку всё равно читают.
  // На пустом объекте адрес есть, но метки в нём нет: идти на плане не к чему.
  assert.equal(shapes.items[0].place.markId, null);
  const box = house();
  const placed = warningsModel(box.project);
  const shapeRow = placed.groups.find((group) => group.code === "sharedShape").items[0];
  assert.equal(shapeRow.place.markId, box.lamps[0], "повтор знака не ведёт к метке этого типа");
  const colorRow = placed.groups
    .find((group) => group.code === "closeColors")
    .items.find((item) => item.message.includes("Домофон"));
  assert.equal(colorRow.place, null, "у домофона на этом объекте меток нет");

  // «Так и задумано» закрывает строку и больше её не показывает.
  let project = createProject();
  for (const problem of validate(project)) {
    if (DICTIONARY_CODES.includes(problem.code)) project = acceptProblem(project, problem).project;
  }
  const after = warningsModel(project);
  assert.equal(after.total, 0, "закрытая строка справочника вернулась");
  assert.equal(after.level, "ok");
  assert.equal(after.accepted.length, 10);
  assert.equal(after.accepted.every((record) => record.level === "warning"), true);
});

test("чистый объект: смотреть нечего, и это видно", () => {
  const box = house();
  const model = panelModel(box.project);
  assert.equal(model.total, 0);
  assert.equal(model.level, "ok");
  assert.deepEqual(model.groups, []);
  assert.deepEqual(model.accepted, []);
  // Объекта нет вовсе — та же хорошая новость, а не поломка.
  assert.deepEqual(panelModel(null), { total: 0, level: "ok", groups: [], accepted: [] });
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
  const model = panelModel(broken);
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
  const model = panelModel(project);
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
  const group = panelModel(project).groups.find((item) => item.code === "markWithoutRoom");
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
  for (const item of panelModel(project).groups.flatMap((item) => item.items)) {
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
  const messages = panelModel(broken)
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
  const place = panelModel(project).groups[0].items[0].place;
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
  const group = panelModel(project).groups.find((item) => item.code === "typeKindMixed");
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
  const group = panelModel(project).groups.find((item) => item.code === "smallGroup");
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
  const model = panelModel(migrated);
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
  const after = panelModel(answered).groups[panelModel(answered).groups.length - 1];
  assert.equal(after.count, ask.count - 1);
  assert.ok(!after.items.some((item) => item.typeId === ask.items[0].typeId));

  // «Все верны» убирает остаток — и на этом вопросы кончаются.
  const closed = closeTypeKindReview(answered).project;
  assert.equal(panelModel(closed).total, 0);
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
  panelModel(migrated);
  panelModel(box.project);
  assert.equal(JSON.stringify(migrated), before, "подсчёт предупреждений тронул объект");
});

test("метка без помещения — это метка без ссылки, а не предупреждение", () => {
  const box = house();
  // Пустое помещение — норма разметки: половина меток так и стоит.
  assert.equal(panelModel(box.project).total, 0);
  const room = addRoom(box.project, { name: "Спальная" });
  const project = updateMark(room.project, box.lamps[0], { roomId: room.room.id }).project;
  assert.equal(panelModel(project).total, 0);
});

// ——— «так и задумано» —————————————————————————————————————————————————
//
// Три светильника одной группы носят Т4 намеренно. Крестик в строке убирает
// её из списка, ответ ложится в объект, а внизу панели остаётся строка
// «Принято: N», из которой принятое возвращается в работу.

function withRepeat() {
  const box = house();
  // Т1 Т1 Т1: повтор номера, тот самый приём заказчика.
  let project = setMarkNumber(box.project, box.lamps[1], 1).project;
  project = setMarkNumber(project, box.lamps[2], 1).project;
  const problem = validate(project).find((item) => item.code === "repeatedNumber");
  return { ...box, project, problem };
}

test("принятое уходит из списка, счётчик уменьшается, а строка «Принято» остаётся", () => {
  const box = withRepeat();
  const before = panelModel(box.project);
  assert.equal(before.total, 1);
  assert.equal(before.level, "warning");
  // Строка знает свою проблему — ею и принимают: в ней ключ, вид и текст.
  assert.equal(before.groups[0].items[0].problem.key, box.problem.key);

  const accepted = acceptProblem(box.project, box.problem).project;
  const after = panelModel(accepted);
  assert.equal(after.total, 0, "счётчик в шапке считает то, что ещё ждёт ответа");
  assert.equal(after.level, "ok");
  assert.deepEqual(after.groups, []);
  assert.equal(after.accepted.length, 1);
  assert.equal(after.accepted[0].label, "Т1 — таких меток 3");
  assert.equal(after.accepted[0].level, "warning");

  // Вернули в работу — предупреждение снова в списке, принятых нет.
  const back = unacceptProblem(accepted, after.accepted[0].key).project;
  assert.equal(panelModel(back).total, 1);
  assert.deepEqual(panelModel(back).accepted, []);
});

test("принятое не возвращается, когда в группе становится ещё одна метка", () => {
  const box = withRepeat();
  const accepted = acceptProblem(box.project, box.problem).project;
  // Четвёртый светильник той же группы: номер повторяется у четырёх меток —
  // вопрос тот же, ответ на него уже дан.
  const more = addMark(accepted, {
    schemeId: box.schemeId,
    typeId: box.idOf("Т"),
    kind: "point",
    points: [{ x: 0.8, y: 0.3 }],
  });
  const grown = setMarkNumber(more.project, more.mark.id, 1).project;
  assert.equal(validate(grown).find((item) => item.code === "repeatedNumber").message, "Т1 — таких меток 4");
  assert.equal(panelModel(grown).total, 0, "четвёртая метка вернула закрытую строку");
  assert.equal(panelModel(grown).accepted.length, 1);
});

test("смыкание номеров не возвращает принятого", () => {
  const box = withRepeat();
  // Дыра в нумерации: Т2 удалён, смыкание сдвинет Т3 на Т2.
  const other = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: box.idOf("Т"),
    kind: "point",
    points: [{ x: 0.9, y: 0.3 }],
  });
  const project = setMarkNumber(other.project, other.mark.id, 5).project;
  const problem = validate(project).find((item) => item.code === "repeatedNumber");
  const accepted = acceptProblem(project, problem).project;
  assert.equal(panelModel(accepted).total, 0);

  const compacted = compactAllNumbers(accepted).project;
  assert.equal(panelModel(compacted).total, 0, "после смыкания тот же вопрос задан заново");
  assert.equal(panelModel(compacted).accepted.length, 1);
});

test("принятая ошибка видна в списке принятых отдельно от предупреждения", () => {
  const box = withRepeat();
  const broken = {
    ...box.project,
    marks: box.project.marks.map((mark) =>
      mark.id === box.track ? { ...mark, roomId: "помещения-нет" } : mark,
    ),
  };
  const error = validate(broken).find((item) => item.code === "markWithoutRoom");
  let project = acceptProblem(broken, error).project;
  project = acceptProblem(project, box.problem).project;

  const model = panelModel(project);
  assert.equal(model.total, 0);
  assert.deepEqual(
    model.accepted.map((record) => [record.level, record.code]),
    [
      ["error", "markWithoutRoom"],
      ["warning", "repeatedNumber"],
    ],
    "принятая ошибка обязана отличаться от принятого предупреждения",
  );
});
