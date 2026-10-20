// Рейка заголовков: что ниже кадра — то у нижней кромки колонки.
//
// Слова заказчика (таск 194, G295): «помимо sticky headers сверху, он должен
// быть и снизу. Что бы группы были видны всегда». К верху заголовок липнет
// сам — `position: sticky` в `.panel__head`. К низу чистым CSS не выходит, и
// упирается это не в подбор чисел, а в правило: клетка, в которой `sticky`
// разрешено двигать заголовок, — его собственный раздел. Чтобы показать
// заголовок раздела, который ещё **ниже** кадра, его надо поднять выше своего
// раздела — а туда sticky не ходит и ходить не может.
//
// Трюк, которым это делают чистым CSS, один: разложить все заголовки прямыми
// детьми прокручиваемой колонки и выдать каждому свой `top` и свой `bottom`
// ступенькой. Он умеет и верх и низ, но платит двумя вещами, на которых стоит
// колонка: раздел перестаёт быть флекс-ящиком (а им делится высота и им
// сворачивается тело — таск 153, таск 175), и сверху заголовки начинают
// копиться лестницей. Верх колонки заказчик уже принял в таске 175, и менять
// его этот таск не просил.
//
// **Приём: заголовок остаётся на своём месте в раскладке, а рисуется ниже —
// `transform: translateY`.** Место под заголовком остаётся за ним, высота
// содержимого и прокрутка не меняются ни на точку (а значит, не дёргается ни
// ползунок, ни подведённая к глазам строка), трансформация не заставляет
// браузер пересобирать раздел.
//
// **Цена.** Её платит прокрутка: раз в кадр колонка меряет прямоугольники
// своих разделов и пишет трансформации. Поэтому здесь всё, что можно, сделано
// дешёвым: один `requestAnimationFrame` на кадр на обе колонки, чтения (пять
// прямоугольников на колонку) идут отдельно от записей, а запись в CSS-меру
// (`--panel-rail`, `--panel-head`) и класс идут только на смену значения —
// наследуемая мера, переписанная вслепую, пересчитала бы стили у всех
// восьмидесяти строк списка. Сложить рейку в один DOM-узел и показывать в ней
// клоны заголовков было бы дешевле на чтениях, но клон — это второй заголовок:
// своя подстановка строк, свой счётчик, свой `aria-expanded` и своя подсветка
// позванного раздела. Второго заголовка в сборке быть не должно.
//
// **Нажатие на заголовок у кромки перелистывает к его разделу** (таск 198,
// G303). Слова заказчика: «нажал — прыгнуло туда — да, так и надо, а то
// приходится самому листать, это не очевидно». Таск 194 решил иначе — узел в
// рейке тот же самый, значит и нажатие то же, — и довод был: придумывать
// кнопке второй смысл в зависимости от того, где она нарисована, хуже.
// Заказчик этот довод отклонил, и правило теперь такое: **заголовок, стоящий
// не на своём месте, — указатель на раздел, а не кнопка сворачивания**.
// Одинаково для обеих кромок: прижатый браузером к верхней (раздел начался
// выше кадра) и поднятый рейкой к нижней ведут себя одним образом. Заголовок
// на своём месте — прежняя кнопка. Сворачивание из рейки не пропало: галочка
// слева от имени — своя кнопка (`.panel__fold`), и смысл у неё один и тот же,
// где бы заголовок ни был нарисован.

import { strings } from "../strings.js";

// Какую долю кадра рейке отдавать нельзя. Разделов в колонке четыре-пять, и на
// обычном экране рейка до этого не дотягивается вовсе; правило нужно низкому
// кадру, где пять заголовков закрыли бы собой всё: там ближние разделы дороже
// дальних, и лучше две группы и содержимое, чем пять групп и ничего.
export const PANEL_RAIL_SHARE = 0.5;

