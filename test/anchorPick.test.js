// Точка привязки мышью и наложение чужого чертежа (таск 208, G314 и G315).
//
// Слова заказчика: «надо указать точку на чертеже, а не только числами» и
// «нужно наложение чертежей, что бы подогнать один к другому. Также через меню
// интерфейса и только стены и другим цветом».
//
// Это две половины одного дела: точку ставят **по картинке**, а картинку даёт
// подложенный соседний чертёж. Поле, окно и холст тестами не покрыты, поэтому
// держится здесь то, что покрыть можно:
//
//   1. **Лесенка Esc** — у ожидания щелчка верхняя ступень, и порядок виден
//      только отсюда: живой прогон показывает ту ступень, которая сработала.
//   2. **Слова под кнопками** — одна дверь (`workshopModeNote`, таск 203), и
//      ожидание старше занятия: щелчок уйдёт точке, а не стене.
//   3. **Где стоит калька** — та же `schemeAnchorOriginMm`, которой стопка
//      этажей складывает этажи (таск 205): второго счёта совмещения в сборке
//      быть не должно.
//   4. **Сверка по исходникам** — калька не уходит в выгрузки и не попадает
//      под руку, ровно как знак привязки.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addScheme,
  addWall,
  createProject,
  schemeAnchorOf,
  schemeAnchorOriginMm,
  setSchemeAnchor,
} from "../src/model.js";
import { workshopEscStep, workshopModeNote, workshopSnapMm } from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "..", "src", name), "utf8");

test("Esc: ожидание щелчка — верхняя ступень лесенки", () => {
  const selected = { kind: "object", id: "вещь" };
  const draft = { points: [{ x: 0, y: 0 }] };
  // Пришло последним — снимается первым, как черновик снимается раньше
  // выделения. Иначе Esc убрал бы черновик, а человек остался бы ждать щелчка
  // и поставил бы точку следующим кликом, не собираясь этого делать.
  assert.equal(workshopEscStep({ anchorPick: true, draft, selected, mode: "add" }), "anchor");
  assert.equal(workshopEscStep({ anchorPick: true, draft: null, selected: null, mode: "select" }), "anchor");
  // Прежние ступени целы до единой.
  assert.equal(workshopEscStep({ anchorPick: false, draft, selected, mode: "add" }), "draft");
  assert.equal(workshopEscStep({ draft: null, selected, mode: "add" }), "selection");
  assert.equal(workshopEscStep({ draft: null, selected: null, mode: "add" }), "mode");
  assert.equal(workshopEscStep({ draft: null, selected: null, mode: "select" }), null);
});

test("строка под кнопками говорит про щелчок, что бы ни стояло в занятии", () => {
  const line = workshopModeNote({ anchorPick: true, mode: "select", tool: "edit", wallCount: 0 });
  assert.equal(line.text, strings.workshop.anchorPickHint);
  assert.equal(line.bad, false, "ожидание — не отказ: краснеть нечему");
  // Занятие под ожиданием любое, и слова от него не зависят: щелчок уйдёт
  // точке, а не стене.
  for (const tool of ["walls", "openings", "objects", "edit"]) {
    assert.equal(workshopModeNote({ anchorPick: true, mode: "add", tool, wallCount: 3 }).text, strings.workshop.anchorPickHint);
  }
  // Отказ призрака проёма при этом не перебивает ожидание: пока ждут точку,
  // проём никуда не садится.
  assert.equal(
    workshopModeNote({ anchorPick: true, mode: "add", tool: "openings", wallCount: 3, refusal: "нельзя" }).text,
    strings.workshop.anchorPickHint,
  );
  // Сняли ожидание — слова прежние, до буквы.
  assert.equal(workshopModeNote({ mode: "select", tool: "edit" }).text, strings.workshop.modeSelectHint);
  // Три вещи, которые строка обязана сказать: чего ждут, про сетку и про Esc.
  assert.match(strings.workshop.anchorPickHint, /[Щщ]ёлкн/);
  assert.match(strings.workshop.anchorPickHint, /сетк/);
  assert.match(strings.workshop.anchorPickHint, /Esc/);
});

