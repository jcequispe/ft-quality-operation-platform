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

/**
 * Función include para HtmlService.
 * Permite incluir archivos HTML/CSS en templates usando <?!= include('nombre') ?>
 * Busca el archivo sin extensión, probando .html y .css
 */
function include(filename: string): string {
  try {
    // Intenta primero con el nombre tal cual (para compatibilidad)
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    // Si falla, intenta agregando extensiones comunes
    const extensions = ['html', 'css'];
    for (const ext of extensions) {
      try {
        return HtmlService.createHtmlOutputFromFile(`${filename}.${ext}`).getContent();
      } catch (e2) {
        // Continúa con la siguiente extensión
      }
    }
    // Si no encuentra nada, devuelve error comentado en CSS
    return `/* Error: No se pudo cargar el archivo ${filename} */`;
  }
}

/** Abre una pestaña de QPO-MASTER por nombre. */
function getMasterSheet(tabName: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = SpreadsheetApp.openById(MASTER_SHEET_ID).getSheetByName(tabName);
  if (!sheet) {
    throw new Error(`Pestaña "${tabName}" no encontrada en QPO-MASTER`);
  }
  return sheet;
}

/** Ejecuta una función asegurando acceso exclusivo mediante LockService. */
function withLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    return fn();
  } catch (e) {
    throw new Error("Sistema ocupado, por favor intente de nuevo en unos segundos. (" + e + ")");
  } finally {
    lock.releaseLock();
  }
}

/** Envía notificación por correo usando MailApp */
function sendNotification(email: string, subject: string, body: string) {
  try {
    MailApp.sendEmail(email, subject, body);
    console.log(`Notificación enviada a ${email}: ${subject}`);
  } catch (e) {
    console.log(`Error enviando notificación a ${email}: ${e}`);
  }
}

/** Deriva el nombre de fase a partir del "Sec." de un paso ("1.1" → PRE-INTERVENCIÓN, "CB 2a" → INTERVENCIÓN). */
function faseNameFromSec_(sec: string): string {
  const s = sec.trim();
  const m = s.match(/^(\d+)[.,]/) || s.match(/^CB\s*(\d+)/i);
  const num = m ? m[1] : "";
  const map: Record<string, string> = {
    "1": "PRE-INTERVENCIÓN",
    "2": "INTERVENCIÓN",
    "3": "POST-INTERVENCIÓN",
    "4": "RETORNO",
  };
  return map[num] || "";
}

/**
 * Inserta o actualiza la fila de un paso en la hoja central RESULTADOS de QPO-MASTER,
 * para que el ADMIN pueda ver el estado de completitud de todos los checklists sin
 * tener que abrir cada spreadsheet individual.
 */
function upsertResultado_(
  checklistId: string,
  crq: string,
  spreadsheetId: string,
  sec: string,
  tipoTarea: string,
  resultado: string,
  tecnico: string,
  fechaReal: string
): void {
  try {
    const sheet = getMasterSheet("RESULTADOS");
    const data = sheet.getDataRange().getValues() as unknown[][];
    const tipoPaso = /^CB\s/i.test(sec.trim()) ? "COOKBOOK" : "CBA";
    const fase = faseNameFromSec_(sec);
    const now = new Date().toISOString();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === checklistId && String(data[i][4]) === sec) {
        sheet.getRange(i + 1, 1, 1, 11).setValues([[
          checklistId, crq, spreadsheetId, fase, sec, tipoPaso, tipoTarea, resultado || "", tecnico || "", fechaReal || "", now,
        ]]);
        return;
      }
    }
    sheet.appendRow([checklistId, crq, spreadsheetId, fase, sec, tipoPaso, tipoTarea, resultado || "", tecnico || "", fechaReal || "", now]);
  } catch (e) {
    console.log("Aviso: No se pudo actualizar RESULTADOS: " + e);
  }
}

interface CBAStep {
  sec: string;
  tipoTarea: string;
  ambito: string;
  descripcion: string;
  responsable: string;
  /** "CBA" = paso esencial obligatorio | "COOKBOOK" = paso complementario opcional (no cumplimentar) */
  tipoPaso: string;
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

/**
 * Guarda el resultado de un paso individual sin reescribir todo el spreadsheet.
 * Esto permite al operador guardar paso a paso, de forma rápida y sin conflictos.
 * RF-5.5
 */
function saveStepResult(
  spreadsheetId: string,
  checklistId: string,
  pasoSec: string,
  inicioReal: string,
  finReal: string,
  nombreTecnico: string,
  resultado: string
): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail().toLowerCase();

    // Acceso abierto: cualquier usuario activo de la plataforma (OPERADOR, LIDER-TEAM
    // o ADMIN) puede completar cualquier paso, esté o no "asignado" — la asignación es
    // solo organizativa. Solo se bloquea a quien no está registrado en la plataforma.
    if (!getUserRole(currentEmail)) {
      return { status: "error", message: "No tienes permiso para editar este paso" };
    }

    return withLock(() => {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheets()[0];
      const data = sheet.getDataRange().getValues() as unknown[][];

      // Buscar la fila del paso por su sec (ej: "1.1", "2.3")
      let tipoTarea = "";
      let crqForResultados = "";
      for (let i = 7; i < data.length; i++) {
        if (String(data[i][0]).trim() === pasoSec.trim()) {
          // Col 8 = Inicio Real, 9 = Fin Real, 10 = Nombre Técnico, 11 = Resultado
          if (inicioReal) sheet.getRange(i + 1, 8).setValue(inicioReal);
          if (finReal)    sheet.getRange(i + 1, 9).setValue(finReal);
          if (nombreTecnico) sheet.getRange(i + 1, 10).setValue(nombreTecnico);
          sheet.getRange(i + 1, 11).setValue(resultado || "");
          tipoTarea = String(data[i][1] || "");
          break;
        }
      }

      // Sincronizar con la hoja central RESULTADOS (para el dashboard del ADMIN)
      try {
        const indexData_ = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
        for (let i = 1; i < indexData_.length; i++) {
          if (String(indexData_[i][0]) === checklistId) { crqForResultados = String(indexData_[i][1]); break; }
        }
        upsertResultado_(checklistId, crqForResultados, spreadsheetId, pasoSec, tipoTarea, resultado, nombreTecnico, finReal || inicioReal);
      } catch (e) {
        console.log("Aviso: No se pudo sincronizar RESULTADOS: " + e);
      }

      // Verificar si el checklist quedó completado (RF-6.2)
      try {
        const refreshed = sheet.getDataRange().getValues() as unknown[][];
        let allDone = true;
        let hasSteps = false;
        for (let r = 7; r < refreshed.length; r++) {
          const sec = String(refreshed[r][0] || "").trim();
          if (sec.match(/^\d+\.\d+/)) {
            hasSteps = true;
            if (!String(refreshed[r][10] || "").trim()) {
              allDone = false;
              break;
            }
          }
        }
        if (hasSteps && allDone) {
          const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
          for (let idx = 1; idx < indexData.length; idx++) {
            if (String(indexData[idx][0]) === checklistId) {
              getMasterSheet("CHECKLISTS_INDEX").getRange(idx + 1, 8).setValue("Completado");
              const creadoPor = String(indexData[idx][4]);
              const crq = String(indexData[idx][1]);
              sendNotification(
                creadoPor,
                `Checklist ${crq} completado`,
                `Todos los pasos del checklist de la CRQ ${crq} han sido completados.\nRevisa en: https://docs.google.com/spreadsheets/d/${spreadsheetId}`
              );
              break;
            }
          }
        }
      } catch (checkErr) {
        console.log("Aviso: Error al verificar completitud: " + checkErr);
      }

      return { status: "ok", message: `Paso ${pasoSec} guardado` };
    });
  } catch (error) {
    return { status: "error", message: `Error al guardar paso: ${error}` };
  }
}

/** Handle HTTP GET requests. Serves the main HTML page. */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile("client")
    .setTitle("FT Quality Operation Platform")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, viewport-fit=cover")
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
    case "switchMyRole":
      return switchMyRole(data.rol as string);
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
        data.hub as string,
      );
    case "getMyChecklists":
      return getMyChecklists();
    case "setChecklistEstado":
      return setChecklistEstado(data.checklistId as string, data.estado as string);
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
      return deleteChecklist(data.checklistId as string, data.spreadsheetId as string);
    case "getReportData":
      return getReportData();
    case "getAdminChecklistStatus":
      return getAdminChecklistStatus((data.scope as string) || "month");
    case "syncOlderChecklists":
      return syncOlderChecklists();
    case "getChecklistAssignments":
      return getChecklistAssignments(data.checklistId as string);
    case "getSupportData":
      return getSupportData(data.spreadsheetId as string);
    case "saveSupportData":
      return saveSupportData(data.spreadsheetId as string, data.datos as Record<string, unknown>);
    case "migrateChecklistSheets":
      return migrateChecklistSheets();
    case "saveStepResult":
      return saveStepResult(
        data.spreadsheetId as string,
        data.checklistId as string,
        data.pasoSec as string,
        data.inicioReal as string,
        data.finReal as string,
        data.nombreTecnico as string,
        data.resultado as string
      );
    case "saveEvidence":
      return saveEvidence(
        data.spreadsheetId as string,
        data.checklistId as string,
        data.fase as string,
        data.pasoSec as string,
        data.fileName as string,
        data.mimeType as string,
        data.base64Data as string,
        data.tipo as string
      );
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

/** Busca el área de un usuario por email en USUARIOS. */
function getUserArea(email: string): string | null {
  try {
    const sheet = getMasterSheet("USUARIOS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === email.toLowerCase()) {
        return String(data[i][3]);
      }
    }
    return null;
  } catch (error) {
    console.log("Error al obtener área: " + error);
    return null;
  }
}

