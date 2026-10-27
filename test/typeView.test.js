// Изображение у типа: предложение общей базы и правка руками (таск 218,
// требование G327).
//
// Что здесь проверяется и почему именно это:
//
//   1. **Ничего не применяется само.** Справочник копируется в объект при
//      создании и дальше живёт сам, поэтому у размеченного объекта шесть типов
//      разошлись с шаблоном. Правило сборки (G68): догадку показывают, а не
//      применяют — и это главный тест файла, на настоящем старом файле.
//   2. **Чужого никто не отнимает.** Имя живёт у типа, а не у формы знака:
//      «Круг с подвесом» заказчика остаётся светильником, и выбор изображения
//      у одного типа не меняет ни одного другого. Проверяется перебором всех
//      типов до и после правки.
//   3. **Лестница ADR 005 цела:** имя у типа старше формы знака, форма старше
//      ничего, и отвечает об этом одна функция — её же читают развёртка и
//      объём.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addTypesFromCatalog,
  applyTypeViewOffers,
  acceptProblem,
  acceptedProblems,
  addType,
  catalogOffer,
  createProject,
  defaultTemplate,
  labelOf,
  setTypeView,
  typeObjectView,
  typeViewName,
  typeViewOffer,
  typeViewOwn,
  typeViewReview,
  updateType,
  validate,
} from "../src/model.js";
import { packProject, unpackProject, FORMAT_VERSION } from "../src/projectFile.js";
import {
  objectViewByName,
  objectViewFamily,
  objectViewForShape,
  objectViewNames,
  OBJECT_VIEW_FAMILIES,
  OBJECT_VIEW_FAMILY_OBJECTS,
} from "../src/objectViews/registry.js";
import { strings, text } from "../src/strings.js";
import { typeViewGroups, typesViewsInUse, typesTemplateFrom } from "../src/panels/types.js";
import { warningsModel } from "../src/panels/warnings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Байты `project.json` объекта, **созданного до таска 135**: полный стартовый
// справочник, шесть меток, нумерация — и ни одного имени изображения. Ровно так
// выглядят оба рабочих объекта заказчика (в них имён изображений тоже ноль), и
// сверка идёт с этим текстом, а не с тем, что сейчас соберёт `createProject`.
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-views-project.json"), "utf8").replace(/\n$/, "");
const legacy = () => JSON.parse(LEGACY_TEXT);

// Шесть типов, разошедшихся с общей базой. Столько же и в тех же кодах
// разошлось на объекте заказчика «Белый дом» — это не выдуманный пример.
const DIVERGED = [
  ["ЛЮ", "lamp", "chandelier"],
  ["Н", null, "nightLight"],
  ["ПП", "data", "switchToggle"],
  ["ЩС", "data", "panelBox"],
  ["ВР", "dehumidifier", "waterOutlet"],
  ["КН", null, "drain"],
];

function byCode(project, code) {
  return project.markTypes.find((type) => type.code === code);
}

// Снимок «кто к какому изображению приходит»: по нему видно, что правка одного
// типа не задела соседей.
function viewsOf(project) {
  return project.markTypes.map((type) => type.code + "=" + String(typeViewName(project, type.id)));
}

// ——— реестр: семьи названы, имена не потерялись —————————————————————————

test("реестр изображений разложен по семьям, и ни одно имя не потерялось", () => {
  const all = new Set();
  for (const family of OBJECT_VIEW_FAMILIES) {
    const names = objectViewFamily(family);
    assert.ok(names.length > 0, family + ": семья пустая");
    for (const name of names) {
      assert.ok(!all.has(name), name + ": имя в двух семьях — изображение досталось бы чужому");
      all.add(name);
      assert.equal(objectViewByName(name).family, family, name + ": запись не знает своей семьи");
    }
  }
  assert.deepEqual([...all].sort(), objectViewNames(), "семьи и плоский список реестра разошлись");
  // Сто четыре изображения: 42 у меток и 62 у вещей чертежа (таск 224 добавил
  // семь; пять изображений меток — датчик климата, термостат, тёплый пол, ель и
  // датчик освещённости — правки после сборки сценариев; гардеробная,
  // обувница и вешалка — правка 2026-10-27). Число названо, чтобы следующий,
  // кто добавит изображение, увидел, что сетка выбора подросла.
  assert.equal(objectViewNames().length, 104);
  assert.equal(objectViewFamily(OBJECT_VIEW_FAMILY_OBJECTS).length, 62);
});

