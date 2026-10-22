// Дом с хозяином скриптов для тестов таска 06: дом-фикстура `simHome.js`,
// сценарии и привязки — настоящими командами модели, движок — с хозяином
// скриптов и «зондом», через дверь которого тест исполняет блок-код так же,
// как его исполняет блочный хозяин (`host.runCode`).
import { addLogicBinding, addScenario } from "../../../src/model.js";
import { createSimEngine } from "../../../src/sim/engine.js";
import { buildHomeSpec, markAccessory } from "../../../src/sim/home.js";
import { createHubOwner } from "../../../src/sim/hubApi.js";
import { simHouse, simRecorder } from "../simHome.js";

/** Полдень пятницы 23 октября 2026 года в местных миллисекундах имитации. */
export const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
export const SEC = 1000;
export const MIN = 60 * SEC;

/**
 * Дом с хозяином скриптов. `scripts` — `[{key, kind, source, name?, active?}]`,
 * `bindings` — `[{key, script, mark, service?, options?, active?}]`.
 * `code(text)` — блок-код через дверь движка (как его зовёт блочный хозяин).
 */
export function hubHome({ box = simHouse(), scripts = [], bindings = [], start = true, clock = T0, site = null } = {}) {
  const scenarios = {};
  for (const script of scripts) {
    const added = addScenario(box.project, { kind: script.kind || "logic", name: script.name || script.key, source: script.source, active: script.active !== false });
    box.project = added.project;
    scenarios[script.key] = added.scenario.id;
  }
  const bound = {};
  for (const binding of bindings) {
    const added = addLogicBinding(box.project, {
      scenarioId: scenarios[binding.script],
      markId: box.marks[binding.mark],
      service: binding.service || 0,
      options: binding.options || {},
      active: binding.active !== false,
    });
    box.project = added.project;
    bound[binding.key || binding.mark] = added.binding.id;
  }
  const recorder = simRecorder();
  const hub = createHubOwner();
  const probe = { name: "probe", host: null, load(home, host) { probe.host = host; } };
  const engine = createSimEngine({ emit: recorder.emit, owners: [hub, probe] });
  const spec = () => ({ ...buildHomeSpec(box.project), rooms: box.project.rooms, site });
  engine.load(spec());
  engine.setClock({ simMs: clock });
  if (start) engine.start();
  const id = (label) => box.marks[label];
  const accessory = (label) => markAccessory(box.project, id(label));
  return {
    box,
    engine,
    hub,
    recorder,
    scenarios,
    bound,
    id,
    accessory,
    address: (label, service = 0) => accessory(label).services[service].address,
    char: (label, char, service = 0) => accessory(label).services[service].chars.find((item) => item.type === char),
    value: (label, char, service = 0) => engine.value(id(label), service, char),
    set: (label, char, value, service = 0) => engine.act({ kind: "set", markId: id(label), service, char, value }),
    reload: () => engine.load(spec()),
    code: (code, kind = "action", scenarioId = "probe") => {
      const result = probe.host.runCode({ kind, code, scenarioId, blockId: "b1", chain: [{ k: "scenario", scenarioId, blockId: "b1" }] });
      engine.advanceTo(engine.now());
      return result;
    },
    log: (code) => recorder.log().filter((entry) => entry.code === code),
    forms: () => recorder.messages.filter((message) => message.type === "forms"),
  };
}

