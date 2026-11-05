// Окно размеров метки: подписи полей, разбор введённого и подпись кнопки.
//
// Проверяется чистая часть — то, по чему видно, заданы ли у метки размеры,
// не открывая окна, и то, что окно примет, а что отвергнет. Сам диалог, как и
// остальные, живой приёмкой.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  fillTypeSizes,
  MARK_DIMENSION_FIELDS,
  MARK_DIMENSION_MAX,
  MARK_DIMENSION_SIGNED,
  MARK_DIMENSION_UNIT,
  addMark,
  addScheme,
  addToGroup,
  createProject,
  findMark,
  markSizes,
  setMarkDimensions,
} from "../src/model.js";
import { strings } from "../src/strings.js";
import { markSizesInherited, markSizesLabel, markSizesParse, markSizesSummary } from "../src/panels/markSizes.js";

function markWith(values) {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const added = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.3, y: 0.3 }],
  });
  project = values ? setMarkDimensions(added.project, added.mark.id, values).project : added.project;
  return findMark(project, added.mark.id);
}

test("единица видна в каждой подписи и написана в словаре один раз", () => {
  // Единица в модели и единица на экране — одна и та же мера, объявленная в
  // двух местах: `MARK_DIMENSION_UNIT` говорит, что лежит в поле, строка
  // словаря — как это называется по-русски.
  assert.equal(MARK_DIMENSION_UNIT, "mm");
  assert.equal(strings.markSizes.unit, "мм");

  for (const field of MARK_DIMENSION_FIELDS) {
    const label = markSizesLabel(field);
    assert.ok(label.endsWith(strings.markSizes.unit), "в подписи не видно единицы: " + label);
    assert.ok(!label.includes("{"), "подстановка не сработала: " + label);
  }
  assert.equal(markSizesLabel("heightAboveFloor"), "Высота над полом, мм");

  // В самих строках словаря единица не написана словом — только подстановкой:
  // иначе смена меры стоила бы не одну правку.
  for (const field of MARK_DIMENSION_FIELDS) {
    assert.ok(strings.markSizes[field].includes("{unit}"), "единица вписана в подпись руками: " + field);
  }
});

test("подпись кнопки показывает заданные размеры и молчит о незаданных", () => {
  assert.equal(markSizesSummary(markWith(null)), "");
  // Габарит пишется как на чертеже — Д · Ш · В, — и посадка идёт за ним. У
  // высоты над полом буквы нет: «В» с таска 158 занято высотой вещи, и два
  // разных числа под одной буквой в одной строке читались бы как одно.
  assert.equal(
    markSizesSummary(markWith({ length: 900, depth: 200, width: 300, heightAboveFloor: 2300 })),
    "Д 900 · Ш 200 · В 300 · от пола 2300 мм",
  );
  // Заданные показываются, пустые пропускаются — а не встают прочерком.
  assert.equal(markSizesSummary(markWith({ heightAboveFloor: 300 })), "от пола 300 мм");
  assert.equal(markSizesSummary(markWith({ length: 1500, heightAboveFloor: 0 })), "Д 1500 · от пола 0 мм");
  // Вертикальная лента заказчика: «надо указать высоту от пола до потолка».
  assert.equal(markSizesSummary(markWith({ length: 40, width: 2700 })), "Д 40 · В 2700 мм");
  // Утопленное — минус у ширины: щит в нише уходит за плоскость стены.
  assert.equal(markSizesSummary(markWith({ depth: -30 })), "Ш -30 мм");
  // Дробное в подписи — через запятую, как его и набирают.
  assert.equal(markSizesSummary(markWith({ width: 1.5 })), "В 1,5 мм");
  // Метки нет вовсе (окно открыли, а метку успели удалить) — пустая строка.
  assert.equal(markSizesSummary(null), "");
});

// ——— унаследованное видно числом (таск 243, требование G365) ——————————————
//
// Заказчик смотрел в карточку выключателя и сказал «размеры ни у чего не
// указаны», а на переспрос — «у самих меток поля размеров пустые». Числа при
// этом были: лестница `markSizes` берёт их у группы (G203) и у типа (G192), и
// объём рисует именно по ним. Пустой была только подпись — она считалась по
// `markDimensions`. Тесты держат новое правило: показывается то число, по
// которому рисует сборка, и сказано, откуда оно.

