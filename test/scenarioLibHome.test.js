// Библиотечные сценарии в доме (таск 05 просмотра; история 49, требования
// G25, G26).
//
// Что держит файл:
//   — `buildHomeSpec` исходников **не ищет**: разрешённые записи ему передают,
//     а без них он собирает дом ровно как прежде (объект без библиотеки);
//   — дом идёт с пропавшим скриптом: остальные сценарии работают, а не падают
//     вместе с ним;
//   — страница сама скачивает нужное и пересобирает дом: в поток уходит
//     спецификация с подставленным исходником, а про пропавший скрипт журнал
//     говорит своим кодом — ровно один раз.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addLogicBinding, addScenario, scenariosInOrder } from "../src/model.js";
import { SCENARIO_LIB_DIR, SCENARIO_LIB_INDEX, scenarioLibForget, scenarioLibResolve } from "../src/scenarioLib.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { createSimulation } from "../src/simulation.js";
import { simHouse } from "./fixtures/simHome.js";
import { T0, hubHome } from "./fixtures/sprut/hubHome.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// Маленький логический скрипт: на изменение `On` пишет строку в журнал. Нужен
// один наблюдаемый след — что сценарий сработал.
const MARK_SCRIPT = [
  'info = {',
  '  name: "Отметка в журнале",',
  '  description: "",',
  '  version: "1.0",',
  '  onStart: false,',
  '  sourceServices: [HS.Switch],',
  '  sourceCharacteristics: [HC.On],',
  '  options: {},',
  '  variables: {}',
  '};',
  '',
  'function trigger(source, value) {',
  '  console.info("щелчок: " + value);',
  '}',
  '',
].join("\n");

const LIB_NAME = "💡 Автоматизация света по движению";
const LIB_SOURCE = readFileSync(join(HERE, "fixtures", "sprut", "MotionLightAutomation.js"), "utf8");
const LIB_HASH = sha256(LIB_SOURCE);
const LIB_FILE = "MotionLightAutomation@" + LIB_HASH.slice(0, 16) + ".js";
const LIB_REF = { name: LIB_NAME, version: "1.2", hash: LIB_HASH };
const MARK_HASH = sha256(MARK_SCRIPT);
const MARK_FILE = "Mark@" + MARK_HASH.slice(0, 16) + ".js";
const MARK_REF = { name: "Отметка в журнале", version: "1.0", hash: MARK_HASH };
const GONE_REF = { name: "Мастер-выключатель", version: "1.0", hash: sha256("этого в библиотеке нет") };

const INDEX_TEXT = JSON.stringify(
  {
    version: 1,
    scripts: [
      { name: LIB_NAME, version: "1.2", kind: "logic", hash: LIB_HASH, size: LIB_SOURCE.length, file: LIB_FILE },
      { name: MARK_REF.name, version: "1.0", kind: "logic", hash: MARK_HASH, size: MARK_SCRIPT.length, file: MARK_FILE },
    ],
  },
  null,
  2,
);

function libNet() {
  const asked = [];
  const files = {
    [SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX]: INDEX_TEXT,
    [SCENARIO_LIB_DIR + "/" + LIB_FILE]: LIB_SOURCE,
    [SCENARIO_LIB_DIR + "/" + MARK_FILE]: MARK_SCRIPT,
  };
  return {
    asked,
    fetch: async (url) => {
      asked.push(String(url));
      const text = files[String(url)];
      return text === undefined ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => text };
    },
  };
}

const libStore = () => {
  const kept = new Map();
  return { get: async (key) => kept.get(key) ?? null, set: async (key, value) => (kept.set(key, value), { ok: true }) };
};

/** Запись сценария, которая стоит на библиотечной ссылке (поле таска 06). */
function libLink(project, scenarioId, ref) {
  return { ...project, scenarios: project.scenarios.map((item) => (item.id === scenarioId ? { ...item, source: "", lib: ref } : item)) };
}

function libScenario(project, { name, ref }) {
  const added = addScenario(project, { kind: "logic", name, source: "", active: true });
  return { project: libLink(added.project, added.scenario.id, ref), id: added.scenario.id };
}

// ——— `buildHomeSpec` исходников не ищет ————————————————————————————————————

test("без разрешённых записей дом собирается ровно как прежде", () => {
  const box = simHouse();
  const added = addScenario(box.project, { kind: "logic", name: "Своя логика", source: "info = {};" });
  const spec = buildHomeSpec(added.project);
  assert.deepEqual(
    spec.scenarios.map((scenario) => scenario.id),
    scenariosInOrder(added.project).map((scenario) => scenario.id),
  );
  assert.equal(spec.scenarios[0].source, "info = {};");
});

test("разрешённые записи дом берёт как есть: своих исходников он не читает", () => {
  const box = simHouse();
  const added = addScenario(box.project, { kind: "logic", name: "Своя логика", source: "info = {};" });
  const resolved = scenariosInOrder(added.project).map((scenario) => ({ ...scenario, source: "// из библиотеки\n" }));
  const spec = buildHomeSpec(added.project, { scenarios: resolved });
  assert.equal(spec.scenarios[0].source, "// из библиотеки\n");
  assert.notEqual(spec.scenarios[0], resolved[0], "запись уходит в поток копией");
  // Остальное в спецификации — прежнее.
  assert.deepEqual(spec.accessories, buildHomeSpec(added.project).accessories);
});

