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
// **Унаследованное видно, но не записано** (таск 243, требование G365). Слова
// заказчика: «размеры ни у чего не указаны», «у самих меток поля размеров
// пустые». Числа у метки были — лестница `markSizes` берёт их у группы (G203)
// и у типа (G192), и объём рисует именно по ним, — а окно показывало одно
// своё, `markDimensions`. Теперь пустое поле несёт унаследованное число
// подсказкой, под полями сказано, из типа оно или из группы, а сводка в строке
// метки ставит не своё в скобки. Смысл пустого поля при этом не изменился:
// пусто — «беру у лестницы», и открытие окна не пишет в метку ни одного числа
// (G68) — `markSizesInherited` считает по копии метки, а не по ней самой.
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
 * Откуда взято значение поля — `"group"`, `"type"` или `null` («своё» и
 * «неизвестно» здесь одно и то же: в строку они идут без скобок).
 *
 * Читается у **того же объекта**, что и числа: ответ `markSizes` несёт
 * `<поле>From` рядом с `<поле>`. Поэтому сводке не нужен ни второй аргумент,
 * ни проект: позвали с меткой — вышли её свои размеры, позвали с ответом
 * лестницы — те, по которым рисует сборка.
 */
function markSizesOriginOf(source, field) {
  const from = source ? source[field + "From"] : null;
  return from === "group" || from === "type" ? from : null;
}

// Слово о происхождении для хвоста строки. Группа делится только высотой над
// полом (G203), поэтому «из типа и группы» однозначно: от пола — из группы,
// габарит — из типа.
function markSizesFromWord(origins) {
  if (origins.has("group")) return origins.has("type") ? strings.markSizes.fromBoth : strings.markSizes.fromGroup;
  return strings.markSizes.fromType;
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
 *
 * **Унаследованное — в скобках, и в хвосте сказано, откуда** (таск 243,
 * требование G365). Слова заказчика: «у самих меток поля размеров пустые».
 * Пустой была только подпись: числа лестница `markSizes` брала у группы и у
 * типа, и объём рисовал по ним. Позовите сводку с ответом лестницы —
 * «Д (80) · Ш (10) · В (80) · от пола (900) мм · из типа», — и в строке стоит
 * то, по чему рисуют, а не то, чего у метки нет.
 *
 * С голой меткой (умолчания типа, копия, тест) сводка отвечает как до таска:
 * `<поле>From` у неё нет вовсе, и скобкам взяться неоткуда.
 */
export function markSizesSummary(mark, seat = MARK_AXIS_UPRIGHT) {
  const values = markDimensions(mark);
  const parts = [];
  const origins = new Set();
  for (const field of markSizesOrder(seat)) {
    if (values[field] === null) continue;
    const origin = markSizesOriginOf(mark, field);
    const number = markSizesNumber(values[field]);
    if (origin) origins.add(origin);
    parts.push(
      text(markSizesKey(field, seat, "Short")) +
        " " +
        (origin ? text("markSizes.inheritedValue", { value: number }) : number),
    );
  }
  if (parts.length === 0) return "";
  const summary = text("markSizes.summary", { values: parts.join(" · "), unit: strings.markSizes.unit });
  if (origins.size === 0) return summary;
  return text("markSizes.summaryFrom", { summary, from: markSizesFromWord(origins) });
}

/**
 * Что метка возьмёт у лестницы, **если своего у неё не останется**: высота
 * группы (G203) или умолчание типа, с `<поле>From` при каждом числе. `null` —
 * наследовать нечего.
 *
 * Считается не по текущим числам метки, а по её копии без них: так отвечает
 * честно и то поле, которое уже заполнено рукой — именно это число встанет в
 * нём, когда поле очистят. Копия — в своей переменной (`{...mark}`), объект от
 * этого не меняется ни одним ключом (G68): `markSizes` только читает.
 */
export function markSizesInherited(project, mark) {
  if (!mark) return null;
  const bare = { ...mark };
  for (const field of MARK_DIMENSION_FIELDS) bare[field] = null;
  const sizes = markSizes(project, bare);
  return MARK_DIMENSION_FIELDS.some((field) => sizes[field] !== null) ? sizes : null;
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
    // Унаследованное целиком — все четыре числа с тем, откуда каждое взято
    // (таск 243): по высоте считается посадка, как её считает объём, а
    // остальные три стоят подсказкой в своих пустых полях.
    inherited: markSizesInherited(project, mark),
  });
}

