// Окно выбора метки: с фильтром по помещению, значком и обозначением — тем же,
// что на плане. Одно на всю сборку: им выбирают и подчинённые метки для
// «чем управляет», и метку места для единицы оборудования, и связанные с ней.
//
// Отдельный файл, потому что это диалог со своей жизнью: список меток сбоку
// открывает его и получает ответ, а как он устроен внутри — его дело. В самом
// списке этому коду тесно: строка метки и так собирает семь полей.
import { strings, text } from "../strings.js";
import { findMark, findRoom, labelOf, markControlIds, roomsInOrder, schemesInOrder } from "../model.js";
import { shapeIcon } from "../render.js";
import { uiButton, uiEl, uiModal } from "./ui.js";
import { filtersMarkRows } from "./filters.js";

// Кандидаты: метки объекта в том же порядке, что и список сбоку, — схема за
// схемой, внутри по справочнику и номеру. Помещение сужает список: с
// рукописного листа «В3 — на В33 (Т1, Т2, Т3)» видно, что выключатель ищут
// среди светильников своей комнаты.
export function markControlsCandidates(project, excludeId, roomId) {
  const rows = [];
  for (const scheme of schemesInOrder(project)) {
    for (const row of filtersMarkRows(project, scheme.id, { roomId: roomId || null })) {
      if (row.mark.id !== excludeId) rows.push({ ...row, scheme });
    }
  }
  return rows;
}

/**
 * Помещение, с которым окно открывается «для метки».
 *
 * Слова заказчика: «при открытии окна Чем управляет у метки — сразу фильтруй
 * по метке комнаты, для которой выбираем». Случай у него частый: выключатель
 * включает свет в своей же комнате, и выбирать помещение руками каждый раз —
 * лишнее движение.
 *
 * Пустая строка — «Все помещения»: у метки помещения нет, метка не нашлась
 * или помещение успели удалить. Значение только начальное — фильтр остаётся
 * живым, и на «Все помещения» пользователь переключается как раньше.
 */
export function markControlsInitialRoom(project, markId) {
  const mark = markId ? findMark(project, markId) : null;
  if (!mark || !mark.roomId) return "";
  return findRoom(project, mark.roomId) ? mark.roomId : "";
}

/**
 * Окно выбора меток — кирпичами из ui.js: стопка диалогов, Escape и возврат
 * фокуса у них общие.
 * `options`: `{title, hint, chosen: [markId], exclude: markId, multiple,
 * roomId}`, где `roomId` — помещение, на котором фильтр стоит при открытии.
 * Отвечает списком отмеченных меток (в режиме одной — списком из одной) или
 * `null`, если передумали. В режиме одной выбор сразу закрывает окно: лишнее
 * подтверждение там, где выбирают одну строку, только мешает.
 */
export function openMarkPicker(project, options = {}) {
  return new Promise((resolve) => {
    const multiple = options.multiple !== false;
    const excludeId = options.exclude || null;
    const chosen = new Set(Array.isArray(options.chosen) ? options.chosen : []);
    const manySchemes = schemesInOrder(project).length > 1;
    const list = uiEl("div", { class: "controls-pick__list" });
    const note = uiEl("p", { class: "controls-pick__note" });
    const rooms = uiEl("select", {
      class: "ui-select",
      title: strings.controls.room,
      on: { change: () => renderList() },
    });
    rooms.append(uiEl("option", { value: "", text: strings.filters.allRooms }));
    for (const room of roomsInOrder(project)) {
      rooms.append(uiEl("option", { value: room.id, text: room.name }));
    }
    // Начальное помещение ставится до первой отрисовки списка — иначе окно
    // моргнуло бы полным списком и тут же сузило его. Значения без своего
    // пункта select не примет и останется на «Все помещения».
    rooms.value = options.roomId || "";

    function renderNote() {
      note.textContent = multiple ? text("controls.chosen", { count: chosen.size }) : "";
    }

    function markLine(row) {
      const room = row.mark.roomId ? findRoom(project, row.mark.roomId) : null;
      // Где метка стоит: помещение, а для многоэтажного объекта — и схема.
      const where = [room ? room.name : "", manySchemes ? row.scheme.name : ""].filter(Boolean).join(" · ");
      return [
        // Метка узнаётся так же, как на плане: обозначение, цвет, форма.
        shapeIcon(row.style.shape, row.style.color, 20),
        uiEl("span", { class: "controls-pick__label", text: row.label }),
        uiEl("span", { class: "controls-pick__name", text: row.type ? row.type.name : "" }),
        uiEl("span", { class: "controls-pick__room", text: where }),
      ];
    }

    function renderList() {
      const rows = markControlsCandidates(project, excludeId, rooms.value);
      if (rows.length === 0) {
        const others = project.marks.some((item) => item.id !== excludeId);
        list.replaceChildren(
          uiEl("p", { class: "panel__empty", text: others ? strings.controls.nothingFound : strings.controls.empty }),
        );
        return;
      }
      list.replaceChildren(
        ...rows.map((row) => {
          if (!multiple) {
            return uiEl(
              "button",
              {
                class: "controls-pick__row controls-pick__row--one" + (chosen.has(row.mark.id) ? " is-active" : ""),
                type: "button",
                on: { click: () => done([row.mark.id]) },
              },
              markLine(row),
            );
          }
          const box = uiEl("input", { class: "controls-pick__check", type: "checkbox" });
          box.checked = chosen.has(row.mark.id);
          box.addEventListener("change", () => {
            if (box.checked) chosen.add(row.mark.id);
            else chosen.delete(row.mark.id);
            renderNote();
          });
          return uiEl("label", { class: "controls-pick__row" }, [box, ...markLine(row)]);
        }),
      );
    }

    renderList();
    renderNote();
    let modal;
    const done = (value) => {
      modal.close();
      resolve(value);
    };
    const actions = [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })];
    if (multiple) {
      actions.push(
        uiButton(strings.controls.save, {
          class: "ui-btn ui-btn--accent",
          on: { click: () => done([...chosen]) },
        }),
      );
    }
    modal = uiModal({
      title: options.title || strings.controls.room,
      body: uiEl("div", { class: "controls-pick" }, [
        options.hint ? uiEl("p", { class: "modal__hint", text: options.hint }) : null,
        rooms,
        list,
        note,
      ]),
      actions,
      onCancel: () => resolve(null),
    });
  });
}

// «Чем управляет» — тот же выбор, только список берётся у самой метки, а
// фильтр при открытии стоит на её помещении.
//
// Уже отмеченные метки из других помещений фильтр с глаз убирает, но не
// теряет: отмеченное живёт отдельно от списка, счётчик «Отмечено: N» считает
// их все, и «Сохранить связь» возвращает их вместе с новыми.
export function openMarkControlsPicker(project, markId) {
  return openMarkPicker(project, {
    title: text("controls.title", { label: labelOf(project, markId) }),
    hint: strings.controls.hint,
    chosen: markControlIds(findMark(project, markId)),
    exclude: markId,
    multiple: true,
    roomId: markControlsInitialRoom(project, markId),
  });
}
