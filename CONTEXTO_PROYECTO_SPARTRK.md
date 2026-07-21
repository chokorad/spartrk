# SparTrk — Documentación completa del proyecto (v17)

Este documento es la fuente de verdad para retomar el desarrollo de SparTrk en un proyecto de Claude dedicado. Está armado a partir del código real del repo (no de memoria), así que si algo aquí no coincide con lo que ves en los archivos, gana el archivo — y hay que corregir este doc.

Última revisión: 20 de julio de 2026, contra el contenido real de `Downloads/Claude/spartrk/`, después de los ajustes de v17 (cascada de días extra, fixes de cronómetro y de sugerencia de peso).


---

## 1. Qué es SparTrk

SparTrk es una PWA (Progressive Web App) de seguimiento de entrenamientos de gimnasio, tema rojo/negro estilo espartano. Sin build step, sin frameworks, HTML/CSS/JS vanilla servido estático desde GitHub Pages. Backend en Firebase (Auth + Firestore). Se usa desde el navegador del celular, agregada a la pantalla de inicio como app — no requiere instalación de tienda de apps.

Mario la usa personalmente para su propio entrenamiento y planea usarla con clientes como entrenador (de ahí el catálogo de rutinas del "coach" que se explica más abajo).

---

## 2. ⚠️ Regla de oro

**No se cambia nada del código sin que Mario lo pida explícitamente.** Nada de refactors, mejoras, limpiezas ni "ya que ando aquí" por iniciativa propia. Antes de implementar cualquier cambio no trivial, se confirma el diseño con Mario y se espera su OK. Mario decide qué se hace; Claude propone y ejecuta solo lo aprobado.

Flujo de trabajo acordado:
- Los archivos viven en `Downloads/Claude/spartrk/` (carpeta viva conectada), no se trabaja con zips.
- Antes de cambios grandes al código, archivar la versión saliente en `otras cosas/previous_versions/v{N}/`.
- Cada deploy que toque `index.html`, `css/`, o `js/` debe bumpear `CACHE_NAME` en `sw.js`, y hay que decirle a Mario exactamente qué archivos subir a GitHub.
- Los archivos de `rutinas/` **no** requieren bump de caché (ver sección 8, son network-first).
- Para features grandes de UI: hacer preview HTML standalone antes de implementar en `app.js`.
- Verificar cambios con `node --check` / pruebas aisladas antes de darlos por buenos.

---

## 3. Stack técnico

- **Frontend**: HTML/CSS/JS vanilla, sin build step, sin frameworks. Servido estático desde GitHub Pages.
- **Backend**: Firebase v10.12.2 (SDK modular vía CDN `gstatic.com`), Auth (email/password + Google) y Firestore.
- **PWA**: `manifest.json` + `sw.js` con caché versionado (`CACHE_NAME = 'spartrk-v17'` actualmente). La carpeta `rutinas/` se sirve network-first (siempre fresca, caché solo como respaldo offline); todo lo demás es cache-first con red como respaldo.
- Proyecto Firebase: `spartrk` (ver `js/firebase-init.js` para la config completa — apiKey, authDomain, etc. ya están ahí, no son secretos críticos porque las reglas de Firestore protegen los datos por `uid`).

---

## 4. Estructura real de archivos

