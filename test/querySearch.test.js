// Одно правило поиска по строке на все окна (находка 7 разбора механик).
//
// Правил было четыре на пять окон, и урок «с середины слова нельзя» был
// применён в одном из них. Остальные четыре — поиск в шапке, окно выбора типа,
// окно выбора модели оборудования и поле фильтра над списком меток — искали
// серединой строки: одна буква «в» поднимала весь свет («с-в-етильник»), а
// Enter отмечает первую строку, и первой оказывалась не та.
//
// Ранги у окон при этом свои, и сводить их не надо: у типа код сильнее
// названия, в поиске по объекту обозначение сильнее помещения. Проверяется
// здесь именно **правило совпадения** — одно на всех.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  addEquipment,
  addMark,
  addRoom,
  addScheme,
  addType,
  createProject,
  queryHit,
  queryMatches,
  searchEquipment,
  searchProject,
  searchTypes,
  updateMark,
} from "../src/model.js";
import { renderInternals } from "../src/render.js";
import { markControlsMatches } from "../src/panels/markControls.js";
import { strings } from "../src/strings.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

test("правило совпадения: с начала слова, а не серединой строки", () => {
  assert.ok(queryHit("светильник точечный", "свет"));
  assert.ok(queryHit("светильник точечный", "точечный"), "второе слово — тоже начало слова");
  assert.ok(!queryHit("светильник точечный", "в"), "середина слова не ловится");
  assert.ok(!queryHit("светильник точечный", "тильник"));
  // Граница слова — всё, что не буква и не цифра: дефис, точка, скобка.
  assert.ok(queryHit("l-12", "12"));
  assert.ok(queryHit("розетка (кухня)", "кухня"));
  assert.ok(queryHit("gw-1234", "1234"));
  // **Стык буквы и цифры — тоже начало слова.** Обозначение метки это код плюс
  // номер, и «найди четырнадцатую» — обычный вопрос. Без этой половины правила
  // запрос «1» на объекте заказчика находил 206 меток до правки и ноль после
  // (замер живого прогона): цифра оказывалась серединой слова.
  assert.ok(queryHit("в1", "1"));
  assert.ok(queryHit("подсветка2", "2"));
  assert.ok(queryHit("sh-2pm", "pm"));
  // А середина числа — не начало слова: «1» не находит «в21».
  assert.ok(!queryHit("в21", "1"));
  // И буква после буквы серединой слова осталась — ради этого правило и завели.
  assert.ok(!queryHit("тв1", "в"));
  // Пустой запрос подходит всему: поиск сужает список, а не заменяет его.
  assert.ok(queryHit("что угодно", ""));
  assert.ok(!queryHit("", "в"));
  // Та же дверь со строкой как она есть: края и регистр снимаются внутри.
  assert.ok(queryMatches("Светильник", "  СВЕТ "));
  assert.ok(!queryMatches("Светильник", "етиль"));
});

// Квартира с теми самыми строками, на которых урок и выучили: свет в середине
// названий, выключатель с кода «В» и «оригинал» за дефисом.
function searchHouse() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const room = addRoom(project, "Гостиная");
  project = room.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;

  const lamp = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: typeOf("Т"),
    kind: "point",
    points: [{ x: 0.2, y: 0.2 }],
  });
  project = updateMark(lamp.project, lamp.mark.id, {
    roomId: room.room.id,
    location: "над столом",
    original: "L-12",
  }).project;

  const switcher = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: typeOf("В"),
    kind: "point",
    points: [{ x: 0.6, y: 0.4 }],
  });
  project = updateMark(switcher.project, switcher.mark.id, { roomId: room.room.id }).project;
  return { project, schemeId: scheme.scheme.id, lampId: lamp.mark.id, switchId: switcher.mark.id };
}

test("поиск в шапке: «в» поднимает выключатель, а не весь свет", () => {
  const box = searchHouse();
  const found = searchProject(box.project, "в").map((row) => row.markId);
  assert.ok(found.includes(box.switchId), "выключатель В1 начинается с запроса");
  assert.ok(!found.includes(box.lampId), "точечный светильник ловился серединой слова и больше не ловится");
  // Цифры за дефисом — начало слова: «12» находит «L-12» из чужого проекта.
  assert.deepEqual(
    searchProject(box.project, "12").map((row) => row.markId),
    [box.lampId],
  );
  // То, что искали по делу, находится как и раньше.
  assert.deepEqual(
    searchProject(box.project, "столом").map((row) => row.markId),
    [box.lampId],
  );
  assert.deepEqual(
    searchProject(box.project, "гостиная").map((row) => row.markId).sort(),
    [box.lampId, box.switchId].sort(),
  );
});