test("у каждого изображения метки есть человеческое имя", () => {
  // Ключи реестра технические (`switchToggle`, `panelBox`), а выбирают по
  // имени и по картинке. Имён вещей чертежа здесь нет нарочно: их имя — имя
  // каталога, и второго у вещи быть не должно.
  const named = Object.keys(strings.markViews).sort();
  const expected = OBJECT_VIEW_FAMILIES.filter((family) => family !== OBJECT_VIEW_FAMILY_OBJECTS)
    .flatMap((family) => objectViewFamily(family))
    .sort();
  assert.deepEqual(named, expected, "имя есть не у каждого изображения метки (или имя лишнее)");
  for (const family of OBJECT_VIEW_FAMILIES) {
    if (family === OBJECT_VIEW_FAMILY_OBJECTS) continue;
    assert.ok(strings.dictionary.viewFamilies[family], family + ": у раздела сетки нет названия");
  }
});

// ——— лестница ADR 005 ——————————————————————————————————————————————————

test("имя у типа старше формы знака, форма — старше ничего", () => {
  const project = legacy();
  const lamp = byCode(project, "ЛЮ");
  // Своего имени нет — изображение выводится по знаку категории.
  assert.equal(typeViewOwn(lamp), null);
  assert.equal(typeViewName(project, lamp.id), "lamp");
  // Имя задано — оно и отвечает, знак при этом не тронут.
  const after = setTypeView(project, lamp.id, "chandelier").project;
  assert.equal(typeViewName(after, lamp.id), "chandelier");
  assert.equal(byCode(after, "ЛЮ").shape, byCode(project, "ЛЮ").shape);
  // Знака с изображением нет вовсе — и выдумывать его нечем.
  assert.equal(typeViewName(project, byCode(project, "Н").id), null);
});

// ——— предложение: три условия, и каждое молчит в своём случае ———————————

test("общая база предлагает изображение шести типам старого объекта", () => {
  const project = legacy();
  assert.deepEqual(
    typeViewReview(project).map((row) => [row.code, row.now, row.view]),
    DIVERGED,
    "список на правку разошёлся с тем, что и правда разошлось",
  );
});

test("база молчит там, где спрашивать нечего", () => {
  const project = legacy();
  // 1. У типа есть своё имя — человек уже ответил.
  const own = setTypeView(project, byCode(project, "ЛЮ").id, "lamp").project;
  assert.equal(typeViewOffer(own, byCode(own, "ЛЮ").id), null, "база спорит с ответом человека");
  // 2. В базе этого кода нет — тип заведён руками.
  const made = addType(project, { code: "ХХ", name: "Своё", categoryId: project.categories[0].id });
  assert.equal(typeViewOffer(made.project, made.type.id), null, "база предлагает что-то типу не из неё");
  // 3. Предложенное совпадает с нынешним: «Подсветка зеркала» и так приходит
  //    к `mirror` по знаку, и строка о ней была бы вопросом без разницы.
  const mirror = byCode(project, "ПЗ");
  assert.equal(typeViewName(project, mirror.id), "mirror");
  assert.equal(typeViewOffer(project, mirror.id), null);
  // И у нового объекта предложений нет ни одного: справочник приехал с именами.
  assert.deepEqual(typeViewReview(createProject({ name: "Новый" })), []);
});

