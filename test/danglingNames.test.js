// Имя, которого нет: проверка, что в `src/` не осталось чтения необъявленного
// имени (таск 203, дефект D55).
//
// Чем это кусало. Таск 187 перебрал левую колонку чертежа и унёс из разметки
// узел `subjectNote` — строку под полями. Все его записи он тоже убрал, кроме
// двух: они стояли в разборе движения мыши, в ветке призрака проёма. Бандл —
// одна область видимости, объявления у имени не осталось нигде, и каждое
// движение курсора по стене роняло в этой ветке `ReferenceError` **до**
// `redraw()`. Призрак считался и не рисовался: заказчик увидел «при добавлении
// проёмов\дверей\окон они не отрисовываются под курсором на стене».
//
// Прежние шесть сотен тестов это пропустили и пропустили бы снова: ветка живёт
// в обработчике события DOM, а DOM, холст и события тестами не покрываются
// нарочно. Зато сама поломка — не про картинку: это **имя, объявления которого
// нет ни в одном модуле**, и такое видно чтением исходников. Проверка общая, а
// не про один `subjectNote`: убрал узел и забыл запись — прогон краснеет в тот
// же день, а не на живом прогоне через три таска.
//
// Разбор исходника — тот же, которым сборка ищет одноимённые объявления
// верхнего уровня (`build.blankLiterals`): строки, шаблоны, регулярные
// выражения и комментарии гасятся пробелами, иначе слово из русской строки
// пошло бы в счёт именем.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { blankLiterals } from "../build.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

// Слова языка: они и так не имена.
const KEYWORDS = new Set([
  "arguments", "as", "async", "await", "break", "case", "catch", "class", "const", "constructor",
  "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "false", "finally",
  "for", "from", "function", "get", "if", "import", "in", "instanceof", "let", "new", "null", "of",
  "return", "set", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "undefined",
  "var", "void", "while", "with", "yield",
]);

// Что даёт страница снаружи: язык и браузер. Список нарочно перечислен, а не
// угадывается по регистру первой буквы: опечатка в имени браузерной двери —
// такая же поломка, как забытый узел колонки.
const GLOBALS = new Set([
  // язык
  "Array", "ArrayBuffer", "BigInt", "Boolean", "DataView", "Date", "Error", "Float32Array", "Float64Array",
  "Infinity", "Int32Array", "Intl", "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy",
  "RangeError", "Reflect", "RegExp", "Set", "String", "Symbol", "TypeError", "Uint8Array", "Uint16Array",
  "Uint32Array", "WeakMap", "WeakSet", "decodeURIComponent", "encodeURIComponent", "globalThis", "isFinite",
  "isNaN", "parseFloat", "parseInt", "structuredClone",
  // браузер
  "AbortController", "Blob", "CompressionStream", "DecompressionStream", "DOMParser", "File", "FileReader",
  "Image", "ImageData", "OffscreenCanvas", "Path2D", "ResizeObserver", "Response", "TextDecoder",
  "TextEncoder", "URL", "URLSearchParams", "atob", "btoa", "caches", "cancelAnimationFrame", "clearInterval",
  "clearTimeout", "console", "createImageBitmap", "crypto", "devicePixelRatio", "document", "fetch",
  "getComputedStyle", "indexedDB", "localStorage", "location", "matchMedia", "navigator", "performance",
  "queueMicrotask", "requestAnimationFrame", "requestIdleCallback", "screen", "self", "sessionStorage",
  "setInterval", "setTimeout", "window",
]);

const ID = /[A-Za-z_$][\w$]*/g;

function listModules(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...listModules(full));
    else if (name.endsWith(".js")) found.push(full);
  }
  return found;
}

// Куда ведёт закрывающая скобка пары.
function closingParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Имена, объявленные в модуле, — щедро: лишнее объявление только ослабляет
 * проверку, а лишнее **использование** покрасило бы прогон зря. Поэтому в счёт
 * идут и ключи разбора (`const { a: b } = …`), и все имена из списков
 * параметров.
 */
