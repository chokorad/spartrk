export const EXERCISES = {
  tricep_pushdown: { nombre: "Extensión de tríceps trenza", instrucciones: "De pie frente a la polea alta, codos pegados al torso. Extiende los antebrazos hacia abajo hasta estirar por completo, luego regresa controlado.", img: "assets/exercises/tricep_pushdown.gif" },
  overhead_extension: { nombre: "Copa a dos manos", instrucciones: "Sostén una mancuerna con ambas manos por encima de la cabeza. Baja el peso detrás de la nuca doblando los codos, luego extiende los brazos arriba sin abrirlos.", img: "assets/exercises/overhead_extension.gif" },
  preacher_curl: { nombre: "Predicador sentado", instrucciones: "Apoya el brazo sobre el banco predicador. Sube el peso contrayendo el bíceps y baja controlado hasta estirar el brazo por completo.", img: "assets/exercises/preacher_curl.gif" },
  machine_curl: { nombre: "Curl de bíceps máquina individual", instrucciones: "Ajusta el asiento para que el codo quede alineado con el pivote de la máquina. Flexiona el antebrazo llevando el peso arriba y baja controlado.", img: "assets/exercises/machine_curl.gif" },
  hammer_curl: { nombre: "Martillos", instrucciones: "De pie con mancuernas en agarre neutro (palmas mirándose). Flexiona el codo llevando el peso hacia el hombro sin girar la muñeca.", img: "assets/exercises/hammer_curl.gif" },
  leg_extension: { nombre: "Extensión de pierna sentado", instrucciones: "Siéntate con las rodillas a 90°. Extiende las piernas hasta que queden rectas, aprieta el cuádriceps arriba y baja controlado.", img: "assets/exercises/leg_extension.gif" },
  leg_press: { nombre: "Prensa sentado", instrucciones: "Coloca los pies al ancho de hombros en la plataforma. Empuja extendiendo las piernas sin bloquear las rodillas, luego regresa controlado.", img: "assets/exercises/leg_press.gif" },
  lying_leg_curl: { nombre: "Curl femoral tumbado", instrucciones: "Acuéstate boca abajo con el rodillo en los tobillos. Flexiona las rodillas llevando los talones hacia los glúteos y baja controlado.", img: "assets/exercises/lying_leg_curl.gif" },
  hack_squat: { nombre: "Sentadilla hack", instrucciones: "Apoya la espalda en el respaldo, pies al ancho de hombros. Baja flexionando las rodillas hasta 90° y empuja para extender las piernas.", img: "assets/exercises/hack_squat.gif" },
  lat_pulldown: { nombre: "Jalón o frente polea", instrucciones: "Agarre ancho en la barra alta. Jala hacia el pecho llevando los codos hacia abajo y regresa controlado sin balancear el torso.", img: "assets/exercises/lat_pulldown.gif" },
  single_arm_pulldown: { nombre: "Jalón individual con maneral", instrucciones: "Con un solo brazo, jala el maneral desde arriba hacia el hombro y controla la vuelta hasta estirar por completo.", img: "assets/exercises/single_arm_pulldown.gif" },
  seated_row_machine: { nombre: "Remo sentado máquina", instrucciones: "Pecho apoyado en el respaldo. Jala las manijas hacia el torso apretando la espalda, luego extiende los brazos controlado.", img: "assets/exercises/seated_row_machine.gif" },
  cable_row: { nombre: "Remo sentado con polea", instrucciones: "Siéntate con rodillas ligeramente flexionadas. Jala el mango hacia el abdomen enderezando el torso, luego regresa estirando los brazos.", img: "assets/exercises/cable_row.gif" },
  pullover: { nombre: "Pullover", instrucciones: "Acostado en el banco, brazos extendidos detrás de la cabeza. Lleva el peso en arco por encima del pecho sin doblar mucho los codos.", img: "assets/exercises/pullover.gif" },
  machine_chest_press: { nombre: "Press individual máquina", instrucciones: "Espalda apoyada en el asiento. Empuja las manijas hacia adelante hasta extender los brazos y regresa controlado sin bloquear los codos.", img: "assets/exercises/machine_chest_press.gif" },
  cable_crossover: { nombre: "Crossover cables", instrucciones: "De pie entre las poleas altas, ligera inclinación adelante. Junta las manos al frente en arco apretando el pecho, regresa controlado.", img: "assets/exercises/cable_crossover.gif" },
  lateral_raise: { nombre: "Laterales máquina", instrucciones: "Brazos a los costados. Eleva los brazos hasta la altura del hombro manteniendo un ligero doblez en el codo, baja controlado.", img: "assets/exercises/lateral_raise.gif" },
  benchpress: { nombre: "Press de banca plano con barra", instrucciones: "Recuéstate en el banco con agarre un poco más ancho que los hombros. Baja la barra controlada hasta rozar el pecho, luego empuja hacia arriba sin bloquear los codos de golpe.", img: "assets/exercises/benchpress.gif" },
  pushup: { nombre: "Flexiones", instrucciones: "Manos a la altura de los hombros, cuerpo recto de cabeza a talones. Baja el pecho casi hasta el piso doblando los codos, luego empuja para extender los brazos por completo.", img: "assets/exercises/pushup.gif" },
  bench_dips: { nombre: "Fondos de tríceps", instrucciones: "Manos apoyadas en el borde del banco detrás de ti, piernas extendidas al frente. Baja flexionando los codos y empuja para extender los brazos.", img: "assets/exercises/bench_dips.gif" },
  burpees: { nombre: "Burpees con salto", instrucciones: "Baja a posición de plancha, haz una flexión, brinca los pies hacia las manos y salta extendiendo los brazos arriba.", img: "assets/exercises/burpees.gif" },
  bodyweight_squat: { nombre: "Sentadillas sin peso", instrucciones: "Pies al ancho de hombros. Baja flexionando cadera y rodillas como si te sentaras, manteniendo la espalda recta, luego sube.", img: "assets/exercises/bodyweight_squat.gif" },
  crunches: { nombre: "Abdominales", instrucciones: "Acostado boca arriba, rodillas flexionadas. Sube el torso contrayendo el abdomen sin jalar el cuello, baja controlado.", img: "assets/exercises/crunches.gif" },
  warmup_stretch: { nombre: "Estiramiento y calentamiento", instrucciones: "5 minutos de movilidad ligera: rotaciones de hombro, cadera y tobillo, más estiramientos dinámicos antes de empezar.", img: "assets/exercises/warmup_stretch.png" }
};

