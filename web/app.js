// ============================================================
//  TLC RIEGO HIDRÁULICO — app.js  v1.0
//  Motor de lógica, estado global y comunicación ESP32
// ============================================================

"use strict";

// ─── CONSTANTES ──────────────────────────────────────────────
const STORAGE_KEY   = "TLC_RIEGO_MULTI_DATA";
const ESP32_URL     = "";          // Vacío → usa misma IP (útil en LittleFS)
const POLL_INTERVAL = 2000;        // ms entre polling de estado al ESP32

// ─── ESTADO GLOBAL ───────────────────────────────────────────
let TLC = {
  // Persistido en localStorage
  programas: [],
  timeoutTanqueConfigurado: 5,     // minutos
  tiempoManualGlobalConfigurado: 10,
  ajusteEstacionalTLC: 100,        // porcentaje

  // Estado en tiempo real (NO persistido)
  hw: {
    flotante:  "OK",          // "OK" | "DEMANDA"
    valvula:   "CERRADA",     // "CERRADA" | "ABIERTA"
    bomba:     "OFF",         // "OFF" | "RUNNING"
  },
  modo:          "STANDBY",   // "STANDBY" | "MANUAL" | "LLENANDO" | "PAUSA_TANQUE"
  zonaActiva:    null,        // 1-8 o null
  zonaAnterior:  null,        // para retorno tras llenado
  timerRestante: 0,           // segundos
  timerTotal:    0,
  tanqueTimer:   0,           // segundos llenando tanque

  // Handles internos
  _cicloInterval:  null,
  _tanqueInterval: null,
  _pollInterval:   null,
};

// ─── PERSISTENCIA ─────────────────────────────────────────────
function guardarEstado() {
  const datos = {
    programas:                    TLC.programas,
    timeoutTanqueConfigurado:     TLC.timeoutTanqueConfigurado,
    tiempoManualGlobalConfigurado: TLC.tiempoManualGlobalConfigurado,
    ajusteEstacionalTLC:          TLC.ajusteEstacionalTLC,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(datos)); } catch(e) {}
}

function recuperarEstado() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const datos = JSON.parse(raw);
    if (datos.programas !== undefined)                    TLC.programas                    = datos.programas;
    if (datos.timeoutTanqueConfigurado !== undefined)     TLC.timeoutTanqueConfigurado     = datos.timeoutTanqueConfigurado;
    if (datos.tiempoManualGlobalConfigurado !== undefined) TLC.tiempoManualGlobalConfigurado = datos.tiempoManualGlobalConfigurado;
    if (datos.ajusteEstacionalTLC !== undefined)          TLC.ajusteEstacionalTLC          = datos.ajusteEstacionalTLC;
  } catch(e) {}
}

// ─── COMUNICACIÓN ESP32 ───────────────────────────────────────
async function enviarComando(endpoint, payload = {}) {
  try {
    const url  = ESP32_URL + endpoint;
    const resp = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } catch(e) {
    console.warn("[TLC] enviarComando falló:", endpoint, e.message);
    return null;
  }
}

async function sincronizarFlash() {
  const payload = {
    programas:            TLC.programas,
    timeoutTanque:        TLC.timeoutTanqueConfigurado,
    tiempoManual:         TLC.tiempoManualGlobalConfigurado,
    ajusteEstacional:     TLC.ajusteEstacionalTLC,
  };
  const ok = await enviarComando("/api/sync", payload);
  mostrarToast(ok ? "✅ Sincronización exitosa" : "❌ Error de comunicación", ok ? "success" : "error");
}

async function pollEstadoHW() {
  try {
    const resp = await fetch(ESP32_URL + "/api/status");
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.flotante !== undefined)  TLC.hw.flotante = data.flotante;
    if (data.valvula  !== undefined)  TLC.hw.valvula  = data.valvula;
    if (data.bomba    !== undefined)  TLC.hw.bomba    = data.bomba;
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  } catch(e) {/* ESP32 no responde — modo offline */}
}

// ─── CONTROL DE ZONAS MANUAL ──────────────────────────────────
function activarZonaManual(zona) {
  detenerCiclo();
  TLC.modo       = "MANUAL";
  TLC.zonaActiva = zona;
  TLC.timerTotal    = TLC.tiempoManualGlobalConfigurado * 60;
  TLC.timerRestante = TLC.timerTotal;
  TLC.hw.valvula = "CERRADA";
  TLC.hw.bomba   = "RUNNING";
  enviarComando("/api/zona", { zona, accion: "ABRIR" });
  enviarComando("/api/bomba", { accion: "ON" });
  iniciarCicloTimer();
  if (typeof renderMonitor === "function") renderMonitor();
}

