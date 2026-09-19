// Переключатель связей в шапке — сосед счётчика предупреждений справа.
//
// Связи («чем управляет») живут в объекте с давних пор, но на плане их до сих
// пор не было видно: список меток говорил «Управляет: Т1, Т2», а где эти Т1 и
// Т2 лежат — приходилось искать глазами. Кнопка зажигает на плане дуги от
// управляющей метки к управляемым.
//
// **Выключенная кнопка не значит «связей не видно»**: выделенная метка свои
// связи показывает и так. Кнопка добавляет к этому все остальные — она про
// охват, а не про «рисовать или нет». Слова заказчика: «если связи не
// включены, то при выделении метки да, пусть показываются её связи».
//
// Сама панель не рисует ничего: она правит одну отметку состояния, а рисует
// холст (`canvas.canvasFrameLinks` → `render.drawMarkLinks`). Отметка живёт в
// настройках браузера, как отметка линейки: это оснастка разбора, а не свойство
// разметки, и в объект с файлом проекта ей не за чем.
import { layoutAllows, LINKS_SETTING, PANEL_IDS, registerPanel } from "../app.js";
import { findScheme } from "../model.js";
import { markLinks } from "../render.js";
import { setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import { uiIconButton } from "./ui.js";

/**
 * Что сказать пользователю в тот миг, когда он включил связи. Чистая: план
 * подсказки считается от объекта, а не от DOM.
 *
 * Молчать нельзя в двух случаях. Первый — показывать нечего: связей на схеме
 * нет вовсе, и погасший план читался бы как «кнопка сломана». Второй — часть
 * связей ведёт на другую схему: линию через границу листа не провести, у метки
 * рисуется обрывок, и про него надо сказать словами хотя бы раз.
 */
export function linksNotice(project, scheme, filter) {
  const links = markLinks(project, scheme, filter);
  const away = links.offScheme.reduce((sum, item) => sum + item.count, 0);
  if (links.lines.length === 0 && away === 0) return strings.links.none;
  if (away > 0) return text("links.away", { count: away });
  return null;
}

// Подсказка кнопки: что она сделает, что видно сейчас и как связи попадают в
// выгрузку. Три строки — потому что отвечать на эти три вопроса больше негде:
// кнопка одна, а режима у показа два.
export function linksHint(shown) {
  const first = shown ? strings.links.hideHint : strings.links.showHint;
  const scope = shown ? strings.links.scopeOn : strings.links.scopeOff;
  return [first, scope, strings.links.inExport].join(". ");
}

function mountLinksPanel(host, api) {
  const { getState, setState, subscribe, notify } = api;

  const toggle = uiIconButton("link", {
    class: "ui-btn links__toggle",
    label: strings.links.show,
    title: strings.links.showHint,
    on: { click: () => flip() },
  });
  toggle.setAttribute("aria-pressed", "false");
  host.replaceChildren(toggle);

  function flip() {
    const state = getState();
    const next = state.linksShown !== true;
    setState({ linksShown: next });
    setSetting(LINKS_SETTING, next);
    if (!next) return;
    // Сказать про пустоту и про связи на другие схемы — один раз, в момент
    // включения. Держать это в подсказке кнопки бесполезно: на неё не наводят.
    const scheme = state.schemeId ? findScheme(state.project, state.schemeId) : null;
    if (!scheme) return;
    const notice = linksNotice(state.project, scheme, state.filter);
    if (notice) notify(notice, "info");
  }

  function refresh(state) {
    const shown = Boolean(state.project) && layoutAllows("markLinks", state.layout);
    host.hidden = !shown;
    const on = state.linksShown === true;
    toggle.classList.toggle("is-on", on);
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    toggle.setAttribute("aria-label", on ? strings.links.hide : strings.links.show);
    toggle.title = linksHint(on);
  }

  subscribe((state, changed) => {
    if ("project" in changed || "layout" in changed || "linksShown" in changed) refresh(state);
  });

  refresh(getState());
}

registerPanel(PANEL_IDS.headerLinks, mountLinksPanel);
