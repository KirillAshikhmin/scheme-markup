// Логические и глобальные сценарии в интерфейсе (таск 12 сценариев; истории
// 5.1, 5.2, 5.7, 5.11, 5.13): загрузка, правка текста, «Скачать», проверка
// текста, привязки к устройству с формой опций. Экранная половина проверяется
// живым прогоном; здесь — чистая: команды над объектом и читатели.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findLogicBinding, findScenario, logicBindingsOf, scenariosInOrder } from "../src/model.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { hubOptionsForm, hubScriptInfo, hubScriptRead } from "../src/sim/hubApi.js";
import {
  scenarioScriptAdd,
  scenarioScriptBind,
  scenarioScriptCheck,
  scenarioScriptDirty,
  scenarioScriptFaultText,
  scenarioScriptFaults,
  scenarioScriptFieldValue,
  scenarioScriptFile,
  scenarioScriptLogicOf,
  scenarioScriptNumbers,
  scenarioScriptRead,
  scenarioScriptSave,
  scenarioScriptSetActive,
  scenarioScriptSetOption,
  scenarioScriptSyntaxText,
  scenarioScriptTab,
  scenarioScriptUnbind,
  scenarioScriptWarningText,
} from "../src/panels/scenarioScript.js";
import { scenariosListRows } from "../src/panels/scenarios.js";
import { simHouse } from "./fixtures/simHome.js";

const SPRUT = new URL("./fixtures/sprut/", import.meta.url);
const sprut = (name) => readFileSync(new URL(name, SPRUT), "utf8");

// Что отдаёт имитация формам: `info` исполняется на доме объекта (как в потоке).
function formsOf(project) {
  const home = buildHomeSpec(project);
  return (bindingId, scenarioId) => {
    const scenario = findScenario(project, scenarioId);
    if (!scenario || scenario.kind !== "logic") return null;
    const probe = hubScriptInfo(scenario.source, home);
    const binding = bindingId ? findLogicBinding(project, bindingId) : null;
    return probe.info ? { scenarioId, bindingId: bindingId || null, form: hubOptionsForm(probe.info, binding ? binding.options : {}), fault: null } : { scenarioId, bindingId, form: null, fault: probe.fault };
  };
}

function loaded(project, name) {
  const parsed = scenarioScriptRead(sprut(name), name);
  assert.equal(parsed.error, undefined, name);
  return scenarioScriptAdd(project, parsed.read);
}

// ——— загрузка (5.1) ——————————————————————————————————————————————————————

test("«Загрузить JS»: .js — логический, имя из info.name; сценарий в списке со своим видом", () => {
  const box = simHouse();
  const added = loaded(box.project, "MotionLightAutomation.js");
  const scenario = findScenario(added.project, added.scenarioId);
  assert.equal(scenario.kind, "logic");
  assert.equal(scenario.origin, "js");
  assert.equal(scenario.fileName, "MotionLightAutomation.js");
  // Имя берётся из `info.name` (русская подпись сценария), а не из имени файла.
  assert.notEqual(scenario.name, "MotionLightAutomation");
  assert.match(scenario.name, /света/i);
  assert.equal(scenario.source, sprut("MotionLightAutomation.js"));
  assert.equal(scenariosInOrder(added.project).length, 1);
  const rows = scenariosListRows(added.project);
  assert.equal(rows[0].kind, "logic");
  assert.equal(rows[0].name, scenario.name);
});

test("JSON scenarioTemplate: вид из type, имя и параметры хаба — в сценарий", () => {
  const box = simHouse();
  const global = loaded(box.project, "SwitchCallbackControl.Global.json");
  const scenario = findScenario(global.project, global.scenarioId);
  assert.equal(scenario.kind, "global");
  assert.equal(scenario.origin, "json");
  const raw = JSON.parse(sprut("SwitchCallbackControl.Global.json")).scenarioTemplate;
  assert.equal(scenario.name, raw.name);
  assert.equal(scenario.active, raw.active !== false);
  assert.equal(scenario.onStart, raw.onStart === true);
});

