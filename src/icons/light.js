// Значки развёртки: свет.
//
// Двенадцать типов света стартового справочника делят одну форму
// `circle-cross` и получают один значок светильника. Бра от точечного на
// развёртке не отличить — ровно настолько, насколько их не отличить и на
// плане: форма у них общая, категорийная, и заказчик согласился на этот повтор
// сознательно. День, когда это станет мешать, лечится своей формой у бра (она
// же поможет плану), а не вторым ключом у значка.
import { iconArc, iconLine, iconRoundRect } from "./kit.js";

export const ICONS_LIGHT = {
  // Светильник: купол с лучами.
  lamp: {
    shapes: ["circle-cross", "circle", "circle-dot", "circle-rays", "circle-ring"],
    mm: { width: 90, height: 90 },
    draw(ctx, box) {
      iconArc(ctx, box, 0, 0.06, 0.3, Math.PI, 0, true);
      iconLine(ctx, box, -0.34, 0.06, 0.34, 0.06);
      for (const [x, y] of [[-0.42, 0.3], [0, 0.42], [0.42, 0.3]]) {
        iconLine(ctx, box, x * 0.6, y * 0.55, x, y);
      }
    },
  },
  // Ночник: тот же купол, но присевший к полу, и свет вниз.
  nightLight: {
    shapes: [],
    mm: { width: 80, height: 80 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.34, -0.3, 0.68, 0.4, 0.1);
      for (const x of [-0.18, 0, 0.18]) iconLine(ctx, box, x, 0.14, x, 0.36);
    },
  },
  // Лента вертикальная: полоса во всю высоту ниши — её и ставят по высоте.
  stripVertical: {
    shapes: ["rect-vertical", "rect-vertical-ticks"],
    mm: { width: 40, height: 600 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.5, -0.5, 1, 1, 0.3);
      for (let index = 0; index < 4; index += 1) {
        const y = -0.32 + index * 0.21;
        iconLine(ctx, box, -0.18, y, 0.18, y);
      }
    },
  },
};
