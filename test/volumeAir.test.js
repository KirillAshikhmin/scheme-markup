// Окошко климата у полосы часов (правка после сборки сценариев).
//
// Слова заказчика: «при тапе на плашке с текущей температурой, влажностью и
// co2 открывай небольшое окошко с ползунками этих 3 характеристик».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { strings } from "../src/strings.js";
import { volumeAirLine } from "../src/panels/volumeParams.js";
import {
  VOLUME_AIR_RANGES,
  VOLUME_AIR_SETTLE_MS,
  createVolumeAir,
  volumeAirPlacement,
  volumeAirRows,
  volumeAirSaid,
  volumeAirValueText,
} from "../src/panels/volumeAir.js";

const VOLUME_CSS = readFileSync(new URL("../src/panels/volume.css", import.meta.url), "utf8");

// Своя маленькая страница: окошко собирается из `document.createElement`.
function fakeDocument() {
  class FakeNode {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.className = "";
      this.textContent = "";
      this.title = "";
      this.hidden = false;
      this.value = "";
      this.style = {};
    }
    get classList() {
      const names = () => this.className.split(/\s+/).filter(Boolean);
      return { contains: (name) => names().includes(name) };
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "hidden") this.hidden = true;
      if (name === "class") this.className = String(value);
    }
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    fire(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, stopped: false, ...extra };
      event.preventDefault = () => (event.defaultPrevented = true);
      event.stopPropagation = () => (event.stopped = true);
      for (const fn of this.listeners[type] || []) fn(event);
      return event;
    }
    click() {
      return this.fire("click");
    }
    focus() {
      fakeDocument.focused = this;
    }
    append(...nodes) {
      for (const node of nodes) if (node !== null && node !== undefined) this.children.push(node);
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
  }
  return {
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (ns, tag) => new FakeNode(tag),
    activeElement: null,
  };
}

function nodesOf(root) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (typeof child !== "object") continue;
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}
const withClass = (root, name) => nodesOf(root).filter((node) => node.classList.contains(name));

// Правило с одним этим селектором: в общем правиле `.a,\n.b {` строка `.b {`
// стоит после запятой, и его не берём.
function ruleBody(css, selector) {
  let at = -1;
  for (let from = 0; ; from = at + 1) {
    at = css.indexOf("\n" + selector + " {", from);
    if (at < 0 || !css.slice(0, at).trimEnd().endsWith(",")) break;
  }
  assert.ok(at >= 0, "нет правила " + selector);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}
const prop = (body, name) => (body.match(new RegExp("(?:^|[;\\s])" + name + ":\\s*([^;]+);")) || [])[1];

const kitchen = { kind: "room", roomId: "r1", name: "Кухня", t: 22.4, rh: 45, co2: 650 };

function mount() {
  globalThis.document = fakeDocument();
  const calls = { room: [], street: [], placed: 0, clock: [] };
  let clock = 1000;
  let minutes = 12 * 60;
  const air = createVolumeAir({
    setRoom: (roomId, patch) => calls.room.push({ roomId, patch }),
    setStreet: (patch) => calls.street.push(patch),
    placed: () => (calls.placed += 1),
    now: () => clock,
    clock: {
      minutes: () => minutes,
      set: (value) => calls.clock.push(["set", value]),
      now: () => calls.clock.push(["now"]),
      // 27 октября 2026 года — номер дня от 1970-01-01.
      day: () => 20753,
      setDay: (value) => calls.clock.push(["day", value]),
    },
  });
  return { air, calls, tick: (ms) => (clock += ms), setMinutes: (value) => (minutes = value) };
}

