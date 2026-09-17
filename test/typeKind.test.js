// Вид типа: точка или линия.
//
// Поле `type.kind` появилось у типов позже самих типов, и главное здесь — не
// оно, а миграция. У заказчика на руках размеченные объекты, и правка, после
// которой такой объект открывается иначе, чем закрывался, — это испорченная
// работа, а не обновление. Поэтому вид выводится из того, что уже нарисовано:
// где ответ однозначен — молча, где приходится гадать — вид проставляется, но
// показывается пользователю списком на правку.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MARK_KINDS,
  addMark,
  addScheme,
  addType,
  addTypesFromCatalog,
  catalogOffer,
  closeTypeKindReview,
  createProject,
  labelOf,
  migrateTypeKinds,
  styleOf,
  typeKindGuess,
  typeKindOf,
  typeKindReview,
  updateType,
  validate,
} from "../src/model.js";
import { FORMAT_VERSION, unpackProject, writeZip } from "../src/projectFile.js";

const LINE = [
  { x: 0.2, y: 0.4 },
  { x: 0.8, y: 0.4 },
];

// Объект с разметкой: точечный тип, линейный тип, тип с метками обоих видов и
// тип без единой метки. Ровно те четыре случая, которые разбирает миграция.
function markedProject() {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 600 });
  const schemeId = made.scheme.id;
  let project = made.project;
  const idOf = (code) => project.markTypes.find((type) => type.code === code).id;

  // Точки: обычная разметка светильников.
  for (const at of [0.2, 0.4, 0.6]) {
    project = addMark(project, { schemeId, typeId: idOf("Т"), kind: "point", points: [{ x: at, y: 0.3 }] }).project;
  }
  // Линии: трек рисовали линией от начала и до конца.
  project = addMark(project, { schemeId, typeId: idOf("ТР"), kind: "line", points: LINE }).project;
  project = addMark(project, {
    schemeId,
    typeId: idOf("ТР"),
    kind: "line",
    points: [
      { x: 0.2, y: 0.6 },
      { x: 0.5, y: 0.9 },
    ],
  }).project;
  // Смешанный: лентой размечали и линию, и отдельные точки.
  project = addMark(project, { schemeId, typeId: idOf("Л"), kind: "line", points: LINE }).project;
  project = addMark(project, { schemeId, typeId: idOf("Л"), kind: "point", points: [{ x: 0.7, y: 0.7 }] }).project;
  return { project, schemeId, idOf };
}

// Так выглядел project.json до того, как у типа появился вид.
function asOldFormat(project) {
  return {
    ...project,
    formatVersion: 2,
    markTypes: project.markTypes.map((type) => {
      const copy = { ...type };
      delete copy.kind;
      delete copy.kindGuessed;
      return copy;
    }),
  };
}

test("вид выводится по меткам типа: однозначное — молча, догадка — с отметкой", () => {
  const { project, idOf } = markedProject();
  const old = asOldFormat(project);

  assert.deepEqual(typeKindGuess(old, idOf("Т")), { kind: "point", reason: "marks" });
  assert.deepEqual(typeKindGuess(old, idOf("ТР")), { kind: "line", reason: "marks" });
  assert.deepEqual(typeKindGuess(old, idOf("Л")), { kind: "point", reason: "mixed" });
  assert.deepEqual(typeKindGuess(old, idOf("В")), { kind: "point", reason: "noMarks" });

  const migrated = migrateTypeKinds(old).project;
  const kindOf = (code) => migrated.markTypes.find((type) => type.code === code).kind;
  assert.equal(kindOf("Т"), "point");
  assert.equal(kindOf("ТР"), "line");
  assert.equal(kindOf("Л"), "point");
  assert.equal(kindOf("В"), "point");
  for (const type of migrated.markTypes) assert.ok(MARK_KINDS.includes(type.kind), "тип без вида: " + type.code);

  // Отметка «это догадка» стоит только там, где гадали: у типа с метками
  // одного вида ответ однозначен, и спрашивать не о чем.
  const guessed = migrated.markTypes.filter((type) => type.kindGuessed).map((type) => type.code);
  assert.deepEqual(
    guessed,
    migrated.markTypes.map((type) => type.code).filter((code) => code !== "Т" && code !== "ТР"),
  );
  assert.equal(migrated.markTypes.find((type) => type.code === "Л").kindGuessed, "mixed");
  assert.equal(migrated.markTypes.find((type) => type.code === "В").kindGuessed, "noMarks");
});

