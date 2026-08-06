# VL-011 — структура проекта и доменные типы

## Созданные слои

- `src/app` — корневая сборка приложения и маршруты.
- `src/features` — пользовательские функции приложения.
- `src/entities` — доменные сущности, типы и бизнес-логика.
- `src/scenes` — трехмерные сцены.
- `src/stores` — Zustand-хранилища.
- `src/data` — JSON-данные и JSON Schema.
- `src/assets` — статические ресурсы.
- `src/shared` — общие интерфейсные компоненты.

## Доменные модули

- `src/entities/laboratory`
- `src/entities/equation`
- Публичные точки входа через `index.ts`.
- Валидатор уравнений не зависит от React, Zustand и интерфейса.

## Инструменты проверки

- ESLint с поддержкой TypeScript и React.
- TypeScript strict и команда `npm run typecheck`.
- Madge и команда `npm run check:cycles`.

## Результаты проверки

- `npm run lint` — успешно.
- `npm run typecheck` — успешно.
- `npm run check:cycles` — циклических импортов не найдено.
- `npm run validate:data` — все примеры проверены успешно.
- `npm run validate:equations` — проверено 20 примеров.
- `npm run build` — production-сборка успешна.

## Примечание

Vite выводит неблокирующее предупреждение о размере JavaScript-пакета из-за Three.js. Оптимизация разделения пакета не входит в VL-011.
