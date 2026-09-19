// Порядок строк в списке меток: выделенная — первая.
//
// Заказчик: «в списке меток каждую метку при выделении поднимай вверх».
// Главный риск такой правки не в том, что строка не поднимется, а в том, что
// список начнёт мельтешить: если каждое движение перебора перекладывает
// строки, читать его станет нельзя. Поэтому здесь проверяется не только
// «встала первой», но и сколько строк при этом сдвинулось.
import test from "node:test";
import assert from "node:assert/strict";
import { addMark, addScheme, createProject } from "../src/model.js";
import { filtersMarkRows } from "../src/panels/filters.js";
import { marksSelectedFirst } from "../src/panels/marks.js";

// Десяток меток трёх типов — столько же, сколько ставят на комнату: на трёх
// строках свойство «сдвинулась одна» не отличить от «сдвинулись все».
function board() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const codes = ["Т", "В", "Р"];
  for (let index = 0; index < 12; index += 1) {
    const result = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: typeOf(codes[index % codes.length]),
      kind: "point",
      points: [{ x: 0.1 + index / 100, y: 0.5 }],
    });
    project = result.project;
  }
  const rows = filtersMarkRows(project, scheme.scheme.id, null);
  return {
    rows,
    natural: rows.map((row) => row.mark.id),
    order: (selected) => marksSelectedFirst(rows, selected).map((row) => row.mark.id),
  };
}

// Позиции, на которых два порядка расходятся. Это и есть мера мельтешения:
// сколько строк сменило содержимое на глазах у пользователя.
function moved(before, after) {
  const places = [];
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) places.push(index);
  }
  return places;
}

test("выделенная метка встаёт первой, остальные остаются в своём порядке", () => {
  const list = board();
  const pick = list.natural[5];
  const shown = list.order([pick]);
  assert.equal(shown[0], pick);
  // Прочие не пересортированы: выделенная выдернута, остальные как были.
  assert.deepEqual(
    shown.slice(1),
    list.natural.filter((id) => id !== pick),
  );
  assert.equal(shown.length, list.natural.length, "строка не потерялась и не задвоилась");
});

test("снятие выделения возвращает строку на место", () => {
  const list = board();
  assert.deepEqual(list.order([]), list.natural);
  assert.deepEqual(list.order(null), list.natural);
  // Наверху не копятся «недавно потроганные»: порядок по типам возвращается
  // сам, без отдельной команды.
  assert.deepEqual(list.order(undefined), list.natural);
});

test("выделено несколько — наверх идут все, в порядке списка, а не нажатий", () => {
  const list = board();
  const [first, second, third] = [list.natural[7], list.natural[2], list.natural[9]];
  const shown = list.order([first, second, third]);
  // Порядок наверху — тот же, что был в списке: блок из трёх меток иначе
  // читался бы как ошибка нумерации.
  assert.deepEqual(shown.slice(0, 3), [list.natural[2], list.natural[7], list.natural[9]]);
  assert.deepEqual(
    shown.slice(3),
    list.natural.filter((id) => ![first, second, third].includes(id)),
  );
});

test("перебор соседних меток не двигает список: меняются ровно две позиции", () => {
  const list = board();
  let before = list.order([list.natural[0]]);
  for (let index = 1; index < list.natural.length; index += 1) {
    const after = list.order([list.natural[index]]);
    const places = moved(before, after);
    // Первая позиция — новая метка, вторая — слот, который прежняя вернула
    // себе. У соседей это один и тот же слот, поэтому ниже не двигается
    // ничего: ни одна строка не уезжает под курсором.
    assert.deepEqual(places, [0, index], "шаг перебора переложил лишние строки: " + places.join(","));
    before = after;
  }
});

test("прыжок через полсписка сдвигает только то, что лежит между метками", () => {
  const list = board();
  const from = 2;
  const to = 9;
  const places = moved(list.order([list.natural[from]]), list.order([list.natural[to]]));
  // Сдвинулась голова и участок между прежней и новой меткой; всё, что выше
  // ближней и ниже дальней, стоит на месте.
  assert.deepEqual(places, [0, 3, 4, 5, 6, 7, 8, 9]);
  const after = list.order([list.natural[to]]);
  assert.deepEqual(after.slice(1, from + 1), list.natural.slice(0, from));
  assert.deepEqual(after.slice(to + 1), list.natural.slice(to + 1));
});

test("выделение чужой метки список не трогает", () => {
  const list = board();
  // Метка с другой схемы или уже удалённая: строк с таким id в списке нет —
  // поднимать нечего, и порядок обязан остаться прежним.
  assert.deepEqual(list.order(["нет-такой-метки"]), list.natural);
  assert.deepEqual(marksSelectedFirst([], ["нет-такой-метки"]), []);
});
