// Эмуляция API Sprut.Hub для логических и глобальных сценариев (таск 06
// сценариев): словарь `HS`/`HC`, разбор файла, совместимость, компиляция,
// цикл вызовов хаба на доме-фикстуре, таймеры и `Cron` по времени имитации,
// заглушки сети, формы опций, исполнитель кода блочных сценариев. Истории
// 3.7, 4.11, 4.20, 5.1, 5.3, 5.5–5.10, 5.13, 5.14; `interfaces.md` — строки
// `sim/hubApi.js`, `sim/hubTypes.js` и «Из таска 04» (дверь хозяев).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addScenario } from "../src/model.js";
import { blocksOwner } from "../src/sim/blocks.js";
import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec, markAccessory } from "../src/sim/home.js";
import { sunTimes } from "../src/sim/schedule.js";
import { createHubOwner, hubCompatWarnings, hubContext, hubScriptCompile, hubScriptRead } from "../src/sim/hubApi.js";
import { HUB_CHAR_TYPES, HUB_SERVICE_TYPES } from "../src/sim/hubTypes.js";
import { hubTypesSource } from "../tools/hub-types.mjs";
import { simHouse, simPut, simRecorder } from "./fixtures/simHome.js";
import { MIN, SEC, T0, hubHome } from "./fixtures/sprut/hubHome.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPRUT_TEMPLATE = join(ROOT, "..", "..", "Sprut.Hub_Tools", "ScenarioTemplate");

// ——— словарь HS / HC ————————————————————————————————————————————————————

test("HS — все 94 типа сервисов sh_types.json, HC — все 263 характеристики spruthub.js", () => {
  const services = Object.keys(HUB_SERVICE_TYPES);
  const chars = Object.keys(HUB_CHAR_TYPES);
  assert.equal(services.length, 94);
  assert.equal(chars.length, 263);
  // Первые и последние — в порядке перечислений хаба.
  assert.deepEqual(services.slice(0, 3), ["GenericService", "AccessoryInformation", "AirPurifier"]);
  assert.equal(services.at(-1), "C_TemperatureControl");
  assert.deepEqual(chars.slice(0, 2), ["GenericBase64Tlv8", "GenericBoolean"]);
  assert.equal(chars.at(-1), "C_Long");
  for (const name of ["Window", "Door", "FanBasic", "C_PulseMeter", "C_Option", "C_PetFeeder", "Television"]) {
    assert.ok(HUB_SERVICE_TYPES[name], "нет сервиса " + name);
  }
  for (const name of ["C_Online", "C_PulseCount", "CurrentDoorState", "StatusJammed", "C_Status"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(HUB_CHAR_TYPES, name), "нет характеристики " + name);
  }
});

test("метаданные: формат, диапазон, шаг и допустимые значения — как в sh_types.json", () => {
  assert.equal(HUB_CHAR_TYPES.On.format, "Boolean");
  assert.deepEqual(
    { format: HUB_CHAR_TYPES.Brightness.format, min: HUB_CHAR_TYPES.Brightness.min, max: HUB_CHAR_TYPES.Brightness.max, step: HUB_CHAR_TYPES.Brightness.step },
    { format: "Integer", min: 0, max: 100, step: 1 },
  );
  assert.deepEqual(HUB_CHAR_TYPES.ProgrammableSwitchEvent.values, [
    { code: 0, key: "SINGLE_PRESS" },
    { code: 1, key: "DOUBLE_PRESS" },
    { code: 2, key: "LONG_PRESS" },
  ]);
  assert.deepEqual(HUB_CHAR_TYPES.OccupancyDetected.values, [
    { code: 0, key: "OCCUPANCY_NOT_DETECTED" },
    { code: 1, key: "OCCUPANCY_DETECTED" },
  ]);
  assert.equal(HUB_CHAR_TYPES.CurrentTemperature.step, 0.1);
  assert.equal(HUB_CHAR_TYPES.Name.maxLen, 64);
  // «rU» у оттенка — опечатка файла: число с дробью.
  assert.equal(HUB_CHAR_TYPES.Hue.format, "Double");
  // 22 имени перечисления в sh_types.json не описаны — метаданных у них нет.
  assert.equal(HUB_CHAR_TYPES.C_Status.format, null);
  assert.equal(Object.values(HUB_CHAR_TYPES).filter((meta) => meta.format === null).length, 22);
  assert.deepEqual(HUB_SERVICE_TYPES.Lightbulb.required, ["On"]);
  assert.ok(HUB_SERVICE_TYPES.Lightbulb.optional.includes("Brightness"));
  assert.ok(Object.isFrozen(HUB_CHAR_TYPES) && Object.isFrozen(HUB_CHAR_TYPES.On));
});

test("выжимку делает tools/hub-types.mjs: повторный запуск даёт тот же файл", { skip: !existsSync(join(SPRUT_TEMPLATE, "sh_types.json")) }, () => {
  const shTypes = readFileSync(join(SPRUT_TEMPLATE, "sh_types.json"), "utf8");
  const declarations = readFileSync(join(SPRUT_TEMPLATE, "spruthub.js"), "utf8");
  const written = readFileSync(join(ROOT, "src", "sim", "hubTypes.js"), "utf8");
  const once = hubTypesSource(shTypes, declarations);
  assert.equal(once, written, "файл в src не совпадает с выжимкой");
  assert.equal(hubTypesSource(shTypes, declarations), once, "выжимка не детерминирована");
});

