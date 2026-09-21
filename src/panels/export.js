// Панель выгрузки: две кнопки в шапке и два диалога — таблица и схема.
//
// Панель ничего не считает сама: таблицу строит `tables.js`, картинку и печать
// делает `exporter.js`. Здесь — выбор разбивки, области и множителя, да связь
// с состоянием сеанса: фильтр, схема и её план берутся ровно те, что на экране,
// поэтому скрытое фильтром не попадает ни в таблицу, ни в картинку, ни в легенду.
import { PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import { findRoom, findScheme, roomsInOrder, schemesInOrder } from "../model.js";
import { screenToPlan } from "../render.js";
import { getImage } from "../store.js";
import { decodePlanImage, releasePlanImage } from "../imagePrep.js";
import { equipmentTable, linksTable, marksTable, tableRowCount, toCsv, toMarkdown, toTsv, typesTable } from "../tables.js";
import {
  EXPORT_SCALES,
  allSchemesPlan,
  allSchemesZip,
  exportCopy,
  exportDownload,
  exportFileName,
  exportFitArea,
  exportRoomArea,
  exportRoomFilter,
  exportRoomName,
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
  // Галка «разбить по помещениям» и разбивка внутри — два разных выбора:
  // лист «Спальня → СВЕТ, ВЫКЛЮЧАТЕЛИ» заказчик читает как два уровня.
  byRoom: false,
  // Помещение листа таблицы: null — весь объект. Комнату листа выбирают здесь,
  // а не галочками панели меток (см. exportFilterOf).
  roomId: null,
  currentScheme: false,
  // Область схемы: "all" | "view" | "room:<id>".
  area: "all",
  legend: true,
  outlines: true,
  // Связи меток на бумаге. Умолчание — «нет»: лист по умолчанию остаётся
  // чертежом, а связи это разбор. Отметка живёт между открытиями диалога, как
  // и соседние, — поставил один раз и печатаешь с ней дальше.
  links: false,
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
    if (option.disabled) node.disabled = true;
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

// Выбран ли пункт «все помещения отдельно». Это не область одного листа, а
// состав архива: у кнопок «Печать» и «Скачать» одного листа он ничего не
// меняет — им достаётся общий лист схемы, и подсказка об этом говорит прямо.
function exportByRooms() {
  return exportChoice.area === "rooms";
}

// Выбранная область: вся схема, видимое на экране или габариты помещения.
// Комната без контура на этой схеме области не даёт — лист берётся целиком.
function exportAreaOf(state, scheme) {
  if (exportChoice.area === "view") return exportViewArea(state, scheme);
  if (exportChoice.area.startsWith("room:")) {
    return exportRoomArea(state.project, scheme, exportChoice.area.slice(5)) || "all";
  }
  return "all";
}

function exportAreaRoomId() {
  return exportChoice.area.startsWith("room:") ? exportChoice.area.slice(5) : null;
}

// Фильтр листа: к выбранному на экране добавляется помещение, когда лист
// режется по комнате. Одна дорога и у окна, и у архива — иначе лист, снятый
// кнопкой «Скачать», отличался бы от такого же листа внутри zip.
function exportFilterOfSheet(state) {
  return exportRoomFilter(state.filter, exportAreaRoomId());
}

// Кадр листа вместе с полями под подписи — тот же расчёт, что и в выгрузке:
// размер в диалоге обязан совпасть с тем, что ляжет на бумагу.
function exportFittedOf(state, scheme) {
  return exportFitArea(state.project, scheme, {
    area: exportAreaOf(state, scheme),
    filter: exportFilterOfSheet(state),
  });
}

function exportAreaSize(state, scheme) {
  const { area } = exportFittedOf(state, scheme);
  return { width: area.width, height: area.height };
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

// Комнату листа задаёт диалог, всё остальное (категории, типы, поиск) —
// панель меток. Два способа сузить одно и то же не спорят: на открытии диалог
// берёт комнату с экрана, дальше владеет ею он, и в списке видно, какая стоит.
function exportFilterOf(state) {
  const filter = { ...state.filter, roomId: exportChoice.roomId || null };
  if (exportChoice.currentScheme && state.schemeId) filter.schemeId = state.schemeId;
  return filter;
}

function exportSyncRoom(state) {
  const fromScreen = state.filter && state.filter.roomId;
  exportChoice.roomId = fromScreen && findRoom(state.project, fromScreen) ? fromScreen : null;
}

function exportTableOf(state) {
  if (exportChoice.kind === "types") return typesTable(state.project);
  if (exportChoice.kind === "links") {
    return linksTable(state.project, exportFilterOf(state), { byRoom: exportChoice.byRoom });
  }
  if (exportChoice.kind === "equipment") {
    return equipmentTable(state.project, exportFilterOf(state), { byRoom: exportChoice.byRoom });
  }
  return marksTable(state.project, exportFilterOf(state), exportChoice.groupBy, { byRoom: exportChoice.byRoom });
}

function exportSubtitleOf(state, table) {
  const scheme = state.schemeId ? findScheme(state.project, state.schemeId) : null;
  const parts = [text("exportPanel.rows", { count: tableRowCount(table) })];
  // Лист связей молчит о метках без связей — а их отсутствие на листе не
  // означает, что на объекте всё связано.
  if (table.kind === "links" && table.unlinked > 0) {
    parts.push(text("tables.unlinked", { count: table.unlinked }));
  }
  if (exportChoice.currentScheme && scheme) parts.push(scheme.name);
  return parts.join(" · ");
}

// Имя файла называет то, чем лист сужен: схему и помещение. Иначе три выгрузки
// одного объекта лягут в папку одинаковыми именами и затрут друг друга.
function exportBaseName(state, suffix) {
  const parts = [];
  const scheme = exportChoice.currentScheme && state.schemeId ? findScheme(state.project, state.schemeId) : null;
  if (scheme) parts.push(scheme.name);
  const room = exportChoice.roomId ? findRoom(state.project, exportChoice.roomId) : null;
  if (room) parts.push(room.name);
  // Три таблицы одного объекта иначе легли бы в папку загрузок одним именем:
  // лист связей затёр бы лист меток, и молча.
  if (exportChoice.kind === "links") parts.push(strings.exportPanel.kindLinks);
  else if (exportChoice.kind === "equipment") parts.push(strings.exportPanel.kindEquipment);
  else if (exportChoice.kind === "types") parts.push(strings.exportPanel.kindTypes);
  return exportFileName(state.project, parts.join(" — "), suffix);
}

// ——— диалог таблицы ———————————————————————————————————————————————————

function exportTableDialog(api) {
  const { getState, notify } = api;
  const state = getState();
  exportSyncRoom(state);
  // Галка и «по помещениям» в списке — один и тот же уровень: вместе они
  // не живут, и список переводится на категории ещё до отрисовки.
  if (exportChoice.byRoom && exportChoice.groupBy === "room") exportChoice.groupBy = "category";
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

  // Подпись переключателя меняется вместе с галкой: без неё «Разбивка» рядом
  // с «Разбить по помещениям» читается как второй способ сделать то же самое.
  const groupLabel = uiEl("span", {
    class: "export__field-label",
    text: exportChoice.byRoom ? strings.exportPanel.groupByInside : strings.exportPanel.groupBy,
  });
  const groupField = uiEl("label", { class: "export__field" }, [groupLabel, groupSelect]);
  const roomOption = [...groupSelect.options].find((option) => option.value === "room");
  if (roomOption) roomOption.disabled = exportChoice.byRoom;

  const byRoomField = exportCheck(strings.exportPanel.splitByRoom, exportChoice.byRoom, (on) => {
    exportChoice.byRoom = on;
    groupLabel.textContent = on ? strings.exportPanel.groupByInside : strings.exportPanel.groupBy;
    if (roomOption) roomOption.disabled = on;
    // «По помещениям» внутри помещений — тот же уровень дважды.
    if (on && groupSelect.value === "room") {
      groupSelect.value = "category";
      exportChoice.groupBy = "category";
    }
    refresh();
  });
  const byRoomInput = byRoomField.querySelector("input");

  // Весь объект или одно помещение. «Что на экране» здесь нет и быть не должно:
  // таблица не про кадр.
  const roomSelect = exportSelect(
    [
      { value: "", label: strings.exportPanel.roomAll },
      ...roomsInOrder(state.project).map((room) => ({ value: room.id, label: room.name })),
    ],
    exportChoice.roomId || "",
    (value) => {
      exportChoice.roomId = value || null;
      refresh();
    },
  );

  const kindSelect = exportSelect(
    [
      { value: "marks", label: strings.exportPanel.kindMarks },
      { value: "links", label: strings.exportPanel.kindLinks },
      { value: "equipment", label: strings.exportPanel.kindEquipment },
      { value: "types", label: strings.exportPanel.kindTypes },
    ],
    exportChoice.kind,
    (value) => {
      exportChoice.kind = value;
      // У связей верхний уровень занят направлением («Управляет» и обратно),
      // поэтому разбивка внутри там не выбирается; помещения и галка — работают.
      groupSelect.disabled = value !== "marks";
      roomSelect.disabled = value === "types";
      byRoomInput.disabled = value === "types";
      refresh();
    },
  );
  groupSelect.disabled = exportChoice.kind !== "marks";
  roomSelect.disabled = exportChoice.kind === "types";
  byRoomInput.disabled = exportChoice.kind === "types";

  const controls = uiEl("div", { class: "export__controls" }, [
    exportField(strings.exportPanel.kind, kindSelect),
    exportField(strings.exportPanel.area, roomSelect),
    groupField,
    byRoomField,
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

// Заголовок листа схемы: объект, схема и — когда лист режется по комнате —
// её имя. Иначе распечатка по комнате неотличима от полной.
function exportSchemeTitle(state, scheme) {
  const room = exportRoomName(state.project, exportAreaRoomId());
  return [state.project.name, scheme.name, room].filter(Boolean).join(" · ");
}

// ——— диалог схемы —————————————————————————————————————————————————————

function exportSchemeDialog(api) {
  const { getState, notify } = api;
  const state = getState();
  const scheme = findScheme(state.project, state.schemeId);
  const hint = uiEl("p", { class: "export__hint" });
  // Комната, выбранная раньше, могла остаться без контура на этой схеме —
  // тогда лист берётся целиком, а не молча по пустой рамке.
  if (exportAreaRoomId() && !exportRoomArea(state.project, scheme, exportAreaRoomId())) exportChoice.area = "all";
  // Сколько листов по помещениям даст объект. Ноль — значит, контуров нет
  // нигде: пункт остаётся в списке, но недоступен и говорит почему. Выбор,
  // сохранившийся с прошлого объекта, тоже сбрасывается — иначе кнопка «Все
  // схемы» молча делала бы прежний архив.
  const roomsPlan = allSchemesPlan(state.project, { rooms: true, filter: state.filter });
  if (exportChoice.area === "rooms" && roomsPlan.rooms === 0) exportChoice.area = "all";

  const refreshHint = () => {
    const size = exportAreaSize(state, scheme);
    const line = exportSizeText(size.width, size.height, exportChoice.schemeScale);
    if (!exportByRooms()) {
      hint.textContent = line;
      return;
    }
    // Два десятка листов в высоком разрешении человек должен увидеть числом до
    // того, как нажмёт: счёт готов ещё до открытия окна и рисования не требует.
    const parts = [
      text("exportPanel.roomsPlan", { total: roomsPlan.total, rooms: roomsPlan.rooms }),
      line,
      strings.exportPanel.roomsSingle,
    ];
    if (roomsPlan.missing.length > 0) {
      parts.push(text("exportPanel.roomsMissing", { names: roomsPlan.missing.join(", ") }));
    }
    hint.textContent = parts.join(" · ");
  };

  const controls = uiEl("div", { class: "export__controls" }, [
    exportField(
      strings.exportPanel.area,
      exportSelect(
        [
          { value: "all", label: strings.exportPanel.areaAll },
          { value: "view", label: strings.exportPanel.areaView },
          // Не область, а состав архива: «Все схемы» положит и общие листы, и
          // по листу на помещение. Пункт стоит здесь, потому что заказчик
          // искал его здесь: «в раздел Что выгружаем добавь пункт».
          {
            value: "rooms",
            label: roomsPlan.rooms > 0 ? strings.exportPanel.areaRooms : strings.exportPanel.areaRoomsNone,
            disabled: roomsPlan.rooms === 0,
          },
          // Помещение режет лист по габаритам контура с полями. Комната без
          // контура на этой схеме остаётся в списке, но недоступна — и строка
          // говорит, почему: искать пропавший вариант хуже, чем прочесть причину.
          ...roomsInOrder(state.project).map((room) => {
            const has = Boolean(exportRoomArea(state.project, scheme, room.id));
            return {
              value: "room:" + room.id,
              label: has
                ? text("exportPanel.areaRoom", { name: room.name })
                : text("exportPanel.roomNoOutline", { name: room.name }),
              disabled: !has,
            };
          }),
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
    exportCheck(strings.exportPanel.withRooms, exportChoice.outlines, (on) => {
      exportChoice.outlines = on;
    }),
    exportCheck(strings.exportPanel.withLinks, exportChoice.links, (on) => {
      exportChoice.links = on;
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
    // Подпись, оттащенную далеко от метки, поля не догоняют: о таких говорим
    // до выгрузки — потерянное на бумаге обозначение молчать не должно.
    const { missed } = exportFittedOf(state, scheme);
    if (missed.length > 0) {
      notify(text("exportPanel.labelsOutside", { names: missed.slice(0, 5).join(", ") }), "error");
    }
    try {
      return await schemePng(state.project, scheme, image, {
        area: exportAreaOf(state, scheme),
        scale: exportChoice.schemeScale,
        legend: exportChoice.legend,
        outlines: exportChoice.outlines,
        links: exportChoice.links,
        filter: exportFilterOfSheet(state),
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
            const byRooms = exportByRooms();
            const plan = allSchemesPlan(state.project, { rooms: byRooms, filter: state.filter });
            // Два десятка листов рисуются заметно дольше одного, и молчащая
            // вкладка на этом месте выглядит как зависшая. Строка прогресса —
            // та же, что у упаковки файла проекта.
            const line = uiEl("p", { class: "modal__text", text: strings.exportPanel.busy });
            const busy = uiModal({
              title: strings.exportPanel.busyTitle,
              body: line,
              actions: [],
              dismissable: false,
            });
            try {
              const images = new Map();
              for (const item of schemesInOrder(state.project)) {
                if (!item.imageId || images.has(item.imageId)) continue;
                const blob = await getImage(item.imageId);
                if (blob) images.set(item.imageId, blob);
              }
              const zip = await allSchemesZip(state.project, images, {
                rooms: byRooms,
                scale: exportChoice.schemeScale,
                legend: exportChoice.legend,
                outlines: exportChoice.outlines,
                links: exportChoice.links,
                filter: state.filter,
                onProgress: ({ done, total }) => {
                  line.textContent = text("exportPanel.sheetsProgress", { done, total });
                },
              });
              const name = exportFileName(state.project, strings.exportPanel.schemesSuffix, "zip");
              exportDownload(zip, name);
              notify(
                byRooms
                  ? text("exportPanel.sheetsDone", { total: plan.total, rooms: plan.rooms })
                  : text("exportPanel.schemesDone", { count: plan.schemes }),
                "success",
              );
              // Комната без контура листа не получила — сказать об этом надо
              // после выгрузки тоже: подсказку в окне могли и не читать.
              if (byRooms && plan.missing.length > 0) {
                notify(text("exportPanel.roomsMissing", { names: plan.missing.join(", ") }), "info");
              }
            } finally {
              busy.close();
            }
          }),
      },
    }),
    uiButton(strings.exportPanel.print, {
      on: {
        click: () =>
          guard(async () => {
            const blob = await renderScheme();
            await printView("scheme", { blob, title: exportSchemeTitle(state, scheme) });
          }),
      },
    }),
    uiButton(strings.exportPanel.download, {
      class: "ui-btn ui-btn--accent",
      on: {
        click: () =>
          guard(async () => {
            const blob = await renderScheme();
            const room = exportRoomName(state.project, exportAreaRoomId());
            const name = exportFileName(state.project, room ? scheme.name + " — " + room : scheme.name, "png");
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
