// Изображения объектов на развёртке: свет.
//
// Двенадцать типов света стартового справочника делят одну форму
// `circle-cross` и получают одно изображение светильника. Бра от точечного на
// развёртке не отличить — ровно настолько, насколько их не отличить и на
// плане: форма у них общая, категорийная, и заказчик согласился на этот повтор
// сознательно. День, когда это станет мешать, лечится своей формой у бра (она
// же поможет плану), а не вторым ключом у изображения.
import { viewArc, viewLine, viewParts, viewRect } from "./kit.js";

export const VIEWS_LIGHT = {
  // Светильник: купол с лучами.
  lamp: {
    shapes: ["circle-cross", "circle", "circle-dot", "circle-rays", "circle-ring"],
    mm: { width: 90, height: 90 },
    parts: viewParts(
      viewArc(0, 0.06, 0.3, Math.PI, 0, true),
      viewLine(-0.34, 0.06, 0.34, 0.06),
      [[-0.42, 0.3], [0, 0.42], [0.42, 0.3]].map(([x, y]) => viewLine(x * 0.6, y * 0.55, x, y)),
    ),
  },
  // Ночник: тот же купол, но присевший к полу, и свет вниз.
  nightLight: {
    shapes: [],
    mm: { width: 80, height: 80 },
    parts: viewParts(
      viewRect(-0.34, -0.3, 0.68, 0.4, 0.1),
      [-0.18, 0, 0.18].map((x) => viewLine(x, 0.14, x, 0.36)),
    ),
  },
  // Лента вертикальная: полоса во всю высоту ниши — её и ставят по высоте.
  stripVertical: {
    shapes: ["rect-vertical", "rect-vertical-ticks"],
    mm: { width: 40, height: 600 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.3),
      [0, 1, 2, 3].map((index) => viewLine(-0.18, -0.32 + index * 0.21, 0.18, -0.32 + index * 0.21)),
    ),
  },
};
