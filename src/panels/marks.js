// Список меток схемы: обозначение, помещение, расположение и обозначение из
// оригинального проекта — правятся прямо в строке.
//
// Почему список, а не карточка метки: заказчик заполняет «Расположение» и
// «В оригинальной схеме» не в момент постановки, а потом, разом, по списку.
// Поэтому правка здесь на месте, а отдельного окна у метки нет вовсе.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import {
  MARK_DIMENSION_FIELDS,
  MARK_NUMBER_MAX,
  compactAllNumbers,
  findMark,
  findRoom,
  labelOf,
  markControlIds,
  markControls,
  markDimensions,
  markRoomManual,
  placementsAt,
  findScheme,
  repeatedNumbers,
  roomsInOrder,
  schemesInOrder,
  setMarkControls,
  setMarkDimensions,
  setMarkNumber,
  styleOf,
  typesInOrder,
  updateMark,
} from "../model.js";
import { planToScreen, shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { uiButton, uiEl, uiModal, uiPrompt } from "./ui.js";
import { filtersBox, filtersMarkRows } from "./filters.js";
import { openMarkControlsPicker } from "./markControls.js";
import { openEquipmentWindow } from "./equipment.js";
import { markSizesSummary, openMarkSizesPicker } from "./markSizes.js";
import { roomsEnsure } from "./rooms.js";
// Строки замен считает справочник — там же, где их считает уплотнение по
// одному типу. Второй нумерации в сборке быть не должно: окно обещало бы одно,
// а команда делала другое.
import { typesCompactPreview, typesCompactSignature } from "./types.js";

const MARKS_NEW_ROOM = "--new-room--";
// «По контуру» — метка отдана автоматике: помещение подставляется по контуру
// на схеме. Любой другой выбор в этом поле — ручная правка, и она главнее:
// такую метку автоматика больше не трогает.
const MARKS_AUTO_ROOM = "--auto-room--";

// Холст подводится к метке переводом координат из render.js: доли плана в
// пиксели экрана здесь руками не пересчитываются.
// Подводит холст к метке. Наружу — потому что тем же занят поиск в шапке:
// найденная метка должна оказаться на виду, а не просто выделиться.
export function marksCenteredView(scheme, mark, view) {
  const host = document.getElementById(PANEL_IDS.canvas);
  if (!host || !host.clientWidth || !host.clientHeight) return view;
  const local = planToScreen(mark.points[0], scheme, { ...view, offsetX: 0, offsetY: 0 });
  return { ...view, offsetX: host.clientWidth / 2 - local.x, offsetY: host.clientHeight / 2 - local.y };
}

// Кто кем управляет — одним проходом по объекту: спрашивать модель на каждую
// строку значило бы пересортировать все метки полтысячи раз.
export function marksControllerIndex(project) {
  const index = new Map();
  if (!project) return index;
  for (const item of project.marks) {
    for (const id of markControlIds(item)) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(labelOf(project, item.id));
    }
  }
  return index;
}

// Зазор у прижатой к кромке строки: по нему видно, что список прокручен, а не
// кончился, и закруглённый угол строки не режется краем.
export const MARKS_SCROLL_GAP = 6;
// Выделение пришло со схемы: пользователь смотрел на план, строку в списке ему
// надо найти глазами — она встаёт вверху видимой части.
export const MARKS_ALIGN_TOP = "top";
// Выделение пришло кликом по самой строке: она уже под курсором, и двигать её
// незачем. Прокрутка включается, только если раскрытая карточка не поместилась,
// и тогда она минимальна — ровно до видимой нижней границы.
export const MARKS_ALIGN_LEAST = "least";

