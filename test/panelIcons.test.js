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
  // Три двери к набору: сам значок, кнопка-значок и кнопка со значком и словом.
  // Имя значка в каждой — первым доводом и строкой: только так его видно
  // отсюда, не поднимая DOM.
  for (const [, name] of source.matchAll(/\buiIcon(?:Button|LabelButton)?\(\s*"([A-Za-z]+)"/g)) asked.add(name);
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

// Отрезки значка: перо и прямые ходы — `M x y`, `h dx`, `v dy`, `H x`, `V y`,
// `L x y`, `z`. Больше в наборе и не встречается у прямоугольных знаков, а
// дуги (`a`, `c`) этот разбор пропускает — он нужен не для картинки целиком, а
// чтобы спросить у знака, есть ли у него стенка.
function segmentsOf(path) {
  const segments = [];
  let at = null;
  let start = null;
  for (const [, letter, numbers] of path.matchAll(/([MmHhVvLlZz])\s*([-\d.\s,]*)/g)) {
    const values = (numbers.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (letter === "M" || letter === "m") {
      const to = letter === "M" ? { x: values[0], y: values[1] } : { x: at.x + values[0], y: at.y + values[1] };
      at = to;
      start = to;
      // Перо могло продолжиться списком пар — это уже линии.
      for (let index = 2; index + 1 < values.length; index += 2) {
        const next = letter === "M" ? { x: values[index], y: values[index + 1] } : { x: at.x + values[index], y: at.y + values[index + 1] };
        segments.push({ from: at, to: next });
        at = next;
      }
      continue;
    }
    if (!at) continue;
    if (letter === "z" || letter === "Z") {
      segments.push({ from: at, to: start });
      at = start;
      continue;
    }
    for (const value of values) {
      const next =
        letter === "h"
          ? { x: at.x + value, y: at.y }
          : letter === "H"
            ? { x: value, y: at.y }
            : letter === "v"
              ? { x: at.x, y: at.y + value }
              : { x: at.x, y: value };
      segments.push({ from: at, to: next });
      at = next;
    }
  }
  return segments;
}

// Дефект D44: «иконка принтера обрезана слева у кнопки». Обрезала её не кнопка
// и не стиль — у корпуса просто не было левой стенки, при живой правой. Поэтому
// проверяется не ширина знака (она и тогда была от 4,5 до 19,5), а сами стенки:
// корпус — коробка, и стоять она должна на двух боках.
test("у корпуса принтера две стенки, а не одна (D44)", () => {
  const segments = drawn.get("printer").flatMap((path) => segmentsOf(path));
  const vertical = segments.filter((segment) => segment.from.x === segment.to.x);
  const wall = (x) =>
    vertical.some(
      (segment) =>
        segment.from.x === x && Math.min(segment.from.y, segment.to.y) <= 10 && Math.max(segment.from.y, segment.to.y) >= 16,
    );
  const sides = [...new Set(segments.map((segment) => segment.from.x).concat(segments.map((segment) => segment.to.x)))];
  const left = Math.min(...sides);
  const right = Math.max(...sides);
  assert.equal(left, 24 - right, "знак принтера не по середине клетки: " + left + "…" + right);
  assert.ok(wall(left), "у корпуса нет левой стенки — знак читается обрезанным");
  assert.ok(wall(right), "у корпуса нет правой стенки");
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
