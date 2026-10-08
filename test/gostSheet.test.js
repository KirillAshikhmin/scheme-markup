// Лист по ГОСТ Р 21.1101-2013: геометрия бумаги и основной надписи.
//
// Эти числа — не договорённость сборки, а размеры из приложения Ж стандарта,
// и выверяет их заказчик линейкой на бумаге. Поэтому тест пишет их заново,
// руками, а не берёт из того же модуля: списать константу у проверяемого кода
// значило бы проверить, что он равен сам себе.
import test from "node:test";
import assert from "node:assert/strict";
import {
  GOST_FORMATS,
  GOST_MIN_TEXT_MM,
  GOST_STAMP_WIDTH_MM,
  GOST_TABLE_ROW_MM,
  gostDpi,
  gostField,
  gostFit,
  gostFrame,
  gostPaginate,
  gostPickSheet,
  gostPixelsPerMm,
  gostScaleDenominator,
  gostScaleText,
  gostSheetLayout,
  gostSheetSize,
  gostStampForm,
  gostStampRect,
  gostStampValues,
} from "../src/gostSheet.js";
import { strings } from "../src/strings.js";

const A4 = gostSheetSize("A4", "portrait");

test("форматы листа — те, что в ГОСТ 2.301", () => {
  assert.deepEqual(
    GOST_FORMATS.map((format) => [format.id, format.width, format.height]),
    [
      ["A4", 210, 297],
      ["A3", 297, 420],
      ["A2", 420, 594],
      ["A1", 594, 841],
    ],
  );
});

test("A4 книжная — 210 × 297, альбомная — 297 × 210", () => {
  assert.deepEqual([A4.width, A4.height], [210, 297]);
  const landscape = gostSheetSize("A4", "landscape");
  assert.deepEqual([landscape.width, landscape.height], [297, 210]);
  // Неизвестный формат читается как A4: печатает заказчик только его.
  assert.equal(gostSheetSize("A0", "portrait").format, "A4");
});

test("рамка — 20 мм слева под подшивку, по 5 мм с трёх сторон", () => {
  const frame = gostFrame(A4);
  assert.deepEqual(frame, { x: 20, y: 5, width: 185, height: 287 });
  // Правый и нижний обрез — ровно 5 мм.
  assert.equal(A4.width - (frame.x + frame.width), 5);
  assert.equal(A4.height - (frame.y + frame.height), 5);
});

test("основная надпись — 185 мм шириной, в правом нижнем углу рамки", () => {
  const stamp = gostStampRect(A4, "form3");
  assert.deepEqual(stamp, { x: 20, y: 237, width: 185, height: 55 });
  // На A4 книжной надпись занимает ширину рамки ровно — поле подшивки слева.
  assert.equal(stamp.width, GOST_STAMP_WIDTH_MM);
  assert.equal(gostStampRect(A4, "form5").height, 40);
  assert.equal(gostStampRect(A4, "form6").height, 15);
  // На альбомном A3 надпись прижата к правому краю рамки, а не растянута.
  const a3 = gostSheetSize("A3", "landscape");
  const wide = gostStampRect(a3, "form3");
  assert.equal(wide.x + wide.width, gostFrame(a3).x + gostFrame(a3).width);
  assert.equal(wide.width, 185);
});

test("поле чертежа — рамка без полосы под надписью", () => {
  assert.deepEqual(gostField(A4, "form3"), { x: 20, y: 5, width: 185, height: 232 });
  assert.equal(gostField(A4, "form5").height, 287 - 40);
  assert.equal(gostField(A4, "form6").height, 287 - 15);
});

// ——— сетка основной надписи ——————————————————————————————————————————

function stampCell(form, x, y) {
  return gostStampForm(form).cells.find((cell) => cell.x === x && cell.y === y) || null;
}