/**
 * Где стоит каждый заголовок при такой прокрутке.
 *
 * `items` — разделы колонки сверху вниз: `{ top, box, head }`, где `top` —
 * место раздела в содержимом колонки (не на экране: прокрутка на него не
 * влияет), `box` — высота раздела, `head` — высота его заголовка. `frame` —
 * что показано: `{ scrollTop, clientHeight }`.
 *
 * Отдаёт массив той же длины: `{ shift, side }`.
 *
 * `shift` — ноль или на сколько поднять заголовок. Вниз заголовок не
 * двигается никогда: опустить его ниже своего места значило бы закрыть им своё
 * же содержимое.
 *
 * `side` — где он при этом оказался: `""` — на своём месте, `"top"` — прижат к
 * верхней кромке (это делает сам браузер, `position: sticky`), `"bottom"` —
 * поднят рейкой к нижней. Наружу это нужно затем, что по стороне решается
 * смысл нажатия (таск 198): заголовок не на своём месте — указатель.
 *
 * Разделы, которые целиком ниже кадра, — это всегда **хвост** списка, поэтому
 * счёт идёт с конца: последний раздел встаёт у самой кромки, предыдущий над
 * ним, и каждому следующему остаётся кадра меньше. Как только раздел своим
 * местом дотянулся до своей строки в рейке — он и все, кто выше, стоят сами:
 * заголовок снимается с рейки ровно там, где сдвиг обнуляется, и перехода не
 * видно.
 *
 * Верх считается без прокрутки вовсе — одной арифметикой: браузер держит
 * заголовок внутри его раздела, значит прижат тот и только тот, чей раздел
 * **начался выше кадра и ещё не кончился**. Свёрнутый раздел (`box === head`)
 * к верху не липнет никогда: двигать заголовок ему некуда.
 */
export function panelRailPins(items, frame) {
  const count = items ? items.length : 0;
  const pins = [];
  const view = Math.max(0, (frame && frame.clientHeight) || 0);
  const from = (frame && frame.scrollTop) || 0;
  for (let k = 0; k < count; k += 1) {
    const item = items[k];
    const held = item.box > item.head && item.top < from && from < item.top + item.box;
    pins.push({ shift: 0, side: held ? "top" : "" });
  }
  if (!count || view <= 0) return pins;
  const edge = from + view;
  let first = count;
  let stack = 0;
  for (let k = count - 1; k >= 0; k -= 1) {
    const line = edge - stack - items[k].head;
    if (items[k].top <= line) break;
    first = k;
    stack += items[k].head;
  }
  if (first >= count) return pins;
  // Лишние снимаются с дальнего конца: дальний раздел и так за двумя другими,
  // а ближний — следующий, к которому человек подойдёт прокруткой.
  let last = count;
  while (last > first + 1 && stack > view * PANEL_RAIL_SHARE) {
    last -= 1;
    stack -= items[last].head;
  }
  let line = edge;
  for (let k = last - 1; k >= first; k -= 1) {
    line -= items[k].head;
    const shift = Math.min(0, Math.round(line - items[k].top));
    if (!shift) continue;
    pins[k] = { shift, side: "bottom" };
  }
  return pins;
}

/**
 * Куда прокрутить колонку, чтобы раздел встал к верхней кромке.
 *
 * Считает это рейка, а не тот, кто её зовёт: заголовок обязан встать **под**
 * накладкой — под теми заголовками, которые в целевом положении сами прижаты
 * к верху, — иначе перелистывание прячет раздел за той же рейкой, из которой
 * его позвали.
 *
 * Сегодня ответ всегда ноль, и это видно из счёта, а не взято на веру: к
 * верхней кромке липнет только заголовок раздела, который её пересекает, а в
 * целевом положении её пересекает сам позванный раздел — он и встаёт на своё
 * место. Счёт оставлен счётом нарочно: заведётся сверху лестница заголовков,
 * как завелась снизу, — перелистывание сядет правильно само, и вспоминать про
 * это место не придётся.
 */
