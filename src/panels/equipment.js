// Оборудование: справочник моделей объекта и планирование, что где стоит.
//
// Заказчик разделил две вещи, и окно держит их рядом, но не путает. Модель —
// товар в справочнике: «Shelly 1PM», одна модель стоит на многих метках, и по
// ней считается закупка. Размещённая единица — «одна штука тут»: модель, метка
// места и связи с другими метками (реле стоит в щите, а связано со
// светильниками и выключателем).
//
// Метку выбирает общее окно выбора из `markControls.js` — второго такого в
// сборке нет: и место, и связи спрашиваются им же.
import { layoutAllows } from "../app.js";
import { strings, text } from "../strings.js";
import {
  addEquipment,
  addEquipmentType,
  addPlacement,
  deleteEquipment,
  deleteEquipmentType,
  deletePlacement,
  equipmentInOrder,
  equipmentTypeTemplate,
  equipmentTypeUsage,
  equipmentTypesInOrder,
  equipmentUsage,
  findEquipment,
  findEquipmentType,
  findMark,
  labelOf,
  placementLinkIds,
  placementsAt,
  placementsInOrder,
  updateEquipment,
  updateEquipmentType,
  updatePlacement,
} from "../model.js";
import { canvasCommit } from "../canvas.js";
import { uiButton, uiConfirm, uiEl, uiIconButton, uiModal } from "./ui.js";
import { openMarkPicker } from "./markControls.js";
import { openEquipmentPicker } from "./equipmentPicker.js";

// Подпись единицы для строки списка меток и для кнопки: модель плюс связи.
export function placementSummary(project, placement) {
  const model = findEquipment(project, placement.equipmentId);
  const links = placementLinkIds(placement)
    .map((id) => labelOf(project, id))
    .filter(Boolean);
  return { name: model ? model.name : "", vendor: model ? model.vendor : "", links };
}

