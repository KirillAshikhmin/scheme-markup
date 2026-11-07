// Открытие по ссылке (таск 04 просмотра; G09, G12, G12.1, G12.2, G13, G16):
// сборка ссылки в «Разметке» и разбор адреса на странице просмотра, сквозь.
// Кодек — brotli из `node:zlib`, как в `viewLink.test.js`; окон и IndexedDB
// здесь нет — это живой прогон.
import test from "node:test";
import assert from "node:assert/strict";
import { brotliCompress, brotliDecompress, constants } from "node:zlib";
import { promisify } from "node:util";

import { exportLinkBuild, exportLinkLong } from "../src/panels/export.js";
import { viewStartLinkKey, viewStartLinkLoad, viewStartLinkOf } from "../src/panels/viewStart.js";
import { addLogicBinding, addScenario } from "../src/model.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { scenarioLibHash, scenarioLibIndexRead } from "../src/scenarioLib.js";
import { simHouse } from "./fixtures/simHome.js";

const squeeze = promisify(brotliCompress);
const loosen = promisify(brotliDecompress);
const compress = async (bytes) => new Uint8Array(await squeeze(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
const decompress = async (bytes) => new Uint8Array(await loosen(bytes));
const BASE = "https://example.test/scheme-markup/view.html";

function scriptedHouse() {
  const box = simHouse();
  const logic = addScenario(box.project, {
    kind: "logic",
    name: "Свет по движению",
    source: "info = { name: \"x\" };\nfunction trigger() {\n  return Device.get(508131500);\n}\n",
    origin: "js",
    fileName: "MotionLight.js",
  });
  const bound = addLogicBinding(logic.project, { scenarioId: logic.scenario.id, markId: box.marks["ДД1"], service: 0 });
  return { project: bound.project, box, scenarioId: logic.scenario.id };
}

async function linkFor(project, extra = {}) {
  return exportLinkBuild(project, { compress, base: BASE, ...extra });
}

test("ссылка собирается в адрес страницы просмотра, и длина — знаки адреса", async () => {
  const { project } = scriptedHouse();
  const built = await linkFor(project);
  assert.ok(built.url.startsWith(BASE + "#o="));
  assert.equal(built.chars, built.url.length - BASE.length - 3);
  assert.equal(viewStartLinkOf(built.url.slice(BASE.length)), built.url.slice(BASE.length + 3));
});

test("ссылка длиннее 4000 знаков честно названа длинной, короче — нет", () => {
  assert.equal(exportLinkLong(4000), false);
  assert.equal(exportLinkLong(4001), true);
});

test("сквозь: ссылка из «Разметки» открывается страницей просмотра, дом в ней работает", async () => {
  const { project, box, scenarioId } = scriptedHouse();
  const built = await linkFor(project);
  const opened = await viewStartLinkLoad(built.url.slice(BASE.length), { decompress });
  assert.equal(opened.status, "ok");
  assert.equal(opened.loaded.project.name, project.name);
  assert.equal(opened.loaded.project.marks.length, project.marks.length);
  // Сценарий доехал, привязка к метке цела: дом собирается и сценарий в нём есть.
  const spec = buildHomeSpec(opened.loaded.project);
  assert.ok(spec.accessories.length > 0, "аксессуары дома есть");
  const scenario = opened.loaded.project.scenarios.find((item) => item.name === "Свет по движению");
  assert.ok(scenario && scenario.source.includes("Device.get(508131500)"));
  assert.equal(opened.loaded.project.logicBindings.length, 1);
  assert.ok(scenarioId && box.marks["ДД1"]);
  assert.ok(Number.isFinite(new Date(opened.madeAt).getTime()), "дата выгрузки из нагрузки");
});

test("исходник из реестра библиотеки едет ссылкой, а не текстом", async () => {
  const base = scriptedHouse();
  // Настоящий скрипт библиотеки длинный: ссылка на него выигрывает у текста.
  const source = Array.from({ length: 120 }, (_, n) => "function step" + n + "(a, b) { return Device.get(" + (n * 7919) + ") + a * b; }").join("\n");
  const project = { ...base.project, scenarios: base.project.scenarios.map((item) => (item.id === base.scenarioId ? { ...item, source } : item)) };
  const stripped = source;
  const hash = scenarioLibHash(stripped);
  const index = scenarioLibIndexRead({
    version: 1,
    scripts: [{ name: "MotionLight", version: "1.0", kind: "logic", hash, size: stripped.length, file: "x@" + hash.slice(0, 16) + ".js" }],
  });
  const plain = await linkFor(project, { index: new Map() });
  const linked = await linkFor(project, { index });
  assert.equal(linked.stats.scenarios.linked, 1);
  assert.equal(plain.stats.scenarios.linked, 0);
  assert.ok(linked.chars < plain.chars);
});

test("пустой адрес и чужой адрес — ничего не открываем", async () => {
  assert.equal((await viewStartLinkLoad("", { decompress })).status, "none");
  assert.equal((await viewStartLinkLoad("#x=1", { decompress })).status, "none");
});

test("«#o=» без нагрузки говорит «в ссылке нет объекта»", async () => {
  assert.equal((await viewStartLinkLoad("#o=", { decompress })).status, "empty");
});

test("порченая и обрезанная ссылка — отказ, а не исключение", async () => {
  const { project } = scriptedHouse();
  const built = await linkFor(project);
  const payload = built.url.slice(BASE.length + 3);
  const cut = await viewStartLinkLoad("#o=" + payload.slice(0, payload.length >> 1), { decompress });
  assert.equal(cut.status, "broken");
  const junk = await viewStartLinkLoad("#o=1.%%%не-base64", { decompress });
  assert.equal(junk.status, "broken");
  const noCodec = await viewStartLinkLoad("#o=" + payload, { decompress: null });
  assert.equal(noCodec.status, "broken");
});

test("та же ссылка второй раз — «same», копии не будет; другая — открывается", async () => {
  const { project } = scriptedHouse();
  const built = await linkFor(project);
  const hash = built.url.slice(BASE.length);
  const first = await viewStartLinkLoad(hash, { decompress });
  assert.equal(first.status, "ok");
  assert.equal(first.key, viewStartLinkKey(viewStartLinkOf(hash)));
  const again = await viewStartLinkLoad(hash, { decompress, savedKey: first.key });
  assert.equal(again.status, "same");
  const other = await viewStartLinkLoad(hash, { decompress, savedKey: "чужой" });
  assert.equal(other.status, "ok");
  assert.notEqual(viewStartLinkKey("abc"), viewStartLinkKey("abd"));
});