```
spartrk/                          ← esto es lo que se sube a GitHub Pages (root del repo)
  index.html                      (19 líneas — shell mínimo, monta <div id="app"> y carga js/app.js como módulo)
  manifest.json                   (PWA: nombre, iconos, colores, orientation portrait)
  firestore.rules                 (regla única: allow read/write si uid coincide)
  sw.js                           (60 líneas — cache versionado + network-first para rutinas/)
  css/
    style.css                     (225 líneas)
  js/
    app.js                        (1,685 líneas — TODA la lógica de UI/pantallas, ver mapa en sección 9)
    exercises-data.js             (66 líneas — catálogo base de ejercicios + rutina clásica + constantes)
    firebase-init.js              (38 líneas — config Firebase + exports del SDK)
  icons/                          (5 archivos: icon-32/180/192/512 + maskable-512)
  assets/exercises/               (GIFs animados + fotos start/end de los ejercicios base del catálogo fijo)
  rutinas/                        ← CATÁLOGO DE RUTINAS DEL COACH (ver sección 8)
    index.json                    (lista los 14 archivos de rutinas actuales)
    hombro_dia_libre.json
    strong_legs_routine.json
    2day_power_workout_dia1.json / dia2.json
    7_minutes_workout.json
    upper_body_a.json / upper_body_b.json
    lower_body_a.json / lower_body_b.json
    six_pack_routine.json
    power_arms_dia1_biceps.json / dia2_triceps.json
    muscle_chest_routine.json
    wide_back_routine.json

otras cosas/                      ← NO se sube a GitHub. Carpeta de trabajo local de Mario.
  previous_versions/v1 .. v8/     (snapshots archivados de versiones anteriores del repo completo)
  preview_dia1_final.html         (previews HTML standalone usados durante desarrollo de UI, antes de integrar a app.js)
  preview_fase_a.html
  preview_calendario_home.html
  preview_rutinas.html
```

**Importante para el nuevo proyecto**: la carpeta `otras cosas/` es un hallazgo de esta revisión — el doc de contexto anterior decía que `previous_versions/` vivía en la raíz del repo, pero en la carpeta real está anidada dentro de `otras cosas/`. Es decir, Mario reorganizó localmente para mantener limpio lo que sí se despliega. Cuando se archive una versión nueva, debe ir a `otras cosas/previous_versions/v{N+1}/`.

---

## 5. Modelo de datos en Firestore (`users/{uid}/...`)

| Documento/colección | Contenido |
|---|---|
| `weeks/{weekStartISO}` | Booleanos de días completados de esa semana. |
| `logs/{autoId}` | Historial de sesiones: `dayId`, `dayLabel`, `duracionMin`, `exercises[]` (series con `peso`, `repsLentas`, `repsNormales`, `sensacion`), `cardio`, `date` (Timestamp). |
| `lastExercise/{exerciseId}` | Última data por ejercicio (prefill y sugerencia de peso), `duraciones[]` (últimas 5 duraciones reales) y `avgDuracionMin`. |
| `exerciseOverrides/{exerciseId}` | Fotos personalizadas por ejercicio. |
| `routines/{routineId}` | Rutinas del usuario. Dos formas: creadas a mano (`{nombre, exerciseIds:[...]}`, usan las 4 series ascendentes clásicas) o importadas del catálogo (`{nombre, catalogId, items:[{id, sets:[...]}], customExercises:{...}}`, traen su propio esquema de series). |
| `settings/weekPlan` | `{enabled, diasPerWeek (3-7), days:{...}}`. Si no existe o `enabled:false` → Día 1-4 clásico. |
| `settings/progression` | `{mode: "tut" \| "total" \| "sensacion"}` (default `"tut"`). |
| `settings/increments` | Saltos de peso del gym: `{kg:2.5, lb:5, Barras:1}` (defaults). |
| Doc raíz | `lastExportedAt`. |

**Reglas de seguridad** (`firestore.rules`): `allow read, write` en `/users/{userId}/{document=**}` si `request.auth.uid == userId`. Una sola regla, todo bajo el uid del usuario autenticado.

**Gotchas de Firestore** (en `firebase-init.js`):
- `experimentalForceLongPolling: true` + `useFetchStreams: false`: fuerza long-polling desde el inicio en vez de intentar streaming primero. Algunos bloqueadores de anuncios tapan el canal "Listen" en streaming (`ERR_BLOCKED_BY_CLIENT`); con esto ya ni lo intenta.
- `ignoreUndefinedProperties: true`: red de seguridad — un campo `undefined` en un `setDoc` tronaba el guardado completo con `invalid-argument`. Esto causó un bug de producción antes de agregarse.

---

## 6. `js/exercises-data.js` — catálogo base y constantes

