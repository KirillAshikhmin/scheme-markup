// Окно «Сценарии и журнал» страницы просмотра (таск 02 просмотра; G05).
//
// Заказчик видит, какие сценарии есть у его дома, активны ли они, может
// запустить любой вручную и читает журнал дома строками. Третьим режимом
// страницы это не бывает: в задаче два режима, и окно открывается из шапки.
//
// Окно **только читает объект**: отметка «Активный» показана, а не
// переключается (переключение — шаг истории, то есть правка), правки сценария
// нет вовсе. Ручной запуск (`simScenarioRun`) — действие над запущенным домом,
// объект он не трогает. Список берётся у той же `scenariosListRows`, что рисует
// режим «Сценарии» в «Разметке», а журнал собирает тот же `simJournalMount`:
// второй правды о сценариях в сборке быть не должно.
import { simLibraryMissing, simScenarioRun, simScenarios, simRunning, simWatch } from "../simulation.js";
import { strings, text } from "../strings.js";
import { scenariosListRows } from "./scenarios.js";
import { simJournalMount } from "./simJournal.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

/** Настройка браузера: журнал в окне свёрнут (по умолчанию — нет, он и есть половина окна). */
export const VIEW_JOURNAL_SETTING = "viewJournalCollapsed";

/**
 * Строки списка: `[{id, name, kind, lib, libMissing, active, hung, fault}]` в
 * порядке выполнения. `states` — `simScenarios()` (`[{id, active, running,
 * fault}]`): зависший сценарий показан выключенным, как в режиме «Сценарии».
 *
 * `libMissing` — `simLibraryMissing()`: отпечатки библиотечных скриптов,
 * которые не доехали. Список знает только дом, и без него строка «скрипт не
 * найден» не появилась бы вовсе — а молчать о неработающем сценарии нельзя
 * (G26, ревью ветки F1).
 */
export function viewScenariosRows(project, states, libMissing = null) {
  if (!project) return [];
  const faults = new Map((states || []).filter((item) => item && item.fault).map((item) => [item.id, item.fault]));
  return scenariosListRows(project, { libMissing }, null, faults).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    lib: row.lib,
    libMissing: row.libMissing,
    active: row.active,
    hung: row.hung,
    fault: row.fault || "",
  }));
}

/** Открыть окно. `api` — `panelApi()`: состояние объекта и подписки. */
export function viewScenariosOpen(api) {
  const list = uiEl("ul", { class: "view-scn__list" });
  const journalHost = uiEl("div", { class: "view-scn__journal" });
  const body = uiEl("div", { class: "view-scn" }, [list, journalHost]);
  const journal = simJournalMount(journalHost, api, {
    title: strings.sim.log.title,
    setting: VIEW_JOURNAL_SETTING,
    collapsed: false,
  });

  function drawList() {
    const rows = viewScenariosRows(api.getState().project, simScenarios(), simLibraryMissing());
    if (rows.length === 0) {
      list.replaceChildren(uiEl("li", { class: "view-scn__empty", text: strings.view.scenariosEmpty }));
      return;
    }
    const running = simRunning();
    list.replaceChildren(
      ...rows.map((row) => {
        const run = uiButton(strings.scenarios.list.run, {
          class: "ui-btn ui-btn--primary view-scn__run",
          title: running ? strings.scenarios.list.runHint : strings.scenarios.list.runStopped,
          on: { click: () => simScenarioRun(row.id) },
        });
        run.disabled = !running;
        return uiEl("li", { class: "view-scn__row" + (row.active ? " is-active" : "") }, [
          uiEl("span", { class: "view-scn__name", text: row.name }),
          uiEl("span", { class: "scn-row__kind is-" + row.kind, text: strings.scenarios.list.kinds[row.kind] || "" }),
          // Показана, не переключается: это не кнопка.
          uiEl("span", {
            class: "view-scn__active" + (row.active ? "" : " is-off"),
            text: row.active ? strings.scenarios.list.active : "",
            title: strings.scenarios.list.activeReadOnly,
          }),
          // «Скрипт не найден» — та же строка и та же подсказка, что в режиме
          // «Сценарии» (`strings.scenarioLib.*`): дом идёт без этого сценария,
          // и промолчать об этом нельзя (G26).
          ...(row.libMissing
            ? [
                uiEl("span", {
                  class: "view-scn__fault",
                  text: strings.scenarioLib.missing,
                  title: text("scenarioLib.missingHint", {
                    name: (row.lib && row.lib.name) || row.name,
                    version: (row.lib && row.lib.version) || "",
                  }),
                }),
              ]
            : []),
          ...(row.fault ? [uiEl("span", { class: "view-scn__fault", text: row.fault })] : []),
          run,
        ]);
      }),
    );
  }

  let frame = 0;
  const later = () => {
    if (frame) return;
    const ask = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    frame = ask(() => {
      frame = 0;
      drawList();
      journal.draw();
    });
  };
  const unwatch = simWatch(() => later());
  const stop = () => unwatch();

  let modal = null;
  const close = uiButton(strings.dialog.close, {
    class: "ui-btn ui-btn--accent",
    on: {
      click: () => {
        stop();
        modal.close();
      },
    },
  });
  modal = uiModal({
    title: strings.view.scenarios,
    body,
    actions: [close],
    primary: close,
    onCancel: stop,
  });
  drawList();
  journal.draw();
  return modal;
}
