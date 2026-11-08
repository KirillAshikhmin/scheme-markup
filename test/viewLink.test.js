// Формат ссылки на объект: упаковка, чтение и то, что в ссылку не едет
// (таск 03 страницы просмотра; G10, G11, G11.1, G14, G15, G18).
//
// Кодек модулю приходит аргументом, поэтому здесь на его место встаёт brotli из
// `node:zlib` — тот же алгоритм, что в странице, без wasm и без браузера.
// Нагрузку тест разбирает **сам** (`Buffer.from(…, "base64url")` +
// `brotliDecompressSync`), а не через модуль: формат проверяется снаружи, иначе
// проверка подтверждала бы сама себя.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brotliCompress, brotliCompressSync, brotliDecompress, brotliDecompressSync, constants } from "node:zlib";
import { promisify } from "node:util";

import {
  VIEW_LINK_BROKEN,
  VIEW_LINK_DROPPED,
  VIEW_LINK_PARAM,
  VIEW_LINK_VERSION,
  viewLinkPack,
  viewLinkRead,
  viewLinkStrip,
} from "../src/viewLink.js";
import { addLogicBinding, addScenario, findGroup, markControlLinks, planFractionToMm, updateMark } from "../src/model.js";
import { buildHomeSpec, deviceAids } from "../src/sim/home.js";
import { simHouse } from "./fixtures/simHome.js";

