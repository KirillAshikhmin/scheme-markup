// Длина подписи блока (D29).
//
// Слова заказчика со снимком: «почему-то у подписей меток слишком большая
// длина». На снимке блок из трёх розеток и витой пары подписан «Р8Р9Р10, RJ2» —
// строка вышла длиннее самого блока и уехала в сторону, перекрыв план.
//
// Укорачивают подпись две разные правки, и обе проверяются здесь:
// 1. **Свёртка** подряд идущих номеров в диапазон — в модели, одним правилом
//    для подписи и плана, и таблицы.
// 2. **Перенос** по запятым, когда и свёрнутая подпись переполнила потолок —
//    в рисовании, потому что это раскладка, а не данные.
//
// Третье и главное: **обозначение метки не меняется**. Свёртка живёт в подписи
// блока; поиск, таблица и выгрузка находят метку по «Р5», как находили.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addToGroup,
  addType,
  blockLabel,
  blockLabelParts,
  createProject,
  deleteMark,
  findGroup,
  labelOf,
  searchProject,
  styleOf,
} from "../src/model.js";
import { drawScheme, labelBox, labelRuns, renderInternals } from "../src/render.js";
import { marksTable } from "../src/tables.js";

const PLAN = { width: 1000, height: 500 };
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Блок «каждая своя» из перечисленных кодов: первая метка и соседки справа.
// «RJ» — витая пара со снимка: в шаблоне такого кода нет, он заводится руками,
// как завёл бы его инженер.
function block(codes) {
  let project = addScheme(createProject(), { name: "1 этаж", ...PLAN }).project;
  const net = project.categories.find((category) => /сет/i.test(category.name)) || project.categories[0];
  project = addType(project, { code: "RJ", name: "Витая пара", categoryId: net.id }).project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const schemeId = project.schemes[0].id;
  const first = addMark(project, { schemeId, typeId: typeOf(codes[0]), points: [{ x: 0.3, y: 0.5 }] });
  project = first.project;
  let last = first.mark.id;
  const ids = [first.mark.id];
  for (const code of codes.slice(1)) {
    const step = addToGroup(project, last, "right", { typeId: typeOf(code) });
    project = step.project;
    last = step.mark.id;
    ids.push(step.mark.id);
  }
  return { project, scheme: project.schemes[0], group: project.groups[0], ids, typeOf };
}

const labelOfBlock = (base) => blockLabel(base.project, base.group.markIds);
const targetOf = (base, project) => ({ ...findGroup(project || base.project, base.group.id) });
const boxOf = (base, project, view) =>
  labelBox(project || base.project, (project || base.project).schemes[0], targetOf(base, project), view || viewOf(), null);

// ——— свёртка в диапазон ————————————————————————————————————————————————

test("три подряд идущих номера сворачиваются в диапазон", () => {
  assert.equal(labelOfBlock(block(["Р", "Р", "Р"])), "Р1–3");
});

test("пара остаётся слитной: диапазон из двух номеров ничего не экономит", () => {
  const pair = block(["Р", "Р"]);
  assert.equal(labelOfBlock(pair), "Р1Р2");
  // Выигрыша нет ни знака — а менять вид подписи без выигрыша незачем: слитная
  // пара стоит на рукописном листе заказчика и такой остаётся.
  assert.equal("Р1–2".length, "Р1Р2".length);
  assert.equal("Р8–9".length, "Р8Р9".length);
});

test("блок из шести сворачивается втрое короче прежнего", () => {
  const six = block(["Р", "Р", "Р", "Р", "Р", "Р"]);
  assert.equal(labelOfBlock(six), "Р1–6");
  const glued = six.ids.map((id) => labelOf(six.project, id)).join("");
  assert.equal(glued, "Р1Р2Р3Р4Р5Р6", "обозначения самих меток обязаны остаться прежними");
  assert.ok(labelOfBlock(six).length * 3 <= glued.length, "свёртка не дала и трети выигрыша");
});

test("дыра в номерах диапазоном не становится", () => {
  const six = block(["Р", "Р", "Р", "Р", "Р", "Р"]);
  const holed = deleteMark(six.project, six.ids[2]).project;
  // Р1 Р2 _ Р4 Р5 Р6: подряд идёт пара и тройка, между ними запятая. Диапазон
  // обещает, что внутри есть каждый номер, — через дыру он соврал бы.
  assert.equal(blockLabel(holed, holed.groups[0].markIds), "Р1Р2, Р4–6");

  const gapped = deleteMark(holed, six.ids[4]).project;
  assert.equal(blockLabel(gapped, gapped.groups[0].markIds), "Р1Р2, Р4, Р6");
});