test("мастер-выключателю база не предлагает ничего, и круг с подвесом остался светильником", () => {
  // Таск 216 отказался отдавать люстре знак «Круг с подвесом» (`circle-rays`)
  // именно потому, что его носит мастер-выключатель заказчика. Этот таск знак
  // не трогает ни одной строкой — и доказывается это здесь.
  assert.equal(objectViewForShape("circle-rays").name, "lamp");
  const master = defaultTemplate().markTypes.find((type) => type.code === "МВ");
  assert.ok(master, "мастер-выключатель пропал из шаблона");
  assert.equal(typeObjectView(master), null, "у МВ появилось имя — он приходит к изображению знаком");
  const project = legacy();
  const mine = byCode(project, "МВ");
  if (mine) assert.equal(typeViewOffer(project, mine.id), null, "базе нечего предложить МВ, а она предложила");
});

// ——— правка: своя команда, и она же убирает ————————————————————————————

test("имя задаётся и убирается, а негодное не принимается", () => {
  const project = legacy();
  const id = byCode(project, "ЛЮ").id;
  const set = setTypeView(project, id, "chandelier");
  assert.equal(set.project.markTypes.find((type) => type.id === id).view, "chandelier");
  // То же имя второй раз — тот же объект: пустого шага истории быть не должно.
  assert.equal(setTypeView(set.project, id, "chandelier").project, set.project);
  // Убрали — ключа нет вовсе, тип стал ровно таким, каким был (G68).
  const cleared = setTypeView(set.project, id, null).project;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(cleared.markTypes.find((type) => type.id === id), "view"),
    "после «по знаку» у типа остался пустой ключ",
  );
  assert.deepEqual(cleared.markTypes.find((type) => type.id === id), byCode(project, "ЛЮ"));
  // Прежнее имя поля (`icon`, таск 135) читается, но «по знаку» убирает и его:
  // иначе кнопка говорила бы «своего нет», а изображение оставалось прежним.
  const old = {
    ...project,
    markTypes: project.markTypes.map((type) => (type.id === id ? { ...type, icon: "chandelier" } : type)),
  };
  assert.equal(typeViewName(old, id), "chandelier");
  const dropped = setTypeView(old, id, null).project;
  assert.equal(typeViewName(dropped, id), "lamp");
  // Имени, которого в реестре нет, справочник не принимает: ключ, не рисующий
  // ничего, хуже отсутствия ключа.
  assert.throws(() => setTypeView(project, id, "нетакого"), /изображения/);
  assert.throws(() => addType(project, { code: "ХХ", name: "Х", categoryId: project.categories[0].id, view: "нет" }));
});

test("применение не задевает ни один другой тип", () => {
  const project = legacy();
  const before = viewsOf(project);
  const lamp = byCode(project, "ЛЮ");
  const after = applyTypeViewOffers(project, [lamp.id]).project;
  const changed = viewsOf(after).filter((row, index) => row !== before[index]);
  assert.deepEqual(changed, ["ЛЮ=chandelier"], "правка одного типа поехала по соседям");
  // В том числе у соседей по знаку: двенадцать типов света делят `circle-cross`,
  // и люстра уходит от них одна.
  assert.equal(typeViewName(after, byCode(after, "Т").id), "lamp");
  assert.equal(typeViewName(after, byCode(after, "Бр").id), "lamp");
  // И у соседей по предложению: ЩС и ВП делят `square-cross`, предложение
  // есть только у ЩС.
  const panels = applyTypeViewOffers(project, [byCode(project, "ЩС").id]).project;
  assert.equal(typeViewName(panels, byCode(panels, "ЩС").id), "panelBox");
  assert.equal(typeViewName(panels, byCode(panels, "ВП").id), "data");
});

test("применить все — один шаг, и после него предлагать нечего", () => {
  const project = legacy();
  const result = applyTypeViewOffers(project);
  assert.deepEqual(result.applied.map((row) => row.code), DIVERGED.map(([code]) => code));
  assert.deepEqual(typeViewReview(result.project), []);
  for (const [code, , view] of DIVERGED) {
    assert.equal(typeViewName(result.project, byCode(result.project, code).id), view, code + ": не применилось");
  }
  // Применять нечего — тот же объект: отмене нечего возвращать.
  assert.equal(applyTypeViewOffers(result.project).project, result.project);
});

// ——— G68: старый файл открывается как закрывался ————————————————————————