/**
 * Куда прокрутить список после смены выделения.
 *
 * Заказчик поправил первую попытку дословно: «скроллится список должен так,
 * что бы метка показывалась целиком сверху, а позиция её не должна меняться»
 * — и отдельно про источник: «при чём при выделении на схеме только, а при
 * ручном выделении не поднимай вверх, только если развёрнутый вид метки
 * уходит за пределы экрана, то подними чуть выше, что бы поместился… Короче
 * что бы при выделении вся развёрнутая метка была на экране».
 *
 * Порядок строк при этом не трогается вовсе: двигается только прокрутка.
 *
 * `row` — положение строки внутри содержимого списка (`top` от его начала,
 * `height` — вся высота, у выделенной она раскрыта и высока). `area` — что
 * сейчас прокручено (`scrollTop`), высота ящика (`clientHeight`), всё
 * содержимое (`scrollHeight`) и **накладки**: `headInset` — сколько сверху
 * занимает прилипший блок фильтров, `footInset` — сколько снизу занимает
 * прилипшая кнопка смыкания. Обе непрозрачные и прокруткой не убираются, так
 * что видно строки только в полосе между ними; считать «видимым» то, что под
 * ними, — значит честно прокрутить строку под фильтры и оставить её там.
 * `align` — откуда пришло выделение.
 *
 * Случаи, ради которых это считается здесь, а не отдаётся `scrollIntoView`
 * (он про накладки не знает вовсе):
 *
 * — **Строка выше полосы** (раскрытая карточка со связями, размерами и
 *   оборудованием в невысоком окне). Целиком её не показать никакой
 *   прокруткой, поэтому зазор снимается и верх подводится к нижней кромке
 *   фильтров: читать сверху вниз естественнее, чем видеть хвост. Одинаково
 *   для обоих источников — это и есть «подними чуть выше, чтобы поместился»,
 *   доведённое до предела.
 *
 * — **Выделение в списке, карточка видна целиком.** Не двигаем ничего.
 *
 * — **Выделение в списке, карточка вылезла вниз** (свёрнутая строка была
 *   видна, раскрытая — уже нет). Опускаем ровно до её нижней границы.
 *
 * — **Последние метки списка.** Прокрутить их к верху нельзя — снизу
 *   кончается содержимое. Упираемся в конец и стоим: отыгрывать назад нечем,
 *   а строка там и так видна целиком.
 */
export function marksScrollTop(row, area, align = MARKS_ALIGN_TOP) {
  const head = area.headInset || 0;
  const foot = area.footInset || 0;
  const limit = Math.max(0, (area.scrollHeight || 0) - (area.clientHeight || 0));
  const fit = (value) => Math.min(Math.max(0, value), limit);
  const now = fit(area.scrollTop || 0);
  // Полоса, в которой строку действительно видно.
  const strip = area.clientHeight - head - foot;
  if (row.height > strip) return fit(row.top - head);
  const top = fit(row.top - head - MARKS_SCROLL_GAP);
  if (align !== MARKS_ALIGN_LEAST) return top;
  if (row.top >= now + head && row.top + row.height <= now + area.clientHeight - foot) return now;
  // Ушла вверх — подводим верх, ушла вниз — низ. И там и там минимально.
  if (row.top < now + head) return top;
  return fit(row.top + row.height + MARKS_SCROLL_GAP - area.clientHeight + foot);
}

// Кто из предков строки прокручивается. Своего прокручиваемого ящика у списка
// нет: прокрутку держит точка монтирования панели, а на телефоне — лист, в
// который её кладут. Поэтому не имя узла, а первый предок, которому есть что
// прокручивать.
function marksScrollBox(node) {
  for (let box = node.parentElement; box; box = box.parentElement) {
    const overflow = getComputedStyle(box).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && box.scrollHeight > box.clientHeight) return box;
  }
  return null;
}