test("притяжка точки — общая притяжка чертежа, своей у неё нет", () => {
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  // Сетка включена — узел сетки: точка на узле уже точная, и повторяема на
  // обоих планах, что для совмещения и нужно.
  const node = workshopSnapMm([], { x: 1240, y: 2610 }, view, { gridMm: 100, gridSnap: true });
  assert.deepEqual(node.point, { x: 1200, y: 2600 });
  assert.equal(node.grid, true);
  // Alt — миллиметр под курсором: план, обведённый по чужому скану, по круглым
  // числам не стоит.
  const free = workshopSnapMm([], { x: 1240.6, y: 2610.2 }, view, { gridMm: 100, gridSnap: true, free: true });
  assert.deepEqual(free.point, { x: 1241, y: 2610 });
  assert.equal(free.grid, false);
  // Сетка снята — миллиметр под курсором же: магнитов по вершинам у одинокой
  // точки нет и быть не может, цепочки под ней не лежит.
  const bare = workshopSnapMm([], { x: 1240.4, y: 2610.5 }, view, { gridMm: 100, gridSnap: false });
  assert.deepEqual(bare.point, { x: 1240, y: 2611 });
});

// Два этажа, начерченные от разных углов листа: ровно тот случай, ради
// которого наложение и затеяно.
function house() {
  const project = createProject();
  const first = addScheme(project, { name: "1 этаж", width: 2400, height: 1600 });
  const second = addScheme(first.project, { name: "2 этаж", width: 2400, height: 1600 });
  let next = second.project;
  const box = (schemeId, dx, dy) => {
    for (const [ax, ay, bx, by] of [
      [0, 0, 6000, 0],
      [6000, 0, 6000, 8000],
    ]) {
      next = addWall(next, {
        schemeId,
        aMm: { x: ax + dx, y: ay + dy },
        bMm: { x: bx + dx, y: by + dy },
        thicknessMm: 200,
      }).project;
    }
  };
  box(first.scheme.id, 0, 0);
  box(second.scheme.id, 5000, 3000);
  return { project: next, lower: first.scheme.id, upper: second.scheme.id };
}

test("калька встаёт по привязке, а без неё — по началу координат", () => {
  const box = house();
  // Правило кальки целиком: сдвиг считается, только когда точка есть у
  // **обеих** схем. Половина привязки — не половина совмещения, и это разбор
  // живого прогона: привязал первый этаж, открыл второй ставить его точку, а
  // калька уехала с экрана на разницу привязки.
  const shift = (project, mine, other) => {
    if (!schemeAnchorOf(project, mine) || !schemeAnchorOf(project, other)) return { x: 0, y: 0 };
    const here = schemeAnchorOriginMm(project, mine);
    const there = schemeAnchorOriginMm(project, other);
    return { x: there.x - here.x, y: there.y - here.y };
  };
  // Привязки нет ни у кого — обе схемы стоят началом координат, и расхождение
  // в 5000 × 3000 видно глазом. Это и есть случай, ради которого подгоняют.
  assert.deepEqual(shift(box.project, box.lower, box.upper), { x: 0, y: 0 });
  // Привязали обе по одному и тому же месту дома — калька встала на своё
  // место, и сошлось это или нет, видно по стенам.
  let fitted = setSchemeAnchor(box.project, box.lower, { x: 6000, y: 8000 }).project;
  fitted = setSchemeAnchor(fitted, box.upper, { x: 11000, y: 11000 }).project;
  assert.deepEqual(shift(fitted, box.lower, box.upper), { x: -5000, y: -3000 });
  // Точка верхнего этажа после сдвига ложится ровно в точку нижнего.
  assert.deepEqual({ x: 11000 - 5000, y: 11000 - 3000 }, { x: 6000, y: 8000 });
  // Привязка только у одной — совмещать не по чему, и калька стоит началом
  // координат: инструмент подгонки обязан дождаться, пока подгонка кончится.
  const half = setSchemeAnchor(box.project, box.upper, { x: 11000, y: 11000 }).project;
  assert.deepEqual(shift(half, box.lower, box.upper), { x: 0, y: 0 });
  // Тем же правилом живёт и поле: «обеих», а не «каждой по себе».
  const workshop = read(join("panels", "workshop.js"));
  const paint = workshop.slice(workshop.indexOf("function paintOverlay()"));
  assert.ok(paint.slice(0, 1200).includes("const paired ="), "калька снова считает сдвиг по каждой схеме отдельно");
  assert.ok(paint.slice(0, 1200).includes("paired ? {"), "сдвиг кальки перестал спрашивать про обе привязки");
});

