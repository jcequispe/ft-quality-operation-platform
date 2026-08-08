#!/usr/bin/env node

/**
 * Setup Sheets - Sube los CSVs locales a las pestañas de QPO-MASTER
 *
 * Los CSVs en data/ son la source of truth. Este script:
 * 1. Lee cada CSV local
 * 2. Escribe su contenido en la pestaña correspondiente de MASTER_SHEET_ID
 *
 * Uso: npm run setup
 *
 * Requiere que las 7 pestañas ya existan en QPO-MASTER con esos nombres
 * exactos (ver docs/architecture.md). Este script no crea pestañas nuevas.
 *
 * Cuando agregues columnas en un CSV, solo ejecuta npm run setup de nuevo.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

// Cargar variables de entorno
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

// Pestañas de QPO-MASTER a sincronizar, en el orden del CSV → pestaña
const SHEETS_CONFIG = [
  { name: "ROLES", csvFile: "data/roles.csv", description: "Roles y permisos" },
  { name: "AREAS", csvFile: "data/areas.csv", description: "Áreas técnicas" },
  { name: "USUARIOS", csvFile: "data/usuarios.csv", description: "Usuarios de la plataforma" },
  { name: "CBAS", csvFile: "data/cbas.csv", description: "Catálogo unificado de CBAs" },
  { name: "PASOS", csvFile: "data/pasos.csv", description: "Pasos de cada CBA por fase" },
  { name: "CHECKLISTS_INDEX", csvFile: "data/checklists_index.csv", description: "Índice de checklists creados" },
  { name: "ASIGNACIONES", csvFile: "data/asignaciones.csv", description: "Asignación de pasos por técnico" },
];

async function getAuthClient() {
  try {
    const { google } = await import("googleapis");

    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(PROJECT_ROOT, ".credentials", "service-account.json");

    if (!fs.existsSync(credentialsPath)) {
      throw new Error(
        `Credenciales no encontradas en: ${credentialsPath}\n` +
        `Ver: README.md para configurar`
      );
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    return auth.getClient();
  } catch (error) {
    console.error("❌ Error de autenticación:", error.message);
    process.exit(1);
  }
}

function parseCSV(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  CSV no encontrado: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
    });
    return records;
  } catch (error) {
    console.error(`❌ Error al leer ${filePath}:`, error.message);
    return null;
  }
}

async function updateSheet(auth, spreadsheetId, sheetName, data) {
  const { google } = await import("googleapis");
  const sheets = google.sheets({ version: "v4", auth });

  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  const values = [
    headers,
    ...data.map((row) => headers.map((h) => row[h] ?? "")),
  ];

  // Limpiar la pestaña completa (por rango, no requiere conocer el gid)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  // Si el CSV solo tiene cabecera (0 filas de datos), igual escribimos la cabecera
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  console.log(`   ✅ Actualizado: ${headers.length} columnas, ${data.length} filas`);
  return response.data;
}

async function main() {
  console.log("🚀 Setup Sheets - QPO-MASTER desde CSVs locales\n");

  if (!fs.existsSync(path.join(PROJECT_ROOT, ".env"))) {
    console.error("❌ Archivo .env no encontrado");
    console.log("   Copia .env.example a .env y completa MASTER_SHEET_ID\n");
    process.exit(1);
  }

  const masterSheetId = process.env.MASTER_SHEET_ID;
  if (!masterSheetId) {
    console.error("❌ MASTER_SHEET_ID no definido en .env");
    process.exit(1);
  }

  const auth = await getAuthClient();

  let successCount = 0;
  let skipCount = 0;

  for (const config of SHEETS_CONFIG) {
    const csvPath = path.join(PROJECT_ROOT, config.csvFile);

    console.log(`📄 ${config.name}`);
    console.log(`   ${config.description}`);

    if (!fs.existsSync(csvPath)) {
      console.log(`   ⚠️  CSV no encontrado: ${config.csvFile}`);
      skipCount++;
      console.log();
      continue;
    }

    const data = parseCSV(csvPath);
    if (data === null) {
      skipCount++;
      console.log();
      continue;
    }

    try {
      await updateSheet(auth, masterSheetId, config.name, data);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Fallo: ${error.message}`);
      console.error(`      Verifica que la pestaña "${config.name}" existe en QPO-MASTER`);
    }

    console.log();
  }

  console.log("═".repeat(50));
  console.log(`✨ Resultado: ${successCount} actualizados, ${skipCount} saltados`);

  if (skipCount > 0) {
    console.log("\n💡 Para actualizar los que faltaron:");
    console.log("   1. Verifica que el CSV existe en data/");
    console.log("   2. Ejecuta: npm run setup");
  }
}

main().catch((error) => {
  console.error("❌ Error fatal:", error);
  process.exit(1);
});
