/**
 * ft-quality-operation-platform - GAS Web App
 *
 * Backend para gestión de checklists de calidad.
 * Integración con Google Sheets para persistencia de datos.
 */

// Sheet maestro que contiene los IDs de todos los demás sheets
const MAESTRO_SHEET_ID = "17cV-id6JYY7F14NIcpkMfuZ03QhjPb3cNRTViBrmT3Y";

// IDs de Google Sheets (se cargarán desde el maestro)
let SHEETS_IDS: Record<string, string> = {};

// Cargar configuración de IDs desde el sheet maestro
function loadSheetIds(): Record<string, string> {
  try {
    const ss = SpreadsheetApp.openById(MAESTRO_SHEET_ID);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    const ids: Record<string, string> = {};

    // Skip header row y buscar columna "Sheet ID"
    for (let i = 1; i < data.length; i++) {
      const tabla = String(data[i][0]).trim();
      const sheetId = String(data[i][1]).trim();

      if (tabla && sheetId && !sheetId.includes("[REEMPLAZAR")) {
        ids[tabla] = sheetId;
      }
    }

    SHEETS_IDS = ids;
    return ids;
  } catch (error) {
    console.log("Error al cargar IDs: " + error);
    return {};
  }
}

interface CBAStep {
  sec: string;
  tipoTarea: string;
  ambito: string;
  descripcion: string;
}

interface CBA {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  descripcion: string;
  estado: string;
  creado: string;
  responsable: string;
  pasos?: {
    preIntervention: CBAStep[];
    intervention: CBAStep[];
    postIntervention: CBAStep[];
    return: CBAStep[];
  };
}

interface Checklist {
  id: string;
  crq: string;
  emailOperador: string;
  templateId: string;
  spreadsheetId: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
  fechaCreacion: string;
}

/** Handle HTTP GET requests. Serves the main HTML page. */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  // Cargar IDs de sheets desde el maestro
  loadSheetIds();

  return HtmlService.createHtmlOutputFromFile("client")
    .setTitle("Gestión de CBAs - Networking")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Handle HTTP POST requests. */
