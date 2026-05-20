---
name: backend-implementation-plan
description: Plan de implementación del backend para CBAs de ADMIN
metadata:
  type: project
---

# Plan de Implementación Backend

## Funciones a Crear/Modificar

### 1. GESTIÓN DE ÁREAS (CRUD)
```typescript
// ✅ Nueva función
function getAreas(): Record<string, unknown>

// ✅ Nueva función
function createArea(codigo: string, nombre: string): Record<string, unknown>

// ✅ Nueva función
function updateArea(codigoAnterior: string, codigo: string, nombre: string): Record<string, unknown>

// ✅ Nueva función
function deleteArea(codigo: string): Record<string, unknown>
```

### 2. CREACIÓN/EDICIÓN DE CBA (NUEVA ESTRUCTURA)
```typescript
// ✅ Modificar existente
function createCBA(cba: CBANew): Record<string, unknown>
// Campos nuevos a aceptar: 
// - areaTecnica
// - nombreTipologia
// - gestionDelCambio
// - nombreCBA
// - letraCBA
// - numeroCookbok
// - candidataL04
// - candidataL05
// - madurez
// - urlCBA
// - secuencia
// - tituloCatalogo
// - codificacionTipologia
// - fechaIncorporacion

// ✅ Nueva función
function updateCBA(id: string, cba: CBANew): Record<string, unknown>

// Modificar existente - ya existe deleteCBA()
```

### 3. VERIFICACIÓN DE PERMISOS
```typescript
// ✅ Nueva función
function isAdminUser(email: string): boolean

// ✅ Nueva función
function isLiderTeamUser(email: string): boolean
```

### 4. ACTUALIZAR processRequest()
```typescript
// Agregar casos en el switch:
case "getAreas": return getAreas()
case "createArea": return createArea(...)
case "updateArea": return updateArea(...)
case "deleteArea": return deleteArea(...)
case "updateCBA": return updateCBA(...)
```

---

## Cambios en Estructura de Datos

### Sheet: AREAS (NUEVO)
```
Columns:
0: Código
1: Nombre Área
```

### Sheet: CBAS_NETWORKING (EXPANDIDO)
Estructura actual: 8 columnas
Estructura nueva: ~18 columnas

```
Columnas esperadas:
0: ID (autogenerado)
1: Código Área
2: Área Técnica (nombre)
3: Nombre de la tipología
4: Gestión del Cambio (Normal/Fastrack)
5: Nombre CBA
6: Candidatas L04 (SI/NO)
7: Candidatas L05 (SI/NO)
8: Madurez (L03/L04/L05)
9: Letra CBA
10: Número Cookbok
11: URL CBA
12: Codificación tipología
13: Secuencia
14: Título en catálogo
15: Fecha incorporación
16: Persona QO
17: Estado (Pasos pendientes / Pasos definidos)
```

---

## Interfaces TypeScript a Actualizar

```typescript
interface CBA {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  descripcion: string;
  estado: string;
  creado: string;
  responsable: string;
  pasos?: { ... }
}

// Cambiar a:
interface CBANew {
  id?: string;
  areaTecnica: string;
  codigoArea: string;
  nombreTipologia: string;
  gestionDelCambio: string; // "Normal" | "Fastrack"
  nombreCBA: string;
  candidataL04: string; // "SI" | "NO"
  candidataL05: string; // "SI" | "NO"
  madurez: string; // "L03" | "L04" | "L05"
  letraCBA: string;
  numeroCookbok: string;
  urlCBA: string;
  codificacionTipologia: string;
  secuencia: number;
  tituloCatalogo: string;
  fechaIncorporacion: string; // YYYY-MM-DD
  personaQO: string; // Auto
  estado: string; // Auto: "Pasos pendientes"
}

interface Area {
  codigo: string;
  nombre: string;
}
```

---

## Dependencias Necesarias

1. Sheet AREAS debe estar registrado en el MAESTRO_SHEET_ID
2. Validación de usuario ADMIN en cada función de creación/edición
3. ID autogenerado para CBAs (como actualmente existe)

---

## Orden de Implementación

1. ✅ Crear interfaz CBANew
2. ✅ Crear funciones de CRUD de Áreas
3. ✅ Agregar validación isAdminUser()
4. ✅ Crear nueva función createCBA() con todos los campos
5. ✅ Crear función updateCBA()
6. ✅ Actualizar processRequest() con nuevos casos
7. ✅ Prueba básica