export function openEquipmentWindow(api, options = {}) {
  const markId = options.markId || null;
  const body = uiEl("div", { class: "equip" });

  function project() {
    return api.getState().project;
  }

  function editable() {
    return layoutAllows("editMarks", api.getState().layout);
  }

  function fail(error) {
    api.notify(error && error.message ? error.message : String(error), "error");
    render();
  }

  // Перерисовка приходит подпиской на объект: так окно обновляется и от своей
  // команды, и от чужой — например, от Ctrl+Z, пока оно открыто.
  function commit(build, label) {
    try {
      canvasCommit(project(), build(project()), label);
    } catch (error) {
      fail(error);
    }
  }

  // ——— справочник моделей ———

  function modelRow(item) {
    const used = equipmentUsage(project(), item.id);
    const remove = uiIconButton("trash", {
      class: "ui-btn ui-btn--danger",
      title: used > 0 ? text("errors.equipmentInUse", { name: item.name, count: used }) : strings.equipment.removeModel,
      on: { click: () => removeModel(item) },
    });
    remove.disabled = used > 0;
    return uiEl("div", { class: "equip__row" }, [
      uiEl("input", {
        class: "ui-input equip__name",
        type: "text",
        value: item.name,
        title: strings.equipment.name,
        on: {
          change: (event) =>
            commit((current) => updateEquipment(current, item.id, { name: event.target.value }).project, strings.history.editEquipment),
        },
      }),
      uiEl("input", {
        class: "ui-input",
        type: "text",
        value: item.vendor,
        placeholder: strings.equipment.vendorPlaceholder,
        title: strings.equipment.vendor,
        on: {
          change: (event) =>
            commit((current) => updateEquipment(current, item.id, { vendor: event.target.value }).project, strings.history.editEquipment),
        },
      }),
      uiEl("input", {
        class: "ui-input equip__code",
        type: "text",
        value: item.code,
        placeholder: strings.equipment.codePlaceholder,
        title: strings.equipment.code,
        on: {
          change: (event) =>
            commit((current) => updateEquipment(current, item.id, { code: event.target.value }).project, strings.history.editEquipment),
        },
      }),
      typeSelect(item.typeId, (typeId) =>
        commit((current) => updateEquipment(current, item.id, { typeId }).project, strings.history.editEquipment),
      ),
      uiEl("span", { class: "equip__used", text: text("equipment.used", { count: used }) }),
      remove,
    ]);
  }

  // ——— типы оборудования ———

  // Выбор типа у модели. Пустой тип — законное значение: у моделей, заведённых
  // до появления справочника, типа нет, и заставлять его выбирать не за что.
  function typeSelect(value, onPick) {
    const select = uiEl("select", {
      class: "ui-select",
      title: strings.equipment.type,
      on: { change: (event) => onPick(event.target.value) },
    });
    select.append(uiEl("option", { value: "", text: strings.equipment.typeNone }));
    for (const item of equipmentTypesInOrder(project())) {
      select.append(uiEl("option", { value: item.id, text: item.name }));
    }
    select.value = value && findEquipmentType(project(), value) ? value : "";
    return select;
  }

  function typeRow(item) {
    const used = equipmentTypeUsage(project(), item.id);
    const remove = uiIconButton("trash", {
      class: "ui-btn ui-btn--danger",
      title:
        used > 0
          ? text("errors.equipmentTypeInUse", { name: item.name, count: used })
          : strings.equipment.removeType,
      on: { click: () => removeType(item) },
    });
    remove.disabled = used > 0;
    return uiEl("div", { class: "equip__row" }, [
      uiEl("input", {
        class: "ui-input equip__name",
        type: "text",
        value: item.name,
        title: strings.equipment.typeName,
        on: {
          change: (event) =>
            commit(
              (current) => updateEquipmentType(current, item.id, { name: event.target.value }).project,
              strings.history.editEquipmentType,
            ),
        },
      }),
      uiEl("span", { class: "equip__used", text: text("equipment.typesUsed", { count: used }) }),
      remove,
    ]);
  }

  async function removeType(item) {
    const agreed = await uiConfirm({
      title: strings.equipment.removeTypeTitle,
      message: text("equipment.removeTypeMessage", { name: item.name }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    commit((current) => deleteEquipmentType(current, item.id).project, strings.history.removeEquipmentType);
  }

  function addTypeRow() {
    const name = uiEl("input", {
      class: "ui-input equip__name",
      type: "text",
      placeholder: strings.equipment.typeNamePlaceholder,
      title: strings.equipment.typeName,
    });
    return uiEl("div", { class: "equip__row equip__row--add" }, [
      name,
      uiButton(strings.equipment.addType, {
        class: "ui-btn ui-btn--accent",
        on: {
          click: () =>
            commit((current) => addEquipmentType(current, { name: name.value }).project, strings.history.addEquipmentType),
        },
      }),
    ]);
  }

  // Объект, размеченный до появления типов, открывается с пустым справочником:
  // стартовый набор в него не заезжает сам — правка шаблона до размеченного
  // объекта не доходит никогда. Но и оставлять человека набивать сорок строк
  // руками незачем: кнопка предлагает готовый список, решение за ним.
  function seedTypesRow() {
    return uiEl("div", { class: "equip__row equip__row--add" }, [
      uiEl("span", { class: "equip__used", text: strings.equipment.typesSeedHint }),
      uiButton(strings.equipment.typesSeed, {
        class: "ui-btn ui-btn--accent",
        on: {
          click: () => {
            const seeds = equipmentTypeTemplate();
            commit((current) => {
              let next = current;
              for (const seed of seeds) next = addEquipmentType(next, { name: seed.name }).project;
              return next;
            }, strings.history.seedEquipmentTypes);
            api.notify(text("equipment.typesSeedDone", { count: seeds.length }), "success");
          },
        },
      }),
    ]);
  }

  async function removeModel(item) {
    const agreed = await uiConfirm({
      title: strings.equipment.removeModelTitle,
      message: text("equipment.removeModelMessage", { name: item.name }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    commit((current) => deleteEquipment(current, item.id).project, strings.history.removeEquipment);
  }

  function addModelRow() {
    const name = uiEl("input", {
      class: "ui-input equip__name",
      type: "text",
      placeholder: strings.equipment.namePlaceholder,
      title: strings.equipment.name,
    });
    const vendor = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.equipment.vendorPlaceholder,
      title: strings.equipment.vendor,
    });
    const code = uiEl("input", {
      class: "ui-input equip__code",
      type: "text",
      placeholder: strings.equipment.codePlaceholder,
      title: strings.equipment.code,
    });
    let typeId = "";
    return uiEl("div", { class: "equip__row equip__row--add" }, [
      name,
      vendor,
      code,
      typeSelect("", (value) => {
        typeId = value;
      }),
      uiButton(strings.equipment.addModel, {
        class: "ui-btn ui-btn--accent",
        on: {
          click: () =>
            commit(
              (current) =>
                addEquipment(current, { name: name.value, vendor: vendor.value, code: code.value, typeId }).project,
              strings.history.addEquipment,
            ),
        },
      }),
    ]);
  }

  // ——— размещение ———

  // Модель выбирают окном выбора, а не выпадающим списком. Слова заказчика:
  // «не показывай Справочник моделей, просто выбор, но выбор сделай красивым
  // окном, с фильтрацией по модели, типом и т.д.». Список из сорока моделей в
  // `select` нельзя ни отфильтровать, ни найти в нём по производителю — а
  // именно это и нужно в момент, когда выбирают.
  //
  // Окно одно на всю сборку, как окно выбора метки: и в строке размещения, и
  // в строке добавления спрашивается им же.
  function modelButton(value, title, onPick) {
    const chosen = value ? findEquipment(project(), value) : null;
    const button = uiButton(chosen ? chosen.name : strings.equipmentPicker.choose, {
      class: "ui-btn ui-btn--wide equip__name" + (chosen ? " is-set" : ""),
      title: strings.equipment.name,
      on: {
        click: async () => {
          const picked = await openEquipmentPicker(project(), { activeId: value || null, title });
          if (!picked) return;
          onPick(picked);
        },
      },
    });
    return button;
  }

  async function pickPlace(placement) {
    const chosen = await openMarkPicker(project(), {
      title: text("equipment.placeTitle", { name: placementSummary(project(), placement).name }),
      chosen: [placement.markId],
      multiple: false,
    });
    if (!chosen || chosen.length === 0) return;
    commit((current) => updatePlacement(current, placement.id, { markId: chosen[0] }).project, strings.history.editPlacement);
  }

  async function pickLinks(placement) {
    const chosen = await openMarkPicker(project(), {
      title: text("equipment.linksTitle", { name: placementSummary(project(), placement).name }),
      hint: strings.equipment.linksHint,
      chosen: placementLinkIds(placement),
      exclude: placement.markId,
      multiple: true,
    });
    if (!chosen) return;
    commit((current) => updatePlacement(current, placement.id, { links: chosen }).project, strings.history.editPlacement);
  }

  function placementRow(placement) {
    const summary = placementSummary(project(), placement);
    const place = findMark(project(), placement.markId);
    return uiEl("div", { class: "equip__row" }, [
      modelButton(placement.equipmentId, text("equipment.placeTitle", { name: summary.name }), (picked) =>
        // Модель могли завести прямо в окне выбора: тогда объект берётся
        // оттуда, и оба изменения — новая модель и её подстановка в единицу —
        // ложатся одним шагом истории. Двумя шагами Ctrl+Z сперва отцеплял бы
        // модель, а потом удалял её же.
        commit(
          (current) =>
            updatePlacement(picked.created ? picked.project : current, placement.id, {
              equipmentId: picked.equipmentId,
            }).project,
          picked.created ? strings.history.addEquipment : strings.history.editPlacement,
        ),
      ),
      uiButton(place ? labelOf(project(), placement.markId) : strings.equipment.placeChoose, {
        class: "ui-btn equip__place",
        title: strings.equipment.place,
        on: { click: () => pickPlace(placement) },
      }),
      uiButton(summary.links.length > 0 ? summary.links.join(", ") : strings.equipment.linksEmpty, {
        class: "ui-btn ui-btn--wide equip__links" + (summary.links.length > 0 ? " is-set" : ""),
        title: strings.equipment.links,
        on: { click: () => pickLinks(placement) },
      }),
      uiIconButton("trash", {
        class: "ui-btn ui-btn--danger",
        title: strings.equipment.removePlacement,
        on: {
          click: () =>
            commit((current) => deletePlacement(current, placement.id).project, strings.history.removePlacement),
        },
      }),
    ]);
  }

  // Набранное в строке добавления живёт дольше одной отрисовки. Окно
  // перерисовывается от любой правки объекта — в том числе от своей же, — и
  // выбранная модель с меткой иначе слетали бы на каждый чужой шаг.
  const draft = { equipmentId: "", placeId: markId || "" };

  function addPlacementRow() {
    const modelPick = modelButton(draft.equipmentId, strings.equipmentPicker.choose, (picked) => {
      draft.equipmentId = picked.equipmentId;
      // Модель, заведённая в окне выбора, попадает в справочник сразу, не
      // дожидаясь «Разместить». Человек её завёл — значит, она у него есть; а
      // передумай он размещать, модель осталась бы потерянной вместе с
      // нажатием, которого он не сделал.
      if (picked.created) {
        commit(() => picked.project, strings.history.addEquipment);
        return;
      }
      render();
    });
    const placeButton = uiButton(
      draft.placeId ? labelOf(project(), draft.placeId) : strings.equipment.placeChoose,
      {
        class: "ui-btn equip__place",
        title: strings.equipment.place,
        on: {
          click: async () => {
            const chosen = await openMarkPicker(project(), {
              title: strings.equipment.placeChoose,
              chosen: draft.placeId ? [draft.placeId] : [],
              multiple: false,
            });
            if (!chosen || chosen.length === 0) return;
            draft.placeId = chosen[0];
            placeButton.textContent = labelOf(project(), draft.placeId);
          },
        },
      },
    );
    const add = uiButton(strings.equipment.addPlacement, {
      class: "ui-btn ui-btn--accent",
      title: strings.equipment.addPlacementHint,
      on: {
        click: () => {
          if (!draft.equipmentId) {
            api.notify(strings.equipment.needModel);
            return;
          }
          if (!draft.placeId) {
            api.notify(strings.equipment.addPlacementHint);
            return;
          }
          // Строка добавления чистится до записи, а не после: перерисовка
          // приходит подпиской прямо изнутри `commit`, и очистка следом
          // досталась бы уже мёртвой строке — на экране осталась бы прежняя
          // модель. Следующая единица почти всегда другая, и оставшаяся модель
          // подсовывала бы не ту.
          const chosen = draft.equipmentId;
          draft.equipmentId = "";
          commit(
            (current) => addPlacement(current, { equipmentId: chosen, markId: draft.placeId }).project,
            strings.history.addPlacement,
          );
        },
      },
    });
    return uiEl("div", { class: "equip__row equip__row--add" }, [modelPick, placeButton, add]);
  }

  function render() {
    const current = project();
    if (!current) {
      body.replaceChildren();
      return;
    }
    const models = equipmentInOrder(current);
    const kinds = equipmentTypesInOrder(current);
    // На метке — только её единицы: окно открыто из строки этой метки.
    const placed = markId ? placementsAt(current, markId) : placementsInOrder(current);
    // У метки справочников нет вовсе — ни моделей, ни типов. Слова заказчика:
    // «при нажатии у метки Оборудование — не показывай Справочник моделей,
    // просто выбор». Здесь отвечают на один вопрос: что стоит на этой метке.
    // Модель выбирают окном выбора, а заводят и правят по-прежнему в
    // справочнике объекта — он открывается кнопкой «Оборудование» без метки.
    const catalog = markId
      ? []
      : [
          uiEl("h4", { class: "equip__title", text: strings.equipment.models }),
          ...(models.length > 0
            ? models.map((item) => modelRow(item))
            : [uiEl("p", { class: "panel__empty", text: strings.equipment.modelsEmpty })]),
          addModelRow(),
          uiEl("h4", { class: "equip__title", text: strings.equipment.types }),
          ...(kinds.length > 0
            ? kinds.map((item) => typeRow(item))
            : [uiEl("p", { class: "panel__empty", text: strings.equipment.typesEmpty })]),
          addTypeRow(),
          ...(kinds.length === 0 ? [seedTypesRow()] : []),
        ];
    body.replaceChildren(
      ...catalog,
      uiEl("h4", { class: "equip__title", text: strings.equipment.placed }),
      ...(placed.length > 0
        ? placed.map((placement) => placementRow(placement))
        : [
            uiEl("p", {
              class: "panel__empty",
              text: markId ? strings.equipment.placedEmptyAtMark : strings.equipment.placedEmpty,
            }),
          ]),
      addPlacementRow(),
    );
    // Режим просмотра: окно читается, но ничего не правит — как и список меток.
    if (!editable()) {
      for (const field of body.querySelectorAll("input")) field.readOnly = true;
      for (const field of body.querySelectorAll("select")) field.disabled = true;
      for (const button of body.querySelectorAll("button")) button.disabled = true;
    }
  }

  render();
  const unsubscribe = api.subscribe((state, changed) => {
    if ("project" in changed || "layout" in changed) render();
  });
  const modal = uiModal({
    title: markId ? text("equipment.atMarkTitle", { label: labelOf(project(), markId) }) : strings.equipment.title,
    body,
    actions: [uiButton(strings.dialog.close, { on: { click: () => close() } })],
    onCancel: () => unsubscribe(),
  });
  function close() {
    unsubscribe();
    modal.close();
  }
  return { close };
}
