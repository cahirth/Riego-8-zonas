// ============================================================================
// FIRMWARE FRONTEND: Riego Hidráulico TLC
// VERSION: v2.7.3 (Build: 20260613-2025)
// ============================================================================

const CONFIG_VERSION = "v2.7.3 (Build: 20260613-2025)";

window.cicloInterval = null;
window.tanqueInterval = null;

const diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const nombresDiasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// --- ICONOGRAFÍA VECTORIAL INDUSTRIAL XL ---
const ICONO_ASPERSOR_JPG = `<svg viewBox="0 0 100 100" style="width:36px; height:36px; margin-bottom:6px; color:inherit;">
    <path fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" d="M50 90V55M35 55h30v8H35z"/>
    <rect x="46" y="38" width="8" height="17" fill="currentColor"/>
    <path fill="none" stroke="#2196F3" stroke-width="3.5" stroke-dasharray="4 3" d="M42 32C32 28 18 32 10 42M58 32C68 28 82 32 90 42"/>
    <path fill="none" stroke="#4CAF50" stroke-width="4" stroke-linecap="round" d="M15 90c15-8 55-8 70 0"/>
</svg>`;

const ICONO_BOMBA_JPG = `<svg viewBox="0 0 100 100" style="width:24px; height:24px; vertical-align:middle; margin-right:6px;">
    <circle cx="35" cy="55" r="22" fill="none" stroke="currentColor" stroke-width="5"/>
    <path fill="currentColor" d="M35 33h45v44H35zM50 20h16v13H50zM18 55h17v6H18zM70 42h10v4H70zm0 10h10v4H70zm0 10h10v4H70z"/>
</svg>`;

const ICONO_VALVULA_SOLENOIDE = `<svg viewBox="0 0 100 100" style="width:24px; height:24px; vertical-align:middle; margin-right:6px;">
    <rect x="38" y="10" width="24" height="26" rx="3" fill="currentColor"/>
    <rect x="46" y="36" width="8" height="10" fill="currentColor"/>
    <path fill="currentColor" d="M15 50l30 18V32zM85 50L55 32v36z"/>
    <path d="M20 74h60v6H20z" fill="currentColor"/>
    <path d="M42 56h16v6H42z" fill="none" stroke="#fff" stroke-width="2"/>
</svg>`;

const ICONO_FLOTANTE_BOYA = `<svg viewBox="0 0 100 100" style="width:24px; height:24px; vertical-align:middle; margin-right:6px;">
    <path d="M15 25h12v10H15z" fill="currentColor"/>
    <path fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" d="M27 30l38 18"/>
    <circle cx="73" cy="52" r="14" fill="none" stroke="currentColor" stroke-width="4"/>
    <path d="M50 75c0-10 40-10 40 0z" fill="#2196F3" opacity="0.7"/>
</svg>`;

let zonasMaestras = [];
for (let i = 1; i <= 8; i++) {
    zonasMaestras.push({ id: i, nombre: `Zona Riego ${i}` });
}

let programas = [
    { id: 1, nombre: "Programa Mañana (A)", start_time: "07:30", dias: [1, 3, 5], zonas: [{id: 1, min: 10}, {id: 2, min: 5}, {id: 5, min: 20}] },
    { id: 2, nombre: "Programa Tarde (B)", start_time: "19:30", dias: [2, 4], zonas: [{id: 4, min: 12}] }
];

let programaEditandoId = null;
let sistemaEstado = 'idle'; 
let zonaActivaId = null;
let tiempoRestanteActual = 0;
let tiempoInicialAsignado = 0; 
let tiempoLlenadoTanqueRestante = 0; 
let timeoutTanqueConfigurado = 1; 
let listaZonasPrioridad = [];
let tanqueLlamando = false;
let tiempoManualGlobalConfigurado = 5;
let ajusteEstacionalTLC = 100; 

function trazarVersionCompilacion() {
    console.log(`%c 💧 TLC SYSTEM v2.7.3 — Modo Estable Restablecido `, "background: #1565c0; color: #ffffff; font-weight: bold; padding: 6px; border-radius: 4px;");
}

