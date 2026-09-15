// Фильтры списка меток: галочки категорий и типов, помещение и поиск.
//
// Фильтр живёт в состоянии сеанса (`state.filter`) и один на всех: по нему
// рисует холст, по нему же строится список сбоку и легенда в выгрузке.
// Поэтому здесь только чистые функции над ним — что видно, что отмечено и во
// что превращается щелчок по галочке; сама панель собирается из них ниже.
import { findScheme, findType, labelOf, roomsInOrder, styleOf, typesInOrder } from "../model.js";
import { strings, text } from "../strings.js";
import { uiButton, uiEl } from "./ui.js";
import { visibleMarks } from "../render.js";

// Порядок строк списка — порядок справочника: категории по своему order, типы
// внутри, метки по номеру. Тот же обход, что у легенды и таблиц.
export function filtersMarkRows(project, schemeId, filter) {
  const scheme = project ? findScheme(project, schemeId) : null;
  if (!scheme) return [];
  const order = new Map();
  const categoryOf = new Map();
  let index = 0;
  for (const group of typesInOrder(project)) {
    for (const type of group.types) {
      order.set(type.id, index);
      categoryOf.set(type.id, group.category);
      index += 1;
    }
  }
  const last = index;
  return visibleMarks(project, scheme, filter)
    .map((mark) => ({
      mark,
      type: findType(project, mark.typeId),
      category: categoryOf.get(mark.typeId) || null,
      style: styleOf(project, mark.typeId),
      label: labelOf(project, mark.id),
    }))
    .sort((a, b) => {
      const orderA = order.has(a.mark.typeId) ? order.get(a.mark.typeId) : last;
      const orderB = order.has(b.mark.typeId) ? order.get(b.mark.typeId) : last;
      return orderA === orderB ? a.mark.number - b.mark.number : orderA - orderB;
    });
}

// Видимые типы — одно множество, из которого собираются оба поля фильтра.
// Галочка категории и галочка типа правят его, а `categoryIds`/`typeIds`
// пересчитываются заново: держать две независимые истины — значит рано или
// поздно показать метку, которую сняли галочкой, или наоборот.
function filtersTypeSet(project, filter) {
  const byType = filter && Array.isArray(filter.typeIds) ? new Set(filter.typeIds) : null;
  const byCategory = filter && Array.isArray(filter.categoryIds) ? new Set(filter.categoryIds) : null;
  const visible = new Set();
  for (const type of project.markTypes) {
    if (byType && !byType.has(type.id)) continue;
    if (byCategory && !byCategory.has(type.categoryId)) continue;
    visible.add(type.id);
  }
  return visible;
}

function filtersFromTypeSet(project, filter, visible) {
  const types = project.markTypes;
  const everyType = types.every((type) => visible.has(type.id));
  // Категория без типов — всегда отмечена: прятать в ней нечего.
  const categories = project.categories.filter((category) => {
    const own = types.filter((type) => type.categoryId === category.id);
    return own.length === 0 || own.some((type) => visible.has(type.id));
  });
  const everyCategory = categories.length === project.categories.length;
  return {
    ...(filter || {}),
    categoryIds: everyCategory ? null : categories.map((category) => category.id),
    typeIds: everyType ? null : types.filter((type) => visible.has(type.id)).map((type) => type.id),
  };
}

export function filtersTypeChecked(project, filter, typeId) {
  return filtersTypeSet(project, filter).has(typeId);
}

// «on» — видны все типы категории, «off» — ни одного, «mixed» — часть.
export function filtersCategoryChecked(project, filter, categoryId) {
  const visible = filtersTypeSet(project, filter);
  const own = project.markTypes.filter((type) => type.categoryId === categoryId);
  if (own.length === 0) return "on";
  const shown = own.filter((type) => visible.has(type.id)).length;
  if (shown === 0) return "off";
  return shown === own.length ? "on" : "mixed";
}

export function filtersToggleType(project, filter, typeId, on) {
  const visible = filtersTypeSet(project, filter);
  if (on) visible.add(typeId);
  else visible.delete(typeId);
  return filtersFromTypeSet(project, filter, visible);
}

export function filtersToggleCategory(project, filter, categoryId, on) {
  const visible = filtersTypeSet(project, filter);
  for (const type of project.markTypes) {
    if (type.categoryId !== categoryId) continue;
    if (on) visible.add(type.id);
    else visible.delete(type.id);
  }
  return filtersFromTypeSet(project, filter, visible);
}

export function filtersSetAllTypes(project, filter, on) {
  const visible = new Set(on ? project.markTypes.map((type) => type.id) : []);
  return filtersFromTypeSet(project, filter, visible);
}

export function filtersActive(filter) {
  if (!filter) return false;
  return Boolean(
    Array.isArray(filter.categoryIds) ||
      Array.isArray(filter.typeIds) ||
      filter.roomId ||
      (filter.query || "").trim(),
  );
}