/**
 * Cuenta de desarrollo/QA que puede cambiar su propio rol para probar la app
 * como OPERADOR / LIDER-TEAM / ADMIN sin necesitar cuentas de prueba distintas.
 * Restringido a este email exacto — nadie más puede escalar su propio rol.
 */
const DEV_SELF_ROLE_EMAIL = "jcequispe@gmail.com";

/** Permite a la cuenta de desarrollo cambiar su propio rol en USUARIOS. */
function switchMyRole(rol: string): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail().toLowerCase();
    if (currentEmail !== DEV_SELF_ROLE_EMAIL) {
      return { status: "error", message: "No tienes permiso para cambiar tu rol" };
    }

    const rolesValidos = ["ADMIN", "LIDER-TEAM", "OPERADOR"];
    if (!rolesValidos.includes(rol)) {
      return { status: "error", message: "Rol inválido" };
    }

    return withLock(() => {
      const sheet = getMasterSheet("USUARIOS");
      const data = sheet.getDataRange().getValues() as unknown[][];
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).toLowerCase() === currentEmail) {
          sheet.getRange(i + 1, 3).setValue(rol);
          return { status: "ok", message: `Rol cambiado a ${rol}`, rol };
        }
      }
      return { status: "error", message: "Usuario no encontrado en USUARIOS" };
    });
  } catch (error) {
    return { status: "error", message: `Error al cambiar rol: ${error}` };
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

    return withLock(() => {
      const sheet = getMasterSheet("AREAS");
      // Verificar que el código no exista
      const data = sheet.getDataRange().getValues() as unknown[][];
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === codigo.trim()) {
          return {
            status: "error",
            message: `Ya existe un área con el código "${codigo}"`,
          };
        }
      }
      sheet.appendRow([codigo.trim(), nombre.trim()]);
      return {
        status: "ok",
        message: "Área creada exitosamente",
      };
    });
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

    return withLock(() => {
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
    });
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

    return withLock(() => {
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
    });
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

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[0]) !== cbaId) continue;

      const faseRaw = String(row[1]).toUpperCase().replace(/\s+/g, "");
      const step: CBAStep = {
        sec: String(row[2]),
        tipoTarea: String(row[3]),
        ambito: String(row[4]),
        descripcion: String(row[5]),
        responsable: String(row[6]),
        tipoPaso: String(row[7] || "CBA").toUpperCase() === "COOKBOOK" ? "COOKBOOK" : "CBA",
      };

      if (faseRaw.includes("PRE")) pasos.preIntervention.push(step);
      else if (faseRaw.includes("POST")) pasos.postIntervention.push(step);
      else if (faseRaw.includes("RETORNO")) pasos.return.push(step);
      else if (faseRaw.includes("INTERV")) pasos.intervention.push(step);
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
    const currentEmail = resolveCurrentEmail();
    const isAdmin = isAdminUser(currentEmail);
    const isLider = isLiderTeamUser(currentEmail);

    if (!isAdmin && !isLider) {
      return {
        status: "error",
        message: "Solo administradores y líderes pueden crear CBAs",
      };
    }

    return withLock(() => {
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

      // RF-6.1 Notificar al LIDER-TEAM del área si fue creado por ADMIN
      if (isAdmin) {
        try {
          const usersSheet = getMasterSheet("USUARIOS");
          const usersData = usersSheet.getDataRange().getValues() as unknown[][];
          for (let i = 1; i < usersData.length; i++) {
            const uRol = String(usersData[i][2]);
            const uArea = String(usersData[i][3]);
            const uEmail = String(usersData[i][0]);
            const uActivo = String(usersData[i][6]).toUpperCase() === "SI";
            if (uRol === "LIDER-TEAM" && uArea === cba.areaTecnica && uActivo) {
              sendNotification(
                uEmail,
                `Nueva CBA creada: ${cba.nombreCBA}`,
                `El ADMIN ha creado la CBA ${id} (${cba.nombreCBA}) para el área ${cba.areaTecnica}.\nPor favor, defina los pasos en la plataforma.`
              );
            }
          }
        } catch (notifError) {
          console.log("Aviso: Error al enviar notificación: " + notifError);
        }
      }

      return {
        status: "ok",
        message: "CBA creada exitosamente",
        id,
        cba,
      };
    });
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
    const currentEmail = resolveCurrentEmail();
    if (!isAdminUser(currentEmail) && !isLiderTeamUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo administradores y líderes pueden editar CBAs",
      };
    }

    return withLock(() => {
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
            data[i][17], // mantener estado
            data[i][18], // mantener fecha creación
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
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al actualizar CBA: ${error}`,
    };
  }
}

/** Save steps for a CBA. RF-3.3/3.4 */
function saveCBASteps(cbaId: string, pasos: Record<string, CBAStep[]>): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    if (!isAdminUser(currentEmail) && !isLiderTeamUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo administradores y líderes pueden gestionar pasos",
      };
    }

    return withLock(() => {
      const sheet = getMasterSheet("PASOS");

      // RF-3.3: Reemplazar todos los pasos anteriores del CBA
      const data = sheet.getDataRange().getValues() as unknown[][];
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][0]) === cbaId) {
          sheet.deleteRow(i + 1);
        }
      }

      const faseMap: Record<string, string> = {
        preIntervention: "PRE-INTERVENCIÓN",
        intervention: "INTERVENCIÓN",
        postIntervention: "POST-INTERVENCIÓN",
        return: "RETORNO",
      };

      for (const [faseKey, steps] of Object.entries(pasos)) {
        const faseName = faseMap[faseKey] || faseKey;
        for (const step of steps) {
          const newRow = [cbaId, faseName, step.sec, step.tipoTarea, step.ambito, step.descripcion, step.responsable || "", step.tipoPaso || "CBA"];
          sheet.appendRow(newRow);
        }
      }

      // RF-3.4: Actualizar estado del CBA a "Pasos definidos"
      const totalSteps = Object.values(pasos).reduce((sum, arr) => sum + arr.length, 0);
      const cbasSheet = getMasterSheet("CBAS");
      const cbasData = cbasSheet.getDataRange().getValues() as unknown[][];
      for (let i = 1; i < cbasData.length; i++) {
        if (String(cbasData[i][0]) === cbaId) {
          cbasSheet.getRange(i + 1, 18).setValue(totalSteps > 0 ? "Pasos definidos" : "Pasos pendientes");
          break;
        }
      }

      return {
        status: "ok",
        message: "Pasos guardados exitosamente",
      };
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al guardar pasos: ${error}`,
    };
  }
}

