// Чёрно-белый лист: вся выгрузка, нарисованная тушью по бумаге (G170).
//
// Заказчик печатает чертежи на A4 и отдаёт монтажникам, цветного принтера на
// объекте нет. Чёрно-белая печать цветной схемы — это серые пятна разной
// плотности: синий и красный становятся почти одинаково серыми, светлая
// заливка помещения исчезает вовсе. Поэтому лист обесцвечивается **до**
// печати, своим правилом, а не отдаётся драйверу принтера.
//
// **Одно место на всю сборку.** Цвет в лист попадает из десятка мест
// `render.js` (знак метки, подпись, плашка комментария, связи, контур
// помещения, легенда) плюс рамка и штамп по ГОСТ. Разводить по ним признак
// «рисуй без цвета» значило бы завести десяток развилок, каждую со своим
// шансом разойтись, и переписать ровно тот код, который рисует подписи.
// Вместо этого холст выгрузки оборачивается здесь: `monoContext(ctx)` отдаёт
// подставку, которая **перекрашивает краску на входе** — всё, что кладётся в
// `fillStyle` и `strokeStyle`, проходит через `monoPaint`. Рисующий код об
// этом не знает и не меняется, а обычная выгрузка не меняется ни на пиксель:
// без отметки холст не оборачивается вовсе.
//
// **Чистая тушь, а не серая калька.** Перевод цвета в серый по яркости даёт
// те самые пятна, от которых заказчик уходит: `#1F6FEB` (свет) и `#BF3989`
// (связи) садятся в соседние оттенки серого и на бумаге сливаются. Поэтому
// всё, что было краской, становится **чистым чёрным**, а бумага остаётся
// белой: различают знаки форма, начертание и подпись — и все три проверены
// отпечатками (`shapes.test.js`, `lineStyle.test.js`) именно на чёрно-белой
// распечатке. Серым остаётся только сам план схемы: это чужой скан или
// фотография, и загонять его в две краски значило бы выжечь стены и штриховку.
//
// **Форма от отметки не меняется.** Знак, который монтажник выучил, обязан
// остаться тем же — поэтому разведение совпавших знаков здесь не делается, а
// называется вслух: `monoSameShapes` считает, какие обозначения на этом листе
// без цвета сольются, и окно выгрузки говорит об этом рядом с галкой.
import { findCategory, findType, sharedShapes } from "./model.js";
import { visibleMarks } from "./render.js";
import { text } from "./strings.js";

// Тушь и бумага. Не «почти чёрный» `#1f2328`, которым набраны таблицы на
// экране: лист уходит на лазерник, и половина тона экономии тонера не даёт, а
// контраст волоска в полпикселя отнимает.
export const MONO_INK = "#000000";
export const MONO_PAPER = "#ffffff";
// Отсутствие краски: прозрачное остаётся прозрачным, а подкраска-заливка его
// получает.
export const MONO_CLEAR = "rgba(0, 0, 0, 0)";

// Светлее этого по всем трём каналам — бумага, а не краска: белая подложка под
// подписью, поле плашки комментария, фон легенды. Порог высокий нарочно:
// цвета категорий и помещений палитра держит тёмными (яркость 0,075…0,3), и
// под него не попадает ни один из них — иначе жёлтая категория стала бы
// невидимой на белом листе.
const MONO_PAPER_MIN = 245;

// Заливка слабее половины — подкраска, а не краска: так нарисована заливка
// помещения (`outlineTint` с прозрачностью 0,05 на бумаге). Тушью её
// повторять нечем: сплошное чёрное пятно похоронит под собой метки, а серое —
// это ровно то пятно, от которого уходим. Поэтому заливка снимается, а
// помещение на листе остаётся контуром с названием: по ним комнату и читают.
// Прозрачная линия, наоборот, становится тушью — контур нужен сплошным.
const MONO_WASH_ALPHA = 0.5;

// Обесцвечивание плана: средствами холста, одним вызовом на картинку.
const MONO_IMAGE_FILTER = "grayscale(1)";

// Уже обёрнутые холсты: обернуть дважды не ошибка, но и смысла нет.
const monoWrapped = new WeakSet();

