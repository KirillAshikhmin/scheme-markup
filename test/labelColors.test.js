// Цвет подписи смешанного блока (D15).
//
// Блок из меток разных типов — приём заказчика: выключатель и розетка в одной
// рамке (G22). Подпись такого блока читается «В37, Р77Р78», а красилась целиком
// цветом первого типа. Его слова: «если в группе метки разных типов, то цвет
// группы целиком первого типа, а должны быть так же разным».
//
// Пять мест, где такая правка ломает соседнее, и все пять здесь проверяются:
// разделитель, повёрнутая подпись, единая обводка, ширина для раскладки и
// выгрузка. Шестое — и самое важное: **одноцветный блок обязан рисоваться ровно
// как раньше**, одним вызовом и одним цветом.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addToGroup,
  blockLabel,
  blockLabelParts,
  createProject,
  findGroup,
  styleOf,
} from "../src/model.js";
import { drawScheme, labelBox, labelRuns, renderInternals } from "../src/render.js";

const PLAN = { width: 1000, height: 500 };
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Заглушка холста, которая помнит, чем и где писали буквы: цвет заливки,
// координату и саму строку. Обводка считается отдельно — она обязана быть одна.
function textProbe() {
  const fills = [];
  const strokes = [];
  const impl = {
    canvas: { width: 900, height: 600 },
    fillStyle: "",
    strokeStyle: "",
    font: "",
    getTransform: () => ({ a: 1 }),
    // Ширина знака та же, что у оценки раскладки: заглушке важно быть
    // предсказуемой, а не точной.
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (text, x, y) => fills.push({ text, x, y, color: impl.fillStyle }),
    strokeText: (text, x, y) => strokes.push({ text, x, y, color: impl.strokeStyle }),
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

function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", width: PLAN.width, height: PLAN.height });
  const project = made.project;
  return {
    project,
    schemeId: made.scheme.id,
    switchType: project.markTypes.find((type) => type.code === "В").id,
    socketType: project.markTypes.find((type) => type.code === "Р").id,
  };
}

// Блок в одной рамке: выключатель, а справа от него две розетки.
function mixedBlock() {
  const base = scene();
  const first = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.switchType,
    points: [{ x: 0.3, y: 0.5 }],
  });
  const withSocket = addToGroup(first.project, first.mark.id, "right", { typeId: base.socketType });
  const grown = addToGroup(withSocket.project, withSocket.mark.id, "right", { typeId: base.socketType });
  const scheme = grown.project.schemes[0];
  const group = grown.project.groups[0];
  return { ...base, project: grown.project, scheme, group, markId: first.mark.id };
}

// Блок из трёх выключателей — самый частый случай, его трогать нельзя.
function plainBlock() {
  const base = scene();
  const first = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.switchType,
    points: [{ x: 0.3, y: 0.5 }],
  });
  let project = addToGroup(first.project, first.mark.id, "right").project;
  const group = project.groups[0];
  project = addToGroup(project, group.markIds[group.markIds.length - 1], "right").project;
  return { ...base, project, scheme: project.schemes[0], group: project.groups[0], markId: first.mark.id };
}

const targetOf = (base) => ({ ...findGroup(base.project, base.group.id) });

// ——— модель: подпись кусками ————————————————————————————————————————————

test("подпись смешанного блока разбирается на куски со своими типами", () => {
  const base = mixedBlock();
  const parts = blockLabelParts(base.project, base.group.markIds);
  assert.equal(parts.length, 3, "ожидались кусок, разделитель и кусок: " + JSON.stringify(parts));
  assert.equal(parts[0].typeId, base.switchType);
  assert.equal(parts[1].typeId, null, "у разделителя не должно быть типа — своего типа у запятой нет");
  assert.equal(parts[2].typeId, base.socketType);
  assert.match(parts[0].text, /^В\d+$/);
  assert.match(parts[2].text, /^Р\d+Р\d+$/, "две подряд идущие розетки склеиваются слитно");
});

// Двух правил склейки быть не должно: разойдись они — на плане и в таблице
// оказались бы разные подписи, а обводка легла бы по одной строке, а буквы по
// другой.
test("склейка кусков совпадает с самой подписью — всегда", () => {
  for (const base of [mixedBlock(), plainBlock()]) {
    const joined = blockLabelParts(base.project, base.group.markIds)
      .map((part) => part.text)
      .join("");
    assert.equal(joined, blockLabel(base.project, base.group.markIds));
  }
});

test("у одноцветного блока все куски одного типа", () => {
  const base = plainBlock();
  const parts = blockLabelParts(base.project, base.group.markIds);
  const types = new Set(parts.filter((part) => part.typeId).map((part) => part.typeId));
  assert.equal(types.size, 1);
  assert.equal([...types][0], base.switchType);
});

// ——— цвета кусков ———————————————————————————————————————————————————————

test("каждый кусок берёт цвет своего типа", () => {
  const base = mixedBlock();
  const fallback = styleOf(base.project, base.switchType).color;
  const runs = labelRuns(base.project, targetOf(base), fallback);
  assert.equal(runs[0].color, styleOf(base.project, base.switchType).color);
  assert.equal(runs[2].color, styleOf(base.project, base.socketType).color);
  assert.notEqual(runs[0].color, runs[2].color, "выключатель и розетка обязаны отличаться цветом");
});

// Разделитель берёт цвет куска слева: так ставится пунктуация в наборе, и — что
// важнее — запятая встречается и в одноцветном блоке («В1, В5»), где серый
// перекрасил бы то, чего никто не просил трогать.
test("разделитель красится цветом куска слева", () => {
  const base = mixedBlock();
  const runs = labelRuns(base.project, targetOf(base), "#000000");
  assert.equal(runs[1].text.trim(), ",");
  assert.equal(runs[1].color, runs[0].color, "запятая ушла к правому куску или посерела");
});