function doPost(
  e: GoogleAppsScript.Events.DoPost,
): GoogleAppsScript.Content.TextOutput {
  const data = JSON.parse(e.postData.contents);
  const result = processRequest(data);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** Process incoming request data. */
function processRequest(data: Record<string, unknown>): Record<string, unknown> {
  const action = data.action as string;

  switch (action) {
    case "getCurrentUser":
      return getCurrentUser();
    case "getCBAs":
      return getCBAs();
    case "getCBASteps":
      return getCBASteps(data.cbaId as string);
    case "createCBA":
      return createCBA(data as unknown as CBA);
    case "saveCBASteps":
      return saveCBASteps(data.cbaId as string, data.pasos as unknown as Record<string, CBAStep[]>);
    case "deleteCBA":
      return deleteCBA(data.cbaId as string);
    case "createChecklist":
      return createChecklist(
        data.crq as string,
        data.templateId as string,
        data.fechaInicio as string,
        data.fechaFin as string,
        data.tipoChangio as string,
        data.level as string,
        data.freezing as string,
      );
    case "getOperatorChecklists":
      return getOperatorChecklists();
    case "getChecklistData":
      return getChecklistData(data.spreadsheetId as string);
    case "saveChecklistData":
      return saveChecklistData(data.spreadsheetId as string, data.data as unknown as Record<string, unknown>);
    case "getUsers":
      return getUsers();
    case "toggleUserActive":
      return toggleUserActive(data.email as string, data.active as boolean);
    case "createUser":
      return createUser(data as unknown as Record<string, unknown>);
    case "updateUser":
      return updateUser(data as unknown as Record<string, unknown>);
    default:
      return {
        status: "error",
        message: "Acción no reconocida",
      };
  }
}

/** Get current user - use email from config */
function getCurrentUser(): Record<string, unknown> {
  try {
    // Para testing: usar email del propietario del script
    // En producción, esto vendría de configuración o de parámetros URL
    const currentEmail = "jcequispe@gmail.com"; // Email del propietario del script

    if (!SHEETS_IDS.USUARIOS) {
      loadSheetIds();
    }

    const ss = SpreadsheetApp.openById(SHEETS_IDS.USUARIOS);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    // Skip header row y buscar usuario
    for (let i = 1; i < data.length; i++) {
      const userEmail = String(data[i][0]).toLowerCase();
      if (userEmail === currentEmail.toLowerCase()) {
        const user = {
          email: userEmail,
          nombre: String(data[i][1]),
          rol: String(data[i][2]),
          area: String(data[i][3]),
          estado: String(data[i][4]),
          activo: String(data[i][6]).toUpperCase() === "SI",
        };

        if (!user.activo) {
          return {
            status: "error",
            message: "Tu usuario está inactivo. Contacta al administrador.",
            user,
          };
        }

        return {
          status: "ok",
          user,
        };
      }
    }

    return {
      status: "error",
      message: `Usuario ${currentEmail} no encontrado en la plataforma. Contacta al administrador.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener usuario: ${error}`,
    };
  }
}

/** Get all CBAs from Google Sheet. */
function getCBAs(): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.CBAS_NETWORKING) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.CBAS_NETWORKING);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    // Skip header row
    const cbas: CBA[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      cbas.push({
        id: String(row[0]),
        codigo: String(row[1]),
        nombre: String(row[2]),
        categoria: String(row[3]),
        descripcion: String(row[4]),
        estado: String(row[5]),
        creado: String(row[6]),
        responsable: String(row[7]),
      });
    }

    return {
      status: "ok",
      cbas,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener CBAs: ${error}`,
    };
  }
}

/** Get steps for a specific CBA. */
function getCBASteps(cbaId: string): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.PASOS_CBAS) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.PASOS_CBAS);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    const pasos = {
      preIntervention: [] as CBAStep[],
      intervention: [] as CBAStep[],
      postIntervention: [] as CBAStep[],
      return: [] as CBAStep[],
    };

    // Skip header row and filter by CBA_ID
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[0]) !== cbaId) continue;

      const fase = String(row[1]).toLowerCase().replace(/-/g, "").replace(/intervención/g, "intervention");
      const step: CBAStep = {
        sec: Number(row[2]),
        tipoTarea: String(row[3]),
        ambito: String(row[4]),
        descripcion: String(row[5]),
        responsable: String(row[6]),
      };

      if (fase.includes("pre")) pasos.preIntervention.push(step);
      else if (fase.includes("intervention") && !fase.includes("post")) pasos.intervention.push(step);
      else if (fase.includes("post")) pasos.postIntervention.push(step);
      else if (fase.includes("retorno")) pasos.return.push(step);
    }

    return {
      status: "ok",
      pasos,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener pasos: ${error}`,
    };
  }
}

