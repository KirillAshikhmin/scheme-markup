// Брошенный черновик в чертеже (таск 172, находка 1 разбора).
//
// Разбор `audit-mehaniki.md`: это было единственное место во всей сборке, где
// **терялась уже сделанная работа**. Начал цепочку стен из пяти вершин, нажал
// «Проёмы» — исчезло молча, одной строкой `draft = null`. На плане тот же жест
// линию дочерчивает в метку и говорит об этом («Начатая линия дочерчена: Л3»),
// а одинокую точку снимает со словами.
//
// Решение чертежа — чистая `workshopDraftFate`; слова и запись в объект
// остаются половине окна, и их проверяет живой прогон. Держится здесь то, за
// чем в окне не уследишь: какой черновик чем кончается и у какого дочерчивать
// нечего.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { workshopDraftFate, workshopRectFromContour } from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSHOP_SRC = join(HERE, "..", "src", "panels", "workshop.js");

const point = (x, y) => ({ x, y });

test("цепочка стен дочерчивается от двух вершин, одинокая — снимается со словами", () => {
  assert.deepEqual(workshopDraftFate("walls", "rect", [point(0, 0), point(3000, 0)]), { finish: "chain" });
  assert.deepEqual(workshopDraftFate("walls", "rect", [point(0, 0), point(3000, 0), point(3000, 2400)]), {
    finish: "chain",
  });
  assert.deepEqual(workshopDraftFate("walls", "rect", [point(0, 0)]), { drop: "short" });
  // Два клика в одну точку — это один клик, а не стена нулевой длины.
  assert.deepEqual(workshopDraftFate("walls", "rect", [point(500, 500), point(500, 500)]), { drop: "short" });
  assert.deepEqual(workshopDraftFate("walls", "rect", []), { drop: "short" });
});

test("полоса объекта — тот же росчерк и то же правило", () => {
  assert.deepEqual(workshopDraftFate("objects", "polyline", [point(0, 0), point(1800, 0)]), { finish: "band" });
  assert.deepEqual(workshopDraftFate("objects", "polyline", [point(0, 0)]), { drop: "short" });
});

test("контур отдаёт тот габарит, который уже нарисован призраком", () => {
  const square = [point(0, 0), point(600, 0), point(600, 400), point(0, 400)];
  assert.deepEqual(workshopDraftFate("objects", "contour", square), { finish: "contour" });
  // Та же дверь, что у призрака под рукой: что показано, то и записано.
  const rect = workshopRectFromContour(square);
  assert.equal(rect.widthMm, 600);
  assert.equal(rect.depthMm, 400);
  // Площади между вершинами нет — прямоугольника не выйдет, и это слова, а не
  // молчание: человек обводил, и обведённое пропадает.
  assert.deepEqual(workshopDraftFate("objects", "contour", [point(0, 0), point(600, 0), point(1200, 0)]), {
    drop: "flat",
  });
  assert.deepEqual(workshopDraftFate("objects", "contour", [point(0, 0), point(600, 0)]), { drop: "flat" });
});

test("у проёма и вещи по умолчаниям дочерчивать нечего — и говорить не о чем", () => {
  // Призрак под рукой это не работа: он идёт за рукой и ничего не набрал.
  assert.deepEqual(workshopDraftFate("openings", "rect", [point(0, 0), point(900, 0)]), { drop: "none" });
  assert.deepEqual(workshopDraftFate("objects", "rect", [point(0, 0)]), { drop: "none" });
  assert.deepEqual(workshopDraftFate("edit", "rect", [point(0, 0), point(100, 100)]), { drop: "none" });
});

test("слова про начатое есть на каждый случай и говорят про Ctrl+Z", () => {
  assert.match(strings.workshop.draftSettled, /Ctrl\+Z/);
  for (const key of ["draftShort", "draftFlat", "draftScheme"]) {
    assert.ok(strings.workshop[key].length > 10, "нет слов про снятый черновик: " + key);
  }
});

test("смена занятия и смена способа спрашивают про начатое раньше, чем его теряют", () => {
  const source = readFileSync(WORKSHOP_SRC, "utf8");
  const bodyOf = (head) => {
    const from = source.indexOf(head);
    assert.ok(from > 0, "пропала дверь: " + head);
    const rest = source.slice(from);
    return rest.slice(0, rest.indexOf("\n  }\n"));
  };
  // Занятие: `settleDraft()` стоит **до** обнуления, иначе дочерчивать будет
  // нечего — ровно так работа и терялась.
  const tool = bodyOf("function setTool(next) {");
  assert.ok(tool.indexOf("settleDraft()") < tool.indexOf("draft = null"), "начатое снова теряется при смене занятия");
  // Способ: решение читает ещё не сменившийся `workshopObjectWay`.
  const way = bodyOf("function setObjectWay(way) {");
  assert.ok(
    way.indexOf("settleDraft()") < way.indexOf("workshopObjectWay = way"),
    "способ меняется раньше, чем дочерчено начатое прежним",
  );
});
