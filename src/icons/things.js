// Значки развёртки: сантехника, электроприборы, карнизы.
import { iconArc, iconCircle, iconDrop, iconLine, iconPlate, iconRoundRect } from "./kit.js";

export const ICONS_THINGS = {
  // Выход канализации: раструб с крестовиной.
  drain: {
    shapes: [],
    mm: { width: 110, height: 110 },
    draw(ctx, box) {
      iconCircle(ctx, box, 0, 0, 0.32);
      iconCircle(ctx, box, 0, 0, 0.18);
      iconLine(ctx, box, -0.32, 0, 0.32, 0);
      iconLine(ctx, box, 0, -0.32, 0, 0.32);
    },
  },

  // Кран с электроприводом: корпус крана с рукояткой привода.
  valve: {
    shapes: ["circle-valve"],
    mm: { width: 100, height: 100 },
    draw(ctx, box) {
      iconCircle(ctx, box, 0, 0.08, 0.26);
      iconLine(ctx, box, -0.44, 0.08, -0.26, 0.08);
      iconLine(ctx, box, 0.26, 0.08, 0.44, 0.08);
      iconLine(ctx, box, 0, -0.18, 0, -0.42);
      iconLine(ctx, box, -0.18, -0.42, 0.18, -0.42);
    },
  },
  // Водорозетка: вывод трубы с капелькой.
  waterOutlet: {
    shapes: [],
    mm: { width: 60, height: 60 },
    draw(ctx, box) {
      iconCircle(ctx, box, 0, 0, 0.3);
      iconCircle(ctx, box, 0, 0, 0.12);
      iconDrop(ctx, box, 0, 0.34, 0.14);
    },
  },
  // Робот-пылесос: шайба сбоку, с бампером и колёсами.
  vacuum: {
    shapes: ["trapezoid-bar"],
    mm: { width: 350, height: 100 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.5, -0.3, 1, 0.6, 0.26);
      iconLine(ctx, box, -0.5, 0.1, 0.5, 0.1);
      iconCircle(ctx, box, -0.26, 0.2, 0.08);
      iconCircle(ctx, box, 0.26, 0.2, 0.08);
    },
  },
  // Сушилка, дверца с приводом и прочая техника: коробка с приводом.
  appliance: {
    shapes: ["square-bolt", "square-ring"],
    mm: { width: 400, height: 500 },
    draw(ctx, box) {
      iconPlate(ctx, box, 0.04, 0.08);
      iconLine(ctx, box, -0.42, -0.18, 0.42, -0.18);
      iconCircle(ctx, box, 0, 0.16, 0.16);
      iconLine(ctx, box, 0, 0.16, 0.1, 0.06);
    },
  },
  // Карниз штор: труба на кронштейнах и складки ткани.
  curtainRail: {
    shapes: ["diamond"],
    mm: { width: 400, height: 120 },
    draw(ctx, box) {
      iconLine(ctx, box, -0.5, -0.28, 0.5, -0.28);
      iconLine(ctx, box, -0.5, -0.16, 0.5, -0.16);
      iconLine(ctx, box, -0.3, -0.16, -0.3, -0.34);
      iconLine(ctx, box, 0.3, -0.16, 0.3, -0.34);
      for (const x of [-0.3, 0, 0.3]) {
        iconArc(ctx, box, x, 0.12, 0.16, Math.PI, 0, false);
      }
    },
  },
};