test("блочный экспорт хаба (TEMPLATE) — отказ словами, в объект ничего не попадает", () => {
  const blocks = JSON.stringify({ scenarioTemplate: { name: "Блоки", desc: "", active: true, onStart: false, sync: false, data: "{}", type: "TEMPLATE" } });
  const parsed = scenarioScriptRead(blocks, "blocks.json");
  assert.equal(parsed.error, "Блочные сценарии хаба загружать пока нельзя");
  assert.equal(scenarioScriptRead("", "empty.js").error, "Файл пустой");
  assert.match(scenarioScriptRead('{"a": 1}', "x.json").error, /не сценарий/);
});

test("вставка текста без файла: имя берётся из info.name, а без него — «Сценарий JS»", () => {
  const box = simHouse();
  const withInfo = scenarioScriptRead('info = {name: "Свой свет", sourceServices: [HS.Lightbulb], sourceCharacteristics: [HC.On]};\nfunction trigger(){}\n', "");
  const added = scenarioScriptAdd(box.project, withInfo.read);
  assert.equal(findScenario(added.project, added.scenarioId).name, "Свой свет");
  const library = scenarioScriptRead("var answer = 42;\n", "");
  const lib = scenarioScriptAdd(box.project, library.read);
  const scenario = findScenario(lib.project, lib.scenarioId);
  assert.equal(scenario.kind, "global");
  assert.equal(scenario.name, "Сценарий JS");
});

test("«Загрузить JS» и «Вставить текст» не исполняют код в странице: имя — разбором info.name, без исполнения", () => {
  const box = simHouse();
  // Верхний уровень, который в странице дотянулся бы до `window` и пометил его.
  const escape = 'var g = ({}).constructor.constructor("return this")();\ng.scenarioScriptRanInPage = true;\n';
  delete globalThis.scenarioScriptRanInPage;
  try {
    const logic = escape + 'info = { name: "Свет без исполнения", sourceServices: [HS.Lightbulb], sourceCharacteristics: [HC.On] };\nfunction trigger(source, value) {}\n';
    const fromFile = scenarioScriptAdd(box.project, scenarioScriptRead(logic, "свет.js").read);
    assert.equal(globalThis.scenarioScriptRanInPage, undefined, "загрузка файла исполнила код сценария в странице");
    assert.equal(findScenario(fromFile.project, fromFile.scenarioId).name, "Свет без исполнения");
    const pasted = scenarioScriptAdd(box.project, scenarioScriptRead(logic, "").read);
    assert.equal(globalThis.scenarioScriptRanInPage, undefined, "вставка текста исполнила код сценария в странице");
    assert.equal(findScenario(pasted.project, pasted.scenarioId).name, "Свет без исполнения");
    // Имя, которое без исполнения не узнать, — из имени файла.
    const computed = scenarioScriptAdd(box.project, scenarioScriptRead(escape + "info = { name: makeName() };\nfunction trigger() {}\n", "Своё имя.js").read);
    assert.equal(globalThis.scenarioScriptRanInPage, undefined);
    assert.equal(findScenario(computed.project, computed.scenarioId).name, "Своё имя");
  } finally {
    delete globalThis.scenarioScriptRanInPage;
  }
});

// ——— «Скачать» и правка (5.2, 5.11) ———————————————————————————————————————

test("круг «загрузить → скачать»: .js отдаёт тот же текст, JSON — тот же data", () => {
  const box = simHouse();
  const js = loaded(box.project, "MotionLightAutomation.js");
  const fileJs = scenarioScriptFile(findScenario(js.project, js.scenarioId));
  assert.equal(fileJs.text, sprut("MotionLightAutomation.js"));
  assert.equal(fileJs.name, "MotionLightAutomation.js");
  const json = loaded(box.project, "MotionLightAutomation.json");
  const fileJson = scenarioScriptFile(findScenario(json.project, json.scenarioId));
  const back = JSON.parse(fileJson.text).scenarioTemplate;
  const was = JSON.parse(sprut("MotionLightAutomation.json")).scenarioTemplate;
  assert.equal(back.data, was.data);
  assert.equal(back.type, "LOGIC");
  assert.equal(back.name, was.name);
  assert.equal(fileJson.name, "MotionLightAutomation.json");
  // Файл хаба читается обратно тем же разбором.
  assert.equal(hubScriptRead(fileJson.text, fileJson.name).source, was.data);
});