/** Delete CBA from QPO-MASTER. RF-2.4/2.5 */
function deleteCBA(cbaId: string): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    if (!isAdminUser(currentEmail) && !isLiderTeamUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo administradores y líderes pueden eliminar CBAs",
      };
    }

    return withLock(() => {
      // RF-2.5: Eliminar pasos asociados primero
      const stepsSheet = getMasterSheet("PASOS");
      const stepsData = stepsSheet.getDataRange().getValues() as unknown[][];
      for (let i = stepsData.length - 1; i >= 1; i--) {
        if (String(stepsData[i][0]) === cbaId) {
          stepsSheet.deleteRow(i + 1);
        }
      }

      // Eliminar el CBA
      const sheet = getMasterSheet("CBAS");
      const data = sheet.getDataRange().getValues() as unknown[][];
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][0]) === cbaId) {
          sheet.deleteRow(i + 1);
          break;
        }
      }

      return {
        status: "ok",
        message: "CBA eliminada exitosamente",
      };
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al eliminar CBA: ${error}`,
    };
  }
}

/**
 * Create a new checklist based on a CBA template.
 * RF-5.1/5.2: Solo LIDER-TEAM puede crear checklists.
 *
 * La creación real (spreadsheet, formato, carpetas, hojas de soporte) tarda varios
 * segundos de I/O de Drive/Sheets que no se pueden acelerar más. En vez de bloquear al
 * usuario con un spinner, esta función solo registra el checklist como "Creando..." y
 * programa un trigger de un solo disparo que hace el trabajo pesado en segundo plano;
 * el creador recibe un correo cuando está listo (ver finishCreateChecklist/_).
 */
function createChecklist(
  crq: string,
  templateId: string,
  fechaInicio: string,
  fechaFin: string,
  tipoChangio: string,
  level: string,
  freezing: string,
  hub: string,
): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();

    if (!isLiderTeamUser(currentEmail) && !isAdminUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo LIDER-TEAM puede crear checklists",
      };
    }

    const checklistId = `CHK-${crq}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    withLock(() => {
      getMasterSheet("CHECKLISTS_INDEX").appendRow([
        checklistId, crq, templateId, "", currentEmail, fechaInicio, fechaFin, "Creando...", new Date().toISOString().split("T")[0],
      ]);
    });

    const params = { checklistId, crq, templateId, fechaInicio, fechaFin, tipoChangio, level, freezing, hub, currentEmail };
    PropertiesService.getScriptProperties().setProperty(`pendingChecklist_${checklistId}`, JSON.stringify(params));
    ScriptApp.newTrigger("finishCreateChecklist").timeBased().after(1000).create();

    return {
      status: "ok",
      message: "Checklist en creación — te llegará un correo cuando esté listo",
      checklistId,
      pending: true,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear checklist: ${error}`,
    };
  }
}

/**
 * Handler del trigger de un solo disparo: procesa TODOS los checklists pendientes que
 * encuentre (por si hay más de uno en cola) y termina de construirlos.
 */
function finishCreateChecklist(): void {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  for (const key of Object.keys(all)) {
    if (!key.startsWith("pendingChecklist_")) continue;
    props.deleteProperty(key); // primero borrar, para que triggers concurrentes no lo repitan
    let params: Record<string, string>;
    try {
      params = JSON.parse(all[key]);
    } catch (e) {
      console.log("Aviso: parámetros de checklist pendiente inválidos: " + e);
      continue;
    }
    try {
      const spreadsheetId = finishCreateChecklist_(params);
      withLock(() => {
        const sheet = getMasterSheet("CHECKLISTS_INDEX");
        const data = sheet.getDataRange().getValues() as unknown[][];
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][0]) === params.checklistId) {
            sheet.getRange(i + 1, 4).setValue(spreadsheetId);
            sheet.getRange(i + 1, 8).setValue("Borrador");
            break;
          }
        }
      });
    } catch (error) {
      console.log("Error al terminar checklist pendiente " + params.checklistId + ": " + error);
      try {
        const sheet = getMasterSheet("CHECKLISTS_INDEX");
        const data = sheet.getDataRange().getValues() as unknown[][];
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][0]) === params.checklistId) {
            sheet.getRange(i + 1, 8).setValue("Error al crear");
            break;
          }
        }
      } catch (_) {}
    }
  }
}

/** Hace el trabajo pesado real de construir el checklist. Devuelve el spreadsheetId creado. */
function finishCreateChecklist_(p: Record<string, string>): string {
  const { crq, templateId, fechaInicio, fechaFin, tipoChangio, level, freezing, hub, currentEmail } = p;
  {
    // Obtener info del CBA
    const cbasSheetData = getMasterSheet("CBAS").getDataRange().getValues() as unknown[][];
    const cbaInfo = cbasSheetData.find((row, idx) => idx > 0 && String(row[0]) === templateId);
    const cbaCode   = cbaInfo ? String(cbaInfo[12]) : "";  // codificacionTipologia
    const cbaName   = cbaInfo ? String(cbaInfo[5])  : "";  // nombreCBA
    const cbaTitulo = cbaInfo ? String(cbaInfo[14]) : "";  // tituloCatalogo (ej: "E-V01 CBA+CB Gestión de parámetros")
    const cbaArea   = cbaInfo ? String(cbaInfo[2])  : "";  // areaTecnica

    // Obtener pasos del CBA plantilla
    const templateSheetData = getMasterSheet("PASOS").getDataRange().getValues() as unknown[][];
    const templateSteps = templateSheetData.filter((row, idx) => idx > 0 && String(row[0]) === templateId);

    // Crear nuevo spreadsheet
    const newSpreadsheet = SpreadsheetApp.create(`Checklist_${crq}_${new Date().getTime()}`);
    const sheet = newSpreadsheet.getSheets()[0];
    sheet.setName("CBA Procedimiento y checklist");
    const spreadsheetId = newSpreadsheet.getId();

    // Forzar formato de texto en la columna Sec. (A) — valores como "1.3" o "2.1"
    // son interpretados por Sheets como fechas (ej. 1/03/2026) si no se fuerza texto,
    // lo que rompe el matching "N.M" del frontend y oculta pasos/evidencias.
    sheet.getRange("A1:A200").setNumberFormat("@");

    try {
      DriveApp.getFileById(spreadsheetId).addEditor(currentEmail);
    } catch (e) {
      console.log("Aviso: No se pudo compartir: " + e);
    }

    // Cualquiera con el enlace puede VER (no editar) el checklist, sin necesitar que se
    // comparta explícitamente con cada persona. Necesario porque la cuenta que despliega
    // la app es @gmail.com personal (sin dominio de Workspace) y algunos miembros del
    // equipo son de otro dominio — la asignación de editor por email puede fallar
    // silenciosamente entre dominios, dejando el archivo inaccesible incluso para el
    // propio dueño del script.
    try {
      DriveApp.getFileById(spreadsheetId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      console.log("Aviso: No se pudo configurar el acceso por enlace: " + e);
    }

    // Archivar el checklist en Drive: carpeta raíz "QPO Checklists" > subcarpeta del área
    // técnica del CBA, en vez de dejarlo suelto en la raíz de Drive.
    try {
      const crqFolder = getOrCreateChecklistFolder_(cbaArea, crq);
      DriveApp.getFileById(spreadsheetId).moveTo(crqFolder);
    } catch (e) {
      console.log("Aviso: No se pudo archivar en la carpeta de área: " + e);
    }

    // ══════════════════════════════════════════════════════
    // ESTRUCTURA BASADA EN PLANTILLA DEL EXCEL
    // Fila 1: cabecera descriptiva
    // Fila 2: etiquetas de metadatos
    // Fila 3: datos del cambio
    // Fila 4: datos adicionales
    // Fila 5: versión label
    // Fila 6: versión valor
    // Fila 7: encabezados de la tabla de pasos
    // Fila 8+: fases y pasos
    // ══════════════════════════════════════════════════════

    // Filas 1-7 escritas de una sola vez (en vez de 7 llamadas appendRow separadas)
    const headerRows: unknown[][] = [
      ["", "Descripción Tipo de tarea", "CBA:", cbaTitulo || cbaName, "", "", "", "", "", "", ""],
      ["", "CRQ", "", "TÍTULO INTERVENCIÓN", "Tipo de cambio", "FECHA INICIO", "FECHA FIN", "Freezing", "", "", ""],
      [level || "Level", crq, "", `${cbaCode} ${cbaName}`.trim(), tipoChangio || "Normal", fechaInicio, fechaFin, freezing || "", "", "", ""],
      [level || "L03", "CookBook y/o FT", "", cbaName, "No Fast Track", "NA", "NA", "NA", "", "", ""],
      ["Version", "", "", "", "Leyenda", "", "Paso esencial CBA (Obligatorio cumplimentar)", "", "", "", ""],
      ["V01", hub || "PERÚ", "", "", "", "", "Paso complementario CookBook (No cumplimentar)", "", "", "", ""],
      [
        "Sec.", "Tipo de tarea", "Ámbito", "Descripción tarea", "Equipo Técnico",
        "Inicio Previsto", "Fin Previsto", "Inicio Real", "Fin Real", "Nombre del Técnico", "Resultado OK/KO",
      ],
    ];
    sheet.getRange(1, 1, headerRows.length, 11).setValues(headerRows);

    // Aplicar formato: negrita a la fila 7
    try {
      // Fila 1: fondo azul oscuro, texto blanco (como el Excel)
      sheet.getRange(1, 1, 1, 11).setBackground("#1a1a2e").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10);

      // Filas 2-4: metadatos del cambio — fondo gris claro
      sheet.getRange(2, 1, 1, 11).setBackground("#f3f3f3").setFontWeight("bold").setFontSize(10);
      sheet.getRange(3, 1, 1, 11).setBackground("#ffffff").setFontSize(10);
      sheet.getRange(4, 1, 1, 11).setBackground("#f3f3f3").setFontSize(10);

      // Filas 5-6: versión — fondo gris muy claro
      sheet.getRange(5, 1, 1, 11).setBackground("#efefef").setFontSize(9).setFontColor("#666666");
      sheet.getRange(6, 1, 1, 11).setBackground("#efefef").setFontSize(9).setFontColor("#666666");

      // Leyenda: paso esencial CBA (verde) vs paso complementario CookBook (gris/cursiva)
      sheet.getRange(5, 7).setBackground("#d9ead3").setFontColor("#000000").setFontWeight("bold");
      sheet.getRange(6, 7).setBackground("#f5f5f5").setFontColor("#666666").setFontStyle("italic");

      // Fila 7: encabezados de tabla — fondo azul medio, texto blanco, negrita
      const hdr = sheet.getRange(7, 1, 1, 11);
      hdr.setBackground("#4a86e8");
      hdr.setFontColor("#ffffff");
      hdr.setFontWeight("bold");
      hdr.setFontSize(10);
      hdr.setHorizontalAlignment("center");
      hdr.setBorder(true, true, true, true, true, true, "#ffffff", SpreadsheetApp.BorderStyle.SOLID);

      // Ancho de columnas optimizado
      sheet.setColumnWidth(1, 70);   // Sec.
      sheet.setColumnWidth(2, 120);  // Tipo de tarea
      sheet.setColumnWidth(3, 80);   // Ámbito
      sheet.setColumnWidth(4, 350);  // Descripción
      sheet.setColumnWidth(5, 180);  // Equipo Técnico
      sheet.setColumnWidth(6, 140);  // Inicio Previsto
      sheet.setColumnWidth(7, 140);  // Fin Previsto
      sheet.setColumnWidth(8, 140);  // Inicio Real
      sheet.setColumnWidth(9, 140);  // Fin Real
      sheet.setColumnWidth(10, 180); // Nombre Técnico
      sheet.setColumnWidth(11, 120); // Resultado

      // Fijar la fila 7 para que al hacer scroll siempre sea visible
      sheet.setFrozenRows(7);

      // Altura de filas de pasos más cómoda
      sheet.setDefaultRowHeight(22);
    } catch (_) {}

    // ── Organizar pasos por fase ──
    const phases = [
      { name: "PRE-INTERVENCIÓN",  key: "pre",  number: 1, color: "#cc0000", fontColor: "#ffffff" },
      { name: "INTERVENCIÓN",      key: "int",  number: 2, color: "#1155cc", fontColor: "#ffffff" },
      { name: "POST-INTERVENCIÓN", key: "post", number: 3, color: "#38761d", fontColor: "#ffffff" },
      { name: "RETORNO",           key: "ret",  number: 4, color: "#666666", fontColor: "#ffffff" },
    ];

    const stepsByPhase: Record<string, { row: unknown[]; tipoPaso: string }[]> = { pre: [], int: [], post: [], ret: [] };

    templateSteps.forEach((row) => {
      const faseRaw = String(row[1]).toUpperCase().replace(/\s+/g, "");
      const tipoPaso = String(row[7] || "CBA").toUpperCase() === "COOKBOOK" ? "COOKBOOK" : "CBA";
      const esCookbook = tipoPaso === "COOKBOOK";
      const row_ = [
        "",          // Sec. — se asigna al escribir
        esCookbook ? "N/A" : String(row[3] || ""),  // Tipo de tarea
        esCookbook ? "N/A" : String(row[4] || "PERÚ"), // Ámbito
        String(row[5] || "") || "Según CBA",  // Descripción tarea
        esCookbook ? "N/A" : "",          // Equipo Técnico (se asigna con assignStep)
        esCookbook ? "" : fechaInicio, // Inicio Previsto
        esCookbook ? "" : fechaFin,    // Fin Previsto
        "",          // Inicio Real
        "",          // Fin Real
        "",          // Nombre del Técnico
        "",          // Resultado OK/KO
      ];

      if      (faseRaw.includes("PRE"))     stepsByPhase.pre.push({ row: row_, tipoPaso });
      else if (faseRaw.includes("POST"))    stepsByPhase.post.push({ row: row_, tipoPaso });
      else if (faseRaw.includes("RETORNO")) stepsByPhase.ret.push({ row: row_, tipoPaso });
      else if (faseRaw.includes("INTERV"))  stepsByPhase.int.push({ row: row_, tipoPaso });
    });

    // ── Construir todas las filas de fases/pasos en memoria, luego escribir todo de
    //    una sola vez (setValues/setBackgrounds/etc.) en vez de un appendRow + varias
    //    llamadas de formato POR FILA — eso es lo que hacía tardar 20-30s la creación.
    const blockRows: unknown[][] = [];
    const blockBg: string[][] = [];
    const blockFontColor: string[][] = [];
    const blockFontStyle: string[][] = [];
    const blockFontWeight: string[][] = [];
    const WHITE = Array(11).fill("#ffffff");
    const BLACK = Array(11).fill("#000000");
    const NORMAL = Array(11).fill("normal");
    const REGULAR_WEIGHT = Array(11).fill("normal");

    phases.forEach((phase, phaseIdx) => {
      blockRows.push([String(phase.number), "", "", phase.name, "", "", "", "", "", "", ""]);
      blockBg.push(Array(11).fill(phase.color));
      blockFontColor.push(Array(11).fill(phase.fontColor));
      blockFontStyle.push(NORMAL.slice());
      blockFontWeight.push(Array(11).fill("bold"));

      const steps = stepsByPhase[phase.key] || [];
      let cbaCounter = 0;
      let lastCbaNum = "";
      let cookbookSub = 0;
      let rowsWritten = 0;
      steps.forEach((entry) => {
        const rowArr = [...entry.row];
        const isCookbook = entry.tipoPaso === "COOKBOOK";

        if (isCookbook) {
          cookbookSub += 1;
          const letter = String.fromCharCode(96 + cookbookSub); // a, b, c...
          rowArr[0] = lastCbaNum ? `CB ${phase.number},${lastCbaNum.split(".")[1]}${letter}` : `CB ${phase.number}${letter}`;
        } else {
          cbaCounter += 1;
          cookbookSub = 0;
          lastCbaNum = `${phase.number}.${cbaCounter}`;
          rowArr[0] = lastCbaNum;
        }

        blockRows.push(rowArr);
        const rowBg = isCookbook ? Array(11).fill("#f5f5f5") : Array(11).fill(rowsWritten % 2 === 0 ? "#ffffff" : "#f8f9fa");
        if (!isCookbook) rowBg[10] = "#fff9c4"; // Resultado — solo pasos obligatorios
        blockBg.push(rowBg);
        blockFontColor.push(isCookbook ? Array(11).fill("#888888") : BLACK.slice());
        blockFontStyle.push(isCookbook ? Array(11).fill("italic") : NORMAL.slice());
        blockFontWeight.push(REGULAR_WEIGHT.slice());
        rowsWritten += 1;
      });

      if (phaseIdx < phases.length - 1) {
        blockRows.push(["", "", "", "", "", "", "", "", "", "", ""]);
        blockBg.push(WHITE.slice());
        blockFontColor.push(BLACK.slice());
        blockFontStyle.push(NORMAL.slice());
        blockFontWeight.push(REGULAR_WEIGHT.slice());
      }
    });

    const blockStartRow = sheet.getLastRow() + 1;
    const blockRange = sheet.getRange(blockStartRow, 1, blockRows.length, 11);
    blockRange.setValues(blockRows as string[][]);
    try {
      blockRange.setBackgrounds(blockBg);
      blockRange.setFontColors(blockFontColor);
      blockRange.setFontStyles(blockFontStyle as unknown as GoogleAppsScript.Spreadsheet.FontStyle[][]);
      blockRange.setFontWeights(blockFontWeight as unknown as GoogleAppsScript.Spreadsheet.FontWeight[][]);
      blockRange.setFontSize(10);
      blockRange.setBorder(false, false, false, false, false, true, "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID);
    } catch (_) {}

    // ── Hojas de soporte: Contacto, Servicio y Evidencias + carpeta de evidencias ──
    try {
      createChecklistSupportSheets_(newSpreadsheet, crq);
    } catch (supportErr) {
      console.log("Aviso: No se pudieron crear las hojas de soporte: " + supportErr);
    }

    return spreadsheetId;
  }
}

/** Carpeta padre de un archivo en Drive. */
/**
 * Carpeta raíz "QPO Checklists" en el Drive de la cuenta que despliega la app, con una
 * subcarpeta por área técnica. Todo checklist nuevo se archiva ahí en vez de quedar
 * suelto en la raíz de Drive. Los IDs se cachean en ScriptProperties para no tener que
 * buscar/crear la carpeta en cada llamada.
 */
/**
 * Carpeta del checklist: QPO Checklists / <Área> / <CRQ> — ahí van el spreadsheet y,
 * dentro, la carpeta de evidencias (creada aparte por createChecklistSupportSheets_,
 * que la coloca junto al spreadsheet automáticamente).
 */
function getOrCreateChecklistFolder_(area: string, crq: string): GoogleAppsScript.Drive.Folder {
  const areaFolder = getOrCreateChecklistAreaFolder_(area);
  const safeCrq = sanitizeFolderName_(crq || "Sin CRQ");
  const existing = areaFolder.getFoldersByName(safeCrq);
  return existing.hasNext() ? existing.next() : areaFolder.createFolder(safeCrq);
}

function getOrCreateChecklistAreaFolder_(area: string): GoogleAppsScript.Drive.Folder {
  const props = PropertiesService.getScriptProperties();
  const safeArea = sanitizeFolderName_(area || "Sin área");

  let root: GoogleAppsScript.Drive.Folder;
  const rootId = props.getProperty("checklistsRootFolderId");
  if (rootId) {
    try { root = DriveApp.getFolderById(rootId); }
    catch (e) { root = null as unknown as GoogleAppsScript.Drive.Folder; }
  } else {
    root = null as unknown as GoogleAppsScript.Drive.Folder;
  }
  if (!root) {
    const existing = DriveApp.getFoldersByName("QPO Checklists");
    root = existing.hasNext() ? existing.next() : DriveApp.createFolder("QPO Checklists");
    props.setProperty("checklistsRootFolderId", root.getId());
  }

  const areaKey = `checklistsAreaFolder_${safeArea}`;
  let areaFolder: GoogleAppsScript.Drive.Folder;
  const areaFolderId = props.getProperty(areaKey);
  if (areaFolderId) {
    try { areaFolder = DriveApp.getFolderById(areaFolderId); }
    catch (e) { areaFolder = null as unknown as GoogleAppsScript.Drive.Folder; }
  } else {
    areaFolder = null as unknown as GoogleAppsScript.Drive.Folder;
  }
  if (!areaFolder) {
    const existing = root.getFoldersByName(safeArea);
    areaFolder = existing.hasNext() ? existing.next() : root.createFolder(safeArea);
    props.setProperty(areaKey, areaFolder.getId());
  }
  return areaFolder;
}

function parentFolderOf_(fileId: string): GoogleAppsScript.Drive.Folder {
  const parents = DriveApp.getFileById(fileId).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

/** Nombre seguro para una carpeta de Drive. */
function sanitizeFolderName_(name: string): string {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

/**
 * Añade las hojas de soporte del checklist replicando la plantilla Excel del equipo:
 * Lista de contactos, Servicios afectados, Evidencia Técnica y Evidencia Funcional.
 * Además crea la carpeta de Drive donde se almacenan las evidencias.
 */
function createChecklistSupportSheets_(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  crq: string,
): void {
  const styleHeader = (sheet: GoogleAppsScript.Spreadsheet.Sheet, cols: number) => {
    try {
      sheet.getRange(1, 1, 1, cols)
        .setBackground("#0e4d49").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10);
      sheet.setFrozenRows(1);
      for (let c = 1; c <= cols; c++) {
        sheet.setColumnWidth(c, 220);
      }
    } catch (_) {}
  };

  // ── Carpeta de evidencias en Drive (reutiliza si ya existe) ──
  let folderUrl = "";
  try {
    const parent = parentFolderOf_(ss.getId());
    const folderName = `Evidencias - ${sanitizeFolderName_(crq)}`;
    const existing = parent.getFoldersByName(folderName);
    const folder = existing.hasNext() ? existing.next() : parent.createFolder(folderName);
    PropertiesService.getScriptProperties().setProperty(`evFolder_${ss.getId()}`, folder.getId());
    folderUrl = folder.getUrl();
  } catch (e) {
    console.log("Aviso: No se pudo crear carpeta de evidencias: " + e);
  }

  // Enlace a la carpeta en la fila 1 de cada hoja de evidencias
  const evFolderCell = (sheet: GoogleAppsScript.Spreadsheet.Sheet, label: string) => {
    if (!folderUrl) return;
    try {
      sheet.getRange(1, 1).setValue(`${label}:`);
      sheet.getRange(1, 1).setFontWeight("bold").setFontSize(10);
      const linkValue = SpreadsheetApp.newRichTextValue()
        .setText("Abrir carpeta en Drive")
        .setLinkUrl(folderUrl)
        .build();
      sheet.getRange(1, 2).setRichTextValue(linkValue);
      sheet.getRange(1, 2).setFontSize(10);
    } catch (_) {}
  };

  // ── Listado CookBook (catálogo de referencia de la plantilla Excel) ──
  let sh = ss.getSheetByName("Listado CookBook");
  if (!sh) {
    sh = ss.insertSheet("Listado CookBook");
    sh.appendRow([
      "", // A
      "Cód", "Área", "Tipología de Cambio", // B C D
      "Tipo de cambio Europa", "Tipo de cambio América", // E F
      "Existe CBA homologada?", "¿Existe cookbook homologado?", // G H
      "CBA (QUA%)", // I
      "Europa (Candidatas a L04)", "América (Candidatas a L04)", // J K
      "Europa (Candidatas a L05)", "América (Candidatas a L05)", // L M
      "Cookbook Level EUR", "Cookbook Level AME", // N O
      "CBA", "CookBook", "URL", "CBA / CooBook", // P Q R S
      "", // T
    ]);
    try {
      const r = sh.getRange(1, 1, 1, 20);
      r.setBackground("#0e4d49").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10);
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 60);
      for (let c = 2; c <= 20; c++) sh.setColumnWidth(c, 150);
    } catch (_) {}
  }

  // ── Lista de contactos ──
  sh = ss.getSheetByName("Lista de contactos");
  if (!sh) {
    sh = ss.insertSheet("Lista de contactos");
    sh.appendRow(["Nombre", "Teléfono"]);
    styleHeader(sh, 2);
  }

  // ── Servicios afectados ──
  sh = ss.getSheetByName("Servicios afectados");
  if (!sh) {
    sh = ss.insertSheet("Servicios afectados");
    sh.appendRow(["Nombre del SERVICIO"]);
    styleHeader(sh, 1);
  }

  // ── Evidencia Técnica y Evidencia Funcional ──
  // Filas 4+ con columnas por fase (estructura de la plantilla Excel)
  const evPhases = ["PRE INTERVENCIÓN", "DURANTE (Si Aplica)", "POST INTERVENCIÓN"];
  ["Evidencia Técnica", "Evidencia Funcional"].forEach((name) => {
    sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      evFolderCell(sh, name);
      try {
        sh.getRange(4, 1).setValue(evPhases[0]);
        sh.getRange(4, 2).setValue(evPhases[1]);
        sh.getRange(4, 3).setValue(evPhases[2]);
        sh.getRange(4, 1, 1, 3).setBackground("#0e4d49").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10);
        sh.setColumnWidth(1, 340);
        sh.setColumnWidth(2, 340);
        sh.setColumnWidth(3, 340);
      } catch (_) {}
    }
  });
}

/**
 * Asigna un paso de un checklist a un técnico. RF-5.3/5.4
 * Comparte el spreadsheet con la persona y registra en ASIGNACIONES.
 * Solo LIDER-TEAM puede asignar.
 */
function assignStep(checklistId: string, pasoSec: string, email: string): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    if (!isLiderTeamUser(currentEmail) && !isAdminUser(currentEmail)) {
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

    // RF-5.4: Compartir como editor si no lo era
    try {
      DriveApp.getFileById(spreadsheetId).addEditor(email.toLowerCase().trim());
    } catch (e) {
      console.log("Aviso: No se pudo compartir el archivo: " + e);
    }

    // Registrar asignación en ASIGNACIONES
    withLock(() => {
      // Eliminar asignación previa del mismo paso si existía (RF-5.7: reasignación)
      const asignSheet = getMasterSheet("ASIGNACIONES");
      const asignData = asignSheet.getDataRange().getValues() as unknown[][];
      for (let i = asignData.length - 1; i >= 1; i--) {
        if (String(asignData[i][0]) === checklistId && String(asignData[i][1]) === pasoSec) {
          asignSheet.deleteRow(i + 1);
        }
      }
      // Agregar nueva asignación
      asignSheet.appendRow([
        checklistId,
        pasoSec,
        email.toLowerCase().trim(),
        new Date().toISOString().split("T")[0],
      ]);
    });

    // Actualizar celda "Equipo Técnico" en el spreadsheet del checklist
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheets()[0];
      const sheetData = sheet.getDataRange().getValues() as unknown[][];
      for (let i = 7; i < sheetData.length; i++) {
        if (String(sheetData[i][0]).trim() === pasoSec.trim()) {
          sheet.getRange(i + 1, 5).setValue(email.toLowerCase().trim());
          break;
        }
      }
    } catch (ssErr) {
      console.log("Aviso: No se pudo actualizar Equipo Técnico: " + ssErr);
    }

    // Sin notificación por correo (se solicita no enviar emails)
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
 * Checklists del usuario actual: los que creó más los que tiene asignados. RF-5.6
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
      if (!row[0]) continue;

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

/**
 * Cambia el estado de un checklist (mover tarjeta en el tablero). Solo LIDER-TEAM/ADMIN.
 */
function setChecklistEstado(checklistId: string, estado: string): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    if (!isLiderTeamUser(currentEmail) && !isAdminUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo LIDER-TEAM o ADMIN pueden cambiar el estado",
      };
    }
    const allowed = ["Borrador", "En Progreso", "Terminado", "Bloqueado"];
    if (!allowed.includes(estado)) {
      return {
        status: "error",
        message: "Estado no válido",
      };
    }
    const sheet = getMasterSheet("CHECKLISTS_INDEX");
    const data = sheet.getDataRange().getValues() as unknown[][];
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === checklistId) {
        rowIdx = i;
        break;
      }
    }
    if (rowIdx < 0) {
      return {
        status: "error",
        message: "Checklist no encontrado",
      };
    }
    sheet.getRange(rowIdx + 1, 8).setValue(estado);
    return {
      status: "ok",
      message: `Checklist movido a "${estado}"`,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al cambiar estado: ${error}`,
    };
  }
}

