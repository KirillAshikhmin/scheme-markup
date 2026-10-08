// Лист по ГОСТ Р 21.1101-2013 (СПДС): формат, рамка, основная надпись.
//
// Это новый вид выгрузки рядом с прежними, а не замена им: `schemePng` и
// `tablePng` продолжают отдавать картинку «по размеру плана», без бумаги.
//
// **Откуда геометрия.** Размеры сняты с приложения Ж самого стандарта (формы
// 3, 5, 6) и сверены с SVG-рамками репозитория `dell4valt/gost_template`,
// которые заказчик разрешил использовать. Чужие файлы в продукт не положены:
// в них нет ничего, кроме чисел, а числа лежат здесь — тогда рамка рисуется
// тем же кодом, что и всё остальное, тянется в любой формат и не зависит от
// шрифта и версии Visio, которыми тот экспорт делали.
//
// **Единицы — миллиметры.** Весь модуль считает в миллиметрах бумаги, и только
// на отрисовке они умножаются на «пикселей в миллиметре». Иначе выверить лист
// линейкой было бы нечем: заказчик меряет бумагу, а не пиксели.
//
// **Масштаб считается один раз.** `gostFit` возвращает `scale` — миллиметры
// бумаги на пиксель плана. Этим же числом план рисуется и из него же выводится
// отношение для графы «Масштаб» (`gostScaleDenominator`). Второй формулы для
// того же числа в сборке нет и быть не должно: два пути расчёта разойдутся в
// последнем знаке, а заказчик проверяет чертёж линейкой (G169).
import { strings, text } from "./strings.js";

// ——— бумага ———————————————————————————————————————————————————————————

// Форматы по ГОСТ 2.301. Книжная ориентация — размеры как здесь, альбомная
// меняет стороны местами. Больше A1 не берём: при 300 dpi A1 — это 7016 × 9933
// точек, запас до потолка холста ещё есть, у A0 его уже нет.
export const GOST_FORMATS = [
  { id: "A4", width: 210, height: 297 },
  { id: "A3", width: 297, height: 420 },
  { id: "A2", width: 420, height: 594 },
  { id: "A1", width: 594, height: 841 },
];

// Поле подшивки слева и обрез с трёх сторон.
export const GOST_BINDING_MM = 20;
export const GOST_EDGE_MM = 5;

// Основная надпись: ширина у всех форм одна, высота своя.
export const GOST_STAMP_WIDTH_MM = 185;
export const GOST_STAMP_HEIGHT_MM = { form3: 55, form5: 40, form6: 15 };

// Толщина линий: основная S = 0,7 мм, тонкая — S/2.
export const GOST_LINE_MM = 0.7;
export const GOST_THIN_MM = 0.3;

// Наименьшая высота шрифта на чертеже по ГОСТ 2.304 — 2,5 мм. Ниже неё
// подпись метки на бумаге не читается, и это мерка автоподбора формата.
export const GOST_MIN_TEXT_MM = 2.5;

// Разрешение листа: множитель диалога (1×, 2×, 4×) переводится в dpi. 2× — это
// привычные 300 dpi, на которых считалась подпись размера у прежних выгрузок.
export const GOST_DPI_BASE = 150;

export function gostDpi(scale) {
  return GOST_DPI_BASE * (scale > 0 ? scale : 1);
}

// Пикселей в миллиметре при заданном разрешении.
export function gostPixelsPerMm(dpi) {
  return (dpi > 0 ? dpi : 300) / 25.4;
}

/**
 * Размер листа в миллиметрах. `orientation` — «portrait» (книжная) или
 * «landscape» (альбомная); неизвестный формат читается как A4, потому что
 * печатает заказчик только его.
 */
export function gostSheetSize(format, orientation) {
  const found = GOST_FORMATS.find((item) => item.id === format) || GOST_FORMATS[0];
  const landscape = orientation === "landscape";
  return {
    format: found.id,
    orientation: landscape ? "landscape" : "portrait",
    width: landscape ? found.height : found.width,
    height: landscape ? found.width : found.height,
  };
}

// Внутренняя рамка листа: 20 мм слева под подшивку, по 5 мм с трёх сторон.
export function gostFrame(sheet) {
  return {
    x: GOST_BINDING_MM,
    y: GOST_EDGE_MM,
    width: sheet.width - GOST_BINDING_MM - GOST_EDGE_MM,
    height: sheet.height - GOST_EDGE_MM * 2,
  };
}