test("G68: старый объект доезжает через файл без единого имени изображения", async () => {
  const project = legacy();
  const file = await packProject(project, new Map());
  const { project: loaded } = await unpackProject(file);
  // Сверка та же, что у таска 123: версия формата не в счёте (файл всегда
  // сохраняется нынешней), всё остальное — байт в байт.
  const strip = (value) => JSON.stringify({ ...value, formatVersion: null }, null, 2);
  assert.equal(strip(loaded), strip(legacy()), "открытие старого объекта что-то в нём поправило");
  assert.equal(loaded.formatVersion, FORMAT_VERSION);
  // Ни у одного типа не появилось ни `view`, ни `icon` — в отличие от размеров
  // (D28), которые миграция и правда проставляет. Разница названа вслух:
  // размер у типа без размеров — это ноль сведений, а изображение решает
  // картинку на развёртке и тело в объёме, и подставить его молча значит
  // открыть объект другим, чем он закрывался.
  for (const type of loaded.markTypes) {
    assert.ok(!Object.prototype.hasOwnProperty.call(type, "view"), type.code + ": миграция задала изображение");
    assert.ok(!Object.prototype.hasOwnProperty.call(type, "icon"), type.code + ": миграция задала изображение");
  }
  // Метки, номера и подписи — те же.
  assert.deepEqual(loaded.marks, legacy().marks);
  assert.deepEqual(loaded.counters, legacy().counters);
  assert.deepEqual(
    loaded.marks.map((mark) => labelOf(loaded, mark.id)),
    legacy().marks.map((mark) => labelOf(legacy(), mark.id)),
  );
  // А список на правку при этом есть: предложение показано, а не применено.
  assert.equal(typeViewReview(loaded).length, 6);
});

test("G68: применённое изображение не трогает метки, номера и подписи", () => {
  const project = legacy();
  const after = applyTypeViewOffers(project).project;
  assert.deepEqual(after.marks, project.marks, "правка справочника задела метки");
  assert.deepEqual(after.counters, project.counters, "правка справочника задела нумерацию");
  assert.deepEqual(
    after.marks.map((mark) => labelOf(after, mark.id)),
    project.marks.map((mark) => labelOf(project, mark.id)),
  );
  // У типов изменился **один** ключ и только он.
  after.markTypes.forEach((type, index) => {
    const was = project.markTypes[index];
    const added = Object.keys(type).filter((key) => !Object.prototype.hasOwnProperty.call(was, key));
    assert.deepEqual(added, added.length ? ["view"] : [], type.code + ": появилось что-то кроме изображения");
    for (const key of Object.keys(was)) assert.deepEqual(type[key], was[key], type.code + ": задето поле " + key);
  });
});

// ——— где человек это видит ——————————————————————————————————————————————

test("расхождение видно строкой в предупреждениях, и строка закрывается ответом", () => {
  const project = legacy();
  const problems = validate(project).filter((problem) => problem.code === "typeViewOffer");
  assert.equal(problems.length, 6);
  for (const problem of problems) assert.equal(problem.kind, "warning", "это находка, а не поломка");
  assert.equal(
    problems[0].message,
    text("problems.typeViewOffer", { code: "ЛЮ", name: byCode(project, "ЛЮ").name }),
  );
  const model = warningsModel(project);
  const group = model.groups.find((item) => item.code === "typeViewOffer");
  assert.equal(group.count, 6);
  assert.equal(group.title, text("warnings.groups.typeViewOffer", { count: 6 }));
  // Строке мало текста: ей нужны имена изображений, чтобы нарисовать «нынешнее
  // → предложенное», и тип, чтобы применить.
  assert.deepEqual(
    group.items.map((item) => [item.offer.code, item.offer.now, item.offer.view]),
    DIVERGED,
  );
  // Ответ «так и задумано» закрывает строку навсегда — и ложится в сам объект,
  // как остальные принятые: механизм тот же, своего признака у этой строки нет.
  const accepted = acceptProblem(project, problems[0]).project;
  const shown = (value) => {
    const found = warningsModel(value).groups.find((item) => item.code === "typeViewOffer");
    return found ? found.count : 0;
  };
  assert.equal(shown(accepted), 5, "крестик строку не закрыл");
  assert.ok(
    acceptedProblems(accepted).some((record) => record.key === problems[0].key),
    "ответ не уехал в сам объект — на другой машине его бы не было",
  );
  // Переименование кода уже отвеченного вопроса не возвращает, а вот
  // применение — убирает строку из списка совсем.
  const renamed = updateType(accepted, byCode(accepted, "ЛЮ").id, { code: "ЛЮС" }).project;
  assert.equal(shown(renamed), 5);
  assert.equal(shown(applyTypeViewOffers(accepted).project), 0);
});

