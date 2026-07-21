import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, getDocs, serverTimestamp, Timestamp
} from "./firebase-init.js";
import {
  EXERCISES, DAYS, EMERGENCIA, DAILY_TASK, EQUIPO_LATERALES, CARDIO_TIPOS,
  estimateMinutes, DAILY_TASK_TIME_MIN, CARDIO_TIME_MIN, ASCENDING_SETS
} from "./exercises-data.js";

const app = document.getElementById("app");
const UNIT_OPTIONS = ["kg", "lb", "Barras"];
const SENS_OPTIONS = ["Normal", "Fácil", "Pesado", "No completé"];
let currentUser = null;
let overrides = {};
let weekProgress = {};
let weekStartISO = "";

// plan de días "en efecto": por defecto es Día 1-4 tal cual (DAYS), y solo cambia
// si el usuario entra a Configurar y guarda algo. Se recalcula cada vez que se
// entra a Home, y renderDay lo reutiliza para saber qué ejercicios tocan.
let currentEffectivePlan = [];
let currentRoutinesMap = {};

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
// fecha en formato YYYY-MM-DD usando la zona horaria LOCAL del dispositivo.
// (antes usaba toISOString, que es UTC y va horas adelante de México: las sesiones
// guardadas en la tarde/noche aparecían en el calendario como del día siguiente).
function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fmtDate(d) { return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }); }
// ejercicios extra que vienen dentro de rutinas importadas del catálogo (no están
// en el catálogo base EXERCISES). Se reconstruye cada vez que se cargan las rutinas.
let extraExercises = {};
function getExercise(id) {
  return EXERCISES[id] || extraExercises[id] || { nombre: id, instrucciones: "", img: null };
}

function imgSrc(exerciseId) {
  const ov = overrides[exerciseId];
  if (ov && ov.img) return ov.img;
  return getExercise(exerciseId).img;
}

async function loadOverrides() {
  overrides = {};
  const snap = await getDocs(collection(db, "users", currentUser.uid, "exerciseOverrides"));
  snap.forEach((d) => { overrides[d.id] = d.data(); });
}

async function loadWeekProgress() {
  const monday = getMonday(new Date());
  weekStartISO = isoDate(monday);
  const ref = doc(db, "users", currentUser.uid, "weeks", weekStartISO);
  const snap = await getDoc(ref);
  weekProgress = snap.exists() ? snap.data() : {};
}

// extraFields (opcional): campos adicionales a fusionar en el mismo doc de la semana,
// como el mapa de nombres de los días extra (ver "cascada" de +Día extra en renderHome).
async function markComplete(dayId, extraFields) {
  const ref = doc(db, "users", currentUser.uid, "weeks", weekStartISO);
  weekProgress[dayId] = true;
  if (extraFields) Object.assign(weekProgress, extraFields);
  await setDoc(ref, weekProgress, { merge: true });
}

async function loadLastData(exerciseIds) {
  const map = {};
  await Promise.all(exerciseIds.map(async (id) => {
    const snap = await getDoc(doc(db, "users", currentUser.uid, "lastExercise", id));
    if (snap.exists()) map[id] = snap.data();
  }));
  return map;
}

// Guarda los datos de cada ejercicio para prefill/sugerencias futuras, y además
// va acumulando un historial corto (últimas 5 sesiones) de la duración real de
// cada ejercicio para afinar el estimado de tiempo en sesiones futuras.
async function saveLastData(exercisesData, durations, lastDataMap) {
  await Promise.all(exercisesData.map(async (ex, i) => {
    const dur = durations ? durations[i] : null;
    const prev = (lastDataMap && lastDataMap[ex.exerciseId]) || {};
    let history = Array.isArray(prev.duraciones) ? prev.duraciones.slice() : [];
    if (dur) { history.push(dur); history = history.slice(-5); }
    const avgDuracionMin = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null;
    await setDoc(doc(db, "users", currentUser.uid, "lastExercise", ex.exerciseId), {
      sets: ex.sets, equipo: ex.equipo || null, unidad: ex.unidad || null, date: serverTimestamp(),
      duraciones: history, avgDuracionMin
    });
  }));
}

// trae las sesiones guardadas (logs) de un mes específico, agrupadas por fecha ISO,
// para pintar los puntitos del calendario en la pantalla principal.
async function loadMonthSessions(year, month) {
  const from = new Date(year, month, 1, 0, 0, 0);
  const to = new Date(year, month + 1, 0, 23, 59, 59);
  const q = query(
    collection(db, "users", currentUser.uid, "logs"),
    where("date", ">=", Timestamp.fromDate(from)),
    where("date", "<=", Timestamp.fromDate(to)),
    orderBy("date", "asc")
  );
  const snap = await getDocs(q);
  const map = {};
  snap.forEach((d) => {
    const data = d.data();
    const dt = data.date && data.date.toDate ? data.date.toDate() : null;
    if (!dt) return;
    const iso = isoDate(dt);
    if (!map[iso]) map[iso] = [];
    map[iso].push({ dayLabel: data.dayLabel, duracionMin: data.duracionMin });
  });
  return map;
}

// --- rutinas guardadas por el usuario (fase C) ---
async function loadRoutines() {
  const map = {};
  const snap = await getDocs(collection(db, "users", currentUser.uid, "routines"));
  snap.forEach((d) => { map[d.id] = d.data(); });
  extraExercises = {};
  Object.values(map).forEach((r) => { if (r.customExercises) Object.assign(extraExercises, r.customExercises); });
  return map;
}

// convierte una rutina guardada en la lista de ejercicios con sus series:
// las importadas del catálogo traen su propio esquema (items con sets propios),
// las creadas a mano usan las 4 series ascendentes clásicas.
function routineToExercises(r) {
  if (Array.isArray(r.items) && r.items.length) {
    return r.items.map((it) => ({ id: it.id, sets: Array.isArray(it.sets) && it.sets.length ? it.sets : ASCENDING_SETS }));
  }
  return (r.exerciseIds || []).map((eid) => ({ id: eid, sets: ASCENDING_SETS }));
}
function routineExerciseCount(r) {
  return Array.isArray(r.items) && r.items.length ? r.items.length : (r.exerciseIds || []).length;
}

// catálogo de rutinas del coach: carpeta rutinas/ en el mismo repo de GitHub Pages.
// index.json lista los archivos; cada uno es una rutina con items y customExercises.
// Se lee siempre fresco de la red (el service worker no lo cachea con cache-first).
async function fetchCatalogRoutines() {
  try {
    const res = await fetch("rutinas/index.json", { cache: "no-store" });
    if (!res.ok) return [];
    const idx = await res.json();
    const files = Array.isArray(idx.rutinas) ? idx.rutinas : [];
    const loaded = await Promise.all(files.map(async (f) => {
      try {
        const r = await fetch("rutinas/" + f, { cache: "no-store" });
        return r.ok ? await r.json() : null;
      } catch (e) { return null; }
    }));
    return loaded.filter((r) => r && r.id && r.nombre && Array.isArray(r.items) && r.items.length);
  } catch (e) { return []; }
}

async function saveRoutine(routineId, data) {
  const ref = routineId
    ? doc(db, "users", currentUser.uid, "routines", routineId)
    : doc(collection(db, "users", currentUser.uid, "routines"));
  await setDoc(ref, data);
  return ref.id;
}

async function deleteRoutineDoc(routineId) {
  await deleteDoc(doc(db, "users", currentUser.uid, "routines", routineId));
}

