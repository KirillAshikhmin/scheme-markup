#!/usr/bin/env node
// Снасть «сломай правило»: доказать, что прогон **видит** порчу.
//
//   node tools/break-rules.mjs                 все правила набора
//   node tools/break-rules.mjs roomId doorId   названные
//   node tools/break-rules.mjs --list          набор и проверка, что правки ещё прикладываются
//   node tools/break-rules.mjs --all           на каждое правило — весь `npm test`
//
// ——— зачем это есть ——————————————————————————————————————————————————————
//
// Зелёный прогон не значит «правило цело» — он значит «никто не спросил».
// В таске 275 оказалось, что у трёх правил номеров спросить было нечем: убери
// из `ID_OWNERS` ссылку `mark.roomId`, выкинь переезд двери датчика открытия
// или второе условие гашения адреса — и 3418 тестов остаются зелёными. У
// заказчика это молча испорченный объект: открытие ставит номера 1…N со
// смыканием дыр, и ссылка начинает называть **живую чужую** сущность.
//
// Доказать обратное можно единственным способом — сломать правило и показать
// красный тест. Снасть делает это по набору `breakRules.mjs`: сорок девять
// правил, по одному за раз, и отвечает таблицей «правило → покраснело/молчит».
// Области набора: номера и перенумерация (`model.js`), дом (`sim/home.js`),
// слияние (`merge.js`) и обе трубы открытия (`deviceMigrate.js`,
// `projectFile.js`, `panels/projects.js`) — таск 281.
//
// **Когда её гонять:** правка в области номеров, слияния и миграций — то есть
// всё, что стоит на G68 («готовый объект не ломается»). В `npm test` снасть не
// входит нарочно: она дорогая — отдельный прогон на каждое правило.
//
// В `npm test` входит другое — **сверка данных набора** (`test/breakRules.test.js`,
// таск 278): каждый `was` ещё находится в своём файле ровно один раз, каждый
// названный тест ещё существует. Она стоит миллисекунды и правил не ломает, зато
// гниение набора (`model.js` переформатировали — кусок не находится) ловит
// обычный прогон, а не тот, кто вспомнил позвать снасть.
//
// ——— чего она не трогает ————————————————————————————————————————————————
//
// **Правки идут на копии, а не на `src/`.** Копия дерева (без `dist/`, `tmp/`
// и `.git/`) кладётся в системную папку временных файлов, правится и
// прогоняется там; рабочее дерево не правится ни одной командой этого файла,
// поэтому оборванный на середине прогон не может оставить его грязным. Копия
// убирается за собой, в том числе по Ctrl+C и по ошибке.
//
// **Зависимостей нет ни одной** (ADR 001): копия — `node:fs`, прогон — тот же
// `node --test`, которым идёт `npm test`.
//
// **В копию не идёт сверка набора** (`test/breakRules.test.js`): она краснеет на
// **любой** порче по построению — кусок `was` после правки в файле не находится.
// Ответа в ней нет ни на одно правило, а под `--all` она сделала бы «покраснело»
// у всех семнадцати и тем спрятала бы молчащее. Своё дерево она стережёт в
// `npm test`, здесь ей делать нечего.
//
// ——— что считается ответом ——————————————————————————————————————————————
//
// Сперва названные файлы прогоняются на **целой** копии: они обязаны быть
// зелёными. На красном дереве краснота ничего не доказывает, и снасть
// отказывается считать её ответом.
//
// Дальше на каждое правило: правка → прогон названных файлов (`--all` — весь
// `npm test`) → правка снимается. «Покраснело» — прогон упал; «молчит» —
// остался зелёным, и это ответ «правило сломано, а тест этого не заметил».
// Молчит хоть одно — код возврата ненулевой.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BREAK_RULES } from "./breakRules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUTSIDE = new Set([".git", "dist", "node_modules", "tmp"]);
// Сверка данных набора: в копии ей делать нечего (см. шапку) — она краснеет на
// любой порче по построению и под `--all` спрятала бы молчащее правило.
const SELF_CHECK = join("test", "breakRules.test.js");

const HELP = `Снасть «сломай правило»: ломает по одному правилу сборки и проверяет, что
на каждое краснеет названный тест. Правки идут на копии дерева, src/ не
трогается вовсе.

  node tools/break-rules.mjs [правило…] [ключи]

Ключи:
  --list        напечатать набор и проверить, что каждая правка ещё
                прикладывается к своему файлу ровно один раз (без прогона)
  --all         на каждое правило гонять весь npm test, а не названные файлы
                (дольше примерно в десять раз, зато отвечает «хоть кто-нибудь»)
  --help        это сообщение

Код возврата 1, если хоть одно правило молчит, не приложилось или названные
файлы были красными ещё до правки.

Набор правил — tools/breakRules.mjs. Завёл правило номеров, слияния или
миграции — заведи и запись там.`;

function fail(said) {
  process.stderr.write(said + "\n");
  process.exit(1);
}

function parseArgs(argv) {
  const keys = new Set();
  const names = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) keys.add(arg);
    else names.push(arg);
  }
  for (const key of keys) {
    if (!["--list", "--all", "--help"].includes(key)) fail("break-rules: ключа " + key + " нет. `--help` расскажет.");
  }
  const known = new Set(BREAK_RULES.map((item) => item.rule));
  for (const name of names) {
    if (!known.has(name)) fail("break-rules: правила «" + name + "» в наборе нет. `--list` покажет набор.");
  }
  return { keys, names };
}

