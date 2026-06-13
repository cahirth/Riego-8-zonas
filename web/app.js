// ============================================================================
// FIRMWARE FRONTEND: Riego Hidráulico TLC
// VERSION: v2.8.5 (Restaurada)
// ============================================================================

const CONFIG_VERSION = "v2.8.5";

window.cicloInterval = null;
window.tanqueInterval = null;

const diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const nombresDiasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// --- ICONOGRAFÍA ORIGINAL ---
const ICONO_ASPERSOR_JPG = `<svg viewBox="0 0 100 100" style="width:32px; height:32px; margin-bottom:4px; color:inherit;">
    <path fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" d="M50 90V55M35 55h30v8H35z"/>
    <rect x="46" y="38" width="8" height="17" fill="currentColor"/>
    <path fill="none" stroke="#2196F3" stroke-width="3.5" stroke-dasharray="4 3" d="M42 32C32 28 18 32 10 42M58 32C68 28 82 32 90 42"/>
    <path fill="none" stroke="#4CAF50" stroke-width="4" stroke-linecap="round" d="M15 90c15-8 55-8 70 0"/>
</svg>`;

const ICONO_BOMBA_JPG = `<svg viewBox="0 0 100 100" style="width:20px; height:20px; vertical-align:middle; margin-right:6px;">
    <circle cx="35" cy="55" r="22" fill="none" stroke="currentColor" stroke-width="5"/>
    <path fill="currentColor" d="M35 33h45v44H35zM50 20h16v13H50zM18 55h17v6H18zM70 42h10v4H70zm0 10h10v4H70zm0 10h10v4H70z"/>
</svg>`;

const ICONO_VALVULA_SOLENOIDE = `<svg viewBox="0 0 100 100" style="width:20px; height:20px; vertical-align:middle; margin-right:6px;">
    <rect x="38" y="10" width="24" height="26" rx="3" fill="currentColor"/>
    <rect x="46" y="36" width="8" height="10" fill="currentColor"/>
    <path fill="currentColor" d="M15 50l30 18V32zM85 50L55 32v36z"/>
    <path d="M20 74h60v6H20z" fill="currentColor"/>
    <path d="M42 56h16v6H42z" fill="none" stroke="#fff" stroke-width="2"/>
</svg>`;

const ICONO_FLOTANTE_BOYA = `<svg viewBox="0 0 100 100" style="width:20px; height:20px; vertical-align:middle; margin-right:6px;">
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
    console.log(`%c 💧 TLC MAIN ENGINE — Versión Original Restaurada `, "background: #0288d1; color: #ffffff; font-weight: bold; padding: 6px;");
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
    
    const sliderInput = document.getElementById('input-tiempo-manual-global');
    const sliderDisplay = document.getElementById('display-tiempo-manual-global');
    if(sliderInput && sliderDisplay) {
        sliderInput.value = tiempoManualGlobalConfigurado;
        sliderDisplay.innerText = tiempoManualGlobalConfigurado + "m";
    }
    
    inyectarIconosEstaticosHardware();
}

function inyectarIconosEstaticosHardware() {
    const lblBomba = document.getElementById('hw-bomba');
    const lblValvula = document.getElementById('hw-tanque');
    const lblFlotante = document.getElementById('hw-flotante');
    
    if(lblBomba) lblBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
    if(lblValvula) lblValvula.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: CERRADA</span>`;
    if(lblFlotante) lblFlotante.innerHTML = `${ICONO_FLOTANTE_BOYA} <span>FLOTANTE: OK</span>`;
}

function actualizarDisplayTimeout(valor) {
    timeoutTanqueConfigurado = parseInt(valor);
    const display = document.getElementById('display-timeout-tanque');
    if(display) display.innerText = valor === '0' ? 'Manual' : valor + 'm';
    local_guardarEstadoGlobal();
}

function actualizarDisplayTLC(valor) {
    ajusteEstacionalTLC = parseInt(valor);
    const display = document.getElementById('display-tlc-estacional');
    if(display) display.innerText = valor + "%";
    local_guardarEstadoGlobal();
    
    let path = window.location.pathname;
    if(path.includes("config.html")) renderizarPantallaConfiguracion();
}