test("миграция не трогает ни метку, ни номер, ни подпись, ни начертание", () => {
  const { project } = markedProject();
  const old = asOldFormat(project);
  const migrated = migrateTypeKinds(old).project;

  assert.deepEqual(migrated.marks, old.marks, "метки поехали");
  assert.deepEqual(migrated.counters, old.counters, "счётчики поехали");
  assert.deepEqual(migrated.groups, old.groups);
  // Отметка времени — часть «объект открылся как закрывался»: открытие не
  // должно выглядеть правкой ни в списке объектов, ни в папке автосохранения.
  assert.equal(migrated.updatedAt, old.updatedAt);
  for (const mark of old.marks) {
    assert.equal(labelOf(migrated, mark.id), labelOf(old, mark.id), "подпись метки изменилась");
  }
  for (const type of old.markTypes) {
    assert.deepEqual(styleOf(migrated, type.id), styleOf(old, type.id), "обозначение типа изменилось: " + type.code);
  }
});

test("мигрировать нечего — возвращается тот же объект, без шага истории", () => {
  const { project } = markedProject();
  const again = migrateTypeKinds(project);
  assert.equal(again.project, project, "объект пересобран на пустом месте");
  assert.deepEqual(again.guessed, []);

  // И повторная миграция уже мигрированного ничего не меняет: упаковка гоняет
  // объект через неё дважды, и разойдись она сама с собой — сверка архива
  // падала бы на ровном месте.
  const once = migrateTypeKinds(asOldFormat(project)).project;
  assert.equal(migrateTypeKinds(once).project, once);
});

test("список на правку — только типы с догадкой; закрыт — больше не показывается", () => {
  const { project, idOf } = markedProject();
  const migrated = migrateTypeKinds(asOldFormat(project)).project;
  const rows = typeKindReview(migrated);
  const byCode = new Map(rows.map((row) => [row.code, row]));

  assert.ok(!byCode.has("Т") && !byCode.has("ТР"), "в списке типы, вид которых выведен однозначно");
  assert.deepEqual(byCode.get("Л"), { typeId: idOf("Л"), code: "Л", name: byCode.get("Л").name, kind: "point", reason: "mixed" });
  assert.equal(byCode.get("В").reason, "noMarks");

  // Ответ на строку снимает отметку с этого типа, остальные ждут своего.
  const answered = updateType(migrated, idOf("Л"), { kind: "line" }).project;
  assert.equal(typeKindOf(answered, idOf("Л")), "line");
  assert.ok(!typeKindReview(answered).some((row) => row.code === "Л"));
  assert.ok(typeKindReview(answered).length === rows.length - 1);

  // Закрыл — отметка снята со всех, и список не соберётся второй раз.
  const closed = closeTypeKindReview(answered).project;
  assert.deepEqual(typeKindReview(closed), []);
  assert.equal(closeTypeKindReview(closed).project, closed, "закрывать нечего — объект не пересобирается");
  // Сами виды при этом остались теми же: закрытие списка — не смена вида.
  for (const type of closed.markTypes) {
    assert.equal(type.kind, answered.markTypes.find((item) => item.id === type.id).kind);
  }
  assert.deepEqual(closed.marks, migrated.marks, "закрытие списка тронуло метки");
});