// ——— разбор файла, совместимость, компиляция ————————————————————————————

const LOGIC_JS = [
  "info = {",
  '  name: "Тест",',
  "  sourceServices: [HS.Lightbulb],",
  "  sourceCharacteristics: [HC.On],",
  "  options: {},",
  "  variables: {}",
  "}",
  "function trigger(source, value, variables, options, context) {}",
].join("\n");

test("hubScriptRead: .js с info и trigger — логический, без них — глобальный", () => {
  const logic = hubScriptRead(LOGIC_JS, "Тест.js");
  assert.equal(logic.kind, "logic");
  assert.equal(logic.origin, "js");
  assert.equal(logic.source, LOGIC_JS);
  assert.equal(logic.syntax, null);
  assert.equal(logic.name, "Тест");
  assert.equal(hubScriptRead("var info = { name: 'a' };\nfunction compute(s, v) { return v; }").kind, "logic");
  // info без trigger и trigger без info — глобальный, как у ScenarioSimulator.
  assert.equal(hubScriptRead("function trigger() {}").kind, "global");
  assert.equal(hubScriptRead("info = { name: 'a' }").kind, "global");
  assert.equal(hubScriptRead("function helper() {}\nglobal.helper = helper;", "Утилиты.js").kind, "global");
  // Вложенные `info` и `trigger` верхним уровнем не считаются.
  assert.equal(hubScriptRead("function f() { info = {}; function trigger() {} }").kind, "global");
  assert.equal(hubScriptRead("// info = {}\nvar s = 'function trigger() {}';").kind, "global");
});

test("hubScriptRead: JSON scenarioTemplate — вид из type; TEMPLATE и блочный экспорт — отказ", () => {
  const template = { name: "Скрыть", desc: "Описание", active: true, onStart: true, sync: false, data: LOGIC_JS, type: "LOGIC" };
  const read = hubScriptRead(JSON.stringify({ scenarioTemplate: template }, null, 2), "Скрыть.json");
  assert.equal(read.kind, "logic");
  assert.equal(read.origin, "json");
  assert.equal(read.source, LOGIC_JS);
  assert.equal(read.name, "Скрыть");
  assert.deepEqual(read.template, { name: "Скрыть", desc: "Описание", active: true, onStart: true, sync: false });
  const global = hubScriptRead(JSON.stringify({ scenarioTemplate: { ...template, data: "var a = 1;", type: "GLOBAL" } }));
  assert.equal(global.kind, "global");
  assert.equal(global.origin, "json");
  for (const type of ["TEMPLATE", "BLOCK"]) {
    assert.deepEqual(hubScriptRead(JSON.stringify({ scenarioTemplate: { ...template, type } }), "x.json"), { error: "hubBlocks" });
  }
  assert.deepEqual(hubScriptRead(JSON.stringify({ targets: [{ type: "if" }] }), "x.json"), { error: "hubBlocks" });
  assert.deepEqual(hubScriptRead("{ не json", "x.json"), { error: "hubFileUnknown" });
  assert.deepEqual(hubScriptRead(JSON.stringify({ hello: 1 })), { error: "hubFileUnknown" });
  assert.deepEqual(hubScriptRead("   \n"), { error: "hubFileEmpty" });
});

test("hubScriptRead: синтаксическая ошибка — строка и текст, сохранить можно", () => {
  const source = "var a = 1;\nfunction trigger() {\n  return a +;\n}\ninfo = {};";
  const read = hubScriptRead(source, "a.js");
  assert.equal(read.kind, "logic");
  assert.equal(read.syntax.line, 3);
  assert.ok(read.syntax.message.length > 0);
  // Незакрытая строка и комментарий — на своей строке.
  assert.equal(hubScriptCompile("var a = 1;\nvar b = 'abc;\nvar c = 2;").line, 2);
  assert.equal(hubScriptCompile("var a = 1;\n\n/* хвост\nvar b;").line, 3);
  // Нехватка закрывающей скобки — на строке, где скобка открыта.
  assert.equal(hubScriptCompile("var a = 1;\nfunction f() {\n  if (a) {\n    a = 2;\n}\n").line, 2);
  assert.equal(hubScriptCompile("var a = 1;\nvar b = [1, 2);\n").line, 2);
  // Ошибка в последней строке и в первой.
  assert.equal(hubScriptCompile("var a = 1;\nvar b = 2;\nvar = 3;").line, 3);
  assert.equal(hubScriptCompile("var var = 1;\nvar b = 2;").line, 1);
  assert.equal(typeof hubScriptCompile(LOGIC_JS).run, "function");
});