- `EXERCISES`: diccionario de ~19 ejercicios base (id → `{nombre, instrucciones, img}`), con GIFs/fotos en `assets/exercises/`. Este es el catálogo "fijo" del que se arma la rutina clásica de Mario.
- `ASCENDING_SETS`: las 4 series ascendentes clásicas — 15 reps @70%, 12 reps @80%, 10 reps @90%, serie efectiva máx 6 reps @100%.
- `DAYS`: la rutina "Básico 1" de Mario — 4 días clásicos (Brazo/Pierna/Espalda/Pecho), cada uno con su lista de ejercicios usando `ASCENDING_SETS`.
- `EMERGENCIA`: entrenamiento sin gym (bodyweight) — warmup + push-ups + bench dips + burpees + sentadillas + crunches, con reps fijas (no series ascendentes).
- `DAILY_TASK`: la "bombeada" diaria de laterales (1 serie, 15 reps).
- `EQUIPO_LATERALES` / `CARDIO_TIPOS`: opciones de selects.
- `estimateMinutes(sets)`: heurística para el ETA (≈1.5 min por serie real, mínimo 5 min si no hay series capturables).

---

## 7. `js/app.js` — mapa de funciones (1,765 líneas tras v17)

Todo vive en este archivo, sin separación en módulos por pantalla. Mapa por línea aproximada (los números de línea de abajo son de **antes** de v17 — v17 agregó ~80 líneas repartidas entre `renderHome`, `renderDayInner` y `buildExerciseBlock`, así que todo lo que esté después del punto del cambio quedó corrido; usar Grep por nombre de función en vez de confiar ciegamente en el número).

**Nuevo en v17**: `autoPauseOnLeave` (dentro de `renderDayInner`, junto a `startTimer`/`togglePause`) y los module-level `dayVisibilityHandler`/`dayPagehideHandler` para la autopausa. `markComplete(dayId, extraFields)` ahora acepta un segundo argumento opcional para fusionar campos extra (usado por la cascada de días extra).

**Utilidades y datos** (líneas 1–270)
`getMonday`, `isoDate`, `fmtDate`, `getExercise`, `imgSrc` — helpers de fecha/ejercicio.
`loadOverrides`, `loadWeekProgress`, `markComplete`, `loadLastData`, `saveLastData`, `loadMonthSessions` — I/O de Firestore para progreso semanal, prefill y calendario.
`loadRoutines`, `routineToExercises`, `routineExerciseCount`, `fetchCatalogRoutines`, `saveRoutine`, `deleteRoutineDoc` — rutinas propias del usuario + fetch del catálogo del coach (fase C).
`loadWeekPlan`, `saveWeekPlan`, `resetWeekPlan` — plan semanal configurable (3-7 días).
`loadProgressionMode`, `saveProgressionMode` — método de progresión de peso.
`loadWeightIncrements`, `saveWeightIncrements`, `roundToIncrement`, `oneDec` — saltos de peso y redondeo a discos reales.
`resolveEffectivePlan` — combina weekPlan + rutinas del usuario para saber qué día tocan hoy.

**Pantallas (screens)** — cada una hace `clearApp()` y repinta `#app`:
- `renderLogin` (283–314): auth email/password + Google.
- `renderHome` (315–487): pantalla semanal, calendario mensual (`buildCalendarSection`, 410–487), botón "+ Día extra" (`openExtraDaySheet`, 374–409).
- `renderConfig` (489–729): pantalla de Configurar (⚙), con sub-secciones:
  - Método de progresión de peso (509–542).
  - Saltos de peso del gym (543–616).
  - Rutinas del catálogo del coach — listar, importar, quitar (617–729).
- `renderRoutineEditor` (731–805): editor de rutina propia (nombre + selección de ejercicios; siempre usa las 4 series ascendentes clásicas, no editable ahí).
- `buildExerciseBlock` (806–1163): el bloque de captura por ejercicio dentro del día — incluye la lógica de sugerencia de peso por método de progresión (852–1163, comentada como "fase A": progreso por serie, punto "en curso", duración real).
- `renderDay` / `renderDayInner` (1211–1569): pantalla del día — captura de series, cronómetro con doble disparo manual/automático y pausa (1262–1383), colapso de ejercicios "en curso" con tercer color (1384–1569).
- `renderExport` / `formatExport` (1570–1685): exportar registros como texto.

