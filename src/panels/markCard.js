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
import { PANEL_IDS, layoutAllows, registerPanel } from "../app.js";
import { findMark, findRoom, findScheme, findType, labelOf, styleOf } from "../model.js";
import { planToScreen, shapeIcon } from "../render.js";
import { getSetting, setSetting } from "../store.js";
import { strings } from "../strings.js";
import { uiEl, uiIcon, uiIconButton } from "./ui.js";
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
  if (!layoutAllows("editMarks", source.layout)) return MARK_CARD_FULL;
  return collapsed ? MARK_CARD_MINI : MARK_CARD_FULL;
}

/**
 * Что показывает карточка. Чистая функция: поля решаются здесь, а не в разметке,
 * и проверяются без браузера.
 *
 * Пустые поля выпадают — на телефоне карточка из восьми строк «—» закрыла бы
 * пол-плана. Остаётся голова: обозначение, код и название типа; по ним метку
 * узнают, даже когда больше о ней ничего не записано.
 */
export function markCardModel(project, markId) {
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
  add(strings.marks.room, room ? room.name : "");
  add(strings.marks.location, fields.location);
  add(strings.marks.originalPlaceholder, fields.original);
  add(strings.panels.sizes, fields.sizes);
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
    kind: mark.kind === "line" ? "line" : "point",
    rows,
  };
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

function mountMarkCard(host, api) {
  const { getState, setState, subscribe } = api;
  const card = uiEl("div", { class: "mark-card" });
  host.replaceChildren(card);
  let shownFor = null;
  let collapsed = false;

  const flip = (value) => {
    collapsed = value;
    setSetting(MARK_CARD_SETTING, collapsed);
    render();
  };

  const render = () => {
    const state = getState();
    const mode = markCardState(state, collapsed);
    const model = mode === MARK_CARD_NONE ? null : markCardModel(state.project, state.selectedMarkIds[0]);
    card.hidden = !model;
    // В просмотре карточка показывает метку целиком и стоит колонкой; на
    // компьютере она ужата в ряды и пропускает клик на план под собой.
    const viewing = !layoutAllows("editMarks", state.layout);
    card.classList.toggle("mark-card--compact", !viewing);
    card.classList.toggle("mark-card--mini", mode === MARK_CARD_MINI);
    if (!model) {
      shownFor = null;
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
            uiEl("span", { class: "mark-card__icon" }, shapeIcon(model.style.shape, model.style.color, 16)),
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
    const head = uiEl("div", { class: "mark-card__head" }, [
      uiEl("span", { class: "mark-card__icon" }, shapeIcon(model.style.shape, model.style.color, 20)),
      uiEl("span", { class: "mark-card__label", text: model.label }),
      uiEl("span", { class: "mark-card__type", text: model.code + " — " + model.typeName }),
      headButton,
    ]);
    const body = uiEl("div", { class: "mark-card__body" });
    if (model.rows.length === 0) {
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
    card.replaceChildren(head, body);
    // План подвигается только в просмотре: там карточка высокая и метка
    // действительно уходит под неё. На компьютере выделение случается на
    // каждый клик по метке, и сдвиг плана из-под руки — прямая дорога к
    // промаху при переносе: метка едет вместе с планом между нажатием и
    // ведением.
    if (viewing && shownFor !== model.id) {
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
      "schemeId" in changed
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
