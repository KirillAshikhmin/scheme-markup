// Значки развёртки: климат.
//
// Здесь живёт тот самый кондиционер, ради которого таск и затеян: его
// внутренний блок под метр по стене, и влезет он над дверью или нет — вопрос,
// на который отвечает только контур в настоящем размере.
import { iconCircle, iconDrop, iconLine, iconLouvers, iconPoly, iconRoundRect } from "./kit.js";

export const ICONS_CLIMATE = {
  // Внутренний блок кондиционера: корпус с решёткой и индикатором.
  conditioner: {
    shapes: ["circle-thermo"],
    mm: { width: 900, height: 300 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.5, -0.5, 1, 0.75, 0.16);
      iconLouvers(ctx, box, 3, 0, 0.22, -0.4, 0.4);
      iconLine(ctx, box, -0.5, 0.25, 0.5, 0.25);
      iconCircle(ctx, box, 0.36, -0.28, 0.05);
    },
  },
  // Бризер: приточная коробка с круглой решёткой.
  breezer: {
    shapes: ["dome-dot", "dome"],
    mm: { width: 600, height: 350 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.5, -0.5, 1, 1, 0.14);
      iconCircle(ctx, box, 0, 0, 0.26);
      iconCircle(ctx, box, 0, 0, 0.1);
      iconLine(ctx, box, -0.26, 0, 0.26, 0);
      iconLine(ctx, box, 0, -0.26, 0, 0.26);
    },
  },
  // Вытяжка: зонт над плитой.
  hood: {
    shapes: ["circle-fill"],
    mm: { width: 600, height: 350 },
    draw(ctx, box) {
      iconPoly(ctx, box, [[-0.5, 0.5], [-0.28, -0.2], [0.28, -0.2], [0.5, 0.5]], true);
      iconRoundRect(ctx, box, -0.12, -0.5, 0.24, 0.3, 0.03);
      iconLouvers(ctx, box, 2, 0.1, 0.4, -0.3, 0.3);
    },
  },
  // Осушитель: напольная коробка с решёткой и каплей.
  dehumidifier: {
    shapes: ["drop-dot"],
    mm: { width: 400, height: 600 },
    draw(ctx, box) {
      iconRoundRect(ctx, box, -0.5, -0.5, 1, 1, 0.12);
      iconLouvers(ctx, box, 3, -0.3, 0.05, -0.3, 0.3);
      iconDrop(ctx, box, 0, 0.26, 0.16);
    },
  },
};
