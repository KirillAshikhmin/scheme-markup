// Ловушка чертёжного шрифта. «GOST type A» собран под однобайтовую кодировку:
// коды 0xC0-0xFF в нём отданы кириллице по CP1251. Набранный знак умножения
// `×` (U+00D7) рисуется буквой «Ч», `À` — буквой «А». Подмена молчаливая:
// подменного шрифта не подставляется, потому что для браузера знак в шрифте
// есть, и неверная буква уезжает в чертёж и в печать.
//
// Два кода, нужных чертежу, — `×` и `Ø` — починены в `tools/draw-glyphs.py`.
// Остальные так и ведут на кириллицу, поэтому знаки из этого диапазона в
// видимых строках запрещены. Глазами такое не ловится: «À» и «А» в редакторе
// неотличимы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strings } from "../src/strings.js";
import { createProject, typesInOrder } from "../src/model.js";

const FONT_PATH = fileURLToPath(new URL("../src/assets/gost-type-a.ttf", import.meta.url));

// Диапазон, который в этом шрифте значит не то, что набрано.
const TRAP_FIRST = 0x00c0;
const TRAP_LAST = 0x00ff;
// Кроме этих: они переназначены на настоящие знаки.
const FIXED = new Set([0x00d7, 0x00d8, 0x00b2, 0x00b3]);

// Ловушка шире сплошного диапазона: CP1251 держит кириллицу не только в
// 0xC0-0xFF, и в верхней половине 0x80-0xBF тот же шрифт раздал ещё девять
// кодов. Найдено глазами (таск 114): в плашке комментария «3×6 мм²» вторая
// степень нарисовалась украинской «І» — молча, как и всё остальное в этой
// ловушке.
//
// Степень в сечении кабеля и в объёме воздуха — знак рабочий, и человек
// набирает его сам, в комментарии или в названии типа, где никакой тест его
// не прикроет. Поэтому `²` и `³` **дорисованы** (цифра шрифта, уменьшенная и
// поднятая под верх заглавной) и из ловушки вышли. Семь оставшихся кодов —
// украинские буквы и дубли «Ё», «ё», «№», которые есть на своих местах;
// дорисовывать нечего, они перечислены поимённо со своим двойником.
//
// Сплошным диапазоном 0x80-0xBF их не закрыть: `°` (0x00B0) тоже отсюда, но он
// дорисован и настоящий, а `±`, `«», `»`, `№`-подобные коды в шрифт не попали
// вовсе — на них браузер честно подставит запасной шрифт, и видно сразу.
const TRAP_SINGLES = new Map([
  [0x00a8, "Ё"],
  [0x00aa, "Є"],
  [0x00af, "Ї"],
  [0x00b8, "ё"],
  [0x00b9, "№"],
  [0x00ba, "є"],
  [0x00bf, "ї"],
]);

function trapChars(value) {
  return [...value].filter((ch) => {
    const code = ch.codePointAt(0);
    if (TRAP_SINGLES.has(code)) return true;
    return code >= TRAP_FIRST && code <= TRAP_LAST && !FIXED.has(code);
  });
}

function walkStrings(node, path, found) {
  if (typeof node === "string") {
    const bad = trapChars(node);
    if (bad.length) found.push({ path, text: node, bad });
    return found;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walkStrings(value, path ? `${path}.${key}` : key, found);
    }
  }
  return found;
}

test("в словаре строк нет знаков, которые шрифт нарисует кириллицей", () => {
  const found = walkStrings(strings, "", []);
  assert.deepEqual(
    found.map(({ path, bad }) => `${path}: ${bad.join(" ")}`),
    [],
  );
});

test("в шаблоне справочника нет таких знаков — ни в названиях, ни в кодах", () => {
  const project = createProject({ name: "Проба" });
  const found = [];
  for (const { category, types } of typesInOrder(project)) {
    const fields = [["категория", category.name]];
    for (const type of types) {
      fields.push(["тип", type.name], ["код", type.code]);
    }
    for (const [what, value] of fields) {
      const bad = trapChars(String(value ?? ""));
      if (bad.length) found.push(`${what} ${value}: ${bad.join(" ")}`);
    }
  }
  assert.deepEqual(found, []);
});

test("проверка ловит подсадку — иначе два теста выше зелены впустую", () => {
  // «À» вместо «А»: в редакторе неотличимо, шрифт нарисует «А».
  assert.deepEqual(trapChars("Ìåòêà"), ["Ì", "å", "ò", "ê", "à"]);
  assert.deepEqual(trapChars("Метка"), []);
  // Починенные коды запрещёнными не считаются.
  assert.deepEqual(trapChars("3×4, ⌀16, Ø20"), []);
});