/** Get data from a checklist spreadsheet and parse phases. */
function getChecklistData(spreadsheetId: string): Record<string, unknown> {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues() as unknown[][];

    const tableHeaders = data[6] ? data[6].map((h) => String(h || "")) : [];

    const phaseDefinitions = [
      { name: "PRE-INTERVENCIÓN", color: "#d32f2f", phaseNumber: 1 },
      { name: "INTERVENCIÓN", color: "#1a73e8", phaseNumber: 2 },
      { name: "POST-INTERVENCIÓN", color: "#4caf50", phaseNumber: 3 },
      { name: "RETORNO", color: "#757575", phaseNumber: 4 },
    ];

    const parsedPhases: Record<string, unknown>[] = [];
    let i = 7;

    for (const phaseDef of phaseDefinitions) {
      if (i >= data.length) break;

      // Buscar encabezado de fase
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
        startRow: i + 1,
        headers: tableHeaders,
        rows: [] as string[][],
      };

      i++;

      while (i < data.length) {
        const firstCell = String(data[i][0] || "").trim();
        if (phaseDefinitions.some((p) => firstCell === String(p.phaseNumber) && String(data[i][3] || "").trim() === p.name)) {
          break;
        }
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

    let crq = "";
    try {
      crq = ss.getName().replace(/^Checklist_/, "").replace(/_\d+$/, "");
    } catch (e) {
      /* ignore */
    }

    return {
      status: "ok",
      spreadsheetId,
      crq,
      phases: parsedPhases,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener datos del checklist: ${error}`,
    };
  }
}

/** Save checklist data to spreadsheet. OPTIMIZADO: una escritura por fase, no por fila. */
function saveChecklistData(spreadsheetId: string, data: Record<string, unknown>): Record<string, unknown> {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheets()[0];
    const phases = data.phases as unknown[];

    // ── Escritura optimizada: una llamada setValues() por fase (no por fila) ──
    phases.forEach((phase: unknown) => {
      const phaseData = phase as Record<string, unknown>;
      const phaseHeaderRow = phaseData.startRow as number;
      const rows = phaseData.rows as unknown[][];

      if (!rows || rows.length === 0) return;

      // Filtrar filas vacías y normalizar longitud
      const validRows = rows
        .filter(row => row && (row as unknown[]).length > 0)
        .map(row => {
          const arr = row as unknown[];
          // Asegurar que todas las filas tienen 11 columnas
          while (arr.length < 11) arr.push("");
          return arr.slice(0, 11);
        });

      if (validRows.length === 0) return;

      // Una sola llamada para toda la fase
      sheet.getRange(phaseHeaderRow + 1, 1, validRows.length, 11).setValues(validRows);
    });

    // ── Verificar si el checklist quedó completado ──
    try {
      const allData = sheet.getDataRange().getValues() as unknown[][];
      let allDone = true;
      let hasSteps = false;

      // Sincronizar cada paso con la hoja central RESULTADOS (para el dashboard del ADMIN)
      try {
        const idxData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
        let checklistId = "", crqSync = "";
        for (let i = 1; i < idxData.length; i++) {
          if (String(idxData[i][3]) === spreadsheetId) { checklistId = String(idxData[i][0]); crqSync = String(idxData[i][1]); break; }
        }
        if (checklistId) {
          for (let r = 7; r < allData.length; r++) {
            const sec = String(allData[r][0] || "").trim();
            if (!sec.match(/^\d+\.\d+/) && !/^CB\s/i.test(sec)) continue;
            upsertResultado_(
              checklistId, crqSync, spreadsheetId, sec,
              String(allData[r][1] || ""), String(allData[r][10] || ""),
              String(allData[r][9] || ""), String(allData[r][8] || allData[r][7] || "")
            );
          }
        }
      } catch (syncErr) {
        console.log("Aviso: No se pudo sincronizar RESULTADOS: " + syncErr);
      }

      for (let r = 7; r < allData.length; r++) {
        const sec = String(allData[r][0] || "").trim();
        if (sec.match(/^\d+\.\d+/)) {
          hasSteps = true;
          if (!String(allData[r][10] || "").trim()) {
            allDone = false;
            break;
          }
        }
      }
      if (hasSteps && allDone) {
        const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
        for (let idx = 1; idx < indexData.length; idx++) {
          if (String(indexData[idx][3]) === spreadsheetId) {
            const creadoPor = String(indexData[idx][4]);
            const crq = String(indexData[idx][1]);
            withLock(() => {
              getMasterSheet("CHECKLISTS_INDEX").getRange(idx + 1, 8).setValue("Completado");
            });
            sendNotification(
              creadoPor,
              `Checklist ${crq} completado`,
              `Todos los pasos del checklist de la CRQ ${crq} han sido completados.\nRevisa en: https://docs.google.com/spreadsheets/d/${spreadsheetId}`
            );
            break;
          }
        }
      }
    } catch (checkErr) {
      console.log("Aviso: Error al verificar completitud: " + checkErr);
    }

    return { status: "ok", message: "Datos guardados exitosamente" };
  } catch (error) {
    return { status: "error", message: `Error al guardar datos: ${error}` };
  }
}

