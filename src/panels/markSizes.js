// Окно размеров метки: габарит вещи тройкой — длина, ширина, высота — и
// высота над полом отдельной строкой под ним (таск 158, требование G233).
// Что чем называется и почему — у `MARK_DIMENSION_FIELDS` в `model.js`.
//
// **Имена двух полей зависят от посадки** (таск 161, дефект D36): у вещи на
// стене вверх идёт `width`, у вещи лицом вниз вниз свисает `depth`, и подпись
// идёт за тем, что рисуется, а не за ключом файла. Решает посадку
// `markAxisSeat`/`typeAxisSeat` (`model.js`), окно только подписывает.
//
// Отдельный файл по той же причине, что и `markControls.js`: в строке списка
// этому тесно. Строка метки и так собирает семь полей, а числа, которые
// заполняют не в момент постановки, а потом и не у каждой метки, в неё не
// помещаются — заказчик сам попросил «отдельное окно».
//
// Единицу окно не выбирает и не переводит: в модели лежат миллиметры
// (`MARK_DIMENSION_UNIT`), словом их называет `strings.markSizes.unit`.
// Здесь она только подставляется в подписи — чтобы была видна, а не
// подразумевалась.
import { strings, text } from "../strings.js";
import {
  MARK_AXIS_FLAT,
  MARK_AXIS_UPRIGHT,
  MARK_DIMENSION_FIELDS,
  MARK_DIMENSION_MAX,
  MARK_DIMENSION_SIGNED,
  axisSeatOf,
  findMark,
  findType,
  labelOf,
  markAxisSeat,
  markDimensionValue,
  markDimensions,
  markOnWall,
  markSizes,
  typeAxisSeat,
  typeSizes,
} from "../model.js";
import { uiBadLine, uiButton, uiEl, uiMarkBad, uiModal } from "./ui.js";

// Поля, у которых имя зависит от посадки (таск 161): «Длина» и «Высота над
// полом» при любой посадке значат одно и то же, и второго имени у них нет.
const MARK_SIZES_SEATED = ["width", "depth"];

/**
 * Ключ строки поля при этой посадке. У вещи лицом вниз два поля берутся из
 * раздела `markSizes.flat`, остальные — из общего: так в словаре не появляется
 * второй копии неизменных подписей.
 */
function markSizesKey(field, seat, suffix = "") {
  const flat = seat === MARK_AXIS_FLAT && MARK_SIZES_SEATED.includes(field);
  return "markSizes." + (flat ? "flat." : "") + field + suffix;
}

/**
 * Подпись поля с единицей: «Длина, мм». Складывается подстановкой, чтобы
 * единица была написана в словаре один раз.
 *
 * `seat` — посадка вещи (`markAxisSeat`, `typeAxisSeat`): у вещи на стене вверх
 * идёт `width`, у вещи лицом вниз — `depth`, и подпись идёт за посадкой, а не
 * за ключом. Без довода подписи остаются стенными — ими они и были до таска 161.
 */
export function markSizesLabel(field, seat = MARK_AXIS_UPRIGHT) {
  return text(markSizesKey(field, seat), { unit: strings.markSizes.unit });
}

/**
 * Порядок трёх габаритов на экране — **всегда Д · Ш · В**, как их пишут на
 * чертеже. Имена у двух полей меняются местами по посадке (таск 161), значит и
 * поля меняются местами за ними: иначе у потолочной вещи кнопка читалась бы
 * «Д 500 · В 300 · Ш 400», верно по числам и задом наперёд по порядку.
 * Разбор полей (`markSizesParse`) этого порядка не знает и знать не должен —
 * он идёт по ключам файла.
 */
export function markSizesOrder(seat = MARK_AXIS_UPRIGHT) {
  if (seat !== MARK_AXIS_FLAT) return MARK_DIMENSION_FIELDS;
  return ["length", "width", "depth", "heightAboveFloor"];
}

// Число в подпись кнопки. Дробное пишется через запятую — так его и набирают;
// в поле ввода оно остаётся с точкой, иначе `input[type=number]` его не примет.
function markSizesNumber(value) {
  return String(value).replace(".", ",");
}

/**
 * Что показывает кнопка в строке метки: «Д 900 · Ш 200 · В 300 · от пола 2300
 * мм» по заданным размерам и пустая строка, если не задан ни один.
 *
 * Считается здесь, а не в разметке: «у метки размеров нет» должно быть видно
 * без открытия окна — и проверяться без браузера. Соседние кнопки устроены так
 * же: «Оборудование: 2» и «Управляет: Т1, Т2» тоже говорят содержимым.
 *
 * `seat` — посадка (таск 161): у потолочной люстры 500 × 400 при выступе 300
 * кнопка говорит «Д 500 · Ш 400 · В 300 мм», и свисающие 300 стоят под той же
 * буквой, что и на чертеже. Без довода подпись остаётся стенной.
 */
