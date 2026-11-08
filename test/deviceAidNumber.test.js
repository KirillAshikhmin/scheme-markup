// Адрес аксессуара — номер метки (таск 04 сборки «связь метки и вещи»;
// истории 24 и 28, G10 и G12; `interfaces.md`, раздел 7), и **своей двери у
// него нет** (таск 251, требование G392).
//
// Раньше `aid` был хэшем FNV-1a от `mark.id` в девятизначном диапазоне, а
// совпадения разводились пробой по порядку id. Идентификатор сущности стал
// коротким номером, и адрес стал читаться прямо из него: разводить нечего, а
// адреса стали читаться как в настоящем хабе (`118.13.14`). Следом ушли и две
// двери, `deviceAid`/`deviceAids`, — слова заказчика: «Он же не нужен теперь
// можно использовать идентификатор», «убирай».
//
// **Ушли имена, а не правило**, и проверяется здесь именно правило: id, который
// не десятичная строка (uuid прежней разметки, встроенный ключ справочника,
// мусор), адреса не имеет, и аксессуара у такой метки нет. Держит его
// `model.idNumberOf` — голый `Number(mark.id)` не годится: он принял бы `17`
// там, где идентификатором считается только `"17"` (D01, ADR 035), и два
// аксессуара одного адреса хаб молча потерял бы (`byAid` в `hubApi`).
// Нумерация сервисов и характеристик внутри аксессуара не менялась — она идёт
// с 13, как в Sprut (ADR 012).
//
// Цена названа в спецификации и принята заказчиком: адрес, вписанный числом в
// опцию привязки или в текст сценария, после перенумерации указывает в
// пустоту. Последний тест держит именно это: дом идёт, соседний сценарий
// работает, а ненайденный адрес назван в журнале своим кодом.
import test from "node:test";
import assert from "node:assert/strict";

import { idNumberOf } from "../src/model.js";
import { buildHomeSpec, homeAccessories, markAccessory } from "../src/sim/home.js";
import { text } from "../src/strings.js";
import { simHouse } from "./fixtures/simHome.js";
import { hubHome } from "./fixtures/sprut/hubHome.js";

// ——— адрес = номер ———————————————————————————————————————————————————

test("адрес аксессуара — сам номер метки, а не хэш от uuid", () => {
  // Ожидание берётся из объекта (`mark.id`), а не из кода под тестом.
  const box = simHouse();
  const accessories = homeAccessories(box.project);
  assert.ok(accessories.length >= 15, "дом-фикстура обязан нести устройства");
  for (const item of accessories) {
    assert.equal(String(item.aid), item.markId, "адрес не равен номеру метки " + item.markId);
    assert.ok(Number.isInteger(item.aid) && item.aid > 0, "адрес не целое число: " + String(item.aid));
  }
  // Девятизначных адресов больше нет: номера объекта-фикстуры — трёхзначные.
  assert.ok(Math.max(...accessories.map((item) => item.aid)) < 1000, "адрес вне номеров объекта");
  assert.equal(idNumberOf("17"), 17);
  // Число адреса не даёт вовсе: id в объекте — десятичная строка и ничто
  // другое (D01). Прими здесь и число — `17` с `"17"` дали бы один адрес, а
  // второй аксессуар того же адреса хаб молча потерял бы.
  assert.equal(idNumberOf(17), null);
});

test("метка без номера адреса не имеет, и аксессуара у неё нет", () => {
  for (const id of ["", "0017", "17px", "comment", crypto.randomUUID()]) {
    assert.equal(idNumberOf(id), null, "номером принят " + JSON.stringify(id));
  }
  const box = simHouse();
  const legacy = box.marks["С1"];
  const project = { ...box.project, marks: box.project.marks.map((mark) => (mark.id === legacy ? { ...mark, id: "ламп-1" } : mark)) };
  assert.equal(markAccessory(project, "ламп-1"), null, "у метки без номера завёлся аксессуар");
  // Дом такую метку не считает устройством — то, что прежде говорила карта
  // адресов: аксессуара в доме нет ни одного на этот id.
  assert.equal(
    buildHomeSpec(project).accessories.some((item) => item.markId === "ламп-1"),
    false,
    "метка без номера попала в дом аксессуаром",
  );
  // Остальной дом от этого не теряется.
  assert.equal(homeAccessories(project).length, homeAccessories(box.project).length - 1);
});