test("ряды: у помещения температура, влажность и CO₂, у улицы — температура и влажность", () => {
  const rows = volumeAirRows(kitchen);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["t", "rh", "co2"],
  );
  assert.deepEqual(
    rows.map((row) => row.label),
    [strings.volume.climateTemp, strings.volume.climateHumidity, strings.volume.climateCo2],
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["+22,4 °C", "45 %", "650 ppm"],
  );
  assert.deepEqual(
    rows.map((row) => [row.min, row.max, row.step]),
    [
      [VOLUME_AIR_RANGES.t.min, VOLUME_AIR_RANGES.t.max, 0.5],
      [0, 100, 1],
      [400, 5000, 10],
    ],
  );
  const street = volumeAirRows({ kind: "street", tempC: -6.2, humidity: 84 });
  assert.deepEqual(
    street.map((row) => [row.key, row.text]),
    [
      ["tempC", "−6,2 °C"],
      ["humidity", "84 %"],
    ],
  );
  assert.deepEqual(volumeAirRows(null), []);
  // Холодная кладовка зимой: предел ползунка раздвигается до значения, иначе
  // ползунок стоял бы на нуле, а под ним было бы написано «−8».
  const cold = volumeAirRows({ ...kitchen, t: -7.6 })[0];
  assert.equal(cold.min, -8);
  assert.equal(cold.max, VOLUME_AIR_RANGES.t.max);
  assert.equal(volumeAirValueText("co2", undefined), "—");
});

test("строка на плашке — та же, что была: у помещения с CO₂, у улицы без", () => {
  assert.equal(volumeAirSaid(kitchen), volumeAirLine(22.4, 45, 650));
  assert.equal(volumeAirSaid({ kind: "street", tempC: 6, humidity: 80 }), volumeAirLine(6, 80, null));
  assert.equal(volumeAirSaid(null), "");
});

test("тап по строке климата открывает окошко с тремя ползунками; ползунок пишет помещению", () => {
  const { air, calls, tick } = mount();
  air.sync(kitchen);
  assert.equal(air.line.tagName, "BUTTON", "строка климата не кнопка");
  assert.equal(air.line.hidden, false);
  assert.equal(air.line.textContent, volumeAirLine(22.4, 45, 650));
  assert.equal(air.box.hidden, true, "окошко открыто без тапа");
  air.line.click();
  assert.equal(air.isOpen(), true);
  assert.equal(air.box.hidden, false);
  assert.equal(air.line.getAttribute("aria-expanded"), "true");
  assert.equal(withClass(air.box, "volume__airTitle")[0].textContent, "Кухня");
  const sliders = withClass(air.box, "volume__airSlider");
  assert.equal(sliders.length, 3, "ползунков не три");
  assert.ok(sliders.every((slider) => slider.type === "range"));
  assert.deepEqual(
    sliders.map((slider) => slider.value),
    ["22.4", "45", "650"],
  );
  assert.ok(calls.placed > 0, "поле не спросили, сколько места над полосой");
  // Ведут ползунок CO₂: значение под ним меняется сразу, дому уходит по отпусканию.
  const [temp, , co2] = sliders;
  const co2Value = withClass(air.box, "volume__airValue")[2];
  co2.value = "1200";
  co2.fire("input");
  assert.equal(co2Value.textContent, "1200 ppm");
  assert.equal(calls.room.length, 0);
  // Пока ведут, живое значение ползунок не переписывает.
  air.sync({ ...kitchen, co2: 660 });
  assert.equal(co2.value, "1200", "живое значение переписало ползунок под пальцем");
  co2.fire("change");
  assert.deepEqual(calls.room, [{ roomId: "r1", patch: { co2: 1200 } }]);
  // Только что отпущенный ждёт ответа дома, а не прыгает назад на кадр.
  air.sync({ ...kitchen, co2: 660 });
  assert.equal(co2.value, "1200");
  tick(VOLUME_AIR_SETTLE_MS + 1);
  air.sync({ ...kitchen, co2: 1190, t: 23 });
  assert.equal(co2.value, "1190", "ползунок не пошёл за домом");
  assert.equal(temp.value, "23");
  // Повторный тап по строке закрывает окошко.
  air.line.click();
  assert.equal(air.isOpen(), false);
  assert.equal(air.box.hidden, true);
  assert.equal(air.line.getAttribute("aria-expanded"), "false");
});

