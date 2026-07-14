import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where, orderBy, getDocs, serverTimestamp, Timestamp
} from "./firebase-init.js";
import { EXERCISES, DAYS, EMERGENCIA, DAILY_TASK, EQUIPO_LATERALES, CARDIO_TIPOS } from "./exercises-data.js";

const app = document.getElementById("app");
const UNIT_OPTIONS = ["kg", "lb", "Barras"];
const SENS_OPTIONS = ["Normal", "Fácil", "Pesado", "No completé"];
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
function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtDate(d) { return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }); }
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
      sets: ex.sets, equipo: ex.equipo || null, unidad: ex.unidad || null, date: serverTimestamp()
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
  const lastData = opts.lastData;
  const draft = opts.draft;
  const onChange = opts.onChange || (() => {});

  const block = document.createElement("div");
  block.className = "exercise-block";
  block.innerHTML = `
    <div class="exercise-header">${dayLabel}</div>
    <div class="exercise-name">${ex.nombre}</div>
    <button class="toggle-btn" type="button">Ver cómo se hace &#9662;</button>
    <div class="toggle-content" style="display:none;">
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
    </div>
  `;

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
      if (!touched[i]) {
        touched[i] = true;
        inputRow.classList.remove("prefilled");
        inputRow.classList.add("touched");
      }
      onChange();
    }
    inputRow.querySelectorAll("input,select").forEach((el) => {
      el.addEventListener("input", markTouched);
      el.addEventListener("change", markTouched);
    });

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

  block._getData = () => ({
    exerciseId: opts.storageId || exerciseId,
    nombre: ex.nombre + (opts.nameSuffix || ""),
    equipo: equipoSelect ? equipoSelect.value : undefined,
    unidad: unitSelect.value,
    sets: inputs.map((row, i) => row ? {
      label: sets[i].label,
      peso: row.querySelector('[data-field="peso"]').value || null,
      repsLentas: row.querySelector('[data-field="repsLentas"]').value || null,
      repsNormales: row.querySelector('[data-field="repsNormales"]').value || null,
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
    <button class="timer-btn idle" id="timer-btn">Iniciar entrenamiento</button>
  `;
  app.appendChild(top);
  top.querySelector("#back-btn").onclick = renderHome;
  const timerBtn = top.querySelector("#timer-btn");
  timerBtn.onclick = () => {
    if (sessionStartTime) return;
    sessionStartTime = draftData && draftData.startedAt ? draftData.startedAt : Date.now();
    timerBtn.classList.remove("idle");
    timerInterval = setInterval(() => {
      timerBtn.textContent = fmtElapsed(Date.now() - sessionStartTime);
    }, 1000);
    timerBtn.textContent = fmtElapsed(Date.now() - sessionStartTime);
  };
  if (draftData && draftData.startedAt) timerBtn.onclick();

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
  } else {
    exList = DAYS[dayId].exercises;
    label = "Día " + dayId.slice(-1) + " - " + DAYS[dayId].nombre;
  }

  const allIds = exList.map((e) => e.id).concat(isEmergency ? [] : [DAILY_TASK.storageId]);
  const lastDataMap = await loadLastData(allIds);

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
      savedAt: Date.now()
    };
    try { localStorage.setItem(draftKey, JSON.stringify(data)); } catch (e) {}
  }

  function draftFor(exerciseId) {
    return draftData && draftData.exercises ? draftData.exercises.find((x) => x.exerciseId === exerciseId) : null;
  }

  exList.forEach((e) => {
    const b = buildExerciseBlock(e.id, e.sets, label, { lastData: lastDataMap[e.id], draft: draftFor(e.id), onChange: persistDraft });
    blocks.push(b);
    app.appendChild(b);
  });

  if (!isEmergency) {
    const taskBlock = buildExerciseBlock(DAILY_TASK.id, DAILY_TASK.sets, "Tarea diaria (pompeo)", {
      equipmentOptions: EQUIPO_LATERALES,
      lastData: lastDataMap[DAILY_TASK.storageId],
      draft: draftFor(DAILY_TASK.storageId),
      onChange: persistDraft,
      storageId: DAILY_TASK.storageId,
      nameSuffix: " (tarea diaria)"
    });
    blocks.push(taskBlock);
    app.appendChild(taskBlock);
  }

  if (!isEmergency) {
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
    `;
    app.appendChild(cardioBlock);
    const cardioTipoSel = cardioBlock.querySelector("#cardio-tipo");
    const ciclosRow = cardioBlock.querySelector("#cardio-ciclos-row");
    cardioTipoSel.addEventListener("change", () => {
      ciclosRow.style.display = cardioTipoSel.value === "Tabata" ? "flex" : "none";
      persistDraft();
    });
    cardioBlock.querySelector("#cardio-min").addEventListener("input", persistDraft);
    cardioBlock.querySelector("#cardio-ciclos").addEventListener("input", persistDraft);
  }

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
      const ciclos = tipo === "Tabata" ? app.querySelector("#cardio-ciclos")?.value : null;
      if (min) entry.cardio = { minutos: min, tipo, ciclos };
    }

    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000));
    try {
      await Promise.race([
        (async () => {
          await addDoc(collection(db, "users", currentUser.uid, "logs"), entry);
          await saveLastData(exercisesData);
          if (dayId !== "emergencia") await markComplete(dayId);
          if (dayId === "emergencia") await markComplete("emergencia_" + isoDate(new Date()));
        })(),
        timeoutPromise
      ]);
      if (timerInterval) clearInterval(timerInterval);
      try { localStorage.removeItem(draftKey); } catch (e) {}
      renderHome();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar sesión";
      saveErrorEl.textContent = "No se pudo guardar (revisa tu conexión a internet). Tus datos siguen aquí, intenta de nuevo en unos segundos.";
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
