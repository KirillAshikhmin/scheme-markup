// Строка добавления типа: вид и знак задаются сразу, а не вторым заходом.
//
// Проверяется чистая половина строки — черновик, который она держит до нажатия
// «Добавить тип», и то, что модель получает из него ровно выбранное. Сами
// кнопки и сетки знаков — ручная приёмка: DOM здесь не поднимается.
import test from "node:test";
import assert from "node:assert/strict";

import { addCategory, addType, createProject, styleOf, typeKindOf } from "../src/model.js";
import {
  typesAddDraft,
  typesAddErrorField,
  typesDraftKind,
  typesDraftSign,
  typesDraftStyle,
} from "../src/panels/types.js";

// Объект с двумя категориями: у одной свой знак и своё начертание, у другой —
// другие. Наследование должно ходить за категорией, а не за первой попавшейся.
function objectWithCategories() {
  const empty = createProject({ name: "Объект", categories: [], markTypes: [] });
  const light = addCategory(empty, {
    name: "Свет",
    color: "#1F6FEB",
    shape: "triangle-down",
    lineStyle: "wave",
  });
  const power = addCategory(light.project, {
    name: "Розетки",
    color: "#D1242F",
    shape: "circle-socket",
    lineStyle: "dashed",
  });
  return { project: power.project, light: light.category, power: power.category };
}

test("умолчание строки добавления — точка со знаком категории", () => {
  const { project, light } = objectWithCategories();
  const draft = typesAddDraft(light.id);

  assert.equal(draft.kind, "point");
  assert.equal(draft.shape, null);
  assert.equal(draft.lineStyle, null);

  // «Как у категории» — это первая клетка палитры, и в строке она видна
  // знаком самой категории.
  const style = typesDraftStyle(draft, light);
  assert.deepEqual(style, { kind: "point", color: "#1F6FEB", shape: "triangle-down", lineStyle: "wave" });

  // Тип, которому ничего не выбрали, наследует знак — как и прежде.
  const added = addType(project, { ...draft, code: "Т", name: "Точечный светильник" });
  assert.equal(added.type.shape, null);
  assert.equal(typeKindOf(added.project, added.type.id), "point");
  assert.equal(styleOf(added.project, added.type.id).shape, "triangle-down");
});

test("линейный тип заводится одним заходом: вид и начертание приезжают вместе с типом", () => {
  const { project, light } = objectWithCategories();
  const draft = typesDraftSign(typesDraftKind(typesAddDraft(light.id), "line"), "dash-dot");

  const added = addType(project, { ...draft, code: "ТР", name: "Трек" });
  assert.equal(typeKindOf(added.project, added.type.id), "line");
  assert.equal(added.type.lineStyle, "dash-dot");
  assert.equal(styleOf(added.project, added.type.id).lineStyle, "dash-dot");
  // Фигуру линейному никто не выбирал — она осталась наследованной.
  assert.equal(added.type.shape, null);
});

test("смена вида после выбора знака ничего не стирает: знаки двух видов лежат порознь", () => {
  const { light } = objectWithCategories();
  const chosen = typesDraftSign(typesAddDraft(light.id), "square-bar");
  const asLine = typesDraftKind(chosen, "line");

  // У линейного предлагается начертание, и своего пока нет — значит категорийное.
  assert.equal(asLine.shape, "square-bar");
  assert.equal(asLine.lineStyle, null);
  assert.equal(typesDraftStyle(asLine, light).lineStyle, "wave");

  const styled = typesDraftSign(asLine, "double");
  assert.equal(styled.shape, "square-bar");
  assert.equal(styled.lineStyle, "double");

  // Вернулись к точке — вернулась и выбранная фигура, второй раз её не ищут.
  const back = typesDraftKind(styled, "point");
  assert.equal(typesDraftStyle(back, light).shape, "square-bar");
  assert.equal(back.lineStyle, "double");
});

test("знак наследуется у выбранной категории, а не у первой в справочнике", () => {
  const { light, power } = objectWithCategories();
  const draft = typesAddDraft(light.id);
  const moved = { ...draft, categoryId: power.id };

  assert.deepEqual(typesDraftStyle(moved, power), {
    kind: "point",
    color: "#D1242F",
    shape: "circle-socket",
    lineStyle: "dashed",
  });
  // Выбранное своё сильнее категорийного — в этом и смысл выбора знака.
  assert.equal(typesDraftStyle(typesDraftSign(moved, "square-cross"), power).shape, "square-cross");
});

test("черновик неизменяем, а чужой вид его не портит", () => {
  const draft = typesAddDraft("категория");
  assert.notEqual(typesDraftKind(draft, "line"), draft);
  assert.equal(typesDraftKind(draft, "line").kind, "line");
  // Мусор вместо вида оставляет черновик как был: строка не должна показывать
  // ни фигуру, ни начертание «третьего» вида.
  assert.equal(typesDraftKind(draft, "кривая"), draft);
  assert.equal(draft.kind, "point");

  // Категории нет вовсе — знак всё равно рисуется, первым из палитры.
  assert.deepEqual(typesDraftStyle(draft, null), {
    kind: "point",
    color: "#57606A",
    shape: "circle",
    lineStyle: "solid",
  });
});

// Отказ модели строку добавления больше не перерисовывает: набранное остаётся
// на месте, а курсор идёт в то поле, которое не приняли. Разводит их `error.code`
// — здесь проверяется, что коды, которые модель и правда бросает, доходят до
// своего поля, а не теряются по дороге.
test("отказ добавления называет поле, которое править", () => {
  const { project, light } = objectWithCategories();
  const withType = addType(project, { code: "В", name: "Выключатель", categoryId: light.id }).project;

  const refusal = (patch) => {
    try {
      addType(withType, { code: "Св", name: "Светильник", categoryId: light.id, ...patch });
    } catch (error) {
      return { code: error.code, field: typesAddErrorField(error.code) };
    }
    return null;
  };

  assert.deepEqual(refusal({ code: "В" }), { code: "codeTaken", field: "code" });
  assert.deepEqual(refusal({ code: "в" }), { code: "codeTaken", field: "code" });
  assert.deepEqual(refusal({ code: "" }), { code: "codeRequired", field: "code" });
  assert.deepEqual(refusal({ code: "  " }), { code: "codeRequired", field: "code" });
  assert.deepEqual(refusal({ code: "В1" }), { code: "codeLetters", field: "code" });
  assert.deepEqual(refusal({ code: "Выключательподсветки" }), { code: "codeTooLong", field: "code" });
  assert.deepEqual(refusal({ name: "" }), { code: "nameRequired", field: "name" });

  // Чужой код поля не назначает: подсвечивать нечего, а ошибку человек всё
  // равно прочтёт уведомлением.
  assert.equal(typesAddErrorField("categoryNotFound"), null);
  assert.equal(typesAddErrorField(undefined), null);
});

// Главное в отказе — не подсветка, а то, что перерисовывать нечего: объект
// после неудачной команды тот же самый, и строка вправе остаться с набранным.
test("неудачное добавление не трогает объект", () => {
  const { project, light } = objectWithCategories();
  const withType = addType(project, { code: "В", name: "Выключатель", categoryId: light.id }).project;

  assert.throws(() => addType(withType, { code: "В", name: "Второй", categoryId: light.id }));
  assert.equal(withType.markTypes.length, 1);
  assert.deepEqual(
    withType.markTypes.map((type) => type.code),
    ["В"],
  );
});
