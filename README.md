# ft-quality-operation-platform

Plataforma de gestión de calidad operacional: catálogo de CBAs (procedimientos estandarizados de cambio) y checklists de ejecución en campo, para un equipo de ~12 personas (ADMIN / LIDER-TEAM / OPERADOR). Es una Google Apps Script Web App con Google Sheets como almacenamiento.

**Antes de tocar código, lee:**
- [`docs/architecture.md`](docs/architecture.md) — arquitectura objetivo (modelo C4)
- [`docs/requisitos-funcionales.md`](docs/requisitos-funcionales.md) — qué debe hacer el sistema por rol

## Stack

| Capa | Tecnología |
|---|---|
| Backend | TypeScript compilado a Google Apps Script vía [`@gas-plugin/unplugin`](https://github.com/nicr-org/gas-plugin) + [Bun](https://bun.sh) |
| Frontend | HTML/CSS/JS servido por `doGet()` (sin framework) |
| Datos | Google Sheets (`SpreadsheetApp` / `DriveApp` en runtime) |
| Sync local | Node.js + [`googleapis`](https://www.npmjs.com/package/googleapis), [`csv-parse`](https://www.npmjs.com/package/csv-parse), [`dotenv`](https://www.npmjs.com/package/dotenv) |
| Deploy | [`clasp`](https://github.com/google/clasp) |
| Lint/format | [Biome](https://biomejs.dev) |

## Estructura del repo

```
src/            Backend (index.ts) + frontend (client.html)
dist/           Output compilado para Apps Script
docs/           Arquitectura (C4) y requisitos funcionales
data/           CSVs fuente de las tablas maestras — ver más abajo
scripts/        setup-sheets.js / sync-to-sheets.js (CSV ↔ Google Sheets)
appsscript.json GAS manifest
```

## Setup

```bash
npm install
cp .env.example .env
```

Completa `.env` con el `MASTER_SHEET_ID` del spreadsheet `QPO-MASTER` (ver `docs/architecture.md`) y las credenciales de una Service Account con acceso de editor a ese sheet — instrucciones dentro del propio `.env.example`.

## Workflow de datos (CSV → Google Sheets)

Las tablas maestras (`ROLES`, `AREAS`, `USUARIOS`, `CBAS`, `PASOS`, `CHECKLISTS_INDEX`, `ASIGNACIONES`) se editan como CSV en `data/` y se sincronizan con el spreadsheet real:

```bash
npm run setup   # data/*.csv → Google Sheets
npm run sync    # Google Sheets → data/*.csv
```

## Build y deploy

```bash
npm run build   # Compila src/ → dist/ (Bun + @gas-plugin/unplugin)
npm run push    # clasp push
npm run deploy  # clasp push + clasp deploy
```

Requiere `clasp login` una vez, y un proyecto GAS vinculado (`clasp create` o `clasp clone <scriptId>`).