test("калька не уходит в выгрузки и не попадает под руку", () => {
  // Та же сверка, что у знака привязки (таск 205): наложение — отметка показа
  // на экране, и общий слой `render.drawDrawing` о ней не знает. Забытая
  // строка в рисовальщике листа вынесла бы охряные стены чужого этажа в PNG,
  // на лист ГОСТ и в развёртку.
  for (const name of ["render.js", "exporter.js", "gostSheet.js", "pdf.js", "volume.js"]) {
    assert.ok(!read(name).includes("overlaySchemeId"), "калька добралась до выгрузок через " + name);
  }
  const workshop = read(join("panels", "workshop.js"));
  // Значение кальки **читает** ровно одно место — её рисовальщик. Второе
  // упоминание ключа в мастерской — подписка «калька сменилась, перерисуй»,
  // и значения она не читает вовсе.
  const reads = [...workshop.matchAll(/getState\(\)\.overlaySchemeId/g)].length;
  assert.equal(reads, 1, "значение кальки читают в " + reads + " местах вместо одного");
  const from = workshop.indexOf("function paintOverlay()");
  const at = workshop.indexOf("getState().overlaySchemeId");
  assert.ok(from > 0 && at > from, "значение кальки читают не в её рисовальщике");
  assert.equal([...workshop.matchAll(/overlaySchemeId/g)].length, 2, "о кальке в мастерской заговорили в третьем месте");
  // Под руку чертёж ищет `workshopPick`, и он спрашивает свою схему: наложенное
  // нельзя ни выделить, ни зацепить, ни принять за стену под проём.
  const pick = workshop.slice(workshop.indexOf("export function workshopPick("));
  assert.ok(!pick.slice(0, 2000).includes("overlay"), "под рукой оказалась чужая схема");
});

test("третья дверь к точке стоит рядом с двумя первыми", () => {
  // Числа, лестница и щелчок — в одном ряду окна свойств схемы (таск 208).
  // Разведи их по разным углам, и про щелчок человек не узнает.
  const schemes = read(join("panels", "schemes.js"));
  const row = schemes.slice(schemes.indexOf('class: "schemes__anchorRow"'));
  assert.match(row.slice(0, 200), /anchorOnPlan, anchorStairs, anchorClear/);
  // Кнопка сперва применяет окно и только потом уходит на чертёж: иначе
  // набранное имя и этаж пропали бы молча.
  const button = schemes.slice(schemes.indexOf("const anchorOnPlan ="), schemes.indexOf("showAnchor();\n    const error"));
  assert.ok(button.includes("if (!apply()) return;"), "кнопка уходит на чертёж, не применив окно");
  assert.ok(button.includes("openDrawing(schemeId)"), "кнопка не открывает чертёж своей схемы");
  assert.ok(button.includes("workshopPickAnchor()"), "кнопка не просит ждать щелчка");
  // Две прежние двери целы.
  assert.ok(schemes.includes("strings.schemes.anchorFromStairs"), "пропала кнопка «По лестнице»");
  assert.ok(schemes.includes("schemes__anchorPair"), "пропал ввод числами");
});

test("щелчок пишет привязку одним шагом и называет её тем же словом, что окно", () => {
  const workshop = read(join("panels", "workshop.js"));
  const place = workshop.slice(workshop.indexOf("function placeAnchor(event)"), workshop.indexOf("function paintOverlay()"));
  // Ярлык шага — тот же, что у окна свойств: человек читает его в подсказке
  // отмены, и две двери к одному значению обязаны говорить одно слово.
  assert.ok(place.includes("strings.history.schemeAnchor"), "щелчок назвал шаг чужим словом");
  // Ровно один шаг: своего `pushCommand` у чертежа нет, всё идёт через
  // `canvasCommit` (здесь — через `commit`).
  assert.equal([...place.matchAll(/commit\(/g)].length, 1, "шагов истории на один щелчок стало больше одного");
  // Ожидание снимается до записи — второй щелчок по той же точке не ставит её
  // дважды, а `changed: false` не кладёт в историю пустого шага.
  assert.ok(place.indexOf("anchorPick = null") < place.indexOf("setSchemeAnchor"), "ожидание снимается после записи");
  assert.ok(place.includes("result.changed"), "пустой щелчок кладёт шаг в историю");
});