function local_guardarEstadoGlobal() {
    const backup = {
        programas: programas,
        timeoutTanqueConfigurado: timeoutTanqueConfigurado,
        tiempoManualGlobalConfigurado: tiempoManualGlobalConfigurado,
        ajusteEstacionalTLC: ajusteEstacionalTLC
    };
    localStorage.setItem('TLC_RIEGO_MULTI_DATA', JSON.stringify(backup));
}

function local_recuperarEstadoGoblal() {
    trazarVersionCompilacion();
    const datosGuardados = localStorage.getItem('TLC_RIEGO_MULTI_DATA');
    if (datosGuardados) {
        const cache = JSON.parse(datosGuardados);
        programas = cache.programas;
        timeoutTanqueConfigurado = cache.timeoutTanqueConfigurado;
        if(cache.tiempoManualGlobalConfigurado) tiempoManualGlobalConfigurado = cache.tiempoManualGlobalConfigurado;
        if(cache.ajusteEstacionalTLC !== undefined) ajusteEstacionalTLC = cache.ajusteEstacionalTLC;
    }
    inyectarIconosEstaticosHardware();
}

function inyectarIconosEstaticosHardware() {
    const lblBomba = document.getElementById('hw-bomba');
    const lblValvula = document.getElementById('hw-tanque');
    const lblFlotante = document.getElementById('hw-flotante');
    
    if(lblBomba) lblBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
    if(lblValvula) lblValvula.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
    if(lblFlotante) lblFlotante.innerHTML = `${ICONO_FLOTANTE_BOYA} <span>FLOTANTE: TANQUE OK</span>`;
}

function actualizarDisplayTimeout(valor) {
    timeoutTanqueConfigurado = parseInt(valor);
    const display = document.getElementById('display-timeout-tanque');
    if(display) display.innerText = valor === '0' ? 'Manual' : valor + 'm';
    local_guardarEstadoGlobal();
}

// ... Resto de las funciones lógicas nativas v2.7.x ...
function actualizarDisplayTLC(valor) {
    ajusteEstacionalTLC = parseInt(valor);
    const display = document.getElementById('display-tlc-estacional');
    if(display) display.innerText = valor + "%";
    local_guardarEstadoGlobal();
}

function actualizarFechaHoy() {
    const ahora = new Date();
    const hoyIdx = ahora.getDay();
    const fechaString = ahora.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    const labelFecha = document.getElementById('display-fecha-hoy');
    if(labelFecha) labelFecha.innerText = `Hoy: ${nombresDiasLargos[hoyIdx]} ${fechaString}`;
}

function navegarHacia(destino) {
    let rutaActual = window.location.pathname;
    if (rutaActual.includes("config.html") && destino === "monitor.html") {
        window.location.href = rutaActual.replace("config.html", "monitor.html");
    } else if (rutaActual.includes("monitor.html") && destino === "config.html") {
        window.location.href = rutaActual.replace("monitor.html", "config.html");
    } else {
        window.location.href = destino;
    }
}

function renderizarMonitorPrincipal() {
    const container = document.getElementById('manual-buttons-container');
    if(!container) return;
    container.innerHTML = '';

    const esBloqueadoPorTanque = sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro';

    const filaUnicaComandos = document.createElement('div');
    filaUnicaComandos.style.display = "flex";
    filaUnicaComandos.style.gap = "5px";
    filaUnicaComandos.style.marginBottom = "15px";
    
    const textoBotonFlotante = tanqueLlamando ? '🟢 OK' : '⚠️ Tanque';
    const colorBotonFlotante = tanqueLlamando ? 'var(--success)' : 'var(--warning)';
    
    filaUnicaComandos.innerHTML = `
        <button class="btn" style="background:#0288d1; flex:1; padding:10px 2px; font-size:11px; font-weight:bold;" onclick="navegarHacia('config.html')">⚙️ Config</button>
        <button class="btn" style="background:#4caf50; flex:1; padding:10px 2px; font-size:11px; font-weight:bold;" onclick="enviarConfiguracionFlashESP32()">💾 Sincro</button>
        <button class="btn" style="background:#7b1fa2; flex:1; padding:10px 2px; font-size:11px; font-weight:bold;" onclick="ejecutarLlenadoSecuencial()">🚰 Llenar</button>
        <button class="btn" id="btn-sim-flotante" style="background:${colorBotonFlotante}; color:var(--dark); flex:1; padding:10px 2px; font-size:11px; font-weight:800;" onclick="gestionarFlotanteSimulado()">${textoBotonFlotante}</button>
    `;
    container.appendChild(filaUnicaComandos);

    const titleManual = document.createElement('div');
    titleManual.className = "manual-section-title";
    titleManual.innerText = "Zonas Físicas del Colector (Prueba Manual Directa)";
    container.appendChild(titleManual);

    const gridZonas = document.createElement('div');
    gridZonas.className = "manual-grid";

    zonasMaestras.forEach(zona => {
        const isActive = (zonaActivaId === zona.id && (sistemaEstado === 'riego_manual' || sistemaEstado === 'riego_auto'));
        const isPaused = (zonaActivaId === zona.id && sistemaEstado.startsWith('pausa_tanque'));
        let extraClass = isActive ? 'active' : (isPaused ? 'paused' : (esBloqueadoPorTanque ? 'disabled' : ''));
        
        const btn = document.createElement('div');
        btn.className = `btn-manual ${extraClass}`;
        btn.onclick = () => { if(!esBloqueadoPorTanque) toggleZonaManualDirecta(zona.id); };
        btn.innerHTML = `${ICONO_ASPERSOR_JPG} <span>${zona.nombre}</span>`;
        gridZonas.appendChild(btn);
    });
    container.appendChild(gridZonas);
}