test("у нового объекта список не показывается: там нечего угадывать", () => {
  const project = createProject();
  assert.deepEqual(typeKindReview(project), []);
  // Вид у каждого типа проставлен, и это не догадка, а шаблон: пять типов
  // света линейные по слову заказчика, остальные точечные.
  for (const type of project.markTypes) assert.ok(MARK_KINDS.includes(type.kind), "тип без вида: " + type.code);
  assert.deepEqual(
    project.markTypes.filter((type) => type.kind === "line").map((type) => type.code),
    ["ТР", "Л", "ПШ", "ПКШ", "КШ"],
  );
});

test("тип с метками другого вида виден в проверке объекта предупреждением", () => {
  const { project, idOf } = markedProject();
  const migrated = migrateTypeKinds(asOldFormat(project)).project;
  const mixed = validate(migrated).filter((item) => item.code === "typeKindMixed");
  assert.equal(mixed.length, 1, "предупреждений о смешанных метках: " + mixed.length);
  assert.equal(mixed[0].ref, idOf("Л"));
  assert.equal(mixed[0].kind, "warning", "это предупреждение, а не ошибка: объект рабочий");
  assert.match(mixed[0].message, /Л/);

  // Переключил вид у смешанного типа — предупреждение осталось, только теперь
  // о точках: метки по-прежнему разных видов, и молчать об этом нельзя.
  const asLine = updateType(migrated, idOf("Л"), { kind: "line" }).project;
  assert.equal(validate(asLine).filter((item) => item.code === "typeKindMixed").length, 1);
  // У объекта, где всё сошлось, предупреждения нет вовсе.
  assert.equal(validate(createProject()).filter((item) => item.code === "typeKindMixed").length, 0);
});

test("вид типа проверяется, а чужое значение не принимается", () => {
  const project = createProject();
  const light = project.categories.find((item) => item.name === "Свет").id;
  assert.throws(() => addType(project, { code: "УЛ", name: "Линия", categoryId: light, kind: "кривая" }), {
    code: "unknownKind",
  });
  const added = addType(project, { code: "УЛ", name: "Линия", categoryId: light, kind: "line" });
  assert.equal(added.type.kind, "line");
  assert.equal(typeKindOf(added.project, added.type.id), "line");
  assert.throws(() => updateType(added.project, added.type.id, { kind: null }), { code: "unknownKind" });
});

// G68 — правило заказчика: «все изменения не должны ломать текущий проект,
// должны быть миграции». Объект прежней версии формата открывается тем же
// путём, каким его откроет пользователь, и сверяется по существу: метки,
// номера, подписи и начертания.
test("объект прежней версии формата открывается, и в нём ничего не изменилось", async () => {
  const { project } = markedProject();
  const old = asOldFormat(project);
  const file = await writeZip([{ name: "project.json", data: JSON.stringify(old) }]);
  const restored = (await unpackProject(file)).project;

  assert.equal(restored.formatVersion, FORMAT_VERSION);
  // Ни одна метка: ни точка, ни вершина линии, ни вид, ни смещение подписи.
  assert.deepEqual(restored.marks, old.marks);
  // Ни один номер и ни один счётчик.
  assert.deepEqual(restored.counters, old.counters);
  assert.deepEqual(
    restored.marks.map((mark) => mark.number),
    old.marks.map((mark) => mark.number),
  );
  // Ни одна подпись — ни у метки, ни у блока.
  for (const mark of old.marks) assert.equal(labelOf(restored, mark.id), labelOf(old, mark.id));
  for (const group of old.groups) assert.equal(labelOf(restored, group.id), labelOf(old, group.id));
  // Ни одно начертание и ни одна фигура.
  for (const type of old.markTypes) assert.deepEqual(styleOf(restored, type.id), styleOf(old, type.id));
  // Справочник целиком тот же, кроме дописанного вида.
  assert.deepEqual(
    restored.markTypes.map((type) => {
      const copy = { ...type };
      delete copy.kind;
      delete copy.kindGuessed;
      return copy;
    }),
    old.markTypes,
  );
  assert.deepEqual(restored.categories, old.categories);
  assert.deepEqual(restored.rooms, old.rooms);
  assert.deepEqual(restored.schemes, old.schemes);
  assert.equal(restored.updatedAt, old.updatedAt);

  // И вид при этом выведен по правилам, а не подставлен всем подряд.
  const kindOf = (code) => restored.markTypes.find((type) => type.code === code).kind;
  assert.equal(kindOf("ТР"), "line");
  assert.equal(kindOf("Т"), "point");
  assert.ok(typeKindReview(restored).length > 0, "догадки есть, а спросить о них некого");
});