const squeeze = promisify(brotliCompress);
const loosen = promisify(brotliDecompress);
// Одиннадцатый — предел brotli, та же цифра, что в `brotliCodec.js`.
const compress = async (bytes) => new Uint8Array(await squeeze(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
const decompress = async (bytes) => new Uint8Array(await loosen(bytes));
const codec = { compress, decompress };

// Отпечаток библиотечного скрипта — SHA-256 текста целиком, 64 знака в нижнем
// регистре: короче его `model.scenarioLibOf` ссылкой не считает, и такая
// запись обязана остаться со своим текстом (ревью ветки, F1).
const LIB_HASH = "1f".repeat(32);
const LIB_HASH_BAD = "h1";

const LEGACY = [
  "legacy-project.json",
  "legacy-drawing-project.json",
  "legacy-height-project.json",
  "legacy-openings-project.json",
  "legacy-sizes-project.json",
  "legacy-views-project.json",
  "retired-objects-project.json",
];

function legacyProject(name) {
  return JSON.parse(readFileSync(new URL("./" + name, import.meta.url), "utf8"));
}

/** Нагрузка ссылки, прочитанная мимо модуля: версия, дата и объект. */
function payloadOf(linkText) {
  const dot = linkText.indexOf(".");
  const head = linkText.slice(0, dot);
  const bytes = Buffer.from(linkText.slice(dot + 1), "base64url");
  return { head, payload: JSON.parse(brotliDecompressSync(bytes).toString("utf8")) };
}

/** Объект со сценариями и привязкой: в нём есть и адреса, и исходники. */
function scriptedHouse() {
  const box = simHouse();
  const logic = addScenario(box.project, {
    kind: "logic",
    name: "Свет по движению",
    // Адрес хаба записан рукой — ровно тот случай, из-за которого в нагрузке
    // прежде ехала таблица адресов (таск 04 связи меток и вещей: адрес стал
    // номером метки, и таблице нечего доказывать).
    source: "// шапка\ninfo = { name: \"x\" };\nfunction trigger() {\n  return Device.get(508131500);\n}\n",
    origin: "js",
    fileName: "MotionLight.js",
  });
  const global = addScenario(logic.project, {
    kind: "global",
    name: "Общие имена",
    source: "/* общий */\nconst Shared = { on: true };\n",
    origin: "js",
    fileName: "Shared.js",
  });
  const bound = addLogicBinding(global.project, {
    scenarioId: logic.scenario.id,
    markId: box.marks["ДД1"],
    service: 0,
    options: { delay: 60 },
  });
  return { project: bound.project, box, logicId: logic.scenario.id, globalId: global.scenario.id };
}

test("круговой прогон: прочитанный объект равен очищенному поле в поле", async () => {
  for (const name of LEGACY) {
    const project = legacyProject(name);
    const packed = await viewLinkPack(project, { ...codec, madeAt: "2026-11-08T10:00:00.000Z" });
    const read = await viewLinkRead(packed.text, codec);
    assert.deepStrictEqual(read.project, viewLinkStrip(project), name);
    assert.equal(read.madeAt, "2026-11-08T10:00:00.000Z", name);
    assert.equal(read.version, VIEW_LINK_VERSION, name);
    assert.deepStrictEqual(read.warnings, [], name);
  }
});

test("пустые коллекции объекта возвращаются пустыми, а не пропадают", async () => {
  // Объект из файла всегда несёт эти коллекции (`projectFile.migrateProject`
  // их дописывает), и читатели модели ходят в них без оглядки: `rooms.map` в
  // фильтрах, `groups.find` в сцене «Объёма». Выброси их из ссылки — и объект
  // без групп или без помещений перестаёт открываться вовсе.
  const project = {
    ...legacyProject("legacy-project.json"),
    rooms: [],
    outlines: [],
    groups: [],
    counters: {},
  };
  const read = await viewLinkRead((await viewLinkPack(project, codec)).text, codec);
  for (const key of ["categories", "markTypes", "schemes", "marks", "rooms", "outlines", "groups"]) {
    assert.ok(Array.isArray(read.project[key]), key + ": массив, а не «нет поля»");
  }
  assert.ok(read.project.counters && typeof read.project.counters === "object", "counters: объект");
  // Те самые два читателя, на которых падала живая страница.
  assert.deepStrictEqual(read.project.rooms.map((room) => room.id), []);
  assert.equal(findGroup(read.project, "нет такой группы"), null);
  // Круговой прогон сверяется с `viewLinkStrip` — ответ у них один.
  assert.deepStrictEqual(read.project, viewLinkStrip(project));
});

test("круговой прогон на объекте со сценариями и привязками", async () => {
  const { project } = scriptedHouse();
  const packed = await viewLinkPack(project, codec);
  const read = await viewLinkRead(packed.text, codec);
  assert.deepStrictEqual(read.project, viewLinkStrip(project));
});

test("идентификаторы возвращаются своими, а таблиц прежних номеров в нагрузке нет", async () => {
  const project = legacyProject("legacy-openings-project.json");
  const markId = project.marks[0].id;
  const packed = await viewLinkPack(project, codec);
  const { payload } = payloadOf(packed.text);
  // Нагрузка — это версия, дата и объект, и больше ничего: id в объекте —
  // номера, переписывать их короткими и вести таблицу оригиналов (`ids`,
  // `mark`) или таблицу адресов хаба (`aids`) незачем.
  assert.deepStrictEqual(Object.keys(payload).sort(), ["at", "p", "v"]);
  assert.equal(JSON.stringify(payload.p).includes(markId), true, "id уехал из объекта нагрузки");
  const read = await viewLinkRead(packed.text, codec);
  assert.equal(read.project.marks[0].id, markId);
  assert.deepStrictEqual(
    read.project.marks.map((mark) => mark.id),
    project.marks.map((mark) => mark.id),
  );
  // Ссылки между сущностями тоже целы: метка знает свою схему и свой тип.
  assert.equal(read.project.marks[0].schemeId, project.marks[0].schemeId);
  assert.equal(read.project.marks[0].typeId, project.marks[0].typeId);
  assert.equal(read.project.openings[0].wallId, project.openings[0].wallId);
});

test("значение, похожее на идентификатор, остаётся значением", async () => {
  // Подстановки по таблице больше нет вовсе, и место установки, записанное
  // номером соседней сущности или знаком прежнего короткого id, уезжает и
  // возвращается словом в тексте.
  const project = legacyProject("legacy-openings-project.json");
  const first = project.marks[0].id;
  project.marks[0] = { ...project.marks[0], location: "~1", original: String(project.marks[1].id) };
  const packed = await viewLinkPack(project, codec);
  const read = await viewLinkRead(packed.text, codec);
  assert.equal(read.project.marks[0].location, "~1");
  assert.equal(read.project.marks[0].original, String(project.marks[1].id));
  assert.equal(read.project.marks[0].id, first);
});

test("адреса хаба после прогона те же", async () => {
  const { project } = scriptedHouse();
  const packed = await viewLinkPack(project, codec);
  const read = await viewLinkRead(packed.text, codec);
  assert.deepStrictEqual([...deviceAids(read.project)], [...deviceAids(project)]);
  assert.deepStrictEqual(read.warnings, []);
  // Доказывать это таблицей больше нечем и незачем: адрес — номер метки, и
  // пока номер в нагрузке тот же, адрес переехать не может.
  const { payload } = payloadOf(packed.text);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "aids"), false);
  // Дом собирается из прочитанного объекта теми же адресами и теми же
  // сервисами: проверка не про таблицу, а про то, что сценарий нашёл устройство.
  const was = buildHomeSpec(project);
  const now = buildHomeSpec(read.project);
  assert.deepStrictEqual(
    now.accessories.map((item) => [item.aid, item.markId]),
    was.accessories.map((item) => [item.aid, item.markId]),
  );
  assert.deepStrictEqual(now.links, was.links);
  assert.deepStrictEqual(
    now.logicBindings.map((item) => [item.markId, item.service, item.options]),
    was.logicBindings.map((item) => [item.markId, item.service, item.options]),
  );
});