export const ASCENDING_SETS = [
  { reps: 15, pct: 70, label: "Serie 1 · 70% · 15 reps" },
  { reps: 12, pct: 80, label: "Serie 2 · 80% · 12 reps" },
  { reps: 10, pct: 90, label: "Serie 3 · 90% · 10 reps" },
  { reps: 6, pct: 100, label: "Serie 4 · efectiva · máx 6 reps" }
];

export const DAYS = {
  dia1: { id: "dia1", nombre: "Brazo", exercises: ["tricep_pushdown", "overhead_extension", "preacher_curl", "machine_curl", "hammer_curl"].map(id => ({ id, sets: ASCENDING_SETS })) },
  dia2: { id: "dia2", nombre: "Pierna", exercises: ["leg_extension", "leg_press", "lying_leg_curl", "hack_squat"].map(id => ({ id, sets: ASCENDING_SETS })) },
  dia3: { id: "dia3", nombre: "Espalda", exercises: ["lat_pulldown", "single_arm_pulldown", "seated_row_machine", "cable_row", "pullover"].map(id => ({ id, sets: ASCENDING_SETS })) },
  dia4: { id: "dia4", nombre: "Pecho", exercises: ["benchpress", "machine_chest_press", "cable_crossover", "lateral_raise"].map(id => ({ id, sets: ASCENDING_SETS })) }
};

export const EMERGENCIA = {
  id: "emergencia",
  nombre: "Entrenamiento de emergencia",
  exercises: [
    { id: "warmup_stretch", sets: [{ label: "5 minutos de movilidad", reps: null, pct: null, noInput: true }] },
    { id: "pushup", sets: [1, 2, 3, 4].map(n => ({ label: `Serie ${n} · 15 reps`, reps: 15, pct: null })) },
    { id: "bench_dips", sets: [1, 2, 3, 4].map(n => ({ label: `Serie ${n} · 12 a 15 reps`, reps: 15, pct: null })) },
    { id: "burpees", sets: [1, 2, 3, 4].map(n => ({ label: `Serie ${n} · 20 reps`, reps: 20, pct: null })) },
    { id: "bodyweight_squat", sets: [1, 2, 3].map(n => ({ label: `Serie ${n} · 50 reps`, reps: 50, pct: null })) },
    { id: "crunches", sets: [1, 2, 3, 4].map(n => ({ label: `Serie ${n} · 15 a 20 reps`, reps: 20, pct: null })) }
  ]
};

export const DAILY_TASK = { id: "lateral_raise", storageId: "lateral_raise_daily", sets: [{ label: "1 serie", reps: 15, pct: null }] };

export const EQUIPO_LATERALES = ["Máquina", "Mancuernas", "Cable"];
export const CARDIO_TIPOS = ["Elíptica", "Tabata", "Caminadora", "Aire libre"];

export function estimateMinutes(sets) {
  const real = sets.filter((s) => !s.noInput);
  if (real.length === 0) return 5;
  return Math.max(1, Math.round(real.length * 1.5));
}
export const DAILY_TASK_TIME_MIN = 1;
export const CARDIO_TIME_MIN = 20;
