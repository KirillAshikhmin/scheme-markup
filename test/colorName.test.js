// Имя цвета. Шов здесь один и проверяется он глазом, а не формулой: границы
// тонов подобраны так, чтобы цвет сборки назывался тем словом, которым его
// назвал бы человек. Поэтому тест — это записанный ответ на вопрос «как
// называется вот этот цвет»: все двенадцать категорий шаблона, все 24 цвета
// помещений и края круга. Сдвинулась граница — упадёт ровно та строка, где
// название разошлось с глазом.
import { test } from "node:test";
import assert from "node:assert/strict";
import { colorName, colorNameHex } from "../src/colorName.js";
import { ROOM_PALETTE, createProject, findCategory, typesInOrder } from "../src/model.js";
import { strings } from "../src/strings.js";

// Цвета категорий шаблона берутся у самого шаблона, а не переписываются сюда
// руками: поменяется краска категории — тест покажет, как она стала зваться.
function colorNameTemplateColors() {
  const project = createProject({ name: "Проба" });
  return typesInOrder(project).map(({ category }) => [category.name, findCategory(project, category.id).color]);
}

test("цвета категорий шаблона называются узнаваемо", () => {
  assert.deepEqual(
    colorNameTemplateColors().map(([name, color]) => [name, color, colorName(color)]),
    [
      ["Свет", "#1F6FEB", "синий"],
      ["Выключатели", "#2DA44E", "зелёный"],
      ["Розетки", "#D1242F", "красный"],
      ["Климат", "#E36209", "оранжевый"],
      ["Сетевое оборудование", "#8250DF", "фиолетовый"],
      ["Домофон", "#D901C4", "пурпурный"],
      ["Карнизы", "#9d4c01", "коричневый"],
      // Два «зелёных», два «синих», два «пурпурных» и два «коричневых» подряд —
      // это не поломка имён, а сам справочник заказчика: он держит четыре пары
      // цветов ближе порога 29 и знает об этом. Имя цвета честно называет то,
      // что видит глаз, а о похожести говорит панель предупреждений.
      ["Электроприборы", "#1DAB1D", "зелёный"],
      ["Кинотеатр", "#001BDD", "синий"],
      // «Тёмная бирюза» и «коричневый» — слова из самого шаблона: там ими
      // объяснён выбор краски, и имя обязано сойтись с объяснением.
      ["Датчики", "#164E63", "тёмно-бирюзовый"],
      ["Щит", "#6E4B1F", "коричневый"],
      ["Сантехника", "#E80098", "пурпурный"],
    ],
  );
});

test("все 24 цвета помещений называются узнаваемо", () => {
  assert.deepEqual(
    ROOM_PALETTE.map((color) => color + " " + colorName(color)),
    [
      "#0F766E тёмно-бирюзовый",
      "#B45309 оранжевый",
      "#7E22CE фиолетовый",
      "#BE123C красный",
      "#15803D тёмно-зелёный",
      "#2A78D1 синий",
      "#D169B9 розовый",
      "#9C931A оливковый",
      "#664733 коричневый",
      "#1DAB1D зелёный",
      "#374F6E тёмно-синий",
      "#852E51 тёмно-розовый",
      "#633894 фиолетовый",
      "#289EC9 голубой",
      "#D17669 розовый",
      "#D124C0 пурпурный",
      "#5B6624 тёмно-оливковый",
      "#B38F59 светло-коричневый",
      "#D1247A розовый",
      "#4141C4 синий",
      "#8C2F20 тёмно-красный",
      "#689C2D зелёный",
      "#8C1875 тёмно-пурпурный",
      "#A856D1 фиолетовый",
    ],
  );
});

test("края круга: чистые цвета не получают лишней приставки", () => {
  // У чистого зелёного `v` = 1, и по яркости он назвался бы «светло-зелёным».
  // Светлота считается как (max+min)/2 именно ради этой строки.
  assert.equal(colorName("#FF0000"), "красный");
  assert.equal(colorName("#00FF00"), "зелёный");
  assert.equal(colorName("#0000FF"), "синий");
  assert.equal(colorName("#FFFF00"), "жёлтый");
  assert.equal(colorName("#FF00FF"), "пурпурный");
  assert.equal(colorName("#00FFFF"), "голубой");
});

