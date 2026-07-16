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
function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtDate(d) { return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }); }
function imgSrc(exerciseId) {
  const ov = overrides[exerciseId];
  if (ov && ov.img) return ov.img;
  return EXERCISES[exerciseId].img;
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

async function markComplete(dayId) {
  const ref = doc(db, "users", currentUser.uid, "weeks", weekStartISO);
  weekProgress[dayId] = true;
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
  return map;
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
      if (r) slots.push({ id: key, nombre: r.nombre, exercises: r.exerciseIds.map((eid) => ({ id: eid, sets: ASCENDING_SETS })) });
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

  const extraCard = document.createElement("div");
  extraCard.className = "card extra-day-card";
  extraCard.innerHTML = `<p>+ Día extra</p><div class="sub">¿Le metes un día más? Elige una rutina guardada.</div>`;
  extraCard.onclick = () => openExtraDaySheet(routinesMap);
  app.appendChild(extraCard);

  app.appendChild(buildCalendarSection());

  app.appendChild(renderTabbar("home"));
}

// hoja para elegir una rutina guardada y arrancar un "día extra" suelto, sin que
// afecte tu plan semanal ni marque ningún Día 1-N como completado.
function openExtraDaySheet(routinesMap) {
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
        ${ids.map((id) => `<div class="routine-pick" data-id="${id}"><div class="name">${routinesMap[id].nombre}</div><div class="count">${routinesMap[id].exerciseIds.length} ejercicios</div></div>`).join("")}
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
      const exList = r.exerciseIds.map((eid) => ({ id: eid, sets: ASCENDING_SETS }));
      const extraDayId = "extra_" + id + "_" + isoDate(new Date());
      renderDay(extraDayId, { exList, label: "Día extra - " + r.nombre });
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
  const [weekPlan, routinesMap] = await Promise.all([loadWeekPlan(), loadRoutines()]);
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
      row.innerHTML = `<div><div class="name">${r.nombre}</div><div class="count">${r.exerciseIds.length} ejercicios</div></div><button class="edit" type="button">editar</button>`;
      row.querySelector(".edit").onclick = () => renderRoutineEditor(id);
      routineList.appendChild(row);
    });
  }

  const addBtn = document.createElement("button");
  addBtn.className = "add-routine-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ Nueva rutina";
  addBtn.onclick = () => renderRoutineEditor(null);
  app.appendChild(addBtn);

  const fieldLabel2 = document.createElement("div");
  fieldLabel2.className = "field-label";
  fieldLabel2.textContent = "Días de entrenamiento por semana";
  app.appendChild(fieldLabel2);

  const currentDias = (weekPlan && weekPlan.enabled && weekPlan.diasPerWeek) || 4;
  const diasSelect = document.createElement("select");
  diasSelect.style.cssText = "width:100%; margin-bottom:14px;";
  [3, 4, 5, 6].forEach((n) => {
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
  const ex = EXERCISES[exerciseId];
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
        <img src="${imgSrc(exerciseId)}" data-which="img">
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

  const idx100 = sets.findIndex((s) => s.pct === 100);
  let currentMax = null;
  if (idx100 !== -1 && lastData && lastData.sets && lastData.sets[idx100] && lastData.sets[idx100].peso) {
    const refSet = lastData.sets[idx100];
    const base = parseFloat(refSet.peso);
    const allSlow = parseInt(refSet.repsNormales || 0) === 0 && parseInt(refSet.repsLentas || 0) > 0;
    let factor = 1;
    if (refSet.sensacion === "Fácil" || allSlow) factor = 1.05;
    else if (refSet.sensacion === "No completé") factor = 0.95;
    currentMax = Math.floor(base * factor);
  }

  const suggestHint = document.createElement("p");
  suggestHint.className = "suggest-hint";
  block.appendChild(suggestHint);
  function updateHint() {
    if (currentMax != null) {
      suggestHint.style.display = "block";
      suggestHint.textContent = `Pesos sugeridos según tu máximo estimado: ${currentMax} ${unitSelect.value}`;
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

    const suggested = (!draftSet && s.pct != null && currentMax != null) ? Math.floor(currentMax * (s.pct / 100)) : null;
    const pesoVal = draftSet && draftSet.peso ? draftSet.peso : (suggested != null ? suggested : (prevSet && prevSet.peso ? prevSet.peso : ""));
    const lentasVal = draftSet && draftSet.repsLentas ? draftSet.repsLentas : (prevSet && prevSet.repsLentas ? prevSet.repsLentas : "");
    const normalesVal = draftSet && draftSet.repsNormales ? draftSet.repsNormales : (prevSet && prevSet.repsNormales ? prevSet.repsNormales : "");
    const sensVal = (draftSet && draftSet.sensacion) || "Normal";
    const isPrefilled = !draftSet && (suggested != null || (prevSet && prevSet.peso));

    const inputRow = document.createElement("div");
    inputRow.className = "set-input-row" + (isPrefilled ? " prefilled" : "");
    inputRow.innerHTML = `
      <input type="number" placeholder="peso" data-field="peso" value="${pesoVal}">
      <input type="number" placeholder="lentas" data-field="repsLentas" value="${lentasVal}">
      <input type="number" placeholder="normal" data-field="repsNormales" value="${normalesVal}">
      <select data-field="sensacion">
        ${SENS_OPTIONS.map((o) => `<option${o === sensVal ? " selected" : ""}>${o}</option>`).join("")}
      </select>
    `;
    setsWrap.appendChild(inputRow);
    inputs.push(inputRow);
    if (draftSet) touched[i] = true;

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
      updateHint();
      inputs.forEach((otherRow, j) => {
        if (!otherRow || j === i || touched[j]) return;
        const otherPct = sets[j].pct;
        if (otherPct == null) return;
        otherRow.querySelector('[data-field="peso"]').value = Math.floor(currentMax * (otherPct / 100));
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

function fmtElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// dayId normal: "dia1".."diaN" (resuelto contra currentEffectivePlan) o "emergencia".
// extraOverride (opcional): { exList, label } para un "día extra" ad-hoc con una rutina
// guardada; en ese caso dayId es una clave única tipo "extra_<routineId>_<fecha>" que
// no colisiona con ningún slot semanal.
async function renderDay(dayId, extraOverride) {
  clearApp();
  sessionStartTime = null;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  isPaused = false;
  pausedAccum = 0;
  pauseStartedAt = null;

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
  top.querySelector("#back-btn").onclick = renderHome;
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
      </div>
    `;
    timerWrapEl.querySelector("#pause-btn").onclick = togglePause;
  }

  function startTimer() {
    if (sessionStartTime) return;
    sessionStartTime = draftData && draftData.startedAt ? draftData.startedAt : Date.now();
    pausedAccum = (draftData && draftData.pausedAccum) || 0;
    isPaused = false;
    pauseStartedAt = null;
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

  renderTimerUI();
  if (draftData && draftData.startedAt) startTimer();

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
  const lastDataMap = await loadLastData(allIds);

  // usa el promedio real de tus últimas sesiones para ese ejercicio si ya existe,
  // si no, cae al estimado genérico por número de series.
  function minutesFor(e) {
    const personalized = lastDataMap[e.id] && lastDataMap[e.id].avgDuracionMin;
    return personalized || estimateMinutes(e.sets);
  }

  let remainingMinutes = exList.reduce((sum, e) => sum + minutesFor(e), 0) + (isEmergency ? 0 : DAILY_TASK_TIME_MIN);
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
    dotEl.title = EXERCISES[e.id].nombre;
    dotsWrap.appendChild(dotEl);

    const b = buildExerciseBlock(e.id, e.sets, label, {
      lastData: lastDataMap[e.id],
      draft: draftFor(e.id),
      onChange: persistDraft,
      dotEl,
      totalMinutesOverride: minutesFor(e),
      onSetProgress: (min) => { remainingMinutes -= min; updateEta(); persistDraft(); },
      onExerciseDone: () => { persistDraft(); },
      onFocus: () => { startTimer(); setCurrentDot(dotEl); }
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
      totalMinutesOverride: DAILY_TASK_TIME_MIN,
      onSetProgress: (min) => { remainingMinutes -= min; updateEta(); persistDraft(); },
      onExerciseDone: () => { persistDraft(); },
      onFocus: () => { startTimer(); setCurrentDot(dailyDotEl); }
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
        })(),
        timeoutPromise
      ]);
      if (timerInterval) clearInterval(timerInterval);
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
