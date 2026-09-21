// Цвета помещений и категорий: палитра, выдача незанятого цвета и
// преобразования hex ↔ RGB ↔ HSV.
//
// Всё это ошибается молча: палитра с похожими соседями выглядит как палитра,
// а кривой перевод в HSV даёт цвет, который «почти тот же». Поэтому палитра
// проверяется числами, а не на глаз, и ожидаемые значения взяты снаружи:
// таблицы CIE Lab для базовых цветов и формула контраста из WCAG.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_NEAR_DISTANCE,
  COLOR_SAME_DISTANCE,
  ROOM_PALETTE,
  addRoom,
  colorBlend,
  colorsInUse,
  colorDistance,
  colorFieldToHsv,
  colorHsvToField,
  colorTaken,
  closeCategoryColors,
  createProject,
  freeColor,
  hexToRgb,
  hsvToRgb,
  randomColor,
  rgbToHex,
  rgbToHsv,
  updateCategory,
  updateRoom,
  validate,
} from "../src/model.js";

const HEX_RE = /^#[0-9A-F]{6}$/;

// Относительная яркость по WCAG 2.1 (формула из спецификации, не из кода).
function wcagLuminance(hex) {
  const parts = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = parts.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function wcagContrast(hex, other) {
  const a = wcagLuminance(hex);
  const b = wcagLuminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("в палитре хватает цветов на квартиру, и все они разные", () => {
  assert.ok(ROOM_PALETTE.length >= 20, "цветов в палитре: " + ROOM_PALETTE.length);
  for (const color of ROOM_PALETTE) assert.match(color, HEX_RE);
  assert.equal(new Set(ROOM_PALETTE).size, ROOM_PALETTE.length, "цвет повторяется в палитре");
});

test("цвет палитры виден и на белом плане, и на карандашных стенах", () => {
  for (const color of ROOM_PALETTE) {
    assert.ok(wcagContrast(color, "#FFFFFF") >= 2.9, color + " теряется на белом плане");
    assert.ok(wcagContrast(color, "#000000") >= 2.4, color + " сливается с карандашной стеной");
  }
});

// Опорные значения — из таблиц CIE Lab для sRGB (D65): белый L=100,
// чёрный L=0, красный (53,24; 80,09; 67,20), синий (32,30; 79,19; −107,86).
// Отсюда и расстояния: белый/чёрный = 100, красный/синий ≈ 176,3.
test("расстояние между цветами считается в Lab, а не по сырым байтам", () => {
  assert.equal(colorDistance("#123456", "#123456"), 0);
  assert.ok(Math.abs(colorDistance("#FFFFFF", "#000000") - 100) < 0.5, "белый/чёрный");
  assert.ok(Math.abs(colorDistance("#FF0000", "#0000FF") - 176.3) < 1, "красный/синий");
  assert.ok(Math.abs(colorDistance("#FF0000", "#00FF00") - 170.6) < 1, "красный/зелёный");
  // Серые одной яркости, но разные байты: по сырому RGB далеко, в Lab — рядом.
  assert.ok(colorDistance("#808080", "#7F7F7F") < 1, "соседние серые");
});

test("соседние цвета палитры не спутать", () => {
  let worst = { distance: Infinity, pair: "" };
  for (let i = 0; i < ROOM_PALETTE.length; i += 1) {
    for (let j = i + 1; j < ROOM_PALETTE.length; j += 1) {
      const distance = colorDistance(ROOM_PALETTE[i], ROOM_PALETTE[j]);
      if (distance < worst.distance) worst = { distance, pair: ROOM_PALETTE[i] + " и " + ROOM_PALETTE[j] };
    }
  }
  assert.ok(worst.distance >= 22, "слишком похожи: " + worst.pair + " (" + worst.distance.toFixed(1) + ")");
});

// Разобранный вручную пример: #1F6FEB = (31, 111, 235); максимум — синий,
// размах 204, отсюда оттенок 60·((31−111)/204 + 4) = 216,47°,
// насыщенность 204/235 = 0,8681, яркость 235/255 = 0,9216.
test("hex, RGB и HSV переводятся друг в друга", () => {
  assert.deepEqual(hexToRgb("#1F6FEB"), { r: 31, g: 111, b: 235 });
  assert.deepEqual(hexToRgb("  #1f6feb "), { r: 31, g: 111, b: 235 });
  assert.equal(hexToRgb("синий"), null);
  assert.equal(hexToRgb("#1F6FE"), null);
  assert.equal(rgbToHex({ r: 31, g: 111, b: 235 }), "#1F6FEB");
  // Поля R, G, B принимают что угодно — байт обязан остаться байтом.
  assert.equal(rgbToHex({ r: 300, g: -5, b: 12.6 }), "#FF000D");

  const hsv = rgbToHsv({ r: 31, g: 111, b: 235 });
  assert.ok(Math.abs(hsv.h - 216.47) < 0.05, "оттенок: " + hsv.h);
  assert.ok(Math.abs(hsv.s - 0.8681) < 0.001, "насыщенность: " + hsv.s);
  assert.ok(Math.abs(hsv.v - 0.9216) < 0.001, "яркость: " + hsv.v);
  assert.deepEqual(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, v: 128 / 255 });

  assert.deepEqual(hsvToRgb({ h: 0, s: 1, v: 1 }), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 120, s: 1, v: 128 / 255 }), { r: 0, g: 128, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 0, s: 0, v: 1 }), { r: 255, g: 255, b: 255 });
  // 360° — тот же красный, что и 0°: ползунок оттенка ходит по кругу.
  assert.deepEqual(hsvToRgb({ h: 360, s: 1, v: 1 }), hsvToRgb({ h: 0, s: 1, v: 1 }));
});

