// Окно выбора модели оборудования: поиск, фильтры по типу и производителю,
// строки с клавиатурой.
//
// Слова заказчика: «при нажатии у метки Оборудование — не показывай Справочник
// моделей, просто выбор, но выбор сделай красивым окном, с фильтрацией по
// модели, типом и т.д.». Человек у метки пришёл выбрать, а не править: в
// справочнике он видел поля ввода, кнопки удаления и чужие модели — всё, что
// на этом шаге только мешает.
//
// Отдельный файл по той же причине, что `markControls.js` и `typePicker.js`:
// это диалог со своей жизнью. Третьего вида окна здесь нет — приёмы взяты у
// уже существующих: поиск сверху, Enter берёт первую строку, стрелка вниз
// уводит в список, Escape и возврат фокуса общие от `uiModal`. Разметка та же
// (`picker`, `picker__list`, `picker__group`, `picker__row`) — своего набора
// классов и своего CSS у окна нет намеренно.
//
// ——— дорога к заведению новой модели ———
//
// Человек часто понимает, что модели ещё нет, ровно в момент выбора. Возвращать
// его в справочник значило бы потерять шаг, ради которого окно и заведено.
// Поэтому строка заведения живёт прямо здесь — ровно тем же приёмом, что в
// окне выбора типа метки: она **появляется только тогда, когда набранного в
// поиске среди моделей нет**, называет то, что будет заведено, и по кнопке
// заводит модель и сразу её выбирает.
//
// Справочником окно от этого не становится, и разница не на словах: заводить
// можно только то, чего нет, — правки чужих моделей, удаления и списка всех
// полей здесь не появляется. Пустой поиск строки заведения не показывает
// вовсе: «Завести» без названия — это и есть справочник.
import { strings, text } from "../strings.js";
import {
  addEquipment,
  equipmentTypesInOrder,
  equipmentVendors,
  findEquipmentType,
  matchEquipmentExactly,
  searchEquipment,
} from "../model.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

// Значение пункта «Без производителя» в фильтре. Один пробел, а не пустая
// строка: пустая уже занята пунктом «Все производители». Совпасть с настоящим
// производителем он не может — у модели тот обрезан по краям (`equipmentText`),
// и одним пробелом быть не бывает.
const PICKER_NO_VENDOR = " ";

// Производитель и артикул в одной строке под названием: по ним модель узнают
// в прайсе, и в списке они нужны рядом, а не вместо названия.
function equipmentPickerAbout(item) {
  return [item.vendor, item.code].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
}

/**
 * Окно выбора модели. Отвечает `{equipmentId, project}` — `project` новый,
 * если модель завели прямо здесь, — или `null`, если передумали.
 *
 * `options`: `{title, activeId}`.
 */