test("предупреждения совместимости: class, async, деструктуризация, ?., ... — с номерами строк", () => {
  const source = [
    "class A {}", // 1
    "async function f() { await g(); }", // 2
    "const { a, b } = obj;", // 3
    "let [x] = list;", // 4
    "var y = obj?.field;", // 5
    "call(...args);", // 6
    "function h({ p }) {}", // 7
    "var z = ({ q }) => q;", // 8
    "var s = 'class async ?. ...'; // class", // 9
    "var t = a ? .5 : 1;", // 10
    "var u = o.class + o.async;", // 11
    "/* const {c} = d; */", // 12
  ].join("\n");
  assert.deepEqual(hubCompatWarnings(source), [
    { code: "class", line: 1 },
    { code: "async", line: 2 },
    { code: "async", line: 2 },
    { code: "destructuring", line: 3 },
    { code: "destructuring", line: 4 },
    { code: "optionalChain", line: 5 },
    { code: "spread", line: 6 },
    { code: "destructuring", line: 7 },
    { code: "destructuring", line: 8 },
  ]);
  assert.deepEqual(hubCompatWarnings(LOGIC_JS), []);
});

// ——— хозяин скриптов на доме-фикстуре ————————————————————————————————————

// Логический сценарий: на верхнем уровне `info`, `trigger` пишет вызов в `global.calls`.
function recorderScript(name, { chars = ["On"], services = ["Lightbulb"], onStart = false, body = "" } = {}) {
  return [
    "info = {",
    "  name: " + JSON.stringify(name) + ",",
    "  onStart: " + onStart + ",",
    "  sourceServices: [" + services.map((type) => "HS." + type).join(", ") + "],",
    "  sourceCharacteristics: [" + chars.map((type) => "HC." + type).join(", ") + "],",
    "  options: { level: { type: 'Integer', value: 7, minValue: 0, maxValue: 10 } },",
    "  variables: { count: 0, list: [] }",
    "};",
    "function trigger(source, value, variables, options, context) {",
    "  variables.count += 1;",
    "  if (!global.calls) global.calls = [];",
    "  global.calls.push({ name: " + JSON.stringify(name) + ", uuid: source.getUUID(), type: source.getType(), value: value, count: variables.count, level: options.level, context: String(context) });",
    body,
    "}",
  ].join("\n");
}

function calls(home) {
  return home.code("return global.calls || []").value;
}

test("изоляция: одинаковые info и trigger у двух сценариев не мешают; неявный глобал не протекает", () => {
  const home = hubHome({
    scripts: [
      { key: "a", source: recorderScript("A") + "\nleakA = 1;" },
      { key: "b", source: recorderScript("B") + "\nvar ownB = 2;" },
    ],
    bindings: [
      { script: "a", mark: "С1" },
      { script: "b", mark: "С2", options: { level: 3 } },
    ],
  });
  home.set("С1", "On", true);
  home.set("С2", "On", true);
  assert.deepEqual(
    calls(home).map((call) => [call.name, call.uuid, call.value, call.level]),
    [
      ["A", home.char("С1", "On").address, true, 7],
      ["B", home.char("С2", "On").address, true, 3],
    ],
  );
  assert.equal(home.code("return typeof leakA + ' ' + typeof ownB + ' ' + typeof info + ' ' + typeof trigger").value, "undefined undefined undefined undefined");
  assert.equal(typeof globalThis.leakA, "undefined", "неявный глобал утёк в globalThis");
  assert.equal(typeof globalThis.info, "undefined");
});

test("изоляция: global.x глобального виден логическому, голое имя — нет; project и DOM не видны", () => {
  const home = hubHome({
    scripts: [
      { key: "g", kind: "global", source: "var shared = 5;\nfunction twice(x) { return x * 2; }\nconst LIMIT = 3;" },
      {
        key: "l",
        source: recorderScript("L", {
          body: "  global.seen = [global.twice(2), GlobalVariables.shared, global.LIMIT, typeof twice, typeof shared].join(',');",
        }),
      },
    ],
    bindings: [{ script: "l", mark: "С1" }],
  });
  home.set("С1", "On", true);
  assert.equal(home.code("return global.seen").value, "4,5,3,undefined,undefined");
  const hidden = ["window", "document", "project", "self", "postMessage", "globalThis", "importScripts", "fetch", "localStorage", "Function", "eval"];
  assert.equal(home.code("return [" + hidden.map((name) => "typeof " + name).join(", ") + "].join(',')").value, hidden.map(() => "undefined").join(","));
  assert.equal(home.code("return typeof Math + typeof JSON + typeof Map + typeof parseInt").value, "objectobjectfunctionfunction");
  // Сценарий пишет только в состояние дома: объект проекта ему не дан ничем.
  assert.equal(home.code("return Object.keys(this).length").value, 0);
});

test("цикл: trigger после записи sourceCharacteristics — source, value, variables, options, context", () => {
  const home = hubHome({ scripts: [{ key: "t", name: "Свет в коридоре", source: recorderScript("T") }], bindings: [{ script: "t", mark: "С1", options: { level: 99 } }] });
  home.set("С1", "Brightness", 40);
  assert.deepEqual(calls(home), [], "trigger на чужую характеристику");
  home.set("С1", "On", true);
  home.set("С1", "On", false);
  const seen = calls(home);
  assert.deepEqual(
    seen.map((call) => [call.type, call.value, call.count, call.level]),
    [
      ["On", true, 1, 10],
      ["On", false, 2, 10],
    ],
  );
  const service = home.address("С1");
  const char = home.char("С1", "On").address;
  assert.equal(seen[0].context, "LOGIC[Свет_в_коридоре_Service " + service + "] <- C[" + char + " Lightbulb.On] <- WEB[Имитация]_" + T0 / 1000);
  const runs = home.log("hubTrigger");
  assert.equal(runs.length, 2);
  assert.equal(runs[0].kind, "run");
  assert.equal(runs[0].scenarioId, home.scenarios.t);
  assert.equal(runs[0].bindingId, home.bound["С1"]);
  assert.deepEqual(runs[0].chain.map((cause) => cause.k), ["logic", "char", "web"]);
});

