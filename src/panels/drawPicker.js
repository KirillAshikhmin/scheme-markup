// Окно «Что добавить» (таск 187, требование G280).
//
// Слова заказчика: «Пусть для чертежа слева будет выделение и добавление ровно
// как и для меток, что добавить — выбираем уже в окне, при чем там так же
// выбирается сперва тип — стены, проёмы, объекты. При выборе верхней категории
// раскрывается уже вложенное меню, то, что сейчас слева блок соответствующий».
//
// **Эталон назван прямо: метки.** У них в колонке стоит плашка выбранного типа
// и ряд «Выделение · Добавление», а что ставить — выбирают окном
// (`typePicker.js`). Здесь то же самое, и лишнее в колонке чертежа кончилось:
// ряд «Стены · Проёмы · Объекты», виды проёмов, способы, размеры новой вещи и
// толщина новых стен переехали сюда.
//
// ——— почему шаги, а не три окна ———
//
// У меток тип выбирают одним окном, потому что тип — одна вещь. У чертежа
// вещей три породы, и настройки у них разные: у стены число, у проёма вид с
// размерами, у вещи плитка каталога со способом и габаритом. Поэтому окно одно,
// а шагов три: заголовки стоят друг под другом, раскрыт ровно один — тот,
// которым сейчас добавляют, — и в нём лежит то, что раньше занимало колонку.
// Строка под заголовком говорит, что поставит следующий клик, не раскрывая шаг:
// «толщина 100 мм», «Дверь, 900 × 2100 мм», «Радиатор, прямоугольник».
//
// ——— что показывает шаг «Стены» ———
//
// **Плиток у стен нет и быть не может**: стена — не вещь из каталога, выбирать
// у неё нечего. Из колонки сюда переехало единственное, что у новой стены
// настраивают, — **толщина**, и к ней добавлены плитки частых толщин, чтобы не
// набирать число руками. Второго «способа» рисовать стену в сборке нет: она
// рисуется цепочкой, и выдумывать ей выбор значило бы обещать то, чего нет.
//
// ——— один клик, повторный — закрыть ———
//
// Серия из шести вещей подряд (кухня) боялась переезда в окно не зря, и ответ
// тот же, что в таске 170: выбранное **залипает** в плашке колонки, и шесть
// одинаковых ставятся кликами по полю без единого диалога. Внутри окна правило
// одно на все три шага: первый клик по плитке выбирает, повторный по уже
// выбранной — закрывает окно и берётся за дело. То же делает кнопка в ряду
// окна («Чертить стены», «Ставить проём», «Ставить вещь») и Enter.
//
// Своего состояния окно не держит: оно получает настройки доводом и отдаёт их
// одним ответом. Писать в объект, в настройки браузера и в память страницы —
// дело хозяина (`panels/workshop.js`), иначе отказ («Отмена») оставлял бы за
// собой половину правок.
import { strings, text } from "../strings.js";
import { uiApply, uiButton, uiEl, uiField, uiModal, uiNumber } from "./ui.js";
import {
  DRAWING_MM_MAX,
  OPENING_KINDS,
  WALL_THICKNESS_MM_MAX,
  openingHasLeaf,
} from "../model.js";
import { createObjectTiles } from "./objectPicker.js";
import { objectCatalogName } from "../objectCatalog.js";

// Порядок шагов — порядок работы, заданный заказчиком (G176): сперва стены,
// потом проёмы, потом объекты. Он же порядок трёх списков в правой колонке.
export const DRAW_PICKER_STEPS = ["walls", "openings", "objects"];

// Частые толщины стен в миллиметрах: кирпич в полкирпича и в кирпич,
// газобетонная перегородка, гипсокартон на профиле 50 и 100, несущая панель.
// Ряд не закон: рядом с плитками стоит поле любого числа до
// `WALL_THICKNESS_MM_MAX`.
export const WALL_THICKNESS_PRESETS_MM = [80, 100, 120, 150, 200, 250, 380];

/** Как зовётся порода элемента: те же слова, что у трёх списков в колонке. */
export function drawPickerName(adding) {
  if (adding === "openings") return strings.workshop.toolOpenings;
  if (adding === "objects") return strings.workshop.toolObjects;
  return strings.workshop.toolWalls;
}

