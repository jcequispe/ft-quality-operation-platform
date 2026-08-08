/**
 * ft-quality-operation-platform - GAS Web App
 *
 * Backend para gestión de checklists de calidad.
 * Integración con Google Sheets para persistencia de datos.
 *
 * Arquitectura: ver docs/architecture.md — un único spreadsheet "QPO-MASTER"
 * con 7 pestañas (ROLES, AREAS, USUARIOS, CBAS, PASOS, CHECKLISTS_INDEX,
 * ASIGNACIONES). Los checklists de cada CRQ siguen siendo spreadsheets
 * independientes, referenciados desde CHECKLISTS_INDEX.
 */

const MASTER_SHEET_ID = "1wFBT60fDLLTRSXIfOVErcwuSUZWcO9K0Ygm-5MPdwgc";

/** Abre una pestaña de QPO-MASTER por nombre. */
function getMasterSheet(tabName: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(tabName);
  if (!sheet) {
    throw new Error(`Pestaña "${tabName}" no encontrada en QPO-MASTER`);
  }
  return sheet;
}

interface CBAStep {
  sec: string;
  tipoTarea: string;
  ambito: string;
  descripcion: string;
  responsable: string;
}

interface CBA {
  id: string;
  codigoArea: string;
  areaTecnica: string;
  nombreTipologia: string;
  gestionDelCambio: string;
  nombreCBA: string;
  candidataL04: string;
  candidataL05: string;
  madurez: string;
  letraCBA: string;
  numeroCookbok: string;
  urlCBA: string;
  codificacionTipologia: string;
  secuencia: number;
  tituloCatalogo: string;
  fechaIncorporacion: string;
  personaQO: string;
  estado: string;
  fechaCreacion: string;
  pasos?: {
    preIntervention: CBAStep[];
    intervention: CBAStep[];
    postIntervention: CBAStep[];
    return: CBAStep[];
  };
}

interface CBANew {
  id?: string;
  codigoArea: string;
  areaTecnica: string;
  nombreTipologia: string;
  gestionDelCambio: string;
  nombreCBA: string;
  candidataL04: string;
  candidataL05: string;
  madurez: string;
  letraCBA: string;
  numeroCookbok: string;
  urlCBA: string;
  codificacionTipologia: string;
  secuencia: number;
  tituloCatalogo: string;
  fechaIncorporacion: string;
  personaQO: string;
  estado?: string;
}

interface Area {
  codigo: string;
  nombre: string;
}

interface Checklist {
  id: string;
  crq: string;
  cbaId: string;
  spreadsheetId: string;
  creadoPor: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
  fechaCreacion: string;
}

/** Handle HTTP GET requests. Serves the main HTML page. */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
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
      return createCBA(data as unknown as CBANew);
    case "updateCBA":
      return updateCBA(data.id as string, data as unknown as CBANew);
    case "saveCBASteps":
      return saveCBASteps(data.cbaId as string, data.pasos as unknown as Record<string, CBAStep[]>);
    case "deleteCBA":
      return deleteCBA(data.cbaId as string);
    case "getAreas":
      return getAreas();
    case "createArea":
      return createArea(data.codigo as string, data.nombre as string);
    case "updateArea":
      return updateArea(data.codigoAnterior as string, data.codigo as string, data.nombre as string);
    case "deleteArea":
      return deleteArea(data.codigo as string);
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
    case "getMyChecklists":
      return getMyChecklists();
    case "assignStep":
      return assignStep(data.checklistId as string, data.pasoSec as string, data.email as string);
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
    case "deleteChecklist":
      return deleteChecklist(data.spreadsheetId as string);
    default:
      return {
        status: "error",
        message: "Acción no reconocida",
      };
  }
}

/** Resuelve el email del usuario actual (sesión de Google, con fallback para pruebas locales). */
function resolveCurrentEmail(): string {
  try {
    const email = Session.getEffectiveUser().getEmail();
    if (email) return email;
  } catch {
    // sigue al fallback
  }
  return "jcequispe@gmail.com";
}

/** Get current user - use email from config */
function getCurrentUser(): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();

    const sheet = getMasterSheet("USUARIOS");
    const data = sheet.getDataRange().getValues() as unknown[][];

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

/** Busca el rol de un usuario por email en USUARIOS. */
function getUserRole(email: string): string | null {
  try {
    const sheet = getMasterSheet("USUARIOS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === email.toLowerCase()) {
        return String(data[i][2]);
      }
    }
    return null;
  } catch (error) {
    console.log("Error al obtener rol: " + error);
    return null;
  }
}