/** Текст файла с приложенной правкой, или `null` — если кусок встретился не один раз. */
function broken(text, item) {
  const times = text.split(item.was).length - 1;
  if (times !== 1) return { text: null, times };
  return { text: text.replace(item.was, item.now), times };
}

// Копия дерева: то, из чего идёт прогон, кроме собранной страницы, объектов
// заказчика и самого git. Собранная страница прогону не нужна — тесты сборки
// собирают её сами из `src/`.
//
// Копия помнится в `WORK`, и убирает её не только `finally`, но и Ctrl+C:
// рабочее дерево оборванный прогон испортить не может (он его не правит), а
// забытая копия в папке временных файлов — мусор, который сам не уйдёт.
let WORK = null;

function dropWork() {
  if (WORK) rmSync(WORK, { recursive: true, force: true });
  WORK = null;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    dropWork();
    process.exit(130);
  });
}

function workCopy() {
  const dir = mkdtempSync(join(tmpdir(), "break-rules-"));
  WORK = dir;
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (from) => {
      const rel = relative(ROOT, from);
      if (rel === SELF_CHECK) return false;
      return rel === "" || !OUTSIDE.has(rel.split(sep)[0]);
    },
  });
  return dir;
}

function runTests(dir, files) {
  const done = spawnSync(process.execPath, ["--test", ...files], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (done.stdout || "") + (done.stderr || "");
  const red = out
    .split("\n")
    .filter((line) => line.startsWith("not ok "))
    .map((line) => line.replace(/^not ok [0-9]+ - /, "").trim());
  const fails = /^# fail ([0-9]+)$/m.exec(out);
  return { green: done.status === 0, red, fails: fails ? Number(fails[1]) : red.length, out };
}

function printList() {
  let bad = 0;
  const width = Math.max(...BREAK_RULES.map((item) => item.rule.length));
  for (const item of BREAK_RULES) {
    const { times } = broken(readFileSync(join(ROOT, item.file), "utf8"), item);
    const said = times === 1 ? "прикладывается" : "НЕ ПРИКЛАДЫВАЕТСЯ (нашлось " + times + ")";
    if (times !== 1) bad += 1;
    process.stdout.write(item.rule.padEnd(width) + " | " + item.file + " | " + item.tests.join(" ") + " | " + said + "\n");
    process.stdout.write(" ".repeat(width) + " | " + item.said + "\n");
  }
  process.stdout.write("\nправил в наборе: " + BREAK_RULES.length + (bad > 0 ? ", не прикладывается: " + bad : "") + "\n");
  return bad === 0;
}

function main() {
  const { keys, names } = parseArgs(process.argv.slice(2));
  if (keys.has("--help")) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  if (keys.has("--list")) return printList() ? 0 : 1;

  const chosen = names.length > 0 ? BREAK_RULES.filter((item) => names.includes(item.rule)) : BREAK_RULES;
  const whole = keys.has("--all");
  const suite = ["test/**/*.test.js"];
  const width = Math.max(...chosen.map((item) => item.rule.length));
  let silent = 0;
  let stuck = 0;
  try {
    const dir = workCopy();
    // Целая копия обязана быть зелёной: иначе краснота ничего не доказывает.
    const watch = whole ? suite : [...new Set(chosen.flatMap((item) => item.tests))].sort();
    process.stdout.write("целая копия: " + watch.join(" ") + "\n");
    const clean = runTests(dir, watch);
    if (!clean.green) {
      process.stderr.write("break-rules: названные файлы красные ещё до правки — сперва зелёный прогон.\n");
      for (const said of clean.red.slice(0, 5)) process.stderr.write("  " + said + "\n");
      return 1;
    }
    process.stdout.write("зелено, правил к прогону " + chosen.length + "\n\n");

    for (const item of chosen) {
      const path = join(dir, item.file);
      const keep = readFileSync(path, "utf8");
      const { text, times } = broken(keep, item);
      if (text === null) {
        stuck += 1;
        process.stdout.write(item.rule.padEnd(width) + " | НЕ ПРИЛОЖИЛОСЬ | кусок встретился " + times + " раз\n");
        continue;
      }
      writeFileSync(path, text);
      try {
        const run = runTests(dir, whole ? suite : item.tests);
        const said = run.green ? "МОЛЧИТ" : "покраснело";
        if (run.green) silent += 1;
        const why = run.green
          ? item.tests.join(" ") + " прошёл на сломанном правиле"
          : "красных " + run.fails + ": " + run.red.slice(0, 2).join("; ");
        process.stdout.write(item.rule.padEnd(width) + " | " + said.padEnd(10) + " | " + why + "\n");
      } finally {
        writeFileSync(path, keep);
      }
    }
  } finally {
    dropWork();
  }

  process.stdout.write("\nправил " + chosen.length + ", молчит " + silent + (stuck > 0 ? ", не приложилось " + stuck : "") + "\n");
  if (silent > 0) {
    process.stdout.write("Молчащее правило — это дыра: порча в этом месте пройдёт мимо прогона.\n");
  }
  return silent > 0 || stuck > 0 ? 1 : 0;
}

process.exitCode = main();