/** Подсказка шага: за что берутся, выбрав эту породу. */
export function drawPickerHint(adding) {
  if (adding === "openings") return strings.workshop.toolOpeningsHint;
  if (adding === "objects") return strings.workshop.toolObjectsHint;
  return strings.workshop.toolWallsHint;
}

/** Неизвестное слово — стены: окно обязано раскрыть хоть один шаг. */
export function drawPickerStepOf(adding) {
  return DRAW_PICKER_STEPS.includes(adding) ? adding : "walls";
}

/**
 * Строка «что поставит следующий клик» — **одна на окно и на плашку колонки**.
 *
 * Разойдись они, и человек читал бы в колонке одно, а в окне другое. Поэтому
 * считается она здесь и чистой функцией: `settings` — то же самое, что окно
 * получает доводом и отдаёт ответом.
 */
export function drawPickerNote(adding, settings = {}) {
  const walls = settings.walls || {};
  const openings = settings.openings || {};
  const objects = settings.objects || {};
  if (adding === "openings") {
    const kind = openings.kind;
    const sizes = (openings.sizes || {})[kind];
    if (!kind || !sizes) return strings.drawPicker.noteEmpty;
    return text("drawPicker.noteOpening", {
      kind: strings.openingKinds[kind] || kind,
      width: sizes.widthMm,
      height: sizes.heightMm,
    });
  }
  if (adding === "objects") {
    const name = objectCatalogName(objects.key);
    if (!name) return strings.drawPicker.noteEmpty;
    return text("drawPicker.noteObject", {
      name,
      way: strings.workshop["way_" + objects.way] || strings.workshop.way_rect,
    });
  }
  const thickness = Number(walls.thicknessMm);
  return thickness > 0 ? text("drawPicker.noteWalls", { thickness }) : strings.drawPicker.noteEmpty;
}

// Глубокая копия настроек: окно правит свою, и отказ («Отмена») не должен
// оставлять за собой ни одного числа. Строим вручную, а не `JSON.parse` —
// высота вещи бывает `null`, и путать «во всю высоту» с нулём нельзя.
function drawPickerSettings(options) {
  const walls = options.walls || {};
  const openings = options.openings || {};
  const objects = options.objects || {};
  const sizes = {};
  for (const [kind, value] of Object.entries(openings.sizes || {})) sizes[kind] = { ...value };
  return {
    adding: drawPickerStepOf(options.adding),
    walls: { thicknessMm: Number(walls.thicknessMm) || 100 },
    openings: {
      kind: OPENING_KINDS.includes(openings.kind) ? openings.kind : OPENING_KINDS[0],
      sizes,
      hinge: openings.hinge,
      swing: openings.swing,
    },
    objects: { key: objects.key || null, way: objects.way || "rect", sizes: { ...(objects.sizes || {}) } },
  };
}

/**
 * Открыть окно. Отдаёт настройки целиком или `null`, если закрыли.
 *
 * Ответ целиком, а не «только выбранный шаг»: всё, что в окне правят, — это
 * умолчания **нового** элемента, и записать их хозяин обязан разом. Иначе
 * поправленный размер окна терялся бы от того, что человек в последнюю минуту
 * решил чертить стену.
 *
 * `options.ways` — список способов поставить вещь, `options.defaultsOf` —
 * габариты вещи каталога по ключу. Хозяин у них один (`panels/workshop.js`), и
 * окно их только показывает: завести здесь второй список способов значило бы
 * развести окно с полем.
 */