test("в ссылку не едут приёмка, оборудование и фотоподложка", async () => {
  const project = legacyProject("legacy-openings-project.json");
  assert.ok(project.accepted.length > 0 && project.equipmentTypes.length > 0, "фикстура должна их нести");
  project.schemes = project.schemes.map((scheme) => ({ ...scheme, imageId: "img-1" }));
  const read = await viewLinkRead((await viewLinkPack(project, codec)).text, codec);
  for (const key of VIEW_LINK_DROPPED) {
    assert.equal(Object.prototype.hasOwnProperty.call(read.project, key), false, key);
  }
  assert.deepStrictEqual(VIEW_LINK_DROPPED, ["accepted", "equipmentTypes", "equipment", "placements"]);
  for (const scheme of read.project.schemes) {
    assert.equal(Object.prototype.hasOwnProperty.call(scheme, "imageId"), false);
    // Размеры схемы остаются: без подложки по ним ложатся чертёж и метки.
    assert.equal(scheme.width, project.schemes[0].width);
  }
});

test("ни одна метка, стена, проём, помещение и тип не потеряны и не изменены", async () => {
  const project = legacyProject("legacy-openings-project.json");
  const read = await viewLinkRead((await viewLinkPack(project, codec)).text, codec);
  for (const key of ["categories", "markTypes", "rooms", "schemes", "marks", "groups", "outlines", "walls", "openings"]) {
    const was = Array.isArray(project[key]) ? project[key] : [];
    const now = Array.isArray(read.project[key]) ? read.project[key] : [];
    assert.equal(now.length, was.length, key + ": счёт");
    assert.deepStrictEqual(
      now.map((item) => item.id),
      was.map((item) => item.id),
      key + ": идентификаторы",
    );
  }
  // Содержимое: у метки целы точки, связи, высота и место установки.
  const wasMark = project.marks[0];
  const nowMark = read.project.marks[0];
  assert.deepStrictEqual(nowMark.points, wasMark.points);
  // Связи читаются дверью модели: пустой список — это «нет поля», и так его
  // пишет сама модель.
  assert.deepStrictEqual(markControlLinks(nowMark), markControlLinks(wasMark));
  assert.equal(nowMark.number, wasMark.number);
  assert.equal(nowMark.kind, wasMark.kind);
  // Стена и проём — в миллиметрах, и миллиметры целые.
  assert.deepStrictEqual(read.project.walls[0], project.walls[0]);
  assert.deepStrictEqual(read.project.openings[0], project.openings[0]);
});

