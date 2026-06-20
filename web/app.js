// ============================================================
//  TLC RIEGO HIDRÁULICO — app.js  v2.13
//  Motor de lógica, estado global y comunicación ESP32
//  v1.1: Mock offline automático
//  v1.2: Toggle zona manual, prioridad absoluta flotante
//  v1.3: Banner consola, vigencia programas, bloqueo llenado, sliders +/-
//  v2.0: Firebase Realtime DB — sincronización multi-dispositivo
//  v2.1: Timer exacto preservado al interrumpir por llenado de tanque
//  v2.2: Fix zona queda activa al terminar timer — push Firebase + render forzado
//  v2.3: Fix zona enganchada multi-dispositivo — Firebase null→0, STANDBY forzado
//  v2.4: Pausar/Reanudar/Detener programa, zona parpadeante sin acción
//  v2.5: Fix zona manual anula programa pausado, fix doble click pausar
//  v2.6: Preservar estado pausa al interrumpir por llenado de tanque
//  v2.7: Motor secuencia multi-zona con sentinel anti-loop
//  v2.8: Timer timeout tanque, push notifications, sensor lluvia, bloqueo programas
//  v2.9: Fix multi-zona cuelgue, Firebase sync programaActivo/pausado, fix Ejecutar
//  v2.10: Firebase fuente de verdad para config — _aplicarConfigUI en todos los dispositivos
//  v2.11: Fix pausa no detiene timer, barra progreso por zona, botón lluvia industrial
//  v2.12: Sensor lluvia persistido en /tlc/config + /tlc/estado, botón lluvia rojo industrial
// ============================================================

"use strict";

// ─── VERSIÓN ─────────────────────────────────────────────────
const APP_VERSION = { app: "v2.18", monitor: "v2.18", config: "v2.18" };

(function _bannerConsola() {
  console.log("%c TLC Riego Hidráulico ", "background:#0066CC;color:#fff;font-weight:700;font-size:13px;border-radius:4px;padding:3px 10px");
  console.log("%c app.js " + APP_VERSION.app + " | Firebase Realtime DB | Multi-dispositivo",
    "color:#38B6FF;font-family:monospace;font-size:11px");
})();

// ─── FIREBASE CONFIG ─────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAWeVn69SOOIJ8RWCYLv1ZrxtuA8ux5ME0",
  authDomain:        "riego-tlc.firebaseapp.com",
  databaseURL:       "https://riego-tlc-default-rtdb.firebaseio.com",
  projectId:         "riego-tlc",
  storageBucket:     "riego-tlc.firebasestorage.app",
  messagingSenderId: "316509875198",
  appId:             "1:316509875198:web:7c85510636cbcd7cc06eaf"
};

// Rutas en Firebase
const FB_PATH_ESTADO    = "tlc/estado";      // estado en tiempo real (hw, modo, zonaActiva, timer)
const FB_PATH_CONFIG    = "tlc/config";      // programas, ajuste estacional, timeouts
const ESP32_URL         = "";                // cuando llegue el ESP32, poner su IP
const POLL_INTERVAL_HW  = 2000;             // polling al ESP32 (ms)

// ─── REFERENCIAS FIREBASE ────────────────────────────────────
let _db        = null;   // instancia de Firebase Database
let _refEstado = null;   // referencia al nodo estado
let _refConfig = null;   // referencia al nodo config

// ─── ESTADO GLOBAL ───────────────────────────────────────────
let TLC = {
  // Configuración (persistida en Firebase/config)
  programas:                     [],
  timeoutTanqueConfigurado:      5,
  tiempoManualGlobalConfigurado: 10,
  ajusteEstacionalTLC:           100,

  // Estado en tiempo real (sincronizado en Firebase/estado)
  hw: {
    flotante: "OK",       // "OK" | "DEMANDA"
    valvula:  "CERRADA",  // "CERRADA" | "ABIERTA"
    bomba:    "OFF",      // "OFF" | "RUNNING"
  },
  modo:          "STANDBY",
  zonaActiva:    null,
  zonaAnterior:  null,
  timerAnterior:  0,
  totalAnterior:  0,
  pausadoAnterior: false,
  programaActivo: null,
  pausado:        false,
  zonaProgIdx:    0,
  timerRestante: 0,
  timerTotal:    0,
  tanqueTimer:   0,
  sensorLluvia:  false,   // true = inhibe todo el riego (tanque sigue operativo)

  // Internos (no sincronizados)
  _cicloInterval:  null,
  _tanqueInterval: null,
  _pollInterval:   null,
  _fbEscuchando:   false,
  _ignorarPush:    false,   // evita loop al recibir nuestro propio push
};

