// Памятка страницей на сайте (таск 236, G355): `web/guide.html` едет в `dist/`
// рядом с сервисом, и ссылка на неё — тот же адрес, с которого отдаётся сам
// сервис.
//
// Здесь проверяется две вещи, и обе — из тех, что молча ломаются.
//
// 1. **Офлайн.** У приложения правило «ни одного файла с чужого хоста» держит
//    `assertLocalLinks`; у памятки ссылки двух родов — то, что страница грузит,
//    и то, куда по ней уходят, — поэтому своя проверка `assertGuideOffline`.
//    Без неё обещание «работает офлайн» осталось бы обещанием: страница с
//    `fonts.googleapis.com` в сети выглядит как надо, а с диска — никак.
//
// 2. **Расхождение двух источников одного текста.** Памятка живёт и файлом
//    рядом с кодом (`AGENTS.md`), и страницей; это один рассказ. Машиной
//    сверяется то, что сверяется: список команд оснастки (его хозяин —
//    `tools/scheme.mjs`) и числа встроенных каталогов (их хозяева —
//    `openingCatalog.js` и `objectCatalog.js`). Остальное на совести того, кто
//    правит: тронул `AGENTS.md` — открой и страницу.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GUIDE_FILE, MANIFEST_FILE, PAGE_FILE, assertGuideOffline, assertLocalLinks, buildPage } from "../build.js";
import { openingCatalogKinds } from "../src/openingCatalog.js";
import { objectCatalogKeys } from "../src/objectCatalog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const guide = readFileSync(join(ROOT, "web", GUIDE_FILE), "utf8");
const memo = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
const tool = readFileSync(join(ROOT, "tools", "scheme.mjs"), "utf8");

// То, что сборка кладёт в `dist/`: по этому списку проверяются ссылки.
const DIST = [PAGE_FILE, MANIFEST_FILE, GUIDE_FILE, "icon.svg", "icon-maskable.svg", "sw.js", "assets/gost-type-a.ttf"];

// Список команд оснастки — у неё самой, а не второй копией здесь.
function commandsOf(name) {
  const found = tool.match(new RegExp("const " + name + " = \\[([^\\]]+)\\]"));
  assert.ok(found, "в tools/scheme.mjs нет списка " + name);
  return found[1].match(/"([^"]+)"/g).map((quoted) => quoted.slice(1, -1));
}

const commands = [...commandsOf("DATA_COMMANDS"), ...commandsOf("SHEET_COMMANDS")];

test("адрес памятки — guide.html рядом с сервисом", () => {
  // Это адрес, который заказчик рассылает людям: переименование уводит в
  // «страница не найдена» у всех, кому ссылку уже отправили.
  assert.equal(GUIDE_FILE, "guide.html");
});

test("сборка кладёт памятку в dist/ как есть", async () => {
  const { extras } = await buildPage();
  const found = extras.find(([name]) => name === GUIDE_FILE);
  assert.ok(found, "памятки нет среди файлов веб-версии: " + extras.map(([name]) => name).join(", "));
  assert.equal(found[1], guide, "в dist/ должен уехать исходник web/guide.html без правок по дороге");
});

test("у памятки есть голова страницы: тип, язык, кодировка, телефонная ширина", () => {
  // Без `charset` кириллица с диска читается наугад, без `viewport` телефон
  // показывает страницу в ширину монитора — и то, и другое видно только глазами.
  assert.match(guide, /^<!doctype html>/i);
  assert.match(guide, /<html lang="ru">/);
  assert.match(guide, /<meta charset="utf-8"/i);
  assert.match(guide, /<meta name="viewport"[^>]+width=device-width/i);
  assert.match(guide, /<title>[^<]+<\/title>/);
});