function declaredNames(code) {
  const names = new Set();
  const add = (text) => {
    for (const id of String(text || "").matchAll(ID)) if (!KEYWORDS.has(id[0])) names.add(id[0]);
  };
  for (const match of code.matchAll(/(?:const|let|var)\s+([^=;]+?)(?:=|;|\)|\bof\b|\bin\b)/g)) add(match[1]);
  for (const match of code.matchAll(/function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (match[1]) names.add(match[1]);
    add(match[2]);
  }
  for (const match of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(match[1]);
  for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(match[1]);
  for (const match of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/import\s*\{([^}]*)\}/g)) add(match[1]);
  // Короткая запись метода объекта: `toScreen(pointMm) {` — объявление, а не
  // вызов, и его параметры тоже объявление.
  for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) add(match[2]);
  return names;
}

/**
 * Имена, которые модуль **читает**. Из счёта выпадают:
 *
 *   свойства (`a.b`, `a?.b`) — их владелец не бандл, а объект;
 *   ключи объекта и метки (`{ a: 1 }`) — но не ветка тернарного `? :`;
 *   короткая запись метода (`name(args) {`) — это объявление;
 *   хвост числа (`0x1f`, `1e6`) — там имя начинается после цифры;
 *   флаги регулярного выражения (`/…/gi`) — гашение тела оставляет их кодом,
 *     и узнаются они по исходнику: слева от них стоит косая черта, которой в
 *     погашенном тексте уже нет. Длины гашение не меняет, поэтому места в
 *     обоих текстах одни и те же.
 */
function usedNames(code, raw) {
  const names = new Map();
  for (const match of code.matchAll(ID)) {
    const name = match[0];
    if (KEYWORDS.has(name)) continue;
    const at = match.index;
    if (at > 0 && /[\w$.]/.test(code[at - 1])) continue;
    if (at > 0 && raw[at - 1] === "/" && code[at - 1] !== "/") continue;
    const rest = code.slice(at + name.length);
    const ahead = rest.match(/^\s*(.?)/)[1];
    if (ahead === ":") {
      // Ключ или метка — если слева открылся объект, иначе это ветка `? :`.
      const left = code.slice(0, at).trimEnd().slice(-1);
      if (left === "" || left === "{" || left === "," || left === ";" || left === "}") continue;
    }
    if (ahead === "(") {
      const open = at + name.length + rest.indexOf("(");
      const close = closingParen(code, open);
      if (close > 0 && /^\s*\{/.test(code.slice(close + 1))) continue;
    }
    if (!names.has(name)) names.set(name, (code.slice(0, at).match(/\n/g) || []).length + 1);
  }
  return names;
}

const modules = listModules(SRC);
const cleaned = new Map(
  modules.map((file) => {
    const raw = readFileSync(file, "utf8");
    return [file, { raw, code: blankLiterals(raw) }];
  }),
);

test("в `src/` не читается ни одного имени без объявления", () => {
  // Бандл — одна область видимости, поэтому объявления собираются по всем
  // модулям разом: имя из соседнего файла — это обычный импорт.
  const declared = new Set();
  for (const { code } of cleaned.values()) for (const name of declaredNames(code)) declared.add(name);

  const dangling = [];
  for (const [file, { code, raw }] of cleaned) {
    for (const [name, line] of usedNames(code, raw)) {
      if (declared.has(name) || GLOBALS.has(name)) continue;
      dangling.push(relative(ROOT, file) + ":" + line + " — " + name);
    }
  }
  assert.deepEqual(
    dangling,
    [],
    "имя читается, а объявления ему нет нигде в `src/` — в браузере это `ReferenceError`:\n" + dangling.join("\n"),
  );
});

test("проверка видит поломку, из-за которой завелась", () => {
  // Та самая строка таска 187, слово в слово. Без этого теста проверка могла бы
  // ослабнуть незаметно: пустой список она выдаёт и когда ищет впустую.
  const broken = [
    'const ghost = { ok: false, message: "" };',
    "function onPointerMove() {",
    '  subjectNote.textContent = ghost && !ghost.ok ? ghost.message : openingHelp();',
    '  subjectNote.classList.toggle("is-bad", Boolean(ghost && !ghost.ok));',
    "}",
  ].join("\n");
  const code = blankLiterals(broken);
  const declared = declaredNames(code);
  const missing = [...usedNames(code, broken).keys()].filter((name) => !declared.has(name) && !GLOBALS.has(name));
  assert.deepEqual(missing.sort(), ["openingHelp", "subjectNote"]);
});
