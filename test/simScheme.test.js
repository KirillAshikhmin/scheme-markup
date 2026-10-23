// Имитация в «Схеме» (таск 08 сценариев; истории 2.1, 2.4–2.7, 2.10, 2.11,
// 3.1–3.3, 3.6, 2.19).
//
// Что держит этот файл:
//   1. **Кадр без имитации прежний вызов в вызов** (G68, образец
//      `doors.test.js:329`): `drawScheme` без `live` — те же 915 вызовов холста,
//      что до таска (отпечаток снят на прежнем коде); пустая карта `live` — тоже.
//      Выгрузки (PNG, лист ГОСТ, печать) аргумент не передают вовсе.
//   2. **Состояние на метках**: ореол по яркости, пульс датчика, знаки штор,
//      телевизора и розетки, вспышка нажатия — только когда метке есть что
//      показать.
//   3. **Дверь правки закрыта** запущенным домом (`canvasEditAllowed`), и
//      подсказка говорит почему; щелчок по устройству до объекта не доходит.
//   4. **Полоса**: шаги, «К следующему событию», клавиши P/N/E и их молчание
//      в диалоге и поле, список «Выполнить команду».
//   5. **Проводка каркаса**: `simSync` на каждую смену объекта, отметка
//      `simRunning`, места монтирования.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addScenario } from "../src/model.js";
import { PANEL_IDS } from "../src/app.js";
import {
  canvasEditAllowed,
  canvasHintText,
  canvasSimLocked,
  canvasTapAction,
} from "../src/canvas.js";
import {
  SIM_LIVE_ALERT_COLOR,
  SIM_LIVE_FLASH_MS,
  SIM_LIVE_KINDS,
  SIM_LIVE_PULSE_MS,
  drawScheme,
  simLiveFrame,
  simLiveKindOf,
  simLiveMemo,
} from "../src/render.js";
import { markAccessory } from "../src/sim/home.js";
import { strings } from "../src/strings.js";
import {
  SIM_BAR_STEPS,
  simBarClockText,
  simBarCommandItems,
  simBarKeyAction,
  simBarState,
} from "../src/panels/simBar.js";
import { simHouse } from "./fixtures/simHome.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

// ——— кадр без имитации ———————————————————————————————————————————————

function scribe(log) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "canvas") return { width: 800, height: 600 };
        if (key === "measureText") return (value) => ({ width: String(value).length * 6 });
        if (key === "createRadialGradient") {
          return (...args) => {
            log.push("createRadialGradient(" + args.map(round).join(",") + ")");
            return { addColorStop: (at, color) => log.push("addColorStop(" + at + "," + color + ")") };
          };
        }
        return (...args) => log.push(key + "(" + args.map(round).join(",") + ")");
      },
      set(_target, key, value) {
        log.push(key + "=" + round(value));
        return true;
      },
    },
  );
}

function round(value) {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  return typeof value === "object" && value ? "[obj]" : String(value);
}

const box = simHouse();
const scheme = box.project.schemes[0];
const VIEW = { zoom: 1, offsetX: 0, offsetY: 0 };

function frame(extra = {}) {
  const log = [];
  drawScheme(scribe(log), { project: box.project, scheme, view: VIEW, filter: undefined, selectedIds: [], links: true, ...extra });
  return log;
}

// Отпечаток кадра дома-фикстуры, снятый на `render.js` до этого таска: число
// вызовов холста и sha1 всей ленты. Менять его нельзя — кадр прежнего объекта
// меняется только по слову заказчика (G68).
const FRAME_BEFORE = { calls: 915, sha1: "f12fe8de96d6f85e2279de2cbbac111500f5171e" };

const fingerprint = (log) => ({ calls: log.length, sha1: createHash("sha1").update(log.join("\n")).digest("hex") });

test("G68: кадр без имитации — те же вызовы холста, что до таска, вызов в вызов", () => {
  assert.deepEqual(fingerprint(frame()), FRAME_BEFORE);
});