test("памятка не грузит ни одного файла с чужого хоста", () => {
  assert.doesNotThrow(() => assertGuideOffline(guide, DIST));
  // Шрифты системные нарочно: своего файла шрифта у памятки нет, а ссылка на
  // чужой хост — это страница, которая с диска выглядит иначе, чем в сети.
  assert.equal(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(guide), false);
  assert.equal(/<link[^>]+rel=["']?stylesheet/i.test(guide), false);
});

test("ссылка наружу памятке можно, а файл с чужого хоста — нет", () => {
  // Разница нарочная: по `<a href>` человек уходит сам, и недоступность той
  // стороны страницу не меняет. Загружаемый файл с чужого хоста — меняет.
  assert.doesNotThrow(() => assertGuideOffline('<a href="https://github.com/kto/to">код</a>', DIST));
  assert.throws(() => assertGuideOffline('<img src="https://example.org/logo.png" />', DIST), /внешн/i);
  assert.throws(
    () => assertGuideOffline('<link rel="preload" href="https://fonts.example/a.woff2" />', DIST),
    /внешн/i,
  );
  assert.throws(() => assertGuideOffline("<style>body{background:url(//cdn.example/bg.png)}</style>", DIST), /внешн/i);
  assert.throws(() => assertGuideOffline('<script src="https://cdn.example/a.js"></script>', DIST), /Код или стили/);
  // Опечатка в имени своего файла — та же поломка, что у приложения.
  assert.throws(() => assertGuideOffline('<link rel="icon" href="ikon.svg" />', DIST), /ikon\.svg/);
  assert.throws(() => assertGuideOffline('<img src="/icon.svg" />', DIST), /подпапк/);
  assert.throws(() => assertGuideOffline('<img src="../icon.svg" />', DIST), /выше папки/);
  // У страницы приложения правило строже: там и `<a href>` наружу — поломка.
  assert.throws(() => assertLocalLinks('<a href="https://github.com/kto/to">код</a>', DIST), /внешн/i);
});

test("памятка ведёт на сервис рядом, а не на адрес сайта", () => {
  // Весь смысл таска: памятка и сервис — один адрес. Полная ссылка на
  // `*.github.io` означала бы, что страницу опять унесли «куда-то на сторону»,
  // и она же сломалась бы при открытии с диска.
  assert.match(guide, /href="\.\/"/, "на сервис нужна относительная ссылка `./` — папка рядом");
  assert.equal(/href="https?:\/\/[^"]*github\.io/.test(guide), false);
  // Манифест установки памятке не положен: устанавливается приложением сервис.
  assert.equal(guide.includes(MANIFEST_FILE), false);
});

test("команды оснастки на странице те же, что знает сама оснастка", () => {
  for (const command of commands) {
    assert.ok(guide.includes(">" + command + "<"), "на странице памятки нет команды " + command);
    assert.ok(memo.includes("`" + command + "`"), "в AGENTS.md нет команды " + command);
  }
  // И наоборот: придуманной команды на странице быть не должно — список в
  // разметке лежит отдельными `<li>`, и он весь из оснастки.
  const listed = [...guide.matchAll(/<li>([^<]+)<\/li>/g)].map(([, text]) => text.trim());
  assert.deepEqual(listed.sort(), [...commands].sort());
});

test("числа каталогов на странице и в AGENTS.md — из самих каталогов", () => {
  const openings = openingCatalogKinds().length;
  const objects = objectCatalogKeys().length;
  for (const [name, text] of [["web/guide.html", guide], ["AGENTS.md", memo]]) {
    const kinds = text.match(/на (\d+) видов/);
    const things = text.match(/на (\d+) предметов/);
    assert.ok(kinds && things, "в " + name + " пропали числа каталогов — их сверять нечем");
    assert.equal(Number(kinds[1]), openings, name + ": видов проёмов в каталоге " + openings);
    assert.equal(Number(things[1]), objects, name + ": предметов в каталоге " + objects);
  }
});

test("главное правило заказчика названо в обоих видах памятки", () => {
  for (const [name, text] of [["web/guide.html", guide], ["AGENTS.md", memo]]) {
    assert.ok(text.includes("G68"), "в " + name + " пропало правило G68");
    assert.match(text, /не ломаются/, name + ": пропала сама формулировка правила");
  }
});
