// Русское имя цвета — вычислением, а не таблицей соответствий.
//
// Имя нужно там, где hex человеку ничего не говорит: заголовок категории в
// справочнике типов, подпись в палитре, будущее окно выбора цвета. Словарь
// «значение → название» здесь не годится принципиально: цвета категорий и
// помещений пользователь заводит сам, и для #7A3B12, которого нет ни в одном
// списке, название обязано найтись ровно так же, как для #FF0000.
//
// Считается по трём числам:
//   тон (hue)   — основа: красный, оранжевый, жёлтый, зелёный, бирюзовый,
//                 голубой, синий, фиолетовый, пурпурный, розовый;
//   светлота    — уточнение «тёмно-» и «светло-»; берётся как (max+min)/2,
//                 а не `v` из HSV: у чистого зелёного `v` = 1, и по нему он
//                 назвался бы «светло-зелёным», хотя он просто зелёный;
//   насыщенность — уход в серое: ниже порога цветность не читается вовсе,
//                 и остаётся шкала от чёрного до белого.
//
// Четыре места, где вместо «тёмно-» и «светло-» в русском стоит своё слово,
// сделаны исключениями — иначе цвета сборки называются неузнаваемо:
//   тёмный или приглушённый оранжевый — коричневый (#6E4B1F — щит, #664733,
//     #B38F59 — светло-коричневый, а не «светло-оранжевый»);
//   тёмный жёлтый — оливковый (#5B6624, #9C931A);
//   светлый бирюзовый и светлый синий — голубой (#289EC9, #00FFFF);
//   светлый красный и светлый пурпур — розовый (#D169B9, #D17669, #FFC0CB).
// Границы тонов подобраны по палитрам сборки: пурпур сантехники #E80098
// (321°) — пурпурный, а #D1247A (330°) — уже розовый; #BE123C (345°) —
// красный. Двигать их можно, но сверяясь с `test/colorName.test.js`: там
// записано, как называются все восемь цветов категорий и все 24 цвета
// помещений.
//
// Разбор hex здесь не свой: `hexToRgb` и `rgbToHsv` живут в модели рядом с
// `colorDistance`, и второй парсер цвета в сборке заводить незачем.
import { hexToRgb, rgbToHex, rgbToHsv } from "./model.js";
import { strings, text } from "./strings.js";

// Ниже этой цветности (max − min в долях) краска не читается как краска:
// #8B949E с его 0,07 глаз зовёт серым, а не синим.
const COLOR_GREY_CHROMA = 0.12;

// Шкала серого по светлоте. Верхняя граница включительно снизу: цвет попадает
// в первый диапазон, чью границу не перешагнул.
const COLOR_GREY_STEPS = [
  { upTo: 0.04, key: "black" },
  { upTo: 0.18, key: "nearBlack" },
  { upTo: 0.38, key: "darkGrey" },
  { upTo: 0.62, key: "grey" },
  { upTo: 0.82, key: "lightGrey" },
  { upTo: 0.97, key: "nearWhite" },
  { upTo: 1.01, key: "white" },
];

// Тон по градусам круга. Красный разорван нулём, поэтому он и первый, и
// последний: всё от 345° и выше — снова красное.
const COLOR_HUE_BANDS = [
  { from: 0, key: "red" },
  { from: 15, key: "orange" },
  { from: 45, key: "yellow" },
  { from: 72, key: "green" },
  { from: 165, key: "teal" },
  { from: 205, key: "blue" },
  { from: 250, key: "violet" },
  { from: 290, key: "purple" },
  { from: 325, key: "pink" },
  { from: 345, key: "red" },
];

// Пороги «тёмно-» и «светло-» у каждого имени свои: «коричневый» и
// «оливковый» темноту уже называют сами, «голубой» и «розовый» — светлоту,
// и общий порог 0,36/0,70 приписал бы им лишнее слово.
const COLOR_TONE_LIMITS = {
  brown: { dark: 0.18, light: 0.45 },
  olive: { dark: 0.3, light: 2 },
  cyan: { dark: -1, light: 0.82 },
  pink: { dark: 0.36, light: 0.82 },
};
const COLOR_TONE_DEFAULT = { dark: 0.36, light: 0.7 };

// Светлота HSL: середина между самым ярким и самым тусклым каналом.
function colorLightness(rgb) {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return (max + min) / 2 / 255;
}

// Цветность: насколько каналы разошлись. Ноль — чистый серый.
function colorChroma(rgb) {
  return (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
}

function colorGreyKey(light) {
  const step = COLOR_GREY_STEPS.find((item) => light <= item.upTo);
  return step ? step.key : "white";
}

function colorBandKey(hue) {
  let key = COLOR_HUE_BANDS[0].key;
  for (const band of COLOR_HUE_BANDS) {
    if (hue >= band.from) key = band.key;
  }
  return key;
}

// Исключения тона: там, где в русском для тёмного или светлого варианта есть
// отдельное слово, берётся оно, а не приставка.
function colorToneKey(hue, sat, val, light) {
  const base = colorBandKey(hue);
  if (base === "orange") {
    // Коричневый — это оранжевый, который либо потемнел, либо выцвел:
    // #B45309 при насыщенности 0,95 остаётся оранжевым, #B38F59 при 0,50 —
    // уже светло-коричневый.
    if (light < 0.36 || (sat < 0.6 && light < 0.62)) return "brown";
    return base;
  }
  if (base === "yellow") return light < 0.36 ? "olive" : base;
  if (base === "teal") {
    // Тёмная бирюза (#164E63, #0F766E) голубой не бывает, а светлый циан —
    // наоборот, только голубой. Зелёная половина полосы (до 178°) остаётся
    // бирюзовой при любой яркости: #5EEAD4 — бирюза, а не голубизна.
    return hue >= 178 && val >= 0.75 ? "cyan" : base;
  }
  if (base === "blue") {
    // Светлый ненасыщенный синий по-русски — голубой, а не «светло-синий».
    return val >= 0.85 && sat <= 0.6 ? "cyan" : base;
  }
  if (base === "red" || (base === "purple" && hue >= 305)) {
    // Розовый — светлый красный или светлый пурпур: так читаются и лососёвый
    // #D17669, и орхидея #D169B9, и сам #FFC0CB.
    return light >= 0.6 ? "pink" : base;
  }
  return base;
}

/**
 * Русское название цвета: «красный», «тёмно-бирюзовый», «светло-серый».
 * Принимает hex `#RRGGBB` в любом регистре; на всём остальном возвращает
 * пустую строку — называть нечего, и подписывать цвет в интерфейсе тогда
 * просто нечем.
 */
export function colorName(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return "";
  const light = colorLightness(rgb);
  if (colorChroma(rgb) < COLOR_GREY_CHROMA) return strings.colors[colorGreyKey(light)];

  const { h, s, v } = rgbToHsv(rgb);
  const key = colorToneKey(h, s, v, light);
  const limits = COLOR_TONE_LIMITS[key] || COLOR_TONE_DEFAULT;
  const name = strings.colors[key];
  if (light < limits.dark) return text("colors.dark", { name });
  if (light > limits.light) return text("colors.light", { name });
  return name;
}

/**
 * Название вместе с кодом — «красный (#BE123C)». Это та подпись, которую
 * заказчик просил у категории: слово читается, а hex остаётся для того, кто
 * будет искать тот же цвет в другом месте. Регистр кода приводится к
 * верхнему — в объекте цвет мог быть записан и строчными.
 */
export function colorNameHex(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return "";
  return text("colors.withHex", { name: colorName(value), hex: rgbToHex(rgb) });
}
