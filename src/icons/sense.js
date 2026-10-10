// Значки развёртки: датчики.
import { iconArc, iconCircle, iconDrop, iconLine, iconPoly, iconRoundRect, iconWaves } from "./kit.js";

export const ICONS_SENSE = {
  // Присутствие: купол с дугами обзора.
  presence: {
    shapes: ["circle-fan"],
    mm: { width: 70, height: 70 },
    draw(ctx, box) {
      iconArc(ctx, box, 0, -0.16, 0.26, Math.PI, 0, true);
      iconWaves(ctx, box, 0, -0.16, [0.36, 0.46], 0.35, Math.PI - 0.35);
    },
  },
  // Движение: коробочка с линзой.
  motion: {
    shapes: ["triangle-dot"],
    mm: { width: 70, height: 70 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.34, -0.4, 0.68, 0.56, 0.14);
      iconCircle(ctx, box, 0, -0.12, 0.14);
      iconWaves(ctx, box, 0, -0.12, [0.34, 0.44], 0.4, Math.PI - 0.4);
    },
  },
  // Открытие: две части — на створке и на раме.
  opening: {
    shapes: ["square-split"],
    mm: { width: 70, height: 40 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.46, -0.3, 0.5, 0.6, 0.08);
      iconRoundRect(ctx, box, 0.12, -0.2, 0.34, 0.4, 0.08);
      iconLine(ctx, box, 0.04, 0, 0.12, 0);
    },
  },
  // Протечка: шайба с каплей и усами-электродами.
  leak: {
    shapes: ["drop"],
    mm: { width: 60, height: 60 },
    draw(ctx, box) {
      iconCircle(ctx, box, 0, -0.04, 0.3);
      iconDrop(ctx, box, 0, -0.08, 0.16);
      iconLine(ctx, box, -0.16, 0.3, -0.16, 0.44);
      iconLine(ctx, box, 0.16, 0.3, 0.16, 0.44);
    },
  },
  // Камера: корпус с объективом на кронштейне.
  camera: {
    shapes: ["diamond-ring"],
    mm: { width: 120, height: 80 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.46, -0.24, 0.6, 0.44, 0.08);
      iconPoly(ctx, box, [[0.14, -0.14], [0.4, -0.3], [0.4, 0.26], [0.14, 0.1]], true);
      iconLine(ctx, box, -0.2, 0.2, -0.2, 0.42);
    },
  },
};