// ——— панель фильтров ——————————————————————————————————————————————————

function filtersSignature(project) {
  if (!project) return "";
  return [
    project.categories.map((category) => [category.id, category.name, category.color, category.shape].join("~")).join("|"),
    project.markTypes.map((type) => [type.id, type.code, type.name, type.categoryId, type.shape].join("~")).join("|"),
    project.rooms.map((room) => [room.id, room.name].join("~")).join("|"),
  ].join("#");
}

// Дерево галочек перестраивается только при правке справочника: щелчок по
// галочке меняет фильтр, а не разметку панели — иначе чекбокс исчезал бы
// из-под курсора вместе с фокусом.
export function filtersBox(api) {
  const { getState, setState, subscribe } = api;
  const node = uiEl("div", { class: "filters" });
  const search = uiEl("input", {
    class: "ui-input filters__search",
    type: "text",
    placeholder: strings.filters.searchPlaceholder,
    title: strings.filters.searchHint,
    on: { input: () => patch({ query: search.value }) },
  });
  const rooms = uiEl("select", {
    class: "ui-select",
    title: strings.filters.room,
    on: { change: () => patch({ roomId: rooms.value || null }) },
  });
  const tree = uiEl("div", { class: "filters__tree" });
  const summary = uiEl("summary", { class: "filters__summary", text: strings.filters.types });
  const details = uiEl("details", { class: "filters__details" }, [summary, tree]);
  const reset = uiButton(strings.filters.showAll, {
    class: "ui-btn ui-btn--wide",
    on: {
      click: () => {
        const state = getState();
        setState({ filter: { ...filtersSetAllTypes(state.project, state.filter, true), roomId: null, query: "" } });
        search.value = "";
      },
    },
  });
  let signature = null;
  let checks = [];

  function patch(part) {
    const state = getState();
    setState({ filter: { ...state.filter, ...part } });
  }

  function toggle(state, next) {
    setState({ filter: { ...next, roomId: state.filter.roomId, query: state.filter.query } });
  }

  function buildTree(project) {
    checks = [];
    tree.replaceChildren();
    rooms.replaceChildren(uiEl("option", { value: "", text: strings.filters.allRooms }));
    for (const room of roomsInOrder(project)) {
      rooms.append(uiEl("option", { value: room.id, text: room.name }));
    }
    for (const { category, types } of project ? typesInOrder(project) : []) {
      const box = uiEl("input", { class: "filters__check", type: "checkbox" });
      box.addEventListener("change", () => {
        const state = getState();
        toggle(state, filtersToggleCategory(state.project, state.filter, category.id, box.checked));
      });
      checks.push({ box, kind: "category", id: category.id });
      const dot = uiEl("span", { class: "filters__dot" });
      dot.style.background = category.color;
      tree.append(
        uiEl("label", { class: "filters__category" }, [
          box,
          dot,
          uiEl("span", { class: "filters__name", text: category.name }),
        ]),
      );
      for (const type of types) {
        const typeBox = uiEl("input", { class: "filters__check", type: "checkbox" });
        typeBox.addEventListener("change", () => {
          const state = getState();
          toggle(state, filtersToggleType(state.project, state.filter, type.id, typeBox.checked));
        });
        checks.push({ box: typeBox, kind: "type", id: type.id });
        tree.append(
          uiEl("label", { class: "filters__type" }, [
            typeBox,
            uiEl("span", { class: "filters__code", text: type.code }),
            uiEl("span", { class: "filters__name", text: type.name }),
          ]),
        );
      }
    }
  }

  function syncChecks(state) {
    const project = state.project;
    if (!project) return;
    let hidden = 0;
    for (const item of checks) {
      if (item.kind === "category") {
        const mode = filtersCategoryChecked(project, state.filter, item.id);
        item.box.checked = mode !== "off";
        item.box.indeterminate = mode === "mixed";
      } else {
        const on = filtersTypeChecked(project, state.filter, item.id);
        item.box.checked = on;
        if (!on) hidden += 1;
      }
    }
    summary.textContent = hidden > 0
      ? strings.filters.types + " — " + text("filters.hidden", { count: hidden })
      : strings.filters.types;
    rooms.value = state.filter.roomId || "";
    if (search.value !== (state.filter.query || "") && document.activeElement !== search) {
      search.value = state.filter.query || "";
    }
    reset.disabled = !filtersActive(state.filter);
  }

  function render() {
    const state = getState();
    const next = filtersSignature(state.project);
    if (next !== signature) {
      signature = next;
      buildTree(state.project);
    }
    syncChecks(state);
  }

  node.replaceChildren(search, rooms, details, reset);
  subscribe((state, changed) => {
    if ("project" in changed || "filter" in changed) render();
  });
  render();
  return { node, render };
}