test("цвет палитры переживает поездку в HSV и обратно", () => {
  for (const color of ROOM_PALETTE) {
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(color)))), color);
  }
});

test("свободный цвет — первый незанятый, а не следующий по кругу", () => {
  assert.equal(freeColor([]), ROOM_PALETTE[0]);
  assert.equal(freeColor([ROOM_PALETTE[0]]), ROOM_PALETTE[1]);
  assert.equal(freeColor([ROOM_PALETTE[0], ROOM_PALETTE[2]]), ROOM_PALETTE[1]);
  // Занятость считается на глаз, а не побайтно: #0F766F от #0F766E не отличить.
  assert.equal(freeColor(["#0F766F"]), ROOM_PALETTE[1]);
  // Чужой цвет и мусор ничего не занимают.
  assert.equal(freeColor(["#FFFFFF", "не цвет", null, ""]), ROOM_PALETTE[0]);
});

test("когда палитра кончилась, повторяется самый редкий цвет", () => {
  assert.equal(freeColor([...ROOM_PALETTE]), ROOM_PALETTE[0]);
  assert.equal(freeColor([...ROOM_PALETTE, ROOM_PALETTE[0]]), ROOM_PALETTE[1]);
  assert.equal(freeColor([...ROOM_PALETTE, ROOM_PALETTE[0], ROOM_PALETTE[1]]), ROOM_PALETTE[2]);
});

test("новая комната берёт незанятый цвет, освободившийся — снова в дело", () => {
  let project = createProject({ name: "Тест" });
  // Цвета категорий заняты с самого начала, и палитра комнат их обходит:
  // в справочнике заказчика «Электроприборы» покрашены цветом из этой самой
  // палитры, а «Карнизы» и «Домофон» стоят к своим соседям ближе, чем на глаз
  // различимо. Поэтому ожидание — не первые четыре цвета подряд, а первые
  // четыре **свободных**, и считаются они от самого справочника.
  const busy = project.categories.map((category) => category.color);
  const free = ROOM_PALETTE.filter((color) => !colorTaken(color, busy));
  assert.ok(free.length >= 5, "палитра комнат почти вся занята категориями: " + free.length);

  const rooms = [];
  for (const name of ["Кухня", "Спальная", "Гостиная", "Ванная"]) {
    const added = addRoom(project, name);
    project = added.project;
    rooms.push(added.room);
  }
  assert.deepEqual(rooms.map((room) => room.color), free.slice(0, 4));

  // Вторую комнату перекрасили вручную — её цвет палитры снова свободен.
  project = updateRoom(project, rooms[1].id, { color: "#112233" }).project;
  const next = addRoom(project, "Холл");
  assert.equal(next.room.color, free[1]);
});

// Свой генератор вместо Math.random: падение должно повторяться, а не
// «иногда краснеть».
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("случайный цвет годится для плана и не повторяет занятые", () => {
  const busy = ROOM_PALETTE.slice(0, 6);
  for (let seed = 1; seed <= 60; seed += 1) {
    const color = randomColor(busy, { random: seededRandom(seed) });
    assert.match(color, HEX_RE, "семя " + seed);
    assert.ok(wcagContrast(color, "#FFFFFF") >= 2.9, color + " теряется на белом плане (семя " + seed + ")");
    assert.ok(wcagContrast(color, "#000000") >= 2.4, color + " сливается со стеной (семя " + seed + ")");
    for (const taken of busy) {
      assert.ok(colorDistance(color, taken) >= 22, color + " повторяет занятый " + taken + " (семя " + seed + ")");
    }
  }
});

test("случайный цвет воспроизводится: тот же генератор — тот же цвет", () => {
  assert.equal(randomColor([], { random: seededRandom(7) }), randomColor([], { random: seededRandom(7) }));
  assert.notEqual(randomColor([], { random: seededRandom(7) }), randomColor([], { random: seededRandom(8) }));
  // Генератор-пустышка не даёт ни одного годного цвета — возвращается
  // свободный цвет палитры, а не мусор.
  assert.equal(randomColor([ROOM_PALETTE[0]], { random: () => 0 }), ROOM_PALETTE[1]);
});