// ─── INICIALIZAR FIREBASE ────────────────────────────────────
function _iniciarFirebase() {
  try {
    // Importar Firebase via CDN (cargado en el HTML)
    const app  = firebase.initializeApp(FIREBASE_CONFIG);
    _db        = firebase.database(app);
    _refEstado = _db.ref(FB_PATH_ESTADO);
    _refConfig = _db.ref(FB_PATH_CONFIG);
    console.log("[TLC] Firebase conectado ✅");
    return true;
  } catch(e) {
    console.warn("[TLC] Firebase no disponible:", e.message);
    return false;
  }
}

// ─── ESCUCHAR CAMBIOS EN TIEMPO REAL (Firebase → UI) ─────────
function _escucharFirebase() {
  if (!_refEstado || TLC._fbEscuchando) return;
  TLC._fbEscuchando = true;

  // Estado en tiempo real — push de cualquier dispositivo
  _refEstado.on("value", (snap) => {
    const data = snap.val();
    if (!data) return;
    if (TLC._ignorarPush) { TLC._ignorarPush = false; return; }

    // Aplicar estado recibido al TLC local
    if (data.hw) {
      if (data.hw.flotante !== undefined) TLC.hw.flotante = data.hw.flotante;
      if (data.hw.valvula  !== undefined) TLC.hw.valvula  = data.hw.valvula;
      if (data.hw.bomba    !== undefined) TLC.hw.bomba    = data.hw.bomba;
    }
    if (data.modo         !== undefined) TLC.modo         = data.modo;
    // Firebase borra nodos con valor null — si llegó STANDBY forzar zonaActiva a null
    if (data.modo === "STANDBY") {
      TLC.zonaActiva    = null;
      TLC.timerRestante = 0;
      TLC.timerTotal    = 0;
    } else {
      // zonaActiva 0 significa "sin zona" (Firebase no guarda null)
      if (data.zonaActiva    !== undefined) TLC.zonaActiva    = data.zonaActiva || null;
      if (data.timerRestante !== undefined) TLC.timerRestante = data.timerRestante;
      if (data.timerTotal    !== undefined) TLC.timerTotal    = data.timerTotal;
    }

    if (data.sensorLluvia !== undefined) TLC.sensorLluvia = data.sensorLluvia;
    // -1 significa sin programa activo
    if (data.programaActivo !== undefined) TLC.programaActivo = data.programaActivo === -1 ? null : data.programaActivo;
    if (data.pausado        !== undefined) TLC.pausado        = data.pausado;

    // Refrescar UI
    if (typeof actualizarHWBadges     === "function") actualizarHWBadges();
    if (typeof actualizarTimerUI      === "function") actualizarTimerUI();
    if (typeof actualizarStatusBanner === "function") actualizarStatusBanner();
    if (typeof actualizarBtnLluvia    === "function") actualizarBtnLluvia();
    if (typeof renderZonas            === "function") renderZonas();
    if (typeof renderProgramas        === "function") renderProgramas();

    // Si llegó un modo LLENANDO desde otro dispositivo, arrancar timer local
    if (data.modo === "LLENANDO" && !TLC._tanqueInterval) {
      TLC.tanqueTimer = data.tanqueTimer || 0;
      iniciarTanqueTimer();
    }
    // Si llegó MANUAL desde otro dispositivo, arrancar ciclo local (solo si no está pausado)
    if (data.modo === "MANUAL" && !TLC._cicloInterval && data.timerRestante > 0 && !TLC.pausado) {
      iniciarCicloTimer();
    }
    // Si llegó PAUSADO desde Firebase, detener ciclo local
    if (data.pausado === true && TLC._cicloInterval) {
      clearInterval(TLC._cicloInterval);
      TLC._cicloInterval = null;
    }
    // Si llegó STANDBY, detener timers locales
    if (data.modo === "STANDBY") {
      clearInterval(TLC._cicloInterval);  TLC._cicloInterval  = null;
      clearInterval(TLC._tanqueInterval); TLC._tanqueInterval = null;
    }

    _chequearFlotante();
  });

  // Configuración — sincronizar programas entre dispositivos
  _refConfig.on("value", (snap) => {
    const data = snap.val();
    if (!data) return;
    if (data.programas                     !== undefined) TLC.programas                    = data.programas;
    if (data.timeoutTanqueConfigurado      !== undefined) TLC.timeoutTanqueConfigurado     = data.timeoutTanqueConfigurado;
    if (data.tiempoManualGlobalConfigurado !== undefined) TLC.tiempoManualGlobalConfigurado = data.tiempoManualGlobalConfigurado;
    if (data.ajusteEstacionalTLC           !== undefined) TLC.ajusteEstacionalTLC          = data.ajusteEstacionalTLC;
    if (data.sensorLluvia                  !== undefined) TLC.sensorLluvia                 = data.sensorLluvia;
    // Actualizar localStorage con los valores de Firebase (fuente de verdad)
    guardarEstado();
    // Notificar a la UI que la config cambió
    if (typeof _aplicarConfigUI  === "function") _aplicarConfigUI();
    if (typeof renderProgramas   === "function") renderProgramas();
    if (typeof renderProgList    === "function") renderProgList();
    if (typeof renderEstacionalChips === "function") renderEstacionalChips();
  });
}