test("цикл: onStart — trigger при запуске дома с HUB[OnStart]; эхо собственной записи зовёт trigger снова", () => {
  const echo = [
    "  if (value === true && context.split(' <- ').length < 4) source.setValue(false);",
  ].join("\n");
  const home = hubHome({ scripts: [{ key: "e", name: "Эхо", source: recorderScript("E", { onStart: true, body: echo }) }], bindings: [{ script: "e", mark: "С1" }] });
  const service = home.address("С1");
  const char = home.char("С1", "On").address;
  const logic = "LOGIC[Эхо_Service " + service + "]";
  assert.deepEqual(calls(home).map((call) => [call.value, call.context]), [[false, logic + " <- HUB[OnStart]"]]);
  home.set("С1", "On", true);
  const seen = calls(home);
  assert.equal(home.value("С1", "On"), false, "запись сценария не дошла");
  assert.equal(seen.length, 3);
  assert.equal(seen[2].value, false);
  // Эхо: LOGIC X <- C <- LOGIC X — по нему сценарии узнают свою запись.
  const parts = seen[2].context.split(" <- ");
  assert.deepEqual(parts.slice(0, 4), [logic, "C[" + char + " Lightbulb.On]", logic, "C[" + char + " Lightbulb.On]"]);
  assert.equal(parts.at(-1), "WEB[Имитация]_" + T0 / 1000);
});

test("цикл: compute — до записи, его значение записывается; перечисления скрипт видит кодами", () => {
  const computeSource = [
    "info = { name: 'Предел', sourceServices: [HS.Lightbulb], sourceCharacteristics: [HC.Brightness], options: {} };",
    "function compute(source, value) { return value > 50 ? 50 : undefined; }",
    "function trigger() {}",
  ].join("\n");
  const home = hubHome({
    scripts: [
      { key: "c", source: computeSource },
      { key: "o", source: recorderScript("O", { services: ["OccupancySensor"], chars: ["OccupancyDetected"] }) },
    ],
    bindings: [
      { script: "c", mark: "С1" },
      { script: "o", mark: "ДП1" },
    ],
  });
  home.set("С1", "Brightness", 90);
  assert.equal(home.value("С1", "Brightness"), 50);
  home.set("С1", "Brightness", 30);
  assert.equal(home.value("С1", "Brightness"), 30);
  home.engine.act({ kind: "sensor", markId: home.id("ДП1") });
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_DETECTED");
  assert.deepEqual(calls(home).map((call) => call.value), [1]);
  // Запись кодом — движок переводит в имя константы.
  home.code("Hub.getAccessory(" + home.accessory("ДП1").aid + ").getService(HS.OccupancySensor).getCharacteristic(HC.OccupancyDetected).setValue(0)");
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_NOT_DETECTED");
});

test("таймеры: setTimeout и setInterval возвращают Task и идут по времени имитации", () => {
  const home = hubHome();
  const once = home.code(
    "global.fired = []; var task = setTimeout(function (a) { global.fired.push(['t', Date.now(), a]); }, 5000, 'x');" +
      "global.tick = setInterval(function () { global.fired.push(['i', Date.now()]); }, 1000);" +
      "global.gone = setTimeout(function () { global.fired.push(['gone']); }, 2000); clearTimeout(global.gone);" +
      "return [typeof task.clear, typeof task.cancel].join(',');",
  );
  assert.deepEqual(once, { ok: true, value: "function,function" });
  home.engine.advanceTo(T0 + 4999);
  assert.deepEqual(home.code("return global.fired").value.map((item) => item[0]), ["i", "i", "i", "i"]);
  home.engine.advanceTo(T0 + 5000);
  home.code("global.tick.clear()");
  home.engine.advanceTo(T0 + 60 * SEC);
  assert.deepEqual(home.code("return global.fired").value, [
    ["i", T0 + 1000],
    ["i", T0 + 2000],
    ["i", T0 + 3000],
    ["i", T0 + 4000],
    // В один миг — по порядку постановки: таймаут поставлен раньше пятого тика.
    ["t", T0 + 5000, "x"],
    ["i", T0 + 5000],
  ]);
});