test("скачивание после правки отдаёт текущий текст, глобальный JSON сохраняет тип GLOBAL", () => {
  const box = simHouse();
  const added = loaded(box.project, "SwitchCallbackControl.Global.json");
  const saved = scenarioScriptSave(added.project, added.scenarioId, "// правка\nvar x = 1;\n");
  assert.equal(saved.label, "правка текста сценария JS");
  const file = scenarioScriptFile(findScenario(saved.project, added.scenarioId));
  const body = JSON.parse(file.text).scenarioTemplate;
  assert.equal(body.data, "// правка\nvar x = 1;\n");
  assert.equal(body.type, "GLOBAL");
  assert.equal(scenarioScriptSave(saved.project, added.scenarioId, "// правка\nvar x = 1;\n"), null);
});

test("окно кода: «текст изменён» — набранное отличается от сохранённого; без права правки — не изменён", () => {
  const box = simHouse();
  const added = loaded(box.project, "HideIfTurnOn.js");
  const source = findScenario(added.project, added.scenarioId).source;
  assert.equal(scenarioScriptDirty(added.project, added.scenarioId, source), false, "тот же текст — закрывать молча");
  assert.equal(scenarioScriptDirty(added.project, added.scenarioId, source + "\n// правка"), true);
  assert.equal(scenarioScriptDirty(added.project, added.scenarioId, ""), true, "стёртый текст — тоже изменение");
  // Сохранили — набранное снова совпадает с объектом.
  const saved = scenarioScriptSave(added.project, added.scenarioId, source + "\n// правка");
  assert.equal(scenarioScriptDirty(saved.project, added.scenarioId, source + "\n// правка"), false);
  // Только просмотр (телефон) — правки нет, спрашивать не о чем.
  assert.equal(scenarioScriptDirty(added.project, added.scenarioId, source + "x", false), false);
  // Сценарий удалили, пока окно открыто, — набранное всё равно не пропадает молча.
  assert.equal(scenarioScriptDirty(simHouse().project, added.scenarioId, "var a = 1;"), true);
  assert.equal(scenarioScriptDirty(simHouse().project, added.scenarioId, ""), false);
});

test("синтаксическая ошибка: строка и текст, сохранить можно", () => {
  const check = scenarioScriptCheck("var a = 1;\nvar b = ;\n");
  assert.equal(check.syntax.line, 2);
  assert.match(scenarioScriptSyntaxText(check.syntax), /^Синтаксическая ошибка, строка 2: /);
  const box = simHouse();
  const added = loaded(box.project, "HideIfTurnOn.js");
  const saved = scenarioScriptSave(added.project, added.scenarioId, "var a = 1;\nvar b = ;\n");
  assert.equal(findScenario(saved.project, added.scenarioId).source, "var a = 1;\nvar b = ;\n");
  assert.equal(scenarioScriptCheck("var ok = 1;\n").syntax, null);
});

test("предупреждения совместимости с хабом — списком со строкой", () => {
  const check = scenarioScriptCheck("var a = 1;\nclass A {}\nconst f = async () => 1;\nvar o = a?.b;\nvar l = [...a];\n");
  assert.deepEqual(check.warnings.map((item) => [item.code, item.line]), [["class", 2], ["async", 3], ["optionalChain", 4], ["spread", 5]]);
  assert.match(scenarioScriptWarningText(check.warnings[0]), /^строка 2: class/);
  assert.equal(check.syntax, null);
});

test("Tab в поле кода — два пробела; на нескольких строках — отступ каждой; Shift+Tab убирает", () => {
  assert.deepEqual(scenarioScriptTab("ab", 1, 1), { value: "a  b", start: 3, end: 3 });
  const many = scenarioScriptTab("a\nb\nc", 0, 3);
  assert.equal(many.value, "  a\n  b\nc");
  const back = scenarioScriptTab(many.value, 0, many.end, true);
  assert.equal(back.value, "a\nb\nc");
  assert.equal(scenarioScriptNumbers("a\nb\nc"), "1\n2\n3");
  assert.equal(scenarioScriptNumbers(""), "1");
});

// ——— привязки к устройству (5.7) ————————————————————————————————————————

