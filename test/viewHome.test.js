// Дом на странице просмотра (таск 02 просмотра): запускается сам, не гаснет при
// смене режима (долг G01), полоса без «Остановить» и «Сбросить дом», а всё, что
// делает заказчик, объект не меняет ни на байт (R07.1, R09).
//
// Здесь же — обратная сторона того же правила в «Разметке» (таск 288, G421):
// дом, поднятый входом в «Объём», гаснет при уходе из режима, а поднятый рукой
// с полосы — идёт дальше. Хозяина идущего дома помнит сеанс, не объект (ADR 015).
//
// Вида, жестов и живого дома в браузере здесь нет: это живой прогон.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addScenario } from "../src/model.js";
import { volumeHomeStarts, volumeHomeStops } from "../src/panels/volume.js";
import { simBarControls } from "../src/panels/simBar.js";
import { strings } from "../src/strings.js";
import { viewScenariosRows } from "../src/panels/viewScenarios.js";
import {
  simAct,
  simJournalClear,
  simPress,
  simRunning,
  simScenarioRun,
  simScenarios,
  simStart,
  simStartedBy,
  simStop,
  simSync,
} from "../src/simulation.js";
import { simHouse } from "./fixtures/simHome.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Исходник без строк-комментариев: имена правил и дверей называются в шапках,
// и считать их там — значит считать слова, а не вызовы.
const codeOnly = (source) =>
  source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
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

test("что завёл режим, то режим и гасит: правило гашения — зеркало запуска (таск 288, G421)", () => {
  const mode = { simulation: true, running: true, raisedBy: "mode" };
  // Дом подняла «Разметка» входом в «Объём»: ушли на «Схему» или «Чертёж» —
  // гаснет; сняли отметку «Умный дом», не выходя, — тоже.
  assert.equal(volumeHomeStops({ ...mode, kind: "edit", screen: "scheme" }), true);
  assert.equal(volumeHomeStops({ ...mode, kind: "edit", screen: "drawing" }), true);
  assert.equal(volumeHomeStops({ ...mode, kind: "edit", screen: "scenarios" }), true);
  assert.equal(volumeHomeStops({ ...mode, kind: "edit", screen: "volume", simulation: false }), true);
  // В самом «Объёме» с отметкой — не гасим: дом идёт ровно за тем, за чем поднят.
  assert.equal(volumeHomeStops({ ...mode, kind: "edit", screen: "volume" }), false);
  // Дом поднял человек кнопкой полосы — он его не для режима запускал.
  assert.equal(volumeHomeStops({ ...mode, raisedBy: "hand", kind: "edit", screen: "scheme" }), false);
  // Хозяин неизвестен — молчание не повод гасить.
  assert.equal(volumeHomeStops({ ...mode, raisedBy: null, kind: "edit", screen: "scheme" }), false);
  // Гасить нечего.
  assert.equal(volumeHomeStops({ ...mode, running: false, kind: "edit", screen: "scheme" }), false);
  // Страница просмотра: дом идёт в любом режиме нарочно (§13), и правило
  // гашения там молчит ни одним случаем — кнопки гашения у заказчика нет вовсе.
  for (const screen of ["scheme", "drawing", "volume", "scenarios"]) {
    for (const simulation of [true, false]) {
      for (const raisedBy of ["mode", "hand", null]) {
        assert.equal(volumeHomeStops({ running: true, kind: "view", screen, simulation, raisedBy }), false);
      }
    }
  }
  // Два правила не спорят ни в одном случае: запуск и гашение разведены
  // отметкой `running`, и верными разом не бывают никогда.
  for (const kind of ["edit", "view"]) {
    for (const screen of ["scheme", "drawing", "volume", "scenarios"]) {
      for (const simulation of [true, false]) {
        for (const running of [true, false]) {
          for (const raisedBy of ["mode", "hand", null]) {
            const at = { kind, screen, simulation, running, raisedBy };
            assert.ok(!(volumeHomeStarts(at) && volumeHomeStops(at)), JSON.stringify(at));
          }
        }
      }
    }
  }
});