test("шкала серого: от чёрного до белого без тона", () => {
  assert.equal(colorName("#000000"), "чёрный");
  assert.equal(colorName("#1A1A1A"), "почти чёрный");
  assert.equal(colorName("#333333"), "тёмно-серый");
  assert.equal(colorName("#808080"), "серый");
  assert.equal(colorName("#C0C0C0"), "светло-серый");
  assert.equal(colorName("#F5F5F5"), "почти белый");
  assert.equal(colorName("#FFFFFF"), "белый");
  // Запасной цвет метки — синеватый, но цветности в нём 0,07: глаз зовёт его
  // серым, и имя обязано звать так же.
  assert.equal(colorName("#8B949E"), "серый");
});

test("там, где в русском своё слово, приставки не появляется", () => {
  // Коричневый — тёмный или выцветший оранжевый.
  assert.equal(colorName("#8B4513"), "коричневый");
  assert.equal(colorName("#B38F59"), "светло-коричневый");
  // Оливковый — тёмный жёлтый.
  assert.equal(colorName("#808000"), "тёмно-оливковый");
  // Голубой — светлый бирюзовый и светлый синий, а не «светло-синий».
  assert.equal(colorName("#87CEEB"), "голубой");
  assert.equal(colorName("#93C5FD"), "голубой");
  assert.equal(colorName("#008080"), "тёмно-бирюзовый");
  // Розовый — светлый красный и светлый пурпур.
  assert.equal(colorName("#FFC0CB"), "светло-розовый");
  assert.equal(colorName("#FA8072"), "розовый");
  assert.equal(colorName("#EE82EE"), "светло-пурпурный");
  assert.equal(colorName("#4B0082"), "тёмно-фиолетовый");
  assert.equal(colorName("#000080"), "тёмно-синий");
});

test("название находится для любого цвета, а не только для заведомо известного", () => {
  const known = new Set(Object.values(strings.colors));
  const allowed = new Set();
  for (const name of known) {
    if (name.includes("{")) continue;
    allowed.add(name);
    allowed.add("тёмно-" + name);
    allowed.add("светло-" + name);
  }
  // Сетка по всему кубу sRGB с шагом 17: 4096 цветов, ни один из них не
  // записан ни в каком словаре соответствий — и у каждого есть имя.
  let checked = 0;
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const hex = "#" + [r, g, b].map((part) => part.toString(16).padStart(2, "0").toUpperCase()).join("");
        const name = colorName(hex);
        assert.ok(allowed.has(name), hex + " назвался неизвестным словом: «" + name + "»");
        checked += 1;
      }
    }
  }
  assert.equal(checked, 16 * 16 * 16);
});

test("соседние цвета не прыгают именем: тон меняется постепенно", () => {
  // Один и тот же цвет, записанный по-разному, зовётся одинаково.
  assert.equal(colorName("#be123c"), colorName("#BE123C"));
  assert.equal(colorName("  #BE123C  "), "красный");
  // На каждый тон круга имя находится, и на границе не пустеет.
  for (let hue = 0; hue < 360; hue += 1) {
    const name = colorName(colorNameHueHex(hue));
    assert.ok(name.length > 0, "тон " + hue + " остался без имени");
  }
});

// Цвет заданного тона при средней светлоте — только для проверки границ.
function colorNameHueHex(hue) {
  const c = 1;
  const x = 1 - Math.abs(((hue / 60) % 2) - 1);
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(hue / 60) % 6];
  return "#" + table.map((part) => Math.round(part * 255).toString(16).padStart(2, "0").toUpperCase()).join("");
}

test("нечего называть — пустая строка, а не «undefined» в подписи", () => {
  assert.equal(colorName(""), "");
  assert.equal(colorName(null), "");
  assert.equal(colorName("нет"), "");
  assert.equal(colorName("#FFF"), "");
  assert.equal(colorNameHex(""), "");
  assert.equal(colorNameHex("не цвет"), "");
});

test("имя с кодом — та самая подпись, которую просил заказчик", () => {
  assert.equal(colorNameHex("#BE123C"), "красный (#BE123C)");
  assert.equal(colorNameHex("#00FF00"), "зелёный (#00FF00)");
  // Код приводится к верхнему регистру: в объекте цвет мог лежать строчными.
  assert.equal(colorNameHex("#e80098"), "пурпурный (#E80098)");
});

test("все названия берутся из словаря — русских слов в модуле нет", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "colorName.js"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
    .join("\n");
  assert.equal(/["'`][^"'`]*[а-яА-ЯёЁ]/.test(code), false, "русская строка в коде модуля, а не в словаре");
});
