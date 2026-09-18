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
  COLOR_SAME_DISTANCE,
  ROOM_PALETTE,
  addRoom,
  colorBlend,
  colorsInUse,
  colorDistance,
  colorFieldToHsv,
  colorHsvToField,
  colorTaken,
  createProject,
  freeColor,
  hexToRgb,
  hsvToRgb,
  randomColor,
  rgbToHex,
  rgbToHsv,
  updateCategory,
  updateRoom,
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
  const rooms = [];
  for (const name of ["Кухня", "Спальная", "Гостиная", "Ванная"]) {
    const added = addRoom(project, name);
    project = added.project;
    rooms.push(added.room);
  }
  assert.deepEqual(rooms.map((room) => room.color), ROOM_PALETTE.slice(0, 4));

  // Вторую комнату перекрасили вручную — её цвет палитры снова свободен.
  project = updateRoom(project, rooms[1].id, { color: "#112233" }).project;
  const next = addRoom(project, "Холл");
  assert.equal(next.room.color, ROOM_PALETTE[1]);
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
// метка исчезла в заливке. Приложение заливает контур едва заметно, но
// полагаться на это нельзя: прозрачность правится одной строкой в стилях,
// поэтому проверяется весь разброс плотности, вплоть до сплошной заливки.
test("метка любой категории различима на заливке любой комнаты палитры", () => {
  const categories = createProject({ name: "Тест" }).categories.map((category) => category.color);
  for (const room of ROOM_PALETTE) {
    for (const category of categories) {
      for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 0.9, 1]) {
        const fill = colorBlend(room, "#FFFFFF", alpha);
        const distance = colorDistance(category, fill);
        const about = category + " на заливке " + room + " (" + alpha + "): " + distance.toFixed(1);
        assert.ok(distance >= COLOR_SAME_DISTANCE, "метка теряется в заливке — " + about);
        // На той плотности, которой рисует приложение, запас кратный.
        if (alpha <= 0.3) assert.ok(distance >= 40, "метка едва видна на заливке — " + about);
      }
    }
  }
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
  assert.equal(added.room.color, ROOM_PALETTE[1]);
  for (const category of added.project.categories) {
    assert.ok(colorDistance(category.color, added.room.color) >= COLOR_SAME_DISTANCE, category.name);
  }
});

// Цвет новой категории выбирается не на глаз: на плане рядом лежат метки всех
// категорий, и новый цвет обязан расходиться с прежними не хуже, чем они
// расходятся между собой.
test("цвет каждой категории шаблона разведён с остальными", () => {
  const categories = createProject({ name: "Тест" }).categories;
  let nearest = Infinity;
  let pair = "";
  for (let i = 0; i < categories.length; i += 1) {
    for (let j = i + 1; j < categories.length; j += 1) {
      const distance = colorDistance(categories[i].color, categories[j].color);
      if (distance < nearest) {
        nearest = distance;
        pair = categories[i].name + " / " + categories[j].name;
      }
    }
  }
  // Двадцать девять — то, на сколько расходятся самые близкие цвета из пяти
  // категорий брифа (зелёный выключателей и оранжевый климата). Новая категория
  // не должна оказаться ближе: иначе на плане прибавится путаницы.
  assert.ok(nearest >= 29, "самые близкие цвета категорий — " + pair + ": " + nearest.toFixed(1));
});

// Щит заведён отдельной категорией по просьбе заказчика, и цвет ему выбран
// счётом, а не на глаз: на плане метки всех категорий лежат рядом, и новый
// цвет обязан расходиться с каждым прежним не хуже, чем они расходятся между
// собой. Проверка именная: общий тест выше говорит только про худшую пару.
test("цвет щита разведён с каждой прежней категорией", () => {
  const categories = createProject({ name: "Тест" }).categories;
  const panel = categories.find((category) => category.name === "Щит");
  assert.ok(panel, "категории щита нет в стартовом справочнике");
  assert.equal(panel.color, "#6E4B1F");

  let nearest = Infinity;
  let neighbour = "";
  for (const category of categories) {
    if (category === panel) continue;
    const distance = colorDistance(panel.color, category.color);
    if (distance < nearest) {
      nearest = distance;
      neighbour = category.name;
    }
  }
  // Двадцать девять — разрыв самой близкой пары прежних категорий (свет и
  // сетевое оборудование). Щит не должен оказаться ближе.
  assert.ok(nearest >= 29, "щит слишком похож на «" + neighbour + "»: " + nearest.toFixed(1));
  // И на заливке помещений он не пропадает — иначе метку щита не найти.
  for (const room of ROOM_PALETTE) {
    for (const alpha of [0.05, 0.1, 0.2, 0.3]) {
      const distance = colorDistance(panel.color, colorBlend(room, "#FFFFFF", alpha));
      assert.ok(distance >= 40, "щит теряется на заливке " + room + " (" + alpha + "): " + distance.toFixed(1));
    }
  }
});

// Сантехника заведена отдельной категорией по просьбе заказчика: водорозетка,
// выход канализации и кран воды — не электрика. Цвет ей, как и щиту, выбран
// счётом, и счёт этот пересчитан дважды. По ГОСТ 14202-69 вода на схемах
// зелёная, но зелёный занят выключателями; первым выбором был тёмный морской —
// числа он проходил (до датчиков 36,3, до выключателей 37,2), а на плане давал
// второе зелёное пятно рядом с выключателями, и заказчик попросил сменить:
// «цвет сантехники меняем». Пурпур закрывает ровно эту жалобу.
test("цвет сантехники разведён с каждой прежней категорией", () => {
  const categories = createProject({ name: "Тест" }).categories;
  const plumbing = categories.find((category) => category.name === "Сантехника");
  assert.ok(plumbing, "категории сантехники нет в стартовом справочнике");
  assert.equal(plumbing.color, "#E80098");

  let nearest = Infinity;
  let neighbour = "";
  for (const category of categories) {
    if (category === plumbing) continue;
    const distance = colorDistance(plumbing.color, category.color);
    if (distance < nearest) {
      nearest = distance;
      neighbour = category.name;
    }
  }
  // Двадцать девять — разрыв самой близкой пары прежних категорий, и прежний
  // цвет держался от него недалеко. У пурпура до ближайшего соседа — сетевого
  // оборудования — 58,0: вдвое дальше и порога, и прежнего морского.
  assert.ok(nearest >= 50, "сантехника ближе всех к «" + neighbour + "»: " + nearest.toFixed(1));

  // Жалоба была именно про зелень выключателей: у прежнего цвета до неё 37,2,
  // и на быстром взгляде два зелёных пятна путались. Теперь их не спутать.
  const switches = categories.find((category) => category.name === "Выключатели");
  const toSwitches = colorDistance(plumbing.color, switches.color);
  assert.ok(toSwitches >= 120, "сантехника снова похожа на выключатели: " + toSwitches.toFixed(1));

  // И на заливке помещений метка не пропадает — иначе кран на плане не найти.
  for (const room of ROOM_PALETTE) {
    for (const alpha of [0.05, 0.1, 0.2, 0.3]) {
      const distance = colorDistance(plumbing.color, colorBlend(room, "#FFFFFF", alpha));
      assert.ok(distance >= 40, "сантехника теряется на заливке " + room + " (" + alpha + "): " + distance.toFixed(1));
    }
  }
});