test("форма 3: высота 11 строк по 5 мм, графы на своих местах", () => {
  const grid = gostStampForm("form3");
  assert.equal(grid.height, 55);
  // Правый блок: обозначение документа, наименование объекта, стадия/лист/листов.
  assert.deepEqual(
    [stampCell("form3", 65, 0).width, stampCell("form3", 65, 0).height],
    [120, 10],
  );
  assert.deepEqual([stampCell("form3", 65, 10).width, stampCell("form3", 65, 10).height], [120, 15]);
  assert.deepEqual([stampCell("form3", 65, 25).width, stampCell("form3", 65, 25).height], [70, 15]);
  assert.deepEqual([stampCell("form3", 135, 25).width, stampCell("form3", 135, 25).height], [15, 5]);
  assert.deepEqual([stampCell("form3", 150, 25).width, stampCell("form3", 165, 25).width], [15, 20]);
  assert.deepEqual([stampCell("form3", 135, 30).width, stampCell("form3", 135, 30).height], [15, 10]);
  // Наименование чертежа и организация — нижняя строка: 70 и 50.
  assert.equal(stampCell("form3", 65, 40).width, 70);
  assert.equal(stampCell("form3", 135, 40).width, 50);
});

test("форма 3: колонки блока изменений и блока подписей — по стандарту", () => {
  const grid = gostStampForm("form3");
  const changeRow = grid.cells.filter((cell) => cell.y === 0 && cell.x < 65);
  assert.deepEqual(changeRow.map((cell) => cell.width), [10, 10, 10, 10, 15, 10]);
  assert.equal(changeRow.reduce((sum, cell) => sum + cell.width, 0), 65);
  // Строка с названиями колонок стоит под пустыми строками изменений.
  assert.deepEqual(
    grid.cells.filter((cell) => cell.y === 20 && cell.x < 65).map((cell) => cell.label),
    ["changeNo", "changeArea", "changeSheet", "changeDoc", "changeSign", "changeDate"],
  );
  const workRow = grid.cells.filter((cell) => cell.y === 25 && cell.x < 65);
  assert.deepEqual(workRow.map((cell) => cell.width), [20, 20, 15, 10]);
  // Первая строка подписей — «Разраб.», последняя — «Н. контр.»: так напечатано
  // в самой форме, и выдумывать на их месте другое нельзя.
  assert.equal(workRow[0].label, "roleAuthor");
  assert.equal(grid.cells.filter((cell) => cell.y === 50 && cell.x === 0)[0].label, "roleControl");
});

test("форма 5: высота 8 строк, форма 6: 3 строки и номер листа справа", () => {
  assert.equal(gostStampForm("form5").height, 40);
  assert.deepEqual([stampCell("form5", 65, 0).width, stampCell("form5", 65, 0).height], [120, 15]);
  assert.deepEqual([stampCell("form5", 65, 15).width, stampCell("form5", 65, 15).height], [70, 25]);
  assert.equal(stampCell("form5", 135, 25).width, 50);
  const six = gostStampForm("form6");
  assert.equal(six.height, 15);
  assert.deepEqual([stampCell("form6", 65, 0).width, stampCell("form6", 65, 0).height], [110, 15]);
  assert.deepEqual([stampCell("form6", 175, 0).height, stampCell("form6", 175, 7).height], [7, 8]);
});

test("ячейки каждой формы не налезают друг на друга и не вылезают за надпись", () => {
  for (const form of ["form3", "form5", "form6"]) {
    const grid = gostStampForm(form);
    for (const cell of grid.cells) {
      assert.ok(cell.x >= 0 && cell.x + cell.width <= GOST_STAMP_WIDTH_MM, form + ": ячейка шире надписи");
      assert.ok(cell.y >= 0 && cell.y + cell.height <= grid.height, form + ": ячейка ниже надписи");
    }
    for (let i = 0; i < grid.cells.length; i += 1) {
      for (let j = i + 1; j < grid.cells.length; j += 1) {
        const a = grid.cells[i];
        const b = grid.cells[j];
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        assert.ok(!overlap, form + ": ячейки налезают — " + JSON.stringify([a, b]));
      }
    }
  }
});

// ——— вписывание плана и настоящий масштаб ———————————————————————————

test("план вписывается целиком и встаёт по центру поля", () => {
  const field = gostField(A4, "form3");
  const fit = gostFit({ width: 1000, height: 500 }, field);
  // Упирается ширина: 185 / 1000 меньше, чем 232 / 500.
  assert.equal(fit.scale, 185 / 1000);
  assert.equal(fit.width, 185);
  assert.equal(fit.height, 92.5);
  assert.equal(fit.x, 20);
  assert.equal(fit.y, field.y + (field.height - fit.height) / 2);
  // Высокий план упирается высотой — и тоже влезает целиком.
  const tall = gostFit({ width: 500, height: 2000 }, field);
  assert.ok(tall.width <= field.width + 1e-9 && tall.height <= field.height + 1e-9);
  assert.equal(tall.scale, field.height / 2000);
});