// Разобранный цвет — `{r, g, b, a}` или `null`, если запись незнакомая.
// Понимает то, чем красит сборка: `#rgb`, `#rrggbb`, `rgb()`, `rgba()`.
function monoRgba(value) {
  const input = String(value).trim();
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    const number = parseInt(full, 16);
    return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255, a: 1 };
  }
  const parts = /^rgba?\(([^)]+)\)$/.exec(input);
  if (!parts) return null;
  const numbers = parts[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  if (numbers.length < 3 || numbers.some((number) => !Number.isFinite(number))) return null;
  return {
    r: numbers[0],
    g: numbers[1],
    b: numbers[2],
    a: numbers.length > 3 ? numbers[3] : 1,
  };
}

/**
 * Чем красить вместо цвета. `kind` — `"fill"` или `"stroke"`.
 *
 * Правила по порядку: прозрачное остаётся прозрачным; бумага остаётся бумагой;
 * слабая заливка снимается; всё прочее — чистая тушь. Незнакомая запись цвета
 * тоже уходит в тушь: лучше чёрное, чем невесть какое цветное пятно на листе.
 * Градиент и узор (не строка) проходят как есть — их в выгрузке нет, но молча
 * сломать рисование из-за этого нельзя.
 */
export function monoPaint(value, kind) {
  if (typeof value !== "string") return value;
  const rgba = monoRgba(value);
  if (!rgba) return MONO_INK;
  if (!(rgba.a > 0)) return MONO_CLEAR;
  if (rgba.r >= MONO_PAPER_MIN && rgba.g >= MONO_PAPER_MIN && rgba.b >= MONO_PAPER_MIN) return MONO_PAPER;
  if (kind === "fill" && rgba.a < MONO_WASH_ALPHA) return MONO_CLEAR;
  return MONO_INK;
}

// Умеет ли холст обесцвечивать сам (`ctx.filter`). Проверяется наличие
// настоящего присваивателя в цепочке прототипов, а не чтение обратно:
// неизвестное свойство холста принимает как своё, и запись «grayscale(1)»
// читалась бы назад даже там, где фильтра нет.
function monoHasFilter(ctx) {
  for (let node = ctx; node; node = Object.getPrototypeOf(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, "filter");
    if (descriptor && typeof descriptor.set === "function") return true;
  }
  return false;
}

// Серая копия картинки — запасной путь для холста без `filter`. Считается один
// раз на картинку: план рисуется и в общий лист, и в лист каждой комнаты.
const monoGrayCache = new WeakMap();

function monoGrayCopy(image) {
  if (!image || typeof document === "undefined") return null;
  if (monoGrayCache.has(image)) return monoGrayCache.get(image);
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!(width > 0 && height > 0)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  try {
    const picture = ctx.getImageData(0, 0, width, height);
    const pixels = picture.data;
    for (let at = 0; at < pixels.length; at += 4) {
      // Те же веса, что у `grayscale(1)` холста: светлота, а не среднее
      // каналов, — иначе синий план потемнел бы, а жёлтый выцвел.
      const gray = Math.round(pixels[at] * 0.2126 + pixels[at + 1] * 0.7152 + pixels[at + 2] * 0.0722);
      pixels[at] = gray;
      pixels[at + 1] = gray;
      pixels[at + 2] = gray;
    }
    ctx.putImageData(picture, 0, 0);
  } catch (error) {
    // Холст «запачкан» чужой картинкой — разбор пикселей запрещён. Отдаём
    // картинку как есть: лучше цветной план, чем упавшая выгрузка.
    return null;
  }
  monoGrayCache.set(image, canvas);
  return canvas;
}

// План схемы — единственное, что попадает на лист картинкой, и единственное,
// что остаётся серым. Фильтр ставится только на этот вызов и сразу снимается:
// нарисованному поверх плана он не нужен, там уже чистая тушь.
function monoDrawImage(ctx, args) {
  if (monoHasFilter(ctx)) {
    const had = ctx.filter;
    ctx.filter = MONO_IMAGE_FILTER;
    try {
      ctx.drawImage(...args);
    } finally {
      ctx.filter = had && had !== MONO_IMAGE_FILTER ? had : "none";
    }
    return;
  }
  const gray = monoGrayCopy(args[0]);
  ctx.drawImage(...(gray ? [gray, ...args.slice(1)] : args));
}

