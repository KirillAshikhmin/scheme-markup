// Значки развёртки: розетки, выключатели, розетки данных.
//
// Добавить значок — дописать запись сюда (требование G187, уточнение
// заказчика: «не зашивай все в один файл, что бы можно было легко менять и
// расширять список»). Больше ничего править не надо: `shapes` — это и есть
// привязка, реестр читает её сам.
//
// `mm` — размер вещи **на случай, когда у типа не задан свой**: умолчания
// живут у типа (G192), а здесь лежит последний рубеж для типа, заведённого
// руками.
import { iconCircle, iconKeys, iconLine, iconPlate, iconRoundRect } from "./kit.js";

export const ICONS_POWER = {
  // Розетка: плашка, контактные отверстия и заземляющие скобы.
  socket: {
    shapes: ["circle-socket"],
    mm: { width: 80, height: 80 },
    draw(ctx, box) {
      iconPlate(ctx, box);
      iconCircle(ctx, box, 0, 0, 0.3);
      iconCircle(ctx, box, -0.12, 0, 0.055);
      iconCircle(ctx, box, 0.12, 0, 0.055);
      iconLine(ctx, box, -0.3, -0.19, -0.3, 0.19);
      iconLine(ctx, box, 0.3, -0.19, 0.3, 0.19);
    },
  },
  // Трёхфазная: три отверстия по кругу — на развёртке так же, как на плане.
  socket380: {
    shapes: ["circle-triple"],
    mm: { width: 80, height: 80 },
    draw(ctx, box) {
      iconPlate(ctx, box);
      iconCircle(ctx, box, 0, 0, 0.3);
      for (const angle of [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6]) {
        iconCircle(ctx, box, Math.cos(angle) * 0.14, Math.sin(angle) * 0.14, 0.055);
      }
    },
  },
  // Выключатели: клавиш столько, сколько каналов. Это и есть разница между
  // «В», «ВВ» и «ВВВ», когда смотришь на стену.
  switch1: { shapes: ["square"], mm: { width: 80, height: 80 }, draw: (ctx, box) => iconKeys(ctx, box, 1) },
  switch2: { shapes: ["square-bar"], mm: { width: 80, height: 80 }, draw: (ctx, box) => iconKeys(ctx, box, 2) },
  switch3: { shapes: ["square-bar-two"], mm: { width: 80, height: 80 }, draw: (ctx, box) => iconKeys(ctx, box, 3) },
  // Переключатель: та же плашка, но с указателем направления на клавише.
  switchToggle: {
    shapes: ["square-chevron"],
    mm: { width: 80, height: 80 },
    draw(ctx, box) {
      iconKeys(ctx, box, 1);
      iconLine(ctx, box, -0.1, -0.1, 0.1, 0);
      iconLine(ctx, box, -0.1, 0.1, 0.1, 0);
    },
  },
  // Розетка данных: плашка с портом и защёлкой.
  data: {
    shapes: ["square-cross"],
    mm: { width: 80, height: 80 },
    draw(ctx, box) {
      iconPlate(ctx, box);
      iconRoundRect(ctx, box, -0.18, -0.2, 0.36, 0.34, 0.04);
      iconLine(ctx, box, -0.06, -0.2, -0.06, -0.3);
      iconLine(ctx, box, 0.06, -0.2, 0.06, -0.3);
      iconLine(ctx, box, -0.06, -0.3, 0.06, -0.3);
    },
  },
  // Щит: ящик с дверцей и рядами автоматов.
  panelBox: {
    shapes: ["square-hatch", "square-grid"],
    mm: { width: 450, height: 600 },
    draw(ctx, box) {
      iconPlate(ctx, box, 0.02, 0.06);
      iconLine(ctx, box, -0.24, -0.46, -0.24, 0.46);
      for (let index = 0; index < 3; index += 1) {
        const y = -0.26 + index * 0.26;
        iconLine(ctx, box, -0.16, y, 0.4, y);
      }
      iconCircle(ctx, box, -0.36, 0, 0.05);
    },
  },
};