export function markSizesSummary(mark, seat = MARK_AXIS_UPRIGHT) {
  const values = markDimensions(mark);
  const parts = [];
  for (const field of markSizesOrder(seat)) {
    if (values[field] === null) continue;
    parts.push(text(markSizesKey(field, seat, "Short")) + " " + markSizesNumber(values[field]));
  }
  if (parts.length === 0) return "";
  return text("markSizes.summary", { values: parts.join(" · "), unit: strings.markSizes.unit });
}

/**
 * Разбор полей окна. Пустое — `null` («не задано»), ноль — значение,
 * отрицательное и нечисловое — в `invalid`: окно на них не закрывается, а
 * подсвечивает поле. Правило одно с моделью — это её же `markDimensionValue`.
 */
export function markSizesParse(raw) {
  const values = {};
  const invalid = [];
  for (const field of MARK_DIMENSION_FIELDS) {
    try {
      values[field] = markDimensionValue(raw ? raw[field] : null, field);
    } catch (error) {
      values[field] = null;
      invalid.push({ field, message: error && error.message ? error.message : String(error) });
    }
  }
  return { values, invalid };
}

/**
 * Окно правки. Отвечает четырьмя значениями (`null` — «не задано») или `null`,
 * если передумали. Сохраняет ответ в объект не оно, а список меток: правка
 * идёт через `canvasCommit`, и место у неё одно — там же, где остальные
 * правки строки.
 */
/**
 * То же окно, но для **умолчаний типа** (таск 135, требование G192): «для
 * меток надо бы прописать дефолтные размеры, которые уже можно будет править».
 *
 * Второго окна не заводится нарочно: поля те же, проверка та же, подпись
 * та же. Разница только в заголовке и подсказке — и в том, что заполненное
 * здесь метка наследует, пока не задала своё.
 */
export function openTypeSizesPicker(project, typeId) {
  const type = findType(project, typeId);
  return openSizesPicker({
    title: text("markSizes.typeTitle", { label: type ? type.code + " — " + type.name : "" }),
    hints: { [MARK_AXIS_UPRIGHT]: strings.markSizes.typeHint, [MARK_AXIS_FLAT]: strings.markSizes.flat.typeHint },
    current: typeSizes(type),
    // У типа стены нет и наследовать высоту ему не от кого: посадку решает
    // только его собственное умолчание высоты над полом (`typeAxisSeat`).
    onWall: false,
    inherited: null,
  });
}

export function openMarkSizesPicker(project, markId) {
  const mark = findMark(project, markId);
  return openSizesPicker({
    title: text("markSizes.title", { label: labelOf(project, markId) }),
    hints: { [MARK_AXIS_UPRIGHT]: strings.markSizes.hint, [MARK_AXIS_FLAT]: strings.markSizes.flat.hint },
    current: markDimensions(mark),
    onWall: markOnWall(project, mark),
    // Унаследованная высота (группы или типа) — та, с которой метка останется,
    // если очистить поле: по ней и считается посадка, как её считает объём.
    inherited: markSizes(project, mark).heightAboveFloor,
  });
}

