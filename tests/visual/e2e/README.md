# Сквозные прогоны опытов (как игрок)

1. `npm run dev` (порт 5173).
2. `node tests/visual/e2e/serve.mjs` — постоянное окно Chrome с игрой (CDP-порт 9333).
3. Шаги: `node tests/visual/e2e/do.mjs <имяСнимка> '<js>'` — в теле доступны `page`, `wait`, `shot`,
   `buttons` и помощники из `kb.js`: `startClassic`, `accept1`, `collect1`, `acceptExp`, `ppe`, `take`,
   `SALT`, `collectTubeStand`, `focus`, `back`, `doStep`, `toTable`, `standAtTable`, `panel`, `act`,
   `heatByDragging`, `equation`, `signs`. Снимки — в `tmp/visual/e2e/`.

Координаты кликов по шкафам рассчитаны на окно 1600×900 и текущую калибровку сцены.
Переход к шкафу — `setActiveTarget` + `requestFocus` (то же, что клик по хотспоту).