export function gostStampHeight(form) {
  return GOST_STAMP_HEIGHT_MM[form] || GOST_STAMP_HEIGHT_MM.form3;
}

// Основная надпись — в правом нижнем углу рамки.
export function gostStampRect(sheet, form) {
  const frame = gostFrame(sheet);
  const height = gostStampHeight(form);
  return {
    x: frame.x + frame.width - GOST_STAMP_WIDTH_MM,
    y: frame.y + frame.height - height,
    width: GOST_STAMP_WIDTH_MM,
    height,
  };
}

/**
 * Поле чертежа: вся рамка минус полоса, занятая основной надписью.
 *
 * Полоса срезается во всю ширину, хотя надпись у́же рамки на больших форматах.
 * Г-образное поле вместило бы план чуть крупнее, но план — прямоугольная
 * картинка, и вписывать её пришлось бы в невыпуклую фигуру; на A4 — а это
 * единственный формат, который заказчик печатает, — надпись занимает ширину
 * рамки ровно, и терять нечего вовсе.
 */
export function gostField(sheet, form) {
  const frame = gostFrame(sheet);
  const stamp = gostStampHeight(form);
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: Math.max(1, frame.height - stamp),
  };
}

/**
 * Вписывание плана в поле чертежа: `scale` — **миллиметров бумаги на пиксель
 * плана**. Это та самая единственная величина, из которой потом выводится и
 * отрисовка, и число в графе «Масштаб».
 *
 * Пропорции плана и листа не совпадают почти никогда — одна сторона упирается
 * раньше. Берётся меньший из двух множителей (план влезает целиком), остаток
 * поля делится поровну: план встаёт по центру. Прижимать его к углу было бы
 * тем же количеством белого, но несимметричным.
 */
export function gostFit(plan, field) {
  const width = plan && plan.width > 0 ? plan.width : 1;
  const height = plan && plan.height > 0 ? plan.height : 1;
  const scale = Math.min(field.width / width, field.height / height);
  const planWidth = width * scale;
  const planHeight = height * scale;
  return {
    scale,
    width: planWidth,
    height: planHeight,
    x: field.x + (field.width - planWidth) / 2,
    y: field.y + (field.height - planHeight) / 2,
  };
}

/**
 * Знаменатель настоящего масштаба: 1:N, где N считается из того же `scale`,
 * которым план вписан в лист, и из калибровки схемы (пикселей плана на метр).
 *
 * Один пиксель плана — это `scale` мм на бумаге и `1000 / perMeter` мм на
 * объекте; отношение второго к первому и есть N. Без калибровки масштаба нет
 * вовсе — отвечаем `null`, а не выдумываем число.
 */