export function openEquipmentPicker(project, options = {}) {
  return new Promise((resolve) => {
    let modal;
    let current = project;
    const done = (result) => {
      modal.close();
      resolve(result || null);
    };

    const list = uiEl("div", { class: "picker__list" });
    const body = uiEl("div", { class: "picker" });
    const error = uiEl("p", { class: "picker__error" });
    const createBox = uiEl("div", { class: "picker__create" });

    const search = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.equipmentPicker.search,
      on: {
        input: () => renderList(),
        keydown: (event) => {
          // Стрелка вниз из поиска — в первую строку списка: дальше по нему
          // ходят стрелками, не хватаясь за мышь.
          if (event.key === "ArrowDown") {
            const first = list.querySelector(".picker__row");
            if (!first) return;
            event.preventDefault();
            first.focus();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = list.querySelector(".picker__row");
          if (first) first.click();
          else if (createBox.firstChild) createModel();
        },
      },
    });

    // Фильтры — те же `ui-select`, что фильтр помещения в окне выбора метки.
    const typeFilter = uiEl("select", {
      class: "ui-select",
      title: strings.equipment.type,
      on: { change: () => renderList() },
    });
    const vendorFilter = uiEl("select", {
      class: "ui-select",
      title: strings.equipment.vendor,
      on: { change: () => renderList() },
    });

    // Список фильтров пересобирается вместе со списком: модель, заведённая
    // прямо здесь, могла принести и новый тип, и нового производителя.
    function renderFilters() {
      const type = typeFilter.value;
      typeFilter.replaceChildren(uiEl("option", { value: "", text: strings.equipmentPicker.anyType }));
      for (const item of equipmentTypesInOrder(current)) {
        typeFilter.append(uiEl("option", { value: item.id, text: item.name }));
      }
      typeFilter.value = type;

      const vendor = vendorFilter.value;
      vendorFilter.replaceChildren(uiEl("option", { value: "", text: strings.equipmentPicker.anyVendor }));
      for (const name of equipmentVendors(current)) {
        vendorFilter.append(uiEl("option", { value: name, text: name }));
      }
      // Модели без производителя отбираются отдельным пунктом: иначе найти их
      // в объекте, где у остальных производитель заполнен, было бы нечем.
      vendorFilter.append(uiEl("option", { value: PICKER_NO_VENDOR, text: strings.equipmentPicker.noVendor }));
      vendorFilter.value = vendor;
    }

    function createModel() {
      const name = search.value.trim();
      if (!name) return;
      try {
        const result = addEquipment(current, {
          name,
          vendor: createVendor ? createVendor.value : "",
          code: createCode ? createCode.value : "",
          typeId: createType ? createType.value : "",
        });
        done({ equipmentId: result.equipment.id, project: result.project, created: true });
      } catch (failure) {
        error.textContent = failure.message;
      }
    }

    let createVendor = null;
    let createCode = null;
    let createType = null;

    function renderCreate(query) {
      createBox.replaceChildren();
      error.textContent = "";
      // Заводить нечего: строка пуста или такая модель уже есть — она стоит
      // первой в списке, и Enter берёт именно её.
      if (!query || matchEquipmentExactly(current, query)) return;
      createVendor = uiEl("input", { class: "ui-input", type: "text", placeholder: strings.equipment.vendorPlaceholder });
      createCode = uiEl("input", { class: "ui-input", type: "text", placeholder: strings.equipment.codePlaceholder });
      createType = uiEl(
        "select",
        { class: "ui-select" },
        [
          uiEl("option", { value: "", text: strings.equipment.typeNone }),
          ...equipmentTypesInOrder(current).map((item) => uiEl("option", { value: item.id, text: item.name })),
        ],
      );
      // Тип из фильтра подставляется в новую модель: если человек сузил список
      // до «Реле 2 канала» и не нашёл свою, она почти наверняка того же типа.
      createType.value = typeFilter.value || "";
      createBox.append(
        uiEl("p", { class: "picker__createTitle", text: text("equipmentPicker.createTitle", { name: query }) }),
        uiEl("label", { class: "picker__field" }, [
          uiEl("span", { text: strings.equipmentPicker.createType }),
          createType,
        ]),
        uiEl("label", { class: "picker__field" }, [
          uiEl("span", { text: strings.equipmentPicker.createVendor }),
          createVendor,
        ]),
        uiEl("label", { class: "picker__field" }, [
          uiEl("span", { text: strings.equipmentPicker.createCode }),
          createCode,
        ]),
        uiButton(strings.equipmentPicker.create, { class: "ui-btn ui-btn--accent", on: { click: createModel } }),
      );
    }

    function modelRow(item) {
      const kind = findEquipmentType(current, item.typeId);
      const about = equipmentPickerAbout(item);
      return uiEl(
        "button",
        {
          class: "picker__row" + (item.id === options.activeId ? " is-active" : ""),
          type: "button",
          title: [item.name, kind ? kind.name : "", about].filter(Boolean).join(" · "),
          on: { click: () => done({ equipmentId: item.id, project: current }) },
        },
        [
          uiEl("span", { class: "picker__code", text: item.name }),
          uiEl("span", { class: "picker__name", text: about }),
        ],
      );
    }

    // Группировка по типу: моделей в объекте немного, но лежат они кучей — с
    // заголовком видно, что реле кончились и пошли блоки питания. Порядок
    // групп — порядок справочника (`equipmentTypesInOrder`), а не порядок
    // заведения моделей: иначе один тип выходил бы двумя заголовками, стоило
    // завести реле, блок питания и снова реле. Модели без типа идут последней
    // группой: спрятать их было бы хуже, чем показать отдельно.
    //
    // Группы только при пустом поиске и без фильтра по типу. Поиск ранжирует
    // список — точное совпадение первым, и его берёт Enter; разложи такой
    // список по группам, и первой строкой оказалась бы не та. Фильтр по типу
    // заголовок и вовсе повторял бы: он уже стоит в самом фильтре.
    function renderList() {
      renderFilters();
      const query = search.value.trim();
      const vendorPick = vendorFilter.value;
      const rows = searchEquipment(current, {
        query,
        typeId: typeFilter.value,
        vendor: vendorPick === PICKER_NO_VENDOR ? "" : vendorPick,
        noVendor: vendorPick === PICKER_NO_VENDOR,
      });
      list.replaceChildren();
      if (rows.length === 0) {
        const hasAny = (current.equipment || []).length > 0;
        list.append(
          uiEl("p", {
            class: "panel__empty",
            text: hasAny ? strings.equipmentPicker.empty : strings.equipmentPicker.emptyAll,
          }),
        );
        renderCreate(query);
        return;
      }
      if (!query && typeFilter.value === "") {
        const byType = new Map();
        for (const item of rows) {
          const key = findEquipmentType(current, item.typeId) ? item.typeId : "";
          if (!byType.has(key)) byType.set(key, []);
          byType.get(key).push(item);
        }
        for (const kind of [...equipmentTypesInOrder(current), null]) {
          const key = kind ? kind.id : "";
          const group = byType.get(key);
          if (!group || group.length === 0) continue;
          list.append(
            uiEl("div", { class: "picker__group", text: kind ? kind.name : strings.equipment.typeNone }),
          );
          for (const item of group) list.append(modelRow(item));
        }
      } else {
        for (const item of rows) list.append(modelRow(item));
      }
      renderCreate(query);
    }

    // Клавиатура по списку. Enter здесь обязателен свой: основное действие
    // диалога — «Отмена», и оно сработало бы раньше, чем браузер превратит
    // Enter в клик по строке, — то есть выбор терялся бы.
    list.addEventListener("keydown", (event) => {
      const row = event.target;
      if (!row || !row.classList || !row.classList.contains("picker__row")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        row.click();
        return;
      }
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const rows = [...list.querySelectorAll(".picker__row")];
      const next = rows[Math.min(rows.length - 1, Math.max(0, rows.indexOf(row) + step))];
      if (next) next.focus();
    });

    renderList();
    body.replaceChildren(
      search,
      uiEl("div", { class: "picker__field" }, [typeFilter, vendorFilter]),
      list,
      createBox,
      error,
    );
    modal = uiModal({
      title: options.title || strings.equipmentPicker.choose,
      body,
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      onCancel: () => resolve(null),
    });
    search.focus();
  });
}
