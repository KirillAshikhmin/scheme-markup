// Палец в чертеже меряется пальцевой меркой (таск 172, находка 2 разбора).
//
// Разбор `audit-mehaniki.md`: у чертежа стояло **одно** число на мышь и палец
// разом — три точки, — тогда как холст развёл мерки давно (три у мыши, десять
// у пальца) и назвал причину: «тап по метке на планшете уезжает на несколько
// точек, и по мышиной мерке в три точки он почти всегда оказывался бы
// панорамой».
//
// Чем это кусало на планшете — рабочем месте заказчика: тап по стене уезжает
// на четыре точки, по мышиной мерке это перетаскивание, стена **едет**, и в
// историю падает шаг «перенос стены». При масштабе 0,1 пикселя на миллиметр
// четыре точки — это сорок миллиметров: монтажник прочтёт сдвинутую стену и не
// узнает, что её никто не двигал.
//
// Держится здесь не пиксели, а правило: мерка у чертежа **не своя**, он
// спрашивает её у холста, и палец получает пальцевую.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canvasDragSlop } from "../src/canvas.js";
import { workshopHandMoved } from "../src/panels/workshop.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSHOP_SRC = join(HERE, "..", "src", "panels", "workshop.js");

const mouse = { x: 100, y: 100 };
const finger = { x: 100, y: 100, touch: true };

test("мерка чертежа — холстовая, и у пальца она своя", () => {
  // Своего числа у чертежа нет: обе мерки приходят из `canvasDragSlop`.
  assert.ok(canvasDragSlop({ touch: true }) > canvasDragSlop({}), "у пальца и мыши снова одна мерка");
  // Четыре точки дрожи: мышью это уже перетаскивание, пальцем — всё ещё тап.
  assert.equal(workshopHandMoved(mouse, { x: 104, y: 100 }), true);
  assert.equal(workshopHandMoved(finger, { x: 104, y: 100 }), false, "тап пальцем снова двигает стену");
  // И по диагонали — мерка круговая, а не по осям: 3 + 4 = 5 точек.
  assert.equal(workshopHandMoved(finger, { x: 103, y: 104 }), false);
  assert.equal(workshopHandMoved(mouse, { x: 103, y: 104 }), true);
});

test("мерка — порог, а не окрестность: ровно столько ещё тап", () => {
  // Сравнение то же, что на холсте: поехал тот, кто сдвинулся **больше** мерки.
  const slopMouse = canvasDragSlop({});
  const slopFinger = canvasDragSlop({ touch: true });
  assert.equal(workshopHandMoved(mouse, { x: 100 + slopMouse, y: 100 }), false);
  assert.equal(workshopHandMoved(mouse, { x: 100 + slopMouse + 1, y: 100 }), true);
  assert.equal(workshopHandMoved(finger, { x: 100 + slopFinger, y: 100 }), false);
  assert.equal(workshopHandMoved(finger, { x: 100 + slopFinger + 1, y: 100 }), true);
  // Пальцевая мерка не меньше того, что системные жесты отдают на тап.
  assert.ok(slopFinger >= 8, "пальцевая мерка мала: " + slopFinger);
});

test("жеста нет — никто не поехал", () => {
  assert.equal(workshopHandMoved(null, { x: 100, y: 100 }), false);
  assert.equal(workshopHandMoved(finger, null), false);
});

test("своего числа у чертежа не завелось, и палец помечен на нажатии", () => {
  const source = readFileSync(WORKSHOP_SRC, "utf8");
  assert.ok(!source.includes("WORKSHOP_DRAG_SLOP"), "у чертежа снова своя мерка сдвига");
  // Без отметки `touch` холстовая мерка молча вернула бы мышиную: `pointerType`
  // у событий движения спрашивать негде — они приходят с окна, а не с поля.
  assert.match(
    source,
    /press = \{ x: event\.clientX, y: event\.clientY, touch: event\.pointerType === "touch" \}/,
    "нажатие больше не помечает палец",
  );
  assert.match(
    source,
    /start: \{ x: event\.clientX, y: event\.clientY, touch: event\.pointerType === "touch" \}/,
    "взятое под руку больше не помечает палец",
  );
  // Обе ветки — и нажатие, и взятое под руку — спрашивают мерку одной дверью, а
  // не считают сдвиг руками: вторая арифметика разошлась бы с первой молча.
  assert.ok(source.match(/workshopHandMoved\(/g).length >= 3, "мерку спрашивают не оба места");
  assert.ok(!/Math\.hypot\(event\.clientX/.test(source), "сдвиг руки снова считается на месте, мимо мерки");
});