// --- plan semanal configurable (fase C) ---
// si no existe o enabled es false, el comportamiento es 100% el clásico Día 1-4.
async function loadWeekPlan() {
  const ref = doc(db, "users", currentUser.uid, "settings", "weekPlan");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function saveWeekPlan(plan) {
  await setDoc(doc(db, "users", currentUser.uid, "settings", "weekPlan"), plan);
}

async function resetWeekPlan(existingPlan) {
  const base = existingPlan || {};
  await setDoc(doc(db, "users", currentUser.uid, "settings", "weekPlan"), { ...base, enabled: false });
}

// --- método de progresión de peso (configurable por usuario) ---
// "tut" (tiempo bajo tensión) es el modo por defecto: solo cuentan las reps lentas.
const PROGRESSION_MODES = {
  total: {
    label: "Reps totales",
    desc: "Cuentan todas las reps sin importar la velocidad. Al lograr 6 reps en la serie efectiva, el peso sugerido sube ~5%. Si no completas 4, baja ~5%."
  },
  tut: {
    label: "Tiempo bajo tensión",
    desc: "Solo cuentan las reps lentas y controladas (ej. 3 seg bajando, 2 subiendo). Al lograr 6 lentas limpias en la serie efectiva, el peso sugerido sube ~5%. Si no completas 4 reps, baja ~5%."
  },
  sensacion: {
    label: "Sensación de dificultad",
    desc: "Tú decides: si marcas la serie efectiva como \"Fácil\", el peso sugerido sube ~5%. Si marcas \"No completé\", baja ~5%."
  }
};
let progressionMode = "tut";

async function loadProgressionMode() {
  const snap = await getDoc(doc(db, "users", currentUser.uid, "settings", "progression"));
  progressionMode = (snap.exists() && PROGRESSION_MODES[snap.data().mode]) ? snap.data().mode : "tut";
  return progressionMode;
}

async function saveProgressionMode(mode) {
  progressionMode = mode;
  await setDoc(doc(db, "users", currentUser.uid, "settings", "progression"), { mode });
}

// --- saltos de peso disponibles en el gym del usuario (para redondear sugerencias) ---
const DEFAULT_INCREMENTS = { kg: 2.5, lb: 5, Barras: 1 };
let weightIncrements = { ...DEFAULT_INCREMENTS };

async function loadWeightIncrements() {
  const snap = await getDoc(doc(db, "users", currentUser.uid, "settings", "increments"));
  weightIncrements = { ...DEFAULT_INCREMENTS, ...(snap.exists() ? snap.data() : {}) };
  return weightIncrements;
}

async function saveWeightIncrements(inc) {
  weightIncrements = { ...DEFAULT_INCREMENTS, ...inc };
  await setDoc(doc(db, "users", currentUser.uid, "settings", "increments"), weightIncrements);
}

// redondea un peso al múltiplo más cercano del salto disponible para esa unidad
// (nunca debajo de un salto). Ej: 15.75 lb con salto de 5 -> 15 lb.
function roundToIncrement(value, unit) {
  const inc = parseFloat(weightIncrements[unit]) || 1;
  const rounded = Math.round(value / inc) * inc;
  return Math.max(inc, Math.round(rounded * 100) / 100);
}
function oneDec(x) { return Math.round(x * 10) / 10; }

// resuelve el plan "en efecto" a partir del weekPlan guardado (si está activo) o
// del clásico DAYS (si no hay configuración o está desactivada).
function resolveEffectivePlan(weekPlan, routinesMap) {
  if (!weekPlan || !weekPlan.enabled) {
    return Object.values(DAYS).map((d) => ({ id: d.id, nombre: d.nombre, exercises: d.exercises }));
  }
  const n = weekPlan.diasPerWeek || 4;
  const slots = [];
  for (let i = 1; i <= n; i++) {
    const key = "dia" + i;
    const assign = (weekPlan.days && weekPlan.days[key]) || ("classic:" + key);
    if (assign.indexOf("classic:") === 0) {
      const classicKey = assign.slice(8);
      if (DAYS[classicKey]) slots.push({ id: key, nombre: DAYS[classicKey].nombre, exercises: DAYS[classicKey].exercises });
    } else {
      const r = routinesMap[assign];
      if (r) slots.push({ id: key, nombre: r.nombre, exercises: routineToExercises(r) });
    }
  }
  return slots;
}

function clearApp() { app.innerHTML = ""; }

function renderTabbar(active) {
  const bar = document.createElement("div");
  bar.className = "tabbar";
  bar.innerHTML = `
    <button data-tab="home" class="${active === "home" ? "active" : ""}">Semana</button>
    <button data-tab="export" class="${active === "export" ? "active" : ""}">Exportar</button>
  `;
  bar.querySelector('[data-tab="home"]').onclick = renderHome;
  bar.querySelector('[data-tab="export"]').onclick = renderExport;
  return bar;
}

async function renderLogin() {
  clearApp();
  const wrap = document.createElement("div");
  wrap.className = "login-wrap";
  wrap.innerHTML = `
    <img src="icons/icon-192.png" alt="SparTrk">
    <h2 style="color:#f5e6d3;">SparTrk</h2>
    <input type="email" id="login-email" placeholder="correo@ejemplo.com">
    <input type="password" id="login-pass" placeholder="Contraseña">
    <button class="primary-btn" id="btn-login">Entrar</button>
    <button class="secondary-btn" id="btn-signup">Crear cuenta</button>
    <button class="secondary-btn" id="btn-google">Entrar con Google</button>
    <p class="error-msg" id="login-error"></p>
  `;
  app.appendChild(wrap);
  const errEl = wrap.querySelector("#login-error");
  wrap.querySelector("#btn-login").onclick = async () => {
    try {
      await signInWithEmailAndPassword(auth, wrap.querySelector("#login-email").value, wrap.querySelector("#login-pass").value);
    } catch (e) { errEl.textContent = "No se pudo entrar. Revisa tu correo y contraseña."; }
  };
  wrap.querySelector("#btn-signup").onclick = async () => {
    try {
      await createUserWithEmailAndPassword(auth, wrap.querySelector("#login-email").value, wrap.querySelector("#login-pass").value);
    } catch (e) { errEl.textContent = "No se pudo crear la cuenta."; }
  };
  wrap.querySelector("#btn-google").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { errEl.textContent = "No se pudo entrar con Google."; }
  };
}

async function renderHome() {
  clearApp();
  await loadWeekProgress();
  const [weekPlan, routinesMap] = await Promise.all([loadWeekPlan(), loadRoutines()]);
  currentRoutinesMap = routinesMap;
  currentEffectivePlan = resolveEffectivePlan(weekPlan, routinesMap);

  const monday = getMonday(new Date());
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <img src="icons/icon-192.png" alt="">
      <div>
        <div class="title">SparTrk</div>
        <div class="subtitle">${fmtDate(monday)} - ${fmtDate(sunday)}</div>
      </div>
    </div>
    <button class="gear-btn" id="gear-btn" type="button" title="Configurar rutinas">&#9881;</button>
  `;
  app.appendChild(top);
  top.querySelector("#gear-btn").onclick = () => renderConfig();

  const grid = document.createElement("div");
  grid.className = "day-grid";
  currentEffectivePlan.forEach((day) => {
    const done = !!weekProgress[day.id];
    const card = document.createElement("div");
    card.className = "day-card" + (done ? " done" : "");
    card.innerHTML = `
      <div class="row"><span>${day.id.replace("dia", "Día ")}</span>${done ? '<span class="check">&#10003;</span>' : '<span>pendiente</span>'}</div>
      <div class="name">${day.nombre}</div>
    `;
    card.onclick = () => renderDay(day.id);
    grid.appendChild(card);
  });
  app.appendChild(grid);

  const emCard = document.createElement("div");
  emCard.className = "card emergency-card";
  emCard.innerHTML = `<p>No llego al gym hoy - entrenamiento de emergencia</p>`;
  emCard.onclick = () => renderDay("emergencia");
  app.appendChild(emCard);

  // Cascada de días extra: no hay un solo botón fijo. Cada "extra1", "extra2"... que ya
  // se completó esta semana (guardado en weeks/{weekStartISO}) se pinta como tarjeta
  // hecha, y solo se ofrece el SIGUIENTE slot para tomar — nunca los de más adelante.
  // Tope: entre el plan base y los extras no se pasa de 7 días entrenados en la semana.
  const MAX_DAYS_PER_WEEK = 7;
  const basePlanCount = currentEffectivePlan.length;
  const extraNames = weekProgress.extraNames || {};
  let extraSlot = 1;
  while (weekProgress["extra" + extraSlot]) {
    const doneCard = document.createElement("div");
    doneCard.className = "card extra-day-card done";
    doneCard.innerHTML = `<p>Día extra ${extraSlot} &#10003;</p><div class="sub">${extraNames["extra" + extraSlot] || "Completado"}</div>`;
    app.appendChild(doneCard);
    extraSlot++;
  }
  if (basePlanCount + (extraSlot - 1) < MAX_DAYS_PER_WEEK) {
    const extraCard = document.createElement("div");
    extraCard.className = "card extra-day-card";
    extraCard.innerHTML = `<p>+ Día extra${extraSlot > 1 ? " " + extraSlot : ""}</p><div class="sub">¿Le metes un día más? Elige una rutina guardada.</div>`;
    extraCard.onclick = () => openExtraDaySheet(routinesMap, extraSlot);
    app.appendChild(extraCard);
  } else {
    const capCard = document.createElement("div");
    capCard.className = "card extra-day-card done";
    capCard.innerHTML = `<p>Semana completa &#127881;</p><div class="sub">Ya entrenaste los 7 días posibles esta semana.</div>`;
    app.appendChild(capCard);
  }

  app.appendChild(buildCalendarSection());

  app.appendChild(renderTabbar("home"));
}

// hoja para elegir una rutina guardada y arrancar un "día extra" suelto, sin que
// afecte tu plan semanal ni marque ningún Día 1-N como completado.
function openExtraDaySheet(routinesMap, slotNumber) {
  const ids = Object.keys(routinesMap);
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  if (ids.length === 0) {
    overlay.innerHTML = `
      <div class="sheet">
        <h3>Aún no tienes rutinas guardadas</h3>
        <p style="font-size:12px; color:#d9968a; margin-bottom:12px;">Crea una en Configurar (&#9881;) y podrás usarla aquí para un día extra.</p>
        <button class="secondary-btn" id="closeSheet">Cerrar</button>
      </div>`;
  } else {
    overlay.innerHTML = `
      <div class="sheet">
        <h3>Elige una rutina para hoy</h3>
        ${ids.map((id) => `<div class="routine-pick" data-id="${id}"><div class="name">${routinesMap[id].nombre}</div><div class="count">${routineExerciseCount(routinesMap[id])} ejercicios</div></div>`).join("")}
        <button class="secondary-btn" id="closeSheet">Cancelar</button>
      </div>`;
  }
  document.body.appendChild(overlay);
  overlay.querySelector("#closeSheet").onclick = () => overlay.remove();
  overlay.querySelectorAll(".routine-pick").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      const r = routinesMap[id];
      overlay.remove();
      const exList = routineToExercises(r);
      const extraDayId = "extra_" + id + "_" + isoDate(new Date());
      renderDay(extraDayId, { exList, label: "Día extra - " + r.nombre, slotKey: "extra" + slotNumber, slotLabel: r.nombre });
    };
  });
}