// Разбор cmap формата 4 — ровно столько, чтобы узнать, какие коды в файле
// есть. Нужен, чтобы откат шрифта к исходному файлу не прошёл молча.
function fontCodepoints(path) {
  const data = readFileSync(path);
  const tableCount = data.readUInt16BE(4);
  let cmapOffset = 0;
  for (let i = 0; i < tableCount; i += 1) {
    const record = 12 + 16 * i;
    if (data.toString("latin1", record, record + 4) === "cmap") {
      cmapOffset = data.readUInt32BE(record + 8);
    }
  }
  assert.ok(cmapOffset, "в файле шрифта нет таблицы cmap");
  const subCount = data.readUInt16BE(cmapOffset + 2);
  let best = 0;
  for (let i = 0; i < subCount; i += 1) {
    const entry = cmapOffset + 4 + 8 * i;
    const platform = data.readUInt16BE(entry);
    const encoding = data.readUInt16BE(entry + 2);
    const offset = cmapOffset + data.readUInt32BE(entry + 4);
    if (platform === 3 && encoding === 1 && data.readUInt16BE(offset) === 4) best = offset;
  }
  assert.ok(best, "в шрифте нет юникодной подтаблицы cmap для Windows");
  const segCount = data.readUInt16BE(best + 6) / 2;
  // Код -> номер глифа. `Map` вместо `Set` нарочно: `has` у них одинаковый,
  // поэтому проверки «знак в шрифте есть» не меняются, а проверка ловушки
  // спрашивает ещё и номер — два кода на одном глифе и есть подмена.
  const codes = new Map();
  for (let i = 0; i < segCount; i += 1) {
    const end = data.readUInt16BE(best + 14 + 2 * i);
    const start = data.readUInt16BE(best + 16 + segCount * 2 + 2 * i);
    if (end === 0xffff) continue;
    const delta = data.readInt16BE(best + 16 + segCount * 4 + 2 * i);
    const rangeAt = best + 16 + segCount * 6 + 2 * i;
    const rangeOffset = data.readUInt16BE(rangeAt);
    for (let code = start; code <= end; code += 1) {
      let glyph;
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        glyph = data.readUInt16BE(rangeAt + rangeOffset + (code - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) codes.set(code, glyph);
    }
  }
  return codes;
}

test("в шрифте есть знаки, дорисованные для чертежа", () => {
  const codes = fontCodepoints(FONT_PATH);
  const needed = [
    ["°", 0x00b0],
    ["²", 0x00b2],
    ["³", 0x00b3],
    ["–", 0x2013],
    ["—", 0x2014],
    ["∅", 0x2205],
    ["⌀", 0x2300],
    ["×", 0x00d7],
    ["Ø", 0x00d8],
  ];
  assert.deepEqual(
    needed.filter(([, code]) => !codes.has(code)).map(([sign]) => sign),
    [],
  );
});

// Список ловушек не на веру: каждый перечисленный код обязан вести на тот же
// глиф, что и его кириллический двойник. Поправят шрифт — тест покраснеет и
// список придётся пересмотреть, а не оставить «на всякий случай».
test("перечисленные ловушки и правда ведут на кириллицу", () => {
  const codes = fontCodepoints(FONT_PATH);
  const wrong = [];
  for (const [code, twin] of TRAP_SINGLES) {
    const glyph = codes.get(code);
    const twinGlyph = codes.get(twin.codePointAt(0));
    if (!glyph || !twinGlyph || glyph !== twinGlyph) {
      wrong.push(String.fromCodePoint(code) + " (ждали глиф «" + twin + "»)");
    }
  }
  assert.deepEqual(wrong, []);
});

test("починенные коды на кириллицу больше не ведут", () => {
  const codes = fontCodepoints(FONT_PATH);
  // `×` стоял на «Ч», `Ø` — на «Ш». Разъехаться они обязаны: иначе дорисовка
  // откатилась, а тест на наличие знаков этого не заметит — знаки-то есть.
  assert.notEqual(codes.get(0x00d7), codes.get("Ч".codePointAt(0)));
  assert.notEqual(codes.get(0x00d8), codes.get("Ш".codePointAt(0)));
});

test("кириллица в шрифте на месте — дорисовка её не задела", () => {
  const codes = fontCodepoints(FONT_PATH);
  const alphabet = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789";
  assert.deepEqual(
    [...alphabet].filter((ch) => !codes.has(ch.codePointAt(0))),
    [],
  );
});
