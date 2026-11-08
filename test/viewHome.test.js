// Дом на странице просмотра (таск 02 просмотра): запускается сам, не гаснет при
// смене режима (долг G01), полоса без «Остановить» и «Сбросить дом», а всё, что
// делает заказчик, объект не меняет ни на байт (R07.1, R09).
//
// Вида, жестов и живого дома в браузере здесь нет: это живой прогон.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addScenario } from "../src/model.js";
import { volumeHomeStarts } from "../src/panels/volume.js";
import { simBarControls } from "../src/panels/simBar.js";
import { viewScenariosRows } from "../src/panels/viewScenarios.js";
import { simAct, simJournalClear, simPress, simRunning, simScenarioRun, simScenarios, simStart, simStop, simSync } from "../src/simulation.js";
import { simHouse } from "./fixtures/simHome.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("дом запускается по отметке: в «Разметке» — только в «Объёме», на странице просмотра — в любом режиме", () => {
  const on = { simulation: true, running: false };
  assert.equal(volumeHomeStarts({ ...on, kind: "edit", screen: "volume" }), true);
  assert.equal(volumeHomeStarts({ ...on, kind: "edit", screen: "scheme" }), false);
  assert.equal(volumeHomeStarts({ ...on, kind: "view", screen: "scheme" }), true);
  assert.equal(volumeHomeStarts({ ...on, kind: "view", screen: "volume" }), true);
  // Уже идёт — второй раз не запускаем; отметка снята — не запускаем вовсе.
  assert.equal(volumeHomeStarts({ simulation: true, running: true, kind: "view", screen: "volume" }), false);
  assert.equal(volumeHomeStarts({ simulation: false, running: false, kind: "view", screen: "volume" }), false);
});

test("правило запуска спрашивает и панель режима — поверхности в «Схеме» ещё нет", () => {
  // Поверхность «Объёма» собирается по первому входу в режим, а дом заказчика
  // должен идти в любом (R06, R14i). Пока правило звала только поверхность,
  // второй заход на «Схему» (G07 помнит режим) оставлял дом остановленным.
  // Вида здесь нет — проверяется, что правило спрашивают из панели, которая
  // смонтирована всегда; работу видно живым прогоном.
  const source = readFileSync(join(ROOT, "src", "panels", "volume.js"), "utf8");
  const mount = source.slice(source.indexOf("function mountVolumeScreen"));
  assert.ok(mount.includes("volumeHomeStarts("), "mountVolumeScreen правило запуска не спрашивает");
});

test("гасит дом только кнопка полосы; единственное исключение — «Забыть объект», когда дому уже нечего показывать", () => {
  const callers = [];
  const dir = join(ROOT, "src", "panels");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    if (/\bsimStop\s*\(/.test(readFileSync(join(dir, name), "utf8"))) callers.push(name);
  }
  assert.deepEqual(callers.sort(), ["simBar.js", "viewStart.js"]);
});

test("полоса дома: у просмотра нет ни «Остановить» и «Сбросить», ни пульта с часами", () => {
  const view = simBarControls({ kind: "view", running: true });
  assert.equal(view.start, false, "запущенный дом заказчик не останавливает");
  assert.equal(view.reset, false);
  // «Выполнить команду» — набор условия «Команда» руками, а ряд часов («×60 —
  // сутки за 24 мин», «+1 ч», «К следующему событию») заказчик крутит
  // параметрами объёма, там же, где погоду и климат (R06.2, ревью ветки F1).
  assert.equal(view.command, false);
  assert.equal(view.clock, false);
  assert.equal(simBarControls({ kind: "view", running: false }).start, true, "не запущен — хотя бы «Запустить»");
  const edit = simBarControls({ kind: "edit", running: true });
  assert.deepEqual([edit.start, edit.reset, edit.command, edit.clock], [true, true, true, true]);
  assert.deepEqual(Object.values(simBarControls({ kind: "edit", running: false })), [true, false, false, false]);
});

function houseWithScenario() {
  const box = simHouse();
  const added = addScenario(box.project, { kind: "block", name: "Вечер", targets: [] });
  box.project = added.project;
  box.scenarioId = added.scenario.id;
  return box;
}

test("щелчок, нажатие и ручной запуск сценария не меняют объект ни на байт", async () => {
  const box = houseWithScenario();
  const before = JSON.stringify(box.project);
  simSync(box.project);
  try {
    assert.equal(simStart(), true);
    await settle();
    simAct({ kind: "toggle", markId: box.marks["С1"] });
    simPress(box.marks["В1"], 0, "single");
    simScenarioRun(box.scenarioId);
    await settle();
    assert.equal(JSON.stringify(box.project), before);
  } finally {
    simStop();
    simJournalClear();
  }
  assert.equal(simRunning(), false);
});

test("окно сценариев: имя, «Активный» только показан, зависший — выключенным; список в порядке выполнения", () => {
  const box = houseWithScenario();
  let project = addScenario(box.project, { kind: "block", name: "Ночь", active: false, targets: [] }).project;
  const rows = viewScenariosRows(project, []);
  assert.deepEqual(
    rows.map((row) => [row.name, row.active]),
    [
      ["Вечер", true],
      ["Ночь", false],
    ],
  );
  const hung = viewScenariosRows(project, [{ id: box.scenarioId, active: true, running: false, fault: { code: "hung" } }]);
  assert.equal(hung[0].active, false);
  assert.deepEqual(viewScenariosRows(null, []), []);
  assert.equal(typeof simScenarios, "function");
});

test("окно сценариев: сценарий с недоехавшим библиотечным скриптом помечен", () => {
  // Скрипт лежит в библиотеке, а не в объекте, и мог не доехать (нет сети на
  // первом открытии). Дом идёт без него, и заказчику об этом говорят — молчать
  // здесь нельзя (G26).
  const box = houseWithScenario();
  const hash = "7b".repeat(32);
  const added = addScenario(box.project, { kind: "logic", name: "Свет по движению", source: "" });
  const project = {
    ...added.project,
    scenarios: added.project.scenarios.map((item) =>
      item.id === added.scenario.id ? { ...item, lib: { name: "Свет по движению", version: "1.2", hash } } : item,
    ),
  };
  const gone = [{ id: added.scenario.id, name: "Свет по движению", version: "1.2", hash }];
  const row = viewScenariosRows(project, [], gone).find((item) => item.id === added.scenario.id);
  assert.equal(row.libMissing, true);
  assert.equal(row.lib && row.lib.version, "1.2", "версия у строки есть — ею подписана подсказка");
  // Список недоехавших знает только дом: без него строка не помечена.
  assert.equal(viewScenariosRows(project, []).find((item) => item.id === added.scenario.id).libMissing, false);
});
