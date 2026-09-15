// Словарь строк. Опасность здесь одна: ключи склеиваются на лету —
// `text("errors." + key)`. Промах такой склейки ничего не ломает и не падает,
// а молча выходит пользователю строкой «errors.foo» вместо русского текста.
// Поэтому сверка идёт по исходникам: какие коды код действительно бросает и
// показывает — против того, что записано в словаре, в обе стороны.
//
// Список кодов собирается сканированием `src/**`, а функции-обёртки
// (`modelError`, `problem`) тест находит сам — по тому, что внутри они зовут
// `text("<раздел>." + <аргумент>)`. Новый модуль со своей обёрткой попадает
// под проверку без правки теста.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strings } from "../src/strings.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
// Разделы словаря, ключи которых собираются из кодов, а не пишутся в разметке.
const DYNAMIC_SECTIONS = ["errors", "problems"];
// Столько кодов в каждом разделе есть заведомо (в «errors» их под тридцать,
// в «problems» — за десяток): если сканер перестанет что-то находить, тест
// обязан покраснеть, а не позеленеть на пустом списке.
const MIN_CODES = 8;

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

// Обёртка объявляет себя сама: `function modelError(key, …) { … text("errors." + key) … }`.
// Возвращает пары «имя функции → раздел словаря».
function errorHelpers(sources) {
  const found = new Map();
  for (const source of sources) {
    const declarations = source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{([\s\S]*?)\n\}/g);
    for (const [, name, param, body] of declarations) {
      const uses = body.match(new RegExp('text\\(\\s*"([A-Za-z]+)\\."\\s*\\+\\s*' + param + "\\b"));
      if (uses) found.set(name, uses[1]);
    }
  }
  return found;
}

function collectCodes(sources, section, helpers) {
  const codes = new Set();
  const key = "([A-Za-z0-9_]+)";
  const patterns = [
    new RegExp('text\\(\\s*"' + section + "\\." + key + '"', "g"),
    new RegExp("\\bstrings\\." + section + "\\." + key + "\\b", "g"),
  ];
  for (const [name, target] of helpers) {
    if (target === section) patterns.push(new RegExp("\\b" + name + '\\(\\s*"' + key + '"', "g"));
  }
  for (const source of sources) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) codes.add(match[1]);
    }
  }
  return codes;
}

const sources = sourceFiles(SRC_DIR).map((file) => readFileSync(file, "utf8"));
const helpers = errorHelpers(sources);

test("обёртки кодов находятся сканированием — иначе проверять было бы нечего", () => {
  assert.ok(sources.length > 10, "исходники не нашлись: " + sources.length);
  const sections = new Set(helpers.values());
  for (const section of DYNAMIC_SECTIONS) {
    assert.ok(sections.has(section), "не найдена ни одна обёртка раздела " + section);
  }
});

for (const section of DYNAMIC_SECTIONS) {
  test("каждый код раздела " + section + " имеет строку в словаре", () => {
    const codes = collectCodes(sources, section, helpers);
    assert.ok(codes.size >= MIN_CODES, "сканер нашёл подозрительно мало кодов: " + codes.size);
    const missing = [...codes].filter((code) => typeof strings[section][code] !== "string").sort();
    assert.deepEqual(missing, [], "код без строки — пользователь увидит «" + section + ".<код>»");
  });

  test("в разделе " + section + " нет мёртвых ключей", () => {
    const codes = collectCodes(sources, section, helpers);
    const dead = Object.keys(strings[section]).filter((code) => !codes.has(code)).sort();
    assert.deepEqual(dead, [], "строка есть, а кода никто не бросает и не показывает");
  });
}
