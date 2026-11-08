// Карточка выделенной метки — снизу поверх плана, во всех раскладках.
//
// Заказчик: «в режиме просмотра выделение меток сделай, чтобы снизу появлялось
// окошко с её информацией и сразу отображались на схеме связи». В просмотре
// панели правки нет вовсе, и прочитать, что это за метка, было негде: список
// меток лежит листом снизу и про выделенную метку ничего не говорит.
//
// Потом он попросил её и на компьютере: «ту плашку с информацией по метке
// отображай и в других режимах и с компа тоже». Как она уживается с правой
// колонкой, где те же поля уже показаны, — см. `markCardState`.
//
// Карточка только читает. Все поля она берёт у той же `marksRowModel`, что
// рисует раскрытую строку списка: второй правды о метке в сборке быть не
// должно — разойдись они, список и карточка показывали бы разное.
//
// Связи на схеме поднимает не карточка, а холст: при выключенном общем показе
// выделенная метка уже показывает свою связную группу (`canvasFrameLinks`,
// таски 79 и 84). Правило от раскладки не зависит, и в просмотре работает так
// же — карточке остаётся только назвать связи словами.
import { PANEL_IDS, appAllows, appKind, registerPanel } from "../app.js";
import {
  MARK_KINDS,
  MARK_ORDER_BACK,
  MARK_ORDER_DOWN,
  MARK_ORDER_FRONT,
  MARK_ORDER_UP,
  findGroup,
  findMark,
  findRoom,
  findScheme,
  findType,
  labelOf,
  markCommentText,
  markIsComment,
  markPointer,
  styleOf,
} from "../model.js";
import {
  canvasBlockJoining,
  canvasBlockLeave,
  canvasEditAllowed,
  canvasEditCommentText,
  canvasMarkOrder,
  canvasMarkOrderCan,
  canvasOnScreen,
  canvasStartBlockJoin,
  canvasStopBlockJoin,
} from "../canvas.js";
import { planToScreen, typeIconPlan, typeSignIcon } from "../render.js";
import { getSetting, setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import { UI_SIGN, UI_SIGN_SMALL, uiButton, uiEl, uiIcon, uiIconButton, uiSignCell } from "./ui.js";
import { deviceCardPart, deviceCardView, deviceLogicEntry, deviceLogicSection } from "./deviceCard.js";
import { marksControllerIndex, marksLinkedText, marksLinkedTitle, marksRowModel } from "./marks.js";

// Отступ между меткой и верхним краем карточки: метка должна остаться видна
// вместе с подписью, а не впритык.
const MARK_CARD_GAP = 24;

// Свёрнута ли карточка на компьютере. Оснастка рабочего места, а не свойство
// разметки: живёт в настройках браузера, переживает перезагрузку, в объект и в
// файл проекта не попадает — как отметка линейки и свёрнутые колонки.
export const MARK_CARD_SETTING = "markCardCollapsed";

// Что показано поверх плана: ничего, карточка целиком или ярлычок.
export const MARK_CARD_NONE = "none";
export const MARK_CARD_FULL = "full";
export const MARK_CARD_MINI = "mini";

/**
 * Показывать ли карточку — и в каком виде.
 *
 * Заказчик попросил её «и с компа тоже», и это ровно то место, где легко
 * сделать навязчиво: на компьютере те же поля уже показаны в раскрытой строке
 * списка меток, а карточка лежит поверх плана — там, где рисуют.
 *
 * Решение — **показывать во всех раскладках, но на компьютере в один-два ряда
 * и сквозной для мыши** (`mark-card--compact`: клик проходит на план, ловят
 * его только кнопки карточки). Два других варианта отвергнуты:
 *
 * — **«только когда правая колонка скрыта»** — заказчик работает с открытыми
 *   колонками, и карточки он бы просто не увидел; просьба «и с компа тоже»
 *   осталась бы невыполненной, а разбираться, почему она то есть, то нет,
 *   пришлось бы ему;
 * — **переключатель в шапке** — пятая кнопка в ряду, который на восьмидюймовом
 *   планшете и так считает точки (таск 101).
 *
 * Отказаться от карточки всё равно можно, и ручка для этого стоит там же, где
 * сама карточка: её кнопка сворачивает карточку в ярлычок с обозначением
 * метки, а ярлычок разворачивает обратно. Это идиома колонок — «свёрнутая
 * ужимается до ручки у края и не уезжает с места», — и тупика в ней нет:
 * пустого места вместо карточки не остаётся никогда.
 *
 * В просмотре сворачивания нет вовсе: там карточка — единственный способ
 * прочитать метку, а её крестик снимает выделение (так закрывать её научили в
 * таске 104, и тап по пустому месту делает то же самое).
 */
export function markCardState(state, collapsed = false) {
  const source = state || {};
  const selected = source.selectedMarkIds || [];
  // Карточка про одну метку: у выделенных пачкой общих полей нет, а
  // показывать первую попавшуюся — врать.
  if (!source.project || selected.length !== 1) return MARK_CARD_NONE;
  if (!appAllows("editMarks", source)) return MARK_CARD_FULL;
  // Пока дом запущен, карточка — пульт устройства (таск 08): ярлычком его не
  // свернуть, иначе клавиши и ползунки пропали бы из-под руки.
  if (source.simRunning === true) return MARK_CARD_FULL;
  return collapsed ? MARK_CARD_MINI : MARK_CARD_FULL;
}

/**
 * Что показывает карточка. Чистая функция: поля решаются здесь, а не в разметке,
 * и проверяются без браузера.
 *
 * `viewer` — карточку читает заказчик на странице просмотра (G19): рабочего
 * комментария интегратора в ней нет, остальное — название, тип, помещение,
 * чем управляет, размеры и высота — как всегда.
 *
 * Пустые поля выпадают — на телефоне карточка из восьми строк «—» закрыла бы
 * пол-плана. Остаётся голова: обозначение, код и название типа; по ним метку
 * узнают, даже когда больше о ней ничего не записано.
 */
export function markCardModel(project, markId, { viewer = false } = {}) {
  if (!project || !markId) return null;
  const mark = findMark(project, markId);
  if (!mark) return null;
  const type = findType(project, mark.typeId);
  const row = { mark, type, style: styleOf(project, mark.typeId), label: labelOf(project, markId) };
  const view = marksRowModel(project, row, { open: true, controllers: marksControllerIndex(project) });
  const fields = view.fields || {};
  const room = fields.roomId ? findRoom(project, fields.roomId) : null;
  const rows = [];
  const add = (label, value, title) => {
    if (value === null || value === undefined || value === "") return;
    rows.push({ label, value: String(value), title: title || "" });
  };
  // Комментарий — короткая карточка: текст плашки и указатель, и больше
  // ничего. Помещение, размеры, связи и оборудование к нему не относятся (их
  // и в модели ему не завести), а длины у плашки нет — в колонку метров и в
  // подсчёты метража она не идёт.
  //
  // Эта карточка — **единственный** способ добраться до комментария: в списке
  // меток его нет (G167). Поэтому рядом с текстом стоит кнопка правки, и она
  // же открывается двойным кликом по плашке на плане.
  if (markIsComment(mark)) {
    add(strings.marks.comment, markCommentText(mark));
    return {
      id: mark.id,
      label: view.label,
      code: view.code,
      typeName: view.typeName,
      style: view.style,
      // План знака (таск 228): карточку собирают два хозяина — план и объём, —
      // и считать его дважды значило бы снова развести знак по поверхностям.
      sign: typeIconPlan(project, mark.typeId),
      kind: mark.kind,
      comment: true,
      pointer: markPointer(mark),
      rows,
    };
  }
  add(strings.marks.room, room ? room.name : "");
  add(strings.marks.location, fields.location);
  // Комментарий метки — рабочая запись интегратора; заказчику, смотрящему
  // объект со страницы просмотра, он не показывается (G19).
  if (!viewer) add(strings.marks.comment, fields.original);
  // Длина по плану — там же, где остальные поля, и из той же `marksRowModel`.
  // Пустая (нет масштаба или метка точечная) строка выпадает, как все пустые.
  add(strings.scale.lengthLabel, fields.lengthText);
  // Стена под меткой — из той же `marksRowModel`, что строка списка: второй
  // правды о метке в сборке быть не должно.
  add(strings.marks.wallLabel, fields.wallText);
  // Размеры метки, а не раздел колонки. Строка звалась `panels.sizes`, и после
  // переименования раздела (таск 153) карточка метки говорила «Интерфейс
  // проекта от пола 2200 мм» — найдено живым прогоном таска 175. Имя у этой
  // строки своё и давно: «Размеры и высота» (`markSizes.open`), и заведено оно
  // ровно затем, чтобы не спорить с названием раздела.
  add(strings.markSizes.open, fields.sizes);
  // Связи — обе стороны и словами. «Чем управляет» идёт разложенным по каналам
  // («① Т16 ×6 · ② С1»): это та же строка, что в списке меток, и она отвечает
  // на вопрос «какая клавиша к какой нагрузке».
  add(strings.marks.controls, fields.controlsText || (fields.controls || []).join(", "));
  add(strings.marks.controlledByShort, (fields.controlledBy || []).join(", "));
  // Вся связка — то же, что в строке списка, и тем же перечнем: косвенно
  // связанные метки (второй выключатель того же светильника) названы словами,
  // а не оставлены на догадку по дугам на плане.
  add(strings.marks.linkedShort, marksLinkedText(fields.linked), marksLinkedTitle(fields.linked));
  if (fields.equipment > 0) add(strings.equipment.open, fields.equipment);
  return {
    id: mark.id,
    label: view.label,
    code: view.code,
    typeName: view.typeName,
    style: view.style,
    sign: typeIconPlan(project, mark.typeId),
    kind: MARK_KINDS.includes(mark.kind) ? mark.kind : "point",
    comment: false,
    pointer: false,
    rows,
  };
}

/**
 * Подвигать ли план, чтобы метка не ушла под карточку. В просмотре — да:
 * карточка высокая. На компьютере — нет: выделение там на каждый клик, и
 * сдвиг из-под руки — промах при переносе. **Кроме запущенного дома** (F2):
 * переноса в нём нет, а карточка-пульт поверх метки забирала бы следующий
 * щелчок — второй щелчок двойного уходил в карточку.
 */
export function markCardLifts(state) {
  const source = state || {};
  return !appAllows("editMarks", source) || source.simRunning === true;
}

/**
 * На сколько подвинуть план, чтобы метка не осталась под карточкой.
 *
 * Ноль — метка и так выше карточки, трогать план незачем: рывок по каждому
 * нажатию раздражает сильнее, чем закрытая метка.
 */
export function markCardShift(markY, cardTop, gap = MARK_CARD_GAP) {
  if (!Number.isFinite(markY) || !Number.isFinite(cardTop)) return 0;
  const limit = cardTop - gap;
  return markY > limit ? Math.round(markY - limit) : 0;
}

/**
 * Карточка метки узлами: голова и поля. Вынесена из монтажа нарочно — ту же
 * карточку показывает окно объёмного режима (таск 148, слова заказчика: «Да, и
 * карточку»), и собирать её там второй раз значило бы завести вторую карточку,
 * которая однажды разойдётся с этой полями или видом.
 *
 * Кнопку головы и хвост полей задаёт хозяин: на плане это сворачивание или
 * крестик и строка правки комментария, в объёме — крестик, снимающий выделение.
 *
 * `order` — ряд команд порядка меток (таск 238). Его передаёт только план: на
 * плане метки и накладываются друг на друга, а в объёме порядок плана не
 * значит ничего — там грани складывает дерево разбиения.
 *
 * `block` — ряд команд блока (таск 244). Его тоже передаёт только план, и по
 * той же мерке: «Добавить в блок» ждёт щелчка **по метке на плане**, и половина
 * ряда в объёме была бы мёртвой. Разводить пару по двум местам хуже, чем
 * показать её в одном.
 */
export function markCardParts(model, { headButton = null, extra = null, order = null, block = null } = {}) {
  const head = uiEl("div", { class: "mark-card__head" }, [
    // Знак — общей лестницей (таск 228, находка 15): у линейной метки в
    // карточке стояла точка, хотя в справочнике у её типа штрих.
    uiSignCell(typeSignIcon(model.sign, UI_SIGN.size, UI_SIGN.length)),
    uiEl("span", { class: "mark-card__label", text: model.label }),
    uiEl("span", { class: "mark-card__type", text: model.code + " — " + model.typeName }),
    ...(headButton ? [headButton] : []),
  ]);
  const body = uiEl("div", { class: "mark-card__body" });
  if (model.rows.length === 0 && !model.comment) {
    body.append(uiEl("p", { class: "mark-card__empty", text: strings.markCard.empty }));
  }
  for (const row of model.rows) {
    body.append(
      uiEl("div", { class: "mark-card__row", title: row.title }, [
        uiEl("span", { class: "mark-card__name", text: row.label }),
        uiEl("span", { class: "mark-card__value", text: row.value }),
      ]),
    );
  }
  if (extra) body.append(extra);
  if (order) body.append(order);
  if (block) body.append(block);
  return [head, body];
}

/**
 * Ряд команд порядка меток на экране (таск 238, G359): «на передний план»,
 * «выше», «ниже», «на задний план» — слова заказчика.
 *
 * **Место выбрано здесь, а не в списке меток и не на клавишах**, и вот почему:
 * наложение — вопрос про план, человек видит его глазами и решает сразу, а
 * карточка стоит у выделенной метки, на том же поле, во всех раскладках правки
 * — и на планшете под пальцем, и на компьютере под курсором. В списке меток
 * строки стоят по справочнику и номеру, а не в порядке экрана, и команда
 * «выше» там указывала бы не туда, куда смотрит глаз.
 *
 * **Клавиши у ряда появились в таске 240** (слова заказчика: «Горячие клавиши
 * добавь») — `]` и `[`, с Shift на передний и задний план; разбор и доводы о
 * раскладке — у `canvasOrderKey`. Правило сборки «ключ, о котором негде
 * прочитать, всё равно что его нет» (таск 213) закрыто здесь же, в подсказке
 * каждой кнопки: подсказка плана уже в три строки, а кнопка видна ровно
 * тогда, когда клавиша и работает, — метка выделена, правка разрешена. Так же
 * названы Ctrl+Z у отмены и Ctrl+S у сохранения.
 *
 * `null` — ряда нет вовсе: в просмотре и при запущенном доме правок не бывает
 * (`canvasEditAllowed`), и гаснущий ряд кнопок обещал бы несуществующее.
 *
 * Кнопка, которой некуда двигать, гаснет (`canvasMarkOrderCan`) — как «выше» у
 * первой схемы в списке схем: так видно, что метка и так наверху, а не что
 * нажатие потерялось.
 */
export function markCardOrderRow(state, markId) {
  if (!state || !state.project || !canvasEditAllowed(state) || !canvasOnScreen(state)) return null;
  const words = strings.markCard.order;
  const mark = findMark(state.project, markId);
  if (!mark) return null;
  // Слова про блок — в подсказке каждой кнопки: поедет вся рамка розеток, а не
  // взятая розетка (G189), и узнать об этом человеку больше негде.
  const tail = mark.groupId ? ". " + words.block : "";
  // Имя значка стоит в самом вызове строкой, а не приезжает доводом: набор
  // значков сверяется с кодом сканированием исходников (`test/panelIcons`), и
  // спрятанное за помощником имя было бы для него мёртвым рисунком.
  //
  // Клавиша — последним словом подсказки, как «Клавиша «/»» у поиска: сперва
  // что делает кнопка, потом чем её позвать с клавиатуры. Имя клавиши берётся
  // по ключу команды, тому же, что у модели, — второго списка команд здесь не
  // появляется.
  const options = (move, label, hint) => ({
    class: "ui-btn mark-card__order",
    label,
    title: label + " — " + hint + tail + ". " + text("markCard.order.keyHint", { key: words.keys[move] }),
    attrs: canvasMarkOrderCan(state, markId, move) ? {} : { disabled: "disabled" },
    on: { click: () => canvasMarkOrder(markId, move) },
  });
  return uiEl("div", { class: "mark-card__row mark-card__row--act" }, [
    uiEl("span", { class: "mark-card__name", text: words.label }),
    uiIconButton("toFront", options(MARK_ORDER_FRONT, words.front, words.frontHint)),
    uiIconButton("up", options(MARK_ORDER_UP, words.up, words.upHint)),
    uiIconButton("down", options(MARK_ORDER_DOWN, words.down, words.downHint)),
    uiIconButton("toBack", options(MARK_ORDER_BACK, words.back, words.backHint)),
  ]);
}

/**
 * Ряд «Блок»: собрать блок из двух готовых меток и вынуть метку из блока
 * (таск 244, G366 и G367).
 *
 * **Место — здесь, под «Порядком»**, и причина та же, по которой там стоит
 * порядок: блок — это соседство **на плане**, человек видит его глазами и
 * решает сразу, а карточка стоит у выделенной метки, на том же поле, во всех
 * раскладках правки. В списке меток строки стоят по справочнику и номеру, и
 * «добавить в блок» означало бы там «к кому-то, кого на экране не видно».
 *
 * **Ожидание щелчка — готовый механизм холста** (`canvasStartBlockJoin`, режим
 * `CANVAS_MODE_BLOCK_JOIN`), тот же, которым показывают точку внутри комнаты и
 * концы отрезка калибровки: подсказка над планом, плашка о входе, крестик
 * вместо курсора, Esc на выход. Третьего способа «подожди, пока ткнут» в
 * сборке нет и заводить его нельзя. Зажёгшаяся кнопка — второй след ожидания:
 * подсказку над планом сворачивают, а кнопка остаётся под рукой.
 *
 * `null` — ряда нет вовсе: в просмотре и при запущенном доме правок не бывает
 * (`canvasEditAllowed`), а у линии и у комментария блока не бывает никогда
 * (`blockOnlyForPoints`, `commentNoBlock`) — гаснущий ряд обещал бы им
 * несуществующее.
 *
 * Кнопка, которой нечего делать, гаснет и говорит в подсказке почему — как
 * «выше» у метки, которая и так наверху. Гаснет здесь «Убрать»: у одиночной
 * метки — потому что она не в блоке, у метки со многими точками — потому что
 * она **сама себе блок** и вынимать из неё нечего (убрать точку — другое дело
 * и другой жест).
 */
export function markCardBlockRow(state, markId) {
  if (!state || !state.project || !canvasEditAllowed(state) || !canvasOnScreen(state)) return null;
  const mark = findMark(state.project, markId);
  if (!mark || mark.kind !== "point") return null;
  const words = strings.markCard.blockRow;
  const group = mark.groupId ? findGroup(state.project, mark.groupId) : null;
  // Сколько в блоке живых меток: в блоке из двух выход одной распускает его
  // целиком, и подсказка обязана сказать это **до** нажатия.
  const members = group ? group.markIds.filter((id) => findMark(state.project, id)).length : 0;
  const waiting = canvasBlockJoining(state, markId);
  const leaveHint = group
    ? members <= 2
      ? words.leaveLast
      : words.leaveHint
    : mark.points.length > 1
      ? words.leaveSingle
      : words.leaveAlone;
  return uiEl("div", { class: "mark-card__row mark-card__row--act" }, [
    uiEl("span", { class: "mark-card__name", text: words.label }),
    uiIconButton("blockJoin", {
      class: "ui-btn mark-card__order" + (waiting ? " is-active" : ""),
      label: words.join,
      title: words.join + " — " + (waiting ? words.joinWaiting : words.joinHint),
      attrs: { "aria-pressed": waiting ? "true" : "false" },
      // Повторное нажатие зажёгшейся кнопки — отмена: кнопка показывает
      // ожидание, значит она же его и снимает. Esc уходит той же дверью.
      on: { click: () => (waiting ? canvasStopBlockJoin() : canvasStartBlockJoin(markId)) },
    }),
    uiIconButton("blockLeave", {
      class: "ui-btn mark-card__order",
      label: words.leave,
      title: words.leave + " — " + leaveHint,
      attrs: group ? {} : { disabled: "disabled" },
      on: { click: () => canvasBlockLeave(markId) },
    }),
  ]);
}

function mountMarkCard(host, api) {
  const { getState, setState, subscribe } = api;
  const card = uiEl("div", { class: "mark-card" });
  host.replaceChildren(card);
  let shownFor = null;
  let collapsed = false;
  // Пульт устройства (таск 08): подписка карточки на имитацию живёт, пока
  // карточка показана.
  let deviceView = null;
  const dropDevice = () => {
    if (deviceView) deviceView.dispose();
    deviceView = null;
  };
  // «Логика» остановленного дома (F2): у какой метки раздел раскрыт и сам
  // раздел — он живёт между перерисовками карточки (правка привязки меняет
  // объект, и раскрытые опции не должны схлопываться от каждой правки).
  let logicFor = null;
  let logicSection = null;
  const dropLogic = () => {
    if (logicSection) logicSection.view.dispose();
    logicSection = null;
  };

  const flip = (value) => {
    collapsed = value;
    setSetting(MARK_CARD_SETTING, collapsed);
    render();
  };

  const render = () => {
    const state = getState();
    const mode = markCardState(state, collapsed);
    // Карточка стоит поверх плана — в чужом режиме плана под ней нет (таск
    // 153). У объёма своя такая же карточка в своём поле, собранная тем же
    // `markCardParts`: две сразу были бы две правды об одной метке.
    const model =
      mode === MARK_CARD_NONE || !canvasOnScreen(state)
        ? null
        : markCardModel(state.project, state.selectedMarkIds[0], { viewer: !appAllows("integratorComment", state) });
    card.hidden = !model;
    dropDevice();
    // В просмотре карточка показывает метку целиком и стоит колонкой; на
    // компьютере она ужата в ряды и пропускает клик на план под собой.
    const viewing = !appAllows("editMarks", state);
    card.classList.toggle("mark-card--compact", !viewing);
    card.classList.toggle("mark-card--mini", mode === MARK_CARD_MINI);
    if (!model) {
      shownFor = null;
      dropLogic();
      return;
    }
    if (mode === MARK_CARD_MINI) {
      // Свёрнутая карточка — ярлычок с обозначением выделенной метки: по нему
      // видно, что карточка не пропала, а свёрнута, и что она про эту метку.
      shownFor = null;
      card.replaceChildren(
        uiEl(
          "button",
          {
            class: "mark-card__mini",
            type: "button",
            title: strings.markCard.expand,
            attrs: { "aria-label": strings.markCard.expand, "aria-expanded": "false" },
            on: { click: () => flip(false) },
          },
          [
            uiSignCell(typeSignIcon(model.sign, UI_SIGN_SMALL.size, UI_SIGN_SMALL.length), {
              length: UI_SIGN_SMALL.length,
            }),
            uiEl("span", { class: "mark-card__label", text: model.label }),
            uiIcon("chevron"),
          ],
        ),
      );
      return;
    }
    // Кнопка головы говорит на разных раскладках разное — и значок у неё
    // поэтому разный. В просмотре карточку закрывают, снимая выделение (тем же
    // занят тап по пустому месту); на компьютере выделение нужно самому
    // пользователю — он метку правит, — и карточка сворачивается в ярлычок.
    const headButton = viewing
      ? uiIconButton("close", {
          class: "ui-btn mark-card__close",
          label: strings.markCard.close,
          on: { click: () => setState({ selectedMarkIds: [] }) },
        })
      : uiIconButton("chevron", {
          class: "ui-btn mark-card__close mark-card__fold",
          label: strings.markCard.collapse,
          attrs: { "aria-expanded": "true" },
          on: { click: () => flip(true) },
        });
    // Кнопка правки текста — только у комментария и только в правке: в
    // просмотре карточка ничего не меняет. На компьютере карточка сквозная для
    // мыши (`pointer-events: none`), но кнопки в ней клик ловят — ради них
    // исключение и сделано.
    const commentRow =
      model.comment && appAllows("editMarks", state)
        ? uiEl("div", { class: "mark-card__row mark-card__row--act" }, [
            uiButton(strings.markCard.editComment, {
              class: "ui-btn mark-card__edit",
              title: strings.markCard.editCommentHint,
              on: { click: () => canvasEditCommentText(model.id) },
            }),
            uiEl("span", {
              class: "mark-card__value mark-card__pointer",
              text: model.pointer ? strings.markCard.pointerOn : strings.markCard.pointerOff,
              // С указателем подсказка говорит о двух ручках: плашку и точку
              // возят врозь (G199), и без слов об этом не узнать — точка мелкая
              // и стоит на другом конце указателя. Без указателя разводить
              // нечего, и подсказка остаётся прежней: вот кнопка, вот что она
              // включает.
              title: model.pointer ? strings.markCard.pointerHintOn : strings.markCard.pointerHint,
            }),
          ])
        : null;
    // Запущенный дом: под полями метки — пульт её устройства (клавиши,
    // ползунки, значения, «Логика»), собранный карточкой устройства.
    // Остановленный — строка «Логика», которая раскрывает тот же раздел прямо
    // в карточке (F2): привязка — настройка сценария, и править её из «Схемы»
    // можно при любом доме.
    const part = model.comment ? null : deviceCardPart(state.project, model.id, state.simRunning === true);
    const logicOpen = part === "logic" && logicFor === model.id;
    if (!logicOpen || (logicSection && logicSection.markId !== model.id)) dropLogic();
    if (logicOpen && !logicSection) logicSection = { markId: model.id, view: deviceLogicSection(model.id) };
    if (part === "remote") deviceView = deviceCardView(state.project, model.id);
    else if (part === "logic") {
      deviceView = deviceLogicEntry(state.project, model.id, {
        open: logicOpen,
        section: logicSection ? logicSection.view : null,
        onToggle: () => {
          logicFor = logicOpen ? null : model.id;
          render();
        },
      });
    }
    // Пульт и раскрытая «Логика» ловят щелчки и растут, как карточка
    // запущенного дома; свёрнутая строка — нет: карточка остаётся сквозной.
    card.classList.toggle("mark-card--sim", part === "remote" || logicOpen);
    card.replaceChildren(
      ...markCardParts(model, {
        headButton,
        extra: deviceView ? deviceView.node : commentRow,
        order: markCardOrderRow(state, model.id),
        block: markCardBlockRow(state, model.id),
      }),
    );
    // План подвигается в просмотре и в запущенном доме (`markCardLifts`): там
    // карточка высокая и метка действительно уходит под неё. На компьютере
    // без дома выделение случается на каждый клик по метке, и сдвиг плана
    // из-под руки — прямая дорога к промаху при переносе.
    if (markCardLifts(state) && shownFor !== model.id) {
      shownFor = model.id;
      liftMark(state, model.id);
    }
  };

  // Метка под карточкой — половина беды: связи её группы тоже уходят под низ.
  // План подвигается один раз, при появлении карточки, и только вверх и только
  // если метка действительно под ней.
  const liftMark = (state, markId) => {
    const plan = document.getElementById(PANEL_IDS.canvas);
    const scheme = state.project ? findScheme(state.project, state.schemeId) : null;
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!plan || !scheme || !mark || !mark.points || mark.points.length === 0) return;
    const at = planToScreen(mark.points[0], scheme, state.view);
    const box = card.getBoundingClientRect();
    const hostBox = plan.getBoundingClientRect();
    const shift = markCardShift(at.y, box.top - hostBox.top);
    if (shift === 0) return;
    setState({ view: { ...state.view, offsetY: state.view.offsetY - shift } });
  };

  subscribe((state, changed) => {
    if (
      "selectedMarkIds" in changed ||
      "project" in changed ||
      "layout" in changed ||
      "schemeId" in changed ||
      "screen" in changed ||
      // Режим — из-за ряда «Блок» (таск 244): пока холст ждёт вторую метку,
      // кнопка «Добавить в блок» горит, и загореться ей негде, кроме этой
      // перерисовки.
      "mode" in changed ||
      "simRunning" in changed
    ) {
      render();
    }
  });
  render();
  // Настройка читается асинхронно, как у свёрнутых колонок и разделов:
  // карточка стартует развёрнутой и сворачивается, когда хранилище ответит.
  Promise.resolve(getSetting(MARK_CARD_SETTING))
    .then((saved) => {
      if (saved !== true || collapsed) return;
      collapsed = true;
      render();
    })
    .catch(() => {});
}

registerPanel(PANEL_IDS.canvasCard, mountMarkCard);