test("у одиночной метки кусков нет вовсе — рисуется прежним путём", () => {
  const base = scene();
  const made = addMark(base.project, { schemeId: base.schemeId, typeId: base.switchType, points: [{ x: 0.4, y: 0.4 }] });
  const mark = made.project.marks[0];
  assert.equal(labelRuns(made.project, mark, "#000000"), null);
});

// ——— рисование ——————————————————————————————————————————————————————————

function paint(base, patch = {}) {
  const probe = textProbe();
  drawScheme(probe.ctx, {
    project: base.project,
    scheme: base.scheme,
    image: null,
    filter: null,
    view: viewOf(),
    legend: false,
    ...patch,
  });
  return probe;
}

test("смешанный блок пишется двумя цветами, а обводка остаётся одна", () => {
  const base = mixedBlock();
  const probe = paint(base);
  const label = blockLabel(base.project, base.group.markIds);
  const pieces = probe.fills.filter((item) => label.includes(item.text));
  const colors = new Set(pieces.map((item) => item.color));
  assert.equal(colors.size, 2, "цветов в подписи " + colors.size + ": " + [...colors].join(", "));
  assert.ok(colors.has(styleOf(base.project, base.switchType).color));
  assert.ok(colors.has(styleOf(base.project, base.socketType).color));

  // Обводка — один вызов на всю строку. Обведи каждый кусок по отдельности, и
  // белая подложка легла бы поверх соседней буквы, разорвав подпись.
  const outline = probe.strokes.filter((item) => item.text === label);
  assert.equal(outline.length, 1, "обводок " + outline.length + " — подпись порвётся");
  assert.equal(probe.strokes.length, 1, "обводка ведётся кусками");

  // Куски идут слева направо и встык: сдвиг каждого — ширина всего, что до него.
  const sorted = pieces.slice().sort((a, b) => a.x - b.x);
  let done = "";
  for (const piece of sorted) {
    assert.equal(piece.x, outline[0].x + done.length * 7, "кусок «" + piece.text + "» встал не вплотную");
    done += piece.text;
  }
  assert.equal(done, label, "куски не собираются в подпись");
});

test("одноцветный блок пишется одним вызовом и одним цветом — как раньше", () => {
  const base = plainBlock();
  const probe = paint(base);
  const label = blockLabel(base.project, base.group.markIds);
  const pieces = probe.fills.filter((item) => item.text === label);
  assert.equal(pieces.length, 1, "подпись разбилась на куски там, где раньше был один вызов");
  assert.equal(pieces[0].color, styleOf(base.project, base.switchType).color);
  assert.equal(probe.fills.length, 1, "кроме подписи блока нарисовалось что-то ещё");
});

test("повёрнутая подпись красится кусками так же", () => {
  const base = mixedBlock();
  const project = base.project.marks.reduce(
    (acc, mark) => (mark.id === base.group.markIds[0] ? { ...acc, marks: acc.marks.map((m) => (m.id === mark.id ? { ...m, labelAngle: 90 } : m)) } : acc),
    base.project,
  );
  const probe = textProbe();
  drawScheme(probe.ctx, {
    project,
    scheme: project.schemes[0],
    image: null,
    filter: null,
    view: viewOf(),
    legend: false,
  });
  const label = blockLabel(project, base.group.markIds);
  const pieces = probe.fills.filter((item) => label.includes(item.text));
  assert.ok(pieces.length >= 3, "повёрнутая подпись нарисована одним куском");
  assert.equal(new Set(pieces.map((item) => item.color)).size, 2, "повёрнутая подпись одноцветна");
  // После поворота буквы пишутся от начала координат, а сдвиг куска идёт по той
  // же оси, что и строка.
  assert.equal(probe.strokes.length, 1, "обводка повёрнутой подписи разорвана");
  assert.equal(probe.strokes[0].x, 0, "повёрнутая подпись пишется не от начала координат");
});

// ——— раскладка меряет то же, что рисует ————————————————————————————————

test("ширина подписи для раскладки не изменилась от рисования кусками", () => {
  const base = mixedBlock();
  const label = blockLabel(base.project, base.group.markIds);
  const box = labelBox(base.project, base.scheme, targetOf(base), viewOf(), null);
  const font = Math.max(6, 12);
  const expected = Math.max(font * 0.8, label.length * font * renderInternals.LABEL_CHAR_RATIO);
  assert.equal(box.text, label, "раскладка меряет не ту строку, что рисуется");
  assert.equal(box.width, expected, "ширина подписи разошлась с раскладкой — подписи начнут наезжать");
});

// ——— выгрузка ———————————————————————————————————————————————————————————
//
// PNG и печать идут одним путём — `drawScheme`, — но проверяется это счётом, а
// не «наверное»: печать берёт ту же картинку, что PNG.
test("в выгрузке подпись смешанного блока такая же двухцветная", () => {
  const base = mixedBlock();
  const probe = textProbe();
  // Так зовёт выгрузка: свой масштаб, свой сдвиг, легенда и бледные контуры.
  drawScheme(probe.ctx, {
    project: base.project,
    scheme: base.scheme,
    image: null,
    filter: null,
    view: { zoom: 2, offsetX: -20, offsetY: -30, markSize: 16, labelSize: 20 },
    legend: false,
    outlines: "pale",
  });
  const label = blockLabel(base.project, base.group.markIds);
  const pieces = probe.fills.filter((item) => label.includes(item.text));
  assert.equal(new Set(pieces.map((item) => item.color)).size, 2, "на листе подпись осталась одноцветной");
  assert.equal(probe.strokes.length, 1, "на листе обводка разорвана");
});