**Progresión de peso** (líneas ~886–930, dentro de `buildExerciseBlock`): factor `1.05` (sube ~5%) o `0.95` (baja ~5%) según el modo:
- `sensacion`: sube si "Fácil", baja si "No completé".
- `total` / `tut`: baja si "No completé" o si el total de reps (o solo las lentas en modo `tut`) es menor a `REPS_MIN_EFECTIVA`; si no, sube.

Este comportamiento no ha cambiado desde v14 — confirmado contra el código, no contra memoria.

---

## 8. Catálogo de rutinas en GitHub (`rutinas/`)

La carpeta `rutinas/` del mismo repo funciona como catálogo del coach, independiente de las rutinas que cada usuario crea a mano.

**Mecánica de red**: en `sw.js`, cualquier request a una URL que contenga `/rutinas/` se sirve **network-first** (intenta red fresca primero, cae a caché solo si falla). Por eso agregar/editar rutinas nuevas **no requiere bumpear `CACHE_NAME`** — aparecen solas en cuanto se suben al repo.

**Flujo para agregar rutinas**: Mario manda la fuente (dictado, screenshot, PDF) → se genera el JSON siguiendo el esquema de abajo y se actualiza `index.json` → Mario sube esos archivos al repo → aparece en "Rutinas del catálogo" (dentro de Configurar) para todos los usuarios sin tocar código ni bumpear `sw.js`.

**En la app**: Configurar → "Rutinas del catálogo" lista lo que hay en `index.json`, con botón **importar** que copia la rutina a `routines/{routineId}` del usuario en Firestore (funciona offline después de importada). Las ya importadas muestran "importada ✓". Se pueden quitar pero no editar en el editor manual (el editor manual es solo para rutinas creadas a mano por el usuario, que siempre usan las 4 series ascendentes clásicas).

### Esquema JSON de una rutina de catálogo

Confirmado contra `rutinas/hombro_dia_libre.json` (el archivo original de referencia):

```json
{
  "id": "nombre_archivo_sin_extension",
  "nombre": "Nombre visible en la app",
  "descripcion": "Texto libre, contexto/instrucciones generales de la rutina.",
  "customExercises": {
    "id_ejercicio": {
      "nombre": "Nombre del ejercicio",
      "instrucciones": "Cómo ejecutarlo (texto libre).",
      "img": null
    }
  },
  "items": [
    {
      "id": "id_ejercicio",
      "sets": [
        { "label": "Texto libre visible, ej. 'Serie 1 · 8-10 reps · RPE 8-9 · desc 2 min'", "reps": 10 },
        { "label": "Calentamiento · ligero (~50%)", "noInput": true }
      ]
    }
  ]
}
```

Notas del esquema:
- `customExercises` son ejercicios que **no** existen en el catálogo base de `exercises-data.js`; cada rutina trae los suyos, con ids únicos dentro de ese archivo (no hay colisión entre rutinas distintas porque cada una tiene su propio diccionario).
- Cada `set` tiene un `label` de texto libre (lo que ve el usuario) y opcionalmente `reps` (número, usado para prefill/sugerencia). Si el set no debe capturar nada (calentamientos, ejercicios por tiempo sin objetivo numérico), se marca `"noInput": true` y se omite o ignora `reps`.
- Las rutinas del catálogo con esquema de rango de reps (ej. las del PDF "Muscle Building Workout Routine") no generan sugerencia automática de peso tipo ascendente — no tienen serie al 100%, solo llevan el rango tal cual en el `label` y el límite superior del rango como `reps` numérico (convención acordada con Mario).

### Rutinas actuales en el catálogo (14)