/** Create new CBA in Google Sheet. */
function createCBA(cba: CBA): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.CBAS_NETWORKING) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.CBAS_NETWORKING);
    const sheet = ss.getSheets()[0];

    const newRow = [
      cba.id,
      cba.codigo,
      cba.nombre,
      cba.categoria,
      cba.descripcion,
      "Pasos pendientes",
      new Date().toISOString().split("T")[0],
      cba.responsable,
    ];

    sheet.appendRow(newRow);

    return {
      status: "ok",
      message: "CBA creada exitosamente",
      cba,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear CBA: ${error}`,
    };
  }
}

/** Save steps for a CBA. */
function saveCBASteps(cbaId: string, pasos: Record<string, CBAStep[]>): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.PASOS_CBAS || !SHEETS_IDS.CBAS_NETWORKING) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.PASOS_CBAS);
    const sheet = ss.getSheets()[0];

    // Delete existing steps for this CBA
    const data = sheet.getDataRange().getValues() as unknown[][];
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === cbaId) {
        sheet.deleteRow(i + 1);
      }
    }

    // Add new steps
    const faseMap: Record<string, string> = {
      preIntervention: "PRE-INTERVENCIÓN",
      intervention: "INTERVENCIÓN",
      postIntervention: "POST-INTERVENCIÓN",
      return: "RETORNO",
    };

    for (const [faseKey, steps] of Object.entries(pasos)) {
      const faseName = faseMap[faseKey] || faseKey;
      for (const step of steps) {
        const newRow = [cbaId, faseName, step.sec, step.tipoTarea, step.ambito, step.descripcion, step.responsable];
        sheet.appendRow(newRow);
      }
    }

    // Update CBA status in CBAs sheet
    const cbasSheetId = SHEETS_IDS.CBAS_NETWORKING || (loadSheetIds() && SHEETS_IDS.CBAS_NETWORKING);
    const cbasSheet = SpreadsheetApp.openById(cbasSheetId).getSheets()[0];
    const cbasData = cbasSheet.getDataRange().getValues() as unknown[][];
    for (let i = 1; i < cbasData.length; i++) {
      if (String(cbasData[i][0]) === cbaId) {
        cbasSheet.getRange(i + 1, 6).setValue("Pasos definidos");
        break;
      }
    }

    return {
      status: "ok",
      message: "Pasos guardados exitosamente",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al guardar pasos: ${error}`,
    };
  }
}