function openSizesPicker({ title, hints, current, onWall, inherited }) {
  return new Promise((resolve) => {
    const inputs = new Map();
    const labels = new Map();
    // Строка причины — общий кирпич (`uiBadLine`, находка 9 разбора механик):
    // ответ окна и ответ колонки чертежа теперь один, и вид у него один.
    const error = uiBadLine();

    // Посадка, с которой окно открывается: по высоте над полом, которая у
    // вещи уже есть — своей или унаследованной.
    let seat = axisSeatOf(current.heightAboveFloor === null ? inherited : current.heightAboveFloor, onWall);
    const hintNode = uiEl("p", { class: "modal__hint", text: hints[seat] });

    // Посадка по тому, что **сейчас набрано** в поле высоты над полом: именно
    // ею решаются имена двух полей (таск 161), а правят её в этом же окне.
    // Очищенное поле отдаёт высоту наследству — туда же, куда её отдаст метка.
    // Негодное набранное («абв») посадку не меняет: о нём скажет разбор при
    // сохранении, а подписи дёргаться от опечатки не должны.
    const seatNow = (raw) => {
      let own = null;
      try {
        own = markDimensionValue(raw, "heightAboveFloor");
      } catch (ignored) {
        return seat;
      }
      return axisSeatOf(own === null ? inherited : own, onWall);
    };

    const cell = (field, cellClass) => {
      const label = markSizesLabel(field, seat);
      const input = uiEl("input", {
        class: "ui-input sizes__input",
        type: "number",
        value: current[field] === null ? "" : String(current[field]),
        title: label,
        // Ширина — единственное поле, которое принимает минус: утопленное
        // (щит в нише) это та же ось и тот же ноль, просто в другую сторону.
        // Минус привязан к ключу, а не к имени: у вещи лицом вниз то же поле
        // подписано «Высотой», и отнимать у него знак значило бы запретить
        // сохранить объект, в котором он уже лежит.
        attrs: {
          min: String(MARK_DIMENSION_SIGNED.includes(field) ? -MARK_DIMENSION_MAX : 0),
          max: String(MARK_DIMENSION_MAX),
          step: "1",
          inputmode: "decimal",
        },
      });
      inputs.set(field, input);
      const caption = uiEl("span", { class: "sizes__label", text: label });
      labels.set(field, caption);
      return uiEl("label", { class: cellClass }, [caption, input]);
    };

    // Имена двух полей меняются местами по посадке, и меняться они обязаны
    // **на глазах**: число, которым посадка решается, стоит в этом же окне. Не
    // обновляй окно — и человек, очистивший высоту над полом у своей люстры,
    // остался бы со стенными именами до следующего открытия.
    const applySeat = (next) => {
      if (next === seat) return;
      seat = next;
      for (const [field, caption] of labels) {
        const label = markSizesLabel(field, seat);
        caption.textContent = label;
        inputs.get(field).title = label;
      }
      hintNode.textContent = hints[seat];
    };

    // **Три габарита — в строку** (таск 158, требование G233): «в интерфейсе
    // сделай 3 поля рядом : Длина, Ширина, Высота». Рядом они стоят не ради
    // красоты: это один габарит вещи, и набирают его втроём, как пишут на
    // чертеже — 900 × 200 × 300. Подпись у такого поля встаёт **над** ним:
    // слева, как в строке, на три столбца её не хватило бы.
    //
    // Высота над полом остаётся своей строкой под тройкой — она не размер
    // вещи, а место, куда вещь вешают, и в один ряд с габаритами её ставить
    // нельзя: «Высота» и «Высота над полом» рядом читались бы как одно.
    //
    // Порядок тройки берётся у посадки (`markSizesOrder`, таск 161): на экране
    // всегда Д · Ш · В, какое бы поле ни звалось высотой.
    const trio = markSizesOrder(seat).filter((field) => field !== "heightAboveFloor");
    const floorCell = cell("heightAboveFloor", "sizes__row");
    const rows = [
      uiEl("div", { class: "sizes__trio" }, trio.map((field) => cell(field, "sizes__cell"))),
      floorCell,
    ];
    // Поля местами окно не переставляет: столбцы прыгали бы под руками. Имена
    // и подсказка — переписываются, место поля остаётся за ним.
    inputs.get("heightAboveFloor").addEventListener("input", (event) => {
      applySeat(seatNow(event.target.value));
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
      const bad = parsed.invalid.map((item) => ({ input: inputs.get(item.field), message: item.message }));
      if (uiMarkBad(error, [...inputs.values()], bad)) {
        // Фокус в плохое поле ставит **окно**, а не кирпич: здесь жест — кнопка
        // «Сохранить», и фокус стоит на ней. В колонке чертежа поле отдаёт
        // значение по уходу фокуса, и дёргать его обратно нельзя.
        bad[0].input.focus();
        return;
      }
      done(parsed.values);
    };

    modal = uiModal({
      title,
      body: uiEl("div", { class: "sizes" }, [hintNode, ...rows, error]),
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(null) } }),
        uiButton(strings.markSizes.save, { class: "ui-btn ui-btn--accent", on: { click: () => save() } }),
      ],
      onCancel: () => resolve(null),
    });
    // Ширину задаёт содержимое, а не общая мера диалогов (таск 175, дефект
    // D41: «ширина окна больше чем контент»). Общие 720 точек подобраны под
    // окна с текстом и списками; здесь три поля по полторы сотни, и остальные
    // триста пикселей оставались пустым полем с «Отменой» у дальнего края —
    // ровно то, от чего в сетках выбора завели `modal--fit`. Потолок у класса
    // прежний, так что на узком экране окно поджимается как раньше.
    if (modal.card) modal.card.classList.add("modal--fit");
  });
}