test("пустое поле убирается, и читатели модели отвечают так же", async () => {
  const { project } = scriptedHouse();
  const markId = project.marks[0].id;
  const withEmpty = updateMark(project, markId, { location: "" }).project;
  const packed = await viewLinkPack(withEmpty, codec);
  const { payload } = payloadOf(packed.text);
  const packedMark = payload.p.marks[0];
  assert.equal(Object.prototype.hasOwnProperty.call(packedMark, "location"), false, "пустая строка");
  assert.equal(Object.prototype.hasOwnProperty.call(packedMark, "groupId"), false, "null");
  const read = await viewLinkRead(packed.text, codec);
  // Дом из объекта без пустых полей — тот же дом: «нет поля» и «поле пустое» в
  // объекте одно и то же состояние.
  assert.deepStrictEqual(buildHomeSpec(read.project), buildHomeSpec(viewLinkStrip(withEmpty)));
});

test("округление до шести знаков не сдвигает метку на плане заметно", () => {
  // План в сто метров — больше любого этажа. Шестой знак доли плана на нём
  // стоит пять сотых миллиметра, и это предел, которым платят за длину адреса.
  const planMm = 100000;
  const project = legacyProject("legacy-openings-project.json");
  const scheme = project.schemes[0];
  const exact = 0.1234567891234;
  project.marks[0] = { ...project.marks[0], points: [{ x: exact, y: exact }] };
  const strip = viewLinkStrip(project);
  const rounded = strip.marks[0].points[0].x;
  assert.equal(rounded, 0.123457, "шесть знаков");
  const shiftMm = Math.abs(rounded - exact) * planMm;
  assert.ok(shiftMm < 0.05, "сдвиг " + shiftMm + " мм");
  // И то же в миллиметрах плана: перевод доли в миллиметры тот же, что у поля.
  const was = planFractionToMm(project, scheme.id, { x: exact, y: exact });
  const now = planFractionToMm(strip, scheme.id, strip.marks[0].points[0]);
  if (was && now) assert.ok(Math.abs(was.x - now.x) < 0.05 && Math.abs(was.y - now.y) < 0.05);
});

test("округление не трогает целые и большие числа", () => {
  const project = legacyProject("legacy-openings-project.json");
  project.marks[0] = { ...project.marks[0], heightAboveFloor: 2300, length: 1234567890123 };
  const strip = viewLinkStrip(project);
  assert.equal(strip.marks[0].heightAboveFloor, 2300);
  assert.equal(strip.marks[0].length, 1234567890123);
});

test("комментарии из исходника срезаются, а код остаётся разбираемым", async () => {
  const { project, logicId } = scriptedHouse();
  const packed = await viewLinkPack(project, codec);
  const { payload } = payloadOf(packed.text);
  const scenario = payload.p.scenarios.find((item) => item.name === "Свет по движению");
  assert.ok(scenario, "сценарий в нагрузке");
  assert.equal(scenario.source.includes("// шапка"), false, "комментарий срезан");
  assert.ok(scenario.source.includes("Device.get(508131500)"), "код цел");
  assert.doesNotThrow(() => new Function(scenario.source), "срезанное разбирается");
  const read = await viewLinkRead(packed.text, codec);
  const back = read.project.scenarios.find((item) => item.id === logicId);
  assert.equal(back.source, scenario.source);
  assert.equal(packed.stats.scenarios.inlined, 2);
  assert.equal(packed.stats.scenarios.linked, 0);
});

test("комментарий внутри строки и шаблона не трогается", async () => {
  const { project, logicId } = scriptedHouse();
  const tricky = [
    'const a = "// не комментарий";',
    "const b = `/* тоже нет ${1 /* а это да */ + 2} */`;",
    "const c = 10 / 2; // счёт",
    "const d = /\\/\\*/.test(a);",
  ].join("\n");
  const withTricky = { ...project, scenarios: project.scenarios.map((item) => (item.id === logicId ? { ...item, source: tricky } : item)) };
  const { payload } = payloadOf((await viewLinkPack(withTricky, codec)).text);
  const scenario = payload.p.scenarios.find((item) => item.id !== undefined && item.name === "Свет по движению");
  assert.ok(scenario.source.includes('"// не комментарий"'), "строка цела");
  assert.ok(scenario.source.includes("/* тоже нет ${"), "шаблон цел");
  assert.equal(scenario.source.includes("// счёт"), false, "комментарий строки срезан");
  assert.equal(scenario.source.includes("а это да"), false, "комментарий в подстановке срезан");
  assert.ok(scenario.source.includes("10 / 2"), "деление не съедено");
  assert.ok(scenario.source.includes("/\\/\\*/"), "регулярное выражение цело");
});

