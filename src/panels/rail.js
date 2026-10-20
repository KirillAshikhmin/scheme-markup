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
// позванного раздела. Второго заголовка в сборке быть не должно: нажатая в
// рейке галочка обязана сворачивать тот же раздел, а не его портрет.

// Какую долю кадра рейке отдавать нельзя. Разделов в колонке четыре-пять, и на
// обычном экране рейка до этого не дотягивается вовсе; правило нужно низкому
// кадру, где пять заголовков закрыли бы собой всё: там ближние разделы дороже
// дальних, и лучше две группы и содержимое, чем пять групп и ничего.
export const PANEL_RAIL_SHARE = 0.5;

/**
 * Куда сдвинуть заголовки, чтобы те, чьи разделы ниже кадра, встали у кромки.
 *
 * `items` — разделы колонки сверху вниз: `{ top, height }`, где `top` — место
 * раздела в содержимом колонки (не на экране: прокрутка на него не влияет), а
 * `height` — высота его заголовка. `frame` — что показано: `{ scrollTop,
 * clientHeight }`.
 *
 * Отдаёт массив той же длины: `0` — заголовок стоит сам, отрицательное число —
 * на сколько его поднять. Вниз заголовок не двигается никогда: опустить его
 * ниже своего места значило бы закрыть им своё же содержимое.
 *
 * Разделы, которые целиком ниже кадра, — это всегда **хвост** списка, поэтому
 * счёт идёт с конца: последний раздел встаёт у самой кромки, предыдущий над
 * ним, и каждому следующему остаётся кадра меньше. Как только раздел своим
 * местом дотянулся до своей строки в рейке — он и все, кто выше, стоят сами:
 * заголовок снимается с рейки ровно там, где сдвиг обнуляется, и перехода не
 * видно.
 */
export function panelRailPins(items, frame) {
  const count = items ? items.length : 0;
  const shifts = new Array(count).fill(0);
  const view = Math.max(0, (frame && frame.clientHeight) || 0);
  if (!count || view <= 0) return shifts;
  const edge = ((frame && frame.scrollTop) || 0) + view;
  let first = count;
  let stack = 0;
  for (let k = count - 1; k >= 0; k -= 1) {
    const line = edge - stack - items[k].height;
    if (items[k].top <= line) break;
    first = k;
    stack += items[k].height;
  }
  if (first >= count) return shifts;
  // Лишние снимаются с дальнего конца: дальний раздел и так за двумя другими,
  // а ближний — следующий, к которому человек подойдёт прокруткой.
  let last = count;
  while (last > first + 1 && stack > view * PANEL_RAIL_SHARE) {
    last -= 1;
    stack -= items[last].height;
  }
  let line = edge;
  for (let k = last - 1; k >= first; k -= 1) {
    line -= items[k].height;
    shifts[k] = Math.min(0, Math.round(line - items[k].top));
  }
  return shifts;
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

function railShift(head, shift) {
  const css = shift ? "translateY(" + shift + "px)" : "";
  if (head.style.transform !== css) head.style.transform = css;
  head.classList.toggle("is-below", shift !== 0);
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
    const head = section.querySelector(".panel__head");
    if (!head) continue;
    items.push({
      section,
      head,
      height: head.offsetHeight,
      top: section.getBoundingClientRect().top - base,
    });
  }
  return items;
}

function syncColumn(column) {
  const all = railItems(column);
  const shown = all.filter((item) => item.height > 0);
  const shifts = panelRailPins(shown, { scrollTop: column.scrollTop, clientHeight: column.clientHeight });
  let rail = 0;
  for (let k = 0; k < shown.length; k += 1) {
    railShift(shown[k].head, shifts[k]);
    if (shifts[k]) rail += shown[k].height;
  }
  for (const item of all) {
    if (item.height <= 0) railShift(item.head, 0);
    // Прилипший блок внутри тела (фильтры списка меток) липнет **под**
    // заголовком своего раздела, а не на нём: высоту заголовка он узнаёт мерой,
    // а не числом в стилях — иначе фильтры разошлись бы с заголовком на первой
    // же правке шрифта или отступов.
    railVar(item.section, "--panel-head", item.height);
  }
  railVar(column, "--panel-rail", rail);
  railHeight.set(column, rail);
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
