// ============================================================
//  TLC RIEGO HIDRÁULICO — app.js  v1.1
//  Motor de lógica, estado global y comunicación ESP32
//  v1.1: Mock offline automático — funciona sin ESP32 conectado
// ============================================================

"use strict";

// ─── CONSTANTES ──────────────────────────────────────────────
const STORAGE_KEY   = "TLC_RIEGO_MULTI_DATA";
const ESP32_URL     = "";          // Vacío → usa misma IP (útil en LittleFS)
const POLL_INTERVAL = 2000;        // ms entre polling de estado al ESP32

// ─── MOCK OFFLINE ─────────────────────────────────────────────
// Cuando el ESP32 no está disponible, todas las llamadas a la red
// son interceptadas y respondidas con el estado interno de TLC.
// Al conectar el ESP32 real, esta capa se bypasea automáticamente.
const MOCK = {
  activo: false,   // se activa en el primer fallo de fetch

  // Simula la respuesta de /api/status reflejando el estado interno
  status() {
    return { flotante: TLC.hw.flotante, valvula: TLC.hw.valvula, bomba: TLC.hw.bomba };
  },

  // Simula comandos: los aplica directamente al estado interno
  comando(endpoint, payload) {
    if (endpoint === "/api/zona")   console.info("[MOCK] Abrir zona", payload.zona);
    if (endpoint === "/api/zonas")  console.info("[MOCK] Cerrar todas las zonas");
    if (endpoint === "/api/bomba")  console.info("[MOCK] Bomba →", payload.accion);
    if (endpoint === "/api/valvula") console.info("[MOCK] Válvula →", payload.accion);
    if (endpoint === "/api/sync")   console.info("[MOCK] Sync flash (ignorado en modo offline)");
    return { ok: true, mock: true };
  },
};

// ─── ESTADO GLOBAL ───────────────────────────────────────────
let TLC = {
  // Persistido en localStorage
  programas: [],
  timeoutTanqueConfigurado: 5,
  tiempoManualGlobalConfigurado: 10,
  ajusteEstacionalTLC: 100,

  // Estado en tiempo real (NO persistido)
  hw: {
    flotante: "OK",       // "OK" | "DEMANDA"
    valvula:  "CERRADA",  // "CERRADA" | "ABIERTA"
    bomba:    "OFF",      // "OFF" | "RUNNING"
  },
  modo:          "STANDBY",
  zonaActiva:    null,
  zonaAnterior:  null,
  timerRestante: 0,
  timerTotal:    0,
  tanqueTimer:   0,

  _cicloInterval:  null,
  _tanqueInterval: null,
  _pollInterval:   null,
};

// ─── PERSISTENCIA ─────────────────────────────────────────────
function guardarEstado() {
  const datos = {
    programas:                     TLC.programas,
    timeoutTanqueConfigurado:      TLC.timeoutTanqueConfigurado,
    tiempoManualGlobalConfigurado: TLC.tiempoManualGlobalConfigurado,
    ajusteEstacionalTLC:           TLC.ajusteEstacionalTLC,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(datos)); } catch(e) {}
}

function recuperarEstado() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const datos = JSON.parse(raw);
    if (datos.programas !== undefined)                     TLC.programas                    = datos.programas;
    if (datos.timeoutTanqueConfigurado !== undefined)      TLC.timeoutTanqueConfigurado     = datos.timeoutTanqueConfigurado;
    if (datos.tiempoManualGlobalConfigurado !== undefined) TLC.tiempoManualGlobalConfigurado = datos.tiempoManualGlobalConfigurado;
    if (datos.ajusteEstacionalTLC !== undefined)           TLC.ajusteEstacionalTLC          = datos.ajusteEstacionalTLC;
  } catch(e) {}
}

