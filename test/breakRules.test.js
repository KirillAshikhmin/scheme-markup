// Набор снасти «сломай правило» — **данные**, и гниют они молча.
//
// `was` в `tools/breakRules.mjs` — дословный кусок файла сборки. Переформатируй
// `model.js`, перенеси функцию, переименуй тест — и запись обнуляется: правка
// перестаёт прикладываться, правило больше не проверяется ничем, и сказать об
// этом некому. Сама снасть это видит (`node tools/break-rules.mjs --list`), но
// звать её никто не обязан, а в `npm test` она не входит нарочно — прогон на
// каждое правило дорог.
//
// Поэтому здесь гоняется **не снасть, а её набор**: ни одной правки на диске,
// ни одного прогона тестов. Только сверка данных — каждый кусок ещё находится в
// своём файле ровно один раз, каждый назначенный тест ещё существует. Тот же
// приём, которым `test/strings.test.js` сверяет словарь в обе стороны:
// миллисекунды, зато гниение набора ловит обычный прогон, а дорогая часть
// остаётся отдельной командой.
//
// Чего эта сверка не доказывает — и это честно: что правка **ломает** правило и
// что названный тест на неё краснеет. Это умеет только сама снасть, и спросить
// её надо на каждой правке в области номеров, слияния и миграций.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BREAK_RULES } from "../tools/breakRules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Правил в наборе заведомо не меньше: сверка, позеленевшая на пустом или
// обрезанном наборе, — это та же тишина, от которой набор и стерегут.
const MIN_RULES = 15;

const TEXT = new Map();
function fileText(file) {
  if (!TEXT.has(file)) TEXT.set(file, existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : null);
  return TEXT.get(file);
}

test("набор не пуст и записи заполнены целиком", () => {
  assert.ok(BREAK_RULES.length >= MIN_RULES, "правил в наборе подозрительно мало: " + BREAK_RULES.length);
  const names = BREAK_RULES.map((item) => item.rule);
  assert.deepEqual(
    names.filter((name, at) => names.indexOf(name) !== at),
    [],
    "два правила с одним именем — из командной строки зовётся первое, второе не проверяется никогда",
  );
  for (const item of BREAK_RULES) {
    const where = "правило «" + item.rule + "»";
    assert.equal(typeof item.rule, "string", where + ": имени нет");
    assert.ok(item.rule.length > 0, where + ": имя пустое");
    assert.ok(typeof item.said === "string" && item.said.length > 0, where + ": не сказано, чем правило держит объект");
    assert.ok(typeof item.file === "string" && item.file.length > 0, where + ": файл не назван");
    assert.ok(typeof item.was === "string" && item.was.length > 0, where + ": ломать нечего, `was` пуст");
    assert.equal(typeof item.now, "string", where + ": `now` не строка");
    assert.notEqual(item.now, item.was, where + ": правка ничего не меняет");
    assert.ok(Array.isArray(item.tests) && item.tests.length > 0, where + ": не назван ни один тест, который обязан покраснеть");
  }
});

test("кусок каждого правила находится в своём файле ровно один раз", () => {
  const rotten = [];
  for (const item of BREAK_RULES) {
    const text = fileText(item.file);
    if (text === null) {
      rotten.push(item.rule + ": файла " + item.file + " нет");
      continue;
    }
    const times = text.split(item.was).length - 1;
    if (times !== 1) rotten.push(item.rule + ": кусок " + item.file + " нашёлся " + times + " раз, а не один");
  }
  assert.deepEqual(rotten, [], "правка не приложится — правило больше не проверяется ничем");
});

test("тесты, которые обязаны покраснеть, существуют", () => {
  const gone = [];
  for (const item of BREAK_RULES) {
    for (const file of item.tests) {
      if (!existsSync(join(ROOT, file))) gone.push(item.rule + ": " + file);
    }
  }
  assert.deepEqual(gone, [], "названный тест переименован или удалён — снасть прогонит пустоту и назовёт её зелёной");
});
