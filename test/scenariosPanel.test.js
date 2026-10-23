// Режим «Сценарии»: список, команды над объектом, заготовки, устройства,
// «Типы без аксессуара» (таск 10 сценариев; истории 1.7, 4.2, 4.22–4.25, 4.27–4.29).
//
// Экранная половина проверяется живым прогоном; здесь — чистая: команды
// принимают объект и отдают `{project, label}` (шаг истории собирает панель
// через `canvasCommit`), читатели списков, свои заготовки и память «сработало
// только что».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SCENARIO_FIRED_MS,
  scenariosAdd,
  scenariosCanEdit,
  scenariosCanToggle,
  scenariosCurrent,
  scenariosDeviceGroups,
  scenariosDeviceKinds,
  scenariosDeviceLines,
  scenariosDuplicate,
  scenariosFiredTracker,
  scenariosFromTemplate,
  scenariosIssueText,
  scenariosListRows,
  scenariosMoveBy,
  scenariosRemove,
  scenariosRename,
  scenariosSetActive,
  scenariosSetParams,
  scenariosSetTypeKind,
  scenariosTemplatesAdd,
  scenariosTemplatesRemove,
  scenariosTemplatesRename,
  scenariosTypesWithoutDevice,
} from "../src/panels/scenarios.js";
import { warningPlace, warningScreenPatch } from "../src/panels/warnings.js";
import { addType, findScenario, scenariosInOrder, typeDeviceOf, typeDeviceUnknown, validate, deleteMark } from "../src/model.js";
import { SCENARIO_TEMPLATES, scenarioIssues, scenarioToTemplate } from "../src/scenarioTree.js";
import { strings } from "../src/strings.js";
import { simBarMount } from "../src/panels/simBar.js";
import { simJournalMount } from "../src/panels/simJournal.js";
import { simHouse } from "./fixtures/simHome.js";

const house = simHouse();
const { project, marks } = house;

const motionLight = () => ({
  kind: "block",
  name: "Свет в коридоре",
  targets: [
    {
      type: "if",
      id: "i1",
      if: { type: "group", id: "g1", mode: "OR", conditions: [{ type: "device", id: "c1", ref: { markId: marks.ДД1, service: 0, char: "MotionDetected" }, op: "eq", value: true, trigger: true }] },
      then: [{ type: "device", id: "a1", ref: { markId: marks.С1, service: 0 }, items: [{ char: "On", verb: "set", value: true }] }],
      else: null,
      every: null,
    },
  ],
});

function withThree() {
  let box = scenariosAdd(project, motionLight());
  const first = box.scenarioId;
  box = scenariosAdd(box.project, { kind: "block", name: "Ночь" });
  const second = box.scenarioId;
  box = scenariosAdd(box.project, { kind: "logic", name: "Скрипт" });
  return { project: box.project, ids: [first, second, box.scenarioId] };
}

// ——— список ————————————————————————————————————————————————————————

test("список: порядок выполнения, вид, фраза, «Активный» и счёт проблем", () => {
  const { project: made, ids } = withThree();
  const rows = scenariosListRows(made);
  assert.deepEqual(rows.map((row) => row.id), ids);
  assert.deepEqual(rows.map((row) => row.kind), ["block", "block", "logic"]);
  assert.equal(rows[0].phrase, "Если ДД1 движение (триггер) — С1 вкл");
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].issues, 0);
  assert.equal(rows[0].first, true);
  assert.equal(rows[2].last, true);
  // Пустой блочный сценарий говорит, что он пуст.
  assert.equal(rows[1].phrase, strings.scenarios.phrase.empty);
});

test("список: поиск по имени без учёта регистра и «ё», фильтр по виду; место в полном списке не меняется", () => {
  const { project: made, ids } = withThree();
  assert.deepEqual(scenariosListRows(made, { query: "НОЧЬ" }).map((row) => row.id), [ids[1]]);
  assert.deepEqual(scenariosListRows(made, { query: "свет" }).map((row) => row.id), [ids[0]]);
  assert.deepEqual(scenariosListRows(made, { kind: "logic" }).map((row) => row.id), [ids[2]]);
  assert.deepEqual(scenariosListRows(made, { query: "нет такого" }), []);
  // Под поиском «Ночь» стоит второй в полном списке: сверху и снизу у неё соседи.
  const found = scenariosListRows(made, { query: "ночь" })[0];
  assert.deepEqual([found.index, found.first, found.last], [1, false, false]);
  const yo = scenariosAdd(made, { kind: "block", name: "Ёлочка" });
  assert.equal(scenariosListRows(yo.project, { query: "елочка" }).length, 1);
});