| Archivo | Origen | Notas |
|---|---|---|
| `hombro_dia_libre.json` | Original, hecha a mano con RPE/descanso estilo Nippard | Referencia del esquema |
| `strong_legs_routine.json` | Screenshot app de rutinas | 4 ejercicios, 3×10 |
| `2day_power_workout_dia1.json` / `dia2.json` | Screenshot app de rutinas | Rutina original a 2 días, partida en 2 archivos para seleccionar el día individualmente |
| `7_minutes_workout.json` | Screenshot app de rutinas | Circuito bodyweight, 12×30seg, sets `noInput:true` |
| `upper_body_a.json` / `upper_body_b.json` | PDF "The Muscle Building Workout Routine" (AWorkoutRoutine.com) | Split upper/lower a 4 días, reps con rango |
| `lower_body_a.json` / `lower_body_b.json` | Mismo PDF | Agregadas junto con la corrección de A/B de arriba |
| `six_pack_routine.json` | Screenshot app de rutinas | Abdomen + treadmill |
| `power_arms_dia1_biceps.json` / `dia2_triceps.json` | Screenshot app de rutinas | Rutina original a 2 días (Lunes bíceps / Miércoles tríceps), partida igual que 2day_power_workout |
| `muscle_chest_routine.json` | Screenshot app de rutinas | Pecho |
| `wide_back_routine.json` | Screenshot app de rutinas | Espalda |

**Diferencia de filosofía a tener presente**: el split upper/lower del PDF entrena cada grupo muscular 2x/semana; la rutina personal de Mario ("Básico 1", en `exercises-data.js`) es split por parte del cuerpo, 1x/semana cada grupo. No hay conflicto técnico — son rutinas de catálogo para que otros usuarios elijan — pero es una frecuencia distinta a la que Mario sigue.

---

## 9. Filosofía de entrenamiento (capa de coaching)

Mario sigue la filosofía de **Jeff Nippard** (documentos de referencia: "The Essentials Program" y "Ultimate Guide to Body Recomposition", en el proyecto de conocimiento "Gym Coach"). Claves que la app implementa:

- **Doble progresión**: progresar reps dentro de un rango; al llegar al tope con buena técnica, subir el peso mínimo posible y reiniciar el rango.
- **Reps lentas / tiempo bajo tensión**: tempo ~3 seg excéntrico / 2 seg concéntrico. La app registra reps lentas y normales por separado (`repsLentas`, `repsNormales`); en modo de progresión `tut` solo las lentas cuentan para subir peso.
- **RPE**: escala de esfuerzo 1-10 (10=fallo, 9=quedaba 1 rep, 8=quedaban 2).
- Registrar todo ("beat the logbook"); la fuerza es la métrica #1 de progreso.

Rutina base de Mario ("Básico 1"): método ascendente, 4 series de 15/12/10 reps al 70/80/90% + serie efectiva al 100% de máx 6 reps; 4 días (brazo/pierna/espalda/pecho); bombeada diaria de laterales; cardio elíptica 20-25 min post-entreno.

### Método de progresión de peso (configurable en Configurar ⚙, `settings/progression`)

1. **Reps totales** (`total`): cuentan todas las reps. 6 en la serie efectiva → sube ~5%; menos de 4 o "No completé" → baja ~5%. Campo único de reps.
2. **Tiempo bajo tensión** (`tut`, default, el de Mario): solo cuentan las reps lentas. 6 lentas limpias (cero normales) → sube ~5%; menos de 4 total o "No completé" → baja ~5%. Campos separados lentas/normal.
3. **Sensación de dificultad** (`sensacion`): "Fácil" → sube ~5%; "No completé" → baja ~5%. Campo único de reps.

### 9.1 Convención de reps lentas vs. normales (decidido 20 jul 2026)

En modo `tut`, antes se exigía `REPS_META_LENTAS` (6) reps **lentas y 0 normales** para subir el peso — cualquier rep "normal" mezclada impedía la subida, sin importar cuántas lentas hubo.

Mario preguntó si convenía permitir que la última rep del set efectivo sea "normal" (más explosiva, al filo del fallo) sin penalizar, ya que exigir tempo perfecto en las 6 reps no reflejaba cómo se ve realmente una serie llevada cerca del fallo. Primero se probó con mínimo 5 lentas de 6, y el mismo día se ajustó a la regla final: **"mitad y mitad" — sube el peso si hay mínimo `REPS_LENTAS_MIN_PARA_SUBIR` (3) reps lentas Y `REPS_META_LENTAS` (6) reps totales**. Es decir, de las 6 reps de la serie efectiva, al menos 3 deben ser lentas; las otras hasta 3 pueden ser normales/rápidas. La condición de "bajar" (menos de 4 reps totales o "No completé") no cambió.