function actualizarDisplayTiempoManualGlobal(valor) {
    tiempoManualGlobalConfigurado = parseInt(valor);
    const display = document.getElementById('display-tiempo-manual-global');
    if(display) display.innerText = valor + "m";
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

    // BOTONERA SUPERIOR ORIGINAL CON ANCHOS COMODOS
    const filaUnicaComandos = document.createElement('div');
    filaUnicaComandos.style.display = "flex";
    filaUnicaComandos.style.gap = "10px";
    filaUnicaComandos.style.marginBottom = "15px";
    
    const textoBotonFlotante = tanqueLlamando ? '🟢 OK' : '⚠️ Tanque';
    const colorBotonFlotante = tanqueLlamando ? 'var(--success)' : 'var(--warning)';
    
    filaUnicaComandos.innerHTML = `
        <button class="btn" style="background:#4caf50; flex:1;" onclick="enviarConfiguracionFlashESP32()">💾 Sincro Flash</button>
        <button class="btn" style="background:#7b1fa2; flex:1;" onclick="ejecutarLlenadoSecuencial()">🚰 Llenar Tanque</button>
        <button class="btn" id="btn-sim-flotante" style="background:${colorBotonFlotante}; color:var(--dark); flex:1; font-weight:bold;" onclick="gestionarFlotanteSimulado()">${textoBotonFlotante}</button>
    `;
    container.appendChild(filaUnicaComandos);

    // Grilla de Válvulas Manuales
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

    // Slider de tiempo manual
    const cardManualSlider = document.createElement('div');
    cardManualSlider.className = "zone-card";
    cardManualSlider.style.marginTop = "12px";
    cardManualSlider.style.marginBottom = "20px";
    cardManualSlider.style.border = "1px solid #0288d1";
    cardManualSlider.innerHTML = `
        <div class="zone-name" style="color: #0288d1; font-weight: bold;">Tiempo de Activación Manual</div>
        <div class="timer-control" style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px;">
            <span style="font-size: 13px; color: #555;">Duración:</span>
            <input type="range" min="1" max="60" value="${tiempoManualGlobalConfigurado}" id="input-tiempo-manual-global" style="flex-grow: 1; margin: 0 15px;" oninput="actualizarDisplayTiempoManualGlobal(this.value)">
            <span class="time-display" id="display-tiempo-manual-global" style="font-weight: bold; color: #0288d1; font-size: 16px; min-width: 35px; text-align: right;">${tiempoManualGlobalConfigurado}m</span>
        </div>
    `;
    container.appendChild(cardManualSlider);

    // Programas Automáticos TLC
    const titleProgs = document.createElement('div');
    titleProgs.className = "manual-section-title";
    titleProgs.innerText = `Programas Automáticos (Ajuste Estacional TLC: ${ajusteEstacionalTLC}%)`;
    container.appendChild(titleProgs);

    programas.forEach(prog => {
        const card = document.createElement('div');
        card.className = "zone-card";
        card.style.marginBottom = "10px";
        
        let stringDias = prog.dias.map(d => diasSemana[d]).join(' - ');
        let listadoZonas = prog.zonas.map(z => {
            let minsCalculados = Math.max(1, Math.round(z.min * (ajusteEstacionalTLC / 100)));
            return `Z${z.id} (${minsCalculados}m)`;
        }).join(', ');

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>⚙️ ${prog.nombre}</strong> — <span style="color:var(--primary); font-weight:bold;">${prog.start_time} hs</span>
                    <div style="font-size:11px; color:#666; margin-top:4px;">Calendario: [${stringDias}]</div>
                    <div style="font-size:12px; color:var(--dark); font-weight:bold; margin-top:2px;">Tiempos Escalados: ${listadoZonas || 'Ninguna'}</div>
                </div>
                <button class="btn" style="width:auto; padding:8px 12px; font-size:12px; background:var(--success);" onclick="lanzarProgramaDesdeMonitor(${prog.id})">▶️ Ejecutar</button>
            </div>
        `;
        container.appendChild(card);
    });
}

// ... (Las demás funciones de control y modal se mantienen estables de la v2.8.5)

function toggleZonaManualDirecta(zonaId) {
    if (sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro') return;
    if (zonaActivaId === zonaId && sistemaEstado === 'riego_manual') { forzarParadaTotal(); return; }

    forzarParadaTotal();
    sistemaEstado = 'riego_manual';
    zonaActivaId = zonaId;
    tiempoRestanteActual = tiempoManualGlobalConfigurado; 
    tiempoInicialAsignado = tiempoManualGlobalConfigurado; 

    const hwTanque = document.getElementById('hw-tanque');
    const hwBomba = document.getElementById('hw-bomba');

    if(hwTanque) {
        hwTanque.className = 'hw-badge closed';
        hwTanque.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: CERRADA</span>`;
    }
    if(hwBomba) {
        hwBomba.className = 'hw-badge on';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUN ⚡</span>`;
    }

    arrancarBucleTiempoGenerico(false);
    renderizarMonitorPrincipal();
}

function lanzarProgramaDesdeMonitor(idProg) {
    forzarParadaTotal();
    const prog = programas.find(p => p.id === idProg);
    if(!prog || prog.zonas.length === 0) { alert("Este programa no tiene zonas asignadas."); return; }

    sistemaEstado = 'riego_auto';
    listaZonasPrioridad = prog.zonas.map(z => {
        return {
            id: z.id,
            min: Math.max(1, Math.round(z.min * (ajusteEstacionalTLC / 100)))
        };
    });
    avanzarCicloAutomaticoMulti();
}

function avanzarCicloAutomaticoMulti() {
    if (listaZonasPrioridad.length > 0) {
        let proximaZona = listaZonasPrioridad.shift();
        zonaActivaId = proximaZona.id;
        tiempoRestanteActual = proximaZona.min;
        tiempoInicialAsignado = proximaZona.min;

        const hwTanque = document.getElementById('hw-tanque');
        const hwBomba = document.getElementById('hw-bomba');

        if(hwTanque) {
            hwTanque.className = 'hw-badge closed';
            hwTanque.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: CERRADA</span>`;
        }
        if(hwBomba) {
            hwBomba.className = 'hw-badge on';
            hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUN ⚡</span>`;
        }

        arrancarBucleTiempoGenerico(true);
        renderizarMonitorPrincipal();
    } else {
        forzarParadaTotal();
        setTimeout(() => { alert("✅ Ciclo de programa automático completado."); }, 200);
    }
}

function arrancarBucleTiempoGenerico(esAutomatico) {
    const wrapper = document.getElementById('progress-wrapper');
    const bar = document.getElementById('cycle-progress');
    const lblText = document.getElementById('status-text');
    
    if(wrapper) wrapper.style.display = 'block';
    if(bar) bar.className = 'progress-bar';

    const hwBomba = document.getElementById('hw-bomba');
    if(hwBomba) {
        hwBomba.className = 'hw-badge on';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUN ⚡</span>`;
    }

    if(lblText) {
        lblText.className = 'status-current running';
        lblText.innerText = `${esAutomatico ? 'AUTO' : 'MANUAL'}: ZONA ${zonaActivaId} 💧`;
    }

    if(window.cicloInterval) clearInterval(window.cicloInterval);
    window.cicloInterval = setInterval(() => {
        const tr = document.getElementById('timer-remaining');
        if (tiempoRestanteActual > 0) {
            if(tr) tr.innerText = `Tiempo restante: ${tiempoRestanteActual} min`;
            if(bar && tiempoInicialAsignado > 0) {
                let porcentajeAcumulado = ((tiempoInicialAsignado - tiempoRestanteActual) / tiempoInicialAsignado) * 100;
                bar.style.width = `${porcentajeAcumulado}%`;
            }
            tiempoRestanteActual--;
        } else {
            clearInterval(window.cicloInterval);
            if(hwBomba) {
                hwBomba.className = 'hw-badge';
                hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
            }
            if (esAutomatico) avanzarCicloAutomaticoMulti();
            else forzarParadaTotal();
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
        hwFlotante.innerHTML = `${ICONO_FLOTANTE_BOYA} <span>FALLA AGUA</span>`;
    }
    
    const estadoPrevio = sistemaEstado;
    const hwBomba = document.getElementById('hw-bomba');
    const hwTanque = document.getElementById('hw-tanque');
    const lblText = document.getElementById('status-text');

    if (estadoPrevio === 'riego_manual' || estadoPrevio === 'riego_auto') {
        sistemaEstado = 'pausa_tanque_' + estadoPrevio; 
        if(window.cicloInterval) clearInterval(window.cicloInterval);
        if(hwBomba) {
            hwBomba.className = 'hw-badge';
            hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
        }

        setTimeout(() => {
            if(hwTanque) {
                hwTanque.className = 'hw-badge';
                hwTanque.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: ABIERTA</span>`;
            }
            if(lblText) {
                lblText.className = 'status-current paused';
                lblText.innerText = `⏳ ESPERANDO BOMBA (500ms)`;
            }

            setTimeout(() => {
                if (tanqueLlamando) {
                    if(hwBomba) {
                        hwBomba.className = 'hw-badge on';
                        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: LLENANDO ⚡</span>`;
                    }
                    arrancarBucleTanque(timeoutTanqueConfigurado * 60);
                }
            }, 500);
            renderizarBotonesManualesEmulados();
        }, 500);
    } else {
        sistemaEstado = 'llenado_puro';
        if(hwTanque) {
            hwTanque.className = 'hw-badge';
            hwTanque.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: ABIERTA</span>`;
        }
        setTimeout(() => {
            if (tanqueLlamando) {
                if(hwBomba) {
                    hwBomba.className = 'hw-badge on';
                    hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: LLENANDO ⚡</span>`;
                }
                arrancarBucleTanque(timeoutTanqueConfigurado * 60);
            }
        }, 500);
        renderizarBotonesManualesEmulados();
    }
}