// Два чистых куска окна выбора цвета: перевод курсора в цвет и проверка
// «этот цвет уже занят». Ошибаются молча — курсор уезжает на пиксель,
// а занятый цвет предлагается как свободный.
test("курсор поля превращается в насыщенность и яркость, и обратно", () => {
  // Левый верхний угол поля — белый (насыщенность 0, яркость 1),
  // правый нижний — чёрный.
  assert.deepEqual(colorFieldToHsv({ h: 216, x: 0, y: 0 }), { h: 216, s: 0, v: 1 });
  assert.deepEqual(colorFieldToHsv({ h: 216, x: 1, y: 1 }), { h: 216, s: 1, v: 0 });
  assert.deepEqual(colorFieldToHsv({ h: 216, x: 0.25, y: 0.75 }), { h: 216, s: 0.25, v: 0.25 });
  // Курсор увели за край поля, оттенок — за круг: цвет остаётся цветом.
  assert.deepEqual(colorFieldToHsv({ h: 400, x: -2, y: 5 }), { h: 40, s: 0, v: 0 });
  // Кружок рисуется там, откуда щёлкнули.
  assert.deepEqual(colorHsvToField({ h: 216, s: 0.25, v: 0.25 }), { x: 0.25, y: 0.75 });
  assert.deepEqual(colorHsvToField(colorFieldToHsv({ h: 12, x: 0.625, y: 0.25 })), { x: 0.625, y: 0.25 });
});

test("«цвет уже занят» — про глаз, а не про совпадение байтов", () => {
  assert.equal(colorTaken("#0F766E", []), false);
  assert.equal(colorTaken("#0F766E", ["#B45309"]), false);
  assert.equal(colorTaken("#0F766E", ["#B45309", "#0F766E"]), true);
  assert.equal(colorTaken("#0F766E", ["#0f766f"]), true);
  assert.equal(colorTaken("#0F766E", ["не цвет", null, ""]), false);
  // Порог задаётся: при широком пороге занят и далёкий цвет палитры.
  assert.equal(colorTaken(ROOM_PALETTE[0], [ROOM_PALETTE[1]], 200), true);
});

test("цвет смешивается с подложкой по доле", () => {
  assert.equal(colorBlend("#000000", "#FFFFFF", 0), "#FFFFFF");
  assert.equal(colorBlend("#000000", "#FFFFFF", 1), "#000000");
  assert.equal(colorBlend("#000000", "#FFFFFF", 0.5), "#808080");
  assert.equal(colorBlend("#FF0000", "#FFFFFF", 0.25), "#FFBFBF");
  // Доля за пределами 0…1 цвет за края не выводит.
  assert.equal(colorBlend("#FF0000", "#FFFFFF", 5), "#FF0000");
});

// Метка рисуется цветом своей категории поверх заливки комнаты. Совпали цвета —
// метка исчезла в заливке. Приложение заливает контур едва заметно (0,05 и 0,1
// в `render.js`), но полагаться на одну строку стилей нельзя, поэтому запас
// проверяется с разбегом: до трёх десятых — кратный, до трёх четвертей — есть.
//
// Выше трёх четвертей проверка перестала быть запретом, и вот почему. Стартовый
// справочник — справочник рабочего объекта заказчика, и цвета в нём выбирал он:
// «Электроприборы» он покрасил цветом, который слово в слово стоит в палитре
// комнат, а «Карнизы» и «Домофон» — почти им. На сплошной заливке такая метка
// действительно пропадёт, но сплошной заливки в сборке нет и не планируется:
// контур красится в одну десятую. Поэтому плотные заливки не роняют прогон, а
// называются строкой — как и остальные близкие цвета этого справочника.
test("метка любой категории различима на заливке любой комнаты палитры", (t) => {
  const categories = createProject({ name: "Тест" }).categories;
  const dense = [];
  for (const room of ROOM_PALETTE) {
    for (const { name, color } of categories) {
      for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 0.9, 1]) {
        const fill = colorBlend(room, "#FFFFFF", alpha);
        const distance = colorDistance(color, fill);
        const about = name + " " + color + " на заливке " + room + " (" + alpha + "): " + distance.toFixed(1);
        if (alpha > 0.75) {
          if (distance < COLOR_SAME_DISTANCE) dense.push(about);
          continue;
        }
        assert.ok(distance >= COLOR_SAME_DISTANCE, "метка теряется в заливке — " + about);
        // На той плотности, которой рисует приложение, запас кратный.
        if (alpha <= 0.3) assert.ok(distance >= 40, "метка едва видна на заливке — " + about);
      }
    }
  }
  if (dense.length > 0) t.diagnostic("на сплошной заливке сходятся: " + dense.join("; "));
});