// calendario de la pantalla principal: complementa la grid de días (no la reemplaza).
// muestra un puntito amarillo en los días con sesión guardada; al tocar un día
// muestra qué rutina se hizo y cuánto duró.
function buildCalendarSection() {
  const wrap = document.createElement("div");

  const title = document.createElement("div");
  title.className = "section-title";
  title.textContent = "Calendario";
  wrap.appendChild(title);

  const card = document.createElement("div");
  card.className = "cal-card";
  wrap.appendChild(card);

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  const todayISO = isoDate(now);
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const dowLabels = ["D", "L", "M", "M", "J", "V", "S"];

  function showPopup(iso, entries) {
    const popup = card.querySelector("#cal-popup");
    if (!popup) return;
    const [y, m, d] = iso.split("-");
    popup.innerHTML = entries.map((e) =>
      `<div class="d">${d}/${m}/${y}</div><div>${e.dayLabel}${e.duracionMin ? " — " + e.duracionMin + " min" : ""}</div>`
    ).join('<hr style="border-color:#2a0f0f; margin:6px 0;">');
    popup.classList.add("show");
  }

  async function render() {
    card.innerHTML = `
      <div class="cal-header">
        <button class="cal-nav" id="cal-prev" type="button">&#8249;</button>
        <span class="month">${monthNames[viewMonth]} ${viewYear}</span>
        <button class="cal-nav" id="cal-next" type="button">&#8250;</button>
      </div>
      <div class="cal-grid" id="cal-grid"></div>
      <div class="cal-popup" id="cal-popup"></div>
    `;
    card.querySelector("#cal-prev").onclick = () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); };
    card.querySelector("#cal-next").onclick = () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); };

    const grid = card.querySelector("#cal-grid");
    dowLabels.forEach((d) => {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = d;
      grid.appendChild(el);
    });

    const sessions = await loadMonthSessions(viewYear, viewMonth);

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) {
      const e = document.createElement("div");
      e.className = "cal-day empty";
      grid.appendChild(e);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const el = document.createElement("div");
      el.className = "cal-day" + (iso === todayISO ? " today" : "");
      el.textContent = d;
      if (sessions[iso]) {
        const dot = document.createElement("div");
        dot.className = "dot";
        el.appendChild(dot);
        el.onclick = () => showPopup(iso, sessions[iso]);
      }
      grid.appendChild(el);
    }
  }

  render();
  return wrap;
}

// --- pantalla de configuración de rutinas (fase C) ---
async function renderConfig() {
  clearApp();
  const [weekPlan, routinesMap] = await Promise.all([loadWeekPlan(), loadRoutines(), loadProgressionMode(), loadWeightIncrements()]);
  currentRoutinesMap = routinesMap;

  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `
    <button class="ghost-btn" id="back-btn">&#8592; volver</button>
    <div class="title">Configurar rutinas</div>
    <span></span>
  `;
  app.appendChild(top);
  top.querySelector("#back-btn").onclick = renderHome;

  const note = document.createElement("p");
  note.style.cssText = "font-size:11px; color:#6a6a6a; margin-bottom:14px; line-height:1.5;";
  note.textContent = "Esto solo se activa cuando guardas un cambio aquí. Si no tocas nada, tu semana sigue siendo Día 1-4 tal cual.";
  app.appendChild(note);

  // --- método de progresión de peso ---
  const fieldLabelProg = document.createElement("div");
  fieldLabelProg.className = "field-label";
  fieldLabelProg.textContent = "Método de progresión de peso";
  app.appendChild(fieldLabelProg);

  const progSelect = document.createElement("select");
  progSelect.style.cssText = "width:100%; margin-bottom:6px;";
  Object.entries(PROGRESSION_MODES).forEach(([key, m]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = m.label;
    if (key === progressionMode) opt.selected = true;
    progSelect.appendChild(opt);
  });
  app.appendChild(progSelect);

  const progDesc = document.createElement("p");
  progDesc.style.cssText = "font-size:11px; color:#8a8a8a; margin-bottom:4px; line-height:1.5;";
  progDesc.textContent = PROGRESSION_MODES[progressionMode].desc;
  app.appendChild(progDesc);

  const progSaved = document.createElement("p");
  progSaved.style.cssText = "font-size:10px; color:#8fd18f; margin-bottom:14px; display:none;";
  progSaved.textContent = "Guardado ✓";
  app.appendChild(progSaved);

  progSelect.addEventListener("change", async () => {
    progDesc.textContent = PROGRESSION_MODES[progSelect.value].desc;
    await saveProgressionMode(progSelect.value);
    progSaved.style.display = "block";
    setTimeout(() => { progSaved.style.display = "none"; }, 2000);
  });

  // --- saltos de peso del gym (para redondear las sugerencias a discos reales) ---
  const fieldLabelInc = document.createElement("div");
  fieldLabelInc.className = "field-label";
  fieldLabelInc.textContent = "Saltos de peso en tu gym";
  app.appendChild(fieldLabelInc);

  const incNote = document.createElement("p");
  incNote.style.cssText = "font-size:11px; color:#6a6a6a; margin-bottom:6px; line-height:1.5;";
  incNote.textContent = "De cuánto en cuánto van los pesos disponibles. Las sugerencias se redondean a estos saltos.";
  app.appendChild(incNote);

  const incRow = document.createElement("div");
  incRow.className = "set-input-row";
  incRow.innerHTML = ["kg", "lb", "Barras"].map((u) => `
    <div style="flex:1;">
      <div style="font-size:10px; color:#8a8a8a; margin-bottom:3px;">${u}</div>
      <input type="number" step="any" min="0.5" data-inc="${u}" value="${weightIncrements[u]}" style="width:100%;">
    </div>
  `).join("");
  app.appendChild(incRow);

  const incSaved = document.createElement("p");
  incSaved.style.cssText = "font-size:10px; color:#8fd18f; margin:4px 0 14px; display:none;";
  incSaved.textContent = "Guardado ✓";
  app.appendChild(incSaved);

  incRow.querySelectorAll("input").forEach((el) => {
    el.addEventListener("change", async () => {
      const inc = {};
      incRow.querySelectorAll("input").forEach((i) => {
        const v = parseFloat(i.value);
        if (v > 0) inc[i.dataset.inc] = v;
      });
      await saveWeightIncrements(inc);
      incSaved.style.display = "block";
      setTimeout(() => { incSaved.style.display = "none"; }, 2000);
    });
  });

  const fieldLabel1 = document.createElement("div");
  fieldLabel1.className = "field-label";
  fieldLabel1.textContent = "Tus rutinas guardadas";
  app.appendChild(fieldLabel1);

  const routineList = document.createElement("div");
  app.appendChild(routineList);
  const routineIds = Object.keys(routinesMap);
  if (routineIds.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "font-size:11px; color:#6a6a6a; margin-bottom:10px;";
    empty.textContent = "Aún no tienes ninguna.";
    routineList.appendChild(empty);
  } else {
    routineIds.forEach((id) => {
      const r = routinesMap[id];
      const row = document.createElement("div");
      row.className = "routine-row";
      const isCatalog = Array.isArray(r.items) && r.items.length;
      row.innerHTML = `<div><div class="name">${r.nombre}</div><div class="count">${routineExerciseCount(r)} ejercicios${isCatalog ? " · del catálogo" : ""}</div></div><button class="edit" type="button">${isCatalog ? "quitar" : "editar"}</button>`;
      row.querySelector(".edit").onclick = async () => {
        if (isCatalog) { await deleteRoutineDoc(id); renderConfig(); }
        else renderRoutineEditor(id);
      };
      routineList.appendChild(row);
    });
  }

  const addBtn = document.createElement("button");
  addBtn.className = "add-routine-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ Nueva rutina";
  addBtn.onclick = () => renderRoutineEditor(null);
  app.appendChild(addBtn);

  // --- rutinas del catálogo (carpeta rutinas/ en el repo de GitHub) ---
  const fieldLabelCat = document.createElement("div");
  fieldLabelCat.className = "field-label";
  fieldLabelCat.textContent = "Rutinas del catálogo";
  app.appendChild(fieldLabelCat);

  const catWrap = document.createElement("div");
  catWrap.innerHTML = `<p style="font-size:11px; color:#6a6a6a; margin-bottom:10px;">Cargando catálogo...</p>`;
  app.appendChild(catWrap);

  fetchCatalogRoutines().then((catalog) => {
    catWrap.innerHTML = "";
    if (!catalog.length) {
      catWrap.innerHTML = `<p style="font-size:11px; color:#6a6a6a; margin-bottom:10px;">No hay rutinas en el catálogo (o no hay conexión).</p>`;
      return;
    }
    const importedIds = new Set(Object.values(routinesMap).map((r) => r.catalogId).filter(Boolean));
    catalog.forEach((c) => {
      const row = document.createElement("div");
      row.className = "routine-row";
      const done = importedIds.has(c.id);
      row.innerHTML = `<div><div class="name">${c.nombre}</div><div class="count">${c.items.length} ejercicios${c.descripcion ? " — " + c.descripcion : ""}</div></div><button class="edit" type="button"${done ? " disabled" : ""}>${done ? "importada ✓" : "importar"}</button>`;
      const btn = row.querySelector(".edit");
      if (!done) {
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = "importando...";
          await saveRoutine(null, { nombre: c.nombre, catalogId: c.id, items: c.items, customExercises: c.customExercises || {} });
          renderConfig();
        };
      }
      catWrap.appendChild(row);
    });
  });

  const fieldLabel2 = document.createElement("div");
  fieldLabel2.className = "field-label";
  fieldLabel2.textContent = "Días de entrenamiento por semana";
  app.appendChild(fieldLabel2);

  const currentDias = (weekPlan && weekPlan.enabled && weekPlan.diasPerWeek) || 4;
  const diasSelect = document.createElement("select");
  diasSelect.style.cssText = "width:100%; margin-bottom:14px;";
  [3, 4, 5, 6, 7].forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n; opt.textContent = n;
    if (n === currentDias) opt.selected = true;
    diasSelect.appendChild(opt);
  });
  app.appendChild(diasSelect);

  const fieldLabel3 = document.createElement("div");
  fieldLabel3.className = "field-label";
  fieldLabel3.textContent = "Qué rutina va en cada día";
  app.appendChild(fieldLabel3);

  const slotsWrap = document.createElement("div");
  app.appendChild(slotsWrap);

  function classicOptionsHTML(selectedValue) {
    return [1, 2, 3, 4].map((i) => {
      const key = "dia" + i;
      const value = "classic:" + key;
      const label = DAYS[key] ? DAYS[key].nombre + " (clásico)" : key;
      return `<option value="${value}"${value === selectedValue ? " selected" : ""}>${label}</option>`;
    }).join("");
  }
  function routineOptionsHTML(selectedValue) {
    return routineIds.map((id) => `<option value="${id}"${id === selectedValue ? " selected" : ""}>${routinesMap[id].nombre}</option>`).join("");
  }

  function renderSlots() {
    const n = parseInt(diasSelect.value) || 4;
    slotsWrap.innerHTML = "";
    for (let i = 1; i <= n; i++) {
      const key = "dia" + i;
      const existing = weekPlan && weekPlan.days && weekPlan.days[key];
      const defaultValue = existing || (DAYS[key] ? "classic:" + key : (routineIds[0] || "classic:dia1"));
      const row = document.createElement("div");
      row.className = "day-slot-row";
      row.innerHTML = `<span class="lbl">Día ${i}</span><select data-slot="${key}">${classicOptionsHTML(defaultValue)}${routineOptionsHTML(defaultValue)}</select>`;
      slotsWrap.appendChild(row);
    }
  }
  renderSlots();
  diasSelect.addEventListener("change", renderSlots);

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary-btn";
  saveBtn.style.marginTop = "10px";
  saveBtn.type = "button";
  saveBtn.textContent = "Guardar configuración";
  saveBtn.onclick = async () => {
    const n = parseInt(diasSelect.value) || 4;
    const days = {};
    slotsWrap.querySelectorAll("select[data-slot]").forEach((sel) => { days[sel.dataset.slot] = sel.value; });
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";
    await saveWeekPlan({ enabled: true, diasPerWeek: n, days });
    renderHome();
  };
  app.appendChild(saveBtn);

  const resetLink = document.createElement("span");
  resetLink.className = "reset-link";
  resetLink.textContent = "Usar los días clásicos (Día 1–4 por defecto)";
  resetLink.onclick = async () => {
    await resetWeekPlan(weekPlan);
    renderHome();
  };
  app.appendChild(resetLink);
}

