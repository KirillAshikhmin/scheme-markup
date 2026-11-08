// Вторая страница сервиса — «Просмотр объекта» (таск 01 просмотра).
//
// Здесь проверяется то, что нельзя увидеть глазами за один раз и что ломается
// молча: род страницы и права, своё пространство хранилища, состав выкладки
// (вторая страница, её манифест, файлы кодека) и единственность двери прав.
//
// Чего здесь нет нарочно: вида страницы, жестов, IndexedDB и установки на
// домашний экран — это живой прогон (правила в `AGENTS.md`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

import {
  MANIFEST_FILE,
  PAGE_FILE,
  VENDOR_CACHED,
  VIEW_MANIFEST_FILE,
  VIEW_PAGE_FILE,
  WORKER_FILE,
  assertLocalLinks,
  buildPage,
  manifestJson,
  viewManifestJson,
} from "../build.js";
import { APP_KINDS, LAYOUT_ABILITIES, VIEW_ABILITIES, appAllows } from "../src/app.js";
import { canvasHintText, canvasRefusalText } from "../src/canvas.js";
import { addScheme, createProject, setSchemeFloor } from "../src/model.js";
import { schemesRowMeta } from "../src/panels/schemes.js";
import { volumeFloorAction, volumeNotes } from "../src/panels/volume.js";
import { volumeFloorsNote, volumeParamsSunLine } from "../src/panels/volumeParams.js";
import { STORE_DB_NAME, storeDatabaseName, storeNamespace, storeUse } from "../src/store.js";
import { strings, text } from "../src/strings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const viewTemplate = readFileSync(join(ROOT, "src", "view.html"), "utf8");

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

// Разметка второй страницы: по ней видно, какие панели на ней вообще поднимутся
// (`mountPanel` молча пропускает отсутствующий узел).
function markupIds(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id));
}

// ——— род страницы и хранилище ——————————————————————————————————————————

test("просмотр живёт в своей базе браузера: объект из просмотра не попадёт в список «Разметки»", () => {
  assert.equal(storeNamespace("edit"), STORE_DB_NAME);
  assert.equal(storeNamespace("view"), STORE_DB_NAME + "-view");
  assert.notEqual(storeNamespace("view"), storeNamespace("edit"));
  // Чужое слово — «Разметка»: опечатка не должна уводить объекты в безымянную базу.
  assert.equal(storeNamespace("чужое"), STORE_DB_NAME);
  assert.equal(storeNamespace(undefined), STORE_DB_NAME);
  // Выбор пространства один раз при старте; имя базы после выбора — своё.
  assert.equal(storeDatabaseName(), STORE_DB_NAME);
  assert.equal(storeUse("view"), storeNamespace("view"));
  assert.equal(storeDatabaseName(), storeNamespace("view"));
  assert.equal(storeUse("edit"), STORE_DB_NAME);
  assert.equal(storeDatabaseName(), STORE_DB_NAME);
});