test("масштаб в штампе считается из той же величины, которой вписан план (G169)", () => {
  const field = gostField(A4, "form3");
  const fit = gostFit({ width: 1000, height: 500 }, field);
  const perMeter = 100; // пикселей плана на метр
  const denominator = gostScaleDenominator(fit.scale, perMeter);
  // Отрезок в 300 пикселей плана: на бумаге он займёт столько миллиметров…
  const paperMm = 300 * fit.scale;
  // …а на объекте — столько метров. Отношение второго к первому и есть 1:N.
  const realMm = (300 / perMeter) * 1000;
  assert.ok(Math.abs(realMm / paperMm - denominator) < 1e-9);
  assert.ok(Math.abs(denominator - 1000 / (perMeter * 0.185)) < 1e-9);
});

test("масштаб пишется настоящим, без подгонки к ряду, с одним знаком", () => {
  // 1:54,05… — ряд 1:50 рядом, но брать его нельзя.
  assert.equal(gostScaleText(54.054), "М 1:54,1");
  assert.equal(gostScaleText(137.44), "М 1:137,4");
  // Целое отношение остаётся целым.
  assert.equal(gostScaleText(100), "М 1:100");
  // Без калибровки масштаба нет — и это говорится, а не выдумывается число.
  assert.equal(gostScaleDenominator(0.185, 0), null);
  assert.equal(gostScaleDenominator(0, 100), null);
  assert.equal(gostScaleText(null), strings.gost.noScale);
});

// ——— подбор формата ———————————————————————————————————————————————————

test("берётся самый мелкий формат, на котором подпись не мельче 2,5 мм", () => {
  // План 1000 × 500 ложится на альбомный A4: масштаб 0,272 мм на пиксель,
  // подпись 20 px → 5,4 мм.
  const small = gostPickSheet({ width: 1000, height: 500 }, { textPx: 20 });
  assert.equal(small.sheet.format, "A4");
  assert.ok(small.textMm >= GOST_MIN_TEXT_MM);
  assert.equal(small.tooSmall, false);
  // Тот же план с мелкой подписью (8 px → 2,2 мм) A4 уже не держит: формат растёт
  // ровно на один шаг, а не до самого крупного.
  const bigger = gostPickSheet({ width: 1000, height: 500 }, { textPx: 8 });
  assert.equal(bigger.sheet.format, "A3");
  assert.ok(bigger.textMm >= GOST_MIN_TEXT_MM);
});

test("подпись не влезает никуда — берётся A1 и об этом говорят вслух", () => {
  const huge = gostPickSheet({ width: 40000, height: 20000 }, { textPx: 20 });
  assert.equal(huge.sheet.format, "A1");
  assert.equal(huge.tooSmall, true);
  assert.ok(huge.textMm < GOST_MIN_TEXT_MM);
});

test("ориентация идёт за планом: лежачий ложится на альбомный лист", () => {
  const wide = gostPickSheet({ width: 2000, height: 700 }, { textPx: 20 });
  assert.equal(wide.sheet.orientation, "landscape");
  const tall = gostPickSheet({ width: 700, height: 2000 }, { textPx: 20 });
  assert.equal(tall.sheet.orientation, "portrait");
});

test("формат, выбранный руками, подбор не переспорит — но о мелкоте скажет", () => {
  const manual = gostSheetLayout({ width: 40000, height: 20000 }, { format: "A4", textPx: 20 });
  assert.equal(manual.sheet.format, "A4");
  assert.equal(manual.tooSmall, true);
  const auto = gostSheetLayout({ width: 1000, height: 500 }, { format: "auto", textPx: 20 });
  assert.equal(auto.sheet.format, "A4");
});

// ——— листы таблицы ————————————————————————————————————————————————————

test("таблица режется на листы: первый по форме 5, следующие по форме 6", () => {
  const perFirst = Math.floor(gostField(A4, "form5").height / GOST_TABLE_ROW_MM) - 1;
  const perNext = Math.floor(gostField(A4, "form6").height / GOST_TABLE_ROW_MM) - 1;
  const pages = gostPaginate(perFirst + perNext + 1, A4);
  assert.deepEqual(pages.map((page) => page.form), ["form5", "form6", "form6"]);
  assert.equal(pages[0].from, 0);
  assert.equal(pages[0].to, perFirst);
  assert.equal(pages[pages.length - 1].to, perFirst + perNext + 1);
  // Листов больше у формы 5: её надпись выше, значит строк на первом листе меньше.
  assert.ok(perNext > perFirst);
});