// ——— дом идёт с пропавшим скриптом ————————————————————————————————————————

test("скрипт не доехал: дом идёт, остальные сценарии работают", async () => {
  scenarioLibForget();
  const home = hubHome({ start: false });
  // Оба сценария стоят на библиотеке: доехавший сработает только если дом
  // получил подставленный исходник, а не пустое поле записи.
  const ok = libScenario(home.box.project, { name: "Отметка", ref: MARK_REF });
  const gone = libScenario(ok.project, { name: "Свет по движению", ref: GONE_REF });
  const bound = addLogicBinding(gone.project, { scenarioId: ok.id, markId: home.id("В1"), service: 0, options: {}, active: true });
  const project = bound.project;

  const resolved = await scenarioLibResolve(project, { fetch: libNet().fetch, store: libStore() });
  assert.deepEqual(
    resolved.missing.map((item) => item.id),
    [gone.id],
  );

  home.engine.load({ ...buildHomeSpec(project, { scenarios: resolved.scenarios }), rooms: project.rooms, site: null });
  home.engine.setClock({ simMs: T0 });
  home.engine.start();
  home.set("В1", "On", true);

  assert.ok(home.log("hubLog").length > 0, "доехавший сценарий сработал");
  assert.deepEqual(home.log("hubSyntax"), [], "пропавший скрипт не прикинулся ошибкой разбора");
  assert.ok(home.recorder.log().some((entry) => entry.code === "started"), "дом запустился");
});

// ——— страница скачивает и пересобирает дом ————————————————————————————————

function libSession({ library }) {
  const posts = [];
  const sim = createSimulation({
    bridge: () => ({ post: (message) => posts.push(message), close: () => {}, inPage: false }),
    settings: { get: async () => null, set: async () => ({ ok: true }) },
    clock: { now: () => ({ speed: 0, minutes: 720, day: 1 }), simMs: () => T0, watch: () => () => {}, step: () => {}, jump: () => {} },
    timers: { now: () => 0, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id) },
    library,
  });
  return { sim, posts, loads: () => posts.filter((message) => message.type === "load") };
}

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function libLibrary({ fetch, store }) {
  const calls = [];
  return {
    calls,
    resolve: async (project) => {
      calls.push(project);
      return scenarioLibResolve(project, { fetch, store });
    },
  };
}

test("в поток уходит спецификация с подставленным исходником", async () => {
  scenarioLibForget();
  const net = libNet();
  const library = libLibrary({ fetch: net.fetch, store: libStore() });
  const box = simHouse();
  const made = libScenario(box.project, { name: "Свет по движению", ref: LIB_REF });
  const session = libSession({ library });

  session.sim.sync(made.project);
  session.sim.start();
  await settle();

  const last = session.loads().at(-1);
  assert.ok(last, "дом потоку не ушёл вовсе");
  const scenario = last.spec.scenarios.find((item) => item.id === made.id);
  assert.equal(scenario.source, LIB_SOURCE);
  assert.equal(scenario.active, true);
  assert.deepEqual(session.sim.libraryMissing(), []);
  assert.deepEqual(net.asked, [SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX, SCENARIO_LIB_DIR + "/" + LIB_FILE]);
  session.sim.close();
});

test("пропавший скрипт: сценарий помечен, в журнале строка своим кодом — один раз", async () => {
  scenarioLibForget();
  const net = libNet();
  const library = libLibrary({ fetch: net.fetch, store: libStore() });
  const box = simHouse();
  const made = libScenario(box.project, { name: "Свет по движению", ref: GONE_REF });
  const session = libSession({ library });

  session.sim.sync(made.project);
  session.sim.start();
  await settle();

  const scenario = session.loads().at(-1).spec.scenarios.find((item) => item.id === made.id);
  assert.equal(scenario.source, "");
  assert.equal(scenario.active, false);
  assert.equal(scenario.libMissing, true);
  assert.deepEqual(session.sim.libraryMissing(), [{ id: made.id, name: GONE_REF.name, version: "1.0", hash: GONE_REF.hash }]);
  const told = session.sim.journal().filter((entry) => entry.code === "scenarioLibMissing");
  assert.equal(told.length, 1);
  assert.ok(told[0].text.includes(GONE_REF.name), "строка журнала называет скрипт: " + told[0].text);

  // Тот же объект ещё раз — второй раз за библиотекой не ходят и второй строки
  // в журнале не пишут.
  session.sim.sync({ ...made.project });
  await settle();
  assert.equal(library.calls.length, 1);
  assert.equal(session.sim.journal().filter((entry) => entry.code === "scenarioLibMissing").length, 1);
  session.sim.close();
});

test("объект без библиотечных ссылок библиотеку не трогает вовсе", async () => {
  scenarioLibForget();
  const library = libLibrary({ fetch: libNet().fetch, store: libStore() });
  const box = simHouse();
  const added = addScenario(box.project, { kind: "logic", name: "Своя логика", source: "info = {};" });
  const session = libSession({ library });

  session.sim.sync(added.project);
  session.sim.start();
  await settle();

  assert.deepEqual(library.calls, []);
  assert.deepEqual(session.sim.libraryMissing(), []);
  const spec = session.loads().at(-1).spec;
  assert.deepEqual(spec.scenarios, buildHomeSpec(added.project).scenarios);
  session.sim.close();
});