function renderizarBotonesManualesEmulados() {
    let path = window.location.pathname;
    if(!path.includes("config.html")) renderizarMonitorPrincipal();
}

function arrancarBucleTanque(segundosTotales) {
    tiempoLlenadoTanqueRestante = segundosTotales;
    const wrapper = document.getElementById('progress-wrapper');
    const bar = document.getElementById('cycle-progress');
    const lblText = document.getElementById('status-text');
    
    if(wrapper) wrapper.style.display = 'block';
    if(bar) {
        bar.className = 'progress-bar paused';
        bar.style.width = '100%'; 
    }

    if(lblText) {
        lblText.className = 'status-current paused';
        lblText.innerText = `⚠️ LLENANDO TANQUE`;
    }

    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    window.tanqueInterval = setInterval(() => {
        const tr = document.getElementById('timer-remaining');
        if (tiempoLlenadoTanqueRestante > 0) {
            if(tr) tr.innerText = `Límite: ${tiempoLlenadoTanqueRestante} seg`;
            tiempoLlenadoTanqueRestante--;
        } else {
            detenerLlenadoSecuencial(true);
        }
    }, 1000);
}

function prevenirFalsosFlotantes() { return false; }

function detenerLlenadoSecuencial(porTimeout) {
    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    const hwBomba = document.getElementById('hw-bomba');
    const hwTanque = document.getElementById('hw-tanque');
    const hwFlotante = document.getElementById('hw-flotante');

    if(hwBomba) {
        hwBomba.className = 'hw-badge';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
    }

    setTimeout(() => {
        if(hwTanque) {
            hwTanque.className = 'hw-badge closed';
            hwTanque.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: CERRADA</span>`;
        }
        if(hwFlotante) {
            hwFlotante.className = 'hw-badge';
            hwFlotante.innerHTML = `${ICONO_FLOTANTE_BOYA} <span>FLOTANTE: OK</span>`;
        }

        tanqueLlamando = false;

        if (porTimeout && sistemaEstado.startsWith('pausa_tanque')) {
            alert("🚨 Abortado: Falla crítica de time-out en tanque.");
            forzarParadaTotal();
            return;
        }

        if (sistemaEstado.startsWith('pausa_tanque')) {
            let anteriorAuto = sistemaEstado.includes('riego_auto');
            sistemaEstado = anteriorAuto ? 'riego_auto' : 'riego_manual';
            arrancarBucleTiempoGenerico(anteriorAuto);
        } else {
            forzarParadaTotal();
        }
    }, 500);
}

function forzarParadaTotal() {
    if(window.cicloInterval) clearInterval(window.cicloInterval);
    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    
    sistemaEstado = 'idle';
    zonaActivaId = null;
    tiempoRestanteActual = 0;
    tiempoInicialAsignado = 0;
    listaZonasPrioridad = [];
    tanqueLlamando = false;

    const lblText = document.getElementById('status-text');
    const tr = document.getElementById('timer-remaining');
    const wrapper = document.getElementById('progress-wrapper');

    if(lblText) { lblText.className = 'status-current'; lblText.innerText = '🏠 EN ESPERA (STANDBY)'; }
    if(tr) tr.innerText = '';
    if(wrapper) wrapper.style.display = 'none';
        
    const hwBomba = document.getElementById('hw-bomba');
    const hwTanque = document.getElementById('hw-tanque');
    const hwFlotante = document.getElementById('hw-flotante');

    if(hwBomba) {
        hwBomba.className = 'hw-badge';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
    }
    if(hwTanque) {
        hwTanque.className = 'hw-badge closed';
        hwTanque.innerHTML = `${ICONO_VALVULA_SOLENOIDE} <span>VALV. TANQUE: CERRADA</span>`;
    }
    if(hwFlotante) {
        hwFlotante.className = 'hw-badge';
        hwFlotante.innerHTML = `${ICONO_FLOTANTE_BOYA} <span>FLOTANTE: OK</span>`;
    }

    actualizarFechaHoy();
    let path = window.location.pathname;
    if(path.includes("config.html")) renderizarPantallaConfiguracion();
    else renderizarMonitorPrincipal();
}

function enviarConfiguracionFlashESP32() {
    const payload = {
        comando: "guardar_config_maestra",
        build: CONFIG_VERSION,
        timeout_tanque: timeoutTanqueConfigurado,
        ajuste_estacional_tlc: ajusteEstacionalTLC,
        programas: programas
    };
    console.log("JSON Maestro enviado:", JSON.stringify(payload, null, 2));
    alert("🚀 ¡Ajuste Estacional TLC y programas sincronizados con el ESP32!");
    navegarHacia("monitor.html");
}