// --- editor de una rutina: nombre + qué ejercicios lleva (series siempre las 4 ascendentes) ---
function renderRoutineEditor(routineId) {
  clearApp();
  const existing = routineId ? currentRoutinesMap[routineId] : null;

  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `
    <button class="ghost-btn" id="back-btn">&#8592; volver</button>
    <div class="title">${existing ? "Editar rutina" : "Nueva rutina"}</div>
    <span></span>
  `;
  app.appendChild(top);
  top.querySelector("#back-btn").onclick = () => renderConfig();

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Nombre de la rutina";
  nameInput.style.cssText = "width:100%; margin-bottom:14px;";
  nameInput.value = existing ? existing.nombre : "";
  app.appendChild(nameInput);

  const label = document.createElement("div");
  label.className = "field-label";
  label.textContent = "Elige los ejercicios (series: siempre las 4 ascendentes de siempre)";
  app.appendChild(label);

  const checklist = document.createElement("div");
  checklist.className = "checklist";
  app.appendChild(checklist);

  const selectedIds = new Set(existing ? existing.exerciseIds : []);
  Object.entries(EXERCISES).forEach(([id, ex]) => {
    if (id === "warmup_stretch") return; // solo para emergencia
    const row = document.createElement("label");
    row.className = "chk-row";
    row.innerHTML = `<input type="checkbox" data-id="${id}" ${selectedIds.has(id) ? "checked" : ""}><span>${ex.nombre}</span>`;
    checklist.appendChild(row);
  });

  const errEl = document.createElement("p");
  errEl.className = "error-msg";
  errEl.style.display = "none";
  app.appendChild(errEl);

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary-btn";
  saveBtn.type = "button";
  saveBtn.textContent = "Guardar rutina";
  saveBtn.onclick = async () => {
    const nombre = nameInput.value.trim();
    const exerciseIds = [...checklist.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.dataset.id);
    if (!nombre || exerciseIds.length === 0) {
      errEl.textContent = "Ponle un nombre y elige al menos un ejercicio.";
      errEl.style.display = "block";
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";
    await saveRoutine(routineId, { nombre, exerciseIds });
    renderConfig();
  };
  app.appendChild(saveBtn);

  if (existing) {
    const deleteLink = document.createElement("span");
    deleteLink.className = "delete-link";
    deleteLink.textContent = "Eliminar esta rutina";
    deleteLink.onclick = async () => {
      await deleteRoutineDoc(routineId);
      renderConfig();
    };
    app.appendChild(deleteLink);
  }
}

function buildExerciseBlock(exerciseId, sets, dayLabel, opts = {}) {
  const ex = getExercise(exerciseId);
  const lastData = opts.lastData;
  const draft = opts.draft;
  const onChange = opts.onChange || (() => {});

  const block = document.createElement("div");
  block.className = "exercise-block";
  block.innerHTML = `
    <div class="collapsed-summary">
      <span class="txt"><span class="chk">&#10003;</span>&nbsp; ${ex.nombre}${opts.nameSuffix || ""}</span>
      <span class="reopen">reabrir</span>
    </div>
    <div class="exercise-header">${dayLabel}</div>
    <div class="exercise-name">${ex.nombre}</div>
    <button class="toggle-btn" type="button">Ver cómo se hace &#9662;</button>
    <div class="toggle-content" style="display:none;">
      <div class="exercise-anim">
        <img src="${imgSrc(exerciseId) || "icons/icon-192.png"}" data-which="img">
        <button class="change-photo-btn" data-which="img">cambiar foto</button>
      </div>
      <p class="instructions">${ex.instrucciones}</p>
    </div>
  `;

  const collapsedSummary = block.querySelector(".collapsed-summary");
  collapsedSummary.onclick = () => block.classList.remove("collapsed");

  const toggleBtn = block.querySelector(".toggle-btn");
  const toggleContent = block.querySelector(".toggle-content");
  toggleBtn.onclick = () => {
    const open = toggleContent.style.display !== "none";
    toggleContent.style.display = open ? "none" : "block";
    toggleBtn.innerHTML = open ? "Ver cómo se hace &#9662;" : "Ocultar &#9652;";
  };

  block.querySelectorAll(".change-photo-btn").forEach((btn) => {
    btn.onclick = () => {
      const which = btn.dataset.which;
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*"; input.capture = "environment";
      input.onchange = () => handlePhotoChange(exerciseId, which, input.files[0], block);
      input.click();
    };
  });

  // --- fase A: progreso por serie + punto "en curso" + duración real del ejercicio ---
  const totalMinutes = opts.totalMinutesOverride != null ? opts.totalMinutesOverride : estimateMinutes(sets);
  const realSetCount = sets.filter((s) => !s.noInput).length;
  const perSetMin = realSetCount > 0 ? totalMinutes / realSetCount : 0;
  const setFilled = sets.map(() => false);
  let exerciseStartedAt = null;
  let exerciseDurationMin = null;

  function spendSet(i) {
    if (setFilled[i]) return;
    setFilled[i] = true;
    if (opts.onSetProgress) opts.onSetProgress(perSetMin);
  }

  if (opts.onFocus) {
    block.addEventListener("focusin", () => {
      if (!block.dataset.wasDone) opts.onFocus();
    });
  }

  const initialUnit = (draft && draft.unidad) || (lastData && lastData.unidad) || "kg";
  const unitRow = document.createElement("div");
  unitRow.style.cssText = "margin: 10px 0 8px;";
  unitRow.innerHTML = `
    <select data-field="unidad" style="font-size:11px; padding:5px 8px;">
      ${UNIT_OPTIONS.map((u) => `<option${u === initialUnit ? " selected" : ""}>${u}</option>`).join("")}
    </select>
  `;
  block.appendChild(unitRow);
  const unitSelect = unitRow.querySelector('[data-field="unidad"]');

  // Regla de progresión según el método elegido en Configuración:
  // - "tut" (tiempo bajo tensión): sube 5% con 6 reps totales en la serie efectiva,
  //   siempre que al menos la mitad hayan sido lentas (con tempo controlado) — "mitad y
  //   mitad": 3 lentas + 3 rápidas también cuenta, no hace falta que las 6 sean lentas.
  //   Decisión de Mario del 20 jul 2026, ajustada el mismo día (primero se probó con
  //   mínimo 5 lentas, luego se relajó a 3 — mitad y mitad).
  // - "total" (reps totales): cuentan todas las reps; sube 5% al llegar a 6.
  // - "sensacion": sube 5% si marcó "Fácil", baja 5% si "No completé".
  // En "tut" y "total" también baja 5% si no completó o sacó menos de 4 reps.
  const REPS_META_LENTAS = 6;
  const REPS_LENTAS_MIN_PARA_SUBIR = 3; // mínimo de lentas exigidas (mitad y mitad); el resto puede ser normal
  const REPS_MIN_EFECTIVA = 4;
  const isTUT = progressionMode === "tut";
  const idx100 = sets.findIndex((s) => s.pct === 100);
  let currentMax = null;
  let currentMaxExact = null;
  let progressMsg = null;
  if (idx100 !== -1 && lastData && lastData.sets && lastData.sets[idx100] && lastData.sets[idx100].peso) {
    const refSet = lastData.sets[idx100];
    const base = parseFloat(refSet.peso);
    const lentas = parseInt(refSet.repsLentas) || 0;
    const normales = parseInt(refSet.repsNormales) || 0;
    const total = lentas + normales;
    let factor = 1;
    if (progressionMode === "sensacion") {
      if (refSet.sensacion === "No completé") {
        factor = 0.95;
        progressMsg = "La vez pasada no completaste: bajamos ~5% el peso sugerido.";
      } else if (refSet.sensacion === "Fácil") {
        factor = 1.05;
        progressMsg = "La vez pasada se sintió fácil: hoy el peso sugerido sube ~5%.";
      }
    } else if (progressionMode === "total") {
      if (refSet.sensacion === "No completé" || (total > 0 && total < REPS_MIN_EFECTIVA)) {
        factor = 0.95;
        progressMsg = "Bajamos ~5% para consolidar. Meta: " + REPS_MIN_EFECTIVA + "-" + REPS_META_LENTAS + " reps.";
      } else if (total >= REPS_META_LENTAS) {
        factor = 1.05;
        progressMsg = "¡Lograste " + total + " reps! Hoy sube el peso: meta " + REPS_MIN_EFECTIVA + "-" + REPS_META_LENTAS + " reps con el nuevo peso.";
      } else if (total > 0) {
        progressMsg = "Anterior: " + total + "/" + REPS_META_LENTAS + " reps — te falta" + (REPS_META_LENTAS - total === 1 ? "" : "n") + " " + (REPS_META_LENTAS - total) + " para subir de peso. Mismo peso hoy.";
      }
    } else {
      if (refSet.sensacion === "No completé" || (total > 0 && total < REPS_MIN_EFECTIVA)) {
        factor = 0.95;
        progressMsg = "Bajamos ~5% para consolidar. Meta: " + REPS_MIN_EFECTIVA + "-" + REPS_META_LENTAS + " lentas limpias.";
      } else if (lentas >= REPS_LENTAS_MIN_PARA_SUBIR && total >= REPS_META_LENTAS) {
        factor = 1.05;
        progressMsg = normales > 0
          ? "¡Lograste " + lentas + " lentas + " + normales + " al filo del fallo! Hoy sube el peso: meta " + REPS_META_LENTAS + " reps (mínimo " + REPS_LENTAS_MIN_PARA_SUBIR + " lentas) con el nuevo peso."
          : "¡Lograste " + lentas + " lentas limpias! Hoy sube el peso: meta " + REPS_META_LENTAS + " reps con el nuevo peso.";
      } else if (total > 0) {
        progressMsg = "Anterior: " + lentas + " lentas + " + normales + " (" + total + "/" + REPS_META_LENTAS + "). Para subir necesitas " + REPS_META_LENTAS + " reps totales con mínimo " + REPS_LENTAS_MIN_PARA_SUBIR + " lentas. Mismo peso hoy.";
      }
    }
    // redondear la sugerencia a los saltos de peso que sí existen en el gym
    const incUnit = parseFloat(weightIncrements[initialUnit]) || 1;
    currentMaxExact = oneDec(base * factor);
    currentMax = roundToIncrement(base * factor, initialUnit);
    if (factor > 1 && currentMax <= base) {
      // ganó la subida, pero el 5% no alcanza el siguiente disco disponible
      currentMax = base;
      progressMsg = "¡Ganaste la subida! Pero " + currentMaxExact + " " + initialUnit + " no existe con tus discos: quédate en " + oneDec(base) + " y saca más reps, o brinca a " + oneDec(base + incUnit) + " si te sientes con fuerza.";
    } else if (factor < 1 && currentMax >= base) {
      // tocaba bajar, pero el redondeo lo regresó al mismo peso: bajar un disco completo
      currentMax = Math.max(incUnit, oneDec(base - incUnit));
    }
  }

  if (progressMsg) {
    const progressHint = document.createElement("p");
    progressHint.className = "progress-hint";
    progressHint.textContent = progressMsg;
    block.appendChild(progressHint);
  }

  const suggestHint = document.createElement("p");
  suggestHint.className = "suggest-hint";
  block.appendChild(suggestHint);
  function updateHint() {
    if (currentMax != null) {
      suggestHint.style.display = "block";
      let txt = `Pesos sugeridos según tu máximo estimado: ${currentMax} ${unitSelect.value}`;
      if (currentMaxExact != null && Math.abs(currentMaxExact - currentMax) >= 0.05) {
        txt += ` (objetivo exacto: ${currentMaxExact})`;
      }
      suggestHint.textContent = txt;
    } else {
      suggestHint.style.display = "none";
    }
  }
  updateHint();
  unitSelect.addEventListener("change", () => { updateHint(); onChange(); });

  const setsWrap = document.createElement("div");
  block.appendChild(setsWrap);

  const inputs = [];
  const touched = sets.map(() => false);

  sets.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "set-row" + (s.pct === 100 ? " effective" : "");
    row.innerHTML = `<span>${s.label}</span>`;
    setsWrap.appendChild(row);

    if (s.noInput) { inputs.push(null); return; }

    const prevSet = lastData && lastData.sets && lastData.sets[i];
    const draftSet = draft && draft.sets && draft.sets[i];

    if (prevSet && (prevSet.peso || prevSet.repsLentas || prevSet.repsNormales)) {
      const totalPrev = (parseInt(prevSet.repsLentas) || 0) + (parseInt(prevSet.repsNormales) || 0);
      const hint = document.createElement("p");
      hint.className = "prev-hint";
      hint.textContent = `Anterior: ${prevSet.peso || "-"} × ${totalPrev || "-"} reps (${prevSet.sensacion || "-"})`;
      setsWrap.appendChild(hint);
    }

    // Antes esto se apagaba con solo "!draftSet" (¿ya existe un objeto de borrador para
    // esta serie?), pero persistDraft() guarda un objeto por serie SIEMPRE (aunque esté
    // vacía), así que apenas se guardaba un borrador una vez, la sugerencia de peso por
    // porcentaje dejaba de calcularse para el resto de la sesión. Ahora solo se apaga si
    // el borrador ya trae un peso capturado de verdad para esa serie.
    const draftHasPeso = !!(draftSet && draftSet.peso);
    const suggested = (!draftHasPeso && s.pct != null && currentMax != null) ? roundToIncrement(currentMax * (s.pct / 100), unitSelect.value) : null;
    const pesoVal = draftHasPeso ? draftSet.peso : (suggested != null ? suggested : (prevSet && prevSet.peso ? prevSet.peso : ""));
    const lentasVal = draftSet && draftSet.repsLentas ? draftSet.repsLentas : (prevSet && prevSet.repsLentas ? prevSet.repsLentas : "");
    const normalesVal = draftSet && draftSet.repsNormales ? draftSet.repsNormales : (prevSet && prevSet.repsNormales ? prevSet.repsNormales : "");
    const sensVal = (draftSet && draftSet.sensacion) || "Normal";
    const isPrefilled = !draftHasPeso && (suggested != null || (prevSet && prevSet.peso));

    const inputRow = document.createElement("div");
    inputRow.className = "set-input-row" + (isPrefilled ? " prefilled" : "");
    inputRow.innerHTML = `
      <input type="number" placeholder="peso" data-field="peso" value="${pesoVal}">
      <input type="number" placeholder="lentas" data-field="repsLentas" value="${lentasVal}"${isTUT ? "" : ' style="display:none;"'}>
      <input type="number" placeholder="${isTUT ? "normal" : "reps"}" data-field="repsNormales" value="${normalesVal}">
      <select data-field="sensacion">
        ${SENS_OPTIONS.map((o) => `<option${o === sensVal ? " selected" : ""}>${o}</option>`).join("")}
      </select>
    `;
    setsWrap.appendChild(inputRow);
    inputs.push(inputRow);
    if (draftSet) touched[i] = true;

    // aviso en vivo en la serie efectiva: avisa cuando ya se ganó la subida de peso
    // según el método de progresión activo (en "sensacion" no aplica: ahí decide el select).
    let liveHint = null;
    if (s.pct === 100 && progressionMode !== "sensacion") {
      liveHint = document.createElement("p");
      liveHint.className = "live-progress-hint";
      liveHint.style.display = "none";
      setsWrap.appendChild(liveHint);
      const updateLiveHint = () => {
        const lv = parseInt(inputRow.querySelector('[data-field="repsLentas"]').value) || 0;
        const nv = parseInt(inputRow.querySelector('[data-field="repsNormales"]').value) || 0;
        if (isTUT) {
          const totLive = lv + nv;
          if (lv >= REPS_LENTAS_MIN_PARA_SUBIR && totLive >= REPS_META_LENTAS) {
            liveHint.textContent = "✓ " + lv + " lentas" + (nv > 0 ? " + " + nv + " al filo del fallo" : " limpias") + " — la próxima sesión sube el peso.";
            liveHint.style.display = "block";
          } else if (lv > 0 || nv > 0) {
            liveHint.textContent = lv + " lentas" + (nv > 0 ? " + " + nv + " normales" : "") + " (" + totLive + "/" + REPS_META_LENTAS + ", mínimo " + REPS_LENTAS_MIN_PARA_SUBIR + " lentas)";
            liveHint.style.display = "block";
          } else {
            liveHint.style.display = "none";
          }
        } else {
          const tot = lv + nv;
          if (tot >= REPS_META_LENTAS) {
            liveHint.textContent = "✓ " + tot + " reps — la próxima sesión sube el peso.";
            liveHint.style.display = "block";
          } else if (tot > 0) {
            liveHint.textContent = tot + "/" + REPS_META_LENTAS + " reps";
            liveHint.style.display = "block";
          } else {
            liveHint.style.display = "none";
          }
        }
      };
      inputRow.querySelectorAll("input").forEach((el) => el.addEventListener("input", updateLiveHint));
      updateLiveHint();
    }

    function markTouched() {
      if (!exerciseStartedAt) exerciseStartedAt = Date.now();
      if (!touched[i]) {
        touched[i] = true;
        inputRow.classList.remove("prefilled");
        inputRow.classList.add("touched");
      }
      onChange();
    }
    function checkSetFilled() {
      const reps = (parseInt(inputRow.querySelector('[data-field="repsLentas"]').value) || 0) +
                   (parseInt(inputRow.querySelector('[data-field="repsNormales"]').value) || 0);
      if (reps > 0) spendSet(i);
    }
    inputRow.querySelectorAll("input,select").forEach((el) => {
      el.addEventListener("input", markTouched);
      el.addEventListener("change", markTouched);
      el.addEventListener("input", checkSetFilled);
      el.addEventListener("change", checkSetFilled);
    });
    checkSetFilled(); // por si ya viene prellenado con datos de la vez anterior

    const pesoInput = inputRow.querySelector('[data-field="peso"]');
    pesoInput.addEventListener("input", () => {
      if (s.pct == null) return;
      const val = parseFloat(pesoInput.value);
      if (!val) return;
      currentMax = Math.floor(val / (s.pct / 100));
      currentMaxExact = null;
      updateHint();
      inputs.forEach((otherRow, j) => {
        if (!otherRow || j === i || touched[j]) return;
        const otherPct = sets[j].pct;
        if (otherPct == null) return;
        otherRow.querySelector('[data-field="peso"]').value = roundToIncrement(currentMax * (otherPct / 100), unitSelect.value);
      });
    });

    if (draftSet) inputRow.classList.add("touched");
  });

  let equipoSelect = null;
  if (opts.equipmentOptions) {
    const eqVal = (draft && draft.equipo) || (lastData && lastData.equipo) || opts.equipmentOptions[0];
    const eqRow = document.createElement("div");
    eqRow.className = "set-input-row";
    eqRow.innerHTML = `
      <select data-field="equipo" style="flex:1;">
        ${opts.equipmentOptions.map((o) => `<option${o === eqVal ? " selected" : ""}>${o}</option>`).join("")}
      </select>
    `;
    block.appendChild(eqRow);
    equipoSelect = eqRow.querySelector('[data-field="equipo"]');
    equipoSelect.addEventListener("change", onChange);
  }

  const listoBtn = document.createElement("button");
  listoBtn.className = "listo-btn";
  listoBtn.type = "button";
  listoBtn.textContent = "Listo ✓";
  const nudge = document.createElement("p");
  nudge.className = "nudge";
  nudge.textContent = "Te falta llenar alguna serie antes de marcar listo.";
  listoBtn.onclick = () => {
    const allFilled = inputs.every((row) => {
      if (!row) return true;
      const reps = (parseInt(row.querySelector('[data-field="repsLentas"]').value) || 0) +
                   (parseInt(row.querySelector('[data-field="repsNormales"]').value) || 0);
      return reps > 0;
    });
    if (!allFilled) {
      nudge.style.display = "block";
      setTimeout(() => { nudge.style.display = "none"; }, 2500);
      return;
    }
    nudge.style.display = "none";
    sets.forEach((s, i) => { if (!s.noInput) spendSet(i); });
    block.classList.add("collapsed", "just-collapsed");
    setTimeout(() => block.classList.remove("just-collapsed"), 650);
    if (!block.dataset.wasDone) {
      block.dataset.wasDone = "1";
      // ejercicios sin series reales (ej. calentamiento) no pasan por spendSet arriba: se descuentan aquí de una vez.
      if (realSetCount === 0 && opts.onSetProgress) opts.onSetProgress(totalMinutes);
      if (exerciseStartedAt) exerciseDurationMin = Math.max(1, Math.round((Date.now() - exerciseStartedAt) / 60000));
      if (opts.dotEl) { opts.dotEl.classList.add("done"); opts.dotEl.classList.remove("current"); }
      if (opts.onExerciseDone) opts.onExerciseDone();
    }
  };
  block.appendChild(listoBtn);
  block.appendChild(nudge);

  block._getData = () => ({
    exerciseId: opts.storageId || exerciseId,
    nombre: ex.nombre + (opts.nameSuffix || ""),
    equipo: equipoSelect ? equipoSelect.value : null,
    unidad: unitSelect.value,
    sets: inputs.map((row, i) => row ? {
      label: sets[i].label,
      peso: row.querySelector('[data-field="peso"]').value || null,
      repsLentas: row.querySelector('[data-field="repsLentas"]').value || null,
      repsNormales: row.querySelector('[data-field="repsNormales"]').value || null,
      sensacion: row.querySelector('[data-field="sensacion"]').value
    } : { label: sets[i].label })
  });
  block._getDuration = () => exerciseDurationMin;
  return block;
}

