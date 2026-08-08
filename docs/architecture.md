# Arquitectura Objetivo — FT Quality Operation Platform

> Modelo C4 de la arquitectura **objetivo**: plataforma nativa de Google Workspace para gestión de CBAs y checklists de cambio, pensada para ~12 operadores. No describe el estado actual del código — es el destino a construir.

## Principios de diseño

1. **Un único spreadsheet maestro, no siete archivos sueltos.** `ROLES`, `AREAS`, `USUARIOS`, `CBAS`, `PASOS`, el índice de `CHECKLISTS` y las `ASIGNACIONES` viven como pestañas de **un** archivo (`QPO-MASTER`). Con 12 usuarios, separarlos en archivos de Drive independientes solo agrega permisos que gestionar y una capa de indirección (hoy resuelta por un sheet "Maestro" que mapea nombre → ID) que deja de ser necesaria.
2. **Un spreadsheet por actividad, eso sí separado.** Cada checklist que se ejecuta sobre un CRQ sigue siendo su propio archivo — es el registro aislado, compartible y con historial propio de esa intervención puntual. No se mezcla con el maestro.
3. **Un checklist es multi-equipo, no de un solo dueño.** Un CRQ real puede involucrar a varios equipos técnicos. El LIDER-TEAM crea el checklist y asigna cada paso individual a la persona que le corresponde; el spreadsheet se comparte con todos los asignados, no solo con quien lo creó.
4. **Google Workspace como plataforma completa, no solo como almacenamiento.** Drive para organización y auditoría (historial de versiones), Gmail/Chat para notificaciones, Looker Studio para reportes — en vez de reconstruir a mano lo que Google ya resuelve.

---

## 1. Contexto del sistema

```mermaid
C4Context
    title Contexto (objetivo) — FT Quality Operation Platform

    Person(admin, "ADMIN", "Gestiona usuarios, áreas y CBAs")
    Person(lider, "LIDER-TEAM", "Define pasos de CBA; crea checklists y asigna cada paso a un técnico")
    Person(operador, "OPERADOR", "Completa los pasos de checklist que le fueron asignados")

    System(platform, "FT Quality Operation Platform", "Web app (Google Apps Script)")

    System_Ext(sheets, "Google Sheets", "QPO-MASTER + spreadsheets de checklist por CRQ")
    System_Ext(drive, "Google Drive", "Organiza archivos por área/año, comparte con todos los asignados y guarda historial de versiones como auditoría")
    System_Ext(notif, "Gmail / Google Chat", "Notifica asignaciones nuevas y checklists completados")
    System_Ext(looker, "Looker Studio", "Dashboards en vivo sobre CBAs y checklists")

    Rel(admin, platform, "Administra CBAs, áreas y usuarios", "HTTPS")
    Rel(lider, platform, "Define pasos de CBA; crea y asigna checklists", "HTTPS")
    Rel(operador, platform, "Completa sus pasos asignados", "HTTPS")
    Rel(platform, sheets, "Lee / escribe", "Apps Script API")
    Rel(platform, drive, "Organiza y comparte archivos", "Drive API")
    Rel(platform, notif, "Envía avisos", "Apps Script triggers")
    Rel(looker, sheets, "Lee directo para reportes", "Looker Studio connector")
```

---

## 2. Contenedores

