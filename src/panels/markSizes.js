// Окно размеров метки: длина, ширина и высота над полом.
//
// Отдельный файл по той же причине, что и `markControls.js`: в строке списка
// этому тесно. Строка метки и так собирает семь полей, а три числа, которые
// заполняют не в момент постановки, а потом и не у каждой метки, в неё не
// помещаются — заказчик сам попросил «отдельное окно».
//
// Единицу окно не выбирает и не переводит: в модели лежат миллиметры
// (`MARK_DIMENSION_UNIT`), словом их называет `strings.markSizes.unit`.
// Здесь она только подставляется в подписи — чтобы была видна, а не
// подразумевалась.
import { strings, text } from "../strings.js";
import {
  MARK_DIMENSION_FIELDS,
  MARK_DIMENSION_MAX,
  findMark,
  labelOf,
  markDimensionValue,
  markDimensions,
} from "../model.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

// Подпись поля с единицей: «Длина, мм». Складывается подстановкой, чтобы
// единица была написана в словаре один раз.
export function markSizesLabel(field) {
  return text("markSizes." + field, { unit: strings.markSizes.unit });
}

// Число в подпись кнопки. Дробное пишется через запятую — так его и набирают;
// в поле ввода оно остаётся с точкой, иначе `input[type=number]` его не примет.
function markSizesNumber(value) {
  return String(value).replace(".", ",");
}

/**
 * Что показывает кнопка в строке метки: «Д 600 · Ш 400 · В 900 мм» по заданным
 * размерам и пустая строка, если не задан ни один.
 *
 * Считается здесь, а не в разметке: «у метки размеров нет» должно быть видно
 * без открытия окна — и проверяться без браузера. Соседние кнопки устроены так
 * же: «Оборудование: 2» и «Управляет: Т1, Т2» тоже говорят содержимым.
 */
export function markSizesSummary(mark) {
  const values = markDimensions(mark);
  const parts = [];
  for (const field of MARK_DIMENSION_FIELDS) {
    if (values[field] === null) continue;
    parts.push(strings.markSizes[field + "Short"] + " " + markSizesNumber(values[field]));
  }
  if (parts.length === 0) return "";
  return text("markSizes.summary", { values: parts.join(" · "), unit: strings.markSizes.unit });
}

/**
 * Разбор трёх полей окна. Пустое — `null` («не задано»), ноль — значение,
 * отрицательное и нечисловое — в `invalid`: окно на них не закрывается, а
 * подсвечивает поле. Правило одно с моделью — это её же `markDimensionValue`.
 */
export function markSizesParse(raw) {
  const values = {};
  const invalid = [];
  for (const field of MARK_DIMENSION_FIELDS) {
    try {
      values[field] = markDimensionValue(raw ? raw[field] : null);
    } catch (error) {
      values[field] = null;
      invalid.push({ field, message: error && error.message ? error.message : String(error) });
    }
  }
  return { values, invalid };
}

/**
 * Окно правки. Отвечает тремя значениями (`null` — «не задано») или `null`,
 * если передумали. Сохраняет ответ в объект не оно, а список меток: правка
 * идёт через `canvasCommit`, и место у неё одно — там же, где остальные
 * правки строки.
 */
export function openMarkSizesPicker(project, markId) {
  return new Promise((resolve) => {
    const mark = findMark(project, markId);
    const current = markDimensions(mark);
    const inputs = new Map();
    const error = uiEl("p", { class: "sizes__error" });
    error.hidden = true;

    const rows = MARK_DIMENSION_FIELDS.map((field) => {
      const label = markSizesLabel(field);
      const input = uiEl("input", {
        class: "ui-input sizes__input",
        type: "number",
        value: current[field] === null ? "" : String(current[field]),
        title: label,
        attrs: { min: "0", max: String(MARK_DIMENSION_MAX), step: "1", inputmode: "decimal" },
      });
      inputs.set(field, input);
      return uiEl("label", { class: "sizes__row" }, [
        uiEl("span", { class: "sizes__label", text: label }),
        input,
      ]);
    });

    let modal;
    const done = (value) => {
      modal.close();
      resolve(value);
    };
    const save = () => {
      const raw = {};
      for (const [field, input] of inputs) raw[field] = input.value;
      const parsed = markSizesParse(raw);
      for (const [field, input] of inputs) {
        input.classList.toggle("is-bad", parsed.invalid.some((item) => item.field === field));
      }
      if (parsed.invalid.length > 0) {
        error.textContent = parsed.invalid[0].message;
        error.hidden = false;
        inputs.get(parsed.invalid[0].field).focus();
        return;
      }
      done(parsed.values);
    };

    modal = uiModal({
      title: text("markSizes.title", { label: labelOf(project, markId) }),
      body: uiEl("div", { class: "sizes" }, [
        uiEl("p", { class: "modal__hint", text: strings.markSizes.hint }),
        ...rows,
        error,
      ]),
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(null) } }),
        uiButton(strings.markSizes.save, { class: "ui-btn ui-btn--accent", on: { click: () => save() } }),
      ],
      onCancel: () => resolve(null),
    });
  });
}