/** Delete CBA from Google Sheet. */
function deleteCBA(cbaId: string): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.CBAS_NETWORKING || !SHEETS_IDS.PASOS_CBAS) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.CBAS_NETWORKING);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    // Find and delete CBA row
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === cbaId) {
        sheet.deleteRow(i + 1);
        break;
      }
    }

    // Delete associated steps
    const stepsSheetId = SHEETS_IDS.PASOS_CBAS || (loadSheetIds() && SHEETS_IDS.PASOS_CBAS);
    const stepsSheet = SpreadsheetApp.openById(stepsSheetId).getSheets()[0];
    const stepsData = stepsSheet.getDataRange().getValues() as unknown[][];
    for (let i = stepsData.length - 1; i >= 1; i--) {
      if (String(stepsData[i][0]) === cbaId) {
        stepsSheet.deleteRow(i + 1);
      }
    }

    return {
      status: "ok",
      message: "CBA eliminada exitosamente",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al eliminar CBA: ${error}`,
    };
  }
}

/** Create a new checklist based on a template. */
function createChecklist(
  crq: string,
  templateId: string,
  fechaInicio: string,
  fechaFin: string,
  tipoChangio: string,
  level: string,
  freezing: string,
): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.PASOS_CBAS || !SHEETS_IDS.METADATOS || !SHEETS_IDS.CBAS_NETWORKING) {
      loadSheetIds();
    }

    let currentEmail = "";
    try {
      currentEmail = Session.getEffectiveUser().getEmail();
    } catch {
      currentEmail = "jcequispe@gmail.com"; // Fallback email
    }

    // Get CBA info
    const cbasSheetData = SpreadsheetApp.openById(SHEETS_IDS.CBAS_NETWORKING)
      .getSheets()[0]
      .getDataRange()
      .getValues() as unknown[][];
    const cbaInfo = cbasSheetData.find((row, idx) => idx > 0 && String(row[0]) === templateId);
    const cbaCode = cbaInfo ? String(cbaInfo[1]) : "";
    const cbaName = cbaInfo ? String(cbaInfo[2]) : "";

    // Get template data
    const templateStepsSheetId = SHEETS_IDS.PASOS_CBAS;
    const templateSheetData = SpreadsheetApp.openById(templateStepsSheetId)
      .getSheets()[0]
      .getDataRange()
      .getValues() as unknown[][];

    // Filter template steps by templateId
    const templateSteps = templateSheetData.filter((row, idx) => idx > 0 && String(row[0]) === templateId);

    // Create a new Google Spreadsheet
    const newSpreadsheet = SpreadsheetApp.create(`Checklist_${crq}_${new Date().getTime()}`);
    const newSheet = newSpreadsheet.getSheets()[0];
    const spreadsheetId = newSpreadsheet.getId();

    // Share the spreadsheet with the current user
    try {
      const file = DriveApp.getFileById(spreadsheetId);
      file.addEditor(currentEmail);
    } catch (e) {
      console.log("Aviso: No se pudo compartir el archivo: " + e);
    }

    // Línea 1: Headers de información
    newSheet.appendRow(["", "Descripción Tipo de tarea", "CBA:", "", "", "", "", ""]);

    // Línea 2: Column headers
    newSheet.appendRow(["", "CRQ", "", "TÍTULO INTEREVENCIÓN", "Tipo de cambio", "FECHA INICIO", "FECHA FIN", "Freezing"]);

    // Línea 3: Data row
    newSheet.appendRow([
      "Level",
      crq,
      "",
      `${cbaCode} ${cbaName}`,
      tipoChangio,
      fechaInicio,
      fechaFin,
      freezing,
    ]);

    // Línea 4: Additional info
    newSheet.appendRow([
      level,
      "CookBook y/o FT",
      "",
      cbaName,
      "No Fast Track",
      "NA",
      "NA",
      "NA",
    ]);

    // Línea 5: Empty row
    newSheet.appendRow(["", "", "", "", "", "", "", ""]);

    // Línea 6-7: Version info
    newSheet.appendRow(["Version", "", ""]);
    newSheet.appendRow(["V01", "PERÚ", ""]);

    // Línea 8: Empty row
    newSheet.appendRow(["", "", "", "", "", "", "", "", "", "", ""]);

    // Fases para organizar los pasos
    const phases = [
      { name: "PRE-INTERVENCIÓN", key: "preIntervention", color: "#d32f2f" },
      { name: "INTERVENCIÓN", key: "intervention", color: "#1a73e8" },
      { name: "POST-INTERVENCIÓN", key: "postIntervention", color: "#4caf50" },
      { name: "RETORNO", key: "return", color: "#999" },
    ];

    // Headers para cada tabla
    const tableHeaders = [
      "Sec.",
      "Tipo de tarea",
      "Ámbito",
      "Descripción tarea",
      "Equipo Técnico",
      "Inicio Previsto",
      "Fin Previsto",
      "Inicio Real",
      "Fin Real",
      "Nombre del Técnico",
      "Resultado",
    ];

    let currentRow = 9;

    // Agrupar pasos por fase
    const stepsByPhase: Record<string, unknown[][]> = {
      preIntervention: [],
      intervention: [],
      postIntervention: [],
      return: [],
    };

    templateSteps.forEach((row) => {
      const fase = String(row[1]).toLowerCase().replace(/-/g, "").replace(/intervención/g, "intervention");
      const stepRow = [
        String(row[2]), // Sec.
        String(row[3]), // Tipo
        String(row[4]), // Ámbito
        String(row[5]), // Descripción
        "", // Equipo Técnico
        fechaInicio, // Inicio Previsto
        fechaFin, // Fin Previsto
        "", // Inicio Real
        "", // Fin Real
        "", // Nombre Técnico
        "", // Resultado
      ];

      if (fase.includes("pre")) stepsByPhase.preIntervention.push(stepRow);
      else if (fase.includes("intervention") && !fase.includes("post")) stepsByPhase.intervention.push(stepRow);
      else if (fase.includes("post")) stepsByPhase.postIntervention.push(stepRow);
      else if (fase.includes("retorno")) stepsByPhase.return.push(stepRow);
    });

    // Insertar cada fase con sus datos
    phases.forEach((phase) => {
      // Encabezado de fase
      newSheet.appendRow([phase.name]);
      currentRow++;

      // Headers de columnas
      newSheet.appendRow(tableHeaders);
      currentRow++;

      // Datos de la fase
      const phaseSteps = stepsByPhase[phase.key] || [];
      if (phaseSteps.length === 0) {
        // Si no hay pasos, insertar una fila vacía
        newSheet.appendRow(["", "", "", "", "", "", "", "", "", "", ""]);
        currentRow++;
      } else {
        phaseSteps.forEach((stepRow) => {
          newSheet.appendRow(stepRow);
          currentRow++;
        });
      }
    });

    // Save metadata
    if (!SHEETS_IDS.METADATOS) {
      loadSheetIds();
    }
    const metadataSheet = SpreadsheetApp.openById(SHEETS_IDS.METADATOS).getSheets()[0];
    const checklistId = `CHK-${crq}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    metadataSheet.appendRow([
      crq,
      currentEmail,
      templateId,
      spreadsheetId,
      fechaInicio,
      fechaFin,
      "Activo",
      new Date().toISOString().split("T")[0],
      checklistId,
    ]);

    return {
      status: "ok",
      message: "Checklist creado exitosamente",
      checklistId,
      spreadsheetId,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear checklist: ${error}`,
    };
  }
}

/** Get all checklists for the current operator. */
function getOperatorChecklists(): Record<string, unknown> {
  try {
    const currentEmail = "jcequispe@gmail.com"; // Fallback email

    if (!SHEETS_IDS.METADATOS) {
      const loaded = loadSheetIds();
      if (!loaded.METADATOS) {
        return {
          status: "error",
          message: "Tabla METADATOS no configurada en el maestro",
        };
      }
    }

    const ss = SpreadsheetApp.openById(SHEETS_IDS.METADATOS);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    const checklists: Checklist[] = [];

    // Skip header row and filter by current email
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[1]).toLowerCase() === currentEmail.toLowerCase()) {
        // Use checklistId from column 9 if it exists, otherwise generate one
        const checklistId = row[8] && String(row[8]).trim() !== "" ? String(row[8]) : `CHK-${String(row[0])}-${String(row[3])}`;

        checklists.push({
          id: checklistId,
          crq: String(row[0]),
          emailOperador: String(row[1]),
          templateId: String(row[2]),
          spreadsheetId: String(row[3]),
          fechaInicio: String(row[4]),
          fechaFin: String(row[5]),
          estado: String(row[6]),
          fechaCreacion: String(row[7]),
        });
      }
    }

    return {
      status: "ok",
      checklists,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener checklists: ${error}`,
    };
  }
}

