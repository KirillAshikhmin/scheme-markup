// Перенумерация на открытии объекта: номера вместо uuid, **свой счётчик у
// каждого вида**, в **обеих** трубах (требования G11, G11.1, G391; ADR 030, 038).
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
  DICTIONARY_PROBLEM_CODES,
  ID_COUNTER_SHARED_KEY,
  ID_OWNER_KEYS,
  acceptedProblems,
  addLogicBinding,
  addMark,
  addScenario,
  addScheme,
  createProject,
  deleteMark,
  idCounterKey,
  idNumberOf,
  idsReplace,
  labelOf,
  problemAccepted,
  validate,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { buildHomeSpec, homeAccessories } from "../src/sim/home.js";
import { createSimEngine } from "../src/sim/engine.js";
import { simRecorder } from "./fixtures/simHome.js";
import { strings } from "../src/strings.js";
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
// сверял бы миграцию с нею самой. Нынешний адрес — просто номер метки, своей
// двери у него нет вовсе (G392).
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
      // Счётчик **каждого вида** доведён до последнего выданного номера, а
      // общего счётчика не осталось ни одного (ADR 038).
      assert.equal(
        Object.prototype.hasOwnProperty.call(project.counters, ID_COUNTER_SHARED_KEY),
        false,
        "в открытом объекте остался общий счётчик",
      );
      for (const collection of ID_OWNER_KEYS) {
        const list = collection === "guides"
          ? project.schemes.flatMap((scheme) => scheme.guides || [])
          : project[collection] || [];
        if (list.length === 0) continue;
        const top = Math.max(...list.map((item) => idNumberOf(item.id) || 0));
        assert.equal(
          Number(project.counters[idCounterKey(collection)]) || 0,
          top,
          collection + ": счётчик вида отстал от выданного номера",
        );
        // Вид нумерован со своей единицы и подряд — справочник меток не касается.
        assert.deepEqual(
          list.map((item) => item.id),
          list.map((item, index) => String(index + 1)),
          collection + ": вид нумерован не с единицы",
        );
      }
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
    // Адрес аксессуара — номер метки, своей двери у него нет (G392).
    const aid = idNumberOf(sensor.id);
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

// ——— дом прежнего объекта после открытия не пуст ——————————————————————————

// Это сторож на ту самую поломку, которую видел заказчик: адрес аксессуара —
// номер метки (ADR 012 + таск 04), у метки прежней разметки номера нет, и
// необорудованный дом встречал его строкой «В объекте нет устройств —
// поставьте метки или задайте профиль типу». Нумерует объект открытие, и тест
// стоит на **каждой** трубе: забудь её одна — и объект из базы браузера
// открывался бы без дома, а из файла с домом.
function homeStart(project) {
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit });
  engine.load(buildHomeSpec(project));
  engine.setClock({ simMs: Date.UTC(2026, 9, 22, 12, 0, 0) });
  engine.start();
  return { codes: recorder.log().map((entry) => entry.code), accessories: homeAccessories(project).length };
}

test("G11: дом объекта прежней сборки после открытия не пуст — у каждой трубы", async () => {
  const legacy = JSON.parse(read("legacy-project.json"));

  // Как было до открытия: ни одного адреса, дом пуст и говорит об этом. Строка
  // та самая, которую видел заказчик, — поэтому она в тесте названа.
  const before = homeStart(legacy);
  assert.equal(before.accessories, 0, "у объекта поры uuid адресов быть не должно");
  assert.ok(before.codes.includes("empty"), "дом объекта поры uuid обязан жаловаться на пустоту");
  assert.match(strings.sim.journal.empty, /нет устройств/);

  const stored = projectsMigrateStored(legacy);
  const fromFile = (await unpackProject(await packProject(legacy, new Map()))).project;
  for (const [name, project] of [["база браузера", stored], ["файл", fromFile]]) {
    const after = homeStart(project);
    assert.ok(after.accessories > 0, name + ": дом открытого объекта пуст");
    assert.equal(after.codes.includes("empty"), false, name + ": дом жалуется на пустоту после открытия");
    assert.ok(after.codes.includes("started"), name + ": дом не запустился");
    // И у каждой метки с аксессуаром есть адрес — он же её номер.
    for (const accessory of homeAccessories(project)) {
      assert.equal(accessory.aid, idNumberOf(accessory.markId), name + ": адрес аксессуара не номер метки");
      assert.ok(accessory.aid > 0, name + ": адрес не выдан");
    }
  }
});