test("G68: пустая карта состояний и `live: null` не добавляют ни одного вызова", () => {
  assert.deepEqual(fingerprint(frame({ live: null, liveFx: null })), FRAME_BEFORE);
  assert.deepEqual(fingerprint(frame({ live: new Map(), liveFx: { pulse: 0, flash: new Map() } })), FRAME_BEFORE);
});

test("выгрузки не получают состояния дома: ни PNG, ни лист ГОСТ не знают аргумента `live`", () => {
  for (const file of ["src/exporter.js", "src/gostSheet.js", "src/tables.js"]) {
    assert.ok(!/\blive\s*[:,]/.test(read(file)), file + " передаёт состояние дома — выгрузка изменится");
  }
});

// ——— состояние на метках ———————————————————————————————————————————

const idOf = (label) => box.marks[label];
const state = (kind, patch = {}) => ({ on: false, level: 0, alert: false, open: 0, pressedAt: null, kind, ...patch });
const count = (log, prefix) => log.filter((call) => call.startsWith(prefix)).length;
const BASE = frame();

test("включённый свет — ореол: один радиальный градиент на лампу, чем ярче, тем шире", () => {
  const dim = frame({ live: new Map([[idOf("С1"), state("light", { on: true, level: 0.2 })]]), liveFx: { pulse: 0, flash: new Map() } });
  const bright = frame({ live: new Map([[idOf("С1"), state("light", { on: true, level: 1 })]]), liveFx: { pulse: 0, flash: new Map() } });
  assert.equal(count(BASE, "createRadialGradient("), 0);
  assert.equal(count(dim, "createRadialGradient("), 1);
  assert.equal(count(bright, "createRadialGradient("), 1);
  const reach = (log) => Number(log.find((call) => call.startsWith("createRadialGradient(")).slice(0, -1).split(",").pop());
  assert.ok(reach(bright) > reach(dim), "ореол яркого света не шире тусклого");
  const alpha = (log) => log.find((call) => call.startsWith("addColorStop(0,")).match(/, ([\d.]+)\)/)[1];
  assert.ok(Number(alpha(bright)) > Number(alpha(dim)), "ореол яркого света не плотнее");
});

test("выключенный свет и свет с нулевой яркостью без `on` — без ореола", () => {
  const off = frame({ live: new Map([[idOf("С1"), state("light")]]), liveFx: { pulse: 0, flash: new Map() } });
  assert.deepEqual(fingerprint(off), FRAME_BEFORE);
});

test("сработавший датчик — красное кольцо и волна; фаза пульса двигает волну", () => {
  const at = (pulse) => frame({ live: new Map([[idOf("ДД1"), state("other", { alert: true })]]), liveFx: { pulse, flash: new Map() } });
  const early = at(0);
  const late = at(0.9);
  assert.ok(early.includes("strokeStyle=" + SIM_LIVE_ALERT_COLOR));
  assert.equal(count(early, "arc(") - count(BASE, "arc("), 2, "кольцо и волна");
  assert.notDeepEqual(early, late, "волна не сдвинулась с фазой");
});

