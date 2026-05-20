---
name: proximos-pasos-continuacion
description: Prompt y contexto para continuar con el proyecto después
metadata:
  type: project
---

# 📋 PRÓXIMOS PASOS - Continuación del Proyecto

## 🎯 Donde Estamos

Hemos implementado completamente el sistema de gestión de CBAs para ADMIN:
- ✅ Backend con 12 nuevas funciones
- ✅ Frontend con 5 nuevas vistas
- ✅ Cambios de permisos según rol
- ✅ Todo compilando sin errores
- ✅ Commit: `319f881`

**Estado:** Listo para pruebas, pendiente crear sheet AREAS

---

## ⚠️ BLOQUEADOR ACTUAL

**El sheet AREAS no existe.** Necesita crearse ANTES de probar cualquier funcionalidad.

### Crear Sheet AREAS

1. **En Google Sheets:**
   - Nuevo sheet llamado "AREAS"
   - 2 columnas: Código | Nombre

2. **Insertar datos (12 áreas):**
   ```
   01 | Networking
   02 | Open systems
   03 | Storage
   04 | BBDD
   05 | Storage Host
   06 | Sistemas Mainframe
   07 | DB2 Host
   08 | IMS/CICS Host
   09 | DC Distribuidos
   10 | Middleware
   11 | Seguridad
   12 | Informacionales
   ```

3. **Copiar ID del sheet:**
   - URL: https://docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/...
   - Copiar el ID

4. **Registrar en MAESTRO_SHEET_ID:**
   - Abrir sheet maestro (ID: 17cV-id6JYY7F14NIcpkMfuZ03QhjPb3cNRTViBrmT3Y)
   - Agregar fila:
     * Columna A: AREAS
     * Columna B: [ID del sheet AREAS copiado]

---

## 📋 CHECKLIST DE CONTINUACIÓN

Cuando retomes, haz esto en orden:

### FASE 1: Preparación
- [ ] Crear sheet AREAS con 12 áreas predefinidas
- [ ] Registrar ID en MAESTRO_SHEET_ID
- [ ] Verificar que la aplicación carga sin errores
- [ ] Login como ADMIN

### FASE 2: Pruebas Manuales
- [ ] Test: Ir a "Gestionar Áreas"
- [ ] Test: Crear nueva área
- [ ] Test: Editar área
- [ ] Test: Eliminar área
- [ ] Test: Ir a "Crear CBA"
- [ ] Test: Rellenar todos los 18 campos
- [ ] Test: Crear CBA
- [ ] Test: Ver CBA en "Mis CBAs"
- [ ] Test: Editar CBA desde "Mis CBAs"
- [ ] Test: Cambiar a LIDER-TEAM en usuarios
- [ ] Test: Verificar que LIDER-TEAM solo ve "Mis CBAs" con opción "Agregar Pasos"
- [ ] Test: Verificar que LIDER-TEAM NO ve "Crear CBA"

### FASE 3: Validación de Datos
- [ ] Abrir sheet CBAS_NETWORKING
- [ ] Verificar que las 19 columnas están pobladas correctamente
- [ ] Revisar que IDs se generan bien (CBA-timestamp)
- [ ] Revisar que Estado dice "Pasos pendientes"

### FASE 4: Casos Especiales (Opcional)
- [ ] Test: Crear CBA con ambas L04=SI y L05=SI
- [ ] Test: Crear CBA sin URL (campo opcional)
- [ ] Test: Intentar crear CBA como LIDER-TEAM (debe fallar)
- [ ] Test: Intentar gestionar áreas como LIDER-TEAM (debe fallar)

---

## 🔧 Funcionalidades Implementadas

### ADMIN - Nuevo Menú
```
➕ Crear CBA
📋 Mis CBAs (Ver, Editar, Eliminar)
🏢 Gestionar Áreas (CRUD)
👥 Usuarios
```

### LIDER-TEAM - Menú Actualizado
```
📋 Mis CBAs (Solo Agregar Pasos)
❌ Crear CBA (REMOVIDO - solo ADMIN)
```

