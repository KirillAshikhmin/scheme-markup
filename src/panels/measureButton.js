// Кнопка «Линейка» в шапке (таск 237, G356): включить и выключить измерение.
//
// Слова заказчика: «добавь в верхнюю панель рядом с кнопокй печати инструмент
// Линейка, что бы измерять расстояния. При чем он должен работать и в режиме
// Чертёж и схема и измерять в 2д так и в объёме, измеряя в 3д».
//
// **Кнопка одна на три поля, и отметка у неё одна** (`state.measuring`): «Чертёж»,
// «Схема» и «Объём» спрашивают её сами, каждый своим полем. Второй дороги в
// инструмент нет и быть не должно — три отметки, по одной на поле, разошлись бы
// в первый же переход между режимами, и кнопка показывала бы одно, а поле
// делало другое. В «Сценариях» кнопки нет вовсе: там мерить нечего, и поле
// линейки не слушает.
//
// Своя точка монтирования рядом с принтером, а не кнопка внутри панели
// выгрузок: за принтером меню, которое открывают и закрывают, а линейка
// включает занятие на поле — в одной панели они однажды закрылись бы вместе.
import { PANEL_IDS, registerPanel } from "../app.js";
import { MEASURE_FIELDS, measureDropAll } from "../measure.js";
import { canvasStartScale } from "../canvas.js";
import { planHasScale } from "../model.js";
import { strings } from "../strings.js";
import { uiConfirm, uiIconButton } from "./ui.js";

/**
 * Что делает нажатие кнопки — чистое правило, вынесенное ради теста.
 *
 * Ответы:
 *
 *   `off` — линейка была включена, снимаем;
 *   `scale` — «Схема» без калибровки: метров у плана нет вовсе, и прежде
 *     линейки человеку нужен масштаб. Спросим, и ответ «да» уведёт в
 *     калибровку (`canvasStartScale` — единственная дверь в неё);
 *   `on` — включаем.
 *
 * Отдельного ответа «нельзя» нет: кнопка показана только там, где линейка
 * работает, а скрытую не нажать.
 */
export function measureButtonStep(state) {
  if (!state) return "on";
  if (state.measuring) return "off";
  if (state.screen === "scheme" && state.schemeId && !planHasScale(state.project, state.schemeId)) return "scale";
  return "on";
}

/** Показывать ли кнопку: поле — одно из трёх, и объект открыт. */
export function measureButtonShown(state) {
  if (!state || !state.project) return false;
  return MEASURE_FIELDS.includes(state.screen || "");
}

function mountMeasureButton(host, api) {
  const { getState, setState, subscribe } = api;

  const button = uiIconButton("measure", {
    class: "ui-btn measure__toggle",
    label: strings.measure.name,
    title: strings.measure.title,
    on: { click: () => press() },
  });
  button.setAttribute("aria-pressed", "false");
  host.replaceChildren(button);

  async function press() {
    const state = getState();
    const step = measureButtonStep(state);
    if (step === "off") {
      measureDropAll();
      setState({ measuring: false });
      return;
    }
    if (step === "scale") {
      // Слова берём те, что уже есть у масштаба: второго рассказа про
      // калибровку в сборке быть не должно, а путь к ней — один.
      const go = await uiConfirm({
        title: strings.measure.scaleAskTitle,
        message: strings.scale.dialogNone + " " + strings.scale.dialogHint,
        confirmLabel: strings.scale.ask,
        cancelLabel: strings.measure.scaleLater,
        confirmClass: "ui-btn ui-btn--accent",
      });
      if (go) {
        // Калибровка забирает клик по плану себе — вдвоём с линейкой им на
        // одном поле не ужиться.
        measureDropAll();
        setState({ measuring: false });
        canvasStartScale(state.schemeId);
        return;
      }
      // Отказ — мерить всё равно: отрезок виден, а вместо числа стоит причина
      // (`measure.noMeters`). Отказывать во включении после нажатой кнопки
      // было бы грубее, чем сказать правду в подписи.
    }
    // Короткоживущие занятия холста (калибровка масштаба, помещение по
    // чертежу) тоже забирают клик по плану — при включении линейки рука
    // возвращается в «Выделение», иначе плашка обещала бы одно, а клик делал
    // другое.
    const patch = { measuring: true };
    const mode = getState().mode;
    if (mode && mode !== "select" && mode !== "add") patch.mode = "select";
    setState(patch);
  }

  function refresh(state) {
    host.hidden = !measureButtonShown(state);
    const on = state.measuring === true;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? strings.measure.titleOn : strings.measure.name);
    button.title = on ? strings.measure.titleOn : strings.measure.title;
  }

  subscribe((state, changed) => {
    if ("project" in changed || "screen" in changed || "measuring" in changed || "schemeId" in changed) refresh(state);
  });

  refresh(getState());
}

registerPanel(PANEL_IDS.headerMeasure, mountMeasureButton);
