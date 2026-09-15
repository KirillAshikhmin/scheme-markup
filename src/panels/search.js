// Поиск по объекту: строка в шапке и выпадающий список вариантов.
//
// Ищут не по открытой схеме, а по всему объекту: «где Р14» — вопрос про дом,
// а не про лист. Поэтому выбор варианта не просто выделяет метку, а переключает
// схему, если метка на другой, и подводит к ней холст — ради этого поиск
// и заведён. Подбор вариантов живёт в `model.searchProject`, здесь только
// список, клавиши и прыжок.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import { findMark, findScheme, searchProject, styleOf } from "../model.js";
import { strings, text } from "../strings.js";
import { uiEl } from "./ui.js";
import { shapeIcon } from "../render.js";
// Подводит холст к метке — то же самое делает клик по строке списка меток.
import { marksCenteredView } from "./marks.js";

// Больше тридцати строк в выпадающем списке никто не читает: остальное
// сужают запросом, а сколько всего нашлось — сказано внизу списка.
export const SEARCH_LIMIT = 30;

function searchRowNode(project, row, active, onPick, onHover) {
  const style = styleOf(project, row.typeId);
  const where = [row.roomName || strings.search.noRoom, row.schemeName].filter(Boolean).join(" · ");
  const parts = [
    shapeIcon(style.shape, style.color, 16),
    uiEl("span", { class: "search__label", text: row.label }),
    uiEl("span", { class: "search__type", text: row.typeName }),
    uiEl("span", { class: "search__where", text: where }),
  ];
  // Совпало не обозначение — показываем, что именно нашлось: иначе строка
  // выглядит случайной.
  if (row.field === "location" || row.field === "original") {
    parts.push(uiEl("span", { class: "search__match", text: row.value }));
  }
  return uiEl(
    "button",
    {
      class: "search__row" + (active ? " is-active" : ""),
      type: "button",
      on: { click: onPick, pointerenter: onHover },
    },
    parts,
  );
}

function mountSearchPanel(host, api) {
  const { getState, setState, subscribe } = api;
  let rows = [];
  let active = 0;
  let pending = null;

  const input = uiEl("input", {
    class: "ui-input search__input",
    type: "search",
    placeholder: strings.search.placeholder,
    title: strings.search.title,
  });
  const drop = uiEl("div", { class: "search__drop" });
  drop.hidden = true;
  const box = uiEl("div", { class: "search" }, [input, drop]);
  host.replaceChildren(box);

  function close() {
    drop.hidden = true;
    drop.replaceChildren();
    rows = [];
    active = 0;
  }

  function render() {
    const project = getState().project;
    if (!project || rows.length === 0) {
      drop.replaceChildren(uiEl("p", { class: "search__empty", text: strings.search.empty }));
      drop.hidden = false;
      return;
    }
    const shown = rows.slice(0, SEARCH_LIMIT);
    const nodes = shown.map((row, index) =>
      searchRowNode(
        project,
        row,
        index === active,
        () => pick(index),
        () => setActive(index, false),
      ),
    );
    if (rows.length > shown.length) {
      nodes.push(
        uiEl("p", {
          class: "search__more",
          text: text("search.more", { shown: shown.length, total: rows.length }),
        }),
      );
    }
    drop.replaceChildren(...nodes);
    drop.hidden = false;
  }

  function setActive(index, scroll = true) {
    const shown = Math.min(rows.length, SEARCH_LIMIT);
    if (shown === 0) return;
    active = ((index % shown) + shown) % shown;
    const nodes = drop.querySelectorAll(".search__row");
    nodes.forEach((node, position) => node.classList.toggle("is-active", position === active));
    if (scroll && nodes[active]) nodes[active].scrollIntoView({ block: "nearest" });
  }

  function search() {
    const state = getState();
    const query = input.value;
    if (!state.project || query.trim() === "") {
      close();
      return;
    }
    rows = searchProject(state.project, query);
    active = 0;
    render();
  }

  // Прыжок к метке: схема, выделение и подведённый холст. Картинка новой схемы
  // приходит не мгновенно, а холст сам вписывает план, когда её дождётся, —
  // поэтому центрируем ещё раз, когда картинка доехала.
  function centerOn(row) {
    const state = getState();
    if (!state.project || state.schemeId !== row.schemeId) return false;
    const scheme = findScheme(state.project, row.schemeId);
    const mark = findMark(state.project, row.markId);
    if (!scheme || !mark) return false;
    setState({ view: marksCenteredView(scheme, mark, state.view) });
    return true;
  }

  function pick(index) {
    const row = rows[index];
    if (!row) return;
    const state = getState();
    const patch = { selectedMarkIds: [row.markId], selectedOutlineId: null };
    if (state.schemeId !== row.schemeId) patch.schemeId = row.schemeId;
    setState(patch);
    pending = row;
    queueMicrotask(() => {
      if (pending === row && centerOn(row)) pending = null;
    });
    drop.hidden = true;
    input.blur();
  }

  input.addEventListener("input", () => search());
  input.addEventListener("focus", () => {
    if (input.value.trim() !== "") search();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (drop.hidden) search();
      else setActive(active + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // Enter — первый вариант, как и просил пользователь: набрал «Р14», нажал,
      // оказался на нужной схеме.
      if (drop.hidden) search();
      if (rows.length > 0) pick(active);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (!drop.hidden) {
        close();
        return;
      }
      input.value = "";
      input.blur();
    }
  });
  // Клик мимо списка закрывает его, но не мешает клику по строке.
  box.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!box.contains(document.activeElement)) drop.hidden = true;
    }, 0);
  });

  subscribe((state, changed) => {
    if ("layout" in changed) host.hidden = !layoutAllows("search", state.layout);
    if ("project" in changed && state.project) {
      // Сменился объект — прежние находки к нему не относятся.
      if (!state.project.marks.some((mark) => rows.some((row) => row.markId === mark.id))) close();
    }
    if (pending && ("schemeImage" in changed || "schemeId" in changed || "project" in changed)) {
      if (centerOn(pending)) pending = null;
    }
  });
  host.hidden = !layoutAllows("search", getState().layout);
}

registerPanel(PANEL_IDS.headerSearch, mountSearchPanel);
