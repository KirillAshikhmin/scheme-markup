// Перенумерация на открытии объекта: номера вместо uuid в **обеих** трубах
// (требования G11, G11.1; ADR 030).
//
// Чем этот файл отличается от `markIds.test.js`: тот проверяет саму дверь
// `idsMigrate` на собранном руками объекте, а этот — **открытие готового
// объекта заказчика**: что перенумерация вписана в обе трубы (файл и база
// браузера), что обе дают один и тот же объект, что второе открытие ничего не
// переписывает и что переехали **все** ссылки, включая единственную, которая
// ссылается не идентификатором, — адрес аксессуара в опциях привязки логики.
//
// Почему адреса здесь главное. Логический сценарий хаба собирает список
// устройств из адресов (`aid`, `aid.sid`, `aid.sid.cid`), человек выбирает
// строку в окне «Опции», и выбранный адрес ложится в объект строкой. В четырёх
// объектах заказчика таких ссылок тринадцать: датчики движения, ручное
// управление, датчики влажности, «не трогать этот аксессуар». `aid` — это номер
// метки (ADR 012 + таск 04), и не переехав вместе с меткой, он указал бы в
// пустоту: дом пошёл бы, а сценарий «включать свет по движению» датчика не
// нашёл — и отличить это от «датчик не привязан» на глаз нельзя.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ID_COUNTER_KEY,
  addLogicBinding,
  addMark,
  addScenario,
  addScheme,
  createProject,
  idNumberOf,
  labelOf,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { deviceAid } from "../src/sim/home.js";
import { legacyIdsBefore } from "./fixtures/legacyIds.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

// Коллекции с идентификаторами — те же, что у таблицы `ID_OWNERS` модели.
const COLLECTIONS = [
  "marks",
  "groups",
  "outlines",
  "schemes",
  "rooms",
  "categories",
  "markTypes",
  "walls",
  "openings",
  "schemeObjects",
  "schemeObjectKinds",
  "equipmentTypes",
  "equipment",
  "placements",
  "scenarios",
  "logicBindings",
];

// Сверка двух труб: ключи по алфавиту (порядок полей у них свой), версия
// формата и пустые списки из чтения файла — не в счёте.
function stable(project) {
  const sorted = (value) => {
    if (Array.isArray(value)) return value.map(sorted);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
    return out;
  };
  return JSON.stringify(
    sorted({
      ...project,
      formatVersion: null,
      rooms: project.rooms || [],
      outlines: project.outlines || [],
      groups: project.groups || [],
      counters: project.counters || {},
    }),
    null,
    2,
  );
}

const LEGACY = [
  "legacy-project.json",
  "legacy-views-project.json",
  "legacy-openings-project.json",
  "legacy-drawing-project.json",
  "legacy-sizes-project.json",
];

