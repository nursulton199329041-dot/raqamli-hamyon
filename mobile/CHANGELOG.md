# Changelog

Format: [Semantic Versioning](https://semver.org). OTA updates (EAS Update) ship JS-only changes inside the
same `runtimeVersion` (= app version); anything touching native code/SDK/permissions needs a new store build
and a version bump (`app.json` -> `version`, Android `versionCode` / iOS `buildNumber` are auto-incremented by EAS).

## 1.0.0
- First React Native (Expo SDK 57) release replacing the Flutter client (`app/`, kept for reference).
- Dashboard with drag & drop (wallet→category = expense, wallet→wallet = transfer, source→wallet = income).
- Income / expense / transfer (multi-currency) / debts + repayment, projects, history with filters and search,
  analytics, CSV/XLSX/PDF export, budgets, uz/ru/en, dark/light, offline queue (SQLite) with idempotent sync.
- OTA update system, store-update policy (`/api/meta/client-policy`), update history log.