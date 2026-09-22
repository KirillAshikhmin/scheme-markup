// Карточка выделенной метки — в режиме просмотра, снизу поверх плана.
//
// Заказчик: «в режиме просмотра выделение меток сделай, чтобы снизу появлялось
// окошко с её информацией и сразу отображались на схеме связи». В просмотре
// панели правки нет вовсе, и прочитать, что это за метка, было негде: список
// меток лежит листом снизу и про выделенную метку ничего не говорит.
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
import { strings } from "../strings.js";
import { uiEl, uiIconButton } from "./ui.js";
import { marksControllerIndex, marksRowModel } from "./marks.js";

// Отступ между меткой и верхним краем карточки: метка должна остаться видна
// вместе с подписью, а не впритык.
const MARK_CARD_GAP = 24;

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
  const add = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    rows.push({ label, value: String(value) });
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

  const render = () => {
    const state = getState();
    // Карточка живёт только в просмотре: в полной версии то же самое (и с
    // правкой) показывает раскрытая строка списка меток.
    const viewing = !layoutAllows("editMarks", state.layout);
    const selected = state.selectedMarkIds || [];
    const model = viewing && selected.length === 1 ? markCardModel(state.project, selected[0]) : null;
    card.hidden = !model;
    if (!model) {
      shownFor = null;
      return;
    }
    const head = uiEl("div", { class: "mark-card__head" }, [
      uiEl("span", { class: "mark-card__icon" }, shapeIcon(model.style.shape, model.style.color, 20)),
      uiEl("span", { class: "mark-card__label", text: model.label }),
      uiEl("span", { class: "mark-card__type", text: model.code + " — " + model.typeName }),
      uiIconButton("close", {
        class: "ui-btn mark-card__close",
        label: strings.markCard.close,
        on: { click: () => setState({ selectedMarkIds: [] }) },
      }),
    ]);
    const body = uiEl("div", { class: "mark-card__body" });
    if (model.rows.length === 0) {
      body.append(uiEl("p", { class: "mark-card__empty", text: strings.markCard.empty }));
    }
    for (const row of model.rows) {
      body.append(
        uiEl("div", { class: "mark-card__row" }, [
          uiEl("span", { class: "mark-card__name", text: row.label }),
          uiEl("span", { class: "mark-card__value", text: row.value }),
        ]),
      );
    }
    card.replaceChildren(head, body);
    if (shownFor !== model.id) {
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
}

registerPanel(PANEL_IDS.canvasCard, mountMarkCard);
