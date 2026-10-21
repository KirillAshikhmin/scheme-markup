// Список объектов в шапке: пустота не имеет права врать (таск 223, D75).
//
// Дефект нашёлся дважды в разных сессиях: шапка показывала «Объектов пока
// нет», а объект в базе был цел. Замер назвал причину: объект, пришедший **из
// файла**, в список панели не попадал вовсе — `panels/file.js` кладёт его в
// состояние сам, перечитать список не просит, и перерисовка шла по
// устаревшему `known`. На пустой базе (первый запуск + принесённый файл) в
// шапке оставалась одна строка «Объектов пока нет» — то есть «ваша работа
// пропала» ровно в ту минуту, когда работа открыта на экране.
//
// Правило теперь из двух частей, и обе проверяются здесь:
//   1. `known === null` — список не прочитан, `[]` — объектов правда нет;
//      слова у этих пустот разные;
//   2. открытый объект стоит в списке **всегда**, даже если список его ещё не
//      знает.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { projectListItems } from "../src/panels/projects.js";
import { strings } from "../src/strings.js";

test("непрочитанный список и пустая база говорят разными словами", () => {
  assert.equal(projectListItems({ known: null, id: "" }).empty, strings.projects.reading);
  assert.equal(projectListItems({ known: [], id: "" }).empty, strings.projects.empty);
  assert.notEqual(strings.projects.reading, strings.projects.empty);
  // Непрочитанный список пуст — но об этом говорит слово, а не сам список.
  assert.deepEqual(projectListItems({ known: null, id: "" }).items, []);
});

test("открытый объект стоит в списке, даже когда список его ещё не знает", () => {
  // Тот самый случай: объект пришёл из файла, список не перечитан.
  const fresh = projectListItems({ known: null, id: "a1", name: "Городские сады" });
  assert.deepEqual(fresh.items, [{ id: "a1", name: "Городские сады" }]);
  // И когда список прочитан, но без него: объект встаёт первым, остальные целы.
  const stale = projectListItems({ known: [{ id: "b2", name: "Белый дом" }], id: "a1", name: "Городские сады" });
  assert.deepEqual(stale.items, [
    { id: "a1", name: "Городские сады" },
    { id: "b2", name: "Белый дом" },
  ]);
});

test("знакомый объект не задваивается", () => {
  const list = [
    { id: "a1", name: "Городские сады" },
    { id: "b2", name: "Белый дом" },
  ];
  const shown = projectListItems({ known: list, id: "b2", name: "Белый дом" });
  assert.equal(shown.items, list, "список переписали там, где переписывать нечего");
});

test("объект без имени не оставляет в шапке пустую строку", () => {
  const shown = projectListItems({ known: [], id: "a1", name: "" });
  assert.equal(shown.items[0].name, strings.project.untitled);
});

test("список перечитывается, когда объект пришёл со стороны", () => {
  // Это уже не чистое правило, а связь в панели, и держится она по исходнику:
  // подписка на объект обязана звать перечитку, иначе список останется
  // устаревшим до конца сеанса — ровно то, что и было дефектом.
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "panels", "projects.js"), "utf8");
  const subscribe = text.slice(text.lastIndexOf("subscribe((state, changed)"));
  assert.match(subscribe, /refreshIfUnknown\(state\.project\)/, "объект со стороны больше не перечитывает список");
  assert.match(text, /let known = null;/, "«не прочитан» снова стало пустым списком");
});
