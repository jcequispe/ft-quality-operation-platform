---
name: admin-cba-fields
description: Especificación completa de campos para creación de CBA por ADMIN
metadata:
  type: project
---

# Especificación: Creación de CBA por ADMIN

## ✅ Aclaraciones Confirmadas

1. **"Nombre AREA" = "Area Tecnica"** 
   - Necesita CRUD separado para gestionar las 12 áreas
   - Áreas predefinidas: Networking, Open systems, Storage, BBDD, Storage Host, Sistemas Mainframe, DB2 Host, IMS/CICS Host, DC Distribuidos, Middleware, Seguridad, Informacionales

2. **"Gestion del Cambio"** - Selector con 2 opciones
   - Normal
   - Fastrack

3. **"Candidatas a L04/L05"** - Independientes SI/NO
   - Pueden ser ambas SI a la vez
   - Son columnas separadas (no excluyentes)

4. **"Madurez (L03, L04, L05)"** - Selector único manual
   - Independiente de L04/L05
   - Usuario elige una sola opción

5. **"Letra de CBA"** - Manual, alfabético
   - Usuario ingresa manualmente
   - Patrón: A, B, C, D... del abecedario

6. **"Numero de Cookbok"** - Requerido

---

## Campos Completos (Ordenados por Formulario)

### SECCIÓN 1: Identificación
- Área Técnica (Select de lista de 12 áreas)
- Nombre de la tipología de cambio (Text)
- Codificación de la tipología de cambio (Text - ej: PER-N01-A-01-L03-...)

### SECCIÓN 2: Configuración del Cambio
- Gestión del Cambio (Select: Normal / Fastrack)
- Madurez (Select: L03 / L04 / L05)
- Letra de CBA (Text, manual, alfabético)
- Número de Cookbok (Number, requerido)

### SECCIÓN 3: Información de la CBA
- Nombre de la CBA usada para esa tipología de cambio (Text)
- Secuencia de la CBA (Number - ej: 1)
- Título de la CBA en el catálogo (Text)
- URL de la CBA (URL)

### SECCIÓN 4: Niveles y Delegación
- Candidatas a L04 (Delegables a equipo junior) (Radio: SI / NO)
- Candidatas a L05 (Automatizables) (Radio: SI / NO)

### SECCIÓN 5: Auditoría
- Fecha incorporación en el catálogo (Date picker)
- Persona de QO que hace el registro (Auto - usuario actual)

---

## Estructura de Datos (CBA en Google Sheets)

Basado en el ejemplo:
```
0,Cód,Área Técnica,Nombre de la tipología de cambio,Gestión del cambio,
Nombre de la CBA usada...,Candidatas a L04,Candidatas a L05,
Madurez de la tipología de cambio,Letra de CBA,Número de CookBook,
URL de la CBA,Codificación de la tipología de cambio,Secuencia de la CBA,
Título de la CBA en el catálogo,Fecha incorporación,Persona de QO,
Nombre ÁREA,Código ÁREA
```

---

## Cambios Necesarios en la Aplicación

1. **Backend (index.ts)**
   - Agregar `createCBA()` accesible solo para ADMIN
   - Agregar `updateCBA()` accesible solo para ADMIN
   - Agregar `deleteCBA()` accesible solo para ADMIN
   - Agregar `getAreas()` para llenar dropdowns
   - Agregar `manageAreas()` CRUD para ADMIN

2. **Frontend (client.html)**
   - Cambiar menú del ADMIN:
     - Quitar "Todas las CBAs" (read-only)
     - Agregar "Crear CBA"
     - Agregar "Gestionar Áreas"
   - Cambiar menú del LIDER-TEAM:
     - Mantener "Mis CBAs" pero solo para agregar pasos
     - Quitar "Crear CBA"

3. **Vistas necesarias**
   - Vista: Gestionar Áreas (CRUD completo)
   - Vista: Crear CBA (Formulario con 12 secciones)
   - Vista: Editar CBA (Mismo formulario)
   - Vista: Listar CBAs (Para ADMIN, con opciones editar/eliminar)

---

## Flujo Nuevo

```
ADMIN
├─ Gestionar Áreas (CRUD)
├─ Crear CBA (Formulario)
├─ Mis CBAs (Ver, Editar, Eliminar)

LIDER-TEAM
├─ Mis CBAs (Ver, Agregar Pasos - no crear)

OPERADOR
├─ Crear Checklist (usando CBAs existentes)
├─ Mis Checklists (Editar, Eliminar)
```