```mermaid
C4Container
    title Contenedores (objetivo) — FT Quality Operation Platform

    Person(user, "Usuario", "ADMIN / LIDER-TEAM / OPERADOR")

    System_Boundary(gas, "Google Apps Script Web App") {
        Container(client, "Cliente Web", "HTML/CSS/JS", "SPA servida por doGet(); corre en el navegador")
        Container(backend, "Backend GAS", "TypeScript → Apps Script", "Lógica de negocio, permisos, LockService para escrituras concurrentes")
    }

    ContainerDb(master, "QPO-MASTER", "1 Google Spreadsheet, 7 pestañas", "ROLES · AREAS · USUARIOS · CBAS · PASOS · CHECKLISTS_INDEX · ASIGNACIONES")
    ContainerDb(checklistFiles, "Spreadsheets de Checklist", "Google Sheets, 1 archivo por CRQ", "Creado por LIDER-TEAM; compartido como editor con cada persona asignada a un paso")
    Container(driveOrg, "Organización en Drive", "Carpetas por área/año", "Ordena los checklists y expone el historial de versiones como auditoría")
    Container(notifSvc, "Notificaciones", "Gmail API / Chat webhook", "Avisa al asignado cuando recibe un paso, y a LIDER-TEAM cuando el checklist se completa")
    Container(reports, "Looker Studio", "Dashboard", "Lee QPO-MASTER y el índice de checklists — sin construir UI de reportes")

    Rel(user, client, "Usa", "HTTPS")
    Rel(client, backend, "Llama funciones", "google.script.run (RPC)")
    Rel(backend, master, "CRUD por rol, con Lock", "SpreadsheetApp")
    Rel(backend, checklistFiles, "Crea / lee / escribe", "SpreadsheetApp")
    Rel(backend, driveOrg, "Archiva y agrega un editor por asignado", "DriveApp.addEditor() × N")
    Rel(backend, notifSvc, "Dispara avisos", "onEdit / triggers")
    Rel(reports, master, "Lee")
    Rel(reports, checklistFiles, "Lee vía índice")
```

**Reemplaza:** el sheet "Maestro" que hoy solo indexa IDs (`loadSheetIds()`) desaparece — `backend` abre `QPO-MASTER` una vez por `MASTER_SHEET_ID` fijo y accede a cada tabla con `getSheetByName()`. Los checklists por CRQ mantienen su patrón actual de archivo independiente, que ya funciona bien para ese propósito — solo que ahora se comparten con varios editores en vez de uno.

**Control de acceso — decisión explícita:** Google Sheets no ofrece permisos nativos por fila. Se decidió **no** usar Protected Ranges: todo asignado es editor del archivo completo, y es el frontend (`client.html`) el que habilita solo los campos operativos de las filas donde su email coincide con el asignado del paso. No hay garantía a nivel de Drive de que alguien no edite una fila ajena — es una convención de UI, aceptada conscientemente por simplicidad de construcción.

---

## 3. Componentes del backend

```mermaid
C4Component
    title Componentes (objetivo) — Backend GAS

    Container_Boundary(backend, "Backend GAS") {
        Component(router, "Router", "doGet · doPost · processRequest", "Punto de entrada único, despacha por 'action'")
        Component(masterRepo, "MasterRepo", "getMasterSheet(nombrePestaña)", "Abre QPO-MASTER una vez y expone cada pestaña por nombre")
        Component(auth, "Auth + Lock", "getCurrentUser · isAdminUser · withLock()", "Resuelve usuario por Session.getEffectiveUser() y serializa escrituras concurrentes")
        Component(areas, "Gestión de Áreas", "getAreas · createArea · updateArea · deleteArea", "CRUD — solo ADMIN escribe")
        Component(cbas, "Gestión de CBAs", "getCBAs · createCBA · updateCBA · deleteCBA · saveCBASteps", "CRUD de CBAs y pasos por fase")
        Component(checklists, "Gestión de Checklists", "createChecklist · getChecklistData · saveChecklistData", "Crea el spreadsheet por CRQ (solo LIDER-TEAM) y registra el índice en QPO-MASTER")
        Component(assign, "Asignación de Pasos", "assignStep · getMyAssignedChecklists", "LIDER-TEAM asigna cada paso a un email; agrega editor al archivo y escribe en ASIGNACIONES")
        Component(users, "Gestión de Usuarios", "getUsers · createUser · updateUser", "CRUD de usuarios — solo ADMIN")
        Component(notify, "Notificaciones", "notifyStepAssigned · notifyChecklistDone", "Envía avisos vía Gmail/Chat en puntos clave del flujo")
    }

    Rel(router, auth, "valida rol antes de mutar")
    Rel(router, areas, "despacha")
    Rel(router, cbas, "despacha")
    Rel(router, checklists, "despacha")
    Rel(router, assign, "despacha")
    Rel(router, users, "despacha")
    Rel(areas, masterRepo, "pestaña AREAS")
    Rel(cbas, masterRepo, "pestañas CBAS / PASOS")
    Rel(checklists, masterRepo, "pestaña CHECKLISTS_INDEX")
    Rel(assign, masterRepo, "pestaña ASIGNACIONES")
    Rel(users, masterRepo, "pestaña USUARIOS")
    Rel(cbas, auth, "usa withLock() al escribir")
    Rel(assign, notify, "dispara aviso al asignado")
    Rel(checklists, notify, "dispara aviso al completar")
    Rel(cbas, notify, "dispara aviso al definir pasos")
```