/**
 * Guarda evidencias fotográficas en la carpeta de Drive del checklist y
 * registra el enlace en la hoja Evidencia Técnica o Evidencia Funcional,
 * en la columna de la fase correspondiente (estructura de la plantilla Excel).
 */
function saveEvidence(
  spreadsheetId: string,
  checklistId: string,
  fase: string,         // "PRE INTERVENCIÓN" | "DURANTE (Si Aplica)" | "POST INTERVENCIÓN"
  pasoSec: string,
  fileName: string,
  mimeType: string,
  base64Data: string,   // dataUrl sin el prefijo "data:...;base64,"
  tipo?: string,        // "Técnica" | "Funcional"
): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();

    // Limpiar el base64 (puede llegar con prefijo data:...)
    const cleanBase64 = base64Data.includes(",")
      ? base64Data.split(",")[1]
      : base64Data;

    const ss = SpreadsheetApp.openById(spreadsheetId);

    // Hoja destino según el tipo de evidencia (Técnica | Funcional)
    const tipoNorm = String(tipo || "Técnica").toUpperCase().includes("FUNC")
      ? "Funcional"
      : "Técnica";
    const sheetName = `Evidencia ${tipoNorm}`;

    // Crear o encontrar la hoja de evidencias (estructura de la plantilla Excel)
    const evPhases = ["PRE INTERVENCIÓN", "DURANTE (Si Aplica)", "POST INTERVENCIÓN"];
    const faseNorm = String(fase || "").toUpperCase().replace(/\s+/g, " ");
    let colIdx = evPhases.findIndex((p) => faseNorm.includes(p.split(" ")[0])
      || p.toUpperCase() === faseNorm
      || faseNorm.includes(p.split("(")[0].trim()));
    if (colIdx < 0) colIdx = 2; // POST INTERVENCIÓN por defecto

    let evSheet = ss.getSheetByName(sheetName);
    if (!evSheet) {
      evSheet = ss.insertSheet(sheetName);
      try {
        evSheet.getRange(4, 1).setValue(evPhases[0]);
        evSheet.getRange(4, 2).setValue(evPhases[1]);
        evSheet.getRange(4, 3).setValue(evPhases[2]);
        evSheet.getRange(4, 1, 1, 3).setBackground("#0e4d49").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10);
        evSheet.setColumnWidth(1, 340);
        evSheet.setColumnWidth(2, 340);
        evSheet.setColumnWidth(3, 340);
      } catch (_) {}
    }

    // Guardar el archivo en Google Drive (carpeta de evidencias del checklist)
    let fileId = "";
    let fileUrl = "";
    let crq = "";
    let creadoPor = "";
    try {
      // Obtener CRQ y creador del checklist
      const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
      for (let i = 1; i < indexData.length; i++) {
        if (String(indexData[i][0]) === checklistId) {
          crq = String(indexData[i][1]);
          creadoPor = String(indexData[i][4]);
          break;
        }
      }

      const blob = Utilities.newBlob(
        Utilities.base64Decode(cleanBase64),
        mimeType,
        fileName
      );

      // Resolver la carpeta de evidencias (pre-creada al generar el checklist)
      const props = PropertiesService.getScriptProperties();
      let folder: GoogleAppsScript.Drive.Folder | null = null;
      const cachedFolderId = props.getProperty(`evFolder_${spreadsheetId}`);
      if (cachedFolderId) {
        try { folder = DriveApp.getFolderById(cachedFolderId); } catch (_) { folder = null; }
      }
      if (!folder) {
        const parent = parentFolderOf_(spreadsheetId);
        const folderName = `Evidencias - ${sanitizeFolderName_(crq)}`;
        const search = parent.getFoldersByName(folderName);
        folder = search.hasNext() ? search.next() : parent.createFolder(folderName);
        try { props.setProperty(`evFolder_${spreadsheetId}`, folder.getId()); } catch (_) {}
      }

      const file = folder.createFile(blob);
      file.setName(`[${checklistId}] ${fase} - ${pasoSec} - ${fileName}`);
      fileId = file.getId();
      fileUrl = file.getUrl();

      // Compartir con el creador del checklist
      if (creadoPor) {
        try { file.addViewer(creadoPor); } catch (_) {}
      }
    } catch (driveErr) {
      console.log("Error guardando en Drive: " + driveErr);
      return { status: "error", message: "No se pudo guardar el archivo en Drive: " + driveErr };
    }

    // Registrar el enlace en la columna de la fase (fila libre bajo la cabecera)
    const timestamp = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
    try {
      const colData = evSheet.getRange(5, colIdx + 1, evSheet.getMaxRows() - 4, 1).getValues() as unknown[][];
      let targetRow = -1;
      for (let i = 0; i < colData.length; i++) {
        if (!String(colData[i][0] || "").trim()) { targetRow = 5 + i; break; }
      }
      if (targetRow < 0) targetRow = evSheet.getMaxRows() + 1;
      const cell = evSheet.getRange(targetRow, colIdx + 1);
      if (fileUrl) {
        const linkValue = SpreadsheetApp.newRichTextValue()
          .setText(fileName)
          .setLinkUrl(fileUrl)
          .build();
        cell.setRichTextValue(linkValue);
      } else {
        cell.setValue(fileName);
      }
      cell.setNote(`${tipoNorm} · ${fase} · Paso ${pasoSec}\n${currentEmail}\n${timestamp}`);
      try { evSheet.setRowHeight(targetRow, 60); } catch (_) {}
    } catch (sheetErr) {
      console.log("Aviso: No se pudo registrar el enlace en la hoja de evidencias: " + sheetErr);
    }

    return {
      status: "ok",
      message: "Evidencia guardada",
      fileUrl,
      fileId,
    };
  } catch (error) {
    return { status: "error", message: `Error al guardar evidencia: ${error}` };
  }
}