test("знаки: штора по открытости, ТВ и розетка включёнными; закрытая штора и выключенный ТВ знака не имеют", () => {
  const plain = (kind, patch) => frame({ live: new Map([[idOf(kind.mark), state(kind.kind, patch)]]), liveFx: { pulse: 0, flash: new Map() } });
  const curtainOpen = plain({ mark: "КШ1", kind: "curtain" }, { open: 0.6 });
  const curtainShut = plain({ mark: "КШ1", kind: "curtain" }, { open: 0 });
  const tvOn = plain({ mark: "ТВ1", kind: "tv" }, { on: true, level: 1 });
  const tvOff = plain({ mark: "ТВ1", kind: "tv" }, {});
  const outletOn = plain({ mark: "Р1", kind: "outlet" }, { on: true, level: 1 });
  assert.equal(count(curtainOpen, "fillRect(") - count(BASE, "fillRect("), 2, "две створки");
  assert.deepEqual(fingerprint(curtainShut), FRAME_BEFORE);
  assert.equal(count(tvOn, "fillRect(") - count(BASE, "fillRect("), 1, "экран телевизора");
  assert.deepEqual(fingerprint(tvOff), FRAME_BEFORE);
  assert.ok(count(outletOn, "arc(") > count(BASE, "arc("), "точка «включено» у розетки");
  assert.equal(count(outletOn, "createRadialGradient("), 0, "ореол — только у света");
  // Створки раздвигаются: у более открытой штора рисуется шире.
  const wide = plain({ mark: "КШ1", kind: "curtain" }, { open: 1 });
  assert.notDeepEqual(wide, curtainOpen);
});

test("вспышка нажатия — кольцо, пока она не угасла", () => {
  const flash = (value) => frame({ live: new Map([[idOf("В2"), state("other")]]), liveFx: { pulse: 0, flash: new Map([[idOf("В2"), value]]) } });
  assert.ok(count(flash(0.8), "arc(") > count(BASE, "arc("));
  assert.deepEqual(fingerprint(flash(0)), FRAME_BEFORE, "угасшая вспышка не рисуется");
});

test("вид знака по аксессуару: свет, штора, телевизор, розетка, прочее", () => {
  const kind = (label) => simLiveKindOf(markAccessory(box.project, idOf(label)));
  assert.equal(kind("С1"), "light");
  assert.equal(kind("КШ1"), "curtain");
  assert.equal(kind("ТВ1"), "tv");
  assert.equal(kind("Р1"), "outlet");
  assert.equal(kind("ДД1"), "other");
  assert.equal(simLiveKindOf(null), "other");
  assert.deepEqual([...SIM_LIVE_KINDS].sort(), ["curtain", "light", "other", "outlet", "tv"]);
});

// ——— правка закрыта запущенным домом ——————————————————————————————————

const desktop = (patch = {}) => ({ layout: "desktop", screen: "scheme", schemeId: "s", selectedMarkIds: [], ...patch });

test("пока дом запущен, «Схема» — пульт: правка закрыта, как в просмотре", () => {
  assert.equal(canvasEditAllowed(desktop()), true);
  assert.equal(canvasEditAllowed(desktop({ simRunning: false })), true);
  assert.equal(canvasEditAllowed(desktop({ simRunning: true })), false);
  assert.equal(canvasSimLocked(desktop({ simRunning: true })), true);
});

test("в «Объёме» и «Сценариях» дом идёт, а правка «Схемы» им не закрыта", () => {
  assert.equal(canvasEditAllowed(desktop({ simRunning: true, screen: "volume" })), true);
  assert.equal(canvasSimLocked(desktop({ simRunning: true, screen: "drawing" })), false);
});

test("подсказка над планом говорит «Остановите дом, чтобы править»", () => {
  assert.equal(canvasHintText(desktop({ simRunning: true })), "Остановите дом, чтобы править");
  assert.equal(canvasHintText(desktop({ simRunning: true })), strings.sim.bar.editLocked);
  assert.notEqual(canvasHintText(desktop()), strings.sim.bar.editLocked);
  // Телефон по-прежнему говорит про просмотр: правки там нет и без дома.
  assert.equal(canvasHintText(desktop({ layout: "mobile" })), strings.mobile.viewOnly);
});

test("повторный тап по выделенной метке в запущенном доме не закрывает карточку: пульт под рукой", () => {
  const selected = desktop({ selectedMarkIds: ["m"] });
  const drag = { kind: "pan", moved: false, tap: { markId: "m" } };
  assert.equal(canvasTapAction({ ...selected, simRunning: true }, drag), null);
  // В просмотре на телефоне тот же тап по-прежнему закрывает карточку.
  assert.deepEqual(canvasTapAction({ ...selected, layout: "mobile" }, drag), { selectedMarkIds: [], selectedOutlineId: null });
});