function markOfType(code, values) {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const typeId = project.markTypes.find((type) => type.code === code).id;
  const added = addMark(project, { schemeId: scheme.scheme.id, typeId, kind: "point", points: [{ x: 0.3, y: 0.3 }] });
  project = values ? setMarkDimensions(added.project, added.mark.id, values).project : added.project;
  return { project, markId: added.mark.id };
}

const summaryOf = (project, markId) => markSizesSummary(markSizes(project, findMark(project, markId)));

test("сводка ставит унаследованное в скобки и говорит, откуда оно", () => {
  // Выключатель стартового справочника: 80 × 80 × 10 на высоте 900 — ровно те
  // числа, которых заказчик не нашёл в карточке.
  const box = markOfType("В", null);
  assert.equal(summaryOf(box.project, box.markId), "Д (80) · Ш (10) · В (80) · от пола (900) мм · из типа");

  // Та же метка своими полями — пусто, как до таска: `markDimensions` ничего
  // не наследует, и сводка от этого не изменилась ни одним знаком. Этим же
  // путём её зовёт справочник для умолчаний типа — там наследовать не от кого.
  assert.equal(markSizesSummary(findMark(box.project, box.markId)), "");

  // Своё число перебивает унаследованное и встаёт **без** скобок: одна строка
  // отвечает и «чем рисуют», и «что из этого моё».
  const own = setMarkDimensions(box.project, box.markId, { heightAboveFloor: 1200 }).project;
  assert.equal(summaryOf(own, box.markId), "Д (80) · Ш (10) · В (80) · от пола 1200 мм · из типа");

  // Стёртое поле возвращает наследование — и строка возвращается к прежней.
  const cleared = setMarkDimensions(own, box.markId, { heightAboveFloor: null }).project;
  assert.equal(summaryOf(cleared, box.markId), summaryOf(box.project, box.markId));
});

test("высота из блока названа группой, а не типом", () => {
  // Розетка на 1100 — кухонная над столешницей; у типа умолчание 300, и
  // соседка по блоку обязана поехать за соседкой, а не за справочником (G203).
  const box = markOfType("Р", { heightAboveFloor: 1100 });
  const grown = addToGroup(box.project, box.markId, "right");
  const sizes = markSizes(grown.project, findMark(grown.project, grown.mark.id));
  assert.equal(sizes.heightAboveFloor, 1100);
  assert.equal(sizes.heightAboveFloorFrom, "group");
  // «Из типа и группы» читается однозначно: делиться группе нечем, кроме
  // высоты над полом, — значит от пола из группы, габарит из типа.
  assert.equal(
    markSizesSummary(sizes),
    "Д (80) · Ш (10) · В (80) · от пола (1100) мм · из типа и группы",
  );
  // У самой соседки с её своей высотой в скобках только габарит.
  assert.equal(summaryOf(grown.project, box.markId), "Д (80) · Ш (10) · В (80) · от пола 1100 мм · из типа");
});

test("окно получает то число, которое встанет в поле, если его очистить", () => {
  const box = markOfType("В", { heightAboveFloor: 1200, length: 55 });
  const before = JSON.stringify(box.project);
  const mark = findMark(box.project, box.markId);
  const inherited = markSizesInherited(box.project, mark);

  // Заполненное рукой поле не закрывает собой наследство: в подсказке стоит
  // то, что вернётся, когда поле опустеет. Иначе окно показывало бы подсказку
  // только тем полям, которые и так пусты, — и человек, стирая своё число, не
  // знал бы, чем оно сменится.
  assert.equal(inherited.heightAboveFloor, 900);
  assert.equal(inherited.heightAboveFloorFrom, "type");
  assert.equal(inherited.length, 80);
  // Своего в ответе нет ни одного поля: окно показывает наследство, а не метку.
  for (const field of MARK_DIMENSION_FIELDS) {
    assert.notEqual(inherited[field + "From"], "own", "в наследство попало своё число: " + field);
  }

  // **G68: показ наследования не равен его записи.** Ни объект, ни метка от
  // спроса не изменились ни одним ключом — считается он по копии метки.
  assert.equal(JSON.stringify(box.project), before, "спрос наследства тронул объект");
  assert.deepEqual(findMark(box.project, box.markId), mark);
  assert.equal(mark.depth, undefined, "унаследованное число записалось в метку");
});

