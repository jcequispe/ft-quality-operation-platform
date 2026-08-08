# Requisitos Funcionales — FT Quality Operation Platform

> Qué debe hacer el sistema, por rol y por módulo. Incluye la especificación de campos del CBA (antes en `CBA.txt` / `preguntas.txt`) ya incorporada como requisito formal.

## Roles

| Rol | Descripción |
|---|---|
| **ADMIN** | Administra el sistema completo: usuarios, áreas, CBAs |
| **LIDER-TEAM** | Líder de un área técnica; define los pasos de ejecución de los CBAs |
| **OPERADOR** | Ejecuta checklists en campo a partir de un CBA existente |

### Matriz de capacidades declarada (`data/roles.csv`)

| Capacidad | ADMIN | LIDER-TEAM | OPERADOR |
|---|:---:|:---:|:---:|
| Ver todos los checklists | Sí | — | — |
| Gestionar usuarios | Sí | — | — |
| Gestionar áreas | Sí | — | — |
| Gestionar CBAs (crear/editar/eliminar) | Sí | Sí* | — |
| Ver reportes | Sí | — | — |
| Exportar datos | Sí | — | — |
| Eliminar checklists | Sí | — | — |
| Ver sus propios CBAs | — | Sí | — |
| Gestionar pasos de CBA | — | Sí | — |
| Ver checklists de su equipo | — | Sí | — |
| Ver templates asignados | — | — | Sí |
| Crear checklist (objetivo — hoy lo hace OPERADOR) | — | Sí | — |
| Asignar pasos del checklist a un técnico (objetivo, nuevo) | — | Sí | — |
| Completar los pasos que le fueron asignados | — | Sí | Sí |

**\* Inconsistencia a resolver:** `roles.csv` declara que LIDER-TEAM puede crear/editar/eliminar CBAs, pero el backend implementado restringe esas tres acciones a ADMIN — LIDER-TEAM solo agrega pasos a CBAs existentes (ver `isAdminUser()` en cada función de escritura). El developer debe confirmar con negocio cuál es la regla correcta antes de tocar esos permisos.

**Cambio de permiso a aplicar (objetivo):** `roles.csv` hoy declara `create_checklist` como permiso de OPERADOR. En la arquitectura objetivo, crear un checklist pasa a ser exclusivo de LIDER-TEAM (ver RF-5) — `roles.csv` debe actualizarse junto con el código, no es solo un cambio de documentación.

**Gap conocido:** ADMIN tiene declarado `create_roles` pero no existe ninguna pantalla ni función de gestión de roles — los 3 roles son fijos. `view_reports` / `export_data` tampoco están implementados hoy; quedan cubiertos por Looker Studio en la arquitectura objetivo.

---

## RF-1 — Gestión de Áreas (ADMIN)

- **RF-1.1** El sistema debe permitir listar las áreas técnicas (código + nombre).
- **RF-1.2** Solo ADMIN puede crear un área nueva (código manual, no autogenerado).
- **RF-1.3** Solo ADMIN puede editar el nombre o código de un área existente.
- **RF-1.4** Solo ADMIN puede eliminar un área.
- **RF-1.5** Las 12 áreas válidas son: Networking, Open systems, Storage, BBDD, Storage Host, Sistemas Mainframe, DB2 Host, IMS/CICS Host, DC Distribuidos, Middleware, Seguridad, Informacionales.

---

## RF-2 — Gestión de CBAs (ADMIN)

- **RF-2.1** Solo ADMIN puede crear un CBA nuevo.
- **RF-2.2** El ID del CBA se autogenera (`CBA-{timestamp}`).
- **RF-2.3** Al crear un CBA, su estado inicial es `Pasos pendientes`.
- **RF-2.4** Solo ADMIN puede editar o eliminar un CBA existente.
- **RF-2.5** Eliminar un CBA elimina también sus pasos asociados.

### Especificación de campos del formulario "Crear CBA" (18 campos)

| Sección | Campo | Tipo | Regla |
|---|---|---|---|
| Identificación | Área Técnica | Select (12 áreas) | Requerido |
| Identificación | Nombre de la tipología de cambio | Texto | Requerido |
| Identificación | Codificación de la tipología | Texto | ej. `PER-N01-A-01-L03` |
| Configuración | Gestión del Cambio | Select | `Normal` \| `Fastrack` |
| Configuración | Madurez | Select | `L03` \| `L04` \| `L05`, independiente de L04/L05 abajo |
| Configuración | Letra de CBA | Texto manual | Letra del abecedario (A, B, C...), sin autogenerar |
| Configuración | Número de Cookbook | Texto/Número | Requerido |
| Información | Nombre del CBA | Texto | — |
| Información | Secuencia | Número | — |
| Información | Título en catálogo | Texto | — |
| Información | URL del CBA | URL | Opcional |
| Delegación | Candidata a L04 (delegable a junior) | SI / NO | Independiente de L05 — pueden ser ambas SI |
| Delegación | Candidata a L05 (automatizable) | SI / NO | Independiente de L04 |
| Auditoría | Fecha de incorporación al catálogo | Fecha | — |
| Auditoría | Persona QO que registra | Texto (auto) | Usuario actual |