test("разные типы внутри блока остаются через запятую", () => {
  const mixed = block(["В", "Р", "Р", "Р"]);
  assert.equal(labelOfBlock(mixed), "В1, Р1–3");
});

// Цвет куска берётся у типа (таск 86), а у диапазона тип один — свёртка тут
// ничего не усложняет, но кусков в подписи становится меньше, и проверить это
// надо: разойдись куски с подписью — обводка легла бы по одной строке, а буквы
// по другой.
test("у свёрнутого диапазона один кусок и один цвет", () => {
  const mixed = block(["В", "Р", "Р", "Р"]);
  const parts = blockLabelParts(mixed.project, mixed.group.markIds);
  assert.deepEqual(
    parts.map((part) => part.text),
    ["В1", ", ", "Р1–3"],
  );
  assert.equal(parts[2].typeId, mixed.typeOf("Р"));
  const runs = labelRuns(mixed.project, targetOf(mixed), "#000000");
  assert.equal(runs[2].color, styleOf(mixed.project, mixed.typeOf("Р")).color);
  assert.notEqual(runs[0].color, runs[2].color, "выключатель и диапазон розеток обязаны отличаться цветом");
  assert.equal(
    runs.map((run) => run.text).join(""),
    labelOfBlock(mixed),
    "куски разошлись с подписью",
  );
});

test("запись диапазона одна на любой код: слева код, справа только номер", () => {
  const long = block(["Р", "Р", "Р"]);
  const renamed = {
    ...long.project,
    markTypes: long.project.markTypes.map((type) => (type.code === "Р" ? { ...type, code: "ПОДСВЕТКА" } : type)),
  };
  assert.equal(blockLabel(renamed, long.group.markIds), "ПОДСВЕТКА1–3");
  assert.equal(labelOfBlock(long), "Р1–3", "короткий код записан тем же правилом");
});

// ——— свёртка — дело подписи, а не данных —————————————————————————————————

test("поиск находит метку по её обозначению, а не по диапазону", () => {
  const six = block(["Р", "Р", "Р", "Р", "Р", "Р"]);
  assert.deepEqual(
    searchProject(six.project, "Р5").map((row) => row.label),
    ["Р5"],
    "метка внутри свёрнутого диапазона потерялась для поиска",
  );
  assert.equal(searchProject(six.project, "Р1–3").length, 0, "диапазон — это подпись, искать по нему нечего");
});

test("в таблице меток у каждой розетки блока своя строка со своим обозначением", () => {
  const six = block(["Р", "Р", "Р", "Р", "Р", "Р"]);
  const table = marksTable(six.project, null, "category");
  const labels = table.groups.flatMap((group) => group.rows.map((row) => row.cells[0]));
  assert.deepEqual(labels, ["Р1", "Р2", "Р3", "Р4", "Р5", "Р6"]);
});

// ——— потолок длины и перенос ——————————————————————————————————————————

test("короткая подпись остаётся одной строкой и мерится как мерилась", () => {
  const mixed = block(["В", "Р", "Р"]);
  const label = labelOfBlock(mixed);
  assert.equal(label, "В1, Р1Р2");
  const box = boxOf(mixed);
  assert.equal(box.lines.length, 1, "самый частый смешанный блок обязан остаться одной строкой");
  const font = 12;
  assert.equal(box.width, Math.max(font * 0.8, label.length * font * renderInternals.LABEL_CHAR_RATIO));
  assert.equal(box.height, font * 1.2);
});

test("переполнившая потолок подпись переносится по запятой, а не рубится внутри куска", () => {
  const base = block(["Р", "Р", "Р", "RJ"]);
  assert.equal(labelOfBlock(base), "Р1–3, RJ1");
  const box = boxOf(base);
  assert.deepEqual(
    box.lines.map((line) => line.text),
    ["Р1–3,", "RJ1"],
  );
  assert.equal(box.text, "Р1–3, RJ1", "сама подпись осталась прежней строкой — переносится только раскладка");
  // Вдвое уже и вдвое выше: подпись перестала уезжать за блок вбок, чего и
  // просил заказчик.
  const font = 12;
  assert.equal(box.width, "Р1–3,".length * font * renderInternals.LABEL_CHAR_RATIO);
  assert.equal(box.height, 2 * font * 1.2);
});