export function openDrawPicker(options = {}) {
  return new Promise((resolve) => {
    const settings = drawPickerSettings(options);
    const ways = Array.isArray(options.ways) && options.ways.length > 0 ? options.ways : ["rect"];
    const defaultsOf = typeof options.defaultsOf === "function" ? options.defaultsOf : () => ({});
    let modal;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      modal.close();
      resolve(value);
    };
    // Берёмся за дело: окно закрывается и отдаёт настройки целиком.
    const start = () => finish({ ...settings });
    // Основное действие стоит **одной кнопкой в ряду карточки**, а не внизу
    // каждого шага: ряд действий у окна один, и Enter обязан нажимать то же,
    // что мышь (`uiModal` берёт основным последнюю кнопку ряда). Слово на ней
    // меняется вместе с раскрытым шагом — «Чертить стены», «Ставить проём»,
    // «Ставить вещь».
    const startButton = uiButton("", { class: "ui-btn ui-btn--accent", on: { click: start } });

    // ——— шаг «Стены»: толщина и ничего больше ———

    const thickness = uiNumber(1, WALL_THICKNESS_MM_MAX);
    uiApply(thickness, () => {
      const value = Math.round(Number(thickness.value));
      if (value > 0) settings.walls.thicknessMm = Math.min(WALL_THICKNESS_MM_MAX, value);
      sync();
    });
    const thicknessChips = WALL_THICKNESS_PRESETS_MM.map((value) =>
      uiButton(String(value), {
        class: "ui-btn ui-chip",
        attrs: { "data-thickness": String(value) },
        on: {
          click: () => {
            // Повторный клик по выбранной толщине — «берусь чертить»: то же
            // правило, что у плиток вещей.
            if (settings.walls.thicknessMm === value) {
              start();
              return;
            }
            settings.walls.thicknessMm = value;
            sync();
          },
        },
      }),
    );
    const wallsBody = uiEl("div", { class: "drawPicker__body" }, [
      uiEl("p", { class: "ui-field__label", text: strings.drawPicker.wallsPresets }),
      uiEl("div", { class: "ui-chips" }, thicknessChips),
      uiField(strings.workshop.thicknessNew, thickness),
      uiEl("p", { class: "drawPicker__about", text: strings.drawPicker.wallsAbout }),
    ]);

    // ——— шаг «Проёмы»: вид и размеры ———

    const kindChips = OPENING_KINDS.map((kind) =>
      uiButton(strings.openingKinds[kind], {
        class: "ui-btn ui-chip",
        attrs: { "data-kind": kind },
        on: {
          click: () => {
            if (settings.openings.kind === kind) {
              start();
              return;
            }
            settings.openings.kind = kind;
            sync();
          },
        },
      }),
    );
    const openingWidth = uiNumber(1, DRAWING_MM_MAX);
    const openingHeight = uiNumber(1, DRAWING_MM_MAX);
    const openingFloor = uiNumber(0, DRAWING_MM_MAX);
    const openingFields = [
      { input: openingWidth, key: "widthMm", min: 1 },
      { input: openingHeight, key: "heightMm", min: 1 },
      { input: openingFloor, key: "heightAboveFloorMm", min: 0 },
    ];
    for (const field of openingFields) {
      uiApply(field.input, () => {
        const value = Math.round(Number(field.input.value));
        const sizes = openingSizes();
        if (value >= field.min) settings.openings.sizes[settings.openings.kind] = { ...sizes, [field.key]: value };
        sync();
      });
    }
    // Створка двери: те же две кнопки, что стояли в колонке, — петли и сторона
    // открывания. У остальных видов створки нет, и ряд уходит целиком.
    const hinge = uiButton("", {
      class: "ui-btn ui-btn--wide",
      on: {
        click: () => {
          settings.openings.hinge = settings.openings.hinge === "end" ? "start" : "end";
          sync();
        },
      },
    });
    const swing = uiButton("", {
      class: "ui-btn ui-btn--wide",
      on: {
        click: () => {
          settings.openings.swing = settings.openings.swing === "right" ? "left" : "right";
          sync();
        },
      },
    });
    const doorRow = uiEl("div", { class: "ui-fields" }, [hinge, swing]);
    const openingsBody = uiEl("div", { class: "drawPicker__body" }, [
      uiEl("div", { class: "ui-chips" }, kindChips),
      // Поля в две колонки: столбиком они растили окно так, что кнопка «Ставить
      // проём» уезжала за нижний край карточки (поймано живым прогоном).
      uiEl("div", { class: "drawPicker__grid" }, [
        uiField(strings.workshop.openingWidth, openingWidth),
        uiField(strings.workshop.openingHeight, openingHeight),
        uiField(strings.workshop.openingFloor, openingFloor),
      ]),
      doorRow,
      uiEl("p", { class: "drawPicker__about", text: strings.drawPicker.openingsAbout }),
    ]);

    // ——— шаг «Объекты»: та же сетка плиток, что в окне выбора вещи ———

    const tiles = createObjectTiles({
      key: settings.objects.key,
      onPick: (key) => {
        if (settings.objects.key === key) {
          start();
          return;
        }
        settings.objects.key = key;
        // Размеры возвращаются к каталожным, угол переживает смену вещи — то
        // же правило, что у `setObjectKey` в чертеже (таск 164): угол
        // принадлежит стене, которую обставляют, а размеры — вещи.
        const turnDeg = Number(settings.objects.sizes.turnDeg) || 0;
        settings.objects.sizes = { ...defaultsOf(key), ...(turnDeg ? { turnDeg } : {}) };
        tiles.setKey(key);
        sync();
      },
    });
    const wayChips = ways.map((way) =>
      uiButton(strings.workshop["way_" + way] || way, {
        class: "ui-btn ui-chip",
        title: strings.workshop["wayHint_" + way] || "",
        attrs: { "data-way": way },
        on: {
          click: () => {
            if (settings.objects.way === way) {
              start();
              return;
            }
            settings.objects.way = way;
            sync();
          },
        },
      }),
    );
    const objectWidth = uiNumber(1, DRAWING_MM_MAX);
    const objectDepth = uiNumber(1, DRAWING_MM_MAX);
    const objectTurn = uiNumber(0, 359);
    const objectHeight = uiNumber(1, DRAWING_MM_MAX);
    const objectFloor = uiNumber(0, DRAWING_MM_MAX);
    const objectFields = [
      { input: objectWidth, key: "widthMm", min: 1 },
      { input: objectDepth, key: "depthMm", min: 1 },
      { input: objectTurn, key: "turnDeg", min: 0 },
      // Пустая высота — «во всю высоту помещения»: так стоят колонна, ниша и
      // короб. Поэтому у неё своя ветка — пустое поле кладёт `null`, а не ноль.
      { input: objectHeight, key: "heightMm", min: 1, empty: true },
      { input: objectFloor, key: "heightAboveFloorMm", min: 0 },
    ];
    for (const field of objectFields) {
      uiApply(field.input, () => {
        if (field.empty && field.input.value === "") settings.objects.sizes[field.key] = null;
        else {
          const value = Math.round(Number(field.input.value));
          if (value >= field.min) settings.objects.sizes[field.key] = value;
        }
        sync();
      });
    }
    const widthField = uiField(strings.workshop.objectWidth, objectWidth);
    const depthField = uiField(strings.workshop.objectDepth, objectDepth);
    const turnField = uiField(strings.workshop.objectTurn, objectTurn);
    const depthLabel = depthField.querySelector(".ui-field__label");
    // Заметка способа: её читают до первого клика, и меняется она вместе с
    // выбранным способом — про «замкните контур» не должен читать тот, кто в
    // эту минуту ставит радиатор кликом.
    const wayNote = uiEl("p", { class: "drawPicker__about" });
    const objectsBody = uiEl("div", { class: "drawPicker__body" }, [
      tiles.node,
      uiEl("div", { class: "ui-chips" }, wayChips),
      wayNote,
      uiEl("div", { class: "drawPicker__grid" }, [
        widthField,
        depthField,
        turnField,
        uiField(strings.workshop.objectHeight, objectHeight, { title: strings.workshop.objectHeightHint }),
        uiField(strings.workshop.objectFloor, objectFloor),
      ]),
      uiEl("p", { class: "drawPicker__about", text: strings.drawPicker.objectsAbout }),
    ]);

    // ——— шаги: заголовок со строкой состояния и раскрытое тело ———

    const bodies = { walls: wallsBody, openings: openingsBody, objects: objectsBody };
    const notes = {};
    const heads = {};
    const steps = DRAW_PICKER_STEPS.map((adding) => {
      const note = uiEl("span", { class: "drawPicker__note" });
      notes[adding] = note;
      const head = uiEl(
        "button",
        {
          class: "drawPicker__head",
          type: "button",
          title: drawPickerHint(adding),
          attrs: { "data-adding": adding },
          on: {
            click: () => {
              // Раскрыли шаг — им и добавляют: второго состояния «раскрыт один,
              // а добавляется другое» в окне не бывает.
              settings.adding = adding;
              sync();
              if (adding === "objects") tiles.focus();
            },
          },
        },
        [
          uiEl("span", { class: "drawPicker__chevron", attrs: { "aria-hidden": "true" } }),
          uiEl("span", { class: "drawPicker__name", text: drawPickerName(adding) }),
          note,
        ],
      );
      heads[adding] = head;
      return uiEl("div", { class: "drawPicker__step", attrs: { "data-adding": adding } }, [head, bodies[adding]]);
    });

    function openingSizes() {
      return settings.openings.sizes[settings.openings.kind] || {};
    }

    // Значение в поле, которое не правят сию минуту: иначе набранное число
    // затиралось бы перерисовкой на полпути.
    function fieldValue(input, value) {
      if (document.activeElement === input) return;
      input.value = value === null || value === undefined ? "" : String(value);
    }

    function sync() {
      for (const adding of DRAW_PICKER_STEPS) {
        const on = settings.adding === adding;
        const step = steps[DRAW_PICKER_STEPS.indexOf(adding)];
        step.classList.toggle("is-open", on);
        bodies[adding].hidden = !on;
        heads[adding].setAttribute("aria-expanded", on ? "true" : "false");
        notes[adding].textContent = drawPickerNote(adding, settings);
      }
      // Стены: горит плитка той толщины, которая стоит в поле.
      fieldValue(thickness, settings.walls.thicknessMm);
      for (const chip of thicknessChips) {
        chip.classList.toggle("is-on", Number(chip.dataset.thickness) === settings.walls.thicknessMm);
      }
      // Проёмы: вид, его размеры и створка двери.
      const sizes = openingSizes();
      for (const chip of kindChips) chip.classList.toggle("is-on", chip.dataset.kind === settings.openings.kind);
      fieldValue(openingWidth, sizes.widthMm);
      fieldValue(openingHeight, sizes.heightMm);
      fieldValue(openingFloor, sizes.heightAboveFloorMm);
      // Створка — у всякого вида с полотном (таск 180): у стеклянной двери те
      // же петли и та же сторона открывания, что у глухой.
      doorRow.hidden = !openingHasLeaf(settings.openings.kind);
      hinge.textContent = text("workshop.doorHinge", {
        value: strings.openingHinges[settings.openings.hinge] || "",
      });
      swing.textContent = text("workshop.doorSwing", {
        value: strings.openingSwings[settings.openings.swing] || "",
      });
      // Объекты: способ, размеры и подпись глубины у полосы.
      for (const chip of wayChips) chip.classList.toggle("is-on", chip.dataset.way === settings.objects.way);
      const band = settings.objects.way === "polyline";
      wayNote.textContent = strings.workshop["wayNote_" + settings.objects.way] || "";
      // У полосы нет ни ширины, ни угла: её форма задана точками (таск 164).
      widthField.hidden = band;
      turnField.hidden = band;
      if (depthLabel) depthLabel.textContent = band ? strings.workshop.objectBand : strings.workshop.objectDepth;
      const thing = settings.objects.sizes;
      fieldValue(objectWidth, thing.widthMm);
      fieldValue(objectDepth, thing.depthMm);
      fieldValue(objectTurn, thing.turnDeg || 0);
      fieldValue(objectHeight, thing.heightMm === null || thing.heightMm === undefined ? "" : thing.heightMm);
      fieldValue(objectFloor, thing.heightAboveFloorMm || 0);
      startButton.textContent =
        settings.adding === "openings"
          ? strings.drawPicker.startOpenings
          : settings.adding === "objects"
            ? strings.drawPicker.startObjects
            : strings.drawPicker.startWalls;
    }

    const body = uiEl("div", { class: "drawPicker" }, [
      uiEl("p", { class: "drawPicker__about", text: strings.drawPicker.hint }),
      ...steps,
    ]);
    sync();
    modal = uiModal({
      title: strings.drawPicker.title,
      body,
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => finish(null) } }), startButton],
      onCancel: () => finish(null),
    });
    // Широкая карточка: шаг «Объекты» ставит внутрь сетку плиток, и ширину там
    // задаёт она сама (`--picker-columns`), как в окне выбора вещи.
    if (modal.card) modal.card.classList.add("modal--wide", "modal--drawPicker");
    if (settings.adding === "objects") tiles.focus();
    else thickness.focus();
  });
}