---

## RF-3 — Gestión de Pasos de CBA (ADMIN, LIDER-TEAM)

- **RF-3.1** ADMIN y LIDER-TEAM pueden definir los pasos de un CBA, organizados en 4 fases: PRE-INTERVENCIÓN, INTERVENCIÓN, POST-INTERVENCIÓN, RETORNO.
- **RF-3.2** Cada paso tiene: secuencia, tipo de tarea, ámbito, descripción, responsable.
- **RF-3.3** Guardar pasos reemplaza todos los pasos anteriores del CBA (no hace merge incremental).
- **RF-3.4** Al guardar pasos por primera vez, el estado del CBA cambia a `Pasos definidos`.

---

## RF-4 — Gestión de Usuarios (ADMIN)

- **RF-4.1** Solo ADMIN puede listar todos los usuarios.
- **RF-4.2** Solo ADMIN puede crear un usuario (email, nombre, rol, área, estado).
- **RF-4.3** Solo ADMIN puede editar los datos de un usuario.
- **RF-4.4** Solo ADMIN puede activar/desactivar un usuario sin eliminarlo.
- **RF-4.5** Un usuario inactivo no puede iniciar sesión en la plataforma.

---

## RF-5 — Checklists multi-equipo (LIDER-TEAM crea y asigna, cada asignado ejecuta)

Un CRQ real puede involucrar a varios equipos técnicos trabajando sobre el mismo checklist. El dueño del checklist ya no es una sola persona.

- **RF-5.1** Solo LIDER-TEAM puede crear un checklist, eligiendo un CBA de su área como plantilla y asociándolo a un CRQ.
- **RF-5.2** Al crear el checklist, el sistema genera un spreadsheet nuevo con los pasos del CBA copiados y organizados por fase.
- **RF-5.3** El LIDER-TEAM asigna cada paso individual del checklist a una persona (email), reutilizando la columna "Equipo Técnico" como campo formal de asignación — no todos los pasos tienen que ir a la misma persona.
- **RF-5.4** Al asignar, el sistema agrega a esa persona como editor del spreadsheet del checklist (si aún no lo era) y registra la asignación en `ASIGNACIONES` (`checklist_id`, `paso_sec`, `email_asignado`).
- **RF-5.5** Cada persona asignada completa los campos operativos (Inicio Real, Fin Real, Nombre del Técnico, Resultado) de los pasos que le fueron asignados. El frontend habilita esos campos solo en las filas donde el email de la sesión coincide con el asignado — **no hay restricción real a nivel de archivo**: cualquier editor puede técnicamente escribir en cualquier celda (ver nota de control de acceso en `architecture.md`, decisión consciente por simplicidad).
- **RF-5.6** "Mis Checklists" muestra a un usuario todo checklist donde tiene al menos un paso asignado, no solo los que creó — la consulta es contra `ASIGNACIONES`, no contra un único email dueño.
- **RF-5.7** El LIDER-TEAM puede reasignar un paso a otra persona después de creado el checklist.
- **RF-5.8** Un checklist puede eliminarse; esto borra el spreadsheet de Drive, su registro de índice y sus asignaciones.

---

## RF-6 — Notificaciones (objetivo, no implementado hoy)

- **RF-6.1** Cuando un ADMIN crea un CBA sin pasos, el LIDER-TEAM del área correspondiente debe recibir un aviso.
- **RF-6.2** Cuando se completan todos los pasos de un checklist, el LIDER-TEAM que lo creó debe recibir un aviso.
- **RF-6.3** Cuando LIDER-TEAM asigna un paso a alguien, esa persona debe recibir un aviso con el enlace directo al checklist.

---

## RF-7 — Reportes (objetivo, no implementado hoy)

- **RF-7.1** Debe existir una vista consolidada de CBAs por área y por estado (`Pasos pendientes` / `Pasos definidos`).
- **RF-7.2** Debe existir una vista de distribución de madurez (cuántos CBAs L03, L04, L05).
- **RF-7.3** Debe existir una vista de checklists activos vs completados por período.

---

*Fuente original de estos requisitos: `CBA.txt`, `preguntas.txt` y las notas de sesión en `.claude/` (ya incorporadas aquí y eliminadas del repo).*
