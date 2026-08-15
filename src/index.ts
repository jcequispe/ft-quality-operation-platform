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

    // Verificar que el usuario tiene asignado este paso
    const asignaciones = getMasterSheet("ASIGNACIONES").getDataRange().getValues() as unknown[][];
    let esAsignado = false;
    for (let i = 1; i < asignaciones.length; i++) {
      if (
        String(asignaciones[i][0]) === checklistId &&
        String(asignaciones[i][1]) === pasoSec &&
        String(asignaciones[i][2]).toLowerCase() === currentEmail
      ) {
        esAsignado = true;
        break;
      }
    }

    // LIDER-TEAM y ADMIN también pueden guardar
    if (!esAsignado && !isAdminUser(currentEmail) && !isLiderTeamUser(currentEmail)) {
      return { status: "error", message: "No tienes permiso para editar este paso" };
    }

    return withLock(() => {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheets()[0];
      const data = sheet.getDataRange().getValues() as unknown[][];

      // Buscar la fila del paso por su sec (ej: "1.1", "2.3")
      for (let i = 7; i < data.length; i++) {
        if (String(data[i][0]).trim() === pasoSec.trim()) {
          // Col 8 = Inicio Real, 9 = Fin Real, 10 = Nombre Técnico, 11 = Resultado
          if (inicioReal) sheet.getRange(i + 1, 8).setValue(inicioReal);
          if (finReal)    sheet.getRange(i + 1, 9).setValue(finReal);
          if (nombreTecnico) sheet.getRange(i + 1, 10).setValue(nombreTecnico);
          sheet.getRange(i + 1, 11).setValue(resultado || "");
          break;
        }
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
      return deleteChecklist(data.checklistId as string, data.spreadsheetId as string);
    case "getReportData":
      return getReportData();
    case "getChecklistAssignments":
      return getChecklistAssignments(data.checklistId as string);
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
        data.base64Data as string
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
          const newRow = [cbaId, faseName, step.sec, step.tipoTarea, step.ambito, step.descripcion, step.responsable || ""];
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

    if (!isLiderTeamUser(currentEmail) && !isAdminUser(currentEmail)) {
      return {
        status: "error",
        message: "Solo LIDER-TEAM puede crear checklists",
      };
    }

    // Obtener info del CBA
    const cbasSheetData = getMasterSheet("CBAS").getDataRange().getValues() as unknown[][];
    const cbaInfo = cbasSheetData.find((row, idx) => idx > 0 && String(row[0]) === templateId);
    const cbaCode   = cbaInfo ? String(cbaInfo[12]) : "";  // codificacionTipologia
    const cbaName   = cbaInfo ? String(cbaInfo[5])  : "";  // nombreCBA
    const cbaTitulo = cbaInfo ? String(cbaInfo[14]) : "";  // tituloCatalogo (ej: "E-V01 CBA+CB Gestión de parámetros")

    // Obtener pasos del CBA plantilla
    const templateSheetData = getMasterSheet("PASOS").getDataRange().getValues() as unknown[][];
    const templateSteps = templateSheetData.filter((row, idx) => idx > 0 && String(row[0]) === templateId);

    // Crear nuevo spreadsheet
    const newSpreadsheet = SpreadsheetApp.create(`Checklist_${crq}_${new Date().getTime()}`);
    const sheet = newSpreadsheet.getSheets()[0];
    sheet.setName("Checklist");
    const spreadsheetId = newSpreadsheet.getId();

    try {
      DriveApp.getFileById(spreadsheetId).addEditor(currentEmail);
    } catch (e) {
      console.log("Aviso: No se pudo compartir: " + e);
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

    // Fila 1: descripción CBA
    sheet.appendRow([
      "",
      "Descripción Tipo de tarea",
      `CBA: ${cbaTitulo || cbaName}`,
      "", "", "", "", "", "", "", ""
    ]);

    // Fila 2: etiquetas
    sheet.appendRow([
      "",
      "CRQ",
      "",
      "TÍTULO INTERVENCIÓN",
      "Tipo de cambio",
      "FECHA INICIO",
      "FECHA FIN",
      "Freezing",
      "", "", ""
    ]);

    // Fila 3: datos del cambio
    sheet.appendRow([
      level || "Level",
      crq,
      "",
      `${cbaCode} ${cbaName}`.trim(),
      tipoChangio || "Normal",
      fechaInicio,
      fechaFin,
      freezing || "",
      "", "", ""
    ]);

    // Fila 4: info adicional
    sheet.appendRow([
      level || "L03",
      "CookBook y/o FT",
      "",
      cbaName,
      "No Fast Track",
      "NA",
      "NA",
      "NA",
      "", "", ""
    ]);

    // Fila 5: versión label
    sheet.appendRow(["Version", "", "", "", "", "", "", "", "", "", ""]);

    // Fila 6: versión valor
    sheet.appendRow(["V01", "PERÚ", "", "", "", "", "", "", "", "", ""]);

    // Fila 7: encabezados de tabla — columnas fijas del Excel
    sheet.appendRow([
      "Sec.",            // col 1  → índice 0
      "Tipo de tarea",   // col 2  → índice 1
      "Ámbito",          // col 3  → índice 2
      "Descripción tarea", // col 4 → índice 3
      "Equipo Técnico",  // col 5  → índice 4  (usado para asignación)
      "Inicio Previsto", // col 6  → índice 5
      "Fin Previsto",    // col 7  → índice 6
      "Inicio Real",     // col 8  → índice 7
      "Fin Real",        // col 9  → índice 8
      "Nombre del Técnico", // col 10 → índice 9
      "Resultado OK/KO", // col 11 → índice 10
    ]);

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

    const stepsByPhase: Record<string, unknown[][]> = { pre: [], int: [], post: [], ret: [] };

    templateSteps.forEach((row) => {
      const faseRaw = String(row[1]).toUpperCase().replace(/\s+/g, "");
      const step = [
        "",          // Sec. — se asigna al escribir
        String(row[3] || ""),  // Tipo de tarea
        String(row[4] || "PERÚ"), // Ámbito
        String(row[5] || ""),  // Descripción tarea
        "",          // Equipo Técnico (se asigna con assignStep)
        fechaInicio, // Inicio Previsto
        fechaFin,    // Fin Previsto
        "",          // Inicio Real
        "",          // Fin Real
        "",          // Nombre del Técnico
        "",          // Resultado OK/KO
      ];

      if      (faseRaw.includes("PRE"))     stepsByPhase.pre.push(step);
      else if (faseRaw.includes("POST"))    stepsByPhase.post.push(step);
      else if (faseRaw.includes("RETORNO")) stepsByPhase.ret.push(step);
      else if (faseRaw.includes("INTERV"))  stepsByPhase.int.push(step);
    });

    // ── Escribir fases y pasos ──
    phases.forEach((phase, phaseIdx) => {
      const phaseHeaderRow = sheet.getLastRow() + 1;
      sheet.appendRow([
        String(phase.number), "", "", phase.name, "", "", "", "", "", "", ""
      ]);

      try {
        const hdrRange = sheet.getRange(phaseHeaderRow, 1, 1, 11);
        hdrRange.setBackground(phase.color);
        hdrRange.setFontColor(phase.fontColor);
        hdrRange.setFontWeight("bold");
        hdrRange.setFontSize(10);
        // Bordes
        hdrRange.setBorder(true, true, true, true, false, false, "#ffffff", SpreadsheetApp.BorderStyle.SOLID);
      } catch (_) {}

      const steps = stepsByPhase[phase.key] || [];
      steps.forEach((stepRow, stepIdx) => {
        const rowArr = [...(stepRow as unknown[])];
        rowArr[0] = `${phase.number}.${stepIdx + 1}`;
        const stepRowNum = sheet.getLastRow() + 1;
        sheet.appendRow(rowArr as string[]);

        // Alternar color de filas para legibilidad
        try {
          const rowRange = sheet.getRange(stepRowNum, 1, 1, 11);
          rowRange.setBackground(stepIdx % 2 === 0 ? "#ffffff" : "#f8f9fa");
          rowRange.setFontSize(10);
          rowRange.setBorder(false, false, true, false, false, false, "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID);
          // La columna Resultado tiene fondo distinto para que llame la atención
          sheet.getRange(stepRowNum, 11).setBackground("#fff9c4");
        } catch (_) {}
      });

      if (phaseIdx < phases.length - 1) {
        sheet.appendRow(["", "", "", "", "", "", "", "", "", "", ""]);
      }
    });

    // Registrar en CHECKLISTS_INDEX
    const checklistId = `CHK-${crq}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    withLock(() => {
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
    });

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
    const crq = String(checklistRow[1]);

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

    // RF-6.3: Notificar a la persona asignada
    try {
      sendNotification(
        email.trim(),
        `Nuevo paso asignado — CRQ ${crq}`,
        `Se te ha asignado el paso ${pasoSec} del checklist de la CRQ ${crq}.\nAccede directamente aquí: https://docs.google.com/spreadsheets/d/${spreadsheetId}`
      );
    } catch (notifErr) {
      console.log("Aviso: No se pudo enviar notificación: " + notifErr);
    }

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
 * Guarda evidencias fotográficas en la pestaña "Evidencias" del spreadsheet.
 * Las evidencias se insertan como imágenes en la columna correspondiente a su fase.
 * Cada imagen queda asociada a: checklist + fase + paso + usuario + timestamp.
 */
function saveEvidence(
  spreadsheetId: string,
  checklistId: string,
  fase: string,         // "PRE-INTERVENCIÓN" | "DURANTE" | "POST-INTERVENCIÓN"
  pasoSec: string,
  fileName: string,
  mimeType: string,
  base64Data: string    // dataUrl sin el prefijo "data:...;base64,"
): Record<string, unknown> {
  try {
    const currentEmail = resolveCurrentEmail();

    // Limpiar el base64 (puede llegar con prefijo data:...)
    const cleanBase64 = base64Data.includes(",")
      ? base64Data.split(",")[1]
      : base64Data;

    const ss = SpreadsheetApp.openById(spreadsheetId);

    // Crear o encontrar la pestaña "Evidencias"
    let evSheet = ss.getSheetByName("Evidencias");
    if (!evSheet) {
      evSheet = ss.insertSheet("Evidencias");

      // Encabezados de la pestaña Evidencias (estructura del Excel)
      evSheet.appendRow([
        "Fecha/Hora", "Usuario", "Fase", "Paso", "Archivo", "Tipo",
      ]);
      try {
        evSheet.getRange(1, 1, 1, 6).setBackground("#4a86e8").setFontColor("#ffffff").setFontWeight("bold");
        evSheet.setColumnWidth(1, 160);
        evSheet.setColumnWidth(2, 200);
        evSheet.setColumnWidth(3, 160);
        evSheet.setColumnWidth(4, 80);
        evSheet.setColumnWidth(5, 220);
        evSheet.setColumnWidth(6, 100);
      } catch (_) {}
    }

    // Guardar el archivo en Google Drive (carpeta del spreadsheet padre)
    let fileId = "";
    let fileUrl = "";
    try {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(cleanBase64),
        mimeType,
        fileName
      );

      // Guardar en carpeta de Drive junto al checklist
      const parentFolder = DriveApp.getFileById(spreadsheetId).getParents();
      const folder = parentFolder.hasNext() ? parentFolder.next() : DriveApp.getRootFolder();
      const file = folder.createFile(blob);
      file.setName(`[${checklistId}] ${fase} - ${pasoSec} - ${fileName}`);
      fileId = file.getId();
      fileUrl = file.getUrl();

      // Compartir con el creador del checklist
      try {
        const indexData = getMasterSheet("CHECKLISTS_INDEX").getDataRange().getValues() as unknown[][];
        for (let i = 1; i < indexData.length; i++) {
          if (String(indexData[i][0]) === checklistId) {
            file.addViewer(String(indexData[i][4]));
            break;
          }
        }
      } catch (_) {}
    } catch (driveErr) {
      console.log("Error guardando en Drive: " + driveErr);
      return { status: "error", message: "No se pudo guardar el archivo en Drive: " + driveErr };
    }

    // Registrar en la pestaña Evidencias del spreadsheet
    const timestamp = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
    evSheet.appendRow([
      timestamp,
      currentEmail,
      fase,
      pasoSec,
      fileUrl ? `=HYPERLINK("${fileUrl}","${fileName}")` : fileName,
      mimeType.startsWith("image/") ? "Imagen" : "Archivo",
    ]);

    // Si es imagen, intentar insertarla como imagen en la celda
    if (mimeType.startsWith("image/") && fileId) {
      try {
        const lastRow = evSheet.getLastRow();
        const imageFormula = `=IMAGE("https://drive.google.com/uc?id=${fileId}&export=view",2)`;
        evSheet.getRange(lastRow, 7).setFormula(imageFormula);
        evSheet.setRowHeight(lastRow, 100);
        evSheet.getRange(lastRow, 7, 1, 1).setNote(`Evidencia ${fase} - Paso ${pasoSec}`);
      } catch (_) {}
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

/** Get all users from QPO-MASTER. Solo ADMIN. */
function getUsers(): Record<string, unknown> {
  try {
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden ver usuarios" };
    }
    const sheet = getMasterSheet("USUARIOS");
    const data = sheet.getDataRange().getValues() as unknown[][];

    const users: Record<string, unknown>[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
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
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden modificar usuarios" };
    }

    return withLock(() => {
      const sheet = getMasterSheet("USUARIOS");
      const data = sheet.getDataRange().getValues() as unknown[][];

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
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden crear usuarios" };
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
        String(data.rol),
        String(data.area),
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
    if (!isAdminUser(resolveCurrentEmail())) {
      return { status: "error", message: "Solo administradores pueden editar usuarios" };
    }

    return withLock(() => {
      const sheet = getMasterSheet("USUARIOS");
      const sheetData = sheet.getDataRange().getValues() as unknown[][];

      const email = String(data.email).toLowerCase();

      for (let i = 1; i < sheetData.length; i++) {
        if (String(sheetData[i][0]).toLowerCase() === email) {
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