test("занятыми считаются цвета и комнат, и категорий", () => {
  const added = addRoom(createProject({ name: "Тест" }), "Кухня");
  const project = added.project;
  const used = colorsInUse(project);
  for (const category of project.categories) assert.ok(used.includes(category.color), category.name);
  assert.ok(used.includes(added.room.color));
  // Правимая строка себя не занимает — иначе свой же цвет выглядел бы чужим.
  assert.ok(!colorsInUse(project, { exceptRoomId: added.room.id }).includes(added.room.color));
  const first = project.categories[0];
  assert.ok(!colorsInUse(project, { exceptCategoryId: first.id }).includes(first.color));
});

test("новая комната не берёт цвет чужой категории", () => {
  const project = createProject({ name: "Тест" });
  // Категорию перекрасили цветом из палитры — комнате он больше не достанется.
  const painted = updateCategory(project, project.categories[0].id, { color: ROOM_PALETTE[0] }).project;
  const added = addRoom(painted, "Кухня");
  const busy = painted.categories.map((category) => category.color);
  assert.equal(added.room.color, ROOM_PALETTE.find((color) => !colorTaken(color, busy)));
  for (const category of added.project.categories) {
    assert.ok(colorDistance(category.color, added.room.color) >= COLOR_SAME_DISTANCE, category.name);
  }
});

// Цвет категорий стартового справочника. До этого таска порог 29 был запретом:
// тест краснел, если две категории оказывались ближе. Стартовый справочник —
// теперь справочник рабочего объекта заказчика, и в нём **пять пар ближе
// порога**. Ему показали числа, и он выбрал «взять как есть»: цвет на плане не
// единственная примета, рядом со знаком всегда стоит подпись, а категорию видно
// в легенде и в справочнике.
//
// Поэтому порог перестал ронять прогон и переехал в предупреждение: близкие
// пары называет `closeCategoryColors`, показывает панель предупреждений, а
// пользователь закрывает строку «так и задумано». Строгим осталось то, что
// правилом и было: **две категории не имеют права выглядеть одним цветом** —
// ниже `COLOR_SAME_DISTANCE` глаз их не разводит вовсе. И строгим осталось окно
// выбора цвета: заводя новую категорию, человек видит занятые и близкие
// помеченными (`colorTaken`), то есть правило не исчезло — оно перестало
// запрещать словарь пользователя.
test("близкие цвета категорий шаблона — предупреждение, а не запрет", (t) => {
  const project = createProject({ name: "Тест" });
  const close = closeCategoryColors(project);

  // Совсем слиться категориям по-прежнему нельзя: это уже не «похоже», а «то же
  // самое», и ни легенда, ни подпись тут не помогут.
  for (const pair of close) {
    assert.ok(
      pair.distance >= COLOR_SAME_DISTANCE,
      "цвета категорий «" + pair.first + "» и «" + pair.second + "» читаются как один: " + pair.distance.toFixed(1),
    );
  }
  t.diagnostic(
    close.length === 0
      ? "близких пар цветов в справочнике нет"
      : "ближе порога " +
          COLOR_NEAR_DISTANCE +
          ": " +
          close.map((pair) => pair.first + " / " + pair.second + " — " + pair.distance.toFixed(1)).join("; "),
  );

  // Молчать о них нельзя: каждая пара обязана дойти до панели предупреждений
  // строкой, которую видно. Это и есть та проверка, которой стал прежний запрет.
  const warnings = validate(project).filter((problem) => problem.code === "closeColors");
  assert.equal(warnings.length, close.length, "не каждая близкая пара доехала до панели предупреждений");
  for (const problem of warnings) assert.equal(problem.kind, "warning", "близкий цвет — не ошибка объекта");
  if (close.length > 0) {
    assert.ok(warnings[0].message.includes(close[0].first), "в предупреждении не названа категория");
    assert.ok(warnings[0].message.includes(close[0].second), "в предупреждении названа только одна категория");
  }
});

// Порог остался числом сборки, а не забытой константой в тесте: по нему считает
// `closeCategoryColors`, и двадцать девять — разрыв самой близкой пары из пяти
// категорий первого брифа (зелень выключателей и оранжевый климата).
test("порог похожего цвета — 29, и он же считает предупреждения", () => {
  assert.equal(COLOR_NEAR_DISTANCE, 29);
  const project = createProject({ name: "Тест" });
  for (const pair of closeCategoryColors(project)) assert.ok(pair.distance < COLOR_NEAR_DISTANCE);
  // Пары идут от самой близкой: с неё и начинают смотреть.
  const distances = closeCategoryColors(project).map((pair) => pair.distance);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
});