test("дверь прав одна: в `src/` прямых вызовов раскладки больше нет", () => {
  const guilty = [];
  for (const file of sourceFiles(join(ROOT, "src"))) {
    // Хозяин обеих функций — каркас: там они объявлены и там же их зовёт
    // `appAllows`.
    if (file === join(ROOT, "src", "app.js")) continue;
    const source = readFileSync(file, "utf8");
    if (/\blayoutAllows(State)?\s*\(/.test(source)) guilty.push(file.slice(ROOT.length + 1));
  }
  assert.deepEqual(guilty, [], "эти файлы спрашивают раскладку мимо `appAllows`");
});

test("девять умений, которые раньше никто не спрашивал, теперь спрашивают", () => {
  // Пока их не спрашивал никто, они были украшением таблицы: список объектов,
  // таблицы, выгрузки и справочник прятать было нечем.
  const forgotten = [
    "switchProject",
    "switchScheme",
    "markList",
    "filters",
    "tables",
    "exportFiles",
    "openFile",
    "editRooms",
    "dictionary",
  ];
  const sources = sourceFiles(join(ROOT, "src"))
    .filter((file) => file !== join(ROOT, "src", "app.js"))
    .map((file) => readFileSync(file, "utf8"));
  for (const ability of forgotten) {
    const asked = sources.some((source) => new RegExp('appAllows\\(\\s*"' + ability + '"').test(source));
    assert.ok(asked, ability + ": умение по-прежнему никто не спрашивает");
  }
});

test("в просмотре нечем править: белый список и ничего кроме", () => {
  // Таблица «умение × род страницы»: в роде `view` доступно ровно то, что
  // перечислено, и перечисленное — только просмотр.
  for (const ability of Object.keys(LAYOUT_ABILITIES)) {
    const allowed = VIEW_ABILITIES.includes(ability);
    assert.equal(
      appAllows(ability, { app: "view", layout: "desktop" }),
      allowed,
      ability + ": род `view` на широком экране",
    );
  }
  for (const ability of ["editMarks", "editDrawing", "editSchemes", "editRooms", "editProject", "undo", "saveFile", "dictionary", "tables", "exportFiles", "filters", "warnings", "switchProject", "viewSizes", "editScenarios", "toggleScenarios", "viewScenarios"]) {
    assert.ok(!VIEW_ABILITIES.includes(ability), ability + " не должно быть в белом списке просмотра");
  }
  for (const ability of VIEW_ABILITIES) {
    assert.ok(ability in LAYOUT_ABILITIES, ability + ": умения нет в таблице раскладок");
  }
  assert.deepEqual([...APP_KINDS], ["edit", "view"]);
});

// ——— слова и кнопки инженера (ревью ветки, F1) ——————————————————————————

test("слова о правке гасит умение, а не правка текстов по одному", () => {
  // Умение есть в обеих раскладках «Разметки» (инженер читает их и с телефона,
  // стоя на объекте) и нет в белом списке просмотра.
  assert.deepEqual([...LAYOUT_ABILITIES.editHints], ["desktop", "mobile"]);
  assert.ok(!VIEW_ABILITIES.includes("editHints"));
  assert.equal(appAllows("editHints", { app: "edit", layout: "mobile" }), true);
  assert.equal(appAllows("editHints", { app: "view", layout: "desktop" }), false);

  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const state = (app) => ({ project: made.project, schemeId: made.scheme.id, mode: "select", layout: "mobile", app });
  // Плашка над планом: «Остановите дом, чтобы править» и «Правка на
  // компьютере» — обе к инженеру.
  assert.equal(canvasHintText(state("edit")), strings.mobile.viewOnly);
  assert.equal(canvasHintText(state("view")), null);
  assert.equal(canvasHintText({ ...state("view"), simRunning: true, screen: "scheme" }), null);

  // Строка схемы: по ссылке подложки нет нарочно (G17).
  assert.equal(schemesRowMeta(made.project, made.scheme.id), strings.schemes.noImage);
  assert.equal(schemesRowMeta(made.project, made.scheme.id, { hints: false }), "");
  const floored = setSchemeFloor(made.project, made.scheme.id, 2).project;
  const meta = schemesRowMeta(floored, made.scheme.id, { hints: false });
  assert.ok(!meta.includes(strings.schemes.noImage), "«План не загружен» у заказчика: " + meta);
  assert.ok(meta.includes("2") && !/·\s*$/.test(meta), "этаж остался, хвостового разделителя нет: " + meta);

  // Правая плашка «Объёма» и список этажей.
  const notes = { notes: ["noRooms", "noHeight", "noBridge"], heightMm: 2700 };
  assert.equal(volumeNotes(notes).length, 3);
  assert.deepEqual(volumeNotes(notes, { hints: false }), []);
  const stair = { objectId: "o1", key: "stairs" };
  assert.ok(volumeFloorAction(stair, [], null).hint.length > 0);
  assert.equal(volumeFloorAction(stair, [], null, { hints: false }).hint, "");
  const plan = { can: false, why: "one", floors: [], doubles: [] };
  assert.ok(volumeFloorsNote(plan, false).length > 0);
  assert.equal(volumeFloorsNote(plan, false, { hints: false }), "");
  for (const why of ["one", "noFloor", "none"]) {
    assert.equal(volumeFloorsNote({ ...plan, why }, false, { hints: false }), "", why);
  }
});

test("ни отказ на клавишу правки, ни зов за координатами до заказчика не доходят", () => {
  // Отказы на Ctrl+Z, Ctrl+V, Delete и жесты правки говорили «Режим просмотра
  // — правка на компьютере» уведомлением: правки на этой странице нет вовсе, и
  // обещать её на другом устройстве нечем. Слова отказа решает одна чистая
  // дверь, `canvasRefusalText`; `null` — промолчать.
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const state = (app) => ({ project: made.project, schemeId: made.scheme.id, mode: "select", layout: "mobile", app });
  assert.equal(canvasRefusalText(state("edit")), strings.mobile.viewOnly, "в «Разметке» отказ по-прежнему вслух");
  assert.equal(
    canvasRefusalText({ ...state("edit"), simRunning: true, screen: "scheme" }),
    strings.sim.bar.editLocked,
    "у запущенного дома слова свои",
  );
  assert.equal(canvasRefusalText(state("view")), null, "на странице просмотра отказ молчит");
  assert.equal(canvasRefusalText({ ...state("view"), simRunning: true, screen: "scheme" }), null);

  // Рассвет и закат: умолчание названо, а зова за координатами нет — свойств
  // объекта в просмотре не бывает.
  const times = { riseMin: 540, setMin: 1260, bySite: false };
  assert.ok(volumeParamsSunLine(times).includes("координат"), volumeParamsSunLine(times));
  const bare = volumeParamsSunLine(times, { hints: false });
  assert.ok(!bare.includes("координат"), bare);
  assert.ok(bare.includes("09:00") && bare.includes("21:00") && bare.includes("умолчание"), bare);
  // Координаты объекта заданы — это про его объект, и говорится оно обоим.
  const own = { riseMin: 300, setMin: 1300, bySite: true };
  assert.equal(volumeParamsSunLine(own, { hints: false }), volumeParamsSunLine(own));
});

test("умение `editHints` спрашивают там, где стояли слова инженера", () => {
  // Девять мест ревью: подсказка плана, список схем и его строка, список
  // меток, правая плашка «Объёма» и список этажей. «Снимок» гасит `exportFiles`
  // (выгрузок в просмотре нет вовсе), «Выполнить команду» и часы — одна дверь
  // полосы дома (`simBarControls`).
  const asks = (file, ability) =>
    new RegExp('appAllows\\(\\s*"' + ability + '"').test(readFileSync(join(ROOT, file), "utf8"));
  for (const file of ["src/canvas.js", "src/panels/schemes.js", "src/panels/marks.js", "src/panels/volume.js"]) {
    assert.ok(asks(file, "editHints"), file + ": слова о правке не спрашивают умения");
  }
  assert.ok(asks("src/panels/volume.js", "exportFiles"), "«Снимок» не гасится умением выгрузок");
});

// ——— разметка второй страницы ——————————————————————————————————————————

test("на второй странице нет точек монтирования правки", () => {
  const ids = markupIds(viewTemplate);
  // Эти панели не поднимутся вовсе: узла нет — `mountPanel` проходит мимо.
  for (const id of [
    "screen-drawing",
    "screen-scenarios",
    "header-actions",
    "header-history",
    "header-warnings",
    "header-sizes",
    "header-measure",
    "project-actions",
    "panel-properties",
    "panel-rooms",
    "panel-tools",
    "panel-draw-tools",
    "panel-draw-walls",
    "panel-draw-openings",
    "panel-draw-objects",
    "panel-sizes",
    "layout-toggle",
  ]) {
    assert.equal(ids.has(id), false, id + ": точка монтирования правки на странице просмотра");
  }
  // А эти обязаны быть: без них просмотра не выйдет.
  for (const id of [
    "app",
    "app-header",
    "canvas-host",
    "canvas-overlay",
    "canvas-modes",
    "canvas-card",
    "screen-volume",
    "panel-volume-tools",
    "panel-schemes",
    "panel-marks",
    "header-search",
    // Переключатель связей (таск 07 просмотра, G30): связи ничего не правят, и
    // кнопка стоит здесь на всех трёх раскладках — право даёт род страницы
    // (`VIEW_GRANTS`), подробности в `test/viewPageDefaults.test.js`.
    "header-links",
    "sim-bar",
    "sim-journal",
    "view-start",
    "dialog-host",
    "notifications",
  ]) {
    assert.ok(ids.has(id), id + ": без этого узла панель просмотра не поднимется");
  }
  assert.match(viewTemplate, /<div id="app" data-app="view">/);
  assert.match(viewTemplate, new RegExp('href="' + VIEW_MANIFEST_FILE + '"'));
  // Три раскладки: нижний ряд кнопок узкого экрана и ручки колонок — те же.
  assert.match(viewTemplate, /data-sheet-button="schemes"/);
  assert.match(viewTemplate, /data-sheet-button="marks"/);
  assert.match(viewTemplate, /data-panel-toggle="left"/);
});

test("строки второй страницы — в словаре, а не в разметке", () => {
  const keys = [...viewTemplate.matchAll(/data-(?:text|title)="([^"]+)"/g)].map(([, key]) => key);
  assert.ok(keys.length >= 4, "в разметке просмотра нет ключей словаря");
  for (const key of keys) assert.notEqual(text(key), key, "нет строки " + key);
  // Разделы, которые читают следующие таски: заводятся один раз здесь.
  for (const key of ["title", "empty", "open", "preview", "forget", "openOther", "linkBroken"]) {
    assert.equal(typeof strings.view[key], "string", "strings.view." + key);
  }
  for (const key of ["link", "linkDialog", "linkLength", "linkCopy", "linkOpen", "linkLong"]) {
    assert.equal(typeof strings.exportPanel[key], "string", "strings.exportPanel." + key);
  }
  for (const key of ["missing", "newer", "update"]) {
    assert.equal(typeof strings.scenarioLib[key], "string", "strings.scenarioLib." + key);
  }
  assert.equal(typeof strings.sim.journal.scenarioLibMissing, "string");
});

// ——— сборка: две страницы, два манифеста, кодек рядом ————————————————————

test("сборка кладёт рядом вторую страницу собранной, её манифест и файлы кодека", async () => {
  const { html, view, extras, assets, vendor } = await buildPage();
  const written = [
    PAGE_FILE,
    ...extras.map(([name]) => name),
    ...assets.map((asset) => asset.name),
    ...vendor.map((file) => file.name),
  ];
  assert.ok(written.includes(VIEW_PAGE_FILE), "второй страницы нет в выкладке");
  assert.ok(written.includes(VIEW_MANIFEST_FILE), "манифеста второй страницы нет в выкладке");
  for (const name of VENDOR_CACHED) assert.ok(written.includes(name), name + ": файла кодека нет в выкладке");

  // Та же сборка, что у главной: код и стили внутри страницы, ссылки свои,
  // управляющих символов нет.
  assert.ok(view.includes("<style>"), "стили не попали внутрь второй страницы");
  assert.equal(/<script[^>]+src=/i.test(view), false);
  assert.equal(/<link[^>]+rel=["']?stylesheet/i.test(view), false);
  assert.equal(/@import\s/i.test(view), false);
  assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(view), false);
  assert.doesNotThrow(() => assertLocalLinks(view, written, VIEW_MANIFEST_FILE));
  // Бандл один на две страницы: поток имитации в ней тот же.
  assert.ok(view.includes('SIM_WORKER_SOURCE = "(function () {'), "в странице просмотра нет бандла потока");
  assert.ok(view.length > 1000000, "страница просмотра собрана без кода");
  // Главная от этого не изменилась: её манифест на месте.
  assert.doesNotThrow(() => assertLocalLinks(html, written));
});

test("распаковщик кодека попадает в кэш установки, кодировщик — нет", async () => {
  const { extras } = await buildPage();
  const worker = extras.find(([name]) => name === WORKER_FILE)[1];
  const assets = JSON.parse(worker.match(/const ASSETS = (\[[^\]]*\]);/)[1]);
  for (const name of VENDOR_CACHED) {
    assert.ok(assets.includes("./" + name), name + ": распаковщик не попал в офлайн-кэш");
  }
  // Кодировщик нужен только «Разметке» и только по нажатию: мегабайт в кэш
  // установки заказчику не кладётся.
  assert.ok(
    assets.every((name) => !name.includes("brotli_wasm")),
    "кодировщик уехал в кэш установки: " + assets.join(", "),
  );
  assert.doesNotMatch(worker, /__[A-Z_]+__/);
});

test("у второй страницы свой манифест: своё имя, свой запуск, те же значки", () => {
  const view = JSON.parse(viewManifestJson());
  const main = JSON.parse(manifestJson());
  assert.equal(view.name, strings.view.title);
  assert.notEqual(view.name, main.name, "значок с домашнего экрана ведёт в просмотр, а не в «Разметку»");
  assert.equal(view.start_url, "./" + VIEW_PAGE_FILE);
  assert.equal(view.display, "standalone");
  assert.equal(view.scope, ".", "область та же папка: соседние адреса приложения из неё не выпадают");
  assert.deepEqual(view.icons, main.icons, "значки у страниц одни");
  assert.equal(view.short_name, strings.view.installShortName);
  assert.equal("orientation" in view, false);
  assert.notEqual(MANIFEST_FILE, VIEW_MANIFEST_FILE);
});

// ——— копия кодека: её целость и согласие с zlib ————————————————————————

test("копия brotli лежит рядом со страницей, а не в бандле", () => {
  const sources = sourceFiles(join(ROOT, "src"));
  const guilty = sources.filter((file) => /from\s+["'][^"']*vendor\//.test(readFileSync(file, "utf8")));
  assert.deepEqual(
    guilty.map((file) => file.slice(ROOT.length + 1)),
    [],
    "статический импорт втянул бы кодек в бандл: подгрузка только динамическим import()",
  );
  const codec = readFileSync(join(ROOT, "src", "brotliCodec.js"), "utf8");
  assert.match(codec, /import\(/, "подгрузка обязана быть динамической");
  // Страница зовёт по имени только склейку: адрес самого wasm считает сам
  // кодек от себя (`import.meta.url`), поэтому оба файла обязаны лежать в
  // одной папке и оба — в офлайн-кэше.
  const [glue, wasm] = VENDOR_CACHED;
  assert.ok(codec.includes('"./' + glue + '"'), glue + ": кодек грузит не тот файл");
  assert.equal(glue.split("/").slice(0, -1).join("/"), wasm.split("/").slice(0, -1).join("/"));
  assert.equal(VENDOR_CACHED.length, 2);
  // Лицензия едет рядом с копией: правило «ни одной зависимости» снято только
  // для brotli и только под запись (G18).
  for (const dir of ["brotli-dec-wasm", "brotli-wasm"]) {
    const license = readFileSync(join(ROOT, "web", "vendor", dir, "LICENSE-Apache.txt"), "utf8");
    assert.match(license, /Apache License/);
  }
  const decoder = readFileSync(join(ROOT, "web", "vendor", "brotli-dec-wasm", "brotli_dec_wasm_bg.wasm"));
  assert.deepEqual([...decoder.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], "это должен быть wasm");
});

test("распаковщик из копии читает то, что пишет brotli самого Node", async () => {
  // Шов, на котором стоит вся затея со ссылкой: в странице сжимает и
  // распаковывает **копия** кодека, а в тестах формата ссылки — `zlib` самого
  // Node (кодек там приходит аргументом). Разойдись они — ссылка, собранная
  // «Разметкой», не открылась бы у заказчика, и поймать это было бы нечем.
  //
  // Заодно это единственная проверка целости копии: испорченный файл wasm
  // здесь не поднимется.
  const dir = join(ROOT, "web", "vendor", "brotli-dec-wasm");
  const module = await import(pathToFileURL(join(dir, "brotli_dec_wasm.js")).href);
  module.initSync({ module: readFileSync(join(dir, "brotli_dec_wasm_bg.wasm")) });
  const text = JSON.stringify({ объект: "Разметка схем", метки: [1, 2, 3] });
  const packed = brotliCompressSync(Buffer.from(text, "utf8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const back = Buffer.from(module.decompress(new Uint8Array(packed))).toString("utf8");
  assert.equal(back, text);
});
