// Панель выгрузки: две кнопки в шапке и два диалога — таблица и схема.
//
// Панель ничего не считает сама: таблицу строит `tables.js`, картинку и печать
// делает `exporter.js`. Здесь — выбор разбивки, области и множителя, да связь
// с состоянием сеанса: фильтр, схема и её план берутся ровно те, что на экране,
// поэтому скрытое фильтром не попадает ни в таблицу, ни в картинку, ни в легенду.
import { PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import { findScheme, schemesInOrder } from "../model.js";
import { screenToPlan } from "../render.js";
import { getImage } from "../store.js";
import { decodePlanImage, releasePlanImage } from "../imagePrep.js";
import { marksTable, tableRowCount, toCsv, toMarkdown, toTsv, typesTable } from "../tables.js";
import {
  EXPORT_SCALES,
  allSchemesZip,
  exportCopy,
  exportDownload,
  exportFileName,
  exportSizeText,
  exportTableNode,
  exportTableSizeText,
  exportText,
  printView,
  schemePng,
  tablePng,
} from "../exporter.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

// Выбор пользователя живёт между открытиями диалога: разбивку и множитель
// выставляют один раз на объект, а выгружают много раз.
const exportChoice = {
  kind: "marks",
  groupBy: "category",
  currentScheme: false,
  area: "all",
  legend: true,
  tableScale: 2,
  schemeScale: 2,
};

function exportField(labelText, control) {
  return uiEl("label", { class: "export__field" }, [
    uiEl("span", { class: "export__field-label", text: labelText }),
    control,
  ]);
}

function exportSelect(options, value, onChange) {
  const select = uiEl("select", { class: "ui-input export__select", on: { change: () => onChange(select.value) } });
  for (const option of options) {
    const node = uiEl("option", { text: option.label, value: option.value });
    node.value = option.value;
    if (option.value === value) node.selected = true;
    select.append(node);
  }
  return select;
}

function exportCheck(labelText, checked, onChange) {
  const input = uiEl("input", { class: "export__check", type: "checkbox", on: { change: () => onChange(input.checked) } });
  input.checked = checked;
  return uiEl("label", { class: "export__toggle" }, [input, uiEl("span", { text: labelText })]);
}

function exportScaleSelect(value, onChange) {
  return exportSelect(
    EXPORT_SCALES.map((scale) => ({ value: String(scale), label: scale + "×" })),
    String(value),
    (next) => onChange(Number(next)),
  );
}

// Прямоугольник «как вижу» в пикселях плана: углы холста переводятся в доли
// плана тем же screenToPlan, что и клики по холсту.
function exportViewArea(state, scheme) {
  const host = document.getElementById("canvas-host");
  if (!host) return "all";
  const box = host.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return "all";
  const width = scheme.width > 0 ? scheme.width : 1000;
  const height = scheme.height > 0 ? scheme.height : 1000;
  const from = screenToPlan({ x: 0, y: 0 }, scheme, state.view);
  const to = screenToPlan({ x: box.width, y: box.height }, scheme, state.view);
  return {
    x: from.x * width,
    y: from.y * height,
    width: (to.x - from.x) * width,
    height: (to.y - from.y) * height,
  };
}

function exportAreaSize(state, scheme) {
  const area = exportChoice.area === "view" ? exportViewArea(state, scheme) : "all";
  if (area === "all") {
    return {
      width: scheme.width > 0 ? scheme.width : 1000,
      height: scheme.height > 0 ? scheme.height : 1000,
    };
  }
  const width = scheme.width > 0 ? scheme.width : 1000;
  const height = scheme.height > 0 ? scheme.height : 1000;
  return {
    width: Math.min(width, Math.max(1, area.width)),
    height: Math.min(height, Math.max(1, area.height)),
  };
}

// План схемы для рисования: уже разобранный на холсте — как есть, чужой —
// из хранилища. Разобранный здесь план здесь же и освобождается.
async function exportSchemeImage(state, scheme) {
  const loaded = state.schemeImage;
  if (loaded && loaded.schemeId === scheme.id && loaded.image) return { image: loaded.image, release: null };
  if (!scheme.imageId) return { image: null, release: null };
  const blob = await getImage(scheme.imageId);
  if (!blob) return { image: null, release: null };
  const decoded = await decodePlanImage(blob);
  return { image: decoded.image, release: () => releasePlanImage(decoded) };
}

function exportFilterOf(state) {
  return exportChoice.currentScheme && state.schemeId
    ? { ...state.filter, schemeId: state.schemeId }
    : state.filter;
}

function exportTableOf(state) {
  if (exportChoice.kind === "types") return typesTable(state.project);
  return marksTable(state.project, exportFilterOf(state), exportChoice.groupBy);
}

function exportSubtitleOf(state, table) {
  const scheme = state.schemeId ? findScheme(state.project, state.schemeId) : null;
  const parts = [text("exportPanel.rows", { count: tableRowCount(table) })];
  if (exportChoice.currentScheme && scheme) parts.push(scheme.name);
  return parts.join(" · ");
}

function exportBaseName(state, suffix) {
  const scheme = exportChoice.currentScheme && state.schemeId ? findScheme(state.project, state.schemeId) : null;
  return exportFileName(state.project, scheme, suffix);
}

// ——— диалог таблицы ———————————————————————————————————————————————————

function exportTableDialog(api) {
  const { getState, notify } = api;
  const state = getState();
  const preview = uiEl("div", { class: "export__preview" });
  const hint = uiEl("p", { class: "export__hint" });
  let table = exportTableOf(state);

  const refresh = () => {
    table = exportTableOf(state);
    preview.replaceChildren(
      exportTableNode(table, { title: table.title || state.project.name, subtitle: exportSubtitleOf(state, table) }),
    );
    hint.textContent = exportTableSizeText(table, exportChoice.tableScale);
  };

  const groupSelect = exportSelect(
    [
      { value: "category", label: strings.exportPanel.groupByCategory },
      { value: "type", label: strings.exportPanel.groupByType },
      { value: "room", label: strings.exportPanel.groupByRoom },
    ],
    exportChoice.groupBy,
    (value) => {
      exportChoice.groupBy = value;
      refresh();
    },
  );

  const kindSelect = exportSelect(
    [
      { value: "marks", label: strings.exportPanel.kindMarks },
      { value: "types", label: strings.exportPanel.kindTypes },
    ],
    exportChoice.kind,
    (value) => {
      exportChoice.kind = value;
      groupSelect.disabled = value === "types";
      refresh();
    },
  );
  groupSelect.disabled = exportChoice.kind === "types";

  const controls = uiEl("div", { class: "export__controls" }, [
    exportField(strings.exportPanel.kind, kindSelect),
    exportField(strings.exportPanel.groupBy, groupSelect),
    exportField(
      strings.exportPanel.scale,
      exportScaleSelect(exportChoice.tableScale, (value) => {
        exportChoice.tableScale = value;
        hint.textContent = exportTableSizeText(table, value);
      }),
    ),
    exportCheck(strings.exportPanel.currentScheme, exportChoice.currentScheme, (on) => {
      exportChoice.currentScheme = on;
      refresh();
    }),
  ]);

  const saved = (name) => notify(text("exportPanel.saved", { name }), "success");
  const guard = async (run) => {
    try {
      await run();
    } catch (error) {
      notify(error && error.message ? error.message : strings.exportPanel.failed, "error");
    }
  };

  const actions = [
    uiButton(strings.exportPanel.csv, {
      on: {
        click: () =>
          guard(async () => {
            const name = exportBaseName(state, "csv");
            exportText(toCsv(table), name, "text/csv;charset=utf-8");
            saved(name);
          }),
      },
    }),
    uiButton(strings.exportPanel.markdown, {
      on: {
        click: () =>
          guard(async () => {
            const name = exportBaseName(state, "md");
            exportText(toMarkdown(table), name, "text/markdown;charset=utf-8");
            saved(name);
          }),
      },
    }),
    uiButton(strings.exportPanel.copy, {
      on: {
        click: () =>
          guard(async () => {
            const ok = await exportCopy(toTsv(table));
            notify(ok ? strings.exportPanel.copied : strings.exportPanel.copyFailed, ok ? "success" : "error");
          }),
      },
    }),
    uiButton(strings.exportPanel.png, {
      on: {
        click: () =>
          guard(async () => {
            const blob = await tablePng(table, {
              scale: exportChoice.tableScale,
              title: table.title || state.project.name,
              subtitle: exportSubtitleOf(state, table),
            });
            const name = exportBaseName(state, "png");
            exportDownload(blob, name);
            saved(name);
          }),
      },
    }),
    uiButton(strings.exportPanel.print, {
      class: "ui-btn ui-btn--accent",
      on: {
        click: () =>
          guard(() =>
            printView("table", {
              table,
              title: table.title || state.project.name,
              subtitle: exportSubtitleOf(state, table),
              footer: state.project.name,
            }),
          ),
      },
    }),
  ];

  const modal = uiModal({
    title: strings.exportPanel.tableDialog,
    body: uiEl("div", { class: "export__body" }, [controls, hint, preview]),
    actions: [uiButton(strings.dialog.close, { on: { click: () => modal.close() } }), ...actions],
    primary: actions[actions.length - 1],
  });
  refresh();
}

// ——— диалог схемы —————————————————————————————————————————————————————

function exportSchemeDialog(api) {
  const { getState, notify } = api;
  const state = getState();
  const scheme = findScheme(state.project, state.schemeId);
  const hint = uiEl("p", { class: "export__hint" });

  const refreshHint = () => {
    const size = exportAreaSize(state, scheme);
    hint.textContent = exportSizeText(size.width, size.height, exportChoice.schemeScale);
  };

  const controls = uiEl("div", { class: "export__controls" }, [
    exportField(
      strings.exportPanel.area,
      exportSelect(
        [
          { value: "all", label: strings.exportPanel.areaAll },
          { value: "view", label: strings.exportPanel.areaView },
        ],
        exportChoice.area,
        (value) => {
          exportChoice.area = value;
          refreshHint();
        },
      ),
    ),
    exportField(
      strings.exportPanel.scale,
      exportScaleSelect(exportChoice.schemeScale, (value) => {
        exportChoice.schemeScale = value;
        refreshHint();
      }),
    ),
    exportCheck(strings.exportPanel.withLegend, exportChoice.legend, (on) => {
      exportChoice.legend = on;
    }),
  ]);

  const guard = async (run) => {
    try {
      await run();
    } catch (error) {
      notify(error && error.message ? error.message : strings.exportPanel.failed, "error");
    }
  };

  const renderScheme = async () => {
    const { image, release } = await exportSchemeImage(state, scheme);
    // План может быть не загружен — метки тогда лягут на белый лист, и лучше
    // сказать об этом, чем отдать «пустую» на вид картинку молча.
    if (!image) notify(strings.exportPanel.noImage, "info");
    try {
      return await schemePng(state.project, scheme, image, {
        area: exportChoice.area === "view" ? exportViewArea(state, scheme) : "all",
        scale: exportChoice.schemeScale,
        legend: exportChoice.legend,
        filter: state.filter,
      });
    } finally {
      if (release) release();
    }
  };

  const actions = [
    uiButton(strings.exportPanel.allSchemes, {
      on: {
        click: () =>
          guard(async () => {
            notify(strings.exportPanel.busy, "info");
            const images = new Map();
            for (const item of schemesInOrder(state.project)) {
              if (!item.imageId || images.has(item.imageId)) continue;
              const blob = await getImage(item.imageId);
              if (blob) images.set(item.imageId, blob);
            }
            const zip = await allSchemesZip(state.project, images, {
              scale: exportChoice.schemeScale,
              legend: exportChoice.legend,
              filter: state.filter,
            });
            const name = exportFileName(state.project, strings.exportPanel.schemesSuffix, "zip");
            exportDownload(zip, name);
            notify(text("exportPanel.schemesDone", { count: state.project.schemes.length }), "success");
          }),
      },
    }),
    uiButton(strings.exportPanel.print, {
      on: {
        click: () =>
          guard(async () => {
            const blob = await renderScheme();
            await printView("scheme", { blob, title: state.project.name + " · " + scheme.name });
          }),
      },
    }),
    uiButton(strings.exportPanel.download, {
      class: "ui-btn ui-btn--accent",
      on: {
        click: () =>
          guard(async () => {
            const blob = await renderScheme();
            const name = exportFileName(state.project, scheme, "png");
            exportDownload(blob, name);
            notify(text("exportPanel.saved", { name }), "success");
          }),
      },
    }),
  ];

  const modal = uiModal({
    title: strings.exportPanel.schemeDialog,
    body: uiEl("div", { class: "export__body" }, [controls, hint]),
    actions: [uiButton(strings.dialog.close, { on: { click: () => modal.close() } }), ...actions],
    primary: actions[actions.length - 1],
  });
  refreshHint();
}

// ——— панель ———————————————————————————————————————————————————————————

function mountExportPanel(host, api) {
  const { getState, subscribe } = api;
  const tableButton = uiButton(strings.exportPanel.tableTitle, {
    on: { click: () => exportTableDialog(api) },
  });
  const schemeButton = uiButton(strings.exportPanel.schemeTitle, {
    on: { click: () => exportSchemeDialog(api) },
  });
  host.replaceChildren(uiEl("div", { class: "export" }, [tableButton, schemeButton]));

  // Пустая выгрузка никому не нужна: без меток кнопки гаснут и говорят почему.
  const sync = (state) => {
    const marks = state.project ? state.project.marks.length : 0;
    const scheme = state.project && state.schemeId ? findScheme(state.project, state.schemeId) : null;
    tableButton.disabled = marks === 0;
    tableButton.title = marks === 0 ? strings.exportPanel.noMarks : strings.exportPanel.tableDialog;
    schemeButton.disabled = marks === 0 || !scheme;
    schemeButton.title = !scheme
      ? strings.exportPanel.noScheme
      : marks === 0
        ? strings.exportPanel.noMarks
        : strings.exportPanel.schemeDialog;
  };

  subscribe(sync);
  sync(getState());
}

registerPanel(PANEL_IDS.headerActions, mountExportPanel);