Constantes en `buildExerciseBlock` (`js/app.js`): `REPS_META_LENTAS = 6`, `REPS_LENTAS_MIN_PARA_SUBIR = 3`, `REPS_MIN_EFECTIVA = 4`. Afecta tanto el mensaje de sugerencia basado en la sesión anterior como el aviso en vivo (`updateLiveHint`) mientras se captura la serie efectiva.

### Redondeo de pesos a discos reales

- Configurar → "Saltos de peso en tu gym": kg/lb/Barras (defaults 2.5/5/1), en `settings/increments`.
- Todas las sugerencias (máximo estimado y porcentajes 70/80/90) se redondean al múltiplo disponible; se muestra el objetivo exacto entre paréntesis.
- Si la subida ganada no alcanza el siguiente disco: se avisa que se quede en el peso actual sacando más reps, o brincar si se siente con fuerza.
- Si la bajada redondea al mismo peso: baja un disco completo.

---

## 10. Funcionalidad completa (resumen para referencia rápida)

1. Auth, pantalla semanal (Home), pantalla de día con captura por serie (peso, lentas, normal, sensación), unidades kg/lb/Barras.
2. Series ascendentes con sugerencia de pesos por porcentaje del máximo estimado.
3. Cronómetro de sesión con pausa (arranque manual o al tocar un campo), duración real por ejercicio promediada (últimas 5) para el ETA.
4. ETA dinámico que baja por cada serie llenada; incluye la tarea diaria con su duración promedio real.
5. Colapso de ejercicios con "Listo ✓", puntos de progreso (pendiente/en curso/hecho), banner de borrador restaurado.
6. Autoguardado de borrador en localStorage con restauración completa, incluida la pausa del cronómetro.
7. Calendario mensual en Home con puntos por sesión; fechas en hora local del dispositivo.
8. Rutinas propias + plan semanal configurable (3-7 días) + "+ Día extra" **en cascada** (v17: cada extra completado revela el siguiente slot, hasta un total de 7 días entrenados en la semana — no hay un botón fijo único) + entrenamiento de emergencia (sin gym).
9. Tarea diaria (bombeada de laterales) con selector de equipo.
10. Exportar registros como texto (todo, desde última exportación, o rango de fechas).
11. Red de seguridad: si un día truena al abrir, descarta el borrador y muestra tarjeta de recuperación — nunca pantalla negra.
12. Catálogo de rutinas del coach importable desde `rutinas/` (GitHub), con actualización sin deploy.

---

## 11. Historial de versiones

