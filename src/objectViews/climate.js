// Изображения объектов на развёртке: климат.
//
// Здесь живёт тот самый кондиционер, ради которого таск 135 и затевался: его
// внутренний блок под метр по стене, и влезет он над дверью или нет — вопрос,
// на который отвечает только контур в настоящем размере.
import { viewCircle, viewDrop, viewLine, viewLouvers, viewParts, viewPoly, viewRect } from "./kit.js";

export const VIEWS_CLIMATE = {
  // Внутренний блок кондиционера: корпус с решёткой и индикатором.
  conditioner: {
    shapes: ["circle-thermo"],
    mm: { width: 900, height: 300 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 0.75, 0.16),
      viewLouvers(3, 0, 0.22, -0.4, 0.4),
      viewLine(-0.5, 0.25, 0.5, 0.25),
      viewCircle(0.36, -0.28, 0.05),
    ),
  },
  // Бризер: приточная коробка с круглой решёткой.
  breezer: {
    shapes: ["dome-dot", "dome"],
    mm: { width: 600, height: 350 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.14),
      viewCircle(0, 0, 0.26),
      viewCircle(0, 0, 0.1),
      viewLine(-0.26, 0, 0.26, 0),
      viewLine(0, -0.26, 0, 0.26),
    ),
  },
  // Вытяжка: зонт над плитой.
  hood: {
    shapes: ["circle-fill"],
    mm: { width: 600, height: 350 },
    parts: viewParts(
      viewPoly([[-0.5, 0.5], [-0.28, -0.2], [0.28, -0.2], [0.5, 0.5]], true),
      viewRect(-0.12, -0.5, 0.24, 0.3, 0.03),
      viewLouvers(2, 0.1, 0.4, -0.3, 0.3),
    ),
  },
  // Осушитель: напольная коробка с решёткой и каплей.
  dehumidifier: {
    shapes: ["drop-dot"],
    mm: { width: 400, height: 600 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.12),
      viewLouvers(3, -0.3, 0.05, -0.3, 0.3),
      viewDrop(0, 0.26, 0.16),
    ),
  },
};