/** Get data from a checklist spreadsheet. */
function getChecklistData(spreadsheetId: string): Record<string, unknown> {
  try {
    console.log("1. spreadsheetId recibido:", spreadsheetId);
    console.log("2. Tipo de spreadsheetId:", typeof spreadsheetId);
    console.log("3. Largo del spreadsheetId:", spreadsheetId ? spreadsheetId.length : "null");

    console.log("4. Intentando abrir spreadsheet...");
    const ss = SpreadsheetApp.openById(spreadsheetId);
    console.log("5. Spreadsheet abierto exitosamente");

    console.log("6. Obteniendo primera hoja...");
    const sheet = ss.getSheets()[0];
    console.log("7. Hoja obtenida:", sheet.getName());

    console.log("8. Obteniendo datos del rango...");
    const data = sheet.getDataRange().getValues() as unknown[][];
    console.log("9. Datos obtenidos. Filas:", data.length);

    console.log("10. Convirtiendo datos a JSON seguro...");
    const headers = data[0] ? data[0].map((h) => String(h)) : [];
    const rows = data.slice(1).map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));

    console.log("11. Headers convertidos:", headers.length);
    console.log("12. Rows convertidas:", rows.length);

    console.log("13. Retornando resultado exitosamente");
    const resultado = {
      status: "ok",
      spreadsheetId,
      headers,
      rows,
    };
    console.log("14. Resultado a retornar:", JSON.stringify(resultado).substring(0, 100));
    return resultado;
  } catch (error) {
    console.log("ERROR capturado:", error);
    return {
      status: "error",
      message: `Error al obtener datos del checklist: ${error}`,
    };
  }
}