test("наследовать нечего — окно не обещает ничего", () => {
  // Свой тип без умолчаний (дефект D28 у заказчика: сорок девять таких): за
  // меткой нет ни группы, ни справочника, и подсказке взяться неоткуда.
  const project = {
    markTypes: [{ id: "a", code: "ЧЕГОНЕТ", name: "Своё" }],
    marks: [{ id: "m", typeId: "a", kind: "point", points: [{ x: 0.1, y: 0.1 }] }],
  };
  assert.equal(markSizesInherited(project, project.marks[0]), null);
  // Метку успели удалить, пока окно открывали — не поломка.
  assert.equal(markSizesInherited(project, null), null);
  assert.equal(markSizesSummary(markSizes(project, project.marks[0])), "");
});

// Само окно DOM-тестами не покрыто (как и остальные) — читается текст, тот же
// приём, что в проверке ширины ниже: правило «унаследованное показывается
// подсказкой, а не значением» молча перевернулось бы в одну строку.
test("унаследованное идёт подсказкой поля, а значением остаётся только своё", () => {
  const source = readFileSync(new URL("../src/panels/markSizes.js", import.meta.url), "utf8");
  assert.match(
    source,
    /value: current\[field\] === null \? "" : String\(current\[field\]\)/,
    "в поле ввода попало что-то, кроме своих размеров метки (G68)",
  );
  assert.match(source, /placeholder: fallback === null \? "" : markSizesNumber\(fallback\)/, "унаследованное перестало быть подсказкой");
  // Строки «Унаследовано из типа» считаются по **пустым** полям: что человек
  // заполнил — то уже своё.
  assert.match(source, /String\(inputs\.get\(field\)\.value\)\.trim\(\) === ""/, "строка наследования перестала смотреть на пустоту поля");
  // Бледная подсказка — единственное, чем унаследованное число отличается от
  // набранного своего, и проверить это больше негде: стили прогон не читает.
  const body = readFileSync(new URL("../src/panels/marks.css", import.meta.url), "utf8");
  assert.match(body, /\.sizes__input::placeholder \{/, "унаследованное число перестало отличаться от набранного");
  assert.match(body, /\.sizes__inherited:empty \{\n  display: none;/, "пустой набор строк наследования занял место под полями");
});

// ——— имена осей (таск 158, требование G233) ——————————————————————————————
//
// Слова заказчика: «у меток ещё должна быть характеристика Высота. И в
// интерфейсе сделай 3 поля рядом : Длина, Ширина, Высота». Высота в объекте
// лежала с самого начала — звалась «Шириной», а ширина звалась «Выступом от
// стены». Тест держит подписи: разойдись они с осями снова, и чертёж прочтут
// неверно, а заметят это на монтаже.
test("подписи полей названы по осям, а тройка габаритов стоит перед посадкой", () => {
  assert.deepEqual(MARK_DIMENSION_FIELDS, ["length", "depth", "width", "heightAboveFloor"]);
  assert.equal(markSizesLabel("length"), "Длина, мм");
  assert.equal(markSizesLabel("depth"), "Ширина, мм");
  assert.equal(markSizesLabel("width"), "Высота, мм");
  assert.equal(markSizesLabel("heightAboveFloor"), "Высота над полом, мм");
  // Высота над полом — не габарит, и в тройку не входит: окно ставит её своей
  // строкой под ней.
  assert.deepEqual(MARK_DIMENSION_FIELDS.slice(0, 3), ["length", "depth", "width"]);
  // Минус бывает только у ширины: утопленное — та же ось в другую сторону.
  assert.deepEqual(MARK_DIMENSION_SIGNED, ["depth"]);
  assert.equal(markSizesParse({ depth: "-30" }).values.depth, -30);
  assert.deepEqual(markSizesParse({ width: "-30" }).invalid.map((item) => item.field), ["width"]);
});

test("окно разбирает поля по правилам модели: пусто — не задано, ноль — значение", () => {
  const empty = markSizesParse({ length: "", width: "   ", heightAboveFloor: "" });
  assert.deepEqual(empty.values, { length: null, width: null, depth: null, heightAboveFloor: null });
  assert.deepEqual(empty.invalid, []);

  const filled = markSizesParse({ length: "600", width: "1,5", heightAboveFloor: "0" });
  assert.deepEqual(filled.values, { length: 600, width: 1.5, depth: null, heightAboveFloor: 0 });
  assert.deepEqual(filled.invalid, []);

  // Поля, которого в форме нет, — то же «не задано», а не поломка.
  assert.deepEqual(markSizesParse({}).values, { length: null, width: null, depth: null, heightAboveFloor: null });
  assert.deepEqual(markSizesParse(null).values, { length: null, width: null, depth: null, heightAboveFloor: null });
});

test("негодное поле называет себя и не закрывает окно молча", () => {
  const bad = markSizesParse({ length: "-1", width: "абв", heightAboveFloor: String(MARK_DIMENSION_MAX + 1) });
  assert.deepEqual(bad.invalid.map((item) => item.field), ["length", "width", "heightAboveFloor"]);
  for (const item of bad.invalid) {
    assert.ok(item.message.length > 0, "негодное поле без объяснения: " + item.field);
    assert.ok(!item.message.includes("{"), "подстановка не сработала: " + item.message);
  }
  // Годное поле рядом с негодным не теряется: окно вернёт его в поле ввода.
  const mixed = markSizesParse({ length: "600", width: "-2", heightAboveFloor: "" });
  assert.equal(mixed.values.length, 600);
  assert.deepEqual(mixed.invalid.map((item) => item.field), ["width"]);
});

// ——— умолчания доходят до справочника, заведённого раньше них ———————————
//
// Дефект D28: у заказчика сорок девять своих типов и ни у одного нет размеров,
// потому что умолчания (таск 139) прописаны в шаблоне и достаются только
// новому объекту. Наследование при этом исправно — наследовать нечего.
test("тип без размеров получает их по коду, а незнакомый остаётся пустым", () => {
  const project = {
    markTypes: [
      { id: "a", code: "Р", name: "Розетка" },
      { id: "b", code: "ЧЕГОНЕТ", name: "Своё" },
      { id: "c", code: "В", name: "Выключатель", sizes: { length: 55 } },
    ],
    marks: [{ id: "m", typeId: "a", points: [{ x: 0.1, y: 0.1 }] }],
  };
  const { project: filled, changed, filled: count } = fillTypeSizes(project);
  assert.equal(changed, true);
  assert.equal(count, 1, "проставить надо ровно тому, у кого пусто");

  const socket = filled.markTypes[0];
  assert.ok(socket.sizes && socket.sizes.length > 0, "розетка обязана получить размеры по коду");

  assert.equal(filled.markTypes[1].sizes, undefined, "незнакомому коду размер не выдумывается");
  assert.deepEqual(filled.markTypes[2].sizes, { length: 55 }, "свой размер не перебивается шаблонным");
  assert.deepEqual(filled.marks, project.marks, "метки не трогаются вовсе");
});

test("повторный проход ничего не меняет — миграция идемпотентна", () => {
  const once = fillTypeSizes({ markTypes: [{ id: "a", code: "Р", name: "Розетка" }], marks: [] });
  const twice = fillTypeSizes(once.project);
  assert.equal(twice.changed, false);
  assert.equal(twice.project, once.project, "второй проход обязан вернуть тот же объект");
});

// ——— ширина окна (таск 175, дефект D41) ————————————————————————————————
//
// «Ширина окна больше чем контент»: карточка брала общую меру диалогов в 720
// точек, а полей в ней три, и триста пикселей справа оставались пустым полем
// с «Отменой» у дальнего края. Класс `modal--fit` для этого и заведён в сетках
// выбора — окно берёт ширину у содержимого, а потолок остаётся прежним.
//
// Сам диалог DOM-тестами не покрыт (как и остальные), поэтому читается текст —
// тот же приём, что в `cssMeasures.test.js`: прогон про стили не говорит
// ничего, а молча вернувшаяся общая мера видна только снимком.
test("окно размеров берёт ширину у содержимого, а не у общей меры диалогов", () => {
  const source = readFileSync(new URL("../src/panels/markSizes.js", import.meta.url), "utf8");
  const dialogs = readFileSync(new URL("../src/panels/panels.css", import.meta.url), "utf8");
  const body = readFileSync(new URL("../src/panels/marks.css", import.meta.url), "utf8");
  assert.match(source, /classList\.add\("modal--fit"\)/, "окно размеров снова тянется на общие 720 точек");
  assert.match(dialogs, /\.modal--fit \{\n  width: fit-content;/, "класс перестал считать ширину по содержимому");
  // Потолок самого содержимого: без него `fit-content` растянулся бы по
  // подсказке, написанной в одну строку.
  assert.match(body, /\.sizes \{[\s\S]*?max-width: \d+px;[\s\S]*?\n\}/, "у содержимого окна нет своего потолка ширины");
});