test("список: сценарий с удалённым устройством считается проблемным", () => {
  const { project: made } = withThree();
  const broken = deleteMark(made, marks.С1).project;
  assert.equal(scenariosListRows(broken)[0].issues, 1);
  // Объект при этом ругается своим предупреждением — переход из панели ведёт в режим.
  const problem = validate(broken).find((item) => item.code === "scenarioDeviceMissing");
  assert.ok(problem);
  const place = warningPlace(broken, problem);
  assert.deepEqual(warningScreenPatch(place), { screen: "scenarios", scenarioId: place.scenarioId });
  assert.equal(findScenario(broken, place.scenarioId).name, "Свет в коридоре");
  assert.equal(warningScreenPatch({ markId: marks.С1 }), null);
  assert.equal(warningScreenPatch(null), null);
});

test("открытый сценарий: выбранный, а нет такого — первый", () => {
  const { project: made, ids } = withThree();
  assert.equal(scenariosCurrent(made, ids[1]).id, ids[1]);
  assert.equal(scenariosCurrent(made, "нет").id, ids[0]);
  assert.equal(scenariosCurrent(made, null).id, ids[0]);
  assert.equal(scenariosCurrent(project, null), null, "в объекте без сценариев открывать нечего");
});

// ——— команды над объектом ————————————————————————————————————————————

test("создание: пустой и из заготовки — в конец списка, с ярлыком шага", () => {
  const empty = scenariosAdd(project, { kind: "block" });
  assert.equal(empty.label, strings.history.addScenario);
  assert.equal(findScenario(empty.project, empty.scenarioId).name, strings.sim.scenarioUntitled);
  assert.equal(findScenario(project, empty.scenarioId), null, "исходный объект не тронут");
  const template = SCENARIO_TEMPLATES[0];
  const made = scenariosFromTemplate(empty.project, template);
  assert.equal(made.label, strings.history.scenarioFromTemplate);
  const scenario = findScenario(made.project, made.scenarioId);
  assert.equal(scenario.name, template.name);
  assert.deepEqual(scenariosInOrder(made.project).map((item) => item.id), [empty.scenarioId, made.scenarioId]);
  // Пустые места заготовки — красные неполные блоки, а не молчаливая пустота.
  assert.ok(scenarioIssues(made.project, scenario).some((item) => item.code === "incomplete"));
});

test("переименование: пустое и прежнее имя — не шаг истории", () => {
  const { project: made, ids } = withThree();
  assert.equal(scenariosRename(made, ids[0], "   "), null);
  assert.equal(scenariosRename(made, ids[0], "Свет в коридоре"), null);
  assert.equal(scenariosRename(made, "нет", "Имя"), null);
  const renamed = scenariosRename(made, ids[0], "  Коридор  ");
  assert.equal(renamed.label, strings.history.renameScenario);
  assert.equal(findScenario(renamed.project, ids[0]).name, "Коридор");
});

test("дубль: в конец, с новыми id блоков и пометкой «копия»", () => {
  const { project: made, ids } = withThree();
  const copy = scenariosDuplicate(made, ids[0]);
  assert.equal(copy.label, strings.history.duplicateScenario);
  const source = findScenario(made, ids[0]);
  const next = findScenario(copy.project, copy.scenarioId);
  assert.equal(next.name, "Свет в коридоре — копия");
  assert.notEqual(next.id, source.id);
  assert.notEqual(next.targets[0].id, source.targets[0].id);
  assert.notEqual(next.targets[0].then[0].id, source.targets[0].then[0].id);
  // Ссылки на устройства сохранены: дубль работает так же.
  assert.equal(next.targets[0].then[0].ref.markId, marks.С1);
  assert.equal(scenariosInOrder(copy.project).at(-1).id, copy.scenarioId);
  assert.equal(scenariosDuplicate(made, "нет"), null);
  // Сценарий на JS дублируется вместе с текстом.
  const logic = scenariosAdd(project, { kind: "logic", name: "Скрипт", source: "var x = 1;" });
  const logicCopy = scenariosDuplicate(logic.project, logic.scenarioId);
  assert.equal(findScenario(logicCopy.project, logicCopy.scenarioId).source, "var x = 1;");
});