/** Check if user is ADMIN */
function isAdminUser(email: string): boolean {
  return getUserRole(email) === "ADMIN";
}

/** Check if user is LIDER-TEAM */
function isLiderTeamUser(email: string): boolean {
  return getUserRole(email) === "LIDER-TEAM";
}

/** Get all areas */
function getAreas(): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("AREAS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    const areas: Area[] = [];
    for (let i = 1; i < data.length; i++) {
      const codigo = String(data[i][0]).trim();
      const nombre = String(data[i][1]).trim();
      if (codigo && nombre) {
        areas.push({ codigo, nombre });
      }
    }

    return {
      status: "ok",
      areas,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener áreas: ${error}`,
    };
  }
}

/** Create new area */
function createArea(codigo: string, nombre: string): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return {
        status: "error",
        message: "Solo administradores pueden crear áreas",
      };
    }

    const sheet = getMasterSheet("AREAS");
    sheet.appendRow([codigo, nombre]);

    return {
      status: "ok",
      message: "Área creada exitosamente",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear área: ${error}`,
    };
  }
}

/** Update area */
function updateArea(codigoAnterior: string, codigo: string, nombre: string): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return {
        status: "error",
        message: "Solo administradores pueden editar áreas",
      };
    }

    const sheet = getMasterSheet("AREAS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === codigoAnterior) {
        sheet.getRange(i + 1, 1).setValue(codigo);
        sheet.getRange(i + 1, 2).setValue(nombre);
        return {
          status: "ok",
          message: "Área actualizada exitosamente",
        };
      }
    }

    return {
      status: "error",
      message: "Área no encontrada",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al actualizar área: ${error}`,
    };
  }
}

/** Delete area */
function deleteArea(codigo: string): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return {
        status: "error",
        message: "Solo administradores pueden eliminar áreas",
      };
    }

    const sheet = getMasterSheet("AREAS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === codigo) {
        sheet.deleteRow(i + 1);
        return {
          status: "ok",
          message: "Área eliminada exitosamente",
        };
      }
    }

    return {
      status: "error",
      message: "Área no encontrada",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al eliminar área: ${error}`,
    };
  }
}

/** Get all CBAs from QPO-MASTER (pestaña CBAS, unificada para todas las áreas). */
function getCBAs(): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("CBAS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    const cbas: CBA[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      cbas.push({
        id: String(row[0]),
        codigoArea: String(row[1]),
        areaTecnica: String(row[2]),
        nombreTipologia: String(row[3]),
        gestionDelCambio: String(row[4]),
        nombreCBA: String(row[5]),
        candidataL04: String(row[6]),
        candidataL05: String(row[7]),
        madurez: String(row[8]),
        letraCBA: String(row[9]),
        numeroCookbok: String(row[10]),
        urlCBA: String(row[11]),
        codificacionTipologia: String(row[12]),
        secuencia: Number.isFinite(Number(row[13])) ? Number(row[13]) : 0,
        tituloCatalogo: String(row[14]),
        fechaIncorporacion: String(row[15]),
        personaQO: String(row[16]),
        estado: String(row[17]),
        fechaCreacion: String(row[18]),
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
    const sheet = getMasterSheet("PASOS");
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
        sec: String(row[2]),
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

/** Create new CBA in QPO-MASTER */
function createCBA(cba: CBANew): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return {
        status: "error",
        message: "Solo administradores pueden crear CBAs",
      };
    }

    const sheet = getMasterSheet("CBAS");

    const id = `CBA-${String(Date.now()).slice(-8)}`;
    const estado = "Pasos pendientes";

    const newRow = [
      id,
      cba.codigoArea,
      cba.areaTecnica,
      cba.nombreTipologia,
      cba.gestionDelCambio,
      cba.nombreCBA,
      cba.candidataL04,
      cba.candidataL05,
      cba.madurez,
      cba.letraCBA,
      cba.numeroCookbok,
      cba.urlCBA,
      cba.codificacionTipologia,
      cba.secuencia,
      cba.tituloCatalogo,
      cba.fechaIncorporacion,
      cba.personaQO,
      estado,
      new Date().toISOString().split("T")[0],
    ];

    sheet.appendRow(newRow);

    return {
      status: "ok",
      message: "CBA creada exitosamente",
      id,
      cba,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear CBA: ${error}`,
    };
  }
}

/** Update existing CBA */
function updateCBA(id: string, cba: CBANew): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return {
        status: "error",
        message: "Solo administradores pueden editar CBAs",
      };
    }

    const sheet = getMasterSheet("CBAS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        const updateRow = [
          id,
          cba.codigoArea,
          cba.areaTecnica,
          cba.nombreTipologia,
          cba.gestionDelCambio,
          cba.nombreCBA,
          cba.candidataL04,
          cba.candidataL05,
          cba.madurez,
          cba.letraCBA,
          cba.numeroCookbok,
          cba.urlCBA,
          cba.codificacionTipologia,
          cba.secuencia,
          cba.tituloCatalogo,
          cba.fechaIncorporacion,
          cba.personaQO,
          data[i][17],
          data[i][18],
        ];

        sheet.getRange(i + 1, 1, 1, updateRow.length).setValues([updateRow]);

        return {
          status: "ok",
          message: "CBA actualizada exitosamente",
          id,
        };
      }
    }

    return {
      status: "error",
      message: "CBA no encontrada",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al actualizar CBA: ${error}`,
    };
  }
}