function detenerCiclo(silencioso = false) {
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval  = null;
  if (!silencioso) {
    TLC.modo         = "STANDBY";
    TLC.zonaActiva   = null;
    TLC.timerRestante = 0;
    TLC.hw.bomba     = "OFF";
    TLC.hw.valvula   = "CERRADA";
    enviarComando("/api/bomba", { accion: "OFF" });
    enviarComando("/api/zonas", { accion: "CERRAR_TODAS" });
    if (typeof renderMonitor === "function") renderMonitor();
  }
}

function iniciarCicloTimer() {
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval = setInterval(() => {
    if (TLC.timerRestante <= 0) {
      detenerCiclo();
      return;
    }
    // Chequeo de flotante: si demanda agua durante riego
    if (TLC.hw.flotante === "DEMANDA" && TLC.modo !== "LLENANDO" && TLC.modo !== "STANDBY") {
      iniciarLlenadoTanque(true);
      return;
    }
    TLC.timerRestante--;
    if (typeof actualizarTimerUI === "function") actualizarTimerUI();
  }, 1000);
}

// ─── CONTROL DE LLENADO DE TANQUE ────────────────────────────
function iniciarLlenadoTanque(esRetorno = false) {
  if (esRetorno) {
    TLC.zonaAnterior = TLC.zonaActiva;
    clearInterval(TLC._cicloInterval);
  }
  TLC.modo     = "LLENANDO";
  TLC.hw.bomba = "OFF";

  // Secuencia: cerrar zonas → esperar 500ms → abrir válvula → esperar 500ms → arrancar bomba
  enviarComando("/api/zonas", { accion: "CERRAR_TODAS" });
  enviarComando("/api/bomba", { accion: "OFF" });

  setTimeout(() => {
    TLC.hw.valvula = "ABIERTA";
    enviarComando("/api/valvula", { accion: "ABRIR" });
    setTimeout(() => {
      TLC.hw.bomba = "RUNNING";
      enviarComando("/api/bomba", { accion: "ON" });
      TLC.tanqueTimer = 0;
      iniciarTanqueTimer();
      if (typeof renderMonitor === "function") renderMonitor();
    }, 500);
  }, 500);
}

function iniciarTanqueTimer() {
  clearInterval(TLC._tanqueInterval);
  TLC._tanqueInterval = setInterval(() => {
    TLC.tanqueTimer++;

    // Flotante se satura: tanque lleno
    if (TLC.hw.flotante === "OK") {
      detenerLlenado(true);
      return;
    }
    // Time-out de seguridad
    if (TLC.tanqueTimer >= TLC.timeoutTanqueConfigurado * 60) {
      detenerLlenado(false);
      mostrarToast("⚠️ TIME-OUT TANQUE: Falla crítica. Sistema detenido.", "error");
    }
  }, 1000);
}

function detenerLlenado(retornar) {
  clearInterval(TLC._tanqueInterval);
  TLC._tanqueInterval = null;
  TLC.hw.bomba   = "OFF";
  TLC.hw.valvula = "CERRADA";
  enviarComando("/api/bomba",    { accion: "OFF" });
  enviarComando("/api/valvula",  { accion: "CERRAR" });

  if (retornar && TLC.zonaAnterior !== null) {
    // Retorno seguro a la zona anterior
    setTimeout(() => {
      const zona = TLC.zonaAnterior;
      TLC.zonaAnterior = null;
      TLC.modo         = "MANUAL";
      TLC.zonaActiva   = zona;
      TLC.hw.bomba     = "RUNNING";
      enviarComando("/api/zona",  { zona, accion: "ABRIR" });
      enviarComando("/api/bomba", { accion: "ON" });
      iniciarCicloTimer();
      if (typeof renderMonitor === "function") renderMonitor();
    }, 500);
  } else {
    TLC.modo       = "STANDBY";
    TLC.zonaActiva = null;
    if (typeof renderMonitor === "function") renderMonitor();
  }
}

