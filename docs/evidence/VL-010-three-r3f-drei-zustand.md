# VL-010 — Three.js, React Three Fiber, Drei и Zustand

## Подключённые библиотеки

- `three@0.185.1` — типы, материалы, векторы и объекты Three.js.
- `@react-three/fiber@9.6.1` — Canvas, рендеринг сцены и цикл `useFrame`.
- `@react-three/drei@10.7.7` — Environment, PointerLockControls, PresentationControls и useGLTF.
- `zustand@5.0.14` — общее состояние лаборатории.

## Реализация

- Основная 3D-сцена расположена в `src/pages/Laboratory.tsx`.
- Загружается GLB-модель лабораторной колбы.
- Реализовано управление камерой и перемещение WASD.
- Колбу можно вращать мышью.
- Двойной клик меняет цвет жидкости.
- Цвет жидкости и действия с ним вынесены в `src/state/useLaboratoryStore.ts`.
- Store содержит действия `toggleLiquidColor` и `resetLaboratory`.

## Проверки

```bash
npm ls three @react-three/fiber @react-three/drei zustand --depth=0
npm run build
npm run tauri -- dev
```

Результат ручной проверки Windows:

- приложение запускается;
- 3D-сцена отображается;
- GLB-модель колбы загружается;
- управление мышью и WASD работает;
- двойной клик изменяет цвет жидкости через Zustand;
- production-сборка проходит успешно.