// Прокрутка к строке. Не `scrollIntoView`: он норовит подвинуть заодно всех
// прокручиваемых предков — уехала бы вся панель, — и не умеет ни зазора, ни
// оговорки про строку выше видимой части, ни разницы между выделением на
// схеме и в списке. Куда именно прокрутить, считает `marksScrollTop`, и это
// единственное место, где её ответ доезжает до экрана.
function marksScrollToRow(node, align, chrome) {
  const box = marksScrollBox(node);
  if (!box) return;
  const row = node.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  // Накладки меряем по месту, а не по числам из стилей: прилипший блок
  // сдвинут отрицательным отступом, у кнопки смыкания свой, и оба меняются
  // от раскладки. Сколько ящика закрыто — видно по самим прямоугольникам.
  const cover = (element, side) => {
    if (!element || element.hidden) return 0;
    const rect = element.getBoundingClientRect();
    if (rect.height === 0) return 0;
    return Math.max(0, side === "head" ? rect.bottom - frame.top : frame.bottom - rect.top);
  };
  // Положение строки в содержимом: от верха видимой части плюс то, что уже
  // прокручено. `clientTop` — рамка ящика, она в счёт содержимого не идёт.
  const top = row.top - frame.top - box.clientTop + box.scrollTop;
  box.scrollTop = marksScrollTop(
    { top, height: row.height },
    {
      scrollTop: box.scrollTop,
      clientHeight: box.clientHeight,
      scrollHeight: box.scrollHeight,
      headInset: cover(chrome && chrome.head, "head"),
      footInset: cover(chrome && chrome.foot, "foot"),
    },
    align,
  );
}

// Что показывает строка списка. Свёрнутая — ровно то, что просил заказчик:
// значок и обозначение (плюс отметка повтора номера: три строки «Т1» подряд
// иначе выглядят ошибкой). Раскрытая — прежний вид со всеми полями.
// Решение о полях принимается здесь, а не в разметке: «в модели полей нет»
// означает «в строке их не будет», и проверить это можно без браузера.
export function marksRowModel(project, row, options = {}) {
  const mark = row.mark;
  const repeat = options.repeat > 1 ? options.repeat : 0;
  const head = {
    id: mark.id,
    open: Boolean(options.open),
    label: row.label,
    code: row.type ? row.type.code : "?",
    style: row.style,
    typeName: row.type ? row.type.name : "",
    repeat,
    fields: null,
  };
  if (!head.open) return head;
  const controllers = options.controllers instanceof Map ? options.controllers : new Map();
  head.fields = {
    number: mark.number,
    equipment: placementsAt(project, mark.id).length,
    roomId: mark.roomId || null,
    roomManual: markRoomManual(mark),
    location: mark.location || "",
    original: mark.original || "",
    // Размеры — одной строкой: «Д 600 · Ш 400 · В 900 мм» или пусто, если не
    // задан ни один. По ней кнопка и говорит, заданы ли они, не открывая окна.
    sizes: markSizesSummary(mark),
    controls: markControls(project, mark.id).map((item) => labelOf(project, item.id)),
    controlledBy: controllers.get(mark.id) || [],
  };
  return head;
}

/**
 * План уплотнения по всему объекту: по группе на тип, внутри — строки
 * «было → стало» того же вида, что в окне одиночного уплотнения. Типы без дыр
 * в план не попадают: на объекте с двадцатью типами список из сотни строк, где
 * значимы три, не читают.
 *
 * Считается по исходному объекту потипно, и это сходится с `compactAllNumbers`:
 * номера каждого типа зависят только от меток этого типа, а их уплотнение
 * соседнего типа не трогает.
 */
export function marksCompactPlan(project) {
  if (!project) return [];
  const plan = [];
  for (const { types } of typesInOrder(project)) {
    for (const type of types) {
      const preview = typesCompactPreview(project, type.id);
      if (preview.changes.length === 0) continue;
      plan.push({ typeId: type.id, code: type.code, name: type.name, rows: preview.rows, changes: preview.changes });
    }
  }
  return plan;
}

// Подпись плана: по ней окно и применение договариваются, что речь об одном и
// том же наборе замен. Тот же приём, что у одиночного уплотнения.
export function marksCompactSignature(plan) {
  return plan.map((group) => group.typeId + "=" + typesCompactSignature(group)).join("//");
}

export function marksCompactTotals(plan) {
  return { types: plan.length, changes: plan.reduce((sum, group) => sum + group.changes.length, 0) };
}