/**
 * Холст, который не умеет цвета.
 *
 * Подставка под настоящий холст: краска на входе перекрашивается
 * (`monoPaint`), прозрачность кисти прижимается к единице, картинка
 * обесцвечивается. Всё остальное уходит настоящему холсту как есть.
 *
 * **Прозрачность кисти (`globalAlpha`) прижимается нарочно.** Ею нарисованы
 * связи: дуга управления идёт в 0,72, цепь в 0,62, оболочка общего номера в
 * 0,45. Чёрное в 0,45 — это серый волосок, то самое пятно, от которого
 * уходим; отличают эти три рода не плотность, а рисунок (дуга со стрелкой,
 * прямая с засечками, пунктирная оболочка) и толщина линии, и на бумаге они
 * обязаны быть видны в полную силу.
 */
export function monoContext(ctx) {
  if (!ctx || typeof ctx !== "object" || monoWrapped.has(ctx)) return ctx;
  // Методы отдаются привязанными к настоящему холсту: вызванный с подставкой
  // в `this`, родной метод холста бросает «Illegal invocation». Привязки
  // кэшируются — `fillText` за один лист зовут тысячи раз.
  const bound = new Map();
  const proxy = new Proxy(ctx, {
    get(target, key) {
      if (key === "drawImage") {
        if (!bound.has(key)) bound.set(key, (...args) => monoDrawImage(target, args));
        return bound.get(key);
      }
      const value = target[key];
      if (typeof value !== "function") return value;
      if (!bound.has(key)) bound.set(key, value.bind(target));
      return bound.get(key);
    },
    set(target, key, value) {
      if (key === "fillStyle") target.fillStyle = monoPaint(value, "fill");
      else if (key === "strokeStyle") target.strokeStyle = monoPaint(value, "stroke");
      else if (key === "globalAlpha") target.globalAlpha = 1;
      else target[key] = value;
      return true;
    },
  });
  monoWrapped.add(proxy);
  return proxy;
}

/**
 * Знаки, которые на **этом листе** без цвета станут одним знаком.
 *
 * Считать это самому нельзя: повтор знака уже собирает `sharedShapes` — та же
 * величина, что кормит предупреждение `sharedShape` в панели. Здесь она
 * просеивается двумя условиями, и оба про чёрно-белый лист:
 *
 * - **типы из разных категорий.** Семь кодов под кругом с крестом сидят в
 *   «Свете» — в цвете они и так нарисованы одинаково, человек это видел и
 *   принял (см. `sharedShapes`). Теряется только то, что цветом различалось:
 *   ночник «Света» и выход канализации «Сантехники» носят один знак и держатся
 *   на разном цвете;
 * - **метки этих типов есть на выгружаемой схеме** — с тем же фильтром, с
 *   которым лист рисуется. Лист про эту схему (а бывает, что и про одну
 *   комнату), и пугать человека совпадением, которого на его листе нет, —
 *   значит приучить не читать предупреждения.
 *
 * Разводить знаки сама отметка не имеет права: обозначение, которое монтажник
 * выучил, не должно меняться от галки в окне печати. Поэтому здесь только
 * счёт и список, а решение — за человеком.
 *
 * Возвращает `[{shape, name, types: [{code, name, category}]}]` в порядке
 * справочника.
 */
export function monoSameShapes(project, scheme, filter) {
  if (!project || !scheme) return [];
  const present = new Set(visibleMarks(project, scheme, filter || null).map((mark) => mark.typeId));
  const groups = [];
  for (const group of sharedShapes(project)) {
    const types = group.typeIds
      .filter((typeId) => present.has(typeId))
      .map((typeId) => findType(project, typeId))
      .filter(Boolean);
    if (types.length < 2) continue;
    if (new Set(types.map((type) => type.categoryId)).size < 2) continue;
    groups.push({
      shape: group.shape,
      name: group.name,
      types: types.map((type) => ({
        code: type.code,
        name: type.name,
        category: (findCategory(project, type.categoryId) || {}).name || "",
      })),
    });
  }
  return groups;
}

/**
 * Та же находка словами для окна выгрузки: число и список, а не одно число.
 * «Знаков два» ни о чём не говорит — решает человек, и решает он по именам:
 * «ночник и выход канализации нарисуются одинаково» он читает как «ну и
 * ладно», а «выключатель и щит» — как «нет, печатаю в цвете».
 */
export function monoSameText(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return "";
  const lines = groups.map((group) =>
    text("mono.sameGroup", {
      shape: group.name,
      types: group.types.map((type) => text("mono.sameType", type)).join(", "),
    }),
  );
  return text("mono.same", { count: groups.length, groups: lines.join("; ") });
}