export function gostScaleDenominator(scale, pixelsPerMeter) {
  if (!(scale > 0) || !(pixelsPerMeter > 0)) return null;
  const value = 1000 / (pixelsPerMeter * scale);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Число для графы «Масштаб» — **настоящее**, без подгонки к ряду 1:50/1:100
 * (G169, слова заказчика: «Масштаб пишем реальный - округление тут не
 * допустимо»). Знак после запятой ровно один, и вот почему: линейкой читают
 * полмиллиметра, на листе шириной 180 мм это 0,3 % — у знаменателя 137 те же
 * 0,3 % дают 0,4. Целое число врало бы на столько же, сколько сам замер, а
 * второй знак обещал бы точность, которой нет у калибровки, поставленной
 * пальцем по стене.
 *
 * Целое отношение остаётся целым: «1:100», а не «1:100,0».
 */
export function gostScaleText(denominator) {
  if (!(denominator > 0) || !Number.isFinite(denominator)) return strings.gost.noScale;
  const rounded = Math.round(denominator * 10) / 10;
  return text("gost.scaleValue", { value: String(rounded).replace(".", ",") });
}

/**
 * Подбор формата и ориентации под план: `{sheet, field, fit, textMm, tooSmall}`.
 *
 * Правило простое и проверяемое: берётся **самый мелкий формат**, на котором
 * подпись метки остаётся не мельче 2,5 мм (меньше на чертеже не ставят —
 * ГОСТ 2.304). Заказчик печатает только A4, и уводить его на A3 без причины
 * нельзя; причина же тут ровно одна — читаемость на бумаге.
 *
 * Ориентация выбирается по плану, а не по формату: из двух берётся та, где
 * план вписывается крупнее. Квадратный план даёт одинаковый масштаб обеим —
 * тогда остаётся книжная, как у бумаги по умолчанию.
 *
 * `textPx` — высота подписи в пикселях плана (её знает `render.labelBox`).
 * Ни один формат не дал читаемого размера — возвращается самый крупный и
 * `tooSmall: true`: молчать об этом нельзя, лист всё равно выйдет.
 */
export function gostPickSheet(plan, options = {}) {
  const form = options.form || "form3";
  const textPx = options.textPx > 0 ? options.textPx : 0;
  const minText = options.minTextMm > 0 ? options.minTextMm : GOST_MIN_TEXT_MM;
  const choiceFor = (format) => {
    const variants = ["portrait", "landscape"].map((orientation) => {
      const sheet = gostSheetSize(format, orientation);
      const field = gostField(sheet, form);
      const fit = gostFit(plan, field);
      return { sheet, field, fit, textMm: textPx * fit.scale, tooSmall: false };
    });
    return variants[1].fit.scale > variants[0].fit.scale ? variants[1] : variants[0];
  };
  let last = null;
  for (const format of GOST_FORMATS) {
    last = choiceFor(format.id);
    if (textPx <= 0 || last.textMm >= minText) return last;
  }
  return { ...last, tooSmall: true };
}

/**
 * Раскладка листа: либо подобранная (`format` пуст или «auto»), либо заданная
 * руками. Ручной выбор оставлен сознательно — у заказчика один принтер, и
 * «всегда A4» он должен уметь сказать сам; предупреждение о мелкоте при этом
 * остаётся.
 */
export function gostSheetLayout(plan, options = {}) {
  const form = options.form || "form3";
  if (!options.format || options.format === "auto") return gostPickSheet(plan, options);
  const sheet = gostSheetSize(options.format, options.orientation);
  const field = gostField(sheet, form);
  const fit = gostFit(plan, field);
  const textPx = options.textPx > 0 ? options.textPx : 0;
  const textMm = textPx * fit.scale;
  const minText = options.minTextMm > 0 ? options.minTextMm : GOST_MIN_TEXT_MM;
  return { sheet, field, fit, textMm, tooSmall: textPx > 0 && textMm < minText };
}

// ——— листы текстового документа ————————————————————————————————————————

// Шаг строки таблицы на бумаге. 8 мм — шаг таблиц СПДС (форма 7 «Спецификация»).
export const GOST_TABLE_ROW_MM = 8;

/**
 * Разбивка таблицы на листы: первый по форме 5, последующие по форме 6 — у
 * них разная высота надписи, а значит и разное число строк. Возвращает
 * `[{form, from, to}]`, и длина этого списка и есть «Листов M» в штампе:
 * номер на бумаге считается тем же кодом, что и число файлов.
 *
 * Одна строка поля уходит под шапку колонок: она повторяется на каждом листе,
 * иначе второй лист таблицы читать нечем.
 *
 * Пустая таблица даёт один лист, а не ноль: лист с одной шапкой — это ответ
 * «строк нет», а отсутствие файла — это молчание.
 */
export function gostPaginate(total, sheet, options = {}) {
  const rowMm = options.rowMm > 0 ? options.rowMm : GOST_TABLE_ROW_MM;
  const first = options.first || "form5";
  const next = options.next || "form6";
  const pages = [];
  let at = 0;
  do {
    const form = pages.length === 0 ? first : next;
    const room = Math.max(1, Math.floor(gostField(sheet, form).height / rowMm) - 1);
    pages.push({ form, from: at, to: Math.min(total, at + room) });
    at += room;
  } while (at < total);
  return pages;
}

// ——— основная надпись ——————————————————————————————————————————————————
//
// Ниже — сетка форм из приложения Ж. Координаты в миллиметрах от левого
// верхнего угла самой надписи, поэтому их видно глазами и сверить с чертежом
// стандарта можно построчно.
//
// Колонки блока изменений: Изм. | Кол.уч. | Лист | № док. | Подп. | Дата.
const GOST_CHANGE_COLUMNS = [10, 10, 10, 10, 15, 10];
// Колонки блока подписей: характер работы | фамилия | подпись | дата.
const GOST_WORK_COLUMNS = [20, 20, 15, 10];
// Левый блок у всех трёх форм одной ширины.
const GOST_LEFT_WIDTH = 65;
const GOST_ROW = 5;

function gostRow(columns, x0, y, height, make) {
  const cells = [];
  let x = x0;
  columns.forEach((width, index) => {
    cells.push({ x, y, width, height, ...(make ? make(index) : {}) });
    x += width;
  });
  return cells;
}

// Строки блока изменений: верхние пустые, нижняя — с названиями колонок.
function gostChangeBlock(rows) {
  const cells = [];
  for (let index = 0; index < rows; index += 1) {
    cells.push(...gostRow(GOST_CHANGE_COLUMNS, 0, index * GOST_ROW, GOST_ROW));
  }
  const titles = ["changeNo", "changeArea", "changeSheet", "changeDoc", "changeSign", "changeDate"];
  cells.push(
    ...gostRow(GOST_CHANGE_COLUMNS, 0, rows * GOST_ROW, GOST_ROW, (index) => ({
      label: titles[index],
      size: 2.5,
    })),
  );
  return cells;
}

// Строки подписей: первая «Разраб.», последняя «Н. контр.» — так напечатано в
// самом стандарте. Между ними свободные строки, и в них уходят «Пров.» и
// «Утв.»: кто именно проверял и утверждал, решает организация, а не форма.
function gostWorkBlock(top, rows) {
  const cells = [];
  for (let index = 0; index < rows; index += 1) {
    const y = top + index * GOST_ROW;
    const role = index === 0 ? "roleAuthor" : index === rows - 1 ? "roleControl" : null;
    cells.push(
      ...gostRow(GOST_WORK_COLUMNS, 0, y, GOST_ROW, (column) => {
        if (column === 0) return role ? { label: role, size: 2.5, align: "left" } : { field: "role" + index, size: 2.5, align: "left" };
        if (column === 1) return { field: "name" + index, size: 3.5 };
        if (column === 2) return { field: "sign" + index, size: 3.5 };
        return { field: "date" + index, size: 2.5 };
      }),
    );
  }
  return cells;
}

const GOST_FORM_BUILDERS = {
  // Форма 3 — листы основных комплектов рабочих чертежей (у нас — схемы).
  form3() {
    const left = [...gostChangeBlock(4), ...gostWorkBlock(25, 6)];
    const right = [
      { x: 65, y: 0, width: 120, height: 10, field: "code", size: 7 },
      { x: 65, y: 10, width: 120, height: 15, field: "object", size: 5, lines: 2 },
      { x: 65, y: 25, width: 70, height: 15, field: "building", size: 3.5, lines: 2 },
      { x: 135, y: 25, width: 15, height: 5, label: "stage", size: 2.5 },
      { x: 150, y: 25, width: 15, height: 5, label: "sheet", size: 2.5 },
      { x: 165, y: 25, width: 20, height: 5, label: "sheets", size: 2.5 },
      { x: 135, y: 30, width: 15, height: 10, field: "stage", size: 3.5 },
      { x: 150, y: 30, width: 15, height: 10, field: "sheet", size: 3.5 },
      { x: 165, y: 30, width: 20, height: 10, field: "sheets", size: 3.5 },
      { x: 65, y: 40, width: 70, height: 15, field: "drawing", size: 3.5, lines: 3 },
      { x: 135, y: 40, width: 50, height: 15, field: "org", size: 3.5, lines: 2 },
    ];
    return {
      height: 55,
      cells: [...left, ...right],
      thick: [
        [0, 25, 185, 25],
        [0, 20, 65, 20],
        [135, 30, 185, 30],
        [65, 40, 185, 40],
        [65, 0, 65, 55],
      ],
    };
  },
  // Форма 5 — первый (заглавный) лист текстового документа: у нас это таблица.
  form5() {
    const left = [...gostChangeBlock(2), ...gostWorkBlock(15, 5)];
    const right = [
      { x: 65, y: 0, width: 120, height: 15, field: "code", size: 7 },
      { x: 65, y: 15, width: 70, height: 25, field: "document", size: 5, lines: 3 },
      { x: 135, y: 15, width: 15, height: 5, label: "stage", size: 2.5 },
      { x: 150, y: 15, width: 15, height: 5, label: "sheet", size: 2.5 },
      { x: 165, y: 15, width: 20, height: 5, label: "sheets", size: 2.5 },
      { x: 135, y: 20, width: 15, height: 5, field: "stage", size: 3.5 },
      { x: 150, y: 20, width: 15, height: 5, field: "sheet", size: 3.5 },
      { x: 165, y: 20, width: 20, height: 5, field: "sheets", size: 3.5 },
      { x: 135, y: 25, width: 50, height: 15, field: "org", size: 3.5, lines: 2 },
    ];
    return {
      height: 40,
      cells: [...left, ...right],
      thick: [
        [0, 15, 185, 15],
        [0, 10, 65, 10],
        [135, 20, 185, 20],
        [135, 25, 185, 25],
        [65, 0, 65, 40],
      ],
    };
  },
  // Форма 6 — последующие листы: обозначение документа и номер листа.
  form6() {
    const cells = [
      ...gostChangeBlock(2),
      { x: 65, y: 0, width: 110, height: 15, field: "code", size: 5 },
      { x: 175, y: 0, width: 10, height: 7, label: "sheet", size: 2.5 },
      { x: 175, y: 7, width: 10, height: 8, field: "sheet", size: 3.5 },
    ];
    return {
      height: 15,
      cells,
      thick: [
        [0, 10, 65, 10],
        [65, 0, 65, 15],
        [175, 0, 175, 15],
      ],
    };
  },
};

const GOST_FORM_CACHE = new Map();

/**
 * Сетка основной надписи: `{height, cells, thick}` в миллиметрах от её левого
 * верхнего угла. `cells` — тонкие ячейки, у каждой либо `label` (постоянная
 * надпись формы), либо `field` (ключ значения), либо ничего (пустая клетка
 * блока изменений). `thick` — отрезки основной линии.
 */
export function gostStampForm(form) {
  const key = GOST_FORM_BUILDERS[form] ? form : "form3";
  if (!GOST_FORM_CACHE.has(key)) GOST_FORM_CACHE.set(key, GOST_FORM_BUILDERS[key]());
  return GOST_FORM_CACHE.get(key);
}

/**
 * Значения граф по данным штампа и по листу.
 *
 * Что куда ложится (номера граф — по приложению Ж):
 * - (1) обозначение документа — шифр из данных штампа;
 * - (2) наименование предприятия — имя объекта;
 * - (3) наименование здания — помещение, когда лист режется по комнате, иначе
 *   пусто: отдельного «здания» в данных нет, а лист по кухне — это и есть
 *   часть объекта;
 * - (4) наименование изображений — имя схемы и **масштаб** второй строкой.
 *   Своей графы «Масштаб» у формы 3 нет (она есть у формы 4, для изделий), и
 *   по СПДС масштаб пишут под наименованием изображения — туда он и идёт;
 * - (6), (7), (8) — стадия, лист, листов;
 * - (9) — организация.
 *
 * Пустое поле остаётся пустым: лист всё равно выходит, графа просто не
 * заполнена — так же, как у чертежа, который ещё не подписали.
 */
export function gostStampValues(stamp, sheetInfo = {}) {
  const data = stamp || {};
  const values = {
    code: data.code || "",
    object: sheetInfo.object || "",
    building: sheetInfo.building || "",
    drawing: [sheetInfo.drawing || "", sheetInfo.scale || ""].filter(Boolean).join("\n"),
    document: [sheetInfo.object || "", sheetInfo.drawing || ""].filter(Boolean).join("\n"),
    stage: data.stage || "",
    sheet: sheetInfo.sheet == null ? "" : String(sheetInfo.sheet),
    sheets: sheetInfo.sheets == null ? "" : String(sheetInfo.sheets),
    org: data.org || "",
    name1: data.author || "",
    date1: data.author ? sheetInfo.date || "" : "",
  };
  // Строки «Пров.» и «Утв.» — свободные строки формы: название работы в них
  // печатается только тогда, когда есть фамилия. Пустая строка с подписью
  // «Утв.» и без фамилии читалась бы как «не утверждено», а это не так: её
  // просто не заполняли.
  if (data.checker) {
    values.role2 = strings.gost.roleChecker;
    values.name2 = data.checker;
    values.date2 = sheetInfo.date || "";
  }
  if (data.approver) {
    values.role3 = strings.gost.roleApprover;
    values.name3 = data.approver;
    values.date3 = sheetInfo.date || "";
  }
  return values;
}

// ——— отрисовка ————————————————————————————————————————————————————————
//
// Рисование принимает готовый `ctx` и ничего не знает ни про DOM, ни про
// выгрузку: холст заводит `exporter.js`, как и для всех прежних картинок.

// Чертёжный шрифт — тот же, что подключён странице (`--font-gost` в стилях).
// Имя семейства техническое, поэтому живёт здесь, а не в словаре строк.
// Запасные шрифты обязательны: не дошёл файл — надпись всё равно читается.
export const GOST_FONT_NAME = "GOST type A";
export const GOST_FONT = '"' + GOST_FONT_NAME + '", system-ui, Arial, sans-serif';

function gostSetFont(ctx, sizeMm, mm) {
  ctx.font = Math.max(1, sizeMm * mm) + "px " + GOST_FONT;
}

// Текст, ужатый до ширины ячейки: сначала мельче шрифтом (но не мельче 2,5 мм),
// потом с отточием. Обрезать молча нельзя — обозначение документа, не влезшее
// в графу, человек должен увидеть хотя бы началом.
function gostDrawText(ctx, value, cell, mm, sizeMm) {
  const limit = (cell.width - 2) * mm;
  let size = sizeMm;
  gostSetFont(ctx, size, mm);
  while (size > GOST_MIN_TEXT_MM && ctx.measureText(value).width > limit) {
    size = Math.max(GOST_MIN_TEXT_MM, size - 0.25);
    gostSetFont(ctx, size, mm);
  }
  let out = value;
  if (ctx.measureText(out).width > limit) {
    while (out.length > 1 && ctx.measureText(out + "…").width > limit) out = out.slice(0, -1);
    out += "…";
  }
  return out;
}

// Разбивка значения на строки: сначала по переводам строки (их ставит
// `gostStampValues`), потом по словам — сколько строк позволяет ячейка.
function gostWrap(ctx, value, cell, mm, sizeMm) {
  const limit = (cell.width - 2) * mm;
  const maxLines = cell.lines || 1;
  const out = [];
  gostSetFont(ctx, sizeMm, mm);
  for (const part of String(value).split("\n")) {
    if (out.length >= maxLines) break;
    const words = part.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width <= limit || !line) {
        line = next;
        continue;
      }
      out.push(line);
      line = word;
      if (out.length >= maxLines) break;
    }
    if (line && out.length < maxLines) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

function gostCellText(ctx, value, cell, mm) {
  if (!value) return;
  const sizeMm = cell.size || 3.5;
  const lines = gostWrap(ctx, value, cell, mm, sizeMm);
  const step = sizeMm * 1.25 * mm;
  const top = (cell.y + cell.height / 2) * mm - ((lines.length - 1) * step) / 2;
  ctx.textBaseline = "middle";
  for (let index = 0; index < lines.length; index += 1) {
    const drawn = gostDrawText(ctx, lines[index], cell, mm, sizeMm);
    if (cell.align === "left") {
      ctx.textAlign = "left";
      ctx.fillText(drawn, (cell.x + 1) * mm, top + index * step);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(drawn, (cell.x + cell.width / 2) * mm, top + index * step);
    }
  }
}

function gostLine(ctx, x1, y1, x2, y2, mm, widthMm) {
  ctx.lineWidth = Math.max(1, widthMm * mm);
  ctx.beginPath();
  ctx.moveTo(x1 * mm, y1 * mm);
  ctx.lineTo(x2 * mm, y2 * mm);
  ctx.stroke();
}

/**
 * Рамка листа: поле подшивки слева, обрез с трёх сторон. Белая подложка листа
 * заливается здесь же — лист обязан быть белым целиком, включая поля.
 */
export function drawGostFrame(ctx, sheet, mm) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sheet.width * mm, sheet.height * mm);
  const frame = gostFrame(sheet);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(1, GOST_LINE_MM * mm);
  ctx.strokeRect(frame.x * mm, frame.y * mm, frame.width * mm, frame.height * mm);
  ctx.restore();
}

/**
 * Основная надпись: сетка формы и значения граф. `values` — то, что отдал
 * `gostStampValues`; постоянные надписи формы берутся из словаря.
 */
export function drawGostStamp(ctx, sheet, form, values, mm) {
  const rect = gostStampRect(sheet, form);
  const grid = gostStampForm(form);
  ctx.save();
  ctx.translate(rect.x * mm, rect.y * mm);
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  for (const cell of grid.cells) {
    ctx.lineWidth = Math.max(1, GOST_THIN_MM * mm);
    ctx.strokeRect(cell.x * mm, cell.y * mm, cell.width * mm, cell.height * mm);
  }
  for (const [x1, y1, x2, y2] of grid.thick) gostLine(ctx, x1, y1, x2, y2, mm, GOST_LINE_MM);
  ctx.lineWidth = Math.max(1, GOST_LINE_MM * mm);
  ctx.strokeRect(0, 0, GOST_STAMP_WIDTH_MM * mm, grid.height * mm);
  for (const cell of grid.cells) {
    if (cell.label) gostCellText(ctx, strings.gost.labels[cell.label] || "", cell, mm);
    else if (cell.field) gostCellText(ctx, (values && values[cell.field]) || "", cell, mm);
  }
  ctx.restore();
}