// Уплотнение разрушающее (ADR 003): распечатка на руках у монтажника после
// него начинает врать. Поэтому окно показывает замены целиком, типами, и
// говорит о цене — подтверждение здесь часть команды, а не украшение.
function openMarksCompactAll(plan, { stale } = {}) {
  return new Promise((resolve) => {
    let modal;
    const done = (value) => {
      modal.close();
      resolve(value);
    };
    const totals = marksCompactTotals(plan);
    const groups = plan.map((group) =>
      uiEl("div", { class: "compact__group" }, [
        uiEl("p", {
          class: "compact__groupTitle",
          text: text("marks.compactAllGroup", { code: group.code, name: group.name }),
        }),
        uiEl(
          "div",
          { class: "compact__rows" },
          group.rows.map((row) =>
            uiEl("div", { class: "compact__row" + (row.from === row.to ? " is-same" : "") }, [
              uiEl("span", { class: "compact__label", text: row.fromLabel }),
              uiEl("span", { class: "compact__arrow", text: "→" }),
              uiEl("span", { class: "compact__label", text: row.toLabel }),
              row.count > 1
                ? uiEl("span", { class: "compact__repeat", text: text("dictionary.compactRepeat", { count: row.count }) })
                : null,
            ]),
          ),
        ),
      ]),
    );
    modal = uiModal({
      title: strings.marks.compactAllTitle,
      body: uiEl("div", { class: "compact compact--all" }, [
        stale ? uiEl("p", { class: "compact__warning", text: strings.dictionary.compactStale }) : null,
        uiEl("p", {
          class: "modal__text",
          text: text("marks.compactAllSummary", { count: totals.changes, types: totals.types }),
        }),
        ...groups,
        uiEl("p", { class: "compact__warning", text: strings.dictionary.compactWarning }),
      ]),
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(false) } }),
        uiButton(strings.dictionary.compactApply, {
          class: "ui-btn ui-btn--danger",
          on: { click: () => done(true) },
        }),
      ],
      onCancel: () => resolve(false),
    });
  });
}