// ─── PUBLICAR ESTADO EN FIREBASE (UI → todos los dispositivos) ─
function _pushEstado() {
  if (!_refEstado) return;
  TLC._ignorarPush = true;
  _refEstado.set({
    hw:             { flotante: TLC.hw.flotante, valvula: TLC.hw.valvula, bomba: TLC.hw.bomba },
    modo:           TLC.modo,
    zonaActiva:     TLC.zonaActiva    || 0,
    timerRestante:  TLC.timerRestante > 0 ? TLC.timerRestante : 0,
    timerTotal:     TLC.timerTotal    || 0,
    tanqueTimer:    TLC.tanqueTimer   || 0,
    sensorLluvia:   TLC.sensorLluvia  || false,
    programaActivo: TLC.programaActivo !== null ? TLC.programaActivo : -1,  // -1 = sin programa
    pausado:        TLC.pausado       || false,
    ts:             Date.now(),
  }).catch(e => console.warn("[TLC] Firebase push error:", e.message));
}

// ─── SENSOR DE LLUVIA ─────────────────────────────────────────
function toggleSensorLluvia() {
  TLC.sensorLluvia = !TLC.sensorLluvia;
  _pushEstado();      // → /tlc/estado  (tiempo real)
  guardarEstado();    // → /tlc/config  (persistente)
  if (TLC.sensorLluvia) {
    if (TLC.modo === "MANUAL") detenerCiclo();
    mostrarToast("🌧 Sensor lluvia ACTIVO — riego inhibido", "warning");
    _enviarNotificacion("🌧 Sensor de Lluvia", "Riego inhibido por lluvia. El tanque sigue operativo.");
  } else {
    mostrarToast("☀️ Sensor lluvia desactivado — riego habilitado", "success");
    _enviarNotificacion("☀️ Sensor de Lluvia", "Riego habilitado nuevamente.");
  }
  if (typeof renderMonitor      === "function") renderMonitor();
  if (typeof actualizarHWBadges === "function") actualizarHWBadges();
}

// ─── GUARDAR CONFIG EN FIREBASE ───────────────────────────────
function guardarEstado() {
  const datos = {
    programas:                     TLC.programas,
    timeoutTanqueConfigurado:      TLC.timeoutTanqueConfigurado,
    tiempoManualGlobalConfigurado: TLC.tiempoManualGlobalConfigurado,
    ajusteEstacionalTLC:           TLC.ajusteEstacionalTLC,
    sensorLluvia:                  TLC.sensorLluvia,   // ← persistir en config
  };
  // localStorage como backup offline
  try { localStorage.setItem("TLC_RIEGO_MULTI_DATA", JSON.stringify(datos)); } catch(e) {}
  // Firebase como fuente de verdad
  if (_refConfig) {
    _refConfig.set(datos).catch(e => console.warn("[TLC] Firebase config error:", e.message));
  }
}

function recuperarEstadoLocal() {
  try {
    const raw = localStorage.getItem("TLC_RIEGO_MULTI_DATA");
    if (!raw) return;
    const datos = JSON.parse(raw);
    if (datos.programas                     !== undefined) TLC.programas                    = datos.programas;
    if (datos.timeoutTanqueConfigurado      !== undefined) TLC.timeoutTanqueConfigurado     = datos.timeoutTanqueConfigurado;
    if (datos.tiempoManualGlobalConfigurado !== undefined) TLC.tiempoManualGlobalConfigurado = datos.tiempoManualGlobalConfigurado;
    if (datos.ajusteEstacionalTLC           !== undefined) TLC.ajusteEstacionalTLC          = datos.ajusteEstacionalTLC;
  } catch(e) {}
}

// ─── COMUNICACIÓN ESP32 ───────────────────────────────────────
const MOCK = {
  activo: false,
  status() { return { flotante: TLC.hw.flotante, valvula: TLC.hw.valvula, bomba: TLC.hw.bomba }; },
  comando(endpoint, payload) {
    console.info("[MOCK ESP32]", endpoint, payload);
    return { ok: true, mock: true };
  },
};