test("раздел «Логика»: только подходящие сервису сценарии; форма опций с списками устройств дома", () => {
  const box = simHouse();
  const motion = loaded(box.project, "MotionLightAutomation.js");
  const hide = loaded(motion.project, "HideIfTurnOn.js");
  const project = hide.project;
  const read = formsOf(project);
  const light = scenarioScriptLogicOf(project, box.marks.С1, read);
  assert.ok(light.available.some((item) => item.scenarioId === motion.scenarioId), "свет подходит сценарию движения");
  const entry = light.available.find((item) => item.scenarioId === motion.scenarioId);
  assert.deepEqual(entry.services.map((item) => item.index), [0]);
  // Список датчиков строит сам скрипт на доме объекта: в нём есть датчик ДД1.
  const motionField = entry.form.fields.find((field) => field.key === "motion1");
  assert.equal(motionField.formType, "list");
  assert.ok(motionField.values.length > 1);
  assert.ok(motionField.values.some((item) => /ДД1|Датчик движения/i.test(item.label)));
  // Датчик движения «Движение» сценарию света не подходит.
  const sensor = scenarioScriptLogicOf(project, box.marks.ДД1, read);
  assert.ok(!sensor.available.some((item) => item.scenarioId === motion.scenarioId));
});

test("привязка: «Добавить» с опциями, правка опции, «Активна», снять — каждое шагом истории", () => {
  const box = simHouse();
  const motion = loaded(box.project, "MotionLightAutomation.js");
  let project = motion.project;
  const bound = scenarioScriptBind(project, { scenarioId: motion.scenarioId, markId: box.marks.С1, service: 0, options: { motion1: "100.14", offDelaySeconds: 45 } });
  assert.equal(bound.label, "привязка логики");
  project = bound.project;
  assert.deepEqual(logicBindingsOf(project).map((item) => [item.markId, item.service, item.options.offDelaySeconds]), [[box.marks.С1, 0, 45]]);
  const set = scenarioScriptSetOption(project, bound.bindingId, "offDelaySeconds", 90);
  assert.equal(set.label, "опции привязки логики");
  assert.equal(findLogicBinding(set.project, bound.bindingId).options.offDelaySeconds, 90);
  assert.equal(findLogicBinding(set.project, bound.bindingId).options.motion1, "100.14", "чужие опции не тронуты");
  assert.equal(scenarioScriptSetOption(set.project, bound.bindingId, "offDelaySeconds", 90), null);
  const off = scenarioScriptSetActive(set.project, bound.bindingId, false);
  assert.equal(off.label, "активность привязки логики");
  assert.equal(findLogicBinding(off.project, bound.bindingId).active, false);
  assert.equal(scenarioScriptSetActive(off.project, bound.bindingId, false), null);
  const gone = scenarioScriptUnbind(off.project, bound.bindingId);
  assert.equal(gone.label, "снятие привязки логики");
  assert.equal(logicBindingsOf(gone.project).length, 0);
});

test("у каждой привязки свои опции; модель карточки показывает значения привязки и порядок полей скрипта", () => {
  const box = simHouse();
  const motion = loaded(box.project, "MotionLightAutomation.js");
  let project = scenarioScriptBind(motion.project, { scenarioId: motion.scenarioId, markId: box.marks.С1, service: 0, options: { offDelaySeconds: 10 } }).project;
  project = scenarioScriptBind(project, { scenarioId: motion.scenarioId, markId: box.marks.С2, service: 0, options: { offDelaySeconds: 99 } }).project;
  const read = formsOf(project);
  const first = scenarioScriptLogicOf(project, box.marks.С1, read);
  const second = scenarioScriptLogicOf(project, box.marks.С2, read);
  assert.equal(first.bindings.length, 1);
  assert.equal(first.bindings[0].fields.find((field) => field.key === "offDelaySeconds").value, 10);
  assert.equal(second.bindings[0].fields.find((field) => field.key === "offDelaySeconds").value, 99);
  assert.equal(first.bindings[0].serviceName, "Лампочка");
});

