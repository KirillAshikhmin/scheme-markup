// **Мерка, повторённая в двух местах, — это будущее расхождение** (находка 12
// разбора механик; сведены таском 173, закрыты тестом здесь — таск 228).
//
// Сегодня ни одна из этих мерок не кусает: числа совпадают. Кусает того, кто
// поменяет одно — сдвинул порог попадания в стену, и палец на плане и в чертеже
// стали целиться по-разному; поправил базу листа ГОСТ, и подпись «217 × 335 мм
// при 300 dpi» осталась обещать прежнее. Именно это тест и ловит: он сверяет не
// значения (их заказчик вправе поменять одним словом), а **согласие**.
//
// Числа, которые нужны и JS, и CSS, живут в `cssMeasures.test.js`: там читается
// текст стиля. Здесь — только JS против JS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OUTLINE_MIN_POINTS, SCHEME_FALLBACK_PX, schemeHeightPx, schemeWidthPx } from "../src/model.js";
import { GOST_TEXT_MM, LABEL_GAP, SNAP_STEP_DEG } from "../src/render.js";
import { CANVAS_PAN_FRAME_MS, CANVAS_PAN_STEP_PX, CANVAS_WALL_PICK_PX } from "../src/canvas.js";
import { GESTURE_CLOSE_MIN } from "../src/gestures.js";
import { GOST_DPI_SCALE_DEFAULT, GOST_MIN_TEXT_MM, gostDpi, gostPixelsPerMm } from "../src/gostSheet.js";
import { EXPORT_DPI } from "../src/exporter.js";
import { WORKSHOP_CONTOUR_MIN, WORKSHOP_TURN_SNAP_DEG, WORKSHOP_WALL_PX } from "../src/panels/workshop.js";

const WORKSHOP_SRC = readFileSync(new URL("../src/panels/workshop.js", import.meta.url), "utf8");
const CANVAS_SRC = readFileSync(new URL("../src/canvas.js", import.meta.url), "utf8");
const SRC_FILES = ["canvas.js", "app.js", "panels/workshop.js", "panels/volume.js"].map((name) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8"),
);

test("чертёж берёт мерки у холста и отрисовки, а не повторяет их числами", () => {
  // Ручка поворота вещи и магнит углов стены — один шаг: человек, повернувший
  // вещь «как стену», ждёт тех же пятнадцати градусов.
  assert.equal(WORKSHOP_TURN_SNAP_DEG, SNAP_STEP_DEG, "шаг притяжки угла разошёлся");
  // Промах по стене: целятся в неё одним и тем же глазом на плане и в чертеже.
  assert.equal(WORKSHOP_WALL_PX, CANVAS_WALL_PICK_PX, "порог попадания в стену разошёлся");
});

test("панорама стрелками: шаг нажатия и потолок кадра — те же, что у плана", () => {
  // Наружу чертёж их не отдаёт (это его внутренние имена), поэтому сверяется
  // текст: мерка обязана быть **взята**, а не написана числом заново.
  assert.match(WORKSHOP_SRC, /WORKSHOP_PAN_STEP_PX = CANVAS_PAN_STEP_PX;/, "шаг панорамы написан числом");
  assert.match(WORKSHOP_SRC, /WORKSHOP_PAN_FRAME_MS = CANVAS_PAN_FRAME_MS;/, "потолок кадра написан числом");
  assert.ok(CANVAS_PAN_STEP_PX > 0 && CANVAS_PAN_FRAME_MS > 0);
});

test("минимум вершин контура — две равные мерки, и они оставлены врозь", () => {
  // Единственная пара из таблицы разбора, которую сводить **не надо** (решение
  // таска 173): здесь правило жеста — когда клик по первой вершине замыкает, —
  // а там правило данных, какой контур модель примет. Свести значило бы
  // сказать, что четырёхугольные комнаты запрещают трёхточечную ломаную метку.
  // Поэтому проверяется не равенство, а то, что чертёж взял **жест**.
  assert.equal(WORKSHOP_CONTOUR_MIN, GESTURE_CLOSE_MIN, "чертёж замыкает не тем правилом, что план");
  assert.equal(OUTLINE_MIN_POINTS, 3, "правило данных живёт своей жизнью — и это нарочно");
});

test("размер схемы без своих пикселей — один на все поверхности", () => {
  // До таска 173 та же тысяча стояла в восьми местах пяти файлов, а
  // каноническая пара функций была приватной в `render.js`.
  assert.equal(schemeWidthPx({}), SCHEME_FALLBACK_PX);
  assert.equal(schemeHeightPx({}), SCHEME_FALLBACK_PX);
  assert.equal(schemeWidthPx({ width: 2000 }), 2000, "свой размер умолчанием не перебивается");
});

test("разрешение выгрузки и база листа ГОСТ — одно число", () => {
  // Подпись окна выгрузки обещает миллиметры «при 300 dpi», лист ГОСТ считает
  // пиксели по своей базе, а запасное разрешение стояло в нём числом. Разойдись
  // они — обещание окна и бумага перестали бы совпадать.
  assert.equal(EXPORT_DPI, gostDpi(GOST_DPI_SCALE_DEFAULT), "разрешение выгрузки разошлось с базой листа");
  assert.equal(gostPixelsPerMm(0), gostPixelsPerMm(EXPORT_DPI), "запасное разрешение листа — не то же");
});

test("кегль чертёжного шрифта по ГОСТ 2.304 — один на лист и на развёртку", () => {
  assert.equal(GOST_TEXT_MM, 3.5, "кегль граф штампа и подписей листа");
  assert.ok(GOST_MIN_TEXT_MM < GOST_TEXT_MM, "наименьший кегль по ГОСТ ниже основного");
});

test("отступ подписи от метки — мерка отрисовки, а холст её берёт", () => {
  // Холст оттаскивает уехавшую подпись на тот же отступ, на какой отрисовка её
  // ставит. Числом он его не пишет: разойдись они — подпись прыгала бы при
  // первом же перетаскивании.
  assert.match(CANVAS_SRC, /size \* LABEL_GAP/, "отступ подписи в холсте написан числом");
  assert.equal(LABEL_GAP, 1.5);
});

test("кадр без requestAnimationFrame заказывается одной дверью", () => {
  // Своих `setTimeout(fn, 16)` было шесть копий в трёх файлах. Теперь кадр
  // заказывает `app.scheduleFrame`, и он же решает, чем его отменить.
  for (const code of SRC_FILES) {
    assert.ok(!/setTimeout\([^,)]+, 16\)/.test(code), "свой кадр в 16 мс мимо scheduleFrame");
  }
});