test("удаление: ярлык шага, следующим открывается сосед", () => {
  const { project: made, ids } = withThree();
  const middle = scenariosRemove(made, ids[1]);
  assert.equal(middle.label, strings.history.removeScenario);
  assert.equal(middle.nextId, ids[2]);
  assert.equal(findScenario(middle.project, ids[1]), null);
  assert.equal(scenariosRemove(made, ids[2]).nextId, ids[1], "последнего заменяет предыдущий");
  const alone = scenariosAdd(project, { kind: "block" });
  assert.equal(scenariosRemove(alone.project, alone.scenarioId).nextId, null);
  assert.equal(scenariosRemove(made, "нет"), null);
});

test("перестановка: порядок списка — порядок выполнения; у края — не шаг", () => {
  const { project: made, ids } = withThree();
  assert.equal(scenariosMoveBy(made, ids[0], -1), null);
  assert.equal(scenariosMoveBy(made, ids[2], 1), null);
  const down = scenariosMoveBy(made, ids[0], 1);
  assert.equal(down.label, strings.history.moveScenario);
  assert.deepEqual(scenariosInOrder(down.project).map((item) => item.id), [ids[1], ids[0], ids[2]]);
  const up = scenariosMoveBy(made, ids[2], -1);
  assert.deepEqual(scenariosInOrder(up.project).map((item) => item.id), [ids[0], ids[2], ids[1]]);
});

test("«Активный» и параметры: свои ярлыки, повтор того же — не шаг", () => {
  const { project: made, ids } = withThree();
  assert.equal(scenariosSetActive(made, ids[0], true), null);
  const off = scenariosSetActive(made, ids[0], false);
  assert.equal(off.label, strings.history.scenarioActive);
  assert.equal(findScenario(off.project, ids[0]).active, false);
  const params = scenariosSetParams(made, ids[0], { onStart: true, sequential: true, description: "Ночью светит" });
  assert.equal(params.label, strings.history.scenarioParams);
  const scenario = findScenario(params.project, ids[0]);
  assert.deepEqual([scenario.onStart, scenario.sequential, scenario.description], [true, true, "Ночью светит"]);
  assert.equal(scenariosSetParams(params.project, ids[0], { onStart: true }), null);
  // Чужие поля через параметры не проходят.
  assert.equal(scenariosSetParams(made, ids[0], { name: "Взлом", targets: [] }), null);
});

test("права: править сценарии можно на компьютере и планшете, не на телефоне", () => {
  assert.equal(scenariosCanEdit("desktop"), true);
  assert.equal(scenariosCanEdit("mobile"), false);
});

