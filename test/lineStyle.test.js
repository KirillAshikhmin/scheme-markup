// Начертание линии и новые обозначения.
//
// Линейной меткой рисуют ленту, трек и условные линии. Сплошная и пунктирная
// значат разное, и значит начертание — часть условного обозначения, а не
// украшение одной метки: иначе легенда объяснить его не сможет, а две метки
// одного типа будут означать разное.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LINE_STYLES,
  SHAPE_PALETTE,
  addCategory,
  addMark,
  addScheme,
  addType,
  createProject,
  defaultTemplate,
  styleOf,
  typesInOrder,
  updateCategory,
  updateType,
} from "../src/model.js";
import { dashPattern, drawScheme } from "../src/render.js";
import { strings } from "../src/strings.js";

test("начертание линии живёт там же, где форма: у категории с перебивкой у типа", () => {
  const project = createProject();
  const light = project.categories.find((item) => item.name === "Свет");
  const track = project.markTypes.find((item) => item.code === "ТР");

  // По умолчанию линия сплошная — как было до пунктира.
  assert.equal(styleOf(project, track.id).lineStyle, "solid");

  // Категория задаёт начертание своим типам, тип его перебивает — тем же
  // правилом, что и форма. Третьего правила в сборке нет.
  const dashedCategory = updateCategory(project, light.id, { lineStyle: "dashed" }).project;
  assert.equal(styleOf(dashedCategory, track.id).lineStyle, "dashed");
  const solidType = updateType(dashedCategory, track.id, { lineStyle: "solid" }).project;
  assert.equal(styleOf(solidType, track.id).lineStyle, "solid");

  const added = addType(project, { code: "УЛ", name: "Условная линия", categoryId: light.id, lineStyle: "dashed" });
  assert.equal(styleOf(added.project, added.type.id).lineStyle, "dashed");
  assert.deepEqual(LINE_STYLES, ["solid", "dashed"]);
});

test("чужое начертание модель не берёт", () => {
  const project = createProject();
  const light = project.categories.find((item) => item.name === "Свет").id;
  // Точка-тире нарисована не будет: рисовать её нечем, и молчаливая подмена
  // на сплошную означала бы линию не того смысла.
  assert.throws(() => addType(project, { code: "ШТ", name: "Штрих", categoryId: light, lineStyle: "dash-dot" }), {
    code: "lineStyleUnknown",
  });
  assert.throws(() => addCategory(project, { name: "Слаботочка", color: "#1F6FEB", shape: "circle", lineStyle: 2 }), {
    code: "lineStyleUnknown",
  });
});

test("в справочник добавлен проходной переключатель, прежние типы не тронуты", () => {
  const { markTypes } = defaultTemplate();
  const codes = markTypes.map((type) => type.code);
  // Тринадцать типов заказчика целы и идут в прежнем порядке; новый встал в
  // свою категорию, рядом с выключателями, а не в хвост списка.
  assert.deepEqual(
    codes.filter((code) => code !== "ВП"),
    ["Т", "С", "ПК", "ТР", "П", "Л", "ПШ", "В", "ВВ", "Р", "Б", "К", "W"],
  );
  assert.equal(codes.length, 14, "в шаблоне должен появиться ровно один новый тип");

  const project = createProject();
  const way = project.markTypes.find((type) => type.code === "ВП");
  assert.ok(way, "проходного переключателя нет в шаблоне");
  assert.equal(way.name, strings.types.switchWay);
  const switches = typesInOrder(project).find((group) => group.category.name === "Выключатели");
  assert.deepEqual(switches.types.map((type) => type.code), ["В", "ВВ", "ВП"]);
  // Свой значок: иначе он рисуется тем же зелёным кругом, что и остальные два.
  assert.ok(SHAPE_PALETTE.includes(styleOf(project, way.id).shape), "значок переключателя не из палитры");
  assert.notEqual(styleOf(project, way.id).shape, styleOf(project, project.markTypes.find((t) => t.code === "В").id).shape);
});

// Холста в Node нет, поэтому рисованию подставляется заглушка: она принимает
// любые вызовы и записывает узор пунктира. Это тот же приём, которым
// проверяются легенда и подсказка угла.
const drawProbe = () => {
  const target = {
    dashes: [],
    measureText: (value) => ({ width: String(value).length * 7 }),
    setLineDash: (pattern) => target.dashes.push(pattern),
  };
  return new Proxy(target, { get: (object, key) => (key in object ? object[key] : () => {}), set: () => true });
};

const drawnDashes = (project, scheme) => {
  const ctx = drawProbe();
  drawScheme(ctx, { project, scheme, view: { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 } });
  return ctx.dashes.filter((pattern) => Array.isArray(pattern) && pattern.length > 0);
};

test("пунктирный тип рисуется пунктиром, сплошной — сплошным", () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const light = made.project.categories.find((item) => item.name === "Свет").id;
  const dashed = addType(made.project, {
    code: "УЛ",
    name: "Условная линия",
    categoryId: light,
    lineStyle: "dashed",
  });
  const points = [
    { x: 0.2, y: 0.5 },
    { x: 0.8, y: 0.5 },
  ];
  const solidLine = addMark(made.project, {
    schemeId: made.scheme.id,
    typeId: made.project.markTypes.find((type) => type.code === "ТР").id,
    kind: "line",
    points,
  });
  const dashedLine = addMark(dashed.project, { schemeId: made.scheme.id, typeId: dashed.type.id, kind: "line", points });

  assert.deepEqual(drawnDashes(solidLine.project, solidLine.project.schemes[0]), [], "сплошная линия ушла в пунктир");
  const pattern = drawnDashes(dashedLine.project, dashedLine.project.schemes[0]);
  assert.equal(pattern.length, 1, "пунктирная линия нарисована сплошной");
  // Штрих и просвет заметны на бумаге и не сливаются: метка радиусом 10.
  assert.ok(pattern[0][0] >= 8 && pattern[0][1] >= 5, "узор пунктира: " + pattern[0].join("/"));
  // Узор растёт с масштабом вместе с меткой — иначе выгрузка разойдётся с экраном.
  assert.deepEqual(dashPattern(20), pattern[0].map((value) => value * 2));
});
