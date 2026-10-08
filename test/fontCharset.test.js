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
// Кроме этих двух: они переназначены на настоящие знаки.
const FIXED = new Set([0x00d7, 0x00d8]);

function trapChars(value) {
  return [...value].filter((ch) => {
    const code = ch.codePointAt(0);
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
  const codes = new Set();
  for (let i = 0; i < segCount; i += 1) {
    const end = data.readUInt16BE(best + 14 + 2 * i);
    const start = data.readUInt16BE(best + 16 + segCount * 2 + 2 * i);
    if (end === 0xffff) continue;
    for (let code = start; code <= end; code += 1) codes.add(code);
  }
  return codes;
}

test("в шрифте есть знаки, дорисованные для чертежа", () => {
  const codes = fontCodepoints(FONT_PATH);
  const needed = [
    ["°", 0x00b0],
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

test("кириллица в шрифте на месте — дорисовка её не задела", () => {
  const codes = fontCodepoints(FONT_PATH);
  const alphabet = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789";
  assert.deepEqual(
    [...alphabet].filter((ch) => !codes.has(ch.codePointAt(0))),
    [],
  );
});
