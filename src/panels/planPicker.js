// Схема в окне (правка после сборки сценариев).
//
// Слова заказчика: «в режиме сценарии у карты сделай кнопку, которая
// разворачивает её в большое окно, по которому можно двигаться как и по схеме,
// зумить и т.д. и выбирать так метку нужную, так же и в логике при выборе
// устройства из списка … рядом с полем добавь кнопку, которая тоже откроет эту
// карту — схему в окне, но только с теми метками, которые можно выбрать»; и
// поправка: «в окне выбора метки двигаться как и на схеме, включая все жесты,
// а ты опять по новому сделал. Переиспользуй везде один механизм».
//
// Своего хода у окна нет: поле в нём — то же поле плана, что мини-план
// (`planView.js`), а ход у поля — тот же, что у «Схемы» (`planNav.js`). Окно
// добавляет только рамку: этажи, «−», «+», «Вписать» и клавиатуру, пока оно
// открыто. Щелчок по метке её выбирает и закрывает окно.
//
// Окно ничего не пишет ни в объект, ни в настройки: вид в нём живёт, пока оно
// открыто.
import { schemesInOrder } from "../model.js";
import { strings } from "../strings.js";
import { createPlanView } from "./planView.js";
import { uiButton, uiEl, uiIconButton, uiModal } from "./ui.js";

/** Во сколько раз меняют масштаб кнопки «+» и «−» окна — как клавиши «+» и «−». */
export const PLAN_PICKER_ZOOM_STEP = 1.2;

/** Этажи окна: схемы, на которых есть что выбрать (`markIds`), или все. */
export function planPickerSchemes(project, markIds = null) {
  if (!project) return [];
  return schemesInOrder(project)
    .filter((scheme) => !markIds || project.marks.some((mark) => mark.schemeId === scheme.id && markIds.has(mark.id)))
    .map((scheme) => ({ id: scheme.id, name: scheme.name }));
}

/**
 * Открыть схему в окне. `api` — `panelApi()` панели (нужны `getState` и
 * `subscribe`). `options`:
 *   `title`, `hint` — заголовок и строка под ним;
 *   `markIds`       — `Set` меток, которые видны (нет — все по фильтру);
 *   `pickable`      — `(markId) => boolean`, что можно выбрать;
 *   `selected`      — метки, обведённые как выбранные;
 *   `schemeId`      — с какого этажа начать;
 *   `onPick`        — `(markId) => void`; окно после выбора закрывается само.
 * Возвращает `{close}`.
 */
export function openPlanPicker(api, options = {}) {
  const state = () => api.getState();
  const markIds = options.markIds instanceof Set ? options.markIds : null;
  const floors = planPickerSchemes(state().project, markIds);
  let schemeId =
    (options.schemeId && floors.some((item) => item.id === options.schemeId) && options.schemeId) ||
    (floors.some((item) => item.id === state().schemeId) ? state().schemeId : floors[0] ? floors[0].id : null);
  let closed = false;
  let field = null;

  const stage = uiEl("div", { class: "plan-picker__stage mini-plan" });
  const floorRow = uiEl("div", { class: "plan-picker__floors" });

  function renderFloors() {
    floorRow.hidden = floors.length < 2;
    floorRow.replaceChildren(
      ...floors.map((item) =>
        uiButton(item.name, {
          class: "ui-btn plan-picker__floor" + (item.id === schemeId ? " is-on" : ""),
          on: {
            click: () => {
              if (item.id === schemeId) return;
              schemeId = item.id;
              renderFloors();
              if (field) field.redraw();
            },
          },
        }),
      ),
    );
  }

  const tools = uiEl("div", { class: "plan-picker__tools" }, [
    floorRow,
    uiEl("span", { class: "plan-picker__gap" }),
    uiIconButton("minus", {
      class: "ui-btn",
      title: strings.planPicker.zoomOut,
      on: { click: () => field && field.zoomBy(1 / PLAN_PICKER_ZOOM_STEP) },
    }),
    uiIconButton("plus", {
      class: "ui-btn",
      title: strings.planPicker.zoomIn,
      on: { click: () => field && field.zoomBy(PLAN_PICKER_ZOOM_STEP) },
    }),
    uiButton(strings.planPicker.fit, { class: "ui-btn", title: strings.planPicker.fitHint, on: { click: () => field && field.fit() } }),
  ]);
  const body = uiEl(
    "div",
    { class: "plan-picker" },
    [
      options.hint ? uiEl("p", { class: "modal__hint plan-picker__hint", text: options.hint }) : null,
      tools,
      floors.length === 0 ? uiEl("p", { class: "scn-side__empty", text: strings.planPicker.empty }) : stage,
    ].filter(Boolean),
  );
  const modal = uiModal({
    title: options.title || strings.planPicker.title,
    body,
    actions: [uiButton(strings.dialog.close, { on: { click: () => close() } })],
    onCancel: () => close(),
  });
  if (modal.card) modal.card.classList.add("modal--plan");

  function close() {
    if (closed) return;
    closed = true;
    if (field) field.dispose();
    field = null;
    modal.close();
  }

  if (floors.length > 0) {
    field = createPlanView(stage, api, {
      schemeId: () => schemeId,
      markIds,
      pickable: typeof options.pickable === "function" ? options.pickable : markIds ? (markId) => markIds.has(markId) : null,
      selected: () => (Array.isArray(options.selected) ? options.selected : []),
      keys: true,
      onTap: (markId) => {
        close();
        if (typeof options.onPick === "function") options.onPick(markId);
      },
    });
  }
  renderFloors();
  return { close };
}
