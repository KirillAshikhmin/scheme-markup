// Список меток схемы: обозначение, помещение, расположение и обозначение из
// оригинального проекта — правятся прямо в строке.
//
// Почему список, а не карточка метки: заказчик заполняет «Расположение» и
// «В оригинальной схеме» не в момент постановки, а потом, разом, по списку.
// Поэтому правка здесь на месте, а отдельного окна у метки нет вовсе.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import { getSetting, setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import {
  MARK_DIMENSION_FIELDS,
  MARK_NUMBER_MAX,
  channelLabel,
  compactAllNumbers,
  findMark,
  findRoom,
  labelCounts,
  labelOf,
  linkedMarkIds,
  markControlIds,
  markControls,
  markControlledBy,
  markControlsByChannel,
  markDimensions,
  markRoomManual,
  placementsAt,
  findScheme,
  repeatedNumbers,
  roomsInOrder,
  schemesInOrder,
  setMarkControls,
  setMarkDimensions,
  setMarkFreeNumber,
  setMarkNumber,
  styleOf,
  typesInOrder,
  updateMark,
} from "../model.js";
import { planToScreen, shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { uiButton, uiEl, uiIconButton, uiModal, uiPrompt } from "./ui.js";
import { filtersActive, filtersBox, filtersMarkRows } from "./filters.js";
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

/**
 * Перечень обозначений для строки свойств: повторы названы один раз и с числом.
 *
 * Заказчик нарочно вешает на один номер группу светильников, и перечень связей
 * превращался в «Т3, Т3, Т3, ППл1, ППл1, ППл2, ППл1…». Его слова: «если метки
 * с одинаковым номером, то в интерфейсе указывай только 1 раз».
 *
 * Число повторов показывается, а не выбрасывается: связей у метки больше, чем
 * имён в строке, и без «×3» строка обещала бы один светильник вместо трёх.
 * Знак взят тот же, что у отметки повтора номера в строке списка, — «×N» в
 * этой панели уже значит «столько же меток».
 */
export function marksLabelList(labels) {
  return labelCounts(labels).map(marksLabelText);
}

// Одно имя перечня: «Т3» или «Т3 ×3». Отдельной функцией — потому что перечень
// связки считает повторы сам (ему нужно число меток в свёрнутом хвосте), а
// писаться имя обязано одним правилом с перечнем связей.
function marksLabelText(item) {
  return item.count > 1 ? text("marks.labelTimes", { label: item.label, count: item.count }) : item.label;
}

// Сколько имён показывает перечень связки, прежде чем свернуться числом.
//
// Замыкание поднимает столько меток, сколько их в связке на самом деле: у реле
// на пять групп — три десятка (замерено в таске 84). Строка списка живёт в
// колонке 264 точки, и тридцать имён в ней — семь строк текста под каждой
// раскрытой меткой. Шесть имён занимают две строки и оставляют хвост числом;
// целиком перечень остаётся в подсказке при наведении, а на плане — дугами и
// оболочкой вокруг всей связки (она и так рисуется при выделении).
export const MARKS_LINKED_SHOWN = 6;

/**
 * Вся связная группа метки — словами.
 *
 * Считает её модель (`linkedMarkIds`, таск 84): транзитивное замыкание по трём
 * родам отношений — управление в обе стороны, общая цепь и общий номер. Второй
 * реализации здесь быть не должно: перечень обязан совпадать с тем, что
 * подсвечивается на плане при выделении той же метки.
 *
 * **Прямые связи из перечня выбрасываются.** Метка, уже названная в «Чем
 * управляет» или «Чем управляется», появилась бы в строке второй раз — и
 * перечень читался бы как повтор, а не как новость. После вычитания в нём
 * остаётся ровно то, чего больше нигде не написано: второй выключатель того же
 * светильника, тёзка по номеру, сосед по цепи.
 *
 * **Вычитается по метке, а не по имени.** Заказчик нарочно вешает на группу
 * светильников один номер: выключатель может управлять одним Т3 из трёх, и два
 * оставшихся связаны с ним через номер. Выброси их по имени — и связка
 * промолчала бы о двух метках; выброшенные по идентификатору, они честно
 * встают в перечень как «Т3 ×2».
 *
 * Порядок — тот, что дала модель: своей сортировки здесь не заводится.
 */
export function marksLinkedList(project, markId, limit = MARKS_LINKED_SHOWN) {
  const mark = project ? findMark(project, markId) : null;
  if (!mark) return { entries: [], all: [], more: 0, total: 0 };
  const named = new Set([markId]);
  for (const id of markControlIds(mark)) named.add(id);
  for (const item of markControlledBy(project, markId)) named.add(item.id);
  const rest = linkedMarkIds(project, markId).filter((id) => !named.has(id));
  const counts = labelCounts(rest.map((id) => labelOf(project, id)));
  const shown = limit > 0 ? counts.slice(0, limit) : counts;
  return {
    entries: shown.map(marksLabelText),
    all: counts.map(marksLabelText),
    more: counts.slice(shown.length).reduce((sum, item) => sum + item.count, 0),
    total: rest.length,
  };
}

// Перечень связки строкой: «В2, Т3 ×2 и ещё 21». Пустая строка значит, что
// показывать нечего, — поле в этом случае не рисуется вовсе, как и остальные
// пустые поля метки.
export function marksLinkedText(list) {
  if (!list || list.entries.length === 0) return "";
  const line = list.entries.join(", ");
  return list.more > 0 ? line + " " + text("marks.linkedMore", { count: list.more }) : line;
}

// Подсказка перечня: чем эта связь отличается от прямой, а у свёрнутого
// перечня — ещё и весь список целиком. Свернуть в строке и потерять насовсем —
// разные вещи.
export function marksLinkedTitle(list) {
  if (!list || list.entries.length === 0) return strings.marks.linkedTitle;
  if (list.more === 0) return strings.marks.linkedTitle;
  return strings.marks.linkedTitle + "\n" + text("marks.linkedAll", { labels: list.all.join(", ") });
}

/**
 * Перечень нагрузок строкой — сгруппированный по каналам: «① Т16 ×6 · ② С1».
 *
 * Слова заказчика: «фактически какой канал выключателя к какой нагрузке идёт —
 * не понятно». В строке метки на это отвечает группировка: клавиша названа
 * один раз, а под ней стоит всё, что она включает, — в том числе группа из
 * шести светильников одним «Т16 ×6».
 *
 * **Связь без канала группы не получает.** У объекта прежнего формата группа
 * ровно одна и без значка, и строка читается ровно как раньше — «Т1, Т2».
 */
export function marksControlsText(project, markId) {
  const groups = markControlsByChannel(project, markId);
  if (groups.length === 0) return "";
  return groups
    .map((group) => {
      const labels = marksLabelList(group.marks.map((item) => labelOf(project, item.id))).join(", ");
      const channel = channelLabel(group.channel);
      return channel ? text("channels.group", { channel, labels }) : labels;
    })
    .join(strings.channels.separator);
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

// Отметка в настройках браузера: свёрнут ли блок фильтров. Оснастка рабочего
// места, а не свойство объекта, — в файл проекта ей не за чем, как отметке
// линейки и связей. Ключ живёт здесь, а не в общих настройках вида: состояние
// нужно одной этой панели, наружу в состояние сеанса оно не выносится.
export const MARKS_FILTERS_SETTING = "marksFiltersCollapsed";

/**
 * Что показывает заголовок блока фильтров.
 *
 * Заказчик: «фильтры сделай сворачиваемыми». Свернуть их просто, а вот спрятать
 * вместе с ними включённый фильтр — значит подложить свинью: метки пропали со
 * схемы и из списка, а почему — не видно нигде. Поэтому заголовок отвечает на
 * два вопроса сразу.
 *
 * — **Сужен ли список.** `narrowed` поднимает заголовок в акцентный цвет и
 *   дописывает в подсказку, что метки прячет фильтр. Считает это
 *   `filtersActive` — та же функция, по которой гаснет кнопка «Показать все»,
 *   второй такой проверки в сборке быть не должно.
 *
 * — **Сколько меток видно.** Счётчик — про список, а не про фильтры, поэтому
 *   он остаётся на виду и свёрнутым: переехал в строку заголовка, где не стоит
 *   ни пикселя лишней высоты. Не сужен — там просто число меток на схеме
 *   («36»), сужен — полное «Показано 12 из 36»: в этот момент важны оба числа.
 */
export function marksFiltersHead({ collapsed, filter, shown, total }) {
  const narrowed = filtersActive(filter);
  const hint = [
    collapsed ? strings.filters.expand : strings.filters.collapse,
    narrowed ? strings.filters.narrowed : null,
  ]
    .filter(Boolean)
    .join(". ");
  let count = "";
  if (total > 0) count = narrowed ? text("marks.count", { shown, total }) : String(total);
  return { narrowed, count, hint };
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
// Поводы подвести список к выделенной строке. Их ровно два, и они разной
// природы: сменилась метка — или сменилось место у той же метки.
export const MARKS_SCROLL_SELECTION = "selection";
export const MARKS_SCROLL_MOVED = "moved";

/**
 * Зачем подводить список к выделенной строке — и надо ли вообще.
 *
 * Прокрутка умела один повод: сменилось выделение. Заказчик нашёл дыру: «при
 * смене типа метки в списке меток она оказывается где-то за видимой областью —
 * скролль до неё». Список упорядочен по типам, и смена типа уносит строку в
 * другой его конец; выделение при этом не меняется, и прокрутка молчала.
 *
 * Правило шире одного случая: **строка должна остаться на виду, если уехала
 * она, а не пользователь.** Поэтому переезд считается не по списку поводов
 * (сменили тип, сменили номер, сомкнули номера, удалили соседа, отменили,
 * приехала чужая правка из папки) — их не перечислить и легко забыть новый, —
 * а по самому месту строки в содержимом. Переехала на другое место или
 * сменила рост — повод есть, чем бы это ни было вызвано.
 *
 * `before` и `after` — что было показано и что вышло сейчас:
 * `{ selection, box }`, где `box` — `{ top, height }` строки внутри
 * содержимого списка или `null`, если выделенной строки в выдаче нет.
 * Место меряется от начала содержимого, а не от кромки экрана: прокрутка на
 * него не влияет, и рука пользователя за переезд не принимается.
 *
 * Молчим в двух случаях:
 *
 * — **выделения нет** или **строки нет в выдаче** (метка на другой схеме, ушла
 *   под фильтр — сменили ей помещение при фильтре по помещению). Подводить не
 *   к чему, а дёрнуть список в никуда — хуже, чем не дёргать;
 * — **ничего не сменилось**: то же выделение на том же месте. Это и есть
 *   «пользователь листает сам» — перерисовка списка не повод возвращать его
 *   к выделенной метке, даже если он отлистал от неё далеко.
 *
 * Отдельный случай — **строка вернулась в выдачу**: прежнего места у неё нет
 * (`before.box` пуст), и это считается переездом. Иначе метка, вышедшая
 * из-под снятого фильтра, осталась бы за кадром.
 */
export function marksScrollNeed(before, after) {
  if (!after || !after.selection || !after.box) return null;
  if (!before || after.selection !== before.selection) return MARKS_SCROLL_SELECTION;
  if (!before.box) return MARKS_SCROLL_MOVED;
  if (before.box.top !== after.box.top || before.box.height !== after.box.height) return MARKS_SCROLL_MOVED;
  return null;
}

// Где строка лежит в содержимом списка и какой она высоты. Меряется от начала
// содержимого, а не от кромки экрана: прокрутка на это число не влияет —
// поэтому по нему и видно, что строка переехала сама, а не пользователь
// отлистал от неё.
function marksRowBox(node, scroller) {
  const box = scroller || marksScrollBox(node);
  if (!box) return null;
  const row = node.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  // `clientTop` — рамка ящика, она в счёт содержимого не идёт.
  return { top: row.top - frame.top - box.clientTop + box.scrollTop, height: row.height };
}

function marksScrollToRow(node, align, chrome) {
  const box = marksScrollBox(node);
  if (!box) return;
  const place = marksRowBox(node, box);
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
  box.scrollTop = marksScrollTop(
    place,
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
    // Обе стороны связи — свёрнутым перечнем: повторы номера есть и у
    // подопечных («Т3, Т3, Т3»), и у управляющих — два проходных выключателя
    // одной группы носят один номер.
    controls: marksLabelList(markControls(project, mark.id).map((item) => labelOf(project, item.id))),
    // Тот же перечень строкой, но разложенный по каналам: кнопка показывает
    // не только «чем управляет», но и «какой клавишей».
    controlsText: marksControlsText(project, mark.id),
    controlledBy: marksLabelList(controllers.get(mark.id) || []),
    // Вся связка метки — то, что поднимается на плане при её выделении.
    // Считается только у раскрытой строки: замыкание ходит по всему объекту, а
    // раскрыта в списке всегда одна метка.
    linked: marksLinkedList(project, mark.id),
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
  // Счётчик — внутри кнопки заголовка, поэтому строчный: абзацу в кнопке не
  // место. Та же связка, что у разделов панели: значок числа в заголовке.
  const count = uiEl("span", { class: "marks__count" });
  // Смыкание номеров — под списком, как просил заказчик: команда про весь
  // объект, а не про открытую схему, и место ей после списка, а не среди
  // фильтров. Уплотнение по одному типу осталось в справочнике.
  const compactButton = uiButton(strings.marks.compactAll, {
    class: "ui-btn ui-btn--wide",
    title: strings.marks.compactAllHint,
    on: { click: () => compactAll() },
  });
  const foot = uiEl("div", { class: "marks__foot" }, [compactButton]);
  // Заголовок фильтров собран по образцу заголовков разделов панели: галочка,
  // имя, счётчик справа. Язык у сворачивания в приложении один, и заводить
  // второй ради блока внутри раздела незачем.
  const filtersChevron = uiEl("span", { class: "marks__chevron" });
  const filtersName = uiEl("span", { class: "marks__filtersName", text: strings.filters.title });
  const filtersTitle = uiEl(
    "button",
    { class: "marks__filtersTitle", attrs: { type: "button" }, on: { click: () => flipFilters() } },
    [filtersChevron, filtersName, count],
  );
  const filtersBody = uiEl("div", { class: "marks__filtersBody" }, [filters.node]);
  // Фильтры сверху и кнопка смыкания снизу прилипшие и непрозрачные: они
  // закрывают собой часть списка, и прокрутка обязана это знать — иначе
  // подведённая строка уезжает под фильтры. Свёрнутые фильтры ужимаются до
  // строки заголовка — ради этого заказчик их сворачивать и просил.
  const top = uiEl("div", { class: "marks__top" }, [filtersTitle, filtersBody]);
  host.replaceChildren(top, list, foot);
  let filtersCollapsed = false;
  // Пока курсор стоит в текстовом поле строки, список не пересобирается: иначе
  // буква, набранная в «Расположении», выбрасывала бы фокус после каждой правки.
  // Поле поиска сюда не входит: оно живёт над списком, и набор в нём обязан
  // перестраивать список по ходу — ради этого он и набирается.
  let pending = false;
  let shownSelection = "";
  // Где стояла выделенная строка в прошлую перерисовку. По этому месту и видно,
  // что она переехала: сменили метке тип — и она ушла к другому концу списка,
  // а выделение осталось прежним.
  let shownBox = null;
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

  // «Дать свободный номер»: метка уходит с общего номера на свой.
  //
  // Кнопка не чинит ошибку — повтор номера у заказчика намеренный, — а делает
  // то, что он делал руками: искал по таблице номер, которого ещё нет. Какой
  // номер считается свободным, решает модель (`freeMarkNumber`); панель только
  // называет получившееся обозначение, чтобы номер не пришлось искать глазами
  // уже в своей же строке.
  function giveFreeNumber(markId) {
    const state = getState();
    const mark = state.project ? findMark(state.project, markId) : null;
    if (!mark) return;
    try {
      const next = setMarkFreeNumber(state.project, markId);
      if (next.project === state.project) return;
      canvasCommit(state.project, next.project, strings.history.markFreeNumber);
      notify(text("marks.freeNumberDone", { label: labelOf(next.project, markId) }), "info");
    } catch (error) {
      fail(error);
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
      // Канал едет вместе со связью: окно отдаёт `{id, channel}`, и модель
      // кладёт канал на саму связь. Метку, исчезнувшую, пока окно висело,
      // отсеиваем здесь — вместе с её каналом.
      const alive = picked.filter((item) => findMark(fresh.project, item && item.id));
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
          // Код и номер — одним куском, вплотную. Слова заказчика: «в
          // развёрнутой карточке метки цифру метки прижми к её букве, а то там
          // большое расстояние». Раньше поле номера стояло у правого края, и
          // «Р» с «3» читались как два разных поля, хотя в свёрнутой строке
          // обозначение слитное — «Р3». Своя обёртка, а не зазор в голове:
          // ужиматься на длинном коде должна пара целиком, а не голова.
          uiEl("div", { class: "mark-row__ident" }, [
            // Код до шестнадцати букв в панель не влезает и жмётся многоточием
            // — целиком он остаётся в подсказке. Номер при этом не уезжает:
            // ужимается код, а поле номера своей меры не отдаёт.
            uiEl("span", { class: "mark-row__label", text: view.code, title: view.code }),
            uiEl("input", {
              class: "ui-input mark-row__number",
              type: "number",
              value: String(view.fields.number),
              title: strings.marks.number,
              attrs: { min: "1", max: String(MARK_NUMBER_MAX), step: "1" },
              on: { change: (event) => setNumber(mark.id, event.target.value) },
            }),
            // Свободный номер — кнопкой рядом с полем, а не в отдельном окне:
            // отделяют метку, глядя на её же номер и на отметку повтора, и
            // рука уже здесь. Кнопка узкая и `flex: none` — раскладку пары
            // «код + номер» она не двигает, ужимается по-прежнему код.
            uiIconButton("split", {
              class: "ui-btn mark-row__free",
              label: strings.marks.freeNumber,
              title: strings.marks.freeNumberTitle,
              on: { click: () => giveFreeNumber(mark.id) },
            }),
          ]),
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
            ? text("marks.controlsOf", { labels: view.fields.controlsText })
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
        // Связка — последней строкой и тоже только для чтения: это вывод из
        // уже записанных связей, а не ещё одно поле метки. Стоит после обеих
        // прямых связей нарочно: сперва названо то, что записано у метки
        // руками, потом то, что из этого следует.
        view.fields && view.fields.linked.entries.length > 0
          ? uiEl("p", {
              class: "mark-row__by mark-row__linked",
              text: text("marks.linked", { labels: marksLinkedText(view.fields.linked) }),
              title: marksLinkedTitle(view.fields.linked),
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

  // Заголовок фильтров: галочка, акцент на суженном списке и счётчик. Что
  // именно в нём написано, решает `marksFiltersHead` — её и проверяет тест.
  function syncFilters(state, shown, total) {
    const head = marksFiltersHead({ collapsed: filtersCollapsed, filter: state.filter, shown, total });
    filtersBody.hidden = filtersCollapsed;
    top.classList.toggle("is-collapsed", filtersCollapsed);
    top.classList.toggle("is-narrowed", head.narrowed);
    filtersTitle.title = head.hint;
    filtersTitle.setAttribute("aria-expanded", filtersCollapsed ? "false" : "true");
    count.textContent = head.count;
  }

  function flipFilters() {
    filtersCollapsed = !filtersCollapsed;
    setSetting(MARKS_FILTERS_SETTING, filtersCollapsed);
    render();
  }

  function render() {
    pending = false;
    const state = getState();
    syncCompact(state);
    if (!state.project || !state.schemeId) {
      syncFilters(state, 0, 0);
      list.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.panels.canvasEmpty }));
      return;
    }
    // Порядок строк — только из фильтров, и никакой своей перестановки:
    // выделенную показывает прокрутка, а место в списке у метки остаётся
    // прежним. Сдвинь его — и список перестанет сходиться с легендой
    // и таблицей, у которых порядок тот же.
    const rows = filtersMarkRows(state.project, state.schemeId, state.filter);
    const total = state.project.marks.filter((mark) => mark.schemeId === state.schemeId).length;
    syncFilters(state, rows.length, total);
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
    // Подводим список к выделенной строке по двум поводам: сменилось выделение
    // или строка переехала сама. Всё остальное — рука пользователя, и трогать
    // прокрутку нельзя: иначе список возвращался бы к выделенной метке после
    // каждой перерисовки.
    const selection = state.selectedMarkIds.join(",");
    const current = list.querySelector(".mark-row.is-current");
    const shown = { selection, box: current ? marksRowBox(current) : null };
    const need = marksScrollNeed({ selection: shownSelection, box: shownBox }, shown);
    // «Не поднимать» причитается ровно той метке, по строке которой нажали.
    // Переезд же — всегда минимальная прокрутка: выделение не менялось, метка
    // у пользователя перед глазами и часто под курсором (номер он правит прямо
    // в строке). Подводить её к верху значило бы двигать список там, где
    // двигать не просили; задача переезда — вернуть строку на экран, а не
    // поставить её на новое место.
    const align =
      need === MARKS_SCROLL_MOVED
        ? MARKS_ALIGN_LEAST
        : clickedRow && selection === clickedRow
          ? MARKS_ALIGN_LEAST
          : MARKS_ALIGN_TOP;
    clickedRow = null;
    if (need) marksScrollToRow(current, align, { head: top, foot });
    shownSelection = selection;
    shownBox = shown.box;
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
  // Настройки читаются асинхронно, как у разделов панели: блок стартует
  // развёрнутым и схлопывается, когда хранилище ответит. Ждать его с пустой
  // панелью хуже, а по умолчанию фильтры открыты — иначе новый пользователь
  // ищет, куда делся поиск по списку.
  Promise.resolve(getSetting(MARKS_FILTERS_SETTING))
    .then((saved) => {
      if (saved !== true || filtersCollapsed) return;
      filtersCollapsed = true;
      render();
    })
    .catch(() => {});
}

registerPanel(PANEL_IDS.marks, mountMarksPanel);