// Адрес аксессуара, каким его считала сборка **до** таска 04: FNV-1a по строке
// `mark.id` в диапазон 100000000…999999999, совпадения разведены пробой вверх
// по кольцу в порядке id. Рецепт взят из прежнего `src/sim/home.js`
// (`deviceAid`/`deviceAidsOf` до таска 04), а не из нынешнего кода: иначе тест
// сверял бы миграцию с нею самой.
function legacyAids(project) {
  const text = new TextEncoder();
  const MIN = 100000000;
  const MAX = 999999999;
  const hash = (id) => {
    let value = 0x811c9dc5;
    for (const byte of text.encode(String(id))) {
      value ^= byte;
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return MIN + (value % (MAX - MIN + 1));
  };
  const ids = project.marks.map((mark) => mark.id).filter((id) => typeof id === "string").sort();
  const taken = new Set();
  const aids = new Map();
  for (const id of ids) {
    if (aids.has(id)) continue;
    let aid = hash(id);
    while (taken.has(aid)) aid = aid === MAX ? MIN : aid + 1;
    taken.add(aid);
    aids.set(id, aid);
  }
  return aids;
}

// ——— обе трубы открытия ——————————————————————————————————————————————————

for (const name of LEGACY) {
  test("G11: " + name + " нумеруется при открытии, и обе трубы дают один объект", async () => {
    const legacy = JSON.parse(read(name));
    const fromFile = (await unpackProject(await packProject(legacy, new Map()))).project;
    const stored = projectsMigrateStored(legacy);

    // Версию файла ставит упаковка, базе браузера она ни к чему; пустые
    // списки, которых у объекта версии 1 не было, дописывает чтение файла —
    // это было и до номеров. Всё остальное у двух труб обязано совпасть
    // до последнего поля.
    assert.equal(stable(fromFile), stable(stored), "файл и база открыли объект по-разному");

    for (const project of [fromFile, stored]) {
      // Ни одного прежнего идентификатора: номер у каждой сущности.
      for (const key of COLLECTIONS) {
        for (const item of project[key] || []) {
          assert.ok(idNumberOf(item.id) !== null, key + ": сущность осталась без номера — " + item.id);
        }
      }
      for (const scheme of project.schemes) {
        for (const guide of scheme.guides || []) assert.ok(idNumberOf(guide.id) !== null, "направляющая без номера");
      }
      // Метки — первой коллекцией: слова заказчика «начиная с 1».
      assert.deepEqual(
        project.marks.map((mark) => mark.id),
        project.marks.map((mark, index) => String(index + 1)),
        "метки получили не 1…N подряд",
      );
      // Ссылки целы: у каждой метки живая схема и живой тип.
      for (const mark of project.marks) {
        assert.ok(project.schemes.some((scheme) => scheme.id === mark.schemeId), "метка осталась без схемы");
        const known = project.markTypes.some((type) => type.id === mark.typeId) || mark.typeId === "comment";
        assert.ok(known, "метка осталась без типа");
      }
      // Счётчик доведён до последнего выданного номера.
      const top = Math.max(...COLLECTIONS.flatMap((key) => (project[key] || []).map((item) => idNumberOf(item.id) || 0)));
      assert.equal(project.counters[ID_COUNTER_KEY], top, "счётчик номеров отстал от выданного");
      // Ключи хранилищ, общих для всех объектов, целы (G08.1).
      assert.equal(project.id, legacy.id, "перенумерация тронула ключ объекта");
      assert.equal(project.key, legacy.key, "перенумерация тронула постоянный ключ");
      assert.deepEqual(
        project.schemes.map((scheme) => scheme.imageId),
        legacy.schemes.map((scheme) => scheme.imageId),
        "перенумерация тронула имя подложки",
      );
      // Обозначения меток — те же: номер сущности и номер метки не одно и то же.
      assert.deepEqual(
        project.marks.map((mark) => labelOf(project, mark.id)),
        legacy.marks.map((mark) => labelOf(legacy, mark.id)),
        "обозначения меток поехали",
      );
    }

    // Второе открытие не переписывает ничего: объект приходит **тем же** по
    // ссылке, а значит ни `updatedAt`, ни шага истории на это не тратится.
    assert.equal(projectsMigrateStored(stored), stored, "второе открытие из базы переписало объект");
    const twice = (await unpackProject(await packProject(stored, new Map()))).project;
    assert.equal(stable(twice), stable(stored), "второе открытие файла переписало объект");
  });
}

// ——— адрес аксессуара в опциях привязки логики ————————————————————————————

// Объект поры uuid с логическим сценарием, привязкой и адресом датчика в
// опциях — ровно как в объектах заказчика.
function legacyWithAddress() {
  const made = createProject({ name: "Адреса" });
  const scheme = addScheme(made, { name: "1 этаж", width: 1000, height: 800 });
  let project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const lamp = addMark(project, { schemeId: scheme.scheme.id, typeId: typeOf("Т"), kind: "point", points: [{ x: 0.3, y: 0.3 }] });
  project = lamp.project;
  const motion = addMark(project, { schemeId: scheme.scheme.id, typeId: typeOf("ДД"), kind: "point", points: [{ x: 0.4, y: 0.4 }] });
  project = motion.project;
  const scenario = addScenario(project, { kind: "logic", name: "Свет по движению" });
  project = scenario.project;
  const bound = addLogicBinding(project, { scenarioId: scenario.scenario.id, markId: lamp.mark.id, service: 0 });
  project = bound.project;
  // Объект «до номеров»: идентификаторы — строки-uuid, счётчика номеров нет.
  const before = legacyIdsBefore({ ...project, formatVersion: 5 });
  const aids = legacyAids(before);
  const sensor = before.marks.find((mark) => labelOf(before, mark.id) === labelOf(project, motion.mark.id));
  const address = String(aids.get(sensor.id)) + ".13.15";
  return {
    project: {
      ...before,
      logicBindings: before.logicBindings.map((binding) => ({
        ...binding,
        options: {
          // Адрес характеристики датчика — выбранная человеком строка списка.
          motion1: address,
          // Адрес аксессуара без сервиса — так пишется «не трогать этого».
          excludeAccessoriesId: String(aids.get(sensor.id)),
          // И опции, которые адресами не являются: их трогать нельзя.
          offDelaySeconds: 5,
          singlePress: true,
          name: "Коридор",
        },
      })),
    },
    address,
    sensorLabel: labelOf(project, motion.mark.id),
  };
}

test("G11: адрес аксессуара в опциях привязки переезжает вместе с меткой, прочие опции целы", async () => {
  const legacy = legacyWithAddress();
  const fromFile = (await unpackProject(await packProject(legacy.project, new Map()))).project;
  const stored = projectsMigrateStored(legacy.project);

  for (const project of [fromFile, stored]) {
    const sensor = project.marks.find((mark) => labelOf(project, mark.id) === legacy.sensorLabel);
    const aid = deviceAid(sensor.id);
    assert.ok(aid !== null, "у датчика после открытия нет адреса");
    const options = project.logicBindings[0].options;
    assert.equal(options.motion1, aid + ".13.15", "адрес характеристики датчика указывает в пустоту");
    assert.equal(options.excludeAccessoriesId, String(aid), "адрес аксессуара без сервиса не переехал");
    // Остальное — как было: ни число, ни отметка, ни имя адресами не являются.
    assert.equal(options.offDelaySeconds, 5);
    assert.equal(options.singlePress, true);
    assert.equal(options.name, "Коридор");
    // Привязка смотрит на живую метку, сценарий — на живой сценарий.
    assert.ok(project.marks.some((mark) => mark.id === project.logicBindings[0].markId));
    assert.ok(project.scenarios.some((item) => item.id === project.logicBindings[0].scenarioId));
  }
  // Прежний девятизначный адрес не остался нигде.
  assert.equal(JSON.stringify(stored).includes(legacy.address), false, "прежний адрес остался в объекте");
});