test("строки не теряются и не повторяются при разбивке", () => {
  for (const total of [0, 1, 7, 26, 27, 28, 140]) {
    const pages = gostPaginate(total, A4);
    assert.ok(pages.length >= 1, "лист всегда есть, даже у пустой таблицы");
    let at = 0;
    for (const page of pages) {
      assert.equal(page.from, at);
      at = page.to;
    }
    assert.equal(at, Math.max(0, total));
  }
});

// ——— графы ————————————————————————————————————————————————————————————

test("графы штампа заполняются данными объекта и листа", () => {
  const values = gostStampValues(
    { code: "2026-14-ЭОМ", stage: "Р", author: "Иванов", checker: "Петров", approver: "Сидоров", org: "ООО «Свет»" },
    { object: "Квартира", building: "Кухня", drawing: "1 этаж", scale: "М 1:137,4", sheet: 2, sheets: 5, date: "08.10.26" },
  );
  assert.equal(values.code, "2026-14-ЭОМ");
  assert.equal(values.object, "Квартира");
  assert.equal(values.building, "Кухня");
  // Масштаб идёт второй строкой под наименованием изображения: своей графы
  // «Масштаб» у формы 3 нет, и по СПДС его пишут именно там.
  assert.equal(values.drawing, "1 этаж\nМ 1:137,4");
  assert.deepEqual([values.stage, values.sheet, values.sheets], ["Р", "2", "5"]);
  assert.equal(values.name0, "Иванов");
  assert.equal(values.date0, "08.10.26");
  assert.deepEqual([values.role1, values.name1], [strings.gost.roleChecker, "Петров"]);
  assert.deepEqual([values.role2, values.name2], [strings.gost.roleApprover, "Сидоров"]);
  assert.equal(values.org, "ООО «Свет»");
});

test("фамилия разработчика встаёт в ту строку, где напечатано «Разраб.»", () => {
  // Строка подписей — это четыре ячейки на одной высоте. Разойдись ключ
  // значения со строкой формы — фамилия уехала бы на строку ниже подписи, и
  // заметить это можно было бы только глазами на готовом листе.
  for (const form of ["form3", "form5"]) {
    const grid = gostStampForm(form);
    const author = grid.cells.find((cell) => cell.label === "roleAuthor");
    assert.ok(author, form + ": строки «Разраб.» нет");
    const name = grid.cells.find((cell) => cell.y === author.y && cell.x === author.width);
    assert.equal(name.field, "name0", form + ": фамилия не в строке «Разраб.»");
    const date = grid.cells.filter((cell) => cell.y === author.y && cell.x < 65).pop();
    assert.equal(date.field, "date0");
    // «Пров.» и «Утв.» уходят в свободные строки между «Разраб.» и «Н. контр.».
    const control = grid.cells.find((cell) => cell.label === "roleControl");
    for (const index of [1, 2]) {
      const row = grid.cells.find((cell) => cell.field === "role" + index);
      assert.ok(row && row.y > author.y && row.y < control.y, form + ": строка " + index + " не свободная");
    }
  }
});

test("незаполненные графы остаются пустыми — лист всё равно выходит", () => {
  const values = gostStampValues(null, { drawing: "1 этаж", scale: strings.gost.noScale, sheet: 1, sheets: 1 });
  assert.equal(values.code, "");
  assert.equal(values.org, "");
  assert.equal(values.name0, "");
  // Пустая строка «Утв.» не печатается вовсе: подпись без фамилии читалась бы
  // как «не утверждено», а графу просто не заполняли.
  assert.equal(values.role2, undefined);
  assert.equal(values.drawing, "1 этаж\n" + strings.gost.noScale);
});

test("разрешение листа: множитель диалога переводится в dpi", () => {
  assert.deepEqual([gostDpi(1), gostDpi(2), gostDpi(4)], [150, 300, 600]);
  // 300 dpi — 11,81 пикселя в миллиметре, A4 книжная выходит 2480 × 3508.
  const mm = gostPixelsPerMm(300);
  assert.equal(Math.round(A4.width * mm), 2480);
  assert.equal(Math.round(A4.height * mm), 3508);
});