### Formulario de Crear CBA (18 campos)

**Sección 1: Identificación**
- Área Técnica (dropdown de 12 áreas)
- Nombre de la Tipología
- Codificación de la Tipología

**Sección 2: Configuración**
- Gestión del Cambio (Normal / Fastrack)
- Madurez (L03 / L04 / L05)
- Letra CBA (manual, A-Z)
- Número de Cookbok

**Sección 3: Información**
- Nombre CBA
- Secuencia
- Título en Catálogo
- URL CBA

**Sección 4: Delegación**
- Candidata L04 (SI / NO)
- Candidata L05 (SI / NO)

**Sección 5: Auditoría**
- Fecha Incorporación
- Persona QO (auto)

---

## 📊 Estructura de Datos

### Sheet CBAS_NETWORKING (19 columnas)
```
0:  ID (CBA-timestamp)
1:  Código Área
2:  Área Técnica
3:  Nombre Tipología
4:  Gestión Cambio
5:  Nombre CBA
6:  Candidata L04
7:  Candidata L05
8:  Madurez
9:  Letra CBA
10: Número Cookbok
11: URL CBA
12: Codificación Tipología
13: Secuencia
14: Título Catálogo
15: Fecha Incorporación
16: Persona QO
17: Estado (auto: "Pasos pendientes")
18: Fecha Creación (auto)
```

### Sheet AREAS (2 columnas) - PENDIENTE CREAR
```
0: Código (01, 02, 03...)
1: Nombre (Networking, Open systems, etc.)
```

---

## 🐛 Si Encuentras Bugs

1. **Área no carga en dropdown:**
   - Verificar que AREAS está en MAESTRO_SHEET_ID
   - Verificar que el ID es correcto
   - Revisar console del navegador (F12)

2. **CBA no se guarda:**
   - Verificar que el usuario es ADMIN
   - Revisar permisos en isAdminUser()
   - Revisar que CBAS_NETWORKING existe

3. **LIDER-TEAM ve "Crear CBA":**
   - Revisar que el rol en USUARIOS está correcto
   - Verificar getMenuForRole() en client.html

---

## 📝 Comando para Continuar

Cuando retomes, usa este prompt:

```
Necesito continuar con el proyecto de CBAs. Hemos implementado:
- Backend: 12 funciones nuevas + interfaces CBANew, Area
- Frontend: 5 vistas nuevas + 2 componentes mejorados
- Todo compilando sin errores (commit 319f881)

PENDIENTE:
1. Crear sheet AREAS con 12 áreas predefinidas
2. Registrar en MAESTRO_SHEET_ID
3. Hacer pruebas manuales

¿Ayúdame a:
- [Opción 1] Guiarme en crear el sheet AREAS
- [Opción 2] Hacer las pruebas manuales
- [Opción 3] Resolver bugs específicos
- [Opción 4] Continuar con la siguiente fase
```

---

## 🎯 Próxima Fase (Después de Pruebas)

Una vez que todo funcione:

1. **Mejorar visualización:**
   - Agregar búsqueda/filtro en tablas
   - Paginación si hay muchas CBAs
   - Exportar a CSV

2. **Validaciones mejoradas:**
   - Validar que Código Área existe
   - Validar formato de código (PER-N01-A-01-L03)
   - Validar letra única (no repetida)

3. **Reportes:**
   - Reporte de CBAs por área
   - Reporte de madurez (cuántas L03, L04, L05)
   - Reporte de candidatas a L04/L05

4. **Integraciones:**
   - Audit log (quién creó/editó cada CBA)
   - Historial de cambios
   - Notificaciones a LIDER-TEAM cuando hay nueva CBA

---

## 📞 Archivos Clave

- `src/index.ts` - Backend con todas las funciones
- `src/client.html` - Frontend con todas las vistas
- `.claude/IMPLEMENTACION-COMPLETA.md` - Documentación técnica completa
- `.claude/admin-cba-fields.md` - Especificación de campos