// ——— ответ «так и задумано» переживает перенумерацию ——————————————————————

test("G11: принятые жёлтые строки после открытия остаются принятыми", async () => {
  const legacy = JSON.parse(read("legacy-views-project.json"));
  const open = (project) =>
    validate(project).filter((problem) => DICTIONARY_PROBLEM_CODES.includes(problem.code) && !problemAccepted(project, problem.key));
  const accepted = acceptedProblems(legacy).filter((record) => DICTIONARY_PROBLEM_CODES.includes(record.code));
  assert.ok(accepted.length > 0, "фикстура без принятых строк справочника ничего не проверяет");

  const was = open(legacy).length;
  const stored = projectsMigrateStored(legacy);
  const fromFile = (await unpackProject(await packProject(legacy, new Map()))).project;
  for (const [name, project] of [["база браузера", stored], ["файл", fromFile]]) {
    // Ни одной закрытой строки заново: ключ принятия собран из
    // **отсортированных** номеров, и миграция складывает его тем же порядком.
    assert.equal(open(project).length, was, name + ": вернулись уже закрытые жёлтые строки");
    // И ни одной записи-сироты: у каждой принятой строки справочника есть
    // вопрос, на который она отвечает.
    const keys = new Set(validate(project).map((problem) => problem.key));
    const orphans = acceptedProblems(project).filter(
      (record) => DICTIONARY_PROBLEM_CODES.includes(record.code) && !keys.has(record.key),
    );
    assert.deepEqual(orphans, [], name + ": в списке принятых завелась запись-сирота");
    assert.equal(acceptedProblems(project).length, acceptedProblems(legacy).length, name + ": список принятых поехал");
  }
});

