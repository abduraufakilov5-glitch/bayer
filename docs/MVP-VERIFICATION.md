# Проверка Bayer

Актуальные сценарии находятся в `tests/e2e/workflows.spec.ts`, SQL/RLS — в `tests/database.test.ts`, `tests/reliable-workflow.test.ts`, совместимость миграции — в `tests/upgrade.test.ts`, cron — в `tests/maintenance.test.ts`.

Порядок: `npm ci`, `npm run check`, `npm run build`, `npx playwright install --with-deps chromium webkit`, `npm run test:e2e`.

Состояние фактически выполненных проверок: `docs/AUDIT.md` и итоговый отчёт. Релиз: `docs/RELEASE.md`. Старые описания каталога, CSV и отката всего заказа не являются текущими сценариями.