export function panelRailTopInset(items, index) {
  const target = items[index] ? items[index].top : 0;
  let inset = 0;
  for (let k = 0; k < items.length; k += 1) {
    if (k === index) continue;
    const item = items[k];
    if (item.box > item.head && item.top < target && target < item.top + item.box) inset += item.head;
  }
  return inset;
}

// Высота рейки по колонкам: её спрашивают прокрутки к выделенной строке —
// рейка закрывает низ кадра так же непрозрачно, как прилипшая кнопка.
const railHeight = new WeakMap();

/**
 * Кто из предков узла прокручивается.
 *
 * Своего прокручиваемого ящика у списков в колонке нет: с таска 194 прокрутка
 * одна на всю колонку, а на телефоне — у тела раздела, которое кладут листом.
 * Поэтому не имя узла, а первый предок, которому есть что прокручивать.
 */
export function panelScrollBox(node) {
  for (let box = node && node.parentElement; box; box = box.parentElement) {
    const overflow = getComputedStyle(box).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && box.scrollHeight > box.clientHeight) return box;
  }
  return null;
}

/**
 * Сколько кадра закрыто непрозрачной накладкой — сверху (`head`) или снизу
 * (`foot`). Меряется по месту, а не по числам из стилей: прилипший блок
 * сдвинут отрицательным отступом, у кнопки смыкания свой, и оба меняются от
 * раскладки. `frame` — прямоугольник прокручиваемого ящика.
 */
export function panelCover(frame, element, side) {
  if (!element || element.hidden) return 0;
  const rect = element.getBoundingClientRect();
  if (rect.height === 0) return 0;
  return Math.max(0, side === "head" ? rect.bottom - frame.top : frame.bottom - rect.top);
}

// Высота рейки у колонки, в которой лежит узел (ноль — рейки нет). Прокрутка к
// строке обязана её знать: подвести строку под рейку — то же, что подвести её
// под прилипшие фильтры.
export function panelRailInset(node) {
  for (let box = node; box; box = box.parentElement) {
    const rail = railHeight.get(box);
    if (rail !== undefined) return rail;
  }
  return 0;
}

// Заголовок, стоящий не на своём месте: поднят (`transform`), помечен классом
// и подписан подсказкой — нажатие перелистнёт, а не свернёт. Пишем только на
// смену значения: слепая запись стоила бы пересчёта стилей всему, что внутри.
function railPin(node, pin) {
  const css = pin.shift ? "translateY(" + pin.shift + "px)" : "";
  if (node.style.transform !== css) node.style.transform = css;
  node.classList.toggle("is-below", pin.side === "bottom");
  node.classList.toggle("is-pinned", pin.side !== "");
  const title = node.querySelector(".panel__title");
  if (!title) return;
  const hint = pin.side ? strings.panels.jump : "";
  if (title.title !== hint) title.title = hint;
}

function railVar(node, name, value) {
  const css = value + "px";
  if (node.style.getPropertyValue(name) !== css) node.style.setProperty(name, css);
}

// Разделы колонки в порядке сверху вниз — одними чтениями, без единой записи:
// запись в стиль между двумя `getBoundingClientRect` заставляла бы браузер
// пересчитывать раскладку посреди обмера. Скрытый раздел (чужой режим,
// спрятанная колонка, лист на телефоне без заголовков) в счёт не идёт: высоты
// заголовка у него нет, и места в рейке он не занимает.
function railItems(column) {
  const rect = column.getBoundingClientRect();
  // Где в кадре лежит начало содержимого: по нему место раздела переводится из
  // экранного в содержимое — прокрутка на такое место не влияет.
  const base = rect.top + column.clientTop - column.scrollTop;
  const items = [];
  for (const section of column.querySelectorAll(".panel__section")) {
    const node = section.querySelector(".panel__head");
    if (!node) continue;
    const box = section.getBoundingClientRect();
    items.push({ section, node, head: node.offsetHeight, top: box.top - base, box: box.height });
  }
  return items;
}