test("поле фильтра над списком меток ищет тем же правилом", () => {
  const box = searchHouse();
  const scheme = box.project.schemes.find((item) => item.id === box.schemeId);
  const seen = (query) =>
    renderInternals
      .markVisible(box.project, box.project.marks.find((mark) => mark.id === box.lampId), { query })
      ? "есть"
      : "нет";
  assert.equal(seen("столом"), "есть");
  assert.equal(seen("в"), "нет", "фильтр сужает и план, и список — правило обязано быть одно");
  assert.ok(scheme, "схема на месте");
});

test("окно выбора типа ищет название с начала слова", () => {
  let project = createProject({ name: "Квартира" });
  const added = addType(project, { code: "ПКРОВ", name: "Подсветка кровати", categoryId: project.categories[0].id });
  project = added.project;
  const codes = (query) =>
    searchTypes(project, query).flatMap((group) => group.types.map((type) => type.code));
  // «Р» — это Розетка, а не «Под-с-ветка к-р-овати»: буква в середине слова
  // больше не поднимает чужие строки.
  assert.ok(!codes("р").includes("ПКРОВ"));
  assert.ok(codes("р").includes("Р"));
  // Слово названия с начала — находится, как и раньше.
  assert.ok(codes("кровати").includes("ПКРОВ"));
  assert.ok(codes("подсветка").includes("ПКРОВ"));
});

test("окно выбора модели оборудования ищет тем же правилом", () => {
  let project = createProject({ name: "Квартира" });
  project = addEquipment(project, { name: "Светильник Gu10", vendor: "Arlight", code: "GW-1234" }).project;
  const names = (query) => searchEquipment(project, { query }).map((item) => item.name);
  assert.deepEqual(names("светильник"), ["Светильник Gu10"]);
  assert.deepEqual(names("arlight"), ["Светильник Gu10"], "производитель ищется");
  assert.deepEqual(names("gw-1234"), ["Светильник Gu10"], "артикул ищется целиком");
  assert.deepEqual(names("1234"), ["Светильник Gu10"], "и за дефисом внутри артикула");
  assert.deepEqual(names("етиль"), [], "серединой слова — нет");
});

test("окно связей осталось при своём правиле — оно и было правильным", () => {
  const box = searchHouse();
  const row = {
    mark: box.project.marks.find((mark) => mark.id === box.lampId),
    label: "Т1",
    type: box.project.markTypes.find((type) => type.code === "Т"),
    scheme: null,
    room: null,
  };
  assert.ok(markControlsMatches(row, "т1"));
  assert.ok(markControlsMatches(row, "12"));
  assert.ok(!markControlsMatches(row, "тильник"));
});

test("о пустом ответе сказано одними словами", () => {
  // Четыре формулировки на пять окон были одним и тем же ответом, сказанным
  // в соседних окнах по-разному. Оговорки — про дело и остались.
  assert.equal(strings.search.empty, "Ничего не нашлось");
  assert.equal(strings.equipmentPicker.empty, "Ничего не нашлось");
  assert.equal(strings.controls.searchEmpty, "Ничего не нашлось");
  assert.ok(strings.picker.empty.startsWith("Ничего не нашлось"));
  assert.ok(strings.objectPicker.empty.startsWith("Ничего не нашлось"));
  // А это — не про поиск: список меток сужают галочки типов, помещение и
  // строка поиска втроём, и «ничего не нашлось» указало бы на поиск, когда
  // виновата снятая галочка.
  assert.equal(strings.marks.nothingFound, "Под фильтр ничего не подошло");
});

test("второго правила совпадения в исходниках нет", () => {
  // Сканированием: разойдись правила снова — «в» опять поднимало бы весь свет,
  // и прогон бы об этом молчал.
  const files = [
    "model.js",
    "render.js",
    join("panels", "markControls.js"),
    join("panels", "typePicker.js"),
    join("panels", "equipmentPicker.js"),
    join("panels", "search.js"),
    join("panels", "filters.js"),
  ];
  for (const name of files) {
    const text = readFileSync(join(srcDir, name), "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      // `startsWith(needle)` в ранге не ловится нарочно: сила совпадения —
      // дело окна, и сводить её не надо (у типа код сильнее названия).
      assert.ok(
        !/\.includes\(needle\)|\.includes\(query\)/.test(line),
        `${name}:${index + 1} — своё правило совпадения мимо queryHit: ${line.trim()}`,
      );
    }
  }
});