test("сломанный исходник уезжает целым", async () => {
  const { project, logicId } = scriptedHouse();
  // Нарочно сломанный текст: ни до стрижки, ни после он не разбирается, и
  // трогать его нельзя — это работа интегратора, а не наша.
  const broken = "// шапка\nconst a = {;\n/* хвост */\n";
  const withBroken = {
    ...project,
    scenarios: project.scenarios.map((item) => (item.id === logicId ? { ...item, source: broken } : item)),
  };
  const packed = await viewLinkPack(withBroken, codec);
  const { payload } = payloadOf(packed.text);
  const scenario = payload.p.scenarios.find((item) => item.name === "Свет по движению");
  assert.equal(scenario.source, broken, "исходник в нагрузке целый");
  const read = await viewLinkRead(packed.text, codec);
  assert.equal(read.project.scenarios.find((item) => item.id === logicId).source, broken);
});

test("исходники не стригутся, когда об этом сказано", async () => {
  const { project } = scriptedHouse();
  const packed = await viewLinkPack(project, { ...codec, stripJs: false });
  const { payload } = payloadOf(packed.text);
  const scenario = payload.p.scenarios.find((item) => item.name === "Свет по движению");
  assert.ok(scenario.source.includes("// шапка"), "комментарий на месте");
});

test("исходник уезжает ссылкой на библиотеку, когда реестр его узнаёт", async () => {
  const { project, globalId } = scriptedHouse();
  const source = project.scenarios.find((item) => item.id === globalId).source;
  const index = new Map([[LIB_HASH, { name: "Shared", version: "1.2.0", hash: LIB_HASH, source }]]);
  const packed = await viewLinkPack(project, { ...codec, libraryIndex: index });
  assert.equal(packed.stats.scenarios.linked, 1);
  assert.equal(packed.stats.scenarios.inlined, 1);
  const { payload } = payloadOf(packed.text);
  const scenario = payload.p.scenarios.find((item) => item.id !== undefined && item.name === "Общие имена");
  assert.deepStrictEqual(scenario.lib, { name: "Shared", version: "1.2.0", hash: LIB_HASH });
  assert.equal(Object.prototype.hasOwnProperty.call(scenario, "source"), false, "исходник не едет");
  const read = await viewLinkRead(packed.text, codec);
  assert.deepStrictEqual(read.project.scenarios.find((item) => item.id === globalId).lib, {
    name: "Shared",
    version: "1.2.0",
    hash: LIB_HASH,
  });
});

test("реестр с негодным отпечатком исходника не снимает", async () => {
  const { project, globalId } = scriptedHouse();
  const source = project.scenarios.find((item) => item.id === globalId).source;
  const index = new Map([[LIB_HASH_BAD, { name: "Shared", version: "1.2.0", hash: LIB_HASH_BAD, source }]]);
  const packed = await viewLinkPack(project, { ...codec, libraryIndex: index, stripJs: false });
  assert.equal(packed.stats.scenarios.linked, 0, "ссылкой считается только принятая модель отпечатка");
  const read = await viewLinkRead(packed.text, codec);
  assert.equal(read.project.scenarios.find((item) => item.id === globalId).source, source);
});

test("без реестра исходники едут текстом, а ссылка на библиотеку в объекте уважается", async () => {
  const { project, globalId } = scriptedHouse();
  const withLib = {
    ...project,
    scenarios: project.scenarios.map((item) =>
      item.id === globalId ? { ...item, lib: { name: "Shared", version: "1.2.0", hash: LIB_HASH } } : item,
    ),
  };
  const packed = await viewLinkPack(withLib, codec);
  assert.equal(packed.stats.scenarios.linked, 1, "ссылка в объекте уже есть");
  assert.equal(packed.stats.scenarios.inlined, 1);
  const { payload } = payloadOf(packed.text);
  const scenario = payload.p.scenarios.find((item) => item.name === "Общие имена");
  assert.equal(Object.prototype.hasOwnProperty.call(scenario, "source"), false);
});