// ——— второй вход: объект формата 8 с общими номерами (G391, ADR 038) ————————
//
// Прод-сборка уже выложена, и объекты формата 8 у заказчика есть: номера там
// раздавал **один** счётчик на весь объект, справочник съедал первую сотню, а
// `aid` метки был её номером под этим общим счётчиком — 117, 118, … Опции
// привязок логики несут эти адреса живыми ссылками, и перенумерация по видам
// обязана переселить их **второй раз**: с общего номера на свой.
//
// Объект формата 8 собирается здесь по правилу прежней сборки (номера подряд,
// коллекция за коллекцией, затем `counters["#id"]`), а не берётся у нынешнего
// кода: иначе тест сверял бы миграцию с нею самой.
const SHARED_ORDER = [
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

function sharedNumbers(project) {
  let last = 0;
  const moves = new Map();
  for (const collection of SHARED_ORDER) {
    const table = new Map();
    for (const item of project[collection] || []) {
      last += 1;
      table.set(item.id, String(last));
    }
    if (table.size > 0) moves.set(collection, table);
  }
  const guides = new Map();
  for (const scheme of project.schemes || []) {
    for (const guide of scheme.guides || []) {
      last += 1;
      guides.set(guide.id, String(last));
    }
  }
  if (guides.size > 0) moves.set("guides", guides);
  const numbered = idsReplace(project, moves).project;
  // Счётчики видов снимаются, остаётся один общий — так объект формата 8 и
  // выглядит; оставь их, и `idsNumberedByKind` сочла бы его уже своим.
  const counters = {};
  for (const [key, value] of Object.entries(numbered.counters)) if (!key.startsWith("#")) counters[key] = value;
  return {
    project: { ...numbered, counters: { ...counters, [ID_COUNTER_SHARED_KEY]: last }, formatVersion: 8 },
    moves,
  };
}

// Объект формата 8 с живым адресом датчика в опциях привязки.
//
// **Метка поставлена уже после открытия прод-сборкой** — и это не причуда
// примера, а единственный случай, в котором адрес вообще меняется. Прежняя
// перенумерация шла коллекция за коллекцией и метки нумеровала первыми, поэтому
// у объекта, который прод-сборка только открыла, метки и так стоят на 1…N:
// номера по видам совпадут с ними номер в номер, и переселять адреса будет
// нечего. А вот метка, поставленная **после** открытия, получила номер из
// общего счётчика — за справочником, за стенами, за сценариями, — и у неё адрес
// переезжает по-настоящему. Так у заказчика и вышло: он открыл объекты прод-
// сборкой и продолжил разметку.
function sharedWithAddress() {
  const legacy = legacyWithAddress();
  // Сперва номера под общим счётчиком — как их выдала прод-сборка.
  const shared = sharedNumbers(legacyIdsBefore(legacy.project));
  const last = Number(shared.project.counters[ID_COUNTER_SHARED_KEY]);
  const sensor = shared.project.marks.find((mark) => labelOf(shared.project, mark.id) === legacy.sensorLabel);
  // Метка, поставленная после открытия: номер из общего счётчика, за всем
  // прежним.
  const was = String(last + 1);
  const moved = idsReplace(shared.project, { marks: { [sensor.id]: was } }).project;
  return {
    project: {
      ...moved,
      counters: { ...moved.counters, [ID_COUNTER_SHARED_KEY]: last + 1 },
      // И адреса в опциях — под этим же общим номером: прод-сборка выбрала их
      // сама, человек их не вписывал.
      logicBindings: moved.logicBindings.map((binding) => ({
        ...binding,
        options: { ...binding.options, motion1: was + ".13.15", excludeAccessoriesId: was },
      })),
    },
    sharedAid: was,
    sensorLabel: legacy.sensorLabel,
  };
}

test("G391: объект формата 8 перенумеровывается по видам обеими трубами, адреса переезжают второй раз", async () => {
  const shared = sharedWithAddress();
  // Пример тот: справочник сдвинут общим счётчиком, а метка, поставленная после
  // открытия, стоит на номере за всем прежним — и её адрес в опциях такой же.
  assert.ok(
    idNumberOf(shared.project.markTypes[0].id) > shared.project.marks.length,
    "пример не тот: справочник не сдвинут общим счётчиком",
  );
  assert.ok(
    idNumberOf(shared.sharedAid) > shared.project.markTypes.length,
    "пример не тот: метка не стоит на номере из общего счётчика",
  );
  assert.equal(shared.project.logicBindings[0].options.motion1, shared.sharedAid + ".13.15");

  const fromFile = (await unpackProject(await packProject(shared.project, new Map()))).project;
  const stored = projectsMigrateStored(shared.project);
  assert.equal(stable(fromFile), stable(stored), "файл и база открыли объект формата 8 по-разному");

  for (const [name, project] of [["база браузера", stored], ["файл", fromFile]]) {
    // Метки стали 1…N, справочник — со своей единицы.
    assert.deepEqual(
      project.marks.map((mark) => mark.id).slice().sort((a, b) => Number(a) - Number(b)),
      project.marks.map((mark, index) => String(index + 1)),
      name + ": метки формата 8 не стали 1…N",
    );
    assert.equal(project.markTypes[0].id, "1", name + ": справочник остался на номерах меток");
    assert.equal(
      Object.prototype.hasOwnProperty.call(project.counters, ID_COUNTER_SHARED_KEY),
      false,
      name + ": общий счётчик остался в объекте",
    );
    // Адрес переехал на **живую** метку — ни одного в пустоту.
    const sensor = project.marks.find((mark) => labelOf(project, mark.id) === shared.sensorLabel);
    const aid = idNumberOf(sensor.id);
    const options = project.logicBindings[0].options;
    assert.equal(options.motion1, aid + ".13.15", name + ": адрес характеристики указывает в пустоту");
    assert.equal(options.excludeAccessoriesId, String(aid), name + ": адрес аксессуара не переехал");
    assert.notEqual(options.excludeAccessoriesId, shared.sharedAid, name + ": адрес остался прежним");
    // Прочие опции целы.
    assert.equal(options.offDelaySeconds, 5);
    assert.equal(options.name, "Коридор");
    // Прежний общий номер в опциях не остался.
    assert.equal(
      JSON.stringify(project.logicBindings).includes(shared.sharedAid + ".13.15"),
      false,
      name + ": прежний адрес остался в опциях",
    );
    assert.equal(project.formatVersion, 9, name + ": версия формата осталась восьмой");
  }

  // Третий вход: уже перенумерованный по видам объект не меняется ни на байт —
  // и это проверяется у **обеих** труб.
  assert.equal(projectsMigrateStored(stored), stored, "второе открытие из базы переписало объект");
  const twice = (await unpackProject(await packProject(stored, new Map()))).project;
  assert.equal(stable(twice), stable(stored), "второе открытие файла переписало объект");
});

// ——— ссылка на объект ходит туда и обратно (G391) —————————————————————————

test("G391: объект, прошедший ссылку, не перенумеровывается заново — счётчики видов в нагрузке", async () => {
  const { gzipSync, gunzipSync } = await import("node:zlib");
  const { viewLinkPack, viewLinkRead } = await import("../src/viewLink.js");
  const codec = {
    compress: async (bytes) => new Uint8Array(gzipSync(bytes)),
    decompress: async (bytes) => new Uint8Array(gunzipSync(bytes)),
  };
  const shared = sharedWithAddress();
  const opened = projectsMigrateStored(shared.project);
  const packed = await viewLinkPack(opened, codec);
  const read = await viewLinkRead(packed.text, codec);

  // Счётчики видов доехали — а значит открытие ссылки объект не перенумерует:
  // именно на этом стоит идемпотентность (ADR 038).
  for (const collection of ID_OWNER_KEYS) {
    const key = idCounterKey(collection);
    if (!Object.prototype.hasOwnProperty.call(opened.counters, key)) continue;
    assert.equal(read.project.counters[key], opened.counters[key], collection + ": счётчик вида не доехал ссылкой");
  }
  assert.deepEqual(
    read.project.marks.map((mark) => mark.id),
    opened.marks.map((mark) => mark.id),
    "номера меток в ссылке поехали",
  );
  assert.deepEqual(read.project.logicBindings, opened.logicBindings, "привязки в ссылке поехали");
  const again = projectsMigrateStored(read.project);
  assert.equal(again, read.project, "объект из ссылки перенумеровался заново");
});

// ——— битая ссылка после открытия не оживает чужой меткой ————————————————————
//
// Самая дорогая находка ремонта. Объект **формата 8** держит ссылку на
// удалённую метку **числом**: `scenario.targets[].markId` и адрес аксессуара в
// `logicBinding.options`. `deleteMark` их не чистит — это состояние
// спроектировано, и про него говорит жёлтая строка `scenarioDeviceMissing`.
//
// Перенумерация ставит метки 1…N **со смыканием дыр**, и новые номера берутся
// из того же диапазона. Оставь неизвестное число как есть — и `markId: "2"`
// удалённой метки после открытия показывает на **живую чужую** метку: сценарий
// управляет не тем прибором, а жёлтая строка исчезает. Поэтому неизвестное
// число гасится (`ID_GONE`), и проверка говорит то же, что говорила.
//
// Проверяются оба носителя битой ссылки и **обе** трубы.
function sharedWithDangling() {
  const made = createProject({ name: "Битая ссылка" });
  const scheme = addScheme(made, { name: "1 этаж", width: 1000, height: 800 });
  let project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x) => {
    const added = addMark(project, { schemeId: scheme.scheme.id, typeId: typeOf(code), kind: "point", points: [{ x, y: 0.3 }] });
    project = added.project;
    return added.mark.id;
  };
  const lamp = put("Т", 0.2);
  const doomed = put("ДД", 0.3);
  const other = put("Т", 0.4);
  const third = put("Т", 0.5);
  const scenario = addScenario(project, { kind: "block", name: "Свет по движению" });
  project = scenario.project;
  const logic = addScenario(project, { kind: "logic", name: "Логика" });
  project = logic.project;
  // Привязка стоит на **другой** метке: иначе `deleteMark` унесла бы её вместе
  // с меткой (`dropLogicBindings`), и адреса в опциях не осталось бы вовсе.
  project = addLogicBinding(project, {
    scenarioId: logic.scenario.id,
    markId: lamp,
    options: { motion1: "", excludeAccessoriesId: "" },
  }).project;
  // Блочный сценарий ссылается на метку, которую сейчас удалят.
  project = {
    ...project,
    scenarios: project.scenarios.map((item) =>
      item.id === scenario.scenario.id
        ? { ...item, targets: [{ type: "if", blocks: [{ type: "act", markId: doomed, service: 0 }] }] }
        : item,
    ),
  };

  // Номера под общим счётчиком — как их выдала прод-сборка: метки первыми.
  const shared = sharedNumbers(project);
  const was = shared.moves.get("marks").get(doomed);
  const live = shared.moves.get("marks");
  const numbered = {
    ...shared.project,
    logicBindings: shared.project.logicBindings.map((binding) => ({
      ...binding,
      options: { ...binding.options, motion1: was + ".13.15", excludeAccessoriesId: was },
    })),
  };
  // И метку удаляют — ссылки остаются висеть числом.
  const gone = deleteMark(numbered, was).project;
  return {
    project: { ...gone, counters: { ...gone.counters, [ID_COUNTER_SHARED_KEY]: numbered.counters[ID_COUNTER_SHARED_KEY] } },
    dead: was,
    // Метка, которая после смыкания дыр встанет на освободившийся номер.
    heir: live.get(other),
    thirdWas: live.get(third),
  };
}