async function enviarComando(endpoint, payload = {}) {
  if (MOCK.activo || !ESP32_URL) {
    if (!MOCK.activo && !ESP32_URL) {
      MOCK.activo = true;
      _mostrarBannerOffline(true);
    }
    return MOCK.comando(endpoint, payload);
  }
  try {
    const resp = await fetch(ESP32_URL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    MOCK.activo = false;
    _mostrarBannerOffline(false);
    return await resp.json();
  } catch(e) {
    if (!MOCK.activo) { MOCK.activo = true; _mostrarBannerOffline(true); }
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
  guardarEstado();
  if (MOCK.activo || !ESP32_URL) {
    mostrarToast("💾 Config guardada en Firebase (sin ESP32)", "warning");
  } else {
    const res = await enviarComando("/api/sync", payload);
    mostrarToast(res ? "✅ Sincronización exitosa con ESP32" : "❌ Error de comunicación", res ? "success" : "error");
  }
}

async function pollEstadoHW() {
  if (MOCK.activo || !ESP32_URL) {
    _chequearFlotante();
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
    _chequearFlotante();
    _pushEstado();
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  } catch(e) {
    if (!MOCK.activo) { MOCK.activo = true; _mostrarBannerOffline(true); }
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  }
}

function _mostrarBannerOffline(visible) {
  let el = document.getElementById("tlc-offline-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "tlc-offline-banner";
    el.style.cssText = "position:fixed;top:58px;left:0;right:0;z-index:99;background:#7C3AED;color:#fff;font-size:11px;font-weight:600;letter-spacing:.5px;text-align:center;padding:5px 0;transition:opacity .3s;pointer-events:none;";
    el.textContent = "⚡ MODO OFFLINE — Debug sin ESP32 · Firebase activo";
    document.body.appendChild(el);
  }
  el.style.opacity = visible ? "1" : "0";
}

// ─── NOTIFICACIONES PUSH ─────────────────────────────────────
function _solicitarPermisoNotificaciones() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function _enviarNotificacion(titulo, cuerpo, icono = "💧") {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification("TLC Riego — " + titulo, {
      body: cuerpo,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>" + icono + "</text></svg>",
      badge: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>💧</text></svg>",
      tag: "tlc-riego",    // reemplaza notificación anterior del mismo tag
    });
  } catch(e) { console.warn("[TLC] Notificación fallida:", e.message); }
}

// ─── FLOTANTE (prioridad absoluta) ───────────────────────────
function _chequearFlotante() {
  if (TLC.hw.flotante === "DEMANDA"
      && TLC.modo !== "LLENANDO"
      && !TLC._tanqueInterval) {   // guard: no disparar si ya hay timer de tanque corriendo
    iniciarLlenadoTanque(TLC.modo !== "STANDBY");
  }
}

// ─── CONTROL DE ZONAS MANUAL ─────────────────────────────────
function activarZonaManual(zona) {
  if (TLC.sensorLluvia) {
    mostrarToast("🌧 Sensor lluvia activo — riego inhibido.", "warning");
    return;
  }
  if (TLC.modo === "LLENANDO") {
    mostrarToast("⚠️ Llenado en curso — zonas deshabilitadas.", "warning");
    return;
  }
  if (TLC.programaActivo !== null) {
    mostrarToast("⚠️ Programa " + (TLC.pausado ? "pausado" : "en curso") + " — usá Detener primero.", "warning");
    return;
  }
  if (TLC.zonaActiva === zona && TLC.modo === "MANUAL") {
    detenerCiclo();
    mostrarToast("⏹ Zona " + zona + " apagada.", "warning");
    _enviarNotificacion("Zona " + zona, "Riego manual detenido.", "⏹");
    return;
  }
  detenerCiclo(true);
  TLC.modo           = "MANUAL";
  TLC.zonaActiva     = zona;
  TLC.programaActivo = null;
  TLC.pausado        = false;
  TLC.timerTotal     = TLC.tiempoManualGlobalConfigurado * 60;
  TLC.timerRestante  = TLC.timerTotal;
  TLC.hw.valvula     = "CERRADA";
  TLC.hw.bomba       = "RUNNING";
  enviarComando("/api/zona",  { zona, accion: "ABRIR" });
  enviarComando("/api/bomba", { accion: "ON" });
  _pushEstado();
  iniciarCicloTimer();
  mostrarToast("💧 Zona " + zona + " activada — " + TLC.tiempoManualGlobalConfigurado + "m", "success");
  _enviarNotificacion("Zona " + zona + " activa", "Riego manual por " + TLC.tiempoManualGlobalConfigurado + " minutos.", "💧");
  if (typeof renderMonitor === "function") renderMonitor();
}

function iniciarCicloTimer() {
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval = setInterval(() => {
    // Sentinel -1: transición entre zonas en curso, ignorar tick
    if (TLC.timerRestante < 0) return;
    if (TLC.timerRestante === 0) {
      if (!_avanzarSiguienteZona()) {
        detenerCiclo();
        mostrarToast("✅ Programa completado.", "success");
        _enviarNotificacion("✅ Programa completado", "Todas las zonas finalizadas.", "✅");
      }
      return;
    }
    if (TLC.hw.flotante === "DEMANDA" && TLC.modo === "MANUAL") {
      iniciarLlenadoTanque(true);
      return;
    }
    TLC.timerRestante--;
    if (TLC.timerRestante % 5 === 0 && !TLC.pausado) _pushEstado();
    if (typeof actualizarTimerUI === "function") actualizarTimerUI();
  }, 1000);
}

// Busca la siguiente zona con minutos > 0 en el programa activo.
// Retorna true si encontró y arrancó la siguiente zona, false si no hay más.
function _avanzarSiguienteZona() {
  if (TLC.programaActivo === null) return false;
  const prog = TLC.programas[TLC.programaActivo];
  if (!prog) return false;

  // Buscar la siguiente zona a partir de la actual (zonaActiva es 1-based)
  const idxActual    = prog.zonas.findIndex(z => z.zona === TLC.zonaActiva);
  let   idxSiguiente = -1;
  for (let i = idxActual + 1; i < prog.zonas.length; i++) {
    if (prog.zonas[i].minutos > 0) { idxSiguiente = i; break; }
  }

  if (idxSiguiente === -1) return false;  // no hay más zonas

  const siguienteZona  = prog.zonas[idxSiguiente].zona;
  const minutosFinales = minutosConAjuste(prog.zonas[idxSiguiente].minutos);

  // Detener ciclo actual SIN resetear programaActivo
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval = null;
  TLC.timerRestante  = -1;   // sentinel para evitar re-entrada durante el setTimeout

  enviarComando("/api/zonas", { accion: "CERRAR_TODAS" });

  setTimeout(() => {
    TLC.zonaActiva    = siguienteZona;
    TLC.timerTotal    = minutosFinales * 60;
    TLC.timerRestante = TLC.timerTotal;
    TLC.hw.bomba      = "RUNNING";
    enviarComando("/api/zona",  { zona: siguienteZona, accion: "ABRIR" });
    enviarComando("/api/bomba", { accion: "ON" });
    _pushEstado();
    iniciarCicloTimer();
    mostrarToast("💧 Zona " + siguienteZona + " — " + minutosFinales + "m", "success");
    _enviarNotificacion("Zona " + siguienteZona, "Continuando programa — " + minutosFinales + " minutos.", "💧");
    if (typeof renderMonitor === "function") renderMonitor();
  }, 800);

  return true;
}

function detenerCiclo(silencioso = false) {
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval = null;
  if (!silencioso) {
    TLC.modo           = "STANDBY";
    TLC.zonaActiva     = null;
    TLC.timerRestante  = 0;
    TLC.timerTotal     = 0;
    TLC.programaActivo = null;
    TLC.pausado        = false;
    TLC.hw.bomba       = "OFF";
    TLC.hw.valvula     = "CERRADA";
    enviarComando("/api/bomba",  { accion: "OFF" });
    enviarComando("/api/zonas",  { accion: "CERRAR_TODAS" });
    _pushEstado();   // push inmediato con estado final
    // Forzar render explícito de zonas y timer
    if (typeof actualizarTimerUI   === "function") actualizarTimerUI();
    if (typeof actualizarHWBadges  === "function") actualizarHWBadges();
    if (typeof renderZonas         === "function") renderZonas();
    if (typeof renderMonitor       === "function") renderMonitor();
  }
}

// ─── LLENADO DE TANQUE ───────────────────────────────────────
function iniciarLlenadoTanque(esRetorno = false) {
  if (esRetorno) {
    TLC.zonaAnterior    = TLC.zonaActiva;
    TLC.timerAnterior   = TLC.timerRestante;
    TLC.totalAnterior   = TLC.timerTotal;
    TLC.pausadoAnterior = TLC.pausado;
    clearInterval(TLC._cicloInterval);
    TLC._cicloInterval  = null;
    const msg = TLC.pausado
      ? "⚠️ Tanque sin agua — llenando (programa pausado)..."
      : "⚠️ Tanque sin agua — pausando riego en " + formatSegundos(TLC.timerRestante) + "...";
    mostrarToast(msg, "warning");
    _enviarNotificacion("⚠️ Tanque sin agua", "Riego pausado. Llenando el tanque...", "⚠️");
  } else {
    TLC.zonaAnterior    = null;
    TLC.timerAnterior   = 0;
    TLC.totalAnterior   = 0;
    TLC.pausadoAnterior = false;
    mostrarToast("⚠️ Flotante: demanda — iniciando llenado...", "warning");
    _enviarNotificacion("⚠️ Tanque sin agua", "Iniciando llenado de tanque.", "⚠️");
  }
  TLC.modo          = "LLENANDO";
  TLC.zonaActiva    = null;
  TLC.hw.bomba      = "OFF";
  TLC.timerRestante = 0;
  enviarComando("/api/bomba",  { accion: "OFF" });
  enviarComando("/api/zonas",  { accion: "CERRAR_TODAS" });
  _pushEstado();
  if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  if (typeof renderMonitor      === "function") renderMonitor();

  setTimeout(() => {
    TLC.hw.valvula = "ABIERTA";
    enviarComando("/api/valvula", { accion: "ABRIR" });
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();
    setTimeout(() => {
      TLC.hw.bomba = "RUNNING";
      enviarComando("/api/bomba", { accion: "ON" });
      TLC.tanqueTimer = 0;
      iniciarTanqueTimer();
      _pushEstado();
      if (typeof actualizarHWBadges === "function") actualizarHWBadges();
      if (typeof renderMonitor      === "function") renderMonitor();
    }, 500);
  }, 500);
}

function iniciarTanqueTimer() {
  clearInterval(TLC._tanqueInterval);
  TLC._tanqueInterval = setInterval(() => {
    TLC.tanqueTimer++;
    // Actualizar UI del timeout en tiempo real
    if (typeof actualizarTanqueTimerUI === "function") actualizarTanqueTimerUI();
    if (TLC.hw.flotante === "OK") {
      detenerLlenado(TLC.zonaAnterior !== null);
      return;
    }
    if (TLC.timeoutTanqueConfigurado > 0
        && TLC.tanqueTimer >= TLC.timeoutTanqueConfigurado * 60) {
      detenerLlenado(false);
      mostrarToast("🚨 TIME-OUT TANQUE — Falla crítica. Sistema detenido.", "error");
      _enviarNotificacion("🚨 Falla crítica", "Time-out de llenado de tanque. Sistema detenido.", "🚨");
    }
  }, 1000);
}

function detenerLlenado(retornar) {
  clearInterval(TLC._tanqueInterval);
  TLC._tanqueInterval = null;
  TLC.hw.bomba = "OFF";
  enviarComando("/api/bomba", { accion: "OFF" });
  if (typeof actualizarHWBadges === "function") actualizarHWBadges();

  setTimeout(() => {
    TLC.hw.valvula = "CERRADA";
    enviarComando("/api/valvula", { accion: "CERRAR" });
    enviarComando("/api/zonas",   { accion: "CERRAR_TODAS" });
    if (typeof actualizarHWBadges === "function") actualizarHWBadges();

    if (retornar && TLC.zonaAnterior !== null) {
      setTimeout(() => {
        const zona           = TLC.zonaAnterior;
        const timerGuardado  = TLC.timerAnterior || 0;
        const totalGuardado  = TLC.totalAnterior || timerGuardado;
        const eraPrograma    = TLC.programaActivo !== null;
        const estabaPausado  = TLC.pausadoAnterior || false;  // ← estado de pausa guardado
        TLC.zonaAnterior     = null;
        TLC.timerAnterior    = 0;
        TLC.totalAnterior    = 0;
        TLC.pausadoAnterior  = false;
        TLC.modo             = "MANUAL";
        TLC.zonaActiva       = zona;
        TLC.timerRestante    = timerGuardado;
        TLC.timerTotal       = totalGuardado;

        if (estabaPausado) {
          TLC.pausado      = true;
          TLC.hw.bomba     = "OFF";
          _pushEstado();
          mostrarToast("✅ Tanque lleno — Zona " + zona + " en pausa (" + formatSegundos(timerGuardado) + " restantes)", "warning");
          _enviarNotificacion("✅ Tanque lleno", "Zona " + zona + " en pausa. " + formatSegundos(timerGuardado) + " restantes.", "✅");
        } else {
          TLC.pausado      = false;
          TLC.hw.bomba     = "RUNNING";
          enviarComando("/api/zona",  { zona, accion: "ABRIR" });
          enviarComando("/api/bomba", { accion: "ON" });
          iniciarCicloTimer();
          _pushEstado();
          mostrarToast("✅ Tanque lleno — retomando Zona " + zona + " (" + formatSegundos(timerGuardado) + " restantes)", "success");
          _enviarNotificacion("✅ Tanque lleno", "Retomando Zona " + zona + ". " + formatSegundos(timerGuardado) + " restantes.", "✅");
        }
        if (typeof renderMonitor === "function") renderMonitor();
      }, 500);
    } else {
      TLC.modo       = "STANDBY";
      TLC.zonaActiva = null;
      _pushEstado();
      mostrarToast("✅ Tanque lleno. Sistema en standby.", "success");
      _enviarNotificacion("✅ Tanque lleno", "Sistema en standby.", "✅");
      if (typeof renderMonitor === "function") renderMonitor();
    }
  }, 500);
}

// ─── SIMULAR FLOTANTE ────────────────────────────────────────
function simularFlotante() {
  TLC.hw.flotante = TLC.hw.flotante === "OK" ? "DEMANDA" : "OK";
  enviarComando("/api/flotante/sim", { estado: TLC.hw.flotante });
  _pushEstado();
  if (typeof actualizarHWBadges === "function") actualizarHWBadges();
  mostrarToast(
    TLC.hw.flotante === "DEMANDA" ? "⚠️ Flotante simulado: DEMANDA DE AGUA" : "✅ Flotante simulado: TANQUE OK",
    TLC.hw.flotante === "DEMANDA" ? "warning" : "success"
  );
  // Chequear inmediatamente — no esperar al próximo poll
  _chequearFlotante();
}

function forzarLlenadoManual() {
  if (TLC.modo === "LLENANDO") { mostrarToast("Ya está llenando.", "warning"); return; }
  TLC.zonaAnterior = TLC.zonaActiva;
  iniciarLlenadoTanque(false);
}

// ─── EJECUTAR PROGRAMA ───────────────────────────────────────
function ejecutarPrograma(idxPrograma) {
  if (TLC.sensorLluvia) { mostrarToast("🌧 Sensor lluvia activo — riego inhibido.", "warning"); return; }
  if (TLC.modo === "LLENANDO") { mostrarToast("⚠️ Llenado en curso.", "warning"); return; }
  if (TLC.programaActivo !== null) { mostrarToast("⚠️ Detené el programa actual primero.", "warning"); return; }
  const prog = TLC.programas[idxPrograma];
  if (!prog) return;
  if (!programaVigente(prog)) {
    mostrarToast("📅 '" + prog.nombre + "' fuera de vigencia.", "warning");
    return;
  }
  detenerCiclo(true);
  const primeraZona = prog.zonas.findIndex(z => z.minutos > 0);
  if (primeraZona === -1) { mostrarToast("Sin zonas configuradas.", "warning"); return; }
  const minutosFinales  = Math.round(prog.zonas[primeraZona].minutos * (TLC.ajusteEstacionalTLC / 100));
  TLC.modo            = "MANUAL";
  TLC.zonaActiva      = primeraZona + 1;
  TLC.programaActivo  = idxPrograma;
  TLC.pausado         = false;
  TLC.timerTotal      = minutosFinales * 60;
  TLC.timerRestante   = TLC.timerTotal;
  TLC.hw.bomba        = "RUNNING";
  TLC.hw.valvula      = "CERRADA";
  enviarComando("/api/zona",  { zona: primeraZona + 1, accion: "ABRIR" });
  enviarComando("/api/bomba", { accion: "ON" });
  _pushEstado();
  iniciarCicloTimer();
  if (typeof renderMonitor === "function") renderMonitor();
  mostrarToast("▶️ Programa '" + prog.nombre + "' iniciado.", "success");
  _enviarNotificacion("Programa " + prog.nombre, "Riego iniciado — Zona " + (primeraZona + 1) + " por " + minutosFinales + "m.", "▶️");
}

function pausarPrograma() {
  if (TLC.modo !== "MANUAL" || TLC.programaActivo === null) return;
  // 1. Limpiar interval PRIMERO
  clearInterval(TLC._cicloInterval);
  TLC._cicloInterval = null;
  // 2. Setear estado
  TLC.pausado    = true;
  TLC.hw.bomba   = "OFF";
  TLC.hw.valvula = "CERRADA";
  enviarComando("/api/bomba",  { accion: "OFF" });
  enviarComando("/api/zonas",  { accion: "CERRAR_TODAS" });
  // 3. Push inmediato con pausado:true — otros dispositivos paran su ciclo
  _pushEstado();
  mostrarToast("⏸ Programa pausado — " + formatSegundos(TLC.timerRestante) + " restantes.", "warning");
  // 4. Render DESPUÉS del push para que la UI refleje el estado correcto
  if (typeof actualizarTimerUI === "function") actualizarTimerUI();
  if (typeof renderMonitor     === "function") renderMonitor();
}

function reanudarPrograma() {
  if (!TLC.pausado || TLC.programaActivo === null) return;
  TLC.pausado    = false;
  TLC.hw.bomba   = "RUNNING";
  enviarComando("/api/zona",  { zona: TLC.zonaActiva, accion: "ABRIR" });
  enviarComando("/api/bomba", { accion: "ON" });
  _pushEstado();
  iniciarCicloTimer();
  mostrarToast("▶️ Programa reanudado desde " + formatSegundos(TLC.timerRestante) + ".", "success");
  if (typeof renderMonitor === "function") renderMonitor();
}

function detenerPrograma() {
  TLC.programaActivo = null;
  TLC.pausado        = false;
  detenerCiclo();
  mostrarToast("⏹ Programa detenido.", "warning");
}

// ─── PROGRAMAS CRUD ──────────────────────────────────────────
function agregarPrograma(nombre, horainicio, dias, zonaMinutos, fechaDesde = "", fechaHasta = "") {
  TLC.programas.push({
    nombre, horaInicio: horainicio, dias, fechaDesde, fechaHasta,
    zonas: zonaMinutos.map((m, i) => ({ zona: i + 1, minutos: m })),
  });
  guardarEstado();
}

function borrarPrograma(idx) {
  TLC.programas.splice(idx, 1);
  guardarEstado();
}

function programaVigente(prog) {
  if (!prog.fechaDesde || !prog.fechaHasta) return true;
  const hoy  = new Date();
  const hoyN = (hoy.getMonth() + 1) * 100 + hoy.getDate();
  const [dM, dD] = prog.fechaDesde.split("-").map(Number);
  const [hM, hD] = prog.fechaHasta.split("-").map(Number);
  const desde = dM * 100 + dD;
  const hasta = hM * 100 + hD;
  return desde <= hasta ? (hoyN >= desde && hoyN <= hasta) : (hoyN >= desde || hoyN <= hasta);
}

function minutosConAjuste(minutos) {
  return Math.round(minutos * (TLC.ajusteEstacionalTLC / 100));
}

// ─── UTILIDADES UI ───────────────────────────────────────────
function formatSegundos(seg) {
  return Math.floor(seg / 60).toString().padStart(2, "0") + ":" + (seg % 60).toString().padStart(2, "0");
}

function mostrarToast(msg, tipo = "info") {
  const el = document.getElementById("tlc-toast");
  if (!el) return;
  el.textContent = msg;
  el.className   = "tlc-toast tlc-toast--" + tipo + " tlc-toast--visible";
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.className = "tlc-toast"; }, 3500);
}