test("справочник показывает то же: своё имя, выведенное и предложенное", () => {
  const project = legacy();
  // Карта «изображение → типы, которые к нему приходят»: по ней в сетке видно,
  // что изображение общее и выбор его ни у кого ничего не отнимает.
  const used = typesViewsInUse(project);
  assert.deepEqual(used.get("lamp"), ["Т", "С", "ПК", "ТР", "ПС", "Л", "ПШ", "ППл", "ПКШ", "ЛЮ", "Бр", "ПЛ"]);
  // Мастер-выключатель приходит к своему изображению знаком, и к светильнику
  // его не тянет: знак «Круг с подвесом» тут ни при чём (таск 216).
  assert.equal(typeViewName(project, byCode(project, "МВ").id), "switch1");
  assert.equal(used.has("chandelier"), false, "к люстре в старом объекте ещё никто не приходит");
  assert.deepEqual(used.get("data"), ["ПП", "ВП", "ЩС"]);
});

// ——— сетка выбора ———————————————————————————————————————————————————————

test("сетка изображений: разделы реестра, затем каталог вещей чертежа", () => {
  const groups = typeViewGroups("");
  const tiles = groups.flatMap((group) => group.entries);
  // Сто три из ста четырёх: общий вид «Сантехника»
  // (`plumbing`) помечен в каталоге `legacy` и из плиток спрятан — ею больше не
  // размечают. Прячет её окно, а не каталог, и показывает обратно, пока такое
  // изображение стоит у самого типа.
  assert.equal(tiles.length, 103, "в сетке не все изображения реестра");
  assert.equal(
    typeViewGroups("", { key: "plumbing" }).flatMap((group) => group.entries).length,
    104,
    "своё изображение типа пропало из сетки — человек не видит, чем он размечен",
  );
  assert.deepEqual(
    groups.map((group) => group.category),
    [...OBJECT_VIEW_FAMILIES.filter((family) => family !== OBJECT_VIEW_FAMILY_OBJECTS), "furniture", "sanitary",
      "appliances", "stairway", "structures", "engineering", "electrics", "decor", "transport"],
    "порядок разделов сетки разошёлся с порядком реестра и каталога",
  );
  // Имена — человеческие, у обеих половин.
  const lamp = tiles.find((entry) => entry.key === "lamp");
  assert.equal(lamp.name, "Светильник");
  assert.equal(tiles.find((entry) => entry.key === "bed").name, "Кровать");
  // Поиск сужает — и по имени, и по разделу.
  assert.deepEqual(
    typeViewGroups("люстр").flatMap((group) => group.entries.map((entry) => entry.key)),
    ["chandelier"],
  );
  assert.ok(typeViewGroups("свет").length === 1, "запрос по разделу не собрал раздел");
  assert.deepEqual(typeViewGroups("такогонет"), []);
});

test("сетка помечает предложенное и говорит, кто уже пользуется", () => {
  const project = legacy();
  const used = typesViewsInUse(project);
  const groups = typeViewGroups("", { key: "lamp", offer: "chandelier", used });
  const tiles = groups.flatMap((group) => group.entries);
  const chandelier = tiles.find((entry) => entry.key === "chandelier");
  assert.equal(chandelier.offer, true, "предложенная плитка не помечена");
  assert.ok(chandelier.title.includes(strings.dictionary.viewOfferBadge));
  const lamp = tiles.find((entry) => entry.key === "lamp");
  assert.equal(lamp.offer, false);
  // Занятость — сведение, а не запрет: плитку видно, выбрать её можно, и в
  // подсказке написано, кто к ней приходит.
  assert.ok(lamp.title.includes("Т, С, ПК"), "в подсказке не сказано, кто уже пользуется изображением");
});