test("G391: битая ссылка объекта формата 8 не оживает чужой меткой — у каждой трубы", async () => {
  const box = sharedWithDangling();
  // Пример тот: номер удалённой метки меньше числа оставшихся, то есть после
  // смыкания дыр его займёт живая метка.
  assert.ok(Number(box.dead) < box.project.marks.length + 1, "пример не тот: номер не переиспользуется");
  const before = validate(box.project).filter((item) => item.code === "scenarioDeviceMissing");
  assert.equal(before.length, 1, "пример не тот: до открытия жёлтой строки нет");

  const fromFile = (await unpackProject(await packProject(box.project, new Map()))).project;
  const stored = projectsMigrateStored(box.project);
  assert.equal(stable(fromFile), stable(stored), "файл и база открыли объект по-разному");

  for (const [name, project] of [["база браузера", stored], ["файл", fromFile]]) {
    const live = new Set(project.marks.map((mark) => mark.id));
    // Номер удалённой метки теперь занят живой — ровно то, из-за чего ссылку и
    // нельзя оставлять числом.
    assert.ok(live.has(box.dead), name + ": пример не тот, номер никем не занят");

    // 1. Дерево блочного сценария.
    const block = project.scenarios.find((item) => item.kind === "block");
    const markId = block.targets[0].blocks[0].markId;
    assert.equal(live.has(markId), false, name + ": ссылка сценария ожила чужой меткой");
    const problems = validate(project);
    const missing = problems.filter((item) => item.code === "scenarioDeviceMissing");
    assert.equal(missing.length, 1, name + ": жёлтая строка про удалённое устройство пропала");
    assert.deepEqual(
      problems.filter((item) => item.code === "scenarioServiceMissing"),
      [],
      name + ": код жёлтой строки подменился",
    );

    // 2. Адрес аксессуара в опциях привязки — обе формы.
    const options = project.logicBindings[0].options;
    assert.equal(live.has(String(options.motion1).split(".")[0]), false, name + ": адрес характеристики ожил чужой меткой");
    assert.equal(live.has(String(options.excludeAccessoriesId)), false, name + ": адрес аксессуара ожил чужой меткой");

    // 3. Дом идёт и говорит про ненайденный адрес, а не молча правит чужой
    //    прибор: это и есть то состояние, в котором объект был до открытия.
    const started = homeStart(project);
    assert.ok(started.accessories > 0, name + ": дом пуст");
  }

  // Второе открытие ничего не переписывает: погашенная ссылка числом не
  // является, и перенумерация её не трогает.
  assert.equal(projectsMigrateStored(stored), stored, "второе открытие переписало объект");
});

// А у объекта **поры uuid** ничего не гасится: битый uuid совпасть с новым
// номером не может, и ссылка остаётся ровно той строкой, какой была (G68).
test("G391: битая ссылка объекта поры uuid остаётся как была", () => {
  const box = sharedWithDangling();
  const dead = "old-его-уже-нет";
  const blockOf = (project) => project.scenarios.find((item) => item.kind === "block").targets[0].blocks[0].markId;
  const before = legacyIdsBefore(box.project);
  const legacy = {
    ...before,
    scenarios: before.scenarios.map((item) =>
      item.kind === "block" ? { ...item, targets: [{ type: "if", blocks: [{ type: "act", markId: dead, service: 0 }] }] } : item,
    ),
  };
  assert.equal(blockOf(legacy), dead);

  const stored = projectsMigrateStored(legacy);
  assert.equal(blockOf(stored), dead, "битый uuid тронут перенумерацией");
  assert.equal(
    validate(stored).filter((item) => item.code === "scenarioDeviceMissing").length,
    1,
    "жёлтая строка про удалённое устройство пропала",
  );
});