/** Obtiene las filas de las hojas de soporte (Lista de contactos, Servicios
 *  afectados y Listado CookBook) de un checklist, para editarlas desde el app. */
function getSupportData(spreadsheetId: string): Record<string, unknown> {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);

    const readRows = (name: string, cols: number): unknown[][] => {
      const sh = ss.getSheetByName(name);
      if (!sh) return [];
      const values = sh.getDataRange().getValues() as unknown[][];
      const rows: unknown[][] = [];
      for (let i = 1; i < values.length; i++) {
        const r: unknown[] = [];
        for (let c = 0; c < cols; c++) r.push(String(values[i][c] ?? ""));
        if (r.some((v) => String(v).trim() !== "")) rows.push(r);
      }
      return rows;
    };

    return {
      status: "ok",
      contactos: readRows("Lista de contactos", 2),
      servicios: readRows("Servicios afectados", 1).map((r) => r[0]),
      listado: readRows("Listado CookBook", 18),
    };
  } catch (error) {
    return { status: "error", message: `Error al obtener datos de soporte: ${error}` };
  }
}

/** Guarda en las hojas de soporte del checklist lo editado desde el app. */
function saveSupportData(spreadsheetId: string, datos: Record<string, unknown>): Record<string, unknown> {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);

    const writeRows = (name: string, startCol: number, cols: number, rows: unknown[][]): void => {
      let sh = ss.getSheetByName(name);
      if (!sh) {
        sh = ss.insertSheet(name);
        if (name === "Lista de contactos") {
          sh.appendRow(["Nombre", "Teléfono"]);
        } else if (name === "Servicios afectados") {
          sh.appendRow(["Nombre del SERVICIO"]);
        } else if (name === "Listado CookBook") {
          sh.appendRow([
            "", "Cód", "Área", "Tipología de Cambio", "Tipo de cambio Europa",
            "Tipo de cambio América", "Existe CBA homologada?", "¿Existe cookbook homologado?",
            "CBA (QUA%)", "Europa (Candidatas a L04)", "América (Candidatas a L04)",
            "Europa (Candidatas a L05)", "América (Candidatas a L05)",
            "Cookbook Level EUR", "Cookbook Level AME", "CBA", "CookBook", "URL",
            "CBA / CooBook", "",
          ]);
        }
        try {
          sh.getRange(1, 1, 1, 20).setBackground("#0e4d49")
            .setFontColor("#ffffff").setFontWeight("bold").setFontSize(10);
          sh.setFrozenRows(1);
        } catch (_) {}
      }
      const lastCol = Math.max(sh.getLastColumn() || 1, cols);
      sh.getRange(2, 1, Math.max(sh.getMaxRows(), 2) - 1, lastCol).clearContent();
      if (rows.length) sh.getRange(2, startCol, rows.length, cols).setValues(rows as string[][]);
    };

    writeRows("Lista de contactos", 1, 2, (datos.contactos as unknown[][]) || []);
    writeRows("Servicios afectados", 1, 1, ((datos.servicios as string[]) || []).map((s) => [s]));
    writeRows("Listado CookBook", 2, 18, (datos.listado as unknown[][]) || []);

    return { status: "ok", message: "Datos de soporte guardados en el sheet" };
  } catch (error) {
    return { status: "error", message: `Error al guardar datos de soporte: ${error}` };
  }
}

