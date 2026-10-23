// Переключатель режимов основного экрана: Чертёж · Схема · Объём · Сценарии
// (таск 153, G219; четвёртый режим — таск 10 сценариев, G05).
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
import { PANEL_IDS, registerPanel, screensFor, setScreen } from "../app.js";
import { strings } from "../strings.js";
import { uiEl, uiButton } from "./ui.js";

function mountScreens(host, api) {
  const { getState, subscribe } = api;
  const row = uiEl("div", {
    class: "canvas-modes",
    attrs: { role: "group", "aria-label": strings.screens.label },
  });
  const buttons = new Map();
  for (const screen of ["drawing", "scheme", "volume", "scenarios"]) {
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

  // Что стоит на новом объекте — решает **память вида** (таск 193, G294), и
  // решает она это в одном месте, в каркасе (`app.viewMemoryPatch`): объект
  // открывается тем режимом, с которого с ним ушли, а объект, у которого
  // памяти нет, — схемой, как было с таска 153.
  //
  // Здесь этого правила больше нет нарочно. Раньше ряд сам возвращал режим к
  // схеме на смену объекта, и ровно это поздним срабатыванием спорило бы с
  // памятью: объект догружается через секунду-две, и переключение, сделанное
  // человеком до того, перебивалось бы (дефект D54).
  subscribe((state, changed) => {
    if ("screen" in changed || "schemeId" in changed || "layout" in changed || "project" in changed) render();
  });
  render();
}

registerPanel(PANEL_IDS.canvasModes, mountScreens);