/** Save steps for a CBA. */
function saveCBASteps(cbaId: string, pasos: Record<string, CBAStep[]>): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("PASOS");

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

    // Update CBA status in CBAS
    const cbasSheet = getMasterSheet("CBAS");
    const cbasData = cbasSheet.getDataRange().getValues() as unknown[][];
    for (let i = 1; i < cbasData.length; i++) {
      if (String(cbasData[i][0]) === cbaId) {
        cbasSheet.getRange(i + 1, 18).setValue("Pasos definidos"); // columna 18 = estado
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

/** Delete CBA from QPO-MASTER. */
function deleteCBA(cbaId: string): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("CBAS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    // Find and delete CBA row
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === cbaId) {
        sheet.deleteRow(i + 1);
        break;
      }
    }

    // Delete associated steps
    const stepsSheet = getMasterSheet("PASOS");
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

/**
 * Create a new checklist based on a template.
 * Solo LIDER-TEAM puede crear checklists (RF-5.1) — luego asigna cada paso
 * a un técnico con assignStep().
 */
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
    const currentEmail = resolveCurrentEmail();

    if (!isLiderTeamUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo LIDER-TEAM puede crear checklists",
      };
    }

    // Get CBA info
    const cbasSheetData = getMasterSheet("CBAS").getDataRange().getValues() as unknown[][];
    const cbaInfo = cbasSheetData.find((row, idx) => idx > 0 && String(row[0]) === templateId);
    const cbaCode = cbaInfo ? String(cbaInfo[12]) : ""; // codificacionTipologia
    const cbaName = cbaInfo ? String(cbaInfo[5]) : ""; // nombreCBA

    // Get template steps
    const templateSheetData = getMasterSheet("PASOS").getDataRange().getValues() as unknown[][];
    const templateSteps = templateSheetData.filter((row, idx) => idx > 0 && String(row[0]) === templateId);

    // Create a new Google Spreadsheet
    const newSpreadsheet = SpreadsheetApp.create(`Checklist_${crq}_${new Date().getTime()}`);
    const newSheet = newSpreadsheet.getSheets()[0];
    const spreadsheetId = newSpreadsheet.getId();

    // Share the spreadsheet with the creator (LIDER-TEAM); los técnicos se
    // agregan como editores cuando se les asigna un paso (assignStep).
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

    // Fusionar celdas C3:D3 y C4:D4
    newSheet.getRange(3, 3, 1, 2).merge();
    newSheet.getRange(4, 3, 1, 2).merge();

    // Línea 5: Version label
    newSheet.appendRow(["Version", "", "", "", "", "", "", "", "", "", ""]);

    // Línea 6: Version value
    newSheet.appendRow(["V01", "PERÚ", "", "", "", "", "", "", "", "", ""]);

    // Línea 7: Table headers (UNA SOLA VEZ)
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
    newSheet.appendRow(tableHeaders);

    // Fases para organizar los pasos
    const phases = [
      { name: "PRE-INTERVENCIÓN", key: "preIntervention", phaseNumber: 1 },
      { name: "INTERVENCIÓN", key: "intervention", phaseNumber: 2 },
      { name: "POST-INTERVENCIÓN", key: "postIntervention", phaseNumber: 3 },
      { name: "RETORNO", key: "return", phaseNumber: 4 },
    ];

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
        "PERÚ", // Ámbito (siempre PERÚ)
        String(row[5]), // Descripción
        "", // Equipo Técnico — se llena con assignStep()
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

    // Insertar datos de cada fase
    phases.forEach((phase, phaseIdx) => {
      // Encabezado de fase: "N,,,FASE-NAME"
      newSheet.appendRow([phase.phaseNumber, "", "", phase.name, "", "", "", "", "", "", ""]);

      // Datos de la fase con numeración correcta (1.1, 1.2, etc.)
      const phaseSteps = stepsByPhase[phase.key] || [];
      phaseSteps.forEach((stepRow, stepIdx) => {
        // Renumerar: 1.1, 1.2, 1.3... para PRE, 2.1, 2.2... para INTERVENCIÓN, etc.
        stepRow[0] = `${phase.phaseNumber}.${stepIdx + 1}`;
        newSheet.appendRow(stepRow);
      });

      // Línea vacía entre fases (excepto después de la última)
      if (phaseIdx < phases.length - 1) {
        newSheet.appendRow(["", "", "", "", "", "", "", "", "", "", ""]);
      }
    });

    // Registrar en CHECKLISTS_INDEX
    const checklistId = `CHK-${crq}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
    getMasterSheet("CHECKLISTS_INDEX").appendRow([
      checklistId,
      crq,
      templateId,
      spreadsheetId,
      currentEmail,
      fechaInicio,
      fechaFin,
      "Activo",
      new Date().toISOString().split("T")[0],
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

/**
 * Asigna un paso de un checklist a un técnico (RF-5.3/5.4): comparte el
 * spreadsheet del checklist con esa persona y registra la asignación.
 * Solo LIDER-TEAM puede asignar.
 */
function assignStep(checklistId: string, pasoSec: string, email: string): Record<string, unknown> {
  try {
    if (!isLiderTeamUser(resolveCurrentEmail())) {
      return {
        status: "error",
        message: "Solo LIDER-TEAM puede asignar pasos",
      };
    }

    const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
    const checklistRow = indexData.find((row, idx) => idx > 0 && String(row[0]) === checklistId);
    if (!checklistRow) {
      return {
        status: "error",
        message: "Checklist no encontrado",
      };
    }
    const spreadsheetId = String(checklistRow[3]);

    try {
      DriveApp.getFileById(spreadsheetId).addEditor(email);
    } catch (e) {
      console.log("Aviso: No se pudo compartir el archivo: " + e);
    }

    getMasterSheet("ASIGNACIONES").appendRow([
      checklistId,
      pasoSec,
      email.toLowerCase(),
      new Date().toISOString().split("T")[0],
    ]);

    return {
      status: "ok",
      message: `Paso ${pasoSec} asignado a ${email}`,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al asignar paso: ${error}`,
    };
  }
}