// Начертание — часть обозначения, и в файл оно обязано доехать целиком:
// объект, у которого волнистая линия открылась сплошной, — испорченная работа.
test("вид и начертание доезжают в файл проекта и обратно", async () => {
  const { project, idOf } = markedProject();
  const wavy = updateType(updateType(project, idOf("ТР"), { kind: "line" }).project, idOf("ТР"), {
    lineStyle: "wave",
  }).project;
  const file = await writeZip([{ name: "project.json", data: JSON.stringify(wavy) }]);
  const restored = (await unpackProject(file)).project;
  assert.equal(typeKindOf(restored, idOf("ТР")), "line");
  assert.equal(styleOf(restored, idOf("ТР")).lineStyle, "wave");
  assert.deepEqual(restored.markTypes, wavy.markTypes);
});

// Правка стартового шаблона не трогает размеченный объект: у него свой
// справочник, он скопирован при создании и с тех пор живёт отдельно. Знаки
// выключателей и розетки, вид типов, начертания — всё остаётся тем, с чем
// объект закрывали. А новое из шаблона доезжает до него по требованию —
// кнопкой «Добавить из общей базы», и только отмеченное.
test("правка шаблона не трогает справочник размеченного объекта", () => {
  const { project } = markedProject();
  // Так справочник выглядел до правки шаблона: круги-клавиши у выключателей,
  // квадрат у розетки, все типы точечные.
  const before = {
    ...project,
    markTypes: project.markTypes
      .filter((type) => !["ЛВ", "ПКШ", "КШ", "ВВВ"].includes(type.code))
      .map((type) => {
        const copy = { ...type, kind: "point", lineStyle: null };
        if (type.code === "В") copy.shape = "circle-slash";
        if (type.code === "ВВ") copy.shape = "circle-slash-two";
        if (type.code === "Р") copy.shape = null;
        return copy;
      }),
    categories: project.categories.map((category) =>
      category.name === "Розетки" ? { ...category, shape: "square" } : category,
    ),
  };

  const offer = catalogOffer(before, null);
  const offered = offer.flatMap((group) => group.types.map((type) => type.code));
  assert.deepEqual(offered.sort(), ["ВВВ", "КШ", "ЛВ", "ПКШ"], "общая база предлагает ровно то, чего в объекте нет");

  const added = addTypesFromCatalog(before, null, ["ЛВ", "КШ"]);
  assert.deepEqual(added.types.map((type) => type.code), ["ЛВ", "КШ"]);
  assert.equal(typeKindOf(added.project, added.types[0].id), "point", "лента вертикальная приехала точкой");
  assert.equal(typeKindOf(added.project, added.types[1].id), "line", "карниз приехал линией");
  assert.equal(styleOf(added.project, added.types[1].id).lineStyle, "double", "начертание приехало из базы");

  // А то, что в объекте уже было, не шевельнулось: ни знак, ни вид, ни цвет.
  for (const type of before.markTypes) {
    const now = added.project.markTypes.find((item) => item.id === type.id);
    assert.deepEqual(now, type, "тип объекта изменился от добавления из базы: " + type.code);
  }
  assert.deepEqual(added.project.categories, before.categories, "категории объекта перекрашены или переформлены");
  assert.deepEqual(added.project.marks, before.marks, "метки тронуты");
  assert.equal(styleOf(added.project, typeIdOf(before, "В")).shape, "circle-slash", "знак выключателя в объекте поехал");
  assert.equal(styleOf(added.project, typeIdOf(before, "Р")).shape, "square", "знак розетки в объекте поехал");
});

function typeIdOf(project, code) {
  return project.markTypes.find((type) => type.code === code).id;
}