test("окошко идёт за человеком: другое помещение — его ползунки, ушёл в обзор — окошко закрылось", () => {
  const { air } = mount();
  air.sync(kitchen);
  air.open();
  air.sync({ kind: "room", roomId: "r2", name: "", t: 19, rh: 50, co2: 500 });
  assert.equal(withClass(air.box, "volume__airTitle")[0].textContent, strings.volume.climateRoomUnnamed);
  assert.equal(withClass(air.box, "volume__airSlider")[0].value, "19");
  // Ушёл в обзор: климата нет, а время осталось — окошко про одно время.
  air.sync(null);
  assert.equal(air.isOpen(), true, "ушёл в обзор — время закрылось вместе с климатом");
  assert.equal(air.line.hidden, true);
  assert.equal(withClass(air.box, "volume__airSlider").length, 0, "ползунки климата без климата");
  assert.equal(withClass(air.box, "volume__airTitle")[0].textContent, strings.volume.airTime);
});

test("строка часов открывает то же окошко; ряд часов — поле времени и «Сейчас» (правка 2026-10-27)", () => {
  const { air, calls, setMinutes } = mount();
  air.sync(null);
  assert.equal(air.timeLine.tagName, "BUTTON", "строка часов не кнопка");
  air.timeLine.click();
  assert.equal(air.isOpen(), true, "строка часов не открыла окошко без климата");
  assert.equal(air.timeLine.getAttribute("aria-expanded"), "true");
  const [field] = withClass(air.box, "volume__airTime");
  assert.equal(field.type, "time");
  assert.equal(field.value, "12:00");
  // Время идёт — поле за ним, пока его не держат фокусом.
  setMinutes(12 * 60 + 5);
  air.sync(null);
  assert.equal(field.value, "12:05");
  document.activeElement = field;
  setMinutes(12 * 60 + 6);
  air.sync(null);
  assert.equal(field.value, "12:05", "живое время переписало поле под набором");
  // Набор с клавиатуры: «3», затем «5» — применяется по уходу из поля, а не на
  // первую цифру (`uiTimeApply`).
  field.fire("keydown", { key: "3" });
  field.value = "12:03";
  field.fire("change");
  assert.deepEqual(calls.clock, [], "первая цифра уже перевела часы");
  field.fire("keydown", { key: "5" });
  field.value = "12:35";
  field.fire("change");
  field.fire("blur");
  assert.deepEqual(calls.clock, [["set", 12 * 60 + 35]]);
  // Колесо телефона: клавиш нет — сразу.
  field.value = "07:10";
  field.fire("change");
  assert.deepEqual(calls.clock[1], ["set", 7 * 60 + 10]);
  withClass(air.box, "volume__airNow")[0].click();
  assert.deepEqual(calls.clock[2], ["now"]);
  // Дата — второй строкой («добей мелочи»): поле даты, по уходу — новый день.
  document.activeElement = null;
  air.sync(null);
  const [date] = withClass(air.box, "volume__airDate");
  assert.equal(date.type, "date");
  assert.equal(date.value, "2026-10-27");
  date.fire("keydown", { key: "1" });
  date.value = "2026-12-31";
  date.fire("blur");
  assert.equal(calls.clock[3][0], "day");
  assert.equal(calls.clock[3][1], 20753 + 65, "день не тот");
  // С климатом ряд часов стоит над ползунками.
  document.activeElement = null;
  air.sync(kitchen);
  assert.equal(withClass(air.box, "volume__airSlider").length, 3);
  assert.equal(withClass(air.box, "volume__airTime").length, 1);
  air.timeLine.click();
  assert.equal(air.isOpen(), false, "повторный тап по часам не закрыл окошко");
});

