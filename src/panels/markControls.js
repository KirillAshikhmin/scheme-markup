// Окно «чем управляет»: выбор других меток объекта с фильтром по помещению.
//
// Отдельный файл, потому что это диалог со своей жизнью: список меток сбоку
// открывает его и получает ответ, а как он устроен внутри — его дело. В самом
// списке этому коду тесно: строка метки и так собирает семь полей.
import { strings, text } from "../strings.js";
import { findMark, findRoom, labelOf, markControlIds, roomsInOrder, schemesInOrder } from "../model.js";
import { shapeIcon } from "../render.js";
import { uiButton, uiEl, uiModal } from "./ui.js";
import { filtersMarkRows } from "./filters.js";

// Кандидаты в подчинённые: все метки объекта, кроме самой, в том же порядке,
// что и список сбоку, — схема за схемой, внутри по справочнику и номеру.
// Помещение сужает список: с рукописного листа «В3 — на В33 (Т1, Т2, Т3)»
// видно, что выключатель ищут среди светильников своей комнаты.
export function markControlsCandidates(project, markId, roomId) {
  const rows = [];
  for (const scheme of schemesInOrder(project)) {
    for (const row of filtersMarkRows(project, scheme.id, { roomId: roomId || null })) {
      if (row.mark.id !== markId) rows.push({ ...row, scheme });
    }
  }
  return rows;
}

// Окно выбора — кирпичами из ui.js: стопка диалогов, Escape и возврат фокуса
// у них общие. Отвечает списком отмеченных меток или null, если передумали.
export function openMarkControlsPicker(project, markId) {
  return new Promise((resolve) => {
    const mark = findMark(project, markId);
    const chosen = new Set(markControlIds(mark));
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

    function renderNote() {
      note.textContent = text("controls.chosen", { count: chosen.size });
    }

    function renderList() {
      const rows = markControlsCandidates(project, markId, rooms.value);
      if (rows.length === 0) {
        const others = project.marks.some((item) => item.id !== markId);
        list.replaceChildren(
          uiEl("p", { class: "panel__empty", text: others ? strings.controls.nothingFound : strings.controls.empty }),
        );
        return;
      }
      list.replaceChildren(
        ...rows.map((row) => {
          const box = uiEl("input", { class: "controls-pick__check", type: "checkbox" });
          box.checked = chosen.has(row.mark.id);
          box.addEventListener("change", () => {
            if (box.checked) chosen.add(row.mark.id);
            else chosen.delete(row.mark.id);
            renderNote();
          });
          const room = row.mark.roomId ? findRoom(project, row.mark.roomId) : null;
          // Где метка стоит: помещение, а для многоэтажного объекта — и схема.
          const where = [room ? room.name : "", manySchemes ? row.scheme.name : ""].filter(Boolean).join(" · ");
          return uiEl("label", { class: "controls-pick__row" }, [
            box,
            // Метка узнаётся так же, как на плане: обозначение, цвет, форма.
            shapeIcon(row.style.shape, row.style.color, 20),
            uiEl("span", { class: "controls-pick__label", text: row.label }),
            uiEl("span", { class: "controls-pick__name", text: row.type ? row.type.name : "" }),
            uiEl("span", { class: "controls-pick__room", text: where }),
          ]);
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
    modal = uiModal({
      title: text("controls.title", { label: labelOf(project, markId) }),
      body: uiEl("div", { class: "controls-pick" }, [
        uiEl("p", { class: "modal__hint", text: strings.controls.hint }),
        rooms,
        list,
        note,
      ]),
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(null) } }),
        uiButton(strings.controls.save, {
          class: "ui-btn ui-btn--accent",
          on: { click: () => done([...chosen]) },
        }),
      ],
      onCancel: () => resolve(null),
    });
  });
}