test("планшет стоймя (F2): правую колонку — устройства и мини-план — прячет только просмотр, не узкая раскладка", () => {
  const css = readFileSync(new URL("../src/panels/scenarios.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const hides = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => /display:\s*none/.test(body)).map(([, selector]) => selector.trim());
  const side = hides.filter((selector) => selector.includes(".scn__side"));
  assert.ok(side.length > 0, "колонку в просмотре больше никто не прячет — телефон получил бы мини-план");
  for (const selector of side) {
    assert.ok(selector.includes(".is-view-only"), "колонку прячет не просмотр, а раскладка: " + selector);
  }
});

test("права (F2): планшет в раскладке просмотра правит сценарии; телефон только включает и выключает их", () => {
  assert.equal(scenariosCanEdit("mobile", true), true, "планшет стоймя открылся как телефон");
  assert.equal(scenariosCanEdit("mobile", false), false);
  assert.equal(scenariosCanToggle("mobile"), true, "на телефоне «Активный» неактивен");
  assert.equal(scenariosCanToggle("mobile", true), true);
  assert.equal(scenariosCanToggle("desktop"), true);
});

// ——— свои заготовки ————————————————————————————————————————————————

test("свои заготовки: сохранить, переименовать, удалить; из своей создаётся сценарий с пустыми местами", () => {
  const { project: made, ids } = withThree();
  const template = scenarioToTemplate(findScenario(made, ids[0]), made);
  let list = scenariosTemplatesAdd([], template);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Свет в коридоре");
  assert.ok(list[0].id);
  assert.equal(scenariosTemplatesAdd(list, { ...template, name: "  " }), list, "без названия не сохраняется");
  list = scenariosTemplatesRename(list, list[0].id, "Мой свет");
  assert.equal(list[0].name, "Мой свет");
  assert.equal(scenariosTemplatesRename(list, "нет", "x"), list);
  assert.equal(scenariosTemplatesRename(list, list[0].id, " "), list);
  // Своя заготовка видна в другом объекте: сценарий из неё создаётся там с пустыми местами.
  const other = scenariosFromTemplate(project, list[0]);
  const scenario = findScenario(other.project, other.scenarioId);
  assert.equal(scenario.name, "Мой свет");
  assert.equal(JSON.stringify(scenario).includes(marks.ДД1), false);
  assert.ok(scenarioIssues(other.project, scenario).some((item) => item.code === "incomplete"));
  list = scenariosTemplatesRemove(list, list[0].id);
  assert.deepEqual(list, []);
  assert.equal(scenariosTemplatesRemove(list, "нет"), list);
});

// ——— выбор устройства ——————————————————————————————————————————————

test("устройства по помещениям: порядок помещений, «Без помещения» последним, поиск", () => {
  const groups = scenariosDeviceGroups(project);
  assert.deepEqual(groups.map((group) => group.name), ["Коридор", "Гостиная", "Спальня", strings.scenarios.side.noRoom]);
  assert.equal(groups.at(-1).roomId, null);
  const hall = groups[0].devices.map((device) => device.label);
  assert.deepEqual(hall, ["С1", "В1", "ДД1", "ДО1"]);
  assert.ok(groups[0].devices[0].typeName.length > 0);
  // Поиск — по обозначению, названию типа, виду аксессуара и помещению.
  assert.deepEqual(scenariosDeviceGroups(project, "дд1").flatMap((group) => group.devices.map((device) => device.label)), ["ДД1"]);
  assert.deepEqual(scenariosDeviceGroups(project, "спальня").map((group) => group.name), ["Спальня"]);
  assert.deepEqual(scenariosDeviceGroups(project, "нет такого"), []);
  assert.deepEqual(scenariosDeviceGroups(null), []);
});

test("сервисы выбранного устройства: «Лампа: Включено, Яркость», служебные скрыты", () => {
  const lines = scenariosDeviceLines(project, marks.С1);
  assert.equal(lines[0], strings.sim.services.Lightbulb + ": Включено, Яркость");
  assert.deepEqual(scenariosDeviceLines(project, "нет"), []);
});

// ——— типы без аксессуара (история 1.7) ————————————————————————————

test("«Типы без аксессуара»: свой тип с незнакомым кодом в списке, выбор профиля — одним действием", () => {
  const base = project.markTypes.find((type) => type.code === "ДД");
  const added = addType(project, { code: "ЖЖЖ", name: "Мой странный датчик", categoryId: base.categoryId });
  assert.equal(typeDeviceUnknown(added.project, added.type.id), true);
  const list = scenariosTypesWithoutDevice(added.project);
  assert.deepEqual(list.map((item) => [item.code, item.name, item.marks]), [["ЖЖЖ", "Мой странный датчик", 0]]);
  // Догадка сама не применяется: пока человек не выбрал, профиля нет.
  assert.equal(typeDeviceOf(added.project, added.type.id), null);
  const kinds = scenariosDeviceKinds();
  assert.equal(kinds.at(-1).key, "none");
  assert.ok(kinds.some((kind) => kind.key === "motion" && kind.label === strings.sim.kinds.motion));
  const chosen = scenariosSetTypeKind(added.project, added.type.id, "motion");
  assert.equal(chosen.label, strings.history.typeDevice);
  assert.equal(typeDeviceOf(chosen.project, added.type.id).kind, "motion");
  assert.deepEqual(scenariosTypesWithoutDevice(chosen.project), []);
  // «Оставить без аксессуара» — тоже ответ: тип уходит из списка, профиля по-прежнему нет.
  const none = scenariosSetTypeKind(added.project, added.type.id, "none");
  assert.deepEqual(scenariosTypesWithoutDevice(none.project), []);
  assert.equal(typeDeviceOf(none.project, added.type.id), null);
  assert.equal(scenariosSetTypeKind(added.project, "нет", "motion"), null);
  // Стартовый справочник целиком известен: в нём списка нет.
  assert.deepEqual(scenariosTypesWithoutDevice(project), []);
});

// ——— проблемы словами и «сработало только что» —————————————————————————

test("проблемы словами: петля называет метку, остальное — общими словами", () => {
  const loop = {
    id: "s", kind: "block", name: "Петля", targets: [
      {
        type: "if", id: "i1", if: { type: "group", id: "g", mode: "OR", conditions: [{ type: "device", id: "c", ref: { markId: marks.С1, service: 0, char: "On" }, op: "eq", value: true, trigger: true }] },
        then: [{ type: "device", id: "a", ref: { markId: marks.С1, service: 0 }, items: [{ char: "On", verb: "set", value: false }] }], else: null, every: null,
      },
    ],
  };
  const issue = scenarioIssues(project, loop).find((item) => item.code === "loop");
  assert.equal(scenariosIssueText(project, loop, issue), "Петля: С1 управляется этим сценарием и сам его запускает");
  assert.equal(scenariosIssueText(project, loop, { blockId: null, code: "noTrigger" }), strings.scenarios.issues.noTrigger);
  assert.equal(scenariosIssueText(project, loop, { blockId: "c", code: "incomplete" }), strings.scenarios.issues.incomplete);
});

test("сработавший блок горит полторы секунды и гаснет сам", () => {
  assert.equal(SCENARIO_FIRED_MS, 1500);
  const tracker = scenariosFiredTracker();
  assert.equal(tracker.next(0), null);
  tracker.note(
    [
      { kind: "run", blockId: "a1" },
      { kind: "cond", blockId: "c1", result: true },
      { kind: "cond", blockId: "c2", result: false },
      { kind: "change", blockId: "x" },
      { kind: "run" },
      null,
    ],
    1000,
  );
  assert.deepEqual([...tracker.active(1000)].sort(), ["a1", "c1"]);
  assert.deepEqual([...tracker.active(2499)].sort(), ["a1", "c1"]);
  assert.equal(tracker.next(1200), 2500, "перерисовать к концу подсветки");
  assert.deepEqual([...tracker.active(2500)], []);
  assert.equal(tracker.next(2500), null);
  // Повторное срабатывание продлевает подсветку.
  tracker.note([{ kind: "run", blockId: "a1" }], 3000);
  tracker.note([{ kind: "run", blockId: "a1" }], 3800);
  assert.equal(tracker.active(5200).has("a1"), true);
  assert.equal(tracker.active(5301).has("a1"), false);
});

// ——— места, где режим подключён ——————————————————————————————————————

test("режим подключён: точка монтирования, стили по режиму и строки журнала истории", () => {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="screen-scenarios" class="screen mount"><\/div>/);
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /#app\.has-scheme\[data-screen="scenarios"\] #screen-scenarios/);
  assert.match(css, /#app\[data-screen="scenarios"\]:not\(\.is-mobile\) #panel-right/);
  for (const key of ["renameScenario", "duplicateScenario", "scenarioFromTemplate", "scenarioActive", "scenarioParams", "addScenario", "removeScenario", "moveScenario", "typeDevice"]) {
    assert.ok(strings.history[key] && strings.history[key].length > 0, "нет ярлыка истории " + key);
  }
  const screens = readFileSync(new URL("../src/panels/screens.js", import.meta.url), "utf8");
  assert.match(screens, /\["drawing", "scheme", "volume", "scenarios"\]/);
});

// ——— полоса и журнал — сборка «Схемы» (ревью ветки, F1) ———————————————————

// Узлы без браузера: столько DOM, сколько нужно `uiEl`, `uiButton` и `uiIcon`.
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
      this.dataset = {};
      this.style = {};
    }
    get classList() {
      const names = () => this.className.split(/\s+/).filter(Boolean);
      const write = (list) => (this.className = [...new Set(list)].join(" "));
      return {
        add: (...more) => write([...names(), ...more]),
        remove: (...less) => write(names().filter((name) => !less.includes(name))),
        contains: (name) => names().includes(name),
        toggle: (name, on) => {
          const want = on === undefined ? !names().includes(name) : Boolean(on);
          write(want ? [...names(), name] : names().filter((item) => item !== name));
          return want;
        },
      };
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    removeEventListener() {}
    fire(type) {
      for (const fn of this.listeners[type] || []) fn({ type, target: this, preventDefault() {} });
    }
    click() {
      this.fire("click");
    }
    append(...nodes) {
      for (const node of nodes) if (node !== null && node !== undefined) this.children.push(node);
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
  }
  return { createElement: (tag) => new FakeNode(tag), createElementNS: (ns, tag) => new FakeNode(tag), activeElement: null, getElementById: () => null };
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

test("журнал «Сценариев» — сборка `simJournal.js`: те же узлы, строка нажатия со своим цветом, щелчок по строке — режиму", () => {
  const { project, marks } = simHouse();
  const T = Date.UTC(2026, 9, 23, 12);
  const entries = [
    { at: T, kind: "change", markId: marks.С1, service: 0, char: "On", from: false, to: true, code: "change", chain: [{ k: "web", at: T }] },
    { at: T + 1000, kind: "press", markId: marks.В2, service: 0, char: "ProgrammableSwitchEvent", from: null, to: "SINGLE_PRESS", code: "press", chain: [{ k: "web", at: T }] },
  ];
  globalThis.document = fakeDocument();
  try {
    const host = document.createElement("section");
    const picked = [];
    const journal = simJournalMount(host, { getState: () => ({ project, simRunning: true }) }, {
      title: strings.scenarios.journal.title,
      collapsed: false,
      entries: () => entries,
      onRow: (row) => picked.push(row.markId),
    });
    journal.draw();
    assert.ok(host.classList.contains("sim-journal"), "узел журнала без общего класса");
    const rows = withClass(host, "sim-journal__row");
    assert.equal(rows.length, 2);
    const press = rows.find((row) => row.classList.contains("is-press"));
    assert.ok(press, "у строки нажатия нет класса is-press — нет и цвета");
    assert.equal(withClass(press, "sim-journal__time")[0].textContent, "12:00:01");
    press.click();
    assert.deepEqual(picked, [marks.В2]);
    const toggle = withClass(host, "sim-journal__toggle")[0];
    assert.ok(nodesOf(toggle).some((node) => node.textContent === strings.scenarios.journal.title), "заголовок режима не дошёл до сборки");
    toggle.click();
    assert.ok(host.classList.contains("is-collapsed"));
    assert.equal(withClass(host, "sim-journal__body")[0].hidden, true);
  } finally {
    delete globalThis.document;
  }
});

test("полоса «Сценариев» — сборка `simBar.js`: те же узлы и кнопки, что в «Схеме»", () => {
  globalThis.document = fakeDocument();
  try {
    const host = document.createElement("div");
    const bar = simBarMount(host, { getState: () => ({}), notify() {} });
    bar.update();
    assert.ok(host.classList.contains("sim-bar"));
    assert.equal(withClass(host, "sim-bar__row").length, 1);
    assert.equal(withClass(host, "sim-bar__clock").length, 1);
    const start = withClass(host, "sim-bar__start")[0];
    assert.equal(start.textContent, strings.sim.bar.start, "остановленный дом — кнопка «Запустить дом»");
    assert.equal(withClass(host, "sim-bar__clock")[0].hidden, true, "часы у остановленного дома спрятаны");
    assert.equal(withClass(host, "sim-bar__time").length, 1);
  } finally {
    delete globalThis.document;
  }
});

test("полоса и журнал «Сценариев» режим только монтирует, а стили у них — одна пара правил со «Схемой»", () => {
  const code = readFileSync(new URL("../src/panels/scenarios.js", import.meta.url), "utf8");
  assert.ok(code.includes("simBarMount(") && code.includes("simJournalMount("), "режим не монтирует общие сборки");
  for (const own of ["scn-bar__", "scn-journal__", "simJournalRows(", "simJournalFilters(", "simJournalEmpty(", "simBarState(", "simBarClockText(", "volumeClockParse(", "volumeDateParse("]) {
    assert.ok(!code.includes(own), "в режиме своя копия полосы или журнала: " + own);
  }
  const css = readFileSync(new URL("../src/panels/scenarios.css", import.meta.url), "utf8");
  assert.ok(!/\.scn-bar|\.scn-journal__/.test(css), "в стилях режима вторая пара правил полосы и журнала");
});