---

## 4. Modelo de datos objetivo

### `QPO-MASTER` (un spreadsheet, siete pestañas)

| Pestaña | Contenido | Nota |
|---|---|---|
| **ROLES** | 3 roles fijos (ADMIN, LIDER-TEAM, OPERADOR) y sus permisos | Catálogo estático |
| **AREAS** | 12 áreas técnicas (código + nombre) | Código numérico consistente en toda la app |
| **USUARIOS** | email, nombre, rol, área, activo | Fuente de permisos por email |
| **CBAS** | Catálogo unificado de CBAs de todas las áreas | Columna `area_codigo` reemplaza el acoplamiento a "Networking" |
| **PASOS** | Pasos de cada CBA por fase | Relacionado a CBAS por `cba_id` |
| **CHECKLISTS_INDEX** | Un registro por checklist creado | Apunta al `spreadsheetId` del archivo real de esa actividad; `creado_por` es el LIDER-TEAM |
| **ASIGNACIONES** | Un registro por (checklist, paso, persona) | `checklist_id`, `paso_sec`, `email_asignado`, `fecha_asignacion` — es la tabla que responde "¿en qué checklists tengo pasos asignados?" |

### Spreadsheets de Checklist (uno por CRQ)

Se mantienen igual que hoy: cabecera con datos del cambio (CRQ, fechas, freezing), tabla de pasos agrupada por fase (PRE-INTERVENCIÓN / INTERVENCIÓN / POST-INTERVENCIÓN / RETORNO). La columna "Equipo Técnico" de cada fila pasa a ser el campo de asignación formal (antes era texto libre). Se archivan automáticamente en una carpeta de Drive `Checklists/{área}/{año}` en lugar de quedar sueltos en la raíz, y se comparten como editor con cada email presente en `ASIGNACIONES` para ese checklist.

---

## 5. Qué resuelve esta arquitectura

| Problema actual | Solución objetivo |
|---|---|
| 7 archivos de Drive + sheet "Maestro" de IDs | 1 archivo `QPO-MASTER` con pestañas, sin indirección |
| `CBAS_NETWORKING` acoplado a una sola área | `CBAS` unificado con `area_codigo` |
| Escrituras concurrentes sin protección | `LockService` en cada función de escritura |
| Sin auditoría | Historial de versiones nativo de Drive sobre `QPO-MASTER` |
| Nadie se entera de pasos pendientes / checklists completados | Notificaciones Gmail/Chat en los puntos clave |
| Un checklist solo tiene un dueño (`email_operador`), no sirve para CRQs multi-equipo | LIDER-TEAM asigna cada paso a una persona distinta vía `ASIGNACIONES`; el archivo se comparte con todos |
| Ver el estado global exige abrir archivo por archivo | Looker Studio conectado directo a `QPO-MASTER` + `CHECKLISTS_INDEX` |

---

*Diagramas en sintaxis C4 de Mermaid — se renderizan nativamente en GitHub/GitLab y en cualquier visor Mermaid.*
