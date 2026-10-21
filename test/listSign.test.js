// **Знак метки в строке списка — общей лестницей** (таск 228, находка 15).
//
// Лестница одна: вид типа решает, чем он обозначен, — у точечного фигура, у
// линейного образец его начертания (`render.typeIconPlan`). Пока каждое место
// звало `shapeIcon` само, они расходились: это дефект D31, и он уже всплывал
// трижды — в окне выбора типа, на плашке выбранного и в окне общей базы.
// Четвёртым разом стали списки меток: у ленты подсветки в справочнике штрих, а
// в списке, в карточке, в окне связей и в поиске стояла точка, и человек не
// узнавал в строке свою ленту.
//
// Поэтому здесь два теста разной природы. Один проверяет **картинку** — что
// план знака у линейного типа линейный, а у точечного тот же, что был. Второй
// читает **исходники**: прямой вызов `shapeIcon` из панели и есть та самая
// поломка, и запретить его дешевле, чем ловить её в пятый раз.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  COMMENT_TYPE_ID,
  MARK_KIND_COMMENT,
  addMark,
  addScheme,
  createProject,
  styleOf,
  typeKindOf,
} from "../src/model.js";
import { typeIconPlan } from "../src/render.js";
import { markCardModel } from "../src/panels/markCard.js";

function scene() {
  const added = addScheme(createProject({ name: "Квартира" }), {
    name: "1 этаж",
    imageId: "plan-1",
    width: 1000,
    height: 800,
  });
  const line = added.project.markTypes.find((type) => typeKindOf(added.project, type.id) === "line");
  const point = added.project.markTypes.find((type) => typeKindOf(added.project, type.id) === "point");
  return { project: added.project, schemeId: added.scheme.id, line, point };
}

test("у линейного типа план знака линейный, у точечного — фигурный", () => {
  const box = scene();
  const line = typeIconPlan(box.project, box.line.id);
  assert.equal(line.kind, "line", "тип " + box.line.code + " линейный, а знак был точкой");
  assert.equal(line.lineStyle, styleOf(box.project, box.line.id).lineStyle);
  const point = typeIconPlan(box.project, box.point.id);
  assert.equal(point.kind, "point");
  // Привычная картинка у точечного типа не менялась (правило таска 182): та же
  // фигура и тот же цвет, какими строка рисовала её и до правки.
  assert.equal(point.shape, styleOf(box.project, box.point.id).shape);
  assert.equal(point.color, styleOf(box.project, box.point.id).color);
});

test("карточка метки везёт план знака, а не считает его сама", () => {
  const box = scene();
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: box.line.id,
    kind: "line",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
    ],
  });
  const model = markCardModel(added.project, added.mark.id);
  // Та же лестница, что у справочника: карточку собирают два хозяина — план и
  // объём, — и знак у них обязан быть один.
  assert.deepEqual(model.sign, typeIconPlan(added.project, box.line.id));
  assert.equal(model.sign.kind, "line");
});

test("плашка комментария осталась фигурой — у неё начертания нет вовсе", () => {
  const box = scene();
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: COMMENT_TYPE_ID,
    kind: MARK_KIND_COMMENT,
    points: [{ x: 0.4, y: 0.4 }],
  });
  const model = markCardModel(added.project, added.mark.id);
  assert.equal(model.comment, true);
  assert.equal(model.sign.kind, "point", "третий вид рисуется точкой, а не линией");
  assert.equal(model.sign.shape, styleOf(added.project, COMMENT_TYPE_ID).shape, "знак тот же, что был");
});

// ——— по исходникам: второго рисовальщика знака нет ————————————————————

// Где `shapeIcon` звать можно и нужно: сам рисовальщик (`render.js`) и
// справочник, в котором **выбирают фигуру** — сетка форм, кнопка выбора и
// значок категории спрашивают именно фигуру, а не знак типа.
const SHAPE_ICON_HOMES = new Set(["render.js", "types.js"]);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(dir + entry.name + "/", out);
    else if (entry.name.endsWith(".js")) out.push(dir + entry.name);
  }
  return out;
}

test("знак в строке списка не рисуется фигурой напрямую (D31)", () => {
  const found = [];
  for (const path of sourceFiles("../src/")) {
    const name = path.split("/").pop();
    if (SHAPE_ICON_HOMES.has(name)) continue;
    const code = readFileSync(new URL(path, import.meta.url), "utf8");
    if (code.includes("shapeIcon(")) found.push(path);
  }
  assert.deepEqual(
    found,
    [],
    "знак типа рисуется фигурой, минуя лестницу `typeIcon` (дефект D31): " + found.join(", "),
  );
});