test("адреса меток объекта различны и равны их номерам", () => {
  const box = simHouse();
  const aids = box.project.marks.map((mark) => [mark.id, idNumberOf(mark.id)]);
  assert.equal(aids.length, box.project.marks.length, "сверка пропустила метки");
  assert.deepStrictEqual(aids, box.project.marks.map((mark) => [mark.id, Number(mark.id)]));
  assert.equal(new Set(aids.map(([, aid]) => aid)).size, aids.length, "два адреса совпали");
  assert.deepEqual(aids.filter(([, aid]) => aid === null), [], "у метки объекта нет адреса");
});

// ——— сервисы и характеристики не тронуты ————————————————————————————

test("sid и cid внутри аксессуара идут подряд с 13, как в хабе", () => {
  const box = simHouse();
  // Двухклавишный выключатель (G11): «Выключатель» на канал, затем кнопки.
  const accessory = markAccessory(box.project, box.marks["ВВ1"]);
  assert.deepStrictEqual(
    accessory.services.map((service) => [service.sid, service.chars.map((char) => char.cid)]),
    [
      [13, [14]],
      [15, [16]],
      [17, [18, 19]],
      [20, [21, 22]],
    ],
  );
  const aid = accessory.aid;
  assert.equal(accessory.services[0].address, aid + ".13");
  assert.equal(accessory.services[0].chars[0].address, aid + ".13.14");
  assert.equal(accessory.services[3].chars[1].address, aid + ".20.22");
  // Адрес читается как в хабе: три числа через точку, первое — номер метки.
  assert.match(accessory.services[0].chars[0].address, /^[1-9][0-9]*\.13\.14$/);
});

// ——— дом на номерах идёт ————————————————————————————————————————————

test("дом на номерах собирается и идёт: адреса в доме — номера меток, значения ходят", () => {
  const home = hubHome();
  const spec = buildHomeSpec(home.box.project);
  assert.deepStrictEqual(
    spec.accessories.map((item) => [item.markId, item.aid]),
    spec.accessories.map((item) => [item.markId, Number(item.markId)]),
  );
  assert.equal(home.value("С1", "On"), false);
  home.set("С1", "On", true);
  assert.equal(home.value("С1", "On"), true);
  const changes = home.log("change");
  assert.ok(changes.length >= 1, "в журнале нет записи о смене значения");
  assert.deepEqual(home.log("hubError"), []);
});

// ——— цена перенумерации (G12) ———————————————————————————————————————

// Привязка хранит адрес строкой `"aid.sid"` (ADR 012), и в объектах заказчика
// такие строки стоят в опциях привязок: сценарий разбирает их `split('.')` и
// спрашивает у хаба устройство. Это и есть место, где перенумерация стоит
// заказчику сломанного сценария.
const ADDRESS_SCRIPT = [
  "info = {",
  '  name: "Чужой адрес",',
  "  sourceServices: [HS.Lightbulb],",
  "  sourceCharacteristics: [HC.On],",
  '  options: { target: { type: "String", value: "" } },',
  "  variables: {}",
  "};",
  "function trigger(source, value, variables, options, context) {",
  "  var parts = String(options.target).split('.');",
  "  var accessory = Hub.getAccessory(parts[0]);",
  "  accessory.getService(parts[1]).getCharacteristic(HC.On).setValue(value);",
  "}",
].join("\n");