// ─── BOOTSTRAP ───────────────────────────────────────────────
function inicializarApp() {
  // 1. Cargar config local mientras llega Firebase
  recuperarEstadoLocal();

  // 2. Seed de programas demo si está vacío
  if (TLC.programas.length === 0) {
    TLC.programas = [
      {
        nombre: "Mañana", horaInicio: "07:00", dias: ["Lun","Mié","Vie"],
        fechaDesde: "", fechaHasta: "",
        zonas: [1,2,3,4,5,6,7,8].map((z,i) => ({ zona: z, minutos: [8,6,5,5,4,4,3,3][i] })),
      },
      {
        nombre: "Tarde", horaInicio: "19:30", dias: ["Mar","Jue","Sáb"],
        fechaDesde: "", fechaHasta: "",
        zonas: [1,2,3,4,5,6,7,8].map((z,i) => ({ zona: z, minutos: [10,8,6,6,5,5,4,4][i] })),
      },
    ];
    guardarEstado();
  }

  // 3. Conectar Firebase y escuchar cambios en tiempo real
  const fbOk = _iniciarFirebase();
  if (fbOk) {
    _escucharFirebase();
    _mostrarBannerOffline(true);
  }

  // 4. Solicitar permiso de notificaciones push
  _solicitarPermisoNotificaciones();

  // 5. Polling al ESP32 (cuando exista)
  if (ESP32_URL) {
    pollEstadoHW();
    TLC._pollInterval = setInterval(pollEstadoHW, POLL_INTERVAL_HW);
  }
}