test("значения полей по типам: Boolean, Integer с границами, Double, String, список", () => {
  assert.deepEqual(scenarioScriptFieldValue({ type: "Boolean" }, true), { value: true });
  assert.deepEqual(scenarioScriptFieldValue({ type: "Integer", min: 1, max: 10 }, "7"), { value: 7 });
  assert.ok(scenarioScriptFieldValue({ type: "Integer", min: 1, max: 10 }, "11").error);
  assert.ok(scenarioScriptFieldValue({ type: "Integer" }, "1.5").error);
  assert.deepEqual(scenarioScriptFieldValue({ type: "Double", min: 0, max: 1 }, "0,5"), { value: 0.5 });
  assert.ok(scenarioScriptFieldValue({ type: "Double" }, "abc").error);
  assert.deepEqual(scenarioScriptFieldValue({ type: "String", maxLength: 3 }, "abcdef"), { value: "abc" });
  assert.deepEqual(scenarioScriptFieldValue({ type: "String", formType: "list", values: [{ value: "" }, { value: "uuid-1" }] }, "1"), { value: "uuid-1" });
});

// ——— ошибка и зависание видны (5.4, 5.10) ————————————————————————————

test("зависший сценарий в списке: «остановлен: завис», показан выключенным", () => {
  const box = simHouse();
  const motion = loaded(box.project, "MotionLightAutomation.js");
  const faults = new Map([[motion.scenarioId, { code: "hung", line: null, message: "" }]]);
  const [row] = scenariosListRows(motion.project, {}, null, faults);
  assert.equal(row.fault, "остановлен: завис");
  assert.equal(row.hung, true);
  assert.equal(row.active, false);
  const [clean] = scenariosListRows(motion.project);
  assert.equal(clean.fault, null);
  assert.equal(clean.active, true);
  assert.equal(scenarioScriptFaultText({ code: "syntax", line: 4 }, "list"), "ошибка в строке 4");
  assert.equal(scenarioScriptFaultText({ code: "hung" }, "card"), "остановлен: завис");
  assert.equal(scenarioScriptFaultText(null), null);
});

test("зависла одна привязка — сценарий в списке тоже «остановлен: завис»; зависший целиком — от имитации", () => {
  const box = simHouse();
  const motion = loaded(box.project, "MotionLightAutomation.js");
  const hide = loaded(motion.project, "HideIfTurnOn.js");
  const bound = scenarioScriptBind(hide.project, { scenarioId: motion.scenarioId, markId: box.marks.С1, service: 0 });
  const hung = { code: "hung", line: null, message: "" };
  const source = {
    scenarios: () => [{ id: hide.scenarioId, active: false, running: false, fault: hung }],
    forms: (bindingId) => ({ fault: bindingId === bound.bindingId ? hung : null }),
  };
  const faults = scenarioScriptFaults(bound.project, source);
  assert.deepEqual([...faults.keys()].sort(), [hide.scenarioId, motion.scenarioId].sort());
  const rows = scenariosListRows(bound.project, {}, null, faults);
  assert.deepEqual(rows.map((row) => row.fault), ["остановлен: завис", "остановлен: завис"]);
  assert.equal(scenarioScriptFaults(bound.project, { scenarios: () => [], forms: () => ({ fault: null }) }).size, 0);
});

test("логика по сервисам: у двухклавишного выключателя свой раздел на каждый «Выключатель», привязка — в разделе своего сервиса", () => {
  // Правка после сборки сценариев: «если у аксессуара несколько сервисов,
  // логика привязывается к каждому отдельно».
  const box = simHouse();
  const motion = loaded(box.project, "MotionLightAutomation.js");
  const read = formsOf(motion.project);
  const duo = scenarioScriptLogicOf(motion.project, box.marks.ВВ1, read);
  assert.deepEqual(duo.services.map((item) => [item.index, item.name]), [[0, "Выключатель 1"], [1, "Выключатель 2"]]);
  const bound = scenarioScriptBind(motion.project, { scenarioId: motion.scenarioId, markId: box.marks.ВВ1, service: 1, options: {} }).project;
  const after = scenarioScriptLogicOf(bound, box.marks.ВВ1, formsOf(bound));
  assert.deepEqual(after.bindings.map((item) => item.service), [1]);
  assert.deepEqual(after.services.map((item) => item.index), [0, 1], "привязка увела раздел или добавила лишний");
  // У лампы сервис один — раздел один, без заголовка сервиса.
  assert.equal(scenarioScriptLogicOf(motion.project, box.marks.С1, read).services.length, 1);
});