test("Cron.schedule — шесть полей с секундами; sunrise и sunset — по солнцу объекта; Date — время имитации", () => {
  const home = hubHome();
  home.code(
    "global.cron = []; Cron.schedule('0 30 12 * * *', function () { global.cron.push(['cron', new Date().getHours(), new Date().getMinutes()]); });" +
      "Cron.sunrise('', 10, function () { global.cron.push(['rise', Date.now()]); });" +
      "Cron.sunset('0 0 0 * * MON', 0, function () { global.cron.push(['set', Date.now()]); });",
  );
  home.engine.advanceTo(T0 + 30 * MIN);
  assert.deepEqual(home.code("return global.cron").value, [["cron", 12, 30]]);
  // Без координат восход — 9:00, закат — 21:00 (как в «Объёме»); закат — только по понедельникам.
  home.engine.advanceTo(T0 + 4 * 24 * 60 * MIN);
  assert.deepEqual(home.code("return global.cron.filter(function (item) { return item[0] !== 'cron'; })").value, [
    ["rise", Date.UTC(2026, 9, 24, 9, 10)],
    ["rise", Date.UTC(2026, 9, 25, 9, 10)],
    ["set", Date.UTC(2026, 9, 26, 21, 0)],
    ["rise", Date.UTC(2026, 9, 26, 9, 10)],
    ["rise", Date.UTC(2026, 9, 27, 9, 10)],
  ].sort((a, b) => a[1] - b[1]));
  assert.equal(home.code("return global.cron.filter(function (item) { return item[0] === 'cron'; }).length").value, 4);
  // Неверное выражение — исключение, как на хабе.
  assert.equal(home.code("Cron.schedule('0 0 25 * * *', function () {})").ok, false);
  const now = home.engine.now();
  assert.deepEqual(
    home.code(
      "var d = new Date(); return [Date.now(), d.getTime(), d.getHours(), d.getDay(), d.getTimezoneOffset(), new Date(2026, 9, 23, 7, 5).getTime(), new Date('2026-10-23T07:05:00').getTime(), d instanceof Date].join(',')",
    ).value,
    [now, now, new Date(now).getUTCHours(), new Date(now).getUTCDay(), 0, Date.UTC(2026, 9, 23, 7, 5), Date.UTC(2026, 9, 23, 7, 5), true].join(","),
  );
});

test("Cron.sunrise с координатами — тем же счётом, что солнце «Объёма»; перевод часов назад пересчитывает cron", () => {
  const site = { latDeg: 55.75, lonDeg: 37.62 };
  const home = hubHome({ site });
  home.code("global.rise = []; Cron.sunrise('', 0, function () { global.rise.push(Date.now()); });");
  home.engine.advanceTo(T0 + 24 * 60 * MIN);
  const expected = sunTimes(Date.UTC(2026, 9, 24), site).riseAt;
  assert.deepEqual(home.code("return global.rise").value, [expected]);
  home.code("global.back = []; Cron.schedule('0 0 13 * * *', function () { global.back.push(Date.now()); });");
  home.engine.setClock({ simMs: T0 });
  home.engine.advanceTo(T0 + 60 * MIN);
  assert.deepEqual(home.code("return global.back").value, [T0 + 60 * MIN]);
});

test("заглушки сети и почты пишут строку в журнал и не бросают исключений", () => {
  const home = hubHome();
  const result = home.code(
    [
      "var r = HttpClient.GET('http://isdayoff.ru/api').path('today').queryString('cc', 'ru').header('A', 'b').send();",
      "Notify.text('Привет, {}!', 'мир').to('Telegram_1').silent(true).send();",
      "new Mail().host('smtp').to('a@b.c').subject('Тема').body('x').send();",
      "var s = new SSH().host('nas').username('u').password('секрет').connect(); var out = s.execute('ls');",
      "var ping = UtilsNet.ping('10.0.0.1'); UtilsNet.wakeOnLan('AA:BB'); var mac = UtilsNet.getMacAddress('pc');",
      "console.info('a {} b {}', 1, { x: 2 }); log.warn('w'); console.debug('d'); console.message('m', 'хвост');",
      "return [r.getStatus(), r.getBody(), out, ping, mac, typeof Utils.uuid()].join('|');",
    ].join("\n"),
  );
  assert.deepEqual(result, { ok: true, value: "0|||false||string" });
  const http = home.log("hubHttp");
  assert.equal(http.length, 1);
  assert.equal(http[0].kind, "http");
  assert.deepEqual(http[0].vars, { name: "probe", method: "GET", url: "http://isdayoff.ru/api/today?cc=ru" });
  assert.deepEqual(home.log("hubNotify").map((entry) => [entry.kind, entry.vars.text, entry.vars.to]), [["notify", "Привет, мир!", "Telegram_1"]]);
  assert.deepEqual(home.log("hubMail").map((entry) => entry.vars), [{ name: "probe", to: "a@b.c", subject: "Тема" }]);
  assert.deepEqual(home.log("hubSsh").map((entry) => entry.vars), [{ name: "probe", host: "nas", command: "ls" }]);
  assert.deepEqual(home.log("hubNet").map((entry) => entry.vars.what), ["ping", "wakeOnLan", "getMacAddress"]);
  assert.ok(!JSON.stringify(home.recorder.log()).includes("секрет"), "пароль попал в журнал");
  assert.deepEqual(
    home.log("hubLog").map((entry) => [entry.kind, entry.vars.level, entry.vars.message]),
    [
      ["system", "info", 'a 1 b {"x":2}'],
      ["system", "warn", "w"],
      ["system", "debug", "d"],
      ["system", "message", "m хвост"],
    ],
  );
});