test("сценарий с прежним адресом: журнал называет адрес своим кодом, дом идёт, сосед работает", () => {
  const box = simHouse();
  // Девятизначное число — адрес прежней сборки (хэш от uuid): такого
  // устройства в доме нет и быть не может.
  const stale = "884254140.13";
  const live = box.marks["С3"] + ".13";
  const home = hubHome({
    box,
    scripts: [{ key: "addr", name: "Чужой адрес", source: ADDRESS_SCRIPT }],
    bindings: [
      { key: "stale", script: "addr", mark: "С1", options: { target: stale } },
      { key: "live", script: "addr", mark: "С2", options: { target: live } },
    ],
  });

  // Прежний адрес: сперва журнал называет **адрес**, которого в доме нет, —
  // по одной записи об ошибке на строке заказчик не понял бы, что починить.
  home.set("С1", "On", true);
  const missing = home.log("hubAddressMissing");
  assert.equal(missing.length, 1, "ненайденный адрес не назван своим кодом");
  assert.equal(missing[0].kind, "error");
  assert.equal(missing[0].scenarioId, home.scenarios.addr);
  assert.equal(missing[0].bindingId, home.bound.stale);
  assert.equal(missing[0].vars.address, "884254140", "в записи нет адреса, которого не нашли");
  assert.equal(missing[0].vars.name, "Чужой адрес");
  assert.ok(text("sim.journal.hubAddressMissing", missing[0].vars).includes("884254140"), "адрес не подставился в строку");

  // И только потом — падение сценария на этом же месте; падает он один.
  const errors = home.log("hubError");
  assert.equal(errors.length, 1, "сценарий, не нашедший устройство, не записал ошибку");
  assert.equal(errors[0].kind, "error");
  assert.equal(errors[0].scenarioId, home.scenarios.addr);
  assert.equal(errors[0].bindingId, home.bound.stale);
  assert.equal(errors[0].vars.where, "trigger");
  assert.equal(errors[0].vars.name, "Чужой адрес");
  assert.equal(errors[0].vars.line, ADDRESS_SCRIPT.split("\n").findIndex((line) => line.includes("getService")) + 1);
  assert.match(errors[0].vars.message, /null/);

  // Дом идёт: та же привязка с новым адресом делает своё дело.
  home.set("С2", "On", true);
  assert.equal(home.value("С3", "On"), true, "сценарий с живым адресом не сработал");
  assert.equal(home.log("hubError").length, 1, "сломался и второй сценарий");
  assert.equal(home.log("hubAddressMissing").length, 1, "живой адрес назван ненайденным");
  assert.equal(home.value("С1", "On"), true, "дом потерял значение после ошибки сценария");
});

// Запись значения по адресу исключения не бросает вовсе: нет устройства —
// `Hub.setCharacteristicValue` просто ничего не делает. Такая потеря была бы
// полной тишиной — ни ошибки, ни следа, — и заказчик не узнал бы о ней никогда.
const WRITE_SCRIPT = [
  "info = {",
  '  name: "Запись по адресу",',
  "  sourceServices: [HS.Lightbulb],",
  "  sourceCharacteristics: [HC.On],",
  '  options: { target: { type: "String", value: "" } },',
  "  variables: {}",
  "};",
  "function trigger(source, value, variables, options, context) {",
  "  var parts = String(options.target).split('.');",
  "  Hub.setCharacteristicValue(parts[0], parts[1], value);",
  "}",
].join("\n");

test("запись по прежнему адресу не молчит: журнал называет адрес, исключения нет, дом идёт", () => {
  const box = simHouse();
  const live = box.marks["С3"] + ".14";
  const home = hubHome({
    box,
    scripts: [{ key: "write", name: "Запись по адресу", source: WRITE_SCRIPT }],
    bindings: [
      { key: "stale", script: "write", mark: "С1", options: { target: "884254140.15" } },
      { key: "live", script: "write", mark: "С2", options: { target: live } },
    ],
  });

  home.set("С1", "On", true);
  const missing = home.log("hubAddressMissing");
  assert.equal(missing.length, 1, "немое падение записи: в журнале ни слова");
  assert.equal(missing[0].vars.address, "884254140.15", "в записи нет адреса характеристики");
  assert.deepEqual(home.log("hubError"), [], "запись по чужому адресу бросила исключение");

  home.set("С2", "On", true);
  assert.equal(home.value("С3", "On"), true, "запись по живому адресу не дошла");
  assert.equal(home.log("hubAddressMissing").length, 1, "живой адрес назван ненайденным");
});