/** Migra los checklists ya creados para que tengan las 6 hojas de la
 *  plantilla (Lista de contactos, Servicios afectados, Listado CookBook y
 *  las hojas de Evidencia Técnica / Funcional) + carpeta de evidencias. */
function migrateChecklistSheets(): Record<string, unknown> {
  try {
    const index = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
    let ok = 0, fail = 0;
    const fails: string[] = [];
    for (let i = 1; i < index.length; i++) {
      const spreadsheetId = String(index[i][3] || "");
      const crq = String(index[i][1] || "");
      if (!spreadsheetId) continue;
      try {
        const ss = SpreadsheetApp.openById(spreadsheetId);
        createChecklistSupportSheets_(ss, crq);
        ok++;
      } catch (e) {
        fail++;
        fails.push(crq || spreadsheetId);
      }
    }
    const msg = `Migración: ${ok} checklists actualizados` + (fail ? `, ${fail} fallaron (${fails.join(", ")})` : "");
    return { status: "ok", message: msg };
  } catch (error) {
    return { status: "error", message: `Error al migrar: ${error}` };
  }
}

/** Get assignments for a specific checklist. */
function getChecklistAssignments(checklistId: string): Record<string, unknown> {
  try {
    const asignSheet = getMasterSheet("ASIGNACIONES");
    const asignData = asignSheet.getDataRange().getValues() as unknown[][];

    const assignments: Record<string, string> = {};
    for (let i = 1; i < asignData.length; i++) {
      if (String(asignData[i][0]) === checklistId) {
        const pasoSec = String(asignData[i][1]);
        const emailAsig = String(asignData[i][2]);
        assignments[pasoSec] = emailAsig;
      }
    }

    return {
      status: "ok",
      assignments,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener asignaciones: ${error}`,
    };
  }
}

/** Get all users from QPO-MASTER. ADMIN y LIDER-TEAM. */
function getUsers(): Record<string, unknown> {
  try {
    const email = resolveCurrentEmail();
    const isAdmin = isAdminUser(email);
    const isLider = isLiderTeamUser(email);
    if (!isAdmin && !isLider) {
      return { status: "error", message: "Solo administradores y líderes pueden ver usuarios" };
    }
    // LIDER-TEAM solo ve/gestiona el equipo de su propia área.
    const myArea = isAdmin ? null : getUserArea(email);
    const sheet = getMasterSheet("USUARIOS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    const users: Record<string, unknown>[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      // "Mi Equipo" del LIDER-TEAM = solo sus OPERADOR, no otros LIDER-TEAM/ADMIN del área
      if (myArea !== null && (String(row[3]) !== myArea || String(row[2]) !== "OPERADOR")) continue;
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

/** Toggle user active status. RF-4.4 */
function toggleUserActive(email: string, active: boolean): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    const isAdmin = isAdminUser(currentEmail);
    const isLider = isLiderTeamUser(currentEmail);

    if (!isAdmin && !isLider) {
      return { status: "error", message: "Solo administradores o líderes de equipo pueden modificar usuarios" };
    }

    return withLock(() => {
      const sheet = getMasterSheet("USUARIOS");
      const data = sheet.getDataRange().getValues() as unknown[][];

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).toLowerCase() === email.toLowerCase()) {
          if (!isAdmin) {
            const targetRol = String(data[i][2]);
            const targetArea = String(data[i][3]);
            const myArea = getUserArea(currentEmail);
            if (targetRol !== "OPERADOR" || targetArea !== myArea) {
              return { status: "error", message: "Solo puedes activar/desactivar operadores de tu propia área" };
            }
          }
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
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al cambiar estado del usuario: ${error}`,
    };
  }
}

/** Create a new user in QPO-MASTER. RF-4.2 */
function createUser(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    const isAdmin = isAdminUser(currentEmail);
    const isLider = isLiderTeamUser(currentEmail);

    if (!isAdmin && !isLider) {
      return { status: "error", message: "Solo administradores o líderes de equipo pueden crear usuarios" };
    }

    // LIDER-TEAM solo puede registrar OPERADOR de su propia área — nunca ADMIN/LIDER-TEAM
    // ni gente de otras áreas, para evitar que se auto-otorgue o reparta permisos elevados.
    let rol = String(data.rol);
    let area = String(data.area);
    if (!isAdmin) {
      rol = "OPERADOR";
      area = getUserArea(currentEmail) || area;
    }

    return withLock(() => {
      const sheet = getMasterSheet("USUARIOS");
      const sheetData = sheet.getDataRange().getValues() as unknown[][];

      // Verificar que el email no exista
      const email = String(data.email).toLowerCase().trim();
      for (let i = 1; i < sheetData.length; i++) {
        if (String(sheetData[i][0]).toLowerCase() === email) {
          return { status: "error", message: `El email ${email} ya está registrado` };
        }
      }

      const newRow = [
        email,
        String(data.nombre),
        rol,
        area,
        String(data.estado || ""),
        "",
        data.activo ? "SI" : "NO",
      ];

      sheet.appendRow(newRow);

      return {
        status: "ok",
        message: "Usuario creado exitosamente",
      };
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al crear usuario: ${error}`,
    };
  }
}

/** Update an existing user in QPO-MASTER. RF-4.3 */
function updateUser(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    const isAdmin = isAdminUser(currentEmail);
    const isLider = isLiderTeamUser(currentEmail);

    if (!isAdmin && !isLider) {
      return { status: "error", message: "Solo administradores o líderes de equipo pueden editar usuarios" };
    }

    return withLock(() => {
      const sheet = getMasterSheet("USUARIOS");
      const sheetData = sheet.getDataRange().getValues() as unknown[][];

      const email = String(data.email).toLowerCase();

      for (let i = 1; i < sheetData.length; i++) {
        if (String(sheetData[i][0]).toLowerCase() === email) {
          // LIDER-TEAM solo puede editar OPERADOR de su propia área, y no puede
          // cambiarles el rol ni moverlos a otra área.
          if (!isAdmin) {
            const targetRol = String(sheetData[i][2]);
            const targetArea = String(sheetData[i][3]);
            const myArea = getUserArea(currentEmail);
            if (targetRol !== "OPERADOR" || targetArea !== myArea) {
              return { status: "error", message: "Solo puedes editar operadores de tu propia área" };
            }
            data.rol = "OPERADOR";
            data.area = myArea;
          }

          sheet.getRange(i + 1, 2).setValue(data.nombre);
          sheet.getRange(i + 1, 3).setValue(data.rol);
          sheet.getRange(i + 1, 4).setValue(data.area);
          sheet.getRange(i + 1, 5).setValue(data.estado);
          sheet.getRange(i + 1, 7).setValue(data.activo ? "SI" : "NO");

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
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al actualizar usuario: ${error}`,
    };
  }
}

/**
 * Delete a checklist. RF-5.8
 * LIDER-TEAM puede eliminar los que creó; ADMIN puede eliminar cualquiera.
 */
function deleteChecklist(checklistId: string, spreadsheetId: string): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();
    const isAdmin = isAdminUser(currentEmail);
    const isLider = isLiderTeamUser(currentEmail);

    if (!isAdmin && !isLider) {
      return { status: "error", message: "Solo ADMIN o LIDER-TEAM pueden eliminar checklists" };
    }

    return withLock(() => {
      const indexSheet = getMasterSheet("CHECKLISTS_INDEX");
      const indexData = indexSheet.getDataRange().getValues() as unknown[][];

      let rowToDelete = -1;
      let resolvedSpreadsheetId = spreadsheetId;

      for (let i = 1; i < indexData.length; i++) {
        const rowChecklistId = String(indexData[i][0]);
        const rowSpreadsheetId = String(indexData[i][3]);
        const creadoPor = String(indexData[i][4]).toLowerCase();

        const matches = (checklistId && rowChecklistId === checklistId) ||
                        (spreadsheetId && rowSpreadsheetId === spreadsheetId);
        if (!matches) continue;

        // LIDER-TEAM solo puede eliminar los que creó
        if (!isAdmin && creadoPor !== currentEmail.toLowerCase()) {
          return { status: "error", message: "Solo puedes eliminar checklists que creaste" };
        }

        resolvedSpreadsheetId = rowSpreadsheetId;
        rowToDelete = i + 1;
        break;
      }

      if (rowToDelete > 0) {
        indexSheet.deleteRow(rowToDelete);
      }

      // Eliminar asignaciones relacionadas
      if (checklistId) {
        const asignSheet = getMasterSheet("ASIGNACIONES");
        const asignData = asignSheet.getDataRange().getValues() as unknown[][];
        for (let i = asignData.length - 1; i >= 1; i--) {
          if (String(asignData[i][0]) === checklistId) {
            asignSheet.deleteRow(i + 1);
          }
        }
      }

      // Mover el spreadsheet a la papelera
      if (resolvedSpreadsheetId) {
        try {
          DriveApp.getFileById(resolvedSpreadsheetId).setTrashed(true);
        } catch (driveError) {
          console.log("Aviso: No se pudo eliminar el spreadsheet: " + driveError);
        }
      }

      return {
        status: "ok",
        message: "Checklist eliminado exitosamente",
      };
    });
  } catch (error) {
    return {
      status: "error",
      message: `Error al eliminar checklist: ${error}`,
    };
  }
}