test("исключение в trigger — запись в журнал со сценарием, привязкой и строкой; остальное идёт", () => {
  const broken = recorderScript("Сломанный", { body: "  if (value) {\n    null.boom();\n  }" });
  const line = broken.split("\n").findIndex((item) => item.includes("null.boom")) + 1;
  const home = hubHome({
    scripts: [
      { key: "x", name: "Сломанный", source: broken },
      { key: "ok", source: recorderScript("OK") },
    ],
    bindings: [
      { script: "x", mark: "С1" },
      { script: "ok", mark: "С2" },
    ],
  });
  home.set("С1", "On", true);
  home.set("С2", "On", true);
  const errors = home.log("hubError");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "error");
  assert.equal(errors[0].scenarioId, home.scenarios.x);
  assert.equal(errors[0].bindingId, home.bound["С1"]);
  assert.equal(errors[0].line, line);
  assert.equal(errors[0].vars.line, line);
  assert.equal(errors[0].vars.where, "trigger");
  assert.equal(errors[0].vars.name, "Сломанный");
  assert.equal(errors[0].vars.label, "С1");
  assert.match(errors[0].vars.message, /boom|null/);
  assert.deepEqual(calls(home).map((call) => [call.name, call.value]), [["Сломанный", true], ["OK", true]]);
  assert.equal(home.value("С2", "On"), true);
  // Синтаксическая ошибка: сценарий не исполняется, в списке — неисправность.
  const bad = hubHome({ scripts: [{ key: "s", name: "Опечатка", source: "info = {\nfunction trigger( {}" }] });
  assert.deepEqual(bad.log("hubSyntax").map((entry) => [entry.kind, entry.vars.name, entry.vars.line]), [["error", "Опечатка", 2]]);
  assert.equal(bad.hub.scenarios()[0].fault.code, "syntax");
});

test("форма опций: типы, list/status/html и списки устройств, построенные скриптом на доме", () => {
  const source = [
    "var sensors = [{ name: { ru: 'Не выбрано', en: 'None' }, value: '' }];",
    "Hub.getAccessories().forEach(function (a) {",
    "  a.getServices(HS.MotionSensor).forEach(function (s) {",
    "    sensors.push({ name: { ru: a.getRoom().getName() + ' -> ' + a.getName(), en: a.getName() }, value: s.getUUID() });",
    "  });",
    "});",
    "info = {",
    "  name: { ru: 'Свет по движению', en: 'Motion light' }, description: 'Описание',",
    "  sourceServices: [HS.Lightbulb], sourceCharacteristics: [HC.On],",
    "  options: {",
    "    group: { name: { ru: 'ДАТЧИКИ' }, type: 'String', value: '', formType: 'status' },",
    "    sensor: { name: { ru: 'Датчик' }, desc: { ru: 'Какой' }, type: 'String', value: '', formType: 'list', values: sensors },",
    "    delay: { name: { ru: 'Задержка' }, type: 'Integer', value: 30, minValue: 0, maxValue: 600, step: 5 },",
    "    ratio: { type: 'Double', value: 0.5 },",
    "    debug: { name: { ru: 'Отладка' }, type: 'Boolean', value: false },",
    "    link: { type: 'String', value: '<a href=\"x\">чат</a>', formType: 'html' }",
    "  }",
    "};",
    "function trigger() {}",
  ].join("\n");
  const box = simHouse();
  const home = hubHome({ box, scripts: [{ key: "m", source }], bindings: [{ script: "m", mark: "С1", options: { delay: 999, debug: "true" } }], start: false });
  const forms = home.forms();
  const fresh = forms.find((message) => message.bindingId === null);
  const bound = forms.find((message) => message.bindingId === home.bound["С1"]);
  assert.equal(fresh.scenarioId, home.scenarios.m);
  assert.equal(fresh.form.name, "Свет по движению");
  assert.deepEqual(fresh.form.sourceServices, ["Lightbulb"]);
  assert.deepEqual(
    fresh.form.fields.map((field) => [field.key, field.type, field.formType, field.label, field.value, field.readOnly]),
    [
      ["group", "String", "status", "ДАТЧИКИ", "", true],
      ["sensor", "String", "list", "Датчик", "", false],
      ["delay", "Integer", null, "Задержка", 30, false],
      ["ratio", "Double", null, "ratio", 0.5, false],
      ["debug", "Boolean", null, "Отладка", false, false],
      ["link", "String", "html", "link", '<a href="x">чат</a>', true],
    ],
  );
  assert.equal(fresh.form.fields[5].html, '<a href="x">чат</a>');
  assert.deepEqual(
    { min: fresh.form.fields[2].min, max: fresh.form.fields[2].max, step: fresh.form.fields[2].step },
    { min: 0, max: 600, step: 5 },
  );
  // Список строит сам скрипт на доме объекта: два датчика движения и «Не выбрано».
  assert.deepEqual(fresh.form.fields[1].values.map((item) => item.value), ["", home.address("ДД1"), home.address("ДД2")]);
  assert.equal(fresh.form.fields[1].values[1].label, "Коридор -> ДД1");
  assert.equal(fresh.form.fields[1].values[2].label, "Без помещения -> ДД2");
  // У привязки — свои значения, приведённые к типу и диапазону.
  assert.deepEqual([bound.form.fields[2].value, bound.form.fields[4].value], [600, true]);
  // Дом изменился — скрипт исполняется заново, форма обновляется.
  simPut(box, "ДД", { x: 0.4, y: 0.4 }, "living");
  home.recorder.clear();
  home.reload();
  const again = home.forms().find((message) => message.bindingId === null);
  assert.deepEqual(again.form.fields[1].values.map((item) => item.value), ["", home.address("ДД1"), home.address("ДД2"), home.address("ДД3")]);
  // Ничего не изменилось — форма второй раз не шлётся.
  home.recorder.clear();
  home.reload();
  assert.deepEqual(home.forms(), []);
});

