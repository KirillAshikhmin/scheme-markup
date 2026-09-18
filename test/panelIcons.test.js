// Значки панелей и шапки. Имя значка — строка: опечатка в ней ничего не ломает
// и не падает, а молча выдаёт пустой квадратик там, где была кнопка. Поэтому
// сверка идёт по исходникам: какие имена код просит — против того, что
// нарисовано в наборе, в обе стороны.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

const files = sourceFiles(SRC_DIR);
const sources = files.map((file) => readFileSync(file, "utf8"));
const uiSource = readFileSync(join(SRC_DIR, "panels", "ui.js"), "utf8");

// Набор читается как текст, а не импортом: в Node нет DOM, а `ui.js` его трогает
// при первом же вызове. Литерал объявлен один раз и целиком.
const literal = uiSource.slice(uiSource.indexOf("const UI_ICONS = {"));
const drawn = new Map();
for (const [, name, paths] of literal.slice(0, literal.indexOf("\n};")).matchAll(/^\s{2}([A-Za-z]+): \[(.+)\],$/gm)) {
  drawn.set(name, paths.split('", "').map((path) => path.replace(/"/g, "")));
}

const asked = new Set();
for (const source of sources) {
  for (const [, name] of source.matchAll(/\buiIcon(?:Button)?\(\s*"([A-Za-z]+)"/g)) asked.add(name);
}

test("набор значков прочитан — иначе проверять было бы нечего", () => {
  assert.ok(drawn.size >= 15, "значков в наборе подозрительно мало: " + drawn.size);
  assert.ok(asked.size >= 10, "вызовов значков подозрительно мало: " + asked.size);
});

test("каждый запрошенный значок нарисован", () => {
  const missing = [...asked].filter((name) => !drawn.has(name)).sort();
  assert.deepEqual(missing, [], "кнопка просит значок, которого нет в наборе — выйдет пустая рамка");
});

test("в наборе нет значков, которых никто не просит", () => {
  const dead = [...drawn.keys()].filter((name) => !asked.has(name)).sort();
  assert.deepEqual(dead, [], "значок нарисован, а не используется");
});

// Значок — это перо, ведённое линиями, а не буква и не картинка: рисунок
// тянется за цветом кнопки и не зависит от шрифта машины.
test("каждый значок нарисован линиями и начинается с пера", () => {
  for (const [name, paths] of drawn) {
    assert.ok(paths.length > 0, "пустой значок: " + name);
    for (const path of paths) {
      assert.match(path, /^M[\s\d.-]/, "линия значка " + name + " начинается не с пера: " + path);
      assert.match(path, /^[MmLlHhVvAaCcSsQqTtZz\s\d.,-]+$/, "в линии значка " + name + " не только путь: " + path);
      // Абсолютные координаты обязаны лежать в клетке: значок рисуется в
      // `viewBox="0 0 24 24"`, и всё, что за её краем, просто не видно.
      const absolute = path.match(/[MLHV]\s*-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?)?/g) || [];
      for (const value of absolute.join(" ").match(/-?\d+(\.\d+)?/g) || []) {
        assert.ok(Number(value) >= 0 && Number(value) <= 24, "значок " + name + " вылез из клетки: " + path);
      }
    }
  }
});

// Прежние символы и эмодзи в подписях кнопок — то, от чего уходили: у эмодзи
// своя палитра и свой размер, а часть знаков в системном шрифте просто нет.
test("в панелях не осталось кнопок с символом вместо значка", () => {
  const symbol = /[←-⯿\u{1F300}-\u{1FAFF}☀-➿№]/u;
  const found = [];
  for (const [index, source] of sources.entries()) {
    for (const [, label] of source.matchAll(/\buiButton\(\s*"([^"]+)"/g)) {
      if (symbol.test(label)) found.push(files[index].split("/src/")[1] + ": «" + label + "»");
    }
  }
  assert.deepEqual(found, [], "подпись кнопки — символ шрифта; нарисуй значок в UI_ICONS");
});