function openSizesPicker({ title, hints, current, onWall, inherited }) {
  return new Promise((resolve) => {
    const inputs = new Map();
    const labels = new Map();
    // Строка причины — общий кирпич (`uiBadLine`, находка 9 разбора механик):
    // ответ окна и ответ колонки чертежа теперь один, и вид у него один.
    const error = uiBadLine();

    // Унаследованное число поля — то, что встанет в нём, если его очистить.
    // У окна умолчаний типа наследовать не от кого, и ответ здесь `null` на
    // каждое поле: ни подсказки в поле, ни строки под полями не появится.
    const inheritedOf = (field) => (inherited ? inherited[field] : null);

    // Посадка, с которой окно открывается: по высоте над полом, которая у
    // вещи уже есть — своей или унаследованной.
    let seat = axisSeatOf(current.heightAboveFloor === null ? inheritedOf("heightAboveFloor") : current.heightAboveFloor, onWall);
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
      return axisSeatOf(own === null ? inheritedOf("heightAboveFloor") : own, onWall);
    };

    const cell = (field, cellClass) => {
      const label = markSizesLabel(field, seat);
      const fallback = inheritedOf(field);
      const input = uiEl("input", {
        class: "ui-input sizes__input",
        type: "number",
        value: current[field] === null ? "" : String(current[field]),
        // Унаследованное число — подсказкой **в самом поле** (таск 243): пустое
        // поле по-прежнему значит «своего нет, беру у лестницы», и ввод от
        // этого не усложняется ни одним движением, а число, по которому рисует
        // объём, видно без догадок. Своё введённое его закрывает собой, стёртое
        // — показывает снова: ровно то, что метка и сделает.
        placeholder: fallback === null ? "" : markSizesNumber(fallback),
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
    // **Откуда унаследованное — словом, под полями** (таск 243). Бледное число
    // в поле говорит «не моё», но не говорит, чьё: высота, записанная рукой у
    // соседа по блоку, — не умолчание справочника, и путать их нельзя (G203).
    // Поэтому по строке на источник: «Унаследовано из типа: Д 80 · Ш 10 · В 80
    // мм», «Унаследовано из группы: от пола 300 мм».
    //
    // Строки пересобираются на каждый ввод и считают по **пустым** полям: что
    // человек заполнил — то уже своё, и обещать ему наследование было бы
    // враньём. Заполнил всё — строк нет вовсе.
    const inheritedNode = uiEl("div", { class: "sizes__inherited" });
    const paintInherited = () => {
      inheritedNode.replaceChildren();
      if (!inherited) return;
      for (const origin of ["type", "group"]) {
        const values = {};
        let any = false;
        for (const field of MARK_DIMENSION_FIELDS) {
          const empty = String(inputs.get(field).value).trim() === "";
          const mine = empty && inherited[field + "From"] === origin && inherited[field] !== null;
          values[field] = mine ? inherited[field] : null;
          if (mine) any = true;
        }
        if (!any) continue;
        // Сводка считается по голым числам: откуда они, уже сказано строкой, и
        // скобки в ней были бы вторым ответом на тот же вопрос.
        const line = text("markSizes.inherited", {
          from: origin === "group" ? strings.markSizes.fromGroup : strings.markSizes.fromType,
          values: markSizesSummary(values, seat),
        });
        inheritedNode.append(uiEl("span", { text: line }));
      }
    };

    // Поля местами окно не переставляет: столбцы прыгали бы под руками. Имена
    // и подсказка — переписываются, место поля остаётся за ним.
    inputs.get("heightAboveFloor").addEventListener("input", (event) => {
      applySeat(seatNow(event.target.value));
    });
    // Строки наследования идут за каждым полем: опустевшее поле обязано
    // назвать то, что в него вернулось, тут же — а не к следующему открытию.
    // Посадка к этому моменту уже переписана, и короткие буквы в строке
    // (Ш против В) встают по ней.
    for (const input of inputs.values()) input.addEventListener("input", () => paintInherited());
    paintInherited();

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
      body: uiEl("div", { class: "sizes" }, [hintNode, ...rows, inheritedNode, error]),
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
