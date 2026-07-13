import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where, orderBy, getDocs, serverTimestamp, Timestamp
} from "./firebase-init.js";
import { EXERCISES, DAYS, EMERGENCIA, DAILY_TASK, EQUIPO_LATERALES, CARDIO_TIPOS } from "./exercises-data.js";

const app = document.getElementById("app");
let currentUser = null;
let overrides = {};
let weekProgress = {};
let weekStartISO = "";

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function fmtDate(d) {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}
function imgSrc(exerciseId, which) {
  const ov = overrides[exerciseId];
  if (ov && ov[which]) return ov[which];
  return EXERCISES[exerciseId][which === "imgStart" ? "imgStart" : "imgEnd"];
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

async function saveLastData(exercisesData) {
  await Promise.all(exercisesData.map((ex) =>
    setDoc(doc(db, "users", currentUser.uid, "lastExercise", ex.exerciseId), {
      sets: ex.sets, equipo: ex.equipo || null, date: serverTimestamp()
    })
  ));
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
  `;
  app.appendChild(top);

  const grid = document.createElement("div");
  grid.className = "day-grid";
  Object.values(DAYS).forEach((day) => {
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

  app.appendChild(renderTabbar("home"));
}

function buildExerciseBlock(exerciseId, sets, dayLabel, opts = {}) {
  const ex = EXERCISES[exerciseId];
  const block = document.createElement("div");
  block.className = "exercise-block";
  block.innerHTML = `
    <div class="exercise-header">${dayLabel}</div>
    <div class="exercise-name">${ex.nombre}</div>
    <div class="exercise-images">
      <div class="imgwrap">
        <img src="${imgSrc(exerciseId, "imgStart")}" data-which="imgStart">
        <button class="change-photo-btn" data-which="imgStart">cambiar</button>
        <p class="lbl">Inicio</p>
      </div>
      <div class="imgwrap">
        <img src="${imgSrc(exerciseId, "imgEnd")}" data-which="imgEnd">
        <button class="change-photo-btn" data-which="imgEnd">cambiar</button>
        <p class="lbl">Fin</p>
      </div>
    </div>
    <p class="instructions">${ex.instrucciones}</p>
  `;

  block.querySelectorAll(".change-photo-btn").forEach((btn) => {
    btn.onclick = () => {
      const which = btn.dataset.which;
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*"; input.capture = "environment";
      input.onchange = () => handlePhotoChange(exerciseId, which, input.files[0], block);
      input.click();
    };
  });

  const setsWrap = document.createElement("div");
  const inputs = [];
  sets.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "set-row" + (s.pct === 100 ? " effective" : "");
    row.innerHTML = `<span>${s.label}</span>`;
    setsWrap.appendChild(row);

    if (!s.noInput) {
      const prev = opts.lastData && opts.lastData.sets && opts.lastData.sets[i];
      if (prev && (prev.peso || prev.reps)) {
        const hint = document.createElement("p");
        hint.style.cssText = "font-size:10px; color:#6a6a6a; margin:0 0 3px;";
        hint.textContent = `Anterior: ${prev.peso || "-"}kg × ${prev.reps || "-"} reps (${prev.sensacion || "-"})`;
        setsWrap.appendChild(hint);
      }
      const inputRow = document.createElement("div");
      inputRow.className = "set-input-row";
      inputRow.innerHTML = `
        <input type="number" placeholder="kg" data-field="peso" value="${prev && prev.peso ? prev.peso : ""}">
        <input type="number" placeholder="reps" data-field="reps" value="${prev && prev.reps ? prev.reps : ""}">
        <select data-field="sensacion">
          <option${prev && prev.sensacion === "Normal" ? " selected" : ""}>Normal</option>
          <option${prev && prev.sensacion === "Fácil" ? " selected" : ""}>Fácil</option>
          <option${prev && prev.sensacion === "Pesado" ? " selected" : ""}>Pesado</option>
          <option${prev && prev.sensacion === "No completé" ? " selected" : ""}>No completé</option>
        </select>
      `;
      setsWrap.appendChild(inputRow);
      inputs.push(inputRow);
    } else {
      inputs.push(null);
    }
  });
  block.appendChild(setsWrap);

  let equipoSelect = null;
  if (opts.equipmentOptions) {
    const eqRow = document.createElement("div");
    eqRow.className = "set-input-row";
    eqRow.innerHTML = `
      <select data-field="equipo" style="flex:1;">
        ${opts.equipmentOptions.map((o) => `<option>${o}</option>`).join("")}
      </select>
    `;
    block.appendChild(eqRow);
    equipoSelect = eqRow.querySelector('[data-field="equipo"]');
  }

  block._getData = () => ({
    exerciseId, nombre: ex.nombre,
    equipo: equipoSelect ? equipoSelect.value : undefined,
    sets: inputs.map((row, i) => row ? {
      label: sets[i].label,
      peso: row.querySelector('[data-field="peso"]').value || null,
      reps: row.querySelector('[data-field="reps"]').value || null,
      sensacion: row.querySelector('[data-field="sensacion"]').value
    } : { label: sets[i].label })
  });
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

let sessionStartTime = null;
let timerInterval = null;

function fmtElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function renderDay(dayId) {
  clearApp();
  sessionStartTime = null;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;

  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `<button class="ghost-btn" id="back-btn">&#8592; volver</button>`;
  app.appendChild(top);
  top.querySelector("#back-btn").onclick = renderHome;

  const timerCard = document.createElement("div");
  timerCard.className = "card";
  timerCard.style.textAlign = "center";
  timerCard.innerHTML = `<button class="primary-btn" id="timer-btn">Iniciar entrenamiento</button>`;
  app.appendChild(timerCard);
  const timerBtn = timerCard.querySelector("#timer-btn");
  timerBtn.onclick = () => {
    if (sessionStartTime) return;
    sessionStartTime = Date.now();
    timerBtn.textContent = "00:00";
    timerBtn.style.background = "#1c0808";
    timerBtn.style.color = "#f0d9c8";
    timerInterval = setInterval(() => {
      timerBtn.textContent = fmtElapsed(Date.now() - sessionStartTime);
    }, 1000);
  };

  let exList, label, isEmergency = false;
  if (dayId === "emergencia") {
    exList = EMERGENCIA.exercises;
    label = EMERGENCIA.nombre;
    isEmergency = true;
  } else {
    exList = DAYS[dayId].exercises;
    label = "Día " + dayId.slice(-1) + " - " + DAYS[dayId].nombre;
  }

  const allIds = exList.map((e) => e.id).concat(isEmergency ? [] : [DAILY_TASK.id]);
  const lastDataMap = await loadLastData(allIds);

  const blocks = exList.map((e) => buildExerciseBlock(e.id, e.sets, label, { lastData: lastDataMap[e.id] }));
  blocks.forEach((b) => app.appendChild(b));

  if (!isEmergency) {
    const taskBlock = buildExerciseBlock(DAILY_TASK.id, DAILY_TASK.sets, "Tarea diaria", { equipmentOptions: EQUIPO_LATERALES, lastData: lastDataMap[DAILY_TASK.id] });
    blocks.push(taskBlock);
    app.appendChild(taskBlock);
  }

  if (!isEmergency) {
    const cardioBlock = document.createElement("div");
    cardioBlock.className = "card";
    cardioBlock.innerHTML = `
      <p style="font-size:12px; color:#8a8a8a; margin-bottom:6px;">Cardio (opcional)</p>
      <div class="set-input-row">
        <input type="number" placeholder="minutos" id="cardio-min">
        <select id="cardio-tipo">
          ${CARDIO_TIPOS.map((o) => `<option>${o}</option>`).join("")}
        </select>
      </div>
    `;
    app.appendChild(cardioBlock);
  }

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary-btn";
  saveBtn.textContent = "Guardar sesión";
  saveBtn.onclick = async () => {
    saveBtn.textContent = "Guardando...";
    if (timerInterval) clearInterval(timerInterval);
    const exercisesData = blocks.map((b) => b._getData());
    const entry = {
      date: serverTimestamp(),
      dayId,
      dayLabel: label,
      exercises: exercisesData,
      duracionMin: sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 60000) : null,
      cardio: null
    };
    if (!isEmergency) {
      const min = app.querySelector("#cardio-min")?.value;
      const tipo = app.querySelector("#cardio-tipo")?.value;
      if (min) entry.cardio = { minutos: min, tipo };
    }
    await addDoc(collection(db, "users", currentUser.uid, "logs"), entry);
    await saveLastData(exercisesData);
    if (dayId !== "emergencia") await markComplete(dayId);
    if (dayId === "emergencia") await markComplete("emergencia_" + isoDate(new Date()));
    renderHome();
  };
  app.appendChild(saveBtn);
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
      out += `${ex.nombre}\n`;
      if (ex.equipo) out += `  (equipo: ${ex.equipo})\n`;
      ex.sets.forEach((s) => {
        if (s.peso || s.reps) {
          out += `  ${s.label}: ${s.peso || "-"}kg x ${s.reps || "-"} reps (${s.sensacion || "-"})\n`;
        } else {
          out += `  ${s.label}\n`;
        }
      });
    });
    if (log.cardio) out += `Cardio: ${log.cardio.minutos} min - ${log.cardio.tipo}\n`;
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
