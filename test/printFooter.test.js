// Низ печатного листа пуст: имени объекта внизу нет ни у таблицы, ни у схемы.
//
// Заказчик: «в версии таблиц и схем для печати не пиши снизу название объекта».
// Проверить это готовым узлом нельзя — `exportTableNode` строит DOM, а тесты
// сборки идут в Node без браузера. Поэтому сверка по исходникам, как в
// `strings.test.js`: колонтитула не должно остаться ни в разметке, ни в стилях,
// ни в вызовах печати.
//
// Тест смотрит и в обратную сторону — заголовок, подзаголовок и итоги обязаны
// быть на месте: иначе он позеленел бы и на выпотрошенном листе.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(SRC_DIR, name), "utf8");

const PRINT_CSS = read("print.css");
const EXPORTER = read("exporter.js");
const EXPORT_PANEL = join("panels", "export.js");

test("в печатном листе не осталось колонтитула с именем объекта", () => {
  for (const [name, source] of [
    ["print.css", PRINT_CSS],
    ["exporter.js", EXPORTER],
    [EXPORT_PANEL, read(EXPORT_PANEL)],
  ]) {
    assert.ok(!source.includes("print-doc__foot"), name + ": подвал листа должен быть убран целиком");
  }
});

test("печати таблицы больше не передают имя объекта подвалом", () => {
  for (const [name, source] of [
    ["exporter.js", EXPORTER],
    [EXPORT_PANEL, read(EXPORT_PANEL)],
  ]) {
    assert.ok(!/\bfooter\b/.test(source), name + ": мёртвый параметр footer должен быть убран");
  }
});

test("шапка листа и итоги остались на месте", () => {
  for (const marker of ["print-doc__title", "print-doc__sub", "print-doc__totals"]) {
    assert.ok(PRINT_CSS.includes(marker), "print.css: потерян " + marker);
    assert.ok(EXPORTER.includes(marker), "exporter.js: потерян " + marker);
  }
});