// ─── COMUNICACIÓN ESP32 (con fallback mock automático) ────────
async function enviarComando(endpoint, payload = {}) {
  // Si ya sabemos que estamos offline, usamos el mock directamente
  if (MOCK.activo) {
    return MOCK.comando(endpoint, payload);
  }
  try {
    const resp = await fetch(ESP32_URL + endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    MOCK.activo = false;  // ESP32 respondió → modo real
    return await resp.json();
  } catch(e) {
    if (!MOCK.activo) {
      MOCK.activo = true;
      console.warn("[TLC] ESP32 no disponible — activando modo OFFLINE/MOCK");
      _mostrarBannerOffline(true);
    }
    return MOCK.comando(endpoint, payload);
  }
}

async function sincronizarFlash() {
  const payload = {
    programas:        TLC.programas,
    timeoutTanque:    TLC.timeoutTanqueConfigurado,
    tiempoManual:     TLC.tiempoManualGlobalConfigurado,
    ajusteEstacional: TLC.ajusteEstacionalTLC,
  };
  const res = await enviarComando("/api/sync", payload);
  if (MOCK.activo) {
    mostrarToast("💾 Guardado local (sin ESP32 conectado)", "warning");
  } else {
    mostrarToast(res ? "✅ Sincronización exitosa" : "❌ Error de comunicación", res ? "success" : "error");
  }
}

async function pollEstadoHW() {
  if (MOCK.activo) {
    // En modo offline los badges reflejan el estado interno directamente
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
    return;
  }
  try {
    const resp = await fetch(ESP32_URL + "/api/status");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (data.flotante !== undefined) TLC.hw.flotante = data.flotante;
    if (data.valvula  !== undefined) TLC.hw.valvula  = data.valvula;
    if (data.bomba    !== undefined) TLC.hw.bomba    = data.bomba;
    MOCK.activo = false;
    _mostrarBannerOffline(false);
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  } catch(e) {
    if (!MOCK.activo) {
      MOCK.activo = true;
      console.warn("[TLC] ESP32 sin respuesta — modo OFFLINE");
      _mostrarBannerOffline(true);
    }
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  }
}

// Banner discreto "OFFLINE — Sin ESP32" en el header
function _mostrarBannerOffline(visible) {
  let el = document.getElementById("tlc-offline-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "tlc-offline-banner";
    el.style.cssText = [
      "position:fixed","top:58px","left:0","right:0","z-index:99",
      "background:#7C3AED","color:#fff","font-size:11px","font-weight:600",
      "letter-spacing:.5px","text-align:center","padding:5px 0",
      "transition:opacity .3s","pointer-events:none",
    ].join(";");
    el.textContent = "⚡ MODO OFFLINE — Debug sin ESP32 conectado";
    document.body.appendChild(el);
  }
  el.style.opacity = visible ? "1" : "0";
}

// ─── CONTROL DE ZONAS MANUAL ──────────────────────────────────
function activarZonaManual(zona) {
  detenerCiclo();
  TLC.modo          = "MANUAL";
  TLC.zonaActiva    = zona;
  TLC.timerTotal    = TLC.tiempoManualGlobalConfigurado * 60;
  TLC.timerRestante = TLC.timerTotal;
  TLC.hw.valvula    = "CERRADA";
  TLC.hw.bomba      = "RUNNING";
  enviarComando("/api/zona",  { zona, accion: "ABRIR" });
  enviarComando("/api/bomba", { accion: "ON" });
  iniciarCicloTimer();
  if (typeof renderMonitor === "function") renderMonitor();
}

function detenerCiclo(silencioso = false) {
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval = null;
  if (!silencioso) {
    TLC.modo          = "STANDBY";
    TLC.zonaActiva    = null;
    TLC.timerRestante = 0;
    TLC.hw.bomba      = "OFF";
    TLC.hw.valvula    = "CERRADA";
    enviarComando("/api/bomba",  { accion: "OFF" });
    enviarComando("/api/zonas",  { accion: "CERRAR_TODAS" });
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
    if (TLC.hw.flotante === "OK") {
      detenerLlenado(true);
      return;
    }
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
  enviarComando("/api/bomba",   { accion: "OFF" });
  enviarComando("/api/valvula", { accion: "CERRAR" });

  if (retornar && TLC.zonaAnterior !== null) {
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
  const primeraZona = prog.zonas.findIndex(z => z.minutos > 0);
  if (primeraZona === -1) { mostrarToast("El programa no tiene zonas configuradas.", "warning"); return; }
  const minutosFinales = Math.round(prog.zonas[primeraZona].minutos * (TLC.ajusteEstacionalTLC / 100));
  TLC.modo          = "MANUAL";
  TLC.zonaActiva    = primeraZona + 1;
  TLC.timerTotal    = minutosFinales * 60;
  TLC.timerRestante = TLC.timerTotal;
  TLC.hw.bomba      = "RUNNING";
  TLC.hw.valvula    = "CERRADA";
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

  pollEstadoHW();
  TLC._pollInterval = setInterval(pollEstadoHW, POLL_INTERVAL);
}