// ——— общая база приносит имя вместе с типом ————————————————————————————

test("тип из общей базы приезжает со своим изображением", () => {
  // До этого таска имя оставалось дома: ЛЮ, добавленная в старый объект, снова
  // становилась шайбой — то же требование G327, провалившееся другим путём.
  const empty = { ...legacy(), markTypes: [], categories: [], counters: {} };
  const offer = catalogOffer(empty, null);
  const light = offer.find((group) => group.category.name === "Свет");
  assert.equal(light.types.find((row) => row.code === "ЛЮ").view, "chandelier");
  const added = addTypesFromCatalog(empty, null, ["ЛЮ", "Н"]);
  assert.equal(typeViewName(added.project, byCode(added.project, "ЛЮ").id), "chandelier");
  assert.equal(typeViewName(added.project, byCode(added.project, "Н").id), "nightLight");
  // И предлагать добавленным нечего — имя у них уже своё.
  assert.deepEqual(typeViewReview(added.project), []);
});

test("сохранённый шаблон уносит имя изображения в новый объект", () => {
  // Новый объект создаётся из сохранённого шаблона, а не из встроенного
  // справочника: не вези шаблон имя — и люстра в нём снова стала бы шайбой.
  const saved = {
    categories: [{ id: "c", name: "Свет", color: "#F2CC0C", shape: "circle" }],
    markTypes: [
      { categoryId: "c", code: "ЛЮ", name: "Люстра", kind: "point", shape: null, view: "chandelier" },
      { categoryId: "c", code: "Т", name: "Точечный", kind: "point", shape: null, view: "нетакого" },
    ],
  };
  const template = typesTemplateFrom(saved);
  assert.equal(template.markTypes[0].view, "chandelier");
  // Имя, которого в реестре больше нет, не едет: ключ, не рисующий ничего,
  // хуже отсутствия ключа.
  assert.ok(!Object.prototype.hasOwnProperty.call(template.markTypes[1], "view"));
  // `createProject` берёт шаблон **первым доводом**, а не полем: обёртка
  // `{template}` молча свалилась бы на встроенный справочник, и тест позеленел
  // бы, ничего не проверив.
  const project = createProject(template);
  assert.deepEqual(project.markTypes.map((type) => type.code), ["ЛЮ", "Т"]);
  assert.equal(typeViewName(project, byCode(project, "ЛЮ").id), "chandelier");
});

test("новый объект из шаблона без имён встречает человека молча", () => {
  // Шаблон, сохранённый до этого таска, имён не несёт — и у нового объекта
  // справочник правда расходится с базой. Но строк он не получает: человек
  // этих изображений не выбирал, он только что нажал «Создать объект».
  // Механизм тот же, что у повтора знака и похожих цветов
  // (`DICTIONARY_PROBLEM_CODES`): принято за него, список принятых виден, и
  // любая строка возвращается одним нажатием.
  const old = {
    categories: [{ id: "c", name: "Свет", color: "#F2CC0C", shape: "circle" }],
    markTypes: [{ categoryId: "c", code: "ЛЮ", name: "Люстра", kind: "point", shape: null }],
  };
  const project = createProject(typesTemplateFrom(old));
  assert.equal(typeViewReview(project).length, 1, "предложение есть — справочник и правда разошёлся");
  const shown = warningsModel(project).groups.find((group) => group.code === "typeViewOffer");
  assert.equal(shown, undefined, "новый объект встретил человека жёлтой строкой");
  assert.equal(
    acceptedProblems(project).filter((record) => record.code === "typeViewOffer").length,
    1,
    "ответ не записан — строка вернётся при первой же правке",
  );
});