// ─── SIMULAR FLOTANTE (PRUEBA) ────────────────────────────────
function simularFlotante() {
  TLC.hw.flotante = TLC.hw.flotante === "OK" ? "DEMANDA" : "OK";
  enviarComando("/api/flotante/sim", { estado: TLC.hw.flotante });
  if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  mostrarToast(
    TLC.hw.flotante === "DEMANDA"
      ? "⚠️ Flotante simulado: DEMANDA DE AGUA"
      : "✅ Flotante simulado: TANQUE OK",
    TLC.hw.flotante === "DEMANDA" ? "warning" : "success"
  );
}

// ─── FORZAR LLENADO MANUAL ───────────────────────────────────
function forzarLlenadoManual() {
  if (TLC.modo === "LLENANDO") {
    mostrarToast("El sistema ya está llenando el tanque.", "warning");
    return;
  }
  TLC.zonaAnterior = TLC.zonaActiva;
  iniciarLlenadoTanque(false);
}

// ─── EJECUTAR PROGRAMA ────────────────────────────────────────
function ejecutarPrograma(idxPrograma) {
  const prog = TLC.programas[idxPrograma];
  if (!prog) return;
  detenerCiclo(true);
  // Lanzar primera zona del programa
  const primeraZona = prog.zonas.findIndex(z => z.minutos > 0);
  if (primeraZona === -1) { mostrarToast("El programa no tiene zonas configuradas.", "warning"); return; }
  const minutosFinales = Math.round(prog.zonas[primeraZona].minutos * (TLC.ajusteEstacionalTLC / 100));
  TLC.modo         = "MANUAL";
  TLC.zonaActiva   = primeraZona + 1;
  TLC.timerTotal    = minutosFinales * 60;
  TLC.timerRestante = TLC.timerTotal;
  TLC.hw.bomba     = "RUNNING";
  TLC.hw.valvula   = "CERRADA";
  enviarComando("/api/zona",  { zona: primeraZona + 1, accion: "ABRIR" });
  enviarComando("/api/bomba", { accion: "ON" });
  iniciarCicloTimer();
  if (typeof renderMonitor === "function") renderMonitor();
  mostrarToast("▶️ Programa '" + prog.nombre + "' iniciado.", "success");
}

// ─── PROGRAMAS: CRUD ──────────────────────────────────────────
function agregarPrograma(nombre, horainicio, dias, zonaMinutos) {
  TLC.programas.push({
    nombre,
    horaInicio: horainicio,
    dias,
    zonas: zonaMinutos.map((m, i) => ({ zona: i + 1, minutos: m })),
  });
  guardarEstado();
}

function borrarPrograma(idx) {
  TLC.programas.splice(idx, 1);
  guardarEstado();
}

function minutosConAjuste(minutos) {
  return Math.round(minutos * (TLC.ajusteEstacionalTLC / 100));
}

// ─── UTILIDADES UI ────────────────────────────────────────────
function formatSegundos(seg) {
  const m = Math.floor(seg / 60).toString().padStart(2, "0");
  const s = (seg % 60).toString().padStart(2, "0");
  return m + ":" + s;
}

function mostrarToast(msg, tipo = "info") {
  const el = document.getElementById("tlc-toast");
  if (!el) return;
  el.textContent = msg;
  el.className   = "tlc-toast tlc-toast--" + tipo + " tlc-toast--visible";
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.className = "tlc-toast"; }, 3500);
}

// ─── BOOTSTRAP ────────────────────────────────────────────────
function inicializarApp() {
  recuperarEstado();

  // Seed de programas demo si está vacío
  if (TLC.programas.length === 0) {
    TLC.programas = [
      {
        nombre:     "Mañana",
        horaInicio: "07:00",
        dias:       ["Lun","Mié","Vie"],
        zonas:      [1,2,3,4,5,6,7,8].map((z, i) => ({ zona: z, minutos: [8,6,5,5,4,4,3,3][i] })),
      },
      {
        nombre:     "Tarde",
        horaInicio: "19:30",
        dias:       ["Mar","Jue","Sáb"],
        zonas:      [1,2,3,4,5,6,7,8].map((z, i) => ({ zona: z, minutos: [10,8,6,6,5,5,4,4][i] })),
      },
    ];
    guardarEstado();
  }

  // Polling de HW
  pollEstadoHW();
  TLC._pollInterval = setInterval(pollEstadoHW, POLL_INTERVAL);
}
