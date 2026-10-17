// Реестр **низкополигональных моделей** (таск 155, требование G221): один
// плоский справочник «ключ → список тел» и две лестницы, которыми модель
// находят.
//
// ——— откуда у метки модель ———
//
// **По имени её изображения, и третьего механизма не заводится.** Лестница у
// цвета, формы и изображения уже выстроена (ADR 005, `objectViews/registry.js`):
// имя у типа старше формы знака, форма — старше ничего. Модель садится на её
// последнюю ступень: нашлось изображение — его имя и есть ключ модели.
//
// Это даёт сразу три вещи. **Полный охват без единого нового поля:** у всех
// сорока восьми типов стартового справочника изображение есть (это держит
// `test/objectViews.test.js`), значит есть и модель. **Объект заказчика
// оживает без миграции:** в его 592 метках имён изображений нет ни одного, но
// форма знака проставлена, и модель находится по ней — ровно так же, как
// нашлось изображение (G68, объект не меняется). **Одна цена вместо двух:**
// двенадцать типов света делят форму `circle-cross`, и у них одно изображение
// и одна модель — цена, объявленная ещё в таске 135, второй раз не платится.
//
// ——— откуда у вещи чертежа модель ———
//
// По ключу встроенного каталога (таск 154), а пока его нет — по имени вида,
// терпимым сравнением. Подробности и слова — в `objects.js`.
import { MODELS_CLIMATE } from "./climate.js";
import { MODELS_LIGHT } from "./light.js";
import { MODELS_NET } from "./net.js";
import { MODEL_OBJECT_WORDS, MODELS_OBJECTS } from "./objects.js";
import { MODELS_POWER } from "./power.js";
import { MODELS_SENSE } from "./sense.js";
import { MODELS_THINGS } from "./things.js";
import { MODEL_CYL_SIDES } from "./kit.js";

/**
 * Предел тел на вещь. Пять — и это посчитанный предел, а не круглое число:
 * тело коробкой стоит шесть граней, цилиндром — десять, сцена живого объекта
 * заказчика держится на тысяче с небольшим граней, а меток на схеме у него под
 * три сотни. Пять тел на каждую — это уже вдвое больше сцены, чем вся
 * квартира; шесть читались бы не лучше, а кадр подорожал бы ещё на пятую
 * часть. Держит это тест, а не уговор.
 */
export const OBJECT_MODEL_BODY_MAX = 5;

/** Предел граней на вещь: пять цилиндров прошли бы по телам, но не по граням. */
export const OBJECT_MODEL_FACE_MAX = 30;

const MODEL_FAMILIES = [
  MODELS_POWER,
  MODELS_LIGHT,
  MODELS_CLIMATE,
  MODELS_SENSE,
  MODELS_NET,
  MODELS_THINGS,
  MODELS_OBJECTS,
];

const MODELS = {};
const CLASHES = [];
for (const family of MODEL_FAMILIES) {
  for (const [key, parts] of Object.entries(family)) {
    // Два семейства, занявшие один ключ, иначе молча затёрли бы друг друга —
    // и у половины типов модель оказалась бы чужой. Список пустой держит тест.
    if (MODELS[key]) CLASHES.push(key);
    MODELS[key] = { key, parts };
  }
}

// Слова ищутся от самого длинного корня: «Столешница» содержит и «стол».
const MODEL_WORDS = Object.entries(MODEL_OBJECT_WORDS)
  .flatMap(([key, words]) => words.map((word) => ({ key, word })))
  .sort((left, right) => right.word.length - left.word.length);

/** Модель по ключу. `null` — такого ключа нет, и вещь рисуется габаритом. */
export function objectModelByKey(key) {
  return key && MODELS[key] ? MODELS[key] : null;
}

/** Все ключи — для сверки охвата и различимости силуэтов. */
export function objectModelKeys() {
  return Object.keys(MODELS).sort();
}

/** Ключи, занятые дважды. Пусто — иначе тест красный. */
export function objectModelClashes() {
  return [...CLASHES];
}

/** Сколько граней стоит модель: коробка — шесть, цилиндр — своих сторон плюс две. */
export function objectModelFaceCount(model) {
  let faces = 0;
  for (const part of (model && model.parts) || []) faces += part.kind === "cyl" ? MODEL_CYL_SIDES + 2 : 6;
  return faces;
}

/**
 * Модель вещи чертежа по **имени вида** — мост до встроенного каталога.
 *
 * Сравнение терпимое, как у лестницы в объёме (`volumeStairKind`): регистр,
 * «ё» и пробелы по краям не считаются, внутри строки ищется корень. Поэтому
 * «Шкаф», «шкафы» и «Шкаф в прихожей» узнаются все, а переименованный в
 * «Пенал» — никто, и тогда вещь честно рисуется габаритом, как рисовалась до
 * моделей.
 */
export function objectModelForName(name) {
  const plain = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
  if (plain === "") return null;
  for (const entry of MODEL_WORDS) {
    if (plain.includes(entry.word)) return objectModelByKey(entry.key);
  }
  return null;
}