test("запись с текстом и непринятой ссылкой остаётся с текстом", async () => {
  // Отпечаток не 64 знака — значит ссылки нет (`model.scenarioLibOf`). Снять
  // против такой ссылки текст означало бы отдать заказчику сценарий, которого
  // нет ни в объекте, ни в библиотеке.
  const { project, globalId } = scriptedHouse();
  const source = project.scenarios.find((item) => item.id === globalId).source;
  const withBroken = {
    ...project,
    scenarios: project.scenarios.map((item) =>
      item.id === globalId ? { ...item, lib: { name: "Shared", version: "1.2.0", hash: LIB_HASH_BAD } } : item,
    ),
  };
  const packed = await viewLinkPack(withBroken, { ...codec, stripJs: false });
  assert.equal(packed.stats.scenarios.linked, 0, "кривой отпечаток ссылкой не считается");
  assert.equal(packed.stats.scenarios.inlined, 2);
  const read = await viewLinkRead(packed.text, codec);
  const scenario = read.project.scenarios.find((item) => item.id === globalId);
  assert.equal(scenario.source, source, "текст уехал целиком");
  assert.deepStrictEqual(scenario.lib, { name: "Shared", version: "1.2.0", hash: LIB_HASH_BAD }, "запись не переписана");
});

test("нагрузка несёт версию формата и дату выгрузки", async () => {
  const project = legacyProject("legacy-project.json");
  const packed = await viewLinkPack(project, { ...codec, madeAt: new Date("2026-11-08T07:30:00.000Z") });
  const { head, payload } = payloadOf(packed.text);
  assert.equal(head, String(VIEW_LINK_VERSION), "версия стоит перед сжатым куском");
  assert.equal(payload.v, VIEW_LINK_VERSION);
  assert.equal(payload.at, "2026-11-08T07:30:00.000Z");
  const read = await viewLinkRead(packed.text, codec);
  assert.equal(read.madeAt, "2026-11-08T07:30:00.000Z");
  assert.equal(read.version, VIEW_LINK_VERSION);
});

test("нагрузка чужой версии отказывает понятно", async () => {
  const project = legacyProject("legacy-project.json");
  const packed = await viewLinkPack(project, codec);
  const foreign = "3." + packed.text.slice(packed.text.indexOf(".") + 1);
  await assert.rejects(
    () => viewLinkRead(foreign, codec),
    (error) => {
      assert.equal(error.code, VIEW_LINK_BROKEN);
      assert.equal(error.reason, "version");
      assert.equal(error.version, 3);
      assert.ok(error.message.includes("более новой версией"), error.message);
      return true;
    },
  );
});

test("ссылка первой версии отвергается по версии, а не читается объектом с короткими id", async () => {
  // Нагрузка прежней сборки: знак-метка, таблица оригиналов и короткие id в
  // объекте. Подстановки больше нет, и без отказа по версии такой объект
  // прочитался бы с идентификаторами вида «~0» — то есть молча испорченным.
  const payload = {
    v: 1,
    at: "2026-11-08T07:30:00.000Z",
    mark: "~",
    ids: ["проект", "схема", "тип", "метка"],
    p: {
      id: "~0",
      markTypes: [{ id: "~2", code: "С" }],
      schemes: [{ id: "~1" }],
      marks: [{ id: "~3", schemeId: "~1", typeId: "~2" }],
    },
  };
  const link = "1." + brotliCompressSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64url");
  await assert.rejects(
    () => viewLinkRead(link, codec),
    (error) => {
      assert.equal(error.code, VIEW_LINK_BROKEN);
      assert.equal(error.reason, "version");
      assert.equal(error.version, 1);
      return true;
    },
  );
});