function mountMarksPanel(host, api) {
  const { getState, setState, notify } = api;
  const filters = filtersBox(api);
  const list = uiEl("div", { class: "marks" });
  const count = uiEl("p", { class: "marks__count" });
  // Смыкание номеров — под списком, как просил заказчик: команда про весь
  // объект, а не про открытую схему, и место ей после списка, а не среди
  // фильтров. Уплотнение по одному типу осталось в справочнике.
  const compactButton = uiButton(strings.marks.compactAll, {
    class: "ui-btn ui-btn--wide",
    title: strings.marks.compactAllHint,
    on: { click: () => compactAll() },
  });
  const foot = uiEl("div", { class: "marks__foot" }, [compactButton]);
  // Фильтры сверху и кнопка смыкания снизу прилипшие и непрозрачные: они
  // закрывают собой часть списка, и прокрутка обязана это знать — иначе
  // подведённая строка уезжает под фильтры.
  const top = uiEl("div", { class: "marks__top" }, [filters.node, count]);
  host.replaceChildren(top, list, foot);
  // Пока курсор стоит в текстовом поле строки, список не пересобирается: иначе
  // буква, набранная в «Расположении», выбрасывала бы фокус после каждой правки.
  // Поле поиска сюда не входит: оно живёт над списком, и набор в нём обязан
  // перестраивать список по ходу — ради этого он и набирается.
  let pending = false;
  let shownSelection = "";
  // Какая метка выделена кликом по своей же строке. Источник выделения знает
  // только эта панель: наружу, в состояние сеанса, он не выносится — холсту,
  // поиску и предупреждениям до него дела нет, а нужен он ровно одному месту,
  // прокрутке. Хранится именно метка, а не признак: перерисовка могла
  // отложиться (пользователь печатал), и голый признак достался бы чужому,
  // пришедшему со схемы выделению — оно бы тогда не подвелось к верху.
  let clickedRow = null;

  // Номер правится числовым полем — оно тоже держит список от пересборки,
  // иначе набранная цифра выбрасывала бы курсор из поля.
  function typing() {
    const active = document.activeElement;
    if (!active || !list.contains(active) || active.tagName !== "INPUT") return false;
    return active.type === "text" || active.type === "number";
  }

  function fail(error) {
    notify(error && error.message ? error.message : String(error), "error");
  }

  function selectMark(markId) {
    const state = getState();
    const scheme = state.project ? findScheme(state.project, state.schemeId) : null;
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!scheme || !mark) return;
    // Выделение из самого списка: строка уже под пальцем, выдёргивать её
    // наверх нельзя — уедет из-под курсора.
    clickedRow = markId;
    setState({ selectedMarkIds: [markId], view: marksCenteredView(scheme, mark, state.view) });
  }

  // Уплотнение по всему объекту. Считает и применяет модель
  // (`compactAllNumbers`) — одним вызовом, поэтому и шаг истории один: отмена
  // возвращает весь набор замен целиком, а не тип за типом.
  async function compactAll() {
    const state = getState();
    if (!state.project) {
      notify(strings.marks.compactAllNoProject, "info");
      return;
    }
    let plan = marksCompactPlan(getState().project);
    let stale = false;
    // Пока окно висит открытым, объект могли поменять — поставить метку,
    // вернуть номера чужим Ctrl+Z. Применяем по свежему объекту, но молча
    // подменить одобренный список нельзя: разошлось — показываем новый и
    // спрашиваем заново.
    for (;;) {
      if (plan.length === 0) {
        notify(strings.marks.compactAllNothing, "info");
        return;
      }
      const agreed = await openMarksCompactAll(plan, { stale });
      if (!agreed) return;
      const current = getState().project;
      if (!current) return;
      const fresh = marksCompactPlan(current);
      if (marksCompactSignature(fresh) === marksCompactSignature(plan)) {
        const result = compactAllNumbers(current);
        if (result.project !== current) canvasCommit(current, result.project, strings.history.compactAll);
        return;
      }
      plan = fresh;
      stale = true;
    }
  }

  function setField(markId, field, value) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    const next = value.trim();
    if ((mark[field] || "") === next) return;
    try {
      canvasCommit(state.project, updateMark(state.project, markId, { [field]: next }).project, strings.history.markField);
    } catch (error) {
      fail(error);
    }
  }

  // Номер метки ставится руками: несколько одинаковых светильников одной группы
  // носят один номер. Повтор модель разрешает и помечает предупреждением —
  // здесь он только доезжает до истории одним шагом отмены.
  function setNumber(markId, value) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    try {
      const next = setMarkNumber(state.project, markId, value);
      if (next.project === state.project) return;
      canvasCommit(state.project, next.project, strings.history.markNumber);
    } catch (error) {
      fail(error);
      render();
    }
  }

  // Комната заводится по ходу: новое название добавляется в справочник объекта
  // и тем же шагом истории проставляется метке.
  function setRoom(markId, name) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    try {
      const ensured = roomsEnsure(state.project, name);
      const roomId = ensured.room ? ensured.room.id : null;
      if (roomId === (mark.roomId || null) && markRoomManual(mark) && ensured.project === state.project) return;
      canvasCommit(
        state.project,
        updateMark(ensured.project, markId, { roomId, roomManual: true }).project,
        strings.history.markRoom,
      );
    } catch (error) {
      fail(error);
      render();
    }
  }

  // Возврат метки автоматике: снимаем признак ручной правки, а помещение
  // подставит по контуру canvasCommit — тем же шагом истории.
  function setAutoRoom(markId) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark || !markRoomManual(mark)) return;
    try {
      canvasCommit(
        state.project,
        updateMark(state.project, markId, { roomManual: false }).project,
        strings.history.markRoomAuto,
      );
    } catch (error) {
      fail(error);
      render();
    }
  }

  // Пока окно открыто, объект мог уехать (отмена, чужая правка): список
  // отмеченного сверяется со свежим снимком, прежде чем стать шагом истории.
  async function editControls(markId) {
    const state = getState();
    if (!state.project || !layoutAllows("editMarks", state.layout)) return;
    const picked = await openMarkControlsPicker(state.project, markId);
    if (!picked) return;
    const fresh = getState();
    if (!fresh.project || !findMark(fresh.project, markId)) return;
    try {
      const alive = picked.filter((id) => findMark(fresh.project, id));
      const next = setMarkControls(fresh.project, markId, alive);
      canvasCommit(fresh.project, next.project, strings.history.markControls);
    } catch (error) {
      fail(error);
    }
  }

  // Размеры метки правятся в своём окне и сохраняются одним шагом истории.
  // Пока окно открыто, объект мог уехать — как и у связей, ответ кладётся на
  // свежий снимок, а не на тот, с которым окно открывали.
  async function editSizes(markId) {
    const state = getState();
    if (!state.project || !layoutAllows("editMarks", state.layout)) return;
    const picked = await openMarkSizesPicker(state.project, markId);
    if (!picked) return;
    const fresh = getState();
    const mark = fresh.project ? findMark(fresh.project, markId) : null;
    if (!mark) return;
    // Окно закрыли, ничего не изменив: шага истории быть не должно — иначе
    // Ctrl+Z отменял бы пустоту.
    const before = markDimensions(mark);
    if (MARK_DIMENSION_FIELDS.every((field) => before[field] === picked[field])) return;
    try {
      canvasCommit(fresh.project, setMarkDimensions(fresh.project, markId, picked).project, strings.history.markSizes);
    } catch (error) {
      fail(error);
    }
  }

  async function askNewRoom(markId) {
    const name = await uiPrompt({ title: strings.rooms.newTitle, placeholder: strings.rooms.namePlaceholder });
    if (!name) {
      render();
      return;
    }
    setRoom(markId, name);
  }

  function roomField(state, mark) {
    const manual = markRoomManual(mark);
    const select = uiEl("select", {
      class: "ui-select marks__room" + (manual ? " is-manual" : ""),
      title: manual ? strings.marks.roomManual : strings.marks.roomAuto,
    });
    const auto = mark.roomId ? findRoom(state.project, mark.roomId) : null;
    select.append(
      uiEl("option", {
        value: MARKS_AUTO_ROOM,
        text: auto ? text("rooms.autoOf", { name: auto.name }) : strings.rooms.auto,
      }),
    );
    select.append(uiEl("option", { value: "", text: strings.rooms.none }));
    for (const room of roomsInOrder(state.project)) {
      select.append(uiEl("option", { value: room.id, text: room.name }));
    }
    select.append(uiEl("option", { value: MARKS_NEW_ROOM, text: strings.rooms.newRoom }));
    select.value = manual ? mark.roomId || "" : MARKS_AUTO_ROOM;
    select.addEventListener("change", () => {
      if (select.value === MARKS_NEW_ROOM) {
        askNewRoom(mark.id);
        return;
      }
      if (select.value === MARKS_AUTO_ROOM) {
        setAutoRoom(mark.id);
        return;
      }
      const room = select.value ? roomsInOrder(state.project).find((item) => item.id === select.value) : null;
      setRoom(mark.id, room ? room.name : "");
    });
    return select;
  }

  // Раскрыта та метка, что выделена: клик по строке и клик по метке на плане
  // — один и тот же выбор, и показывать они должны одно и то же. Поэтому
  // отдельного «раскрытого» состояния нет: одно выделение на список и холст.
  function markRow(state, row, selected, repeats, controllers) {
    const mark = row.mark;
    const view = marksRowModel(state.project, row, {
      open: selected,
      repeat: repeats.get(mark.id) || 0,
      controllers,
    });
    const badge =
      view.repeat > 0
        ? uiEl("span", {
            class: "mark-row__repeat",
            text: text("marks.repeatBadge", { count: view.repeat }),
            title: text("problems.repeatedNumber", { label: view.label, count: view.repeat }),
          })
        : null;
    // Свёрнутая строка — значок и обозначение: ровно то, по чему метку ищут
    // глазами. Полей в ней нет и в разметке: при полусотне меток это ещё и
    // полсотни неподнятых полей ввода.
    const head = view.fields
      ? uiEl("div", { class: "mark-row__head" }, [
          // Галочка раскрытия — одна и та же в обоих видах: по ней видно,
          // свёрнута строка или раскрыта, и куда нажать.
          uiEl("span", { class: "mark-row__toggle" }),
          shapeIcon(view.style.shape, view.style.color, 20),
          // Код типа стоит там же, где в свёрнутой строке, — на раскрытии
          // значок и код остаются на месте, меняется только номер: он
          // становится полем правки.
          uiEl("span", { class: "mark-row__label", text: view.code }),
          uiEl("input", {
            class: "ui-input mark-row__number",
            type: "number",
            value: String(view.fields.number),
            title: strings.marks.number,
            attrs: { min: "1", max: String(MARK_NUMBER_MAX), step: "1" },
            on: { change: (event) => setNumber(mark.id, event.target.value) },
          }),
          badge,
          // Название типа — второй строкой головы и приглушённо: по значку тип
          // угадывается не всегда, а в справочнике легко заводятся два похожих.
          // Подсказкой — оно же целиком: в узкой панели длинное имя обрезается.
          uiEl("span", { class: "mark-row__type", text: view.typeName, title: view.typeName }),
        ])
      : uiEl("div", { class: "mark-row__head" }, [
          uiEl("span", { class: "mark-row__toggle" }),
          shapeIcon(view.style.shape, view.style.color, 20),
          uiEl("span", { class: "mark-row__label", text: view.label }),
          badge,
        ]);
    // Оборудование на этой метке: своё окно планирования, открытое сразу на ней.
    const equipmentButton = view.fields
      ? uiButton(
          view.fields.equipment > 0
            ? text("equipment.count", { count: view.fields.equipment })
            : strings.equipment.open,
          {
            class: "ui-btn ui-btn--wide mark-row__equipment" + (view.fields.equipment > 0 ? " is-set" : ""),
            title: strings.equipment.onMark,
            on: { click: () => openEquipmentWindow(api, { markId: mark.id }) },
          },
        )
      : null;
    const controlsButton = view.fields
      ? uiButton(
          view.fields.controls.length > 0
            ? text("marks.controlsOf", { labels: view.fields.controls.join(", ") })
            : strings.marks.controls,
          {
            class: "ui-btn ui-btn--wide mark-row__controls" + (view.fields.controls.length > 0 ? " is-set" : ""),
            title: strings.marks.controlsTitle,
            on: { click: () => editControls(mark.id) },
          },
        )
      : null;
    // Размеры метки: третья кнопка того же ряда. Заданные она показывает
    // собой — «Д 600 · Ш 400 · В 900 мм», — как соседние показывают связи и
    // число единиц оборудования.
    const sizesButton = view.fields
      ? uiButton(view.fields.sizes || strings.markSizes.open, {
          class: "ui-btn ui-btn--wide mark-row__sizes" + (view.fields.sizes ? " is-set" : ""),
          title: strings.markSizes.onMark,
          on: { click: () => editSizes(mark.id) },
        })
      : null;
    const node = uiEl(
      "div",
      {
        class: "mark-row" + (view.open ? " is-current is-open" : ""),
        title: strings.marks.focus,
      },
      [
        head,
        view.fields ? roomField(state, mark) : null,
        // «Расположение» и «В оригинале» — рядом, в одну строку: заказчик
        // заполняет их парой, идя по списку, и две узкие строки читаются как
        // одна запись о метке, а не как два разных дела. Подписи у полей нет:
        // что это за поле, говорит подсказка в пустом, а у заполненного —
        // подсказка при наведении.
        view.fields
          ? uiEl("div", { class: "mark-row__fields" }, [
              uiEl("input", {
                class: "ui-input mark-row__location",
                type: "text",
                value: view.fields.location,
                placeholder: strings.marks.locationPlaceholder,
                title: strings.marks.location,
                on: { change: (event) => setField(mark.id, "location", event.target.value) },
              }),
              uiEl("input", {
                class: "ui-input mark-row__original",
                type: "text",
                value: view.fields.original,
                placeholder: strings.marks.originalPlaceholder,
                title: strings.marks.original,
                on: { change: (event) => setField(mark.id, "original", event.target.value) },
              }),
            ])
          : null,
        controlsButton,
        equipmentButton,
        sizesButton,
        // Обратная сторона связи — строкой и только для чтения: стоя у
        // светильника, надо видеть, какой выключатель его включает, а правится
        // связь там, где её завели, — у выключателя.
        view.fields && view.fields.controlledBy.length > 0
          ? uiEl("p", {
              class: "mark-row__by",
              text: text("marks.controlledBy", { labels: view.fields.controlledBy.join(", ") }),
            })
          : null,
      ],
    );
    node.addEventListener("pointerdown", (event) => {
      if (event.target.closest("input, select, button, option")) return;
      selectMark(mark.id);
    });
    // Режим просмотра: строка читается и подводит к метке на плане, но поля
    // в ней не правятся — правка живёт на широком экране.
    if (!layoutAllows("editMarks", state.layout)) {
      for (const field of node.querySelectorAll("input")) field.readOnly = true;
      for (const field of node.querySelectorAll("select")) field.disabled = true;
      // Кнопка связи — тоже правка: в режиме просмотра она не нажимается.
      for (const button of node.querySelectorAll("button")) button.disabled = true;
    }
    return node;
  }

  // Кнопка с места не исчезает, даже когда смыкать нечего: пользователь
  // спрашивает у неё «а есть ли дыры?» — и получает ответ строкой, а не
  // пустым окном. В режиме просмотра правок нет вовсе, там её не показываем.
  function syncCompact(state) {
    foot.hidden = !layoutAllows("editMarks", state.layout);
    compactButton.disabled = !state.project;
  }

  function render() {
    pending = false;
    const state = getState();
    syncCompact(state);
    if (!state.project || !state.schemeId) {
      count.textContent = "";
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.panels.canvasEmpty }));
      return;
    }
    // Порядок строк — только из фильтров, и никакой своей перестановки:
    // выделенную показывает прокрутка, а место в списке у метки остаётся
    // прежним. Сдвинь его — и список перестанет сходиться с легендой
    // и таблицей, у которых порядок тот же.
    const rows = filtersMarkRows(state.project, state.schemeId, state.filter);
    const total = state.project.marks.filter((mark) => mark.schemeId === state.schemeId).length;
    count.textContent = total > 0 ? text("marks.count", { shown: rows.length, total }) : "";
    if (rows.length === 0) {
      list.replaceChildren(
        uiEl("p", { class: "panel__empty", text: total > 0 ? strings.marks.nothingFound : strings.panels.marksEmpty }),
      );
      return;
    }
    const selected = new Set(state.selectedMarkIds);
    // Повтор номера ищется по всему объекту, а не по видимым строкам: два Т1 на
    // разных схемах — такой же повтор, и предупредить о нём надо в обеих.
    const repeats = new Map();
    for (const item of repeatedNumbers(state.project)) {
      for (const markId of item.markIds) repeats.set(markId, item.count);
    }
    const controllers = marksControllerIndex(state.project);
    list.replaceChildren(
      ...rows.map((row) => markRow(state, row, selected.has(row.mark.id), repeats, controllers)),
    );
    // Подводим список к выделенной строке только когда выделение сменилось:
    // иначе прокрутка дралась бы с рукой — пользователь листает список сам, а
    // тот возвращается к выделенной метке после каждой перерисовки.
    const selection = state.selectedMarkIds.join(",");
    const current = list.querySelector(".mark-row.is-current");
    // «Не поднимать» причитается ровно той метке, по строке которой нажали.
    const align = clickedRow && selection === clickedRow ? MARKS_ALIGN_LEAST : MARKS_ALIGN_TOP;
    clickedRow = null;
    if (current && selection !== shownSelection) marksScrollToRow(current, align, { head: top, foot });
    shownSelection = selection;
  }

  // Отложенная перерисовка: то, что накопилось, пока пользователь печатал.
  host.addEventListener("focusout", () => {
    if (!pending) return;
    setTimeout(() => {
      if (!typing()) render();
    }, 0);
  });
  api.subscribe((state, changed) => {
    if (
      !(
        "project" in changed ||
        "schemeId" in changed ||
        "filter" in changed ||
        "selectedMarkIds" in changed ||
        "layout" in changed
      )
    ) {
      return;
    }
    if (typing()) {
      pending = true;
      return;
    }
    render();
  });
  render();
}

registerPanel(PANEL_IDS.marks, mountMarksPanel);