test("сеанс помнит, кто поднял дом: рука или режим (таск 288)", async () => {
  const box = simHouse();
  simSync(box.project);
  try {
    assert.equal(simStartedBy(), null, "дом стоит — хозяина нет");
    assert.equal(simStart("mode"), true);
    assert.equal(simStartedBy(), "mode");
    // Второй запуск идущего дома ничего не меняет: рука его не отнимает.
    assert.equal(simStart("hand"), false);
    assert.equal(simStartedBy(), "mode");
    simStop();
    assert.equal(simStartedBy(), null, "остановленный дом хозяина не помнит");
    // Не сказано кто — значит рука: молчание не повод гасить дом сам.
    assert.equal(simStart(), true);
    assert.equal(simStartedBy(), "hand");
    assert.equal(volumeHomeStops({ simulation: true, screen: "scheme", kind: "edit", running: simRunning(), raisedBy: simStartedBy() }), false);
  } finally {
    simStop();
    simJournalClear();
  }
  await settle();
});

test("правило запуска спрашивает и панель режима — поверхности в «Схеме» ещё нет", () => {
  // Поверхность «Объёма» собирается по первому входу в режим, а дом заказчика
  // должен идти в любом (R06, R14i). Пока правило звала только поверхность,
  // второй заход на «Схему» (G07 помнит режим) оставлял дом остановленным.
  // Вида здесь нет — проверяется, что правило спрашивают из панели, которая
  // смонтирована всегда; работу видно живым прогоном.
  const source = codeOnly(readFileSync(join(ROOT, "src", "panels", "volume.js"), "utf8"));
  const mount = source.slice(source.indexOf("function mountVolumeScreen"));
  assert.ok(mount.includes("volumeHomeStarts("), "mountVolumeScreen правило запуска не спрашивает");
  // И правило гашения — те же двое (таск 288): у панели режима оно отвечает
  // «Объёму» схемы без чертежа, где поверхности не собирается вовсе.
  assert.ok(mount.includes("volumeHomeStops("), "mountVolumeScreen правило гашения не спрашивает");
  // Поверхность — до объявления самих правил: они стоят между нею и панелью.
  const surface = source.slice(source.indexOf("function createVolume"), source.indexOf("export function volumeHomeStarts"));
  assert.ok(surface.includes("volumeHomeStarts(") && surface.includes("volumeHomeStops("), "поверхность спрашивает не оба правила");
  // Своих условий у спрашивающих нет: оба зовут правила одним снимком и ничего
  // не решают сами — ни «а ещё если режим», ни «а ещё если рукой».
  for (const [where, part] of [
    ["поверхность", surface],
    ["панель режима", mount],
  ]) {
    assert.equal((part.match(/volumeHomeStarts\(/g) || []).length, 1, where + ": правило запуска спрошено не один раз");
    assert.equal((part.match(/volumeHomeStops\(/g) || []).length, 1, where + ": правило гашения спрошено не один раз");
    assert.equal((part.match(/\bsimStop\s*\(/g) || []).length, 1, where + ": дом гасится не одним местом");
  }
});

test("гасит дом рука кнопкой полосы и режим «Объёма» — свой; исключение — «Забыть объект», когда дому уже нечего показывать", () => {
  const callers = [];
  const dir = join(ROOT, "src", "panels");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    if (/\bsimStop\s*\(/.test(codeOnly(readFileSync(join(dir, name), "utf8")))) callers.push(name);
  }
  assert.deepEqual(callers.sort(), ["simBar.js", "viewStart.js", "volume.js"]);
  // Поднимают дом тоже трое-из-двух: кнопка полосы — рукой, «Объём» — режимом,
  // и третьего хозяина у дома не завелось.
  const starts = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const source = codeOnly(readFileSync(join(dir, name), "utf8"));
    for (const match of source.matchAll(/\bsimStart\(\s*("[a-z]+")?\s*\)/g)) starts.push([name, match[1] || null]);
  }
  assert.deepEqual(starts.sort(), [
    ["simBar.js", '"hand"'],
    ["volume.js", '"mode"'],
    ["volume.js", '"mode"'],
  ]);
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

test("пометка «встроенный»: слово в словаре, а у библиотечной строки есть lib, у своей нет", () => {
  assert.equal(strings.scenarioLib.builtin, "встроенный");
  assert.match(strings.scenarioLib.builtinHint, /библиотек/);
  const box = houseWithScenario();
  const added = addScenario(box.project, { kind: "logic", name: "Свой", source: "" });
  const own = viewScenariosRows(added.project, []).find((item) => item.id === added.scenario.id);
  assert.equal(Boolean(own.lib), false);
});