test("битая, обрезанная и чужая строка дают отказ, а не мусорный объект", async () => {
  const project = legacyProject("legacy-project.json");
  const packed = await viewLinkPack(project, codec);
  const cases = [
    ["пусто", ""],
    ["без версии", packed.text.slice(packed.text.indexOf(".") + 1)],
    ["обрезана", packed.text.slice(0, Math.floor(packed.text.length / 2))],
    ["чужая строка", "1.aGVsbG8gd29ybGQ"],
    ["знак не из алфавита", packed.text.slice(0, 12) + "*" + packed.text.slice(13)],
    ["текст вместо ссылки", "посмотри объект"],
    ["нагрузка не объект", "1." + brotliCompressSync(Buffer.from(JSON.stringify([1, 2, 3]), "utf8")).toString("base64url")],
  ];
  for (const [name, text] of cases) {
    await assert.rejects(
      () => viewLinkRead(text, codec),
      (error) => {
        assert.equal(error.code, VIEW_LINK_BROKEN, name);
        assert.ok(error.message.length > 0, name);
        return true;
      },
      name,
    );
  }
  // Один перевёрнутый знак в середине — тоже отказ, а не половина объекта.
  const flipped = packed.text.slice(0, 40) + (packed.text[40] === "A" ? "B" : "A") + packed.text.slice(41);
  await assert.rejects(() => viewLinkRead(flipped, codec), (error) => error.code === VIEW_LINK_BROKEN);
});

test("кодек обязателен в обе стороны", async () => {
  const project = legacyProject("legacy-project.json");
  await assert.rejects(() => viewLinkPack(project, {}), (error) => error.reason === "codec");
  await assert.rejects(() => viewLinkRead("1.AAAA", {}), (error) => error.reason === "codec");
});

test("stats считает знаки честно", async () => {
  const project = legacyProject("legacy-openings-project.json");
  const packed = await viewLinkPack(project, codec);
  assert.equal(packed.stats.chars, packed.text.length, "знаки — длина строки");
  assert.equal(packed.stats.packed, packed.bytes.length);
  assert.ok(packed.stats.json > packed.stats.packed, "сжатие что-то дало");
  // Знаков всегда больше байтов: base64url — четыре знака на три байта.
  assert.ok(packed.stats.chars >= Math.ceil((packed.stats.packed * 4) / 3));
  assert.equal(VIEW_LINK_PARAM, "o");
});

test("модуль чистый: ни DOM, ни сети, ни хранилищ", () => {
  const source = readFileSync(new URL("../src/viewLink.js", import.meta.url), "utf8");
  for (const name of ["document", "window.", "localStorage", "sessionStorage", "indexedDB", "fetch(", "location."]) {
    assert.equal(source.includes(name), false, name);
  }
  // Импорты — только соседние модули `src/`.
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    assert.ok(match[1].startsWith("./"), match[1]);
  }
});

test("упаковка объект не меняет ни на байт", async () => {
  const { project } = scriptedHouse();
  const before = JSON.stringify(project);
  viewLinkStrip(project);
  const packed = await viewLinkPack(project, codec);
  await viewLinkRead(packed.text, codec);
  assert.equal(JSON.stringify(project), before);
});

test("ссылка состоит только из знаков, которые можно писать в адрес", async () => {
  // base64url и точка версии: ни «+», ни «/», ни «=», ни знака, который адрес
  // пришлось бы перекодировать (G14).
  for (const name of LEGACY) {
    const packed = await viewLinkPack(legacyProject(name), codec);
    assert.match(packed.text, /^[0-9]+\.[A-Za-z0-9_-]+$/, name);
    assert.equal(encodeURIComponent(packed.text), packed.text, name);
  }
});

test("хвост любой длины переживает укладку в base64url", async () => {
  // Три байта на четыре знака: остаток 1 и 2 байта укладывается по-разному, и
  // обе ветки обязаны читаться. Длину нагрузки сдвигает дата.
  const project = legacyProject("legacy-project.json");
  for (const tail of ["", "0", "00", "000", "0000"]) {
    const packed = await viewLinkPack(project, { ...codec, madeAt: "2026-11-08T07:30:00.000Z" + tail });
    const read = await viewLinkRead(packed.text, codec);
    assert.deepStrictEqual(read.project, viewLinkStrip(project), tail);
    assert.equal(read.madeAt, "2026-11-08T07:30:00.000Z" + tail, tail);
  }
});