async function handlePhotoChange(exerciseId, which, file, block) {
  if (!file) return;
  const dataUrl = await resizeToDataUrl(file, 480);
  const ref = doc(db, "users", currentUser.uid, "exerciseOverrides", exerciseId);
  const current = overrides[exerciseId] || {};
  current[which] = dataUrl;
  overrides[exerciseId] = current;
  await setDoc(ref, current, { merge: true });
  block.querySelector(`img[data-which="${which}"]`).src = dataUrl;
}

function resizeToDataUrl(file, maxWidth) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    reader.readAsDataURL(file);
  });
}

// timer de la sesión: vive a nivel módulo porque debe sobrevivir a los re-renders
// puntuales dentro de un mismo día, y se resetea al entrar a renderDay.
let sessionStartTime = null;
let timerInterval = null;
let isPaused = false;
let pausedAccum = 0;
let pauseStartedAt = null;
// listeners de pausa automática al salir de la pantalla del día (ver renderDayInner);
// se guardan aquí para poder quitarlos al navegar fuera y no duplicarlos entre renders.
let dayVisibilityHandler = null;
let dayPagehideHandler = null;

function fmtElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// red de seguridad: si algo truena al abrir un día (por ejemplo un borrador
// corrupto), en vez de dejar la pantalla en negro se descarta el borrador y se
// muestra una tarjeta con opciones de reintentar o volver al inicio.
async function renderDay(dayId, extraOverride) {
  try {
    await renderDayInner(dayId, extraOverride);
  } catch (err) {
    console.error("SparTrk - error al abrir el día:", err);
    try { localStorage.removeItem(`spartrk_draft_${currentUser.uid}_${dayId}`); } catch (e) {}
    if (timerInterval) clearInterval(timerInterval);
    if (dayVisibilityHandler) { document.removeEventListener("visibilitychange", dayVisibilityHandler); dayVisibilityHandler = null; }
    if (dayPagehideHandler) { window.removeEventListener("pagehide", dayPagehideHandler); dayPagehideHandler = null; }
    clearApp();
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <p style="font-size:13px; color:#f09595; margin-bottom:10px;">Algo falló al abrir este día. Se descartó la sesión sin guardar para destrabarlo.</p>
      <button class="primary-btn" id="retry-day" type="button">Intentar de nuevo</button>
      <button class="secondary-btn" id="go-home" type="button" style="margin-top:8px;">Volver al inicio</button>
    `;
    app.appendChild(card);
    card.querySelector("#retry-day").onclick = () => renderDay(dayId, extraOverride);
    card.querySelector("#go-home").onclick = renderHome;
  }
}

// dayId normal: "dia1".."diaN" (resuelto contra currentEffectivePlan) o "emergencia".
// extraOverride (opcional): { exList, label } para un "día extra" ad-hoc con una rutina
// guardada; en ese caso dayId es una clave única tipo "extra_<routineId>_<fecha>" que
// no colisiona con ningún slot semanal.
async function renderDayInner(dayId, extraOverride) {
  clearApp();
  sessionStartTime = null;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  isPaused = false;
  pausedAccum = 0;
  pauseStartedAt = null;
  if (dayVisibilityHandler) { document.removeEventListener("visibilitychange", dayVisibilityHandler); dayVisibilityHandler = null; }
  if (dayPagehideHandler) { window.removeEventListener("pagehide", dayPagehideHandler); dayPagehideHandler = null; }

  const draftKey = `spartrk_draft_${currentUser.uid}_${dayId}`;
  let draftData = null;
  try {
    const raw = localStorage.getItem(draftKey);
    if (raw) draftData = JSON.parse(raw);
  } catch (e) { draftData = null; }

  const top = document.createElement("div");
  top.className = "topbar sticky";
  top.innerHTML = `
    <button class="ghost-btn" id="back-btn">&#8592; volver</button>
    <div class="timer-wrap" id="timer-wrap"></div>
  `;
  app.appendChild(top);
  top.querySelector("#back-btn").onclick = () => {
    autoPauseOnLeave();
    if (dayVisibilityHandler) { document.removeEventListener("visibilitychange", dayVisibilityHandler); dayVisibilityHandler = null; }
    if (dayPagehideHandler) { window.removeEventListener("pagehide", dayPagehideHandler); dayPagehideHandler = null; }
    renderHome();
  };
  const timerWrapEl = top.querySelector("#timer-wrap");

  // --- timer: doble disparo (botón manual o al tocar el primer campo) + pausa ---
  function getElapsedMs() {
    if (!sessionStartTime) return 0;
    const pausedTotal = pausedAccum + (isPaused && pauseStartedAt ? Date.now() - pauseStartedAt : 0);
    return Date.now() - sessionStartTime - pausedTotal;
  }

  function renderTimerUI() {
    if (!sessionStartTime) {
      timerWrapEl.innerHTML = `<button class="timer-btn idle" id="timer-btn" type="button">Iniciar entrenamiento</button>`;
      timerWrapEl.querySelector("#timer-btn").onclick = startTimer;
      return;
    }
    timerWrapEl.innerHTML = `
      <div class="timer-running-box">
        <span class="clock${isPaused ? " paused" : ""}" id="timer-clock">${fmtElapsed(getElapsedMs())}</span>
        <button class="pause-btn${isPaused ? " paused" : ""}" id="pause-btn" type="button">${isPaused ? "&#9654;" : "&#10074;&#10074;"}</button>
        <button class="reset-btn" id="reset-timer-btn" type="button" title="Reiniciar cronómetro">&#8635;</button>
      </div>
    `;
    timerWrapEl.querySelector("#pause-btn").onclick = togglePause;
    timerWrapEl.querySelector("#reset-timer-btn").onclick = () => {
      const confirmed = confirm("¿Reiniciar el cronómetro de este entrenamiento? Se perderá el tiempo acumulado (" + fmtElapsed(getElapsedMs()) + ").");
      if (!confirmed) return;
      sessionStartTime = Date.now();
      pausedAccum = 0;
      isPaused = false;
      pauseStartedAt = null;
      renderTimerUI();
      persistDraft();
    };
  }

  function startTimer() {
    if (sessionStartTime) return;
    sessionStartTime = draftData && draftData.startedAt ? draftData.startedAt : Date.now();
    pausedAccum = (draftData && draftData.pausedAccum) || 0;
    // si el borrador se guardó con el cronómetro en pausa, se restaura pausado
    // (el tiempo fuera de la app no cuenta como entrenamiento).
    isPaused = !!(draftData && draftData.isPaused && draftData.pauseStartedAt);
    pauseStartedAt = isPaused ? draftData.pauseStartedAt : null;
    renderTimerUI();
    timerInterval = setInterval(() => {
      if (!isPaused) {
        const clockEl = document.getElementById("timer-clock");
        if (clockEl) clockEl.textContent = fmtElapsed(getElapsedMs());
      }
    }, 1000);
    persistDraft();
  }

  function togglePause() {
    if (!sessionStartTime) return;
    if (isPaused) {
      pausedAccum += Date.now() - pauseStartedAt;
      pauseStartedAt = null;
      isPaused = false;
    } else {
      isPaused = true;
      pauseStartedAt = Date.now();
    }
    renderTimerUI();
    persistDraft();
  }

  // pausa automática si sales de la pantalla del ejercicio (cambias de app, apagas
  // pantalla, o le das "volver"): antes el cronómetro seguía corriendo en segundo
  // plano durante horas/días si no cerrabas la sesión, y arruinaba la duración
  // guardada (ej. "5684 hrs" por dejar la app abierta desde el viernes).
  function autoPauseOnLeave() {
    if (sessionStartTime && !isPaused) {
      isPaused = true;
      pauseStartedAt = Date.now();
      renderTimerUI();
      persistDraft();
    }
  }
  dayVisibilityHandler = () => { if (document.hidden) autoPauseOnLeave(); };
  dayPagehideHandler = autoPauseOnLeave;
  document.addEventListener("visibilitychange", dayVisibilityHandler);
  window.addEventListener("pagehide", dayPagehideHandler);

  renderTimerUI();

  if (draftData) {
    const banner = document.createElement("div");
    banner.className = "draft-banner";
    banner.textContent = "Se restauró tu sesión sin guardar de este día.";
    app.appendChild(banner);
  }

  let exList, label, isEmergency = false;
  if (dayId === "emergencia") {
    exList = EMERGENCIA.exercises;
    label = EMERGENCIA.nombre;
    isEmergency = true;
  } else if (extraOverride) {
    exList = extraOverride.exList;
    label = extraOverride.label;
  } else {
    const slot = currentEffectivePlan.find((s) => s.id === dayId);
    exList = slot.exercises;
    label = "Día " + dayId.slice(-1) + " - " + slot.nombre;
  }

  const allIds = exList.map((e) => e.id).concat(isEmergency ? [] : [DAILY_TASK.storageId]);
  const [lastDataMap] = await Promise.all([loadLastData(allIds), loadProgressionMode(), loadWeightIncrements()]);

  // usa el promedio real de tus últimas sesiones para ese ejercicio si ya existe,
  // si no, cae al estimado genérico por número de series.
  function minutesFor(e) {
    const personalized = lastDataMap[e.id] && lastDataMap[e.id].avgDuracionMin;
    return personalized || estimateMinutes(e.sets);
  }

  // la tarea diaria (bombeada) también cuenta para el estimado, usando su duración
  // real promedio si ya hay historial (antes se asumía 1 min fijo).
  const dailyTaskMin = isEmergency ? 0 : ((lastDataMap[DAILY_TASK.storageId] && lastDataMap[DAILY_TASK.storageId].avgDuracionMin) || DAILY_TASK_TIME_MIN);
  let remainingMinutes = exList.reduce((sum, e) => sum + minutesFor(e), 0) + dailyTaskMin;
  const etaExEl = document.createElement("span");
  etaExEl.className = "min-num";
  function updateEta() {
    etaExEl.innerHTML = `&#8776; ${Math.max(0, Math.round(remainingMinutes))} min ejercicios`;
    etaExEl.classList.add("flash");
    setTimeout(() => etaExEl.classList.remove("flash"), 300);
  }

  const blocks = [];
  function persistDraft() {
    const data = {
      dayId, dayLabel: label,
      exercises: blocks.map((b) => b._getData()),
      cardio: isEmergency ? null : {
        minutos: app.querySelector("#cardio-min")?.value || "",
        tipo: app.querySelector("#cardio-tipo")?.value || "",
        ciclos: app.querySelector("#cardio-ciclos")?.value || ""
      },
      startedAt: sessionStartTime,
      pausedAccum: pausedAccum,
      isPaused: isPaused,
      pauseStartedAt: pauseStartedAt,
      savedAt: Date.now()
    };
    try { localStorage.setItem(draftKey, JSON.stringify(data)); } catch (e) {}
  }

  function draftFor(exerciseId) {
    return draftData && draftData.exercises ? draftData.exercises.find((x) => x.exerciseId === exerciseId) : null;
  }

  // --- punto "en curso" (tercer color, distinto de pendiente/completado) ---
  let currentDotEl = null;
  function setCurrentDot(dotEl) {
    if (currentDotEl && currentDotEl !== dotEl) currentDotEl.classList.remove("current");
    if (dotEl && !dotEl.classList.contains("done")) {
      dotEl.classList.add("current");
      currentDotEl = dotEl;
    }
  }

  const dotsWrap = document.createElement("div");
  dotsWrap.className = "progress-dots";

  exList.forEach((e) => {
    const dotEl = document.createElement("div");
    dotEl.className = "pdot";
    dotEl.title = getExercise(e.id).nombre;
    dotsWrap.appendChild(dotEl);

    const b = buildExerciseBlock(e.id, e.sets, label, {
      lastData: lastDataMap[e.id],
      draft: draftFor(e.id),
      onChange: persistDraft,
      dotEl,
      totalMinutesOverride: minutesFor(e),
      onSetProgress: (min) => { remainingMinutes -= min; updateEta(); persistDraft(); },
      onExerciseDone: () => { persistDraft(); },
      onFocus: () => { startTimer(); if (isPaused) togglePause(); setCurrentDot(dotEl); }
    });
    blocks.push(b);
    app.appendChild(b);
  });

  let dailyDotEl = null;
  if (!isEmergency) {
    dailyDotEl = document.createElement("div");
    dailyDotEl.className = "pdot-daily";
    dailyDotEl.title = "Tarea diaria";
    dotsWrap.appendChild(dailyDotEl);

    const taskBlock = buildExerciseBlock(DAILY_TASK.id, DAILY_TASK.sets, "Tarea diaria (pompeo)", {
      equipmentOptions: EQUIPO_LATERALES,
      lastData: lastDataMap[DAILY_TASK.storageId],
      draft: draftFor(DAILY_TASK.storageId),
      onChange: persistDraft,
      storageId: DAILY_TASK.storageId,
      nameSuffix: " (tarea diaria)",
      dotEl: dailyDotEl,
      totalMinutesOverride: dailyTaskMin,
      onSetProgress: (min) => { remainingMinutes -= min; updateEta(); persistDraft(); },
      onExerciseDone: () => { persistDraft(); },
      onFocus: () => { startTimer(); if (isPaused) togglePause(); setCurrentDot(dailyDotEl); }
    });
    blocks.push(taskBlock);
    app.appendChild(taskBlock);
  }

  let cardioDotEl = null;
  const etaCardioEl = document.createElement("span");
  etaCardioEl.className = "cardio-part";
  etaCardioEl.textContent = `+${CARDIO_TIME_MIN} cardio`;

  if (!isEmergency) {
    cardioDotEl = document.createElement("div");
    cardioDotEl.className = "pdot-cardio";
    cardioDotEl.title = "Cardio";
    dotsWrap.appendChild(cardioDotEl);

    const cardioBlock = document.createElement("div");
    cardioBlock.className = "card";
    const cd = (draftData && draftData.cardio) || {};
    cardioBlock.innerHTML = `
      <p style="font-size:12px; color:#8a8a8a; margin-bottom:6px;">Cardio (opcional)</p>
      <div class="set-input-row">
        <input type="number" placeholder="minutos" id="cardio-min" value="${cd.minutos || ""}">
        <select id="cardio-tipo">
          ${CARDIO_TIPOS.map((o) => `<option${o === cd.tipo ? " selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
      <div class="set-input-row" id="cardio-ciclos-row" style="display:${cd.tipo === "Tabata" ? "flex" : "none"};">
        <input type="number" placeholder="número de ciclos" id="cardio-ciclos" value="${cd.ciclos || ""}">
      </div>
      <button class="listo-btn" type="button" id="cardio-listo-btn">Listo &#10003;</button>
      <p class="nudge" id="cardio-nudge">Captura los minutos antes de marcar listo.</p>
    `;
    app.appendChild(cardioBlock);
    cardioBlock.addEventListener("focusin", () => { startTimer(); setCurrentDot(cardioDotEl); });
    const cardioTipoSel = cardioBlock.querySelector("#cardio-tipo");
    const ciclosRow = cardioBlock.querySelector("#cardio-ciclos-row");
    cardioTipoSel.addEventListener("change", () => {
      ciclosRow.style.display = cardioTipoSel.value === "Tabata" ? "flex" : "none";
      persistDraft();
    });
    cardioBlock.querySelector("#cardio-min").addEventListener("input", persistDraft);
    cardioBlock.querySelector("#cardio-ciclos").addEventListener("input", persistDraft);

    const cardioNudge = cardioBlock.querySelector("#cardio-nudge");
    cardioBlock.querySelector("#cardio-listo-btn").onclick = () => {
      const min = cardioBlock.querySelector("#cardio-min").value;
      if (!min || parseInt(min) <= 0) {
        cardioNudge.style.display = "block";
        setTimeout(() => { cardioNudge.style.display = "none"; }, 2500);
        return;
      }
      cardioNudge.style.display = "none";
      cardioDotEl.classList.add("done");
      cardioDotEl.classList.remove("current");
      etaCardioEl.style.display = "none";
      const btn = cardioBlock.querySelector("#cardio-listo-btn");
      btn.textContent = "Completado";
      btn.disabled = true;
    };
  }

  // restaurar el cronómetro del borrador hasta aquí, cuando `blocks` y todo lo que
  // usa persistDraft ya existe (restaurarlo al inicio tronaba la pantalla en negro).
  if (draftData && draftData.startedAt) startTimer();

  updateEta();
  const etaWrap = document.createElement("div");
  etaWrap.className = "progress-eta";
  etaWrap.appendChild(etaExEl);
  if (!isEmergency) etaWrap.appendChild(etaCardioEl);

  const progressFooter = document.createElement("div");
  progressFooter.className = "progress-footer";
  progressFooter.appendChild(dotsWrap);
  progressFooter.appendChild(etaWrap);
  app.appendChild(progressFooter);

  const saveErrorEl = document.createElement("p");
  saveErrorEl.className = "save-error";
  saveErrorEl.style.display = "none";

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary-btn";
  saveBtn.textContent = "Guardar sesión";
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando...";
    saveErrorEl.style.display = "none";

    const exercisesData = blocks.map((b) => b._getData());
    const durations = blocks.map((b) => (b._getDuration ? b._getDuration() : null));
    const entry = {
      date: serverTimestamp(),
      dayId,
      dayLabel: label,
      exercises: exercisesData,
      duracionMin: sessionStartTime ? Math.round(getElapsedMs() / 60000) : null,
      cardio: null
    };
    if (!isEmergency) {
      const min = app.querySelector("#cardio-min")?.value;
      const tipo = app.querySelector("#cardio-tipo")?.value;
      const ciclos = tipo === "Tabata" ? app.querySelector("#cardio-ciclos")?.value : null;
      if (min) entry.cardio = { minutos: min, tipo, ciclos };
    }

    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000));
    try {
      await Promise.race([
        (async () => {
          await addDoc(collection(db, "users", currentUser.uid, "logs"), entry);
          await saveLastData(exercisesData, durations, lastDataMap);
          if (dayId !== "emergencia") await markComplete(dayId);
          if (dayId === "emergencia") await markComplete("emergencia_" + isoDate(new Date()));
          // además de la marca única del día extra (arriba), se marca el "slot" de la
          // cascada (extra1, extra2...) para que en Home aparezca el siguiente disponible.
          if (extraOverride && extraOverride.slotKey) {
            const mergedNames = Object.assign({}, weekProgress.extraNames || {}, { [extraOverride.slotKey]: extraOverride.slotLabel || label });
            await markComplete(extraOverride.slotKey, { extraNames: mergedNames });
          }
        })(),
        timeoutPromise
      ]);
      if (timerInterval) clearInterval(timerInterval);
      if (dayVisibilityHandler) { document.removeEventListener("visibilitychange", dayVisibilityHandler); dayVisibilityHandler = null; }
      if (dayPagehideHandler) { window.removeEventListener("pagehide", dayPagehideHandler); dayPagehideHandler = null; }
      try { localStorage.removeItem(draftKey); } catch (e) {}
      renderHome();
    } catch (err) {
      console.error("SparTrk - error al guardar sesión:", err);
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar sesión";
      const detail = (err && (err.code || err.message)) ? ` [${err.code || err.message}]` : "";
      saveErrorEl.textContent = "No se pudo guardar (revisa tu conexión a internet). Tus datos siguen aquí, intenta de nuevo en unos segundos." + detail;
      saveErrorEl.style.display = "block";
    }
  };
  app.appendChild(saveBtn);
  app.appendChild(saveErrorEl);
}

async function renderExport() {
  clearApp();
  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `<div class="title">Exportar registro</div>`;
  app.appendChild(top);

  const userRef = doc(db, "users", currentUser.uid);
  const userSnap = await getDoc(userRef);
  const lastExportedAt = userSnap.exists() ? userSnap.data().lastExportedAt : null;

  const meta = document.createElement("p");
  meta.className = "export-meta";
  meta.textContent = lastExportedAt
    ? "Última exportación: " + lastExportedAt.toDate().toLocaleString("es-MX")
    : "Aún no has exportado nada.";
  app.appendChild(meta);

  const newBtn = document.createElement("button");
  newBtn.className = "primary-btn";
  newBtn.style.marginBottom = "10px";
  newBtn.textContent = lastExportedAt ? "Exportar lo nuevo desde la última vez" : "Exportar todo";
  newBtn.onclick = async () => {
    const constraints = [orderBy("date", "asc")];
    if (lastExportedAt) constraints.unshift(where("date", ">", lastExportedAt));
    const q = query(collection(db, "users", currentUser.uid, "logs"), ...constraints);
    const snap = await getDocs(q);
    const logs = snap.docs.map((d) => d.data());
    outputEl.value = formatExport(logs);
    await setDoc(userRef, { lastExportedAt: serverTimestamp() }, { merge: true });
    meta.textContent = "Última exportación: justo ahora";
  };
  app.appendChild(newBtn);

  const rangeCard = document.createElement("div");
  rangeCard.className = "card";
  rangeCard.innerHTML = `
    <p style="font-size:11px; color:#8a8a8a; margin-bottom:8px;">O elige un rango de fechas</p>
    <div class="date-range">
      <input type="date" id="range-from">
      <input type="date" id="range-to">
    </div>
    <button class="secondary-btn" id="range-btn">Exportar rango</button>
  `;
  app.appendChild(rangeCard);
  rangeCard.querySelector("#range-btn").onclick = async () => {
    const from = rangeCard.querySelector("#range-from").value;
    const to = rangeCard.querySelector("#range-to").value;
    if (!from || !to) return;
    const fromTs = Timestamp.fromDate(new Date(from + "T00:00:00"));
    const toTs = Timestamp.fromDate(new Date(to + "T23:59:59"));
    const q = query(
      collection(db, "users", currentUser.uid, "logs"),
      where("date", ">=", fromTs), where("date", "<=", toTs), orderBy("date", "asc")
    );
    const snap = await getDocs(q);
    const logs = snap.docs.map((d) => d.data());
    outputEl.value = formatExport(logs);
  };

  const outputEl = document.createElement("textarea");
  outputEl.className = "export-output";
  outputEl.readOnly = true;
  outputEl.placeholder = "Aquí aparecerá el texto listo para copiar y pegar.";
  app.appendChild(outputEl);

  const copyBtn = document.createElement("button");
  copyBtn.className = "secondary-btn";
  copyBtn.style.marginTop = "8px";
  copyBtn.textContent = "Copiar al portapapeles";
  copyBtn.onclick = () => { outputEl.select(); document.execCommand("copy"); };
  app.appendChild(copyBtn);

  app.appendChild(renderTabbar("export"));
}

function formatExport(logs) {
  if (!logs.length) return "No hay registros nuevos en este rango.";
  let out = "";
  logs.forEach((log) => {
    const d = log.date && log.date.toDate ? log.date.toDate() : new Date();
    out += `=== ${d.toLocaleDateString("es-MX")} - ${log.dayLabel}${log.duracionMin ? " (" + log.duracionMin + " min)" : ""} ===\n`;
    log.exercises.forEach((ex) => {
      out += `${ex.nombre}${ex.equipo ? " [" + ex.equipo + "]" : ""}${ex.unidad ? " (" + ex.unidad + ")" : ""}\n`;
      ex.sets.forEach((s) => {
        const totalReps = (parseInt(s.repsLentas) || 0) + (parseInt(s.repsNormales) || 0);
        if (s.peso || totalReps) {
          out += `  ${s.label}: ${s.peso || "-"} x ${totalReps || "-"} reps (${s.repsLentas || 0} despacito / ${s.repsNormales || 0} normal) - ${s.sensacion || "-"}\n`;
        } else {
          out += `  ${s.label}\n`;
        }
      });
    });
    if (log.cardio) {
      out += `Cardio: ${log.cardio.minutos} min - ${log.cardio.tipo}${log.cardio.ciclos ? " (" + log.cardio.ciclos + " ciclos)" : ""}\n`;
    }
    out += "\n";
  });
  return out;
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await loadOverrides();
    renderHome();
  } else {
    renderLogin();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