/**
 * Checklists del usuario actual: los que creó (LIDER-TEAM) más aquellos
 * donde tiene al menos un paso asignado (RF-5.6).
 */
function getMyChecklists(): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail().toLowerCase();

    const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
    const asignacionesData = getMasterSheet("ASIGNACIONES").getDataRange().getValues() as unknown[][];

    const assignedChecklistIds = new Set<string>();
    for (let i = 1; i < asignacionesData.length; i++) {
      if (String(asignacionesData[i][2]).toLowerCase() === currentEmail) {
        assignedChecklistIds.add(String(asignacionesData[i][0]));
      }
    }

    const checklists: Checklist[] = [];
    for (let i = 1; i < indexData.length; i++) {
      const row = indexData[i];
      const checklistId = String(row[0]);
      const creadoPor = String(row[4]).toLowerCase();

      if (creadoPor !== currentEmail && !assignedChecklistIds.has(checklistId)) continue;

      checklists.push({
        id: checklistId,
        crq: String(row[1]),
        cbaId: String(row[2]),
        spreadsheetId: String(row[3]),
        creadoPor: String(row[4]),
        fechaInicio: String(row[5]),
        fechaFin: String(row[6]),
        estado: String(row[7]),
        fechaCreacion: String(row[8]),
      });
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

/** Get data from a checklist spreadsheet and parse phases. */
function getChecklistData(spreadsheetId: string): Record<string, unknown> {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    // Línea 7 (índice 6) contiene los headers de la tabla
    const tableHeaders = data[6] ? data[6].map((h) => String(h || "")) : [];

    const phaseDefinitions = [
      { name: "PRE-INTERVENCIÓN", color: "#d32f2f", phaseNumber: 1 },
      { name: "INTERVENCIÓN", color: "#1a73e8", phaseNumber: 2 },
      { name: "POST-INTERVENCIÓN", color: "#4caf50", phaseNumber: 3 },
      { name: "RETORNO", color: "#999", phaseNumber: 4 },
    ];

    const parsedPhases: Record<string, unknown>[] = [];
    let i = 7; // Comienza en línea 8 (índice 7) - primera fase

    for (const phaseDef of phaseDefinitions) {
      if (i >= data.length) break;

      // Buscar encabezado de fase: "N,,,FASE-NAME"
      while (i < data.length) {
        const firstCell = String(data[i][0] || "").trim();
        const fourthCell = String(data[i][3] || "").trim();

        if (firstCell === String(phaseDef.phaseNumber) && fourthCell === phaseDef.name) {
          break;
        }
        i++;
      }

      if (i >= data.length) break;

      const phaseData: Record<string, unknown> = {
        name: phaseDef.name,
        color: phaseDef.color,
        startRow: i + 1, // Número de fila (1-indexed)
        headers: tableHeaders,
        rows: [] as string[][],
      };

      i++; // Siguiente fila (datos)

      // Obtener filas de datos hasta encontrar la siguiente fase, fila vacía, o fin
      while (i < data.length) {
        const firstCell = String(data[i][0] || "").trim();

        // Si encuentra otra fase (número al inicio), detener
        if (phaseDefinitions.some((p) => firstCell === String(p.phaseNumber) && String(data[i][3] || "").trim() === p.name)) {
          break;
        }

        // Si la fila está completamente vacía, fin de la fase
        const rowHasData = data[i].some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "");
        if (!rowHasData) {
          i++;
          break;
        }

        (phaseData.rows as string[][]).push(data[i].map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
        i++;
      }

      parsedPhases.push(phaseData);
    }

    return {
      status: "ok",
      spreadsheetId,
      phases: parsedPhases,
    };
  } catch (error) {
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

    const phases = data.phases as unknown[];

    // Actualizar datos de cada fase
    phases.forEach((phase: unknown) => {
      const phaseData = phase as Record<string, unknown>;
      const phaseHeaderRow = phaseData.startRow as number; // Línea del encabezado de la fase
      const rows = phaseData.rows as unknown[][];

      // Actualizar filas de datos (comienzan después del encabezado de fase)
      rows.forEach((row, rowIdx) => {
        const targetRow = phaseHeaderRow + 1 + rowIdx; // Línea del encabezado + 1 + índice
        sheet.getRange(targetRow, 1, 1, (row as unknown[]).length).setValues([row]);
      });
    });

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

/** Get all users from QPO-MASTER. */
function getUsers(): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("USUARIOS");
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
    const sheet = getMasterSheet("USUARIOS");
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

/** Create a new user in QPO-MASTER. */
function createUser(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("USUARIOS");

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

/** Update an existing user in QPO-MASTER. */
function updateUser(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const sheet = getMasterSheet("USUARIOS");
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

/** Delete a checklist spreadsheet and its metadata + asignaciones. */
function deleteChecklist(spreadsheetId: string): Record<string, unknown> {
  try {
    // Delete the spreadsheet from Google Drive
    try {
      const file = DriveApp.getFileById(spreadsheetId);
      file.setTrashed(true);
    } catch (driveError) {
      console.log("Aviso: No se pudo eliminar el spreadsheet: " + driveError);
    }

    const indexSheet = getMasterSheet("CHECKLISTS_INDEX");
    const indexData = indexSheet.getDataRange().getValues() as unknown[][];

    let checklistId = "";
    for (let i = indexData.length - 1; i >= 1; i--) {
      if (String(indexData[i][3]) === spreadsheetId) {
        checklistId = String(indexData[i][0]);
        indexSheet.deleteRow(i + 1);
        break;
      }
    }

    // Delete related ASIGNACIONES rows
    if (checklistId) {
      const asignacionesSheet = getMasterSheet("ASIGNACIONES");
      const asignacionesData = asignacionesSheet.getDataRange().getValues() as unknown[][];
      for (let i = asignacionesData.length - 1; i >= 1; i--) {
        if (String(asignacionesData[i][0]) === checklistId) {
          asignacionesSheet.deleteRow(i + 1);
        }
      }
    }

    return {
      status: "ok",
      message: "Checklist eliminado exitosamente",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al eliminar checklist: ${error}`,
    };
  }
}