const canvasSource = read("src/canvas.js");
function bodyOf(head) {
  const start = canvasSource.indexOf(head);
  assert.ok(start >= 0, "нет " + head);
  const rest = canvasSource.slice(start + head.length);
  const end = rest.search(/\n(?:export )?(?:async )?function /);
  return head + (end < 0 ? rest : rest.slice(0, end));
}

test("щелчок по устройству до объекта не доходит: ни canvasCommit, ни setState с проектом, ни истории", () => {
  for (const head of ["function canvasSimBegin(", "function canvasSimEnd(", "function canvasLiveFrame("]) {
    const body = bodyOf(head);
    assert.ok(!body.includes("canvasCommit("), head + " правит объект");
    assert.ok(!/setState\(\s*\{\s*project:/.test(body), head + " пишет объект");
    assert.ok(!body.includes("pushCommand("), head + " пишет историю");
  }
});

test("мышь и палец оба начинают нажатие, а отпускание заканчивает его раньше разбора тапа", () => {
  const down = bodyOf("function canvasPointerDown(");
  assert.equal(down.split("canvasSimBegin(").length - 1, 2, "нажатие на устройство начинают мышь и палец");
  const up = bodyOf("function canvasPointerUp(");
  const end = up.indexOf("canvasSimEnd(");
  assert.ok(end > 0, "отпускание не заканчивает нажатие");
  assert.ok(end < up.indexOf("canvasTouchUp("), "нажатие заканчивается ниже разбора пальца — палец его бросит");
  assert.ok(end < up.indexOf("if (drag.moved)"), "нажатие заканчивается ниже ветки переноса — сдвиг его не бросит");
  assert.ok(bodyOf("function canvasPointerMove(").includes("canvasSimEnd("), "сдвиг не бросает нажатие: панорама нажмёт устройство");
});

// ——— полоса ——————————————————————————————————————————————————————————

test("шаги часов — +1 мин, +10 мин, +1 ч", () => {
  assert.deepEqual(
    SIM_BAR_STEPS.map((step) => [strings.sim.bar[step.key], step.ms]),
    [
      ["+1 мин", 60000],
      ["+10 мин", 600000],
      ["+1 ч", 3600000],
    ],
  );
});

test("«К следующему событию» гаснет с подсказкой, пока ничего не запланировано", () => {
  const none = simBarState({ running: true, clock: null, speed: 60, nextAt: null });
  assert.equal(none.next, false);
  assert.equal(none.nextTitle, "Ничего не запланировано");
  const soon = simBarState({ running: true, clock: null, speed: 60, nextAt: Date.UTC(2026, 9, 23, 12, 1, 0) });
  assert.equal(soon.next, true);
  assert.match(soon.nextTitle, /23\.10\.2026 12:01:00/);
});

test("пауза — это стоячие часы; ускорение из набора, чужое число — умолчание", () => {
  assert.equal(simBarState({ running: true, clock: { fixed: true }, speed: 60 }).paused, true);
  assert.equal(simBarState({ running: true, clock: { fixed: false }, speed: 60 }).paused, false);
  assert.equal(simBarState({ running: true, clock: null, speed: 960 }).speed, 960);
  assert.equal(simBarState({ running: true, clock: null, speed: 7 }).speed, 60);
  assert.equal(simBarState(null).running, false);
});

test("время имитации человеку — дата и время без пояса", () => {
  const parts = simBarClockText(Date.UTC(2026, 9, 5, 7, 3, 9));
  assert.equal(parts.date, "05.10.2026");
  assert.equal(parts.time, "07:03:09");
});

const KEYS = { dialog: false, field: false, onScheme: true, running: true };
const key = (code, patch = {}) => ({ code, ...patch });

test("клавиши полосы: P — пауза, N — к следующему событию, E — нажать; по физической клавише", () => {
  assert.equal(simBarKeyAction(key("KeyP"), KEYS), "pause");
  assert.equal(simBarKeyAction(key("KeyN"), KEYS), "next");
  assert.equal(simBarKeyAction(key("KeyE"), KEYS), "press");
  assert.equal(simBarKeyAction(key("KeyQ"), KEYS), null);
});

test("клавиатура принадлежит диалогу и полю: при открытом диалоге и в поле ввода полоса молчит", () => {
  assert.equal(simBarKeyAction(key("KeyP"), { ...KEYS, dialog: true }), null);
  assert.equal(simBarKeyAction(key("KeyP"), { ...KEYS, field: true }), null);
});

test("клавиши молчат вне «Схемы», при остановленном доме и с Ctrl/Alt/Cmd/Shift", () => {
  assert.equal(simBarKeyAction(key("KeyP"), { ...KEYS, onScheme: false }), null);
  assert.equal(simBarKeyAction(key("KeyP"), { ...KEYS, running: false }), null);
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) {
    assert.equal(simBarKeyAction(key("KeyP", { [modifier]: true }), KEYS), null, modifier);
  }
  assert.equal(simBarKeyAction(null, KEYS), null);
});

test("«Выполнить команду»: команды сценариев без повторов и по алфавиту, неактивный — с пометкой", () => {
  const house = simHouse();
  const command = (text) => ({ type: "if", id: "i" + text, if: { type: "group", id: "g" + text, mode: "OR", conditions: [{ type: "command", id: "c" + text, text }] }, then: [], else: null, every: null });
  let project = addScenario(house.project, { kind: "block", name: "А", active: true, targets: [command("Ёлочка гори"), command("Всё выключить")] }).project;
  project = addScenario(project, { kind: "block", name: "Б", active: false, targets: [command("ёлочка ГОРИ"), command("Спокойной ночи")] }).project;
  const items = simBarCommandItems(project);
  assert.deepEqual(items.map((item) => item.text), ["Всё выключить", "Ёлочка гори", "Спокойной ночи"]);
  assert.deepEqual(items.map((item) => item.inactive), [false, false, true], "«Ёлочка» слушает и активный сценарий");
  assert.equal(items[2].label, "Спокойной ночи — сценарий не активен");
  assert.deepEqual(simBarCommandItems(house.project), [], "в объекте без команд список пуст");
});

// ——— проводка каркаса ———————————————————————————————————————————————

test("каркас зовёт simSync на каждую смену объекта и держит отметку simRunning", () => {
  const app = read("src/app.js");
  const set = app.slice(app.indexOf("export function setState("));
  const body = set.slice(0, set.indexOf("\nexport function subscribe"));
  assert.ok(/if \("project" in changed\) simSync\(appState\.project\)/.test(body), "setState не зовёт simSync на смену project");
  assert.ok(/simWatch\(/.test(app) && /setState\(\{ simRunning:/.test(app), "запуск и остановка не доходят до состояния сеанса");
  assert.ok(/simRunning: false/.test(app), "simRunning не объявлен в состоянии");
});

test("места монтирования: полоса и журнал объявлены в каркасе и в разметке", () => {
  const html = read("src/index.html");
  assert.equal(PANEL_IDS.simBar, "sim-bar");
  assert.equal(PANEL_IDS.simJournal, "sim-journal");
  assert.ok(html.includes('id="sim-bar"') && html.includes('id="sim-journal"'));
});

test("правка закрыта и раздел меток говорит почему: класс и подпись ставит каркас", () => {
  const app = read("src/app.js");
  assert.ok(app.includes('classList.toggle("is-sim-scheme"'));
  assert.ok(app.includes("strings.sim.bar.editLocked"));
  assert.ok(read("src/panels/sim.css").includes("#app.is-sim-scheme #panel-tools"));
});

// ——— один хозяин на три поверхности (ревью ветки, F1) ————————————————————

test("кадр пульса и вспышки — один на «Схему» и мини-план: вид знака, фаза пульса, угасание вспышки", () => {
  const box = simHouse();
  const kinds = new Map([
    [box.marks.С1, { kind: "light", roomId: null }],
    [box.marks.ДД1, { kind: "other", roomId: null }],
  ]);
  const source = new Map([
    [box.marks.С1, { on: true, level: 1, alert: false, open: 0, pressedAt: null }],
    [box.marks.ДД1, { on: false, level: 0, alert: true, open: 0, pressedAt: null }],
    [box.marks.В1, { on: false, level: 0, alert: false, open: 0, pressedAt: 5000 }],
  ]);
  const memo = simLiveMemo();
  const first = simLiveFrame(source, kinds, memo, 10_000);
  assert.equal(first.live.get(box.marks.С1).kind, "light");
  assert.equal(first.live.get(box.marks.В1).kind, "other", "метка без вида — «прочее»");
  assert.equal(first.animate, true);
  assert.equal(first.fx.pulse, (10_000 % SIM_LIVE_PULSE_MS) / SIM_LIVE_PULSE_MS);
  assert.ok(first.fx.flash.get(box.marks.В1) > 0.99, "вспышка только началась");
  // Полвспышки — угасла наполовину; после неё — вспышки нет.
  const half = simLiveFrame(source, kinds, memo, 10_000 + SIM_LIVE_FLASH_MS / 2);
  assert.ok(Math.abs(half.fx.flash.get(box.marks.В1) - 0.5) < 0.01);
  assert.equal(half.live, first.live, "зеркало не менялось — кадр не пересобран");
  const late = simLiveFrame(source, kinds, memo, 10_000 + SIM_LIVE_FLASH_MS + 1);
  assert.equal(late.fx.flash.has(box.marks.В1), false);
  // Спокойный дом — кадр больше не нужен.
  const calm = simLiveFrame(new Map([[box.marks.С1, { on: true, level: 1, alert: false, open: 0, pressedAt: null }]]), kinds, simLiveMemo(), 0);
  assert.equal(calm.animate, false);
  assert.equal(SIM_LIVE_PULSE_MS, 1400);
  assert.equal(SIM_LIVE_FLASH_MS, 700);
});

test("распознаватели нажатий, вид знака и кадр пульса — по одному хозяину; «Схема», мини-план и «Объём» зовут его", () => {
  const surfaces = ["src/canvas.js", "src/panels/miniPlan.js", "src/panels/volume.js"];
  for (const file of surfaces) {
    const code = read(file);
    assert.ok(!code.includes("deviceKeyPresser("), file + ": свой реестр распознавателей нажатий");
    assert.ok(code.includes("devicePresserOf("), file + ": не зовёт общий реестр нажатий");
    assert.ok(!/simLiveKindOf\(/.test(code), file + ": свой кэш вида знака");
    assert.ok(code.includes("deviceLiveKinds("), file + ": не зовёт общий вид знака");
    assert.ok(!/_(?:PULSE|FLASH)_MS\s*=/.test(code), file + ": свои мерки пульса и вспышки");
  }
  for (const file of ["src/canvas.js", "src/panels/miniPlan.js"]) {
    assert.ok(read(file).includes("simLiveFrame("), file + ": свой кадр пульса и вспышки");
  }
  // Мерки пульса и вспышки объявлены один раз — в `render.js`.
  const declared = [];
  for (const file of ["src/canvas.js", "src/render.js", "src/panels/miniPlan.js", "src/panels/volume.js", "src/panels/deviceCard.js"]) {
    for (const match of read(file).matchAll(/const\s+(\w*(?:PULSE|FLASH)_MS)\s*=/g)) declared.push(file + ":" + match[1]);
  }
  assert.deepEqual(declared, ["src/render.js:SIM_LIVE_PULSE_MS", "src/render.js:SIM_LIVE_FLASH_MS"]);
});