- **v13**: timer dual, calendario, rutinas configurables, día extra.
- **v14**: métodos de progresión (3 modos), regla de reps lentas estilo Nippard, catálogo de rutinas en GitHub, ejercicios/series personalizados.
- **v15**: fix crítico — restaurar borrador con cronómetro corriendo tronaba la pantalla (TDZ de `blocks` en `persistDraft`; latente desde v7). Pausa persistida al restaurar. Red de seguridad en `renderDay`.
- **v16**: fechas en hora local, ETA incluye bombeada, redondeo de pesos a discos disponibles con saltos configurables, selector de días hasta 7.
- **Post-v16 (sin bump de caché, solo contenido)**: se agregaron 8 rutinas nuevas al catálogo (`rutinas/`) — no requirió bump porque esa carpeta es network-first.
- **v17 (actual, 20 jul 2026)**:
  - **Fix crítico de sugerencia de peso**: `suggested` (peso sugerido por porcentaje del máximo) se apagaba con solo comprobar `!draftSet` (¿existe un objeto de borrador para esa serie?), pero `persistDraft()` siempre guarda un objeto por serie aunque esté vacía. Resultado: apenas se autoguardaba un borrador una vez, dejaba de calcularse la sugerencia de peso para el resto de la sesión (síntoma reportado por Mario: "no me está calculando los pesos"). Ahora solo se apaga si el borrador ya trae un `peso` realmente capturado para esa serie (`draftHasPeso`).
  - **Fix del cronómetro fantasma**: causaba duraciones absurdas (ej. "5684 hrs") porque `sessionStartTime` se restauraba del borrador sin importar cuánto tiempo real hubiera pasado fuera de la app. Ahora el cronómetro se **autopausa** al salir de la pantalla del día (`visibilitychange` + `pagehide`: cambiar de app, apagar pantalla, o el botón "volver"). Se limpia el listener al salir para no duplicarlo entre renders.
  - **Botón "reiniciar cronómetro"** (ícono &#8635; junto a pausa), con `confirm()` nativo antes de poner en cero — para destrabar sesiones ya arruinadas manualmente.
  - **Auto-reanudar en pausa**: si el cronómetro está pausado y tocas cualquier campo de un ejercicio (typear una rep, etc.), se reanuda solo (reusa el hook `onFocus` que ya existía para arrancar el cronómetro la primera vez).
  - **Regla de progresión TUT ajustada**: ahora sube el peso "mitad y mitad" — mínimo 3 lentas + 6 reps totales (antes exigía 6 lentas limpias, 0 normales) — ver sección 9.1.
  - **"+Día extra" en cascada**: ya no es un botón fijo siempre disponible. Cada slot (`extra1`, `extra2`...) completado esta semana se guarda en `weeks/{weekStartISO}` (vía `markComplete` extendido para aceptar campos adicionales, incluye `extraNames` con el nombre de la rutina de cada slot) y se pinta como tarjeta "hecha" en Home; solo se ofrece el siguiente slot para tomar. Tope de 7 días entrenados por semana entre plan base + extras.
  - Archivo saliente (v16) archivado en `otras cosas/previous_versions/v9/` (la numeración de esta carpeta de archivo es independiente del número de versión del caché — sigue v1..v9 secuencial).
  - `CACHE_NAME` bumpeado a `spartrk-v17` en `sw.js`.
  - Archivos a subir a GitHub para este deploy: `js/app.js`, `css/style.css`, `sw.js`.

---

## 12. Gotchas conocidos del entorno de desarrollo

- **Espejo de sandbox desincronizado**: la copia bash del entorno (`/sessions/.../mnt/...`) a veces queda desincronizada/truncada respecto a los archivos reales que ven las herramientas de archivo (que son la verdad en `Downloads/Claude/spartrk/`). Síntoma: `node --check` sobre el espejo falla con "Unexpected end of input" a mitad del archivo, aunque el archivo real esté íntegro. Mitigación: verificar el archivo real primero, probar sintaxis de bloques nuevos aislados en `/tmp` con node, y nunca "reconstruir" el archivo desde el espejo.
- **`ignoreUndefinedProperties`**: sin esta opción de Firestore, un campo `undefined` en cualquier `setDoc` tumba el guardado completo — ya está mitigado en `firebase-init.js`, pero tenerlo presente si se agregan campos nuevos a documentos.
- **TDZ bug (v15, ya resuelto)**: restaurar un borrador con el cronómetro corriendo usaba `blocks` antes de declararlo en `persistDraft` — quedó como referencia de qué tipo de bug buscar si el "día" truena al abrir con timer activo.
- **Fechas en UTC (v16, ya resuelto)**: antes de v16 las fechas de sesión se guardaban en UTC, causando desfase de un día en sesiones nocturnas. Ahora se usa hora local del dispositivo — si se toca lógica de fechas, cuidado con reintroducir este bug.

---

## 13. Para continuar en el proyecto nuevo

- Este archivo + los documentos de "Gym Coach" (The Essentials Program, Ultimate Guide to Body Recomposition de Jeff Nippard, y la rutina de julio de Mario) son el contexto de coaching que justifica las decisiones de diseño de progresión/RPE/tempo.
- El repo real vive en `Downloads/Claude/spartrk/` — hay que reconectar esa carpeta en el proyecto nuevo para poder leer/escribir directo ahí.
- Antes de cualquier cambio de código: releer la Regla de Oro (sección 2) y confirmar diseño con Mario.
- Si se agregan rutinas nuevas al catálogo, seguir el esquema de la sección 8 y actualizar `rutinas/index.json`.