const RAIL_FREE = { shift: 0, side: "" };

function syncColumn(column) {
  const all = railItems(column);
  const shown = all.filter((item) => item.head > 0);
  const pins = panelRailPins(shown, { scrollTop: column.scrollTop, clientHeight: column.clientHeight });
  let rail = 0;
  for (let k = 0; k < shown.length; k += 1) {
    railPin(shown[k].node, pins[k]);
    if (pins[k].shift) rail += shown[k].head;
  }
  for (const item of all) {
    if (item.head <= 0) railPin(item.node, RAIL_FREE);
    // Прилипший блок внутри тела (фильтры списка меток) липнет **под**
    // заголовком своего раздела, а не на нём: высоту заголовка он узнаёт мерой,
    // а не числом в стилях — иначе фильтры разошлись бы с заголовком на первой
    // же правке шрифта или отступов.
    railVar(item.section, "--panel-head", item.head);
  }
  railVar(column, "--panel-rail", rail);
  railHeight.set(column, rail);
}

/**
 * Нажали заголовок — перелистнуть к его разделу, если заголовок нарисован у
 * кромки (таск 198, G303).
 *
 * Отдаёт `true`, если нажатие было указателем и колонка перелистнута, и
 * `false`, если заголовок стоит на своём месте: тогда это прежняя кнопка
 * сворачивания, и решает не рейка. Знание «у кромки или нет» берётся из
 * класса, который рейка поставила в последнем кадре прокрутки, — второго
 * обмера ради одного клика не нужно.
 *
 * Прокрутка **мгновенная**, не плавная, и это выбор. Колонка на объекте
 * заказчика — 3785 точек: плавный перелёт через неё занимает полсекунды, всё
 * это время перестраивает рейку на каждом кадре и показывает по дороге строки,
 * которых никто не звал. Слова заказчика («нажал — прыгнуло туда») — про
 * прыжок. Мгновенная ещё и не спорит с рукой: начал человек листать сам —
 * спорить не с чем, перелёт уже кончился.
 */
export function panelRailJump(node) {
  const head = node && node.closest ? node.closest(".panel__head") : null;
  if (!head || !head.classList.contains("is-pinned")) return false;
  const section = head.closest(".panel__section");
  const column = section ? section.closest(".panel") : null;
  if (!column) return false;
  const shown = railItems(column).filter((item) => item.head > 0);
  const index = shown.findIndex((item) => item.node === head);
  if (index < 0) return false;
  column.scrollTop = shown[index].top - panelRailTopInset(shown, index);
  syncPanelRail();
  return true;
}

let railColumns = [];
let railPending = false;

// Один кадр на обе колонки: прокрутка правой пересчитает и левую, но левая —
// это пять чтений, а два расписания на кадр были бы двумя пересчётами стилей.
export function syncPanelRail() {
  if (railPending || railColumns.length === 0) return;
  if (typeof requestAnimationFrame !== "function") {
    for (const column of railColumns) syncColumn(column);
    return;
  }
  railPending = true;
  requestAnimationFrame(() => {
    railPending = false;
    for (const column of railColumns) syncColumn(column);
  });
}

export function wirePanelRail() {
  if (typeof document === "undefined") return;
  railColumns = [...document.querySelectorAll(".panel")];
  if (railColumns.length === 0) return;
  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(() => syncPanelRail()) : null;
  for (const column of railColumns) {
    column.addEventListener("scroll", syncPanelRail, { passive: true });
    if (!observer) continue;
    // Колонка — чтобы знать кадр, разделы — чтобы знать места: раздел меняет
    // рост, когда его свернули, когда в списке прибыло строк и когда режим
    // экрана убрал соседа.
    observer.observe(column);
    for (const section of column.querySelectorAll(".panel__section")) observer.observe(section);
  }
  if (typeof window !== "undefined" && !observer) window.addEventListener("resize", syncPanelRail);
  syncPanelRail();
}