test("исполнитель кода блочных сценариев: условие, блок-код, LocalVariables, global, ошибки со строкой", () => {
  const home = hubHome({ scripts: [{ key: "g", kind: "global", source: "function isOn(aid) { return Hub.getAccessory(aid).getService(HS.Lightbulb).getCharacteristic(HC.On).getValue(); }" }] });
  const aid = home.accessory("С1").aid;
  assert.deepEqual(home.code("return global.isOn(" + aid + ")", "condition", "s1"), { ok: true, value: false });
  home.set("С1", "On", true);
  assert.deepEqual(home.code("return global.isOn(" + aid + ")", "condition", "s1"), { ok: true, value: true });
  assert.deepEqual(home.code("return 'да'", "condition", "s1"), { ok: true, value: true });
  // LocalVariables — память одного сценария между блоками кода; простые переменные — только внутри блока.
  home.code("LocalVariables.n = (LocalVariables.n || 0) + 1; var tmp = 1;", "action", "s1");
  home.code("LocalVariables.n = (LocalVariables.n || 0) + 1;", "action", "s1");
  assert.deepEqual(home.code("return [LocalVariables.n, typeof tmp].join(',')", "condition", "s1").value, true);
  assert.equal(home.code("return [LocalVariables.n, typeof tmp].join(',')", "action", "s1").value, "2,undefined");
  assert.equal(home.code("return String(LocalVariables.n)", "action", "s2").value, "undefined");
  // Запись из блок-кода — от имени блочного сценария.
  home.recorder.clear();
  home.code("Hub.setCharacteristicValue(" + aid + ", " + home.char("С1", "On").cid + ", false)", "action", "s1");
  assert.equal(home.value("С1", "On"), false);
  const change = home.recorder.log().find((entry) => entry.kind === "change" && entry.markId === home.id("С1"));
  assert.deepEqual(change.chain.slice(0, 1), [{ k: "scenario", scenarioId: "s1", blockId: "b1" }]);
  // Ошибки: синтаксис и исключение — со строкой, ничего не бросается наружу.
  const syntax = home.code("var a = 1;\nreturn a +;", "condition", "s1");
  assert.equal(syntax.ok, false);
  assert.equal(syntax.line, 2);
  const thrown = home.code("var a = 1;\n\nthrow new Error('нет');", "action", "s1");
  assert.deepEqual([thrown.ok, thrown.error, thrown.line], [false, "нет", 3]);
});

test("глобальный сценарий сам характеристик не меняет; вызванная логическим функция — меняет", () => {
  const home = hubHome({
    scripts: [
      { key: "g", kind: "global", source: "function on(aid, cid) { Hub.setCharacteristicValue(aid, cid, true); }\nglobal.on = on;\non(" + 0 + ", 0);" },
    ],
  });
  const aid = home.accessory("С1").aid;
  const cid = home.char("С1", "On").cid;
  home.code("Hub.getAccessories(); var f = global.on; f(" + aid + ", " + cid + ");");
  assert.equal(home.value("С1", "On"), true, "из блочного кода функция глобального не включила свет");
  const box = simHouse();
  const own = hubHome({ box, scripts: [{ key: "g", kind: "global", source: "Hub.setCharacteristicValue(" + markAccessory(box.project, box.marks["С1"]).aid + ", " + cid + ", true);" }] });
  assert.equal(own.value("С1", "On"), false);
  assert.equal(own.log("hubGlobalWrite").length, 1);
});

test("подписки: subscribeWithCondition с условием и типами, Hub.subscribe — на всё; Task.clear снимает", () => {
  const home = hubHome();
  home.code(
    "global.hot = []; global.all = 0;" +
      "global.sub = Hub.subscribeWithCondition('>', '25', [HS.Thermostat], [HC.CurrentTemperature], function (c, v, tag) { global.hot.push([c.getService().getAccessory().getName(), v, tag]); }, 'метка');" +
      "global.any = Hub.subscribe(function () { global.all += 1; });",
  );
  home.set("ТС1", "CurrentTemperature", 24);
  home.set("ТС1", "CurrentTemperature", 26.5);
  home.set("ДТВ1", "CurrentTemperature", 30);
  assert.deepEqual(home.code("return global.hot").value, [["ТС1", 26.5, "метка"]]);
  assert.ok(home.code("return global.all").value >= 3);
  home.code("global.sub.clear(); global.any.clear(); global.all = 0;");
  home.set("ТС1", "CurrentTemperature", 28);
  assert.deepEqual(home.code("return [global.hot.length, global.all]").value, [1, 0]);
});

