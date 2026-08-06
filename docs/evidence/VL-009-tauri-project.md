# VL-009 — Общий проект Tauri 2

## Результат

- Общая кодовая база: Tauri 2 + Vite + React + TypeScript.
- Поддерживаемые платформы MVP: Windows и Android.
- Browser-релиз не предусмотрен.
- Bundle identifier: `com.virtugenium.lab`.
- TypeScript strict: включён.
- Платформенно-зависимая бизнес-логика в `src` не обнаружена.

## Проверенные команды

### Windows dev

```bash
npm run tauri -- dev
```

Приложение Virtugenium Laboratory успешно открывается одной командой.

### Frontend production build

```bash
npm run build
```

Сборка завершена успешно. Предупреждение о chunk > 500 kB не блокирует релиз.

### Windows production build

```bash
npm run tauri -- build
```

Создан NSIS-установщик:
`src-tauri/target/release/bundle/nsis/virtugenium-lab_0.1.0_x64-setup.exe`

### Android production build

```bash
npm run tauri -- android build --apk
```

Создан universal APK:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

Установка и запуск Android APK на устройстве ранее подтверждены в VL-003.

## Структура и конфигурация

- Android-проект существует в `src-tauri/gen/android`.
- Frontend расположен в `src`.
- Нативная оболочка и Rust-код расположены в `src-tauri`.
- Vite игнорирует `src-tauri` при наблюдении за файлами; Rust-код отдельно отслеживает Tauri.
- Это устраняет ошибку Windows `EBUSY` при блокировке собираемой DLL.

## Документация

- Официальная документация Tauri 2: https://v2.tauri.app/

