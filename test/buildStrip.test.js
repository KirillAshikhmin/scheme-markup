// Сборка везёт код без комментариев (`stripComments`, `stripCssComments` в
// `build.js`) и поток со своей выжимкой словаря (`WORKER_STRINGS`). Разбор
// комментариев — свой, поэтому его сверяет независимый разбор `blankLiterals`:
// у исходника и итога код до пробела один и тот же — выпали только
// комментарии и пробелы, ни одного знака кода, строки или выражения.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { WORKER_STRINGS, assertWorkerStrings, blankLiterals, buildPage, stripComments, stripCssComments, workerBundle, workerStringsSource } from "../build.js";
import { strings, text } from "../src/strings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function files(dir, extension) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full, extension));
    else if (entry.name.endsWith(extension)) out.push(full);
  }
  return out;
}

// Код без строк, выражений, комментариев и пробелов: что остаётся сравнимым.
const bare = (source) => blankLiterals(source).replace(/\s+/g, "");
// Слова того, что `blankLiterals` гасит: строк, шаблонов, выражений — и
// комментариев, если они есть.
function literals(source) {
  const blank = blankLiterals(source);
  const out = [];
  let run = "";
  for (let i = 0; i < source.length; i += 1) {
    if (blank[i] !== source[i] && !/\s/.test(source[i])) run += source[i];
    else if (run) {
      out.push(run);
      run = "";
    }
  }
  if (run) out.push(run);
  return out;
}

// Слова литералов итога идут в исходнике в том же порядке (между ними там ещё
// слова комментариев): испорченная строка или выражение в исходнике не найдётся.
function inOrder(small, big) {
  let at = 0;
  for (const word of small) {
    while (at < big.length && big[at] !== word) at += 1;
    if (at === big.length) return word;
    at += 1;
  }
  return null;
}

test("каждый модуль src/: без комментариев — тот же код, те же строки и выражения", () => {
  const all = files(SRC, ".js");
  assert.ok(all.length > 100, "модули не нашлись");
  for (const file of all) {
    const source = readFileSync(file, "utf8");
    const stripped = stripComments(source);
    const name = relative(ROOT, file);
    assert.equal(bare(stripped), bare(source), name + ": разбор комментариев задел код");
    assert.equal(inOrder(literals(stripped), literals(source)), null, name + ": строка или выражение испорчены");
    assert.equal(stripComments(stripped), stripped, name + ": разбор неустойчив");
    assert.ok(!/^[ \t]+\S/m.test(stripped.split("`").filter((part, at) => at % 2 === 0).join("")), name + ": остались отступы");
  }
});

test("разбор комментариев: выражения, строки и шаблоны с // и /* остаются, перевод строки в /* */ значим", () => {
  const cases = [
    ['const re = /\\/\\/x/g; // хвост', "const re = /\\/\\/x/g;\n"],
    ['const url = "http://a/*b*/"; /* c */ const n = 1;', 'const url = "http://a/*b*/"; const n = 1;\n'],
    ["const t = `a // ${b /* c */ + `d ${'/*'}`} //e`;", "const t = `a // ${b + `d ${'/*'}`} //e`;\n"],
    ["const half = a / b / c; // деление", "const half = a / b / c;\n"],
    ["if (x) return /[/]/.test(y);", "if (x) return /[/]/.test(y);\n"],
    ["function f() {\n  return /*\n*/ 1;\n}", "function f() {\nreturn\n1;\n}\n"],
    ["const a = 1;\n\n\n    // одна\n    const b = 2;   \n", "const a = 1;\nconst b = 2;\n"],
    ["x = y\n/re/.test(z)", "x = y\n/re/.test(z)\n"],
  ];
  for (const [source, wanted] of cases) assert.equal(stripComments(source), wanted, JSON.stringify(source));
  // ASI: `return` с переводом строки в комментарии — пустой `return`, как и в исходнике.
  const run = (code) => vm.runInNewContext("(function () {" + code + "})()");
  assert.equal(run(stripComments("return /*\n*/ 1;")), run("return /*\n*/ 1;"));
});

test("стили: комментарии и отступы уходят, строки в кавычках — как есть", () => {
  const css = '.a { /* x */\n    content: "/* не комментарий */";\n}\n\n/* блок\n*/\n.b{color:red}  \n';
  assert.equal(stripCssComments(css), '.a {\ncontent: "/* не комментарий */";\n}\n.b{color:red}\n');
  for (const file of files(SRC, ".css")) {
    const source = readFileSync(file, "utf8");
    const plain = (value) => value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
    assert.equal(plain(stripCssComments(source)), plain(source), relative(ROOT, file));
  }
});

test("словарь потока — выжимка: разделы WORKER_STRINGS тем же значением и та же text", () => {
  const scope = vm.runInNewContext(workerStringsSource() + ";({ strings, text })");
  assert.deepEqual(JSON.parse(JSON.stringify(scope.strings.sim)), JSON.parse(JSON.stringify(strings.sim)));
  assert.equal(scope.strings.rooms.none, strings.rooms.none);
  assert.equal(scope.text("sim.journal.workerError", { message: "x" }), text("sim.journal.workerError", { message: "x" }));
  assert.equal(scope.strings.errors, undefined, "в поток уехал весь словарь");
  assert.deepEqual(WORKER_STRINGS, ["sim", "rooms.none"]);
  // Модуль потока, читающий строку вне выжимки, роняет сборку.
  assert.throws(() => assertWorkerStrings([{ name: "src/sim/x.js", source: 'text("errors.codeTaken")' }]), /errors\.codeTaken/);
  assert.doesNotThrow(() => assertWorkerStrings([{ name: "src/sim/x.js", source: 'text("sim.journal." + code); strings.sim.units; text("rooms.none")' }]));
});

test("собранная страница и поток: без комментариев, разбираются, поток без второй копии словаря", async () => {
  const { html, worker } = await buildPage();
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new vm.Script(script));
  assert.ok(Buffer.byteLength(html) < 3.5 * 1024 * 1024, "страница снова тяжелее 3,5 МБ: " + Buffer.byteLength(html));
  assert.ok(!/^\s*\/\/ (?!src\/)/m.test(script), "в странице остался строчный комментарий");
  const { source } = await workerBundle();
  assert.equal(source, worker.source);
  assert.ok(Buffer.byteLength(source) < 450 * 1024, "поток снова везёт лишнее: " + Buffer.byteLength(source));
  assert.ok(!source.includes(strings.errors.codeTaken), "поток везёт словарь ошибок модели");
});