test("на улице два ползунка — ручные значения погоды; «Как по погоде» только при своих значениях", () => {
  const { air, calls } = mount();
  const street = { kind: "street", tempC: 6.2, humidity: 84, manualTemp: false, manualHumidity: false };
  air.sync(street);
  air.line.click();
  assert.equal(withClass(air.box, "volume__airTitle")[0].textContent, strings.volume.airStreet);
  const sliders = withClass(air.box, "volume__airSlider");
  assert.equal(sliders.length, 2);
  const auto = withClass(air.box, "volume__airAuto")[0];
  assert.equal(auto.hidden, true, "«Как по погоде» при погоде без своих значений");
  sliders[0].value = "-3";
  sliders[0].fire("input");
  sliders[0].fire("change");
  assert.deepEqual(calls.street, [{ tempC: -3 }]);
  assert.equal(calls.room.length, 0);
  air.sync({ ...street, tempC: -3, manualTemp: true });
  assert.equal(auto.hidden, false, "своё значение есть, а дороги к погоде нет");
  auto.click();
  assert.deepEqual(calls.street[1], { tempC: null, humidity: null });
});

test("Esc в окошке закрывает его и возвращает фокус строке; крестик — тоже", () => {
  const { air } = mount();
  air.sync(kitchen);
  air.open();
  const event = air.box.fire("keydown", { key: "Escape" });
  assert.equal(air.isOpen(), false);
  assert.ok(event.stopped, "Esc ушёл дальше — закрыл бы окно объёма");
  assert.equal(fakeDocument.focused, air.line, "фокус не вернулся строке");
  air.open();
  withClass(air.box, "volume__airClose")[0].click();
  assert.equal(air.isOpen(), false);
});

test("место окошка: над полосой, а где тесно — слева от неё и не выше поля", () => {
  const field = { top: 52, bottom: 338 };
  // Мышью полоса в самом углу: над ней всё поле.
  assert.deepEqual(volumeAirPlacement(field, { top: 290, bottom: 326 }, 200), { side: false, top: null, maxHeight: null });
  // Лежачий телефон пальцем: полоса поднята над кнопками, над ней 94 точки.
  const side = volumeAirPlacement(field, { top: 146, bottom: 182 }, 200);
  assert.equal(side.side, true);
  assert.equal(side.maxHeight, null, "в поле окошко помещается — прокрутки не нужно");
  const top = 146 + side.top;
  assert.ok(top >= field.top + 8, "окошко вылезло за верх поля: " + top);
  assert.ok(top + 200 <= field.bottom - 8, "окошко вылезло за низ поля");
  // Совсем низкое поле — окошко во всю его высоту и с прокруткой.
  const low = volumeAirPlacement({ top: 0, bottom: 150 }, { top: 60, bottom: 96 }, 200);
  assert.deepEqual(low, { side: true, top: -52, maxHeight: 134 });
  // Слой над кнопками угла: окошко открыли руками.
  assert.ok(Number(prop(ruleBody(VOLUME_CSS, ".volume__airBox"), "z-index")) > 6);
});

test("стили: полоса часов кликов по-прежнему не берёт, строка климата и окошко — берут", () => {
  assert.equal(prop(ruleBody(VOLUME_CSS, ".volume__clock"), "pointer-events"), "none");
  assert.equal(prop(ruleBody(VOLUME_CSS, ".volume__clockAir"), "pointer-events"), "auto");
  assert.equal(prop(ruleBody(VOLUME_CSS, ".volume__clockTime"), "pointer-events"), "auto");
  const box = ruleBody(VOLUME_CSS, ".volume__airBox");
  assert.equal(prop(box, "pointer-events"), "auto");
  assert.equal(prop(box, "white-space"), "normal", "окошко унаследовало «не переносить строк» полосы");
  assert.equal(prop(box, "overflow-y"), "auto", "в тесноте ряды окошка не прокручиваются");
  for (const key of ["airOpen", "airOpenStreet", "airTitle", "airClose", "airStreet", "airAuto", "airAutoHint"]) {
    assert.ok(strings.volume[key], "нет строки " + key);
  }
});