test("ни один номер при переносе не теряется", () => {
  const base = block(["В", "Р", "Р", "Р", "RJ"]);
  const box = boxOf(base);
  assert.ok(box.lines.length > 1, "подпись в тринадцать знаков обязана перенестись");
  const joined = box.lines.map((line) => line.text).join(" ");
  for (const piece of ["В1", "Р1–3", "RJ1"]) {
    assert.ok(joined.includes(piece), "в перенесённой подписи потерялось «" + piece + "»: " + joined);
  }
});

test("кусок длиннее потолка остаётся целым", () => {
  const long = block(["Р", "Р", "Р"]);
  const renamed = {
    ...long.project,
    markTypes: long.project.markTypes.map((type) => (type.code === "Р" ? { ...type, code: "ПОДСВЕТКА" } : type)),
  };
  const box = boxOf(long, renamed);
  assert.deepEqual(
    box.lines.map((line) => line.text),
    ["ПОДСВЕТКА1–3"],
    "обозначение разорвали посередине — так оно читается как два других",
  );
});

// ——— рисование переносится вместе с раскладкой —————————————————————————

// Заглушка холста из `labelColors.test.js`: помнит, чем и где писали буквы.
function textProbe() {
  const fills = [];
  const strokes = [];
  const impl = {
    canvas: { width: 900, height: 600 },
    fillStyle: "",
    strokeStyle: "",
    font: "",
    getTransform: () => ({ a: 1 }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (value, x, y) => fills.push({ text: value, x, y, color: impl.fillStyle }),
    strokeText: (value, x, y) => strokes.push({ text: value, x, y, color: impl.strokeStyle }),
  };
  return {
    fills,
    strokes,
    ctx: new Proxy(impl, {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        object[key] = value;
        return true;
      },
    }),
  };
}

function paint(base, project) {
  const probe = textProbe();
  drawScheme(probe.ctx, {
    project: project || base.project,
    scheme: (project || base.project).schemes[0],
    image: null,
    filter: null,
    view: viewOf(),
    legend: false,
  });
  return probe;
}

test("у каждой строки перенесённой подписи своя обводка и свой этаж", () => {
  const base = block(["Р", "Р", "Р", "RJ"]);
  const probe = paint(base);
  const box = boxOf(base);
  assert.deepEqual(
    probe.strokes.map((item) => item.text),
    ["Р1–3,", "RJ1"],
    "обводка перенесённой подписи ведётся не по строкам",
  );
  // Строки идут от середины габарита вниз, шагом в высоту строки: подпись
  // висит на уровне своей метки, как висела одной строкой.
  const step = box.font * 1.2;
  assert.ok(Math.abs(probe.strokes[1].y - probe.strokes[0].y - step) < 1e-6, "шаг строк не равен высоте строки");
  const middle = (probe.strokes[0].y + probe.strokes[1].y) / 2;
  assert.ok(Math.abs(middle - box.y) < 1e-6, "подпись из двух строк висит не на уровне своей метки");
  assert.equal(probe.strokes[0].x, probe.strokes[1].x, "строки обязаны идти от одного левого края");
});

test("цвет куска не теряется на своей строке, а пробел после запятой — теряется", () => {
  const base = block(["Р", "Р", "Р", "RJ"]);
  const probe = paint(base);
  const socket = styleOf(base.project, base.typeOf("Р")).color;
  const net = styleOf(base.project, base.typeOf("RJ")).color;
  const drawn = probe.fills.map((item) => ({ text: item.text, color: item.color }));
  assert.deepEqual(drawn, [
    { text: "Р1–3,", color: socket },
    { text: "RJ1", color: net },
  ]);
  assert.notEqual(socket, net, "розетка и витая пара обязаны отличаться цветом");
  // Строка «Р1–3,» одноцветна (запятая берёт цвет куска слева) — значит рисуется
  // одним вызовом, как и прежде одноцветная подпись.
  assert.equal(probe.fills.length, 2, "одноцветная строка разбилась на куски");
});

test("одноцветный блок по-прежнему пишется одним вызовом", () => {
  const base = block(["Р", "Р", "Р"]);
  const probe = paint(base);
  assert.deepEqual(
    probe.strokes.map((item) => item.text),
    ["Р1–3"],
  );
  assert.equal(probe.fills.length, 1, "свёрнутая подпись разбилась на куски там, где был один вызов");
  assert.equal(probe.fills[0].text, "Р1–3");
});
