// Переключатель режимов основного экрана: Чертёж · Схема · Объём (таск 153,
// G219).
//
// Слова заказчика: «На основном экране на схеме уже есть кнопки сверху по
// углам, надо на их уровне по центру добавить переключатель — Чертёж, Схема,
// Объём. Чтобы переключать контент, а не в окне показывать чертёж и объём. Ну
// и кнопка 3D тоже уйдёт соответственно».
//
// **Переключатель — единственная дверь к режиму.** Его же зовут кнопки в
// строке схемы («Чертёж» и «Объём» в панели схем): они выбирают схему и
// переключают режим, а не открывают окно. Второго пути к чертежу и к объёму в
// сборке нет — прежние окна убраны целиком.
//
// Кнопки режимов **не гаснут**: режим доступен всегда, даже когда показывать в
// нём нечего. Нет чертежа — об этом говорит само поле («Объём» рисует задник и
// плашку с причиной), а не погашенная кнопка: прежняя «3D» гасла потому, что
// она открывала окно, а окна больше нет. Исключение одно и оно про экран, а не
// про объект: на узком экране «Чертежа» нет вовсе — там нет никакой правки
// (`screensFor`).
import { PANEL_IDS, registerPanel, screenAllowed, screensFor, setScreen, SCREEN_DEFAULT } from "../app.js";
import { strings } from "../strings.js";
import { uiEl, uiButton } from "./ui.js";

function mountScreens(host, api) {
  const { getState, setState, subscribe } = api;
  // Идентификатор объекта, на котором собран ряд: сменился объект — режим
  // возвращается к схеме (она главная, и у нового объекта чертежа может не
  // быть вовсе). Сам `project` в состоянии меняется на каждую правку, поэтому
  // сравнивается именно id.
  let projectId = null;
  const row = uiEl("div", {
    class: "canvas-modes",
    attrs: { role: "group", "aria-label": strings.screens.label },
  });
  const buttons = new Map();
  for (const screen of ["drawing", "scheme", "volume"]) {
    buttons.set(
      screen,
      uiButton(strings.screens[screen], {
        class: "ui-btn canvas-modes__btn",
        title: strings.screens[screen + "Hint"],
        on: { click: () => setScreen(screen) },
      }),
    );
  }
  row.append(...buttons.values());
  host.append(row);

  const render = () => {
    const state = getState();
    // Без открытой схемы показывать нечего ни одному режиму: ряд уходит
    // целиком, как уходят подсказка и кнопка полного экрана.
    row.hidden = !state.schemeId;
    const shown = screensFor(state.layout);
    for (const [screen, button] of buttons) {
      button.hidden = !shown.includes(screen);
      const on = state.screen === screen;
      button.className = "ui-btn canvas-modes__btn" + (on ? " is-on" : "");
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  subscribe((state, changed) => {
    if ("project" in changed) {
      const id = state.project ? state.project.id : null;
      if (id !== projectId) {
        projectId = id;
        // Новый объект открывается схемой (таск 153): в объект режим не
        // пишется (G68), и помнить чужой чертёж на новом объекте незачем.
        if (state.screen !== SCREEN_DEFAULT && screenAllowed(SCREEN_DEFAULT, state.layout)) {
          setState({ screen: SCREEN_DEFAULT });
        }
      }
    }
    if ("screen" in changed || "schemeId" in changed || "layout" in changed || "project" in changed) render();
  });
  render();
}

registerPanel(PANEL_IDS.canvasModes, mountScreens);