/**
 * RF-7: Datos para la vista de reportes (ADMIN).
 * Retorna resúmenes de CBAs y checklists.
 */
/** Trae el estado completo de un checklist desde su propio spreadsheet hacia RESULTADOS. Usado para backfill de checklists antiguos. */
function syncChecklistResults(checklistId: string): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden sincronizar el histórico" };
    }
    const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
    let spreadsheetId = "", crq = "";
    for (let i = 1; i < indexData.length; i++) {
      if (String(indexData[i][0]) === checklistId) { spreadsheetId = String(indexData[i][3]); crq = String(indexData[i][1]); break; }
    }
    if (!spreadsheetId) return { status: "error", message: "Checklist no encontrado" };

    let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
    try {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } catch (openErr) {
      return { status: "error", message: `Sin acceso al spreadsheet (créalo/compártelo con la cuenta que despliega la app): ${openErr}` };
    }
    const sheet = ss.getSheets()[0];
    const rows = sheet.getDataRange().getValues() as unknown[][];
    let synced = 0;
    for (let r = 7; r < rows.length; r++) {
      const sec = String(rows[r][0] || "").trim();
      if (!sec.match(/^\d+\.\d+/) && !/^CB\s/i.test(sec)) continue;
      upsertResultado_(
        checklistId, crq, spreadsheetId, sec,
        String(rows[r][1] || ""), String(rows[r][10] || ""),
        String(rows[r][9] || ""), String(rows[r][8] || rows[r][7] || "")
      );
      synced++;
    }
    return { status: "ok", synced };
  } catch (error) {
    return { status: "error", message: `Error al sincronizar: ${error}` };
  }
}

/**
 * Sincroniza todos los checklists que aún no tienen filas en RESULTADOS (los creados
 * antes de que existiera esta hoja, o cualquiera que se haya quedado desactualizado).
 * Es el "cargar histórico" que el ADMIN dispara bajo demanda desde el dashboard.
 */
function syncOlderChecklists(): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden sincronizar el histórico" };
    }
    const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
    const resultadosData = getMasterSheet("RESULTADOS").getDataRange().getValues() as unknown[][];
    const syncedIds = new Set(resultadosData.slice(1).map(r => String(r[0])));

    let count = 0;
    const fallidos: string[] = [];
    for (let i = 1; i < indexData.length; i++) {
      const checklistId = String(indexData[i][0]);
      const spreadsheetId = String(indexData[i][3]);
      if (!checklistId || !spreadsheetId || spreadsheetId === "undefined") continue;
      if (syncedIds.has(checklistId)) continue;
      // Aislado por checklist: si uno falla (ej. el ADMIN no tiene acceso al spreadsheet
      // porque lo creó otra cuenta y nunca se compartió), no debe tumbar el resto del lote.
      try {
        const r = syncChecklistResults(checklistId);
        if (r.status === "ok") count++;
        else fallidos.push(`${String(indexData[i][1])}: ${r.message}`);
      } catch (itemErr) {
        fallidos.push(`${String(indexData[i][1])}: ${itemErr}`);
      }
    }
    const msg = fallidos.length > 0
      ? `${count} sincronizado(s), ${fallidos.length} sin acceso: ${fallidos.join(" | ")}`
      : `${count} checklist(s) sincronizados`;
    return { status: "ok", message: msg, count, fallidos };
  } catch (error) {
    return { status: "error", message: `Error al sincronizar histórico: ${error}` };
  }
}

/**
 * Estado agregado de todos los checklists para el dashboard del ADMIN, calculado desde
 * la hoja central RESULTADOS (sin abrir cada spreadsheet individual).
 * scope "month" = solo checklists creados en el mes actual (rápido, default).
 * scope "all"   = todos los que ya estén sincronizados en RESULTADOS.
 */
function getAdminChecklistStatus(scope: string): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden ver este dashboard" };
    }
    const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
    const resultadosData = getMasterSheet("RESULTADOS").getDataRange().getValues() as unknown[][];

    // Agrupar filas de RESULTADOS por checklist_id
    const byChecklist: Record<string, unknown[][]> = {};
    for (let i = 1; i < resultadosData.length; i++) {
      const row = resultadosData[i];
      const cid = String(row[0]);
      if (!cid) continue;
      if (!byChecklist[cid]) byChecklist[cid] = [];
      byChecklist[cid].push(row);
    }

    const now = new Date();
    const isThisMonth = (d: unknown) => {
      const dt = new Date(String(d));
      return !isNaN(dt.getTime()) && dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    };

    const checklists: Record<string, unknown>[] = [];
    let totalOmitted = 0;
    for (let i = 1; i < indexData.length; i++) {
      const row = indexData[i];
      const checklistId = String(row[0]);
      if (!checklistId) continue;
      const fechaCreacion = row[8];
      if (scope === "month" && !isThisMonth(fechaCreacion)) { totalOmitted++; continue; }

      const rows = byChecklist[checklistId] || [];
      const cbaRows = rows.filter(r => String(r[5]) === "CBA");
      const done = cbaRows.filter(r => String(r[7] || "").trim() !== "").length;
      const total = cbaRows.length;

      const porFase: Record<string, { total: number; done: number }> = {};
      cbaRows.forEach(r => {
        const fase = String(r[3]) || "Sin fase";
        if (!porFase[fase]) porFase[fase] = { total: 0, done: 0 };
        porFase[fase].total++;
        if (String(r[7] || "").trim() !== "") porFase[fase].done++;
      });

      checklists.push({
        checklistId,
        crq: String(row[1]),
        cbaId: String(row[2]),
        spreadsheetId: String(row[3]),
        creadoPor: String(row[4]),
        estado: String(row[7]),
        fechaCreacion: String(row[8]),
        total,
        done,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
        sincronizado: rows.length > 0,
        porFase,
      });
    }

    return { status: "ok", checklists, scope, omitted: totalOmitted };
  } catch (error) {
    return { status: "error", message: `Error al obtener estado: ${error}` };
  }
}

function getReportData(): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden ver reportes" };
    }

    const cbasData = getMasterSheet("CBAS").getDataRange().getValues() as unknown[][];
    const checklistsData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];

    // RF-7.1: CBAs por área y estado
    const cbasByArea: Record<string, { pendientes: number; definidos: number }> = {};
    const cbasByMadurez: Record<string, number> = { L03: 0, L04: 0, L05: 0 };

    for (let i = 1; i < cbasData.length; i++) {
      const row = cbasData[i];
      if (!row[0]) continue;
      const area = String(row[2]) || "Sin área";
      const estado = String(row[17]) || "";
      const madurez = String(row[8]) || "";

      if (!cbasByArea[area]) cbasByArea[area] = { pendientes: 0, definidos: 0 };
      if (estado.includes("pendientes")) cbasByArea[area].pendientes++;
      else cbasByArea[area].definidos++;

      // RF-7.2: distribución por madurez
      if (madurez === "L03") cbasByMadurez.L03++;
      else if (madurez === "L04") cbasByMadurez.L04++;
      else if (madurez === "L05") cbasByMadurez.L05++;
    }

    // RF-7.3: checklists activos vs completados
    let activos = 0;
    let completados = 0;
    const checklistsByMonth: Record<string, { activos: number; completados: number }> = {};

    for (let i = 1; i < checklistsData.length; i++) {
      const row = checklistsData[i];
      if (!row[0]) continue;
      const estado = String(row[7]) || "";
      const fecha = String(row[8] || row[5] || "").substring(0, 7); // YYYY-MM

      if (estado === "Completado") completados++;
      else activos++;

      if (fecha) {
        if (!checklistsByMonth[fecha]) checklistsByMonth[fecha] = { activos: 0, completados: 0 };
        if (estado === "Completado") checklistsByMonth[fecha].completados++;
        else checklistsByMonth[fecha].activos++;
      }
    }

    return {
      status: "ok",
      report: {
        cbasByArea,
        cbasByMadurez,
        checklists: { activos, completados },
        checklistsByMonth,
        totals: {
          cbas: cbasData.length - 1,
          checklists: checklistsData.length - 1,
        },
      },
    };
  } catch (error) {
    return {
      status: "error",
      message: `Error al obtener reporte: ${error}`,
    };
  }
}

/**
 * Include external HTML/CSS files into templates.
 * This function is used with <?!= include('filename') ?> in HTML files.
 * 
 * @param filename - The name of the file to include (without extension for CSS, with .html for HTML)
 * @returns The file content as a string
 * 
 * @example
 * // In client.html:
 * // <style><?!= include('styles') ?></style>
 */
function include(filename: string): string {
  // If no extension provided, assume it's a CSS file
  const fileToInclude = filename.includes('.') ? filename : `${filename}.css`;
  
  try {
    return HtmlService.createHtmlOutputFromFile(fileToInclude).getContent();
  } catch (error) {
    Logger.log(`Error including file ${fileToInclude}: ${error}`);
    return `/* Error loading ${fileToInclude} */`;
  }
}
