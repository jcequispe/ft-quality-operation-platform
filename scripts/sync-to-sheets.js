#!/usr/bin/env node

/**
 * Sincroniza QPO-MASTER (Google Sheets) → CSVs locales
 * Uso: npm run sync
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const TABS = [
  { name: "ROLES", csvFile: "data/roles.csv" },
  { name: "AREAS", csvFile: "data/areas.csv" },
  { name: "USUARIOS", csvFile: "data/usuarios.csv" },
  { name: "CBAS", csvFile: "data/cbas.csv" },
  { name: "PASOS", csvFile: "data/pasos.csv" },
  { name: "CHECKLISTS_INDEX", csvFile: "data/checklists_index.csv" },
  { name: "ASIGNACIONES", csvFile: "data/asignaciones.csv" },
];

async function getAuthClient() {
  try {
    const { google } = await import("googleapis");

    const credentialsPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(PROJECT_ROOT, ".credentials", "service-account.json");

    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`No se encontraron credenciales en:\n  - ${credentialsPath}\n\nVer: README.md`);
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    return auth.getClient();
  } catch (error) {
    console.error("❌ Error de autenticación. Necesitas configurar Google Sheets API.");
    console.error("   Ver: README.md para instrucciones\n");
    console.error(error.message);
    process.exit(1);
  }
}

function toCSV(rows) {
  if (rows.length === 0) return "";
  const headers = rows[0];
  const body = rows.slice(1);
  const escape = (cell) => {
    const value = cell === null || cell === undefined ? "" : String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return [headers, ...body].map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

async function main() {
  console.log("🔄 Sincronizando QPO-MASTER → CSVs locales...\n");

  const masterSheetId = process.env.MASTER_SHEET_ID;
  if (!masterSheetId) {
    console.error("❌ MASTER_SHEET_ID no definido en .env");
    process.exit(1);
  }

  const auth = await getAuthClient();
  const { google } = await import("googleapis");
  const sheets = google.sheets({ version: "v4", auth });

  let successCount = 0;

  for (const tab of TABS) {
    console.log(`📄 Procesando pestaña: ${tab.name}`);

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: masterSheetId,
        range: `${tab.name}!A:Z`,
      });

      const values = response.data.values || [];
      if (values.length === 0) {
        console.warn(`   ⚠️  Pestaña vacía, se omite\n`);
        continue;
      }

      const csvPath = path.join(PROJECT_ROOT, tab.csvFile);
      fs.writeFileSync(csvPath, toCSV(values));
      console.log(`   └─ Registros: ${values.length - 1}`);
      console.log(`   ✅ Guardado en ${tab.csvFile}\n`);

      successCount++;
    } catch (error) {
      console.error(`   ❌ Error al leer "${tab.name}": ${error.message}\n`);
    }
  }

  if (successCount > 0) {
    console.log(`✨ Sincronización completada: ${successCount} pestañas descargadas`);
  } else {
    console.log("⚠️  No se sincronizó ninguna pestaña");
  }
}

main().catch((error) => {
  console.error("❌ Error fatal:", error);
  process.exit(1);
});