/** Save checklist data to spreadsheet. */
function saveChecklistData(spreadsheetId: string, data: Record<string, unknown>): Record<string, unknown> {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheets()[0];

    // Update rows based on provided data
    const rows = data.rows as unknown[][];
    for (let i = 0; i < rows.length; i++) {
      sheet.getRange(i + 2, 1, 1, rows[i].length).setValues([rows[i]]);
    }

    return {
      status: "ok",
      message: "Datos guardados exitosamente",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al guardar datos: ${error}`,
    };
  }
}

/** Get all users from Google Sheet. */
function getUsers(): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.USUARIOS) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.USUARIOS);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    const users: Record<string, unknown>[] = [];

    // Skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      users.push({
        email: String(row[0]).toLowerCase(),
        nombre: String(row[1]),
        rol: String(row[2]),
        area: String(row[3]),
        estado: String(row[4]),
        activo: String(row[6]).toUpperCase() === "SI",
      });
    }

    return {
      status: "ok",
      users,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener usuarios: ${error}`,
    };
  }
}

/** Toggle user active status. */
function toggleUserActive(email: string, active: boolean): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.USUARIOS) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.USUARIOS);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    // Find user row and update column 7 (activo)
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === email.toLowerCase()) {
        sheet.getRange(i + 1, 7).setValue(active ? "SI" : "NO");
        return {
          status: "ok",
          message: `Usuario ${active ? "activado" : "desactivado"} exitosamente`,
        };
      }
    }

    return {
      status: "error",
      message: "Usuario no encontrado",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al cambiar estado del usuario: ${error}`,
    };
  }
}

/** Create a new user in Google Sheet. */
function createUser(data: Record<string, unknown>): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.USUARIOS) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.USUARIOS);
    const sheet = ss.getSheets()[0];

    const newRow = [
      String(data.email).toLowerCase(),
      String(data.nombre),
      String(data.rol),
      String(data.area),
      String(data.estado),
      "",
      data.activo ? "SI" : "NO",
    ];

    sheet.appendRow(newRow);

    return {
      status: "ok",
      message: "Usuario creado exitosamente",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear usuario: ${error}`,
    };
  }
}

/** Update an existing user in Google Sheet. */
function updateUser(data: Record<string, unknown>): Record<string, unknown> {
  try {
    if (!SHEETS_IDS.USUARIOS) {
      loadSheetIds();
    }
    const ss = SpreadsheetApp.openById(SHEETS_IDS.USUARIOS);
    const sheet = ss.getSheets()[0];
    const sheetData = sheet.getDataRange().getValues() as unknown[][];

    const email = String(data.email).toLowerCase();

    // Find user row and update
    for (let i = 1; i < sheetData.length; i++) {
      if (String(sheetData[i][0]).toLowerCase() === email) {
        sheet.getRange(i + 1, 2).setValue(data.nombre); // nombre
        sheet.getRange(i + 1, 3).setValue(data.rol); // rol
        sheet.getRange(i + 1, 4).setValue(data.area); // area
        sheet.getRange(i + 1, 5).setValue(data.estado); // estado
        sheet.getRange(i + 1, 7).setValue(data.activo ? "SI" : "NO"); // activo

        return {
          status: "ok",
          message: "Usuario actualizado exitosamente",
        };
      }
    }

    return {
      status: "error",
      message: "Usuario no encontrado",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al actualizar usuario: ${error}`,
    };
  }
}