function toggleZonaManualDirecta(zonaId) {
    if (sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro') return;
    if (zonaActivaId === zonaId && sistemaEstado === 'riego_manual') { forzarParadaTotal(); return; }

    forzarParadaTotal();
    sistemaEstado = 'riego_manual';
    zonaActivaId = zonaId;
    tiempoRestanteActual = tiempoManualGlobalConfigurado; 
    tiempoInicialAsignado = tiempoManualGlobalConfigurado; 

    arrancarBucleTiempoGenerico(false);
    renderizarMonitorPrincipal();
}

function arrancarBucleTiempoGenerico(esAutomatico) {
    const wrapper = document.getElementById('progress-wrapper');
    const bar = document.getElementById('cycle-progress');
    const lblText = document.getElementById('status-text');
    
    if(wrapper) wrapper.style.display = 'block';
    if(lblText) {
        lblText.className = 'status-current running';
        lblText.innerText = `${esAutomatico ? 'AUTO' : 'MANUAL'}: ZONA ${zonaActivaId} 💧`;
    }

    if(window.cicloInterval) clearInterval(window.cicloInterval);
    window.cicloInterval = setInterval(() => {
        const tr = document.getElementById('timer-remaining');
        if (tiempoRestanteActual > 0) {
            if(tr) tr.innerText = `Tiempo restante: ${tiempoRestanteActual} min`;
            tiempoRestanteActual--;
        } else {
            clearInterval(window.cicloInterval);
            forzarParadaTotal();
        }
    }, 1000);
}

function gestionarFlotanteSimulado() {
    if (tanqueLlamando) detenerLlenadoSecuencial(false);
    else ejecutarLlenadoSecuencial();
}

function ejecutarLlenadoSecuencial() {
    tanqueLlamando = true;
    const hwFlotante = document.getElementById('hw-flotante');
    if(hwFlotante) {
        hwFlotante.className = 'hw-badge alert';
        hwFlotante.innerHTML = `${ICONO_FLOTANTE_BOYA} <span>FLOTANTE: ¡DEMANDA AGUA! ⚠️</span>`;
    }
    sistemaEstado = 'llenado_puro';
    renderizarMonitorPrincipal();
}

function detenerLlenadoSecuencial(porTimeout) {
    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    tanqueLlamando = false;
    forzarParadaTotal();
}

function forzarParadaTotal() {
    if(window.cicloInterval) clearInterval(window.cicloInterval);
    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    
    sistemaEstado = 'idle';
    zonaActivaId = null;
    tiempoRestanteActual = 0;

    const lblText = document.getElementById('status-text');
    if(lblText) { lblText.className = 'status-current'; lblText.innerText = '🏠 EN ESPERA (STANDBY)'; }

    actualizarFechaHoy();
    renderizarMonitorPrincipal();
}

function enviarConfiguracionFlashESP32() {
    alert("🚀 ¡Sincronizado con el ESP32!");
}