// Пробелы в конце строки и пустая строка — тоже значение (ревью таска 03):
// внутри многострочного шаблона они часть строки, и стрижка комментариев
// обязана оставить их на месте. Пробелы здесь собираются из `SPACES`, чтобы их
// не унёс ни один редактор.
const SPACES = "   ";
const TRICKY_LINES = [
  "// шапка сценария",
  "const greeting = `строка один" + SPACES,
  "",
  "строка два`; // хвост строки",
  "const spaced = 1;" + SPACES,
  "/* блок",
  "   второй строкой",
  "   третьей строкой */",
  "const after = greeting /* между */ + spaced;",
];
const TRICKY_STRIPPED = [
  "",
  "const greeting = `строка один" + SPACES,
  "",
  "строка два`; ",
  "const spaced = 1;" + SPACES,
  "",
  "",
  "",
  "const after = greeting   + spaced;",
];

function withSource(project, name, source) {
  return { ...project, scenarios: project.scenarios.map((item) => (item.name === name ? { ...item, source } : item)) };
}

test("стрижка отличается от исходника только выкинутыми комментариями", async () => {
  const { project } = scriptedHouse();
  const source = TRICKY_LINES.join("\n");
  const packed = await viewLinkPack(withSource(project, "Свет по движению", source), codec);
  const { payload } = payloadOf(packed.text);
  const now = payload.p.scenarios.find((item) => item.name === "Свет по движению").source;
  assert.equal(now, TRICKY_STRIPPED.join("\n"));
  // И поимённо о том, из-за чего проверка завелась: хвостовой пробел в шаблоне
  // и пустая строка внутри шаблона целы, строк столько же.
  assert.equal(now.split("\n").length, source.split("\n").length, "строк столько же");
  assert.ok(now.includes("строка один" + SPACES), "хвостовой пробел в шаблоне цел");
  assert.ok(now.includes("`строка один" + SPACES + "\n\nстрока два`"), "пустая строка в шаблоне цела");
  assert.ok(now.includes("const spaced = 1;" + SPACES), "хвостовой пробел в коде цел");
  assert.equal(now.includes("шапка сценария"), false, "комментарий срезан");
  assert.equal(now.includes("второй строкой"), false, "блочный комментарий срезан");
});

test("значение многострочного шаблона после стрижки то же", async () => {
  const { project } = scriptedHouse();
  const source = TRICKY_LINES.join("\n");
  const packed = await viewLinkPack(withSource(project, "Свет по движению", source), codec);
  const { payload } = payloadOf(packed.text);
  const now = payload.p.scenarios.find((item) => item.name === "Свет по движению").source;
  // Сверка смыслом, а не текстом: что скажет движок JS на исходный текст и что
  // на стриженый. Разошлись — заказчику уехала другая строка.
  const valuesOf = (text) => new Function(text + "\nreturn [greeting, spaced, after];")();
  assert.deepStrictEqual(valuesOf(now), valuesOf(source));
  assert.deepStrictEqual(valuesOf(now)[0], "строка один" + SPACES + "\n\nстрока два");
});

test("строчный комментарий кончается на любом конце строки", async () => {
  // 0x2028 — разделитель строк языка, и комментарий кончается на нём так же,
  // как на переводе строки. Знак собирается кодом: в исходнике теста он был бы
  // настоящим переводом строки, и проверка проверяла бы не то.
  const separator = String.fromCharCode(0x2028);
  const source = "const a = 1; // хвост" + separator + "const b = 2;";
  const { project } = scriptedHouse();
  const packed = await viewLinkPack(withSource(project, "Свет по движению", source), codec);
  const { payload } = payloadOf(packed.text);
  const now = payload.p.scenarios.find((item) => item.name === "Свет по движению").source;
  assert.equal(now, "const a = 1; " + separator + "const b = 2;");
  const valuesOf = (text) => new Function(text + "\nreturn [a, b];")();
  assert.deepStrictEqual(valuesOf(now), [1, 2]);
  assert.deepStrictEqual(valuesOf(now), valuesOf(source));
});