test("Hub API: аксессуар, сервисы, характеристики, комнаты и адреса aid.sid.cid", () => {
  const home = hubHome();
  const light = home.accessory("С1");
  const key = home.accessory("ВВ1");
  const value = home.code(
    [
      "var a = Hub.getAccessory('" + light.aid + "');",
      "var s = a.getService(HS.Lightbulb);",
      "var c = s.getCharacteristic(HC.Brightness);",
      "var k = Hub.getAccessory(" + key.aid + ");",
      "return {",
      "  uuid: a.getUUID(), name: a.getName(), room: a.getRoom().getName(), services: a.getServices().map(function (x) { return x.getType(); }),",
      "  sid: s.getUUID(), byId: a.getService(" + light.services[0].sid + ").getUUID(), sname: s.getName(),",
      "  cid: c.getUUID(), value: c.getValue(), min: c.getMinValue(), max: c.getMaxValue(), step: c.getMinStep(), format: c.getFormat(),",
      "  online: a.getService(HS.AccessoryInformation).getCharacteristic(HC.C_Online).getValue(),",
      "  keys: k.getServices(HS.StatelessProgrammableSwitch).map(function (x) { return x.getName(); }),",
      "  rooms: Hub.getRooms().map(function (r) { return r.getName() + ':' + r.getAccessories().length; }),",
      "  byCid: Hub.getCharacteristic(" + light.aid + ", " + light.services[0].chars[0].cid + ").getType(),",
      "  missing: Hub.getAccessory(1) === null && a.getService(HS.Switch) === null,",
      "};",
    ].join("\n"),
  ).value;
  assert.deepEqual(value, {
    uuid: String(light.aid),
    name: "С1",
    room: "Коридор",
    services: ["AccessoryInformation", "Lightbulb"],
    sid: light.services[0].address,
    byId: light.services[0].address,
    sname: "С1",
    cid: home.char("С1", "Brightness").address,
    value: 100,
    min: 0,
    max: 100,
    step: 1,
    format: "Integer",
    online: true,
    keys: ["Кнопка 1", "Кнопка 2"],
    rooms: ["Коридор:4", "Гостиная:9", "Спальня:4", "Без помещения:4"],
    byCid: "On",
    missing: true,
  });
});

test("активность: неактивный сценарий не зовётся; включение — заново, с onStart", () => {
  const home = hubHome({ scripts: [{ key: "t", source: recorderScript("T", { onStart: true }) }], bindings: [{ script: "t", mark: "С1" }] });
  assert.equal(calls(home).length, 1);
  home.engine.setScenarioActive(home.scenarios.t, false);
  home.set("С1", "On", true);
  assert.equal(calls(home).length, 1);
  assert.equal(home.hub.scenarios()[0].active, false);
  home.engine.setScenarioActive(home.scenarios.t, true);
  const seen = calls(home);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].value, true);
  assert.ok(seen[1].context.endsWith("HUB[OnStart]"));
  assert.equal(seen[1].count, 1, "свежие variables после включения");
});

test("hubContext — звенья хаба через « <- »", () => {
  assert.equal(
    hubContext([
      { k: "logic", scenarioId: "x", address: "123.13", name: "Мой сценарий" },
      { k: "char", address: "123.13.14", serviceType: "Switch", char: "On" },
      { k: "logic", scenarioId: "y", global: true, name: "Утилиты" },
      { k: "timer", at: 5000, what: "setTimeout" },
      { k: "scenario", scenarioId: "s" },
      { k: "hub", what: "start" },
      { k: "web", at: 61000 },
    ], (id) => (id === "s" ? "Блочный" : null)),
    "LOGIC[Мой_сценарий_Service 123.13] <- C[123.13.14 Switch.On] <- GLOBAL[Утилиты] <- TIMER[setTimeout]_5 <- SCENARIO[Блочный] <- HUB[OnStart] <- WEB[Имитация]_61",
  );
});

test("блочный хозяин через дверь движка: условие-код и блок-код исполняет хозяин скриптов", () => {
  const box = simHouse();
  const added = addScenario(box.project, {
    kind: "block",
    name: "Код",
    targets: [
      {
        type: "if",
        id: "if1",
        if: { type: "group", id: "g1", mode: "OR", conditions: [{ type: "code", id: "c1", code: "return global.allow === true;" }] },
        then: [{ type: "code", id: "a1", code: "LocalVariables.runs = (LocalVariables.runs || 0) + 1; global.runs = LocalVariables.runs;" }],
        else: [{ type: "code", id: "a2", code: "global.denied = (global.denied || 0) + 1;" }],
      },
    ],
  });
  box.project = added.project;
  const global = addScenario(box.project, { kind: "global", name: "Флаг", source: "var allow = false;" });
  box.project = global.project;
  const recorder = simRecorder();
  const probe = { name: "probe", host: null, load(home, host) { probe.host = host; } };
  const engine = createSimEngine({ emit: recorder.emit, owners: [createHubOwner(), blocksOwner(), probe] });
  engine.load({ ...buildHomeSpec(box.project), rooms: box.project.rooms });
  engine.setClock({ simMs: T0 });
  engine.start();
  const read = (code) => probe.host.runCode({ kind: "action", code, scenarioId: "probe", chain: [] }).value;
  engine.runScenario(added.scenario.id);
  // Флаг глобального — ложь: условие-код ложно, идёт «Иначе».
  assert.deepEqual(read("return [global.allow, global.denied, global.runs]"), [false, 1, undefined]);
  read("global.allow = true;");
  engine.runScenario(added.scenario.id);
  engine.runScenario(added.scenario.id);
  // LocalVariables сценария живут между его запусками.
  assert.deepEqual(read("return [global.denied, global.runs]"), [1, 2]);
  assert.deepEqual(recorder.log().filter((entry) => entry.code === "hubError" || entry.code === "blockCodeError"), []);
});
