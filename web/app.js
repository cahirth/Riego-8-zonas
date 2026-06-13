// ============================================================================
// FIRMWARE FRONTEND: Riego Hidráulico TLC
// VERSION: v2.4.0 (Build: 20260613-2330)
// DESCRIPCIÓN: Íconos realistas basados en JPGs + Ajuste Estacional Global Tipo Hunter
// ============================================================================

const CONFIG_VERSION = "v2.4.0 (Build: 20260613-2330)";

window.cicloInterval = null;
window.tanqueInterval = null;

const diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const nombresDiasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// --- ICONOGRAFÍA REALISTA VECTORIAL DETALLADA (CALCADA DE TUS FOTOS) ---
const ICONO_ASPERSOR_JPG = `<svg viewBox="0 0 100 100" style="width:32px; height:32px; margin-bottom:4px; color:inherit;">
    <path fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" d="M50 90V55M35 55h30v8H35z"/>
    <rect x="46" y="38" width="8" height="17" fill="currentColor"/>
    <path fill="none" stroke="#2196F3" stroke-width="3.5" stroke-dasharray="4 3" d="M42 32C32 28 18 32 10 42M58 32C68 28 82 32 90 42"/>
    <path fill="none" stroke="#4CAF50" stroke-width="4" stroke-linecap="round" d="M15 90c15-8 55-8 70 0"/>
</svg>`;

const ICONO_BOMBA_JPG = `<svg viewBox="0 0 100 100" style="width:24px; height:24px; vertical-align:middle; margin-right:8px;">
    <circle cx="35" cy="55" r="22" fill="none" stroke="currentColor" stroke-width="5"/>
    <path fill="currentColor" d="M35 33h45v44H35zM50 20h16v13H50zM18 55h17v6H18zM70 42h10v4H70zm0 10h10v4H70zm0 10h10v4H70z"/>
</svg>`;

const ICONO_FLOTANTE_JPG = `<svg viewBox="0 0 100 100" style="width:24px; height:24px; vertical-align:middle; margin-right:8px;">
    <path fill="none" stroke="currentColor" stroke-width="4" d="M75 10v40"/>
    <rect x="70" y="50" width="10" height="12" fill="currentColor"/>
    <rect x="30" y="32" width="28" height="16" rx="6" fill="none" stroke="currentColor" stroke-width="4" transform="rotate(-25 44 40)"/>
    <rect x="42" y="62" width="28" height="16" rx="6" fill="none" stroke="currentColor" stroke-width="4" transform="rotate(25 56 70)"/>
    <path fill="none" stroke="currentColor" stroke-width="3" d="M72 56c-10 0-18-10-26-14m26 2c-8 0-14 6-20 10"/>
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

// VARIABLE TIPO HUNTER: Factor multiplicador porcentual del tiempo de riego estacional
let ajusteEstacionalHunter = 100; 

function trazarVersionCompilacion() {
    console.log(
        `%c 💧 TLC MULTIPROGRAMA HUNTER — Active Version: ${CONFIG_VERSION} `,
        "background: #2e7d32; color: #ffffff; font-weight: bold; padding: 4px; border-radius: 4px;"
    );
}

function local_guardarEstadoGlobal() {
    const backup = {
        programas: programas,
        timeoutTanqueConfigurado: timeoutTanqueConfigurado,
        tiempoManualGlobalConfigurado: tiempoManualGlobalConfigurado,
        ajusteEstacionalHunter: ajusteEstacionalHunter
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
        if(cache.ajusteEstacionalHunter !== undefined) ajusteEstacionalHunter = cache.ajusteEstacionalHunter;
    }
    
    const sliderInput = document.getElementById('input-tiempo-manual-global');
    const sliderDisplay = document.getElementById('display-tiempo-manual-global');
    if(sliderInput && sliderDisplay) {
        sliderInput.value = tiempoManualGlobalConfigurado;
        sliderDisplay.innerText = tiempoManualGlobalConfigurado + "m";
    }

    const hunterInput = document.getElementById('input-hunter-estacional');
    const hunterDisplay = document.getElementById('display-hunter-estacional');
    if(hunterInput && hunterDisplay) {
        hunterInput.value = ajusteEstacionalHunter;
        hunterDisplay.innerText = ajusteEstacionalHunter + "%";
    }
    
    inyectarIconosEstaticosHardware();
}

function inyectarIconosEstaticosHardware() {
    const lblBomba = document.getElementById('hw-bomba');
    const lblValvula = document.getElementById('hw-tanque');
    if(lblBomba) lblBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
    if(lblValvula) lblValvula.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
}

function actualizarDisplayTimeout(valor) {
    timeoutTanqueConfigurado = parseInt(valor);
    const display = document.getElementById('display-timeout-tanque');
    if(display) display.innerText = valor === '0' ? 'Manual' : valor + 'm';
    local_guardarEstadoGlobal();
}

function actualizarDisplayHunter(valor) {
    ajusteEstacionalHunter = parseInt(valor);
    const display = document.getElementById('display-hunter-estacional');
    if(display) display.innerText = valor + "%";
    local_guardarEstadoGlobal();
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

    const titleProgs = document.createElement('div');
    titleProgs.className = "manual-section-title";
    titleProgs.innerText = `Programas Automáticos (Ajuste Estacional: ${ajusteEstacionalHunter}%)`;
    container.appendChild(titleProgs);

    programas.forEach(prog => {
        const card = document.createElement('div');
        card.className = "zone-card";
        card.style.marginBottom = "10px";
        
        let stringDias = prog.dias.map(d => diasSemana[d]).join(' - ');
        
        // CALCULO TIPO HUNTER: Aplica el factor estacional global a la visualización
        let listadoZonas = prog.zonas.map(z => {
            let minsCalculados = Math.max(1, Math.round(z.min * (ajusteEstacionalHunter / 100)));
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

function renderizarPantallaConfiguracion() {
    const container = document.getElementById('programas-master-container');
    if(!container) return;
    container.innerHTML = '';

    programas.forEach(prog => {
        const card = document.createElement('div');
        card.className = "zone-card";
        card.style.marginBottom = "15px";

        let stringDias = prog.dias.map(d => diasSemana[d]).join(' - ');
        
        let totalNominal = prog.zonas.reduce((acc, z) => acc + z.min, 0);
        let totalEscalado = prog.zonas.reduce((acc, z) => acc + Math.max(1, Math.round(z.min * (ajusteEstacionalHunter / 100))), 0);

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:8px;">
                <span style="font-size:16px; font-weight:bold; color:var(--dark);">📋 ${prog.nombre}</span>
                <div style="display:flex; gap:5px;">
                    <button class="btn" style="padding:6px 12px; font-size:12px; background:var(--primary);" onclick="abrirEditorPrograma(${prog.id})">📝 Modificar</button>
                    <button class="btn" style="padding:6px 12px; font-size:12px; background:var(--danger);" onclick="eliminarPrograma(${prog.id})">🗑️ Borrar</button>
                </div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; font-size:13px; color:#555;">
                <div>⏰ Hora Arranque: <strong>${prog.start_time} hs</strong></div>
                <div>⏱️ Duración Base: <strong>${totalNominal} min</strong></div>
                <div style="grid-column: span 2; margin-top:5px;">📅 Días de Riego: <span style="color:var(--primary); font-weight:bold;">${stringDias || 'Ninguno seleccionado'}</span></div>
                <div style="grid-column: span 2; margin-top:5px; color:var(--success); font-weight:bold;">⏱️ Tiempo con Ajuste Hunter (${ajusteEstacionalHunter}%): ${totalEscalado} min</div>
            </div>
        `;
        container.appendChild(card);
    });
}

function abrirEditorPrograma(id) {
    programaEditandoId = id;
    const prog = id ? programas.find(p => p.id === id) : { id: Date.now(), nombre: "Nuevo Programa", start_time: "07:00", dias: [], zonas: [] };
    
    if(!programas.find(p => p.id === id) && id !== null) return;

    document.getElementById('modal-titulo').innerText = id ? "Modificar Programa" : "Crear Nuevo Programa";
    document.getElementById('modal-nombre-prog').value = prog.nombre;
    document.getElementById('modal-start-time').value = prog.start_time;

    const selectorDias = document.getElementById('modal-days-selector');
    if(selectorDias) {
        selectorDias.innerHTML = '';
        diasSemana.forEach((dia, idx) => {
            const esSeleccionado = prog.dias.includes(idx);
            const btn = document.createElement('div');
            btn.className = `day-btn ${esSeleccionado ? 'selected' : ''}`;
            btn.innerText = dia;
            btn.onclick = () => {
                if(prog.dias.includes(idx)) prog.dias = prog.dias.filter(d => d !== idx);
                else prog.dias.push(idx);
                btn.classList.toggle('selected');
            };
            selectorDias.appendChild(btn);
        });
    }

    const contenedorZonas = document.getElementById('modal-zones-assignment');
    if(contenedorZonas) {
        contenedorZonas.innerHTML = '';
        zonasMaestras.forEach(zMaestra => {
            const zonaEnProg = prog.zonas.find(z => z.id === zMaestra.id);
            const asignada = !!zonaEnProg;
            const minutosRiego = asignada ? zonaEnProg.min : 0;

            const row = document.createElement('div');
            row.className = "zone-card";
            row.style.background = asignada ? "#e8f5e9" : "#f9f9f9";
            row.style.border = asignada ? "1px solid var(--success)" : "1px solid #ddd";
            row.style.marginBottom = "8px";

            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <label style="font-weight:bold; color:var(--dark);">
                        <input type="checkbox" id="chk-zona-${zMaestra.id}" ${asignada ? 'checked' : ''} onchange="toggleInclusionZonaFisica(${zMaestra.id})"> 
                        ${zMaestra.nombre}
                    </label>
                    <span class="time-display" id="lbl-min-prog-${zMaestra.id}" style="color:${asignada ? 'var(--success)':'#aaa'}">${minutosRiego}m</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:11px; color:#777;">Tiempo Nominal:</span>
                    <input type="range" min="1" max="60" value="${minutosRiego || 5}" id="slide-zona-${zMaestra.id}" ${!asignada ? 'disabled':''} style="flex-grow:1;" oninput="cambiarMinutosZonaPrograma(${zMaestra.id}, this.value)">
                </div>
            `;
            contenedorZonas.appendChild(row);
        });
    }

    if(!programas.find(p => p.id === id)) {
        programaEditandoId = "NUEVO";
        window.tempNuevoProg = prog;
    }
    document.getElementById('editor-modal-screen').style.display = 'block';
}

function toggleInclusionZonaFisica(idZona) {
    const chk = document.getElementById(`chk-zona-${idZona}`);
    const slide = document.getElementById(`slide-zona-${idZona}`);
    const lbl = document.getElementById(`lbl-min-prog-${idZona}`);
    const prog = programaEditandoId === "NUEVO" ? window.tempNuevoProg : programas.find(p => p.id === programaEditandoId);

    if(chk.checked) {
        slide.disabled = false;
        prog.zonas.push({id: idZona, min: parseInt(slide.value)});
        lbl.style.color = "var(--success)";
        lbl.innerText = slide.value + "m";
        chk.closest('.zone-card').style.background = "#e8f5e9";
        chk.closest('.zone-card').style.border = "1px solid var(--success)";
    } else {
        slide.disabled = true;
        prog.zonas = prog.zonas.filter(z => z.id !== idZona);
        lbl.style.color = "#aaa";
        lbl.innerText = "0m";
        chk.closest('.zone-card').style.background = "#f9f9f9";
        chk.closest('.zone-card').style.border = "1px solid #ddd";
    }
}

function cambiarMinutosZonaPrograma(idZona, valor) {
    const prog = programaEditandoId === "NUEVO" ? window.tempNuevoProg : programas.find(p => p.id === programaEditandoId);
    if(prog) {
        document.getElementById(`lbl-min-prog-${idZona}`).innerText = valor + "m";
        let zona = prog.zonas.find(z => z.id === idZona);
        if(zona) zona.min = parseInt(valor);
    }
}

function cerrarEditorModal() {
    document.getElementById('editor-modal-screen').style.display = 'none';
    window.tempNuevoProg = null;
}

function guardarCambiosPrograma() {
    const name = document.getElementById('modal-nombre-prog').value;
    const time = document.getElementById('modal-start-time').value;

    if(programaEditandoId === "NUEVO") {
        window.tempNuevoProg.nombre = name;
        window.tempNuevoProg.start_time = time;
        programas.push(window.tempNuevoProg);
    } else {
        let prog = programas.find(p => p.id === programaEditandoId);
        if(prog) { prog.nombre = name; prog.start_time = time; }
    }

    local_guardarEstadoGlobal();
    cerrarEditorModal();
    
    let path = window.location.pathname;
    if(path.includes("config.html")) renderizarPantallaConfiguracion();
    else renderizarMonitorPrincipal();
}

function eliminarPrograma(id) {
    if(confirm("¿Seguro que querés borrar este programa de riego?")) {
        programas = programas.filter(p => p.id !== id);
        local_guardarEstadoGlobal();
        renderizarPantallaConfiguracion();
    }
}

function toggleZonaManualDirecta(zonaId) {
    if (sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro') return;
    if (zonaActivaId === zonaId && sistemaEstado === 'riego_manual') { forzarParadaTotal(); return; }

    forzarParadaTotal();
    sistemaEstado = 'riego_manual';
    zonaActivaId = zonaId;
    tiempoRestanteActual = tiempoManualGlobalConfigurado; 
    tiempoInicialAsignado = tiempoManualGlobalConfigurado; 

    document.getElementById('hw-tanque').className = 'hw-badge closed';
    document.getElementById('hw-tanque').innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
    document.getElementById('hw-bomba').className = 'hw-badge on';
    document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING ⚡</span>`;

    arrancarBucleTiempoGenerico(false);
    renderizarMonitorPrincipal();
}

function lanzarProgramaDesdeMonitor(idProg) {
    forzarParadaTotal();
    const prog = programas.find(p => p.id === idProg);
    if(!prog || prog.zonas.length === 0) { alert("Este programa no tiene zonas asignadas."); return; }

    sistemaEstado = 'riego_auto';
    
    // FACTOR HUNTER APLICADO: Carga la cola con los minutos escalados según la estación
    listaZonasPrioridad = prog.zonas.map(z => {
        return {
            id: z.id,
            min: Math.max(1, Math.round(z.min * (ajusteEstacionalHunter / 100)))
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

        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
        document.getElementById('hw-bomba').className = 'hw-badge on';
        document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING ⚡</span>`;

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
    
    if(wrapper) wrapper.style.display = 'block';
    if(bar) bar.className = 'progress-bar';

    const hwBomba = document.getElementById('hw-bomba');
    if(hwBomba) {
        hwBomba.className = 'hw-badge on';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING ⚡</span>`;
    }

    document.getElementById('status-text').className = 'status-current running';
    document.getElementById('status-text').innerText = `${esAutomatico ? 'AUTO' : 'MANUAL'}: ZONA ${zonaActivaId} 💧`;

    if(window.cicloInterval) clearInterval(window.cicloInterval);
    window.cicloInterval = setInterval(() => {
        if (tiempoRestanteActual > 0) {
            document.getElementById('timer-remaining').innerText = `Tiempo restante: ${tiempoRestanteActual} min`;
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
    document.getElementById('hw-flotante').className = 'hw-badge alert';
    document.getElementById('hw-flotante').innerText = 'FLOTANTE: ¡DEMANDA AGUA! ⚠️';
    
    const btnSim = document.getElementById('btn-sim-flotante');
    btnSim.innerText = 'Tanque Lleno (Cortar Flotante)';
    btnSim.style.background = 'var(--success)';

    const estadoPrevio = sistemaEstado;
    const hwBomba = document.getElementById('hw-bomba');
    const hwTanque = document.getElementById('hw-tanque');

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
                hwTanque.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: ABIERTA</span>`;
            }
            document.getElementById('status-text').className = 'status-current paused';
            document.getElementById('status-text').innerText = `⏳ ESPERANDO BOMBA (500ms)`;

            setTimeout(() => {
                if (tanqueLlamando) {
                    if(hwBomba) {
                        hwBomba.className = 'hw-badge on';
                        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING (LLENANDO TANQUE) ⚡</span>`;
                    }
                    arrancarBucleTanque(timeoutTanqueConfigurado * 60);
                }
            }, 500);
            renderizarBotonesManualesEmulados();
        }, 500);
    } else {
        sistemaEstado = 'llenado_puro';
        renderizarBotonesManualesEmulados();
        if(hwTanque) {
            hwTanque.className = 'hw-badge';
            hwTanque.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: ABIERTA</span>`;
        }
        setTimeout(() => {
            if (tanqueLlamando) {
                if(hwBomba) {
                    hwBomba.className = 'hw-badge on';
                    hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING (LLENANDO TANQUE) ⚡</span>`;
                }
                arrancarBucleTanque(timeoutTanqueConfigurado * 60);
            }
        }, 500);
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
    
    if(wrapper) wrapper.style.display = 'block';
    if(bar) {
        bar.className = 'progress-bar paused';
        bar.style.width = '100%'; 
    }

    document.getElementById('status-text').className = 'status-current paused';
    document.getElementById('status-text').innerText = `⚠️ LLENANDO TANQUE`;

    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    window.tanqueInterval = setInterval(() => {
        if (tiempoLlenadoTanqueRestante > 0) {
            document.getElementById('timer-remaining').innerText = `Protección activa. Límite: ${tiempoLlenadoTanqueRestante} seg`;
            tiempoLlenadoTanqueRestante--;
        } else {
            detenerLlenadoSecuencial(true);
        }
    }, 1000);
}

function detenerLlenadoSecuencial(porTimeout) {
    if(window.tanqueInterval) clearInterval(window.tanqueInterval);
    const hwBomba = document.getElementById('hw-bomba');
    const hwTanque = document.getElementById('hw-tanque');

    if(hwBomba) {
        hwBomba.className = 'hw-badge';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
    }

    setTimeout(() => {
        if(hwTanque) {
            hwTanque.className = 'hw-badge closed';
            hwTanque.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
        }

        tanqueLlamando = false;
        const btnSim = document.getElementById('btn-sim-flotante');
        if(btnSim) { btnSim.innerText = 'Simular Falta de Agua (Llamar)'; btnSim.style.background = 'var(--warning)'; }

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
    if(lblText) {
        lblText.className = 'status-current'; lblText.innerText = '🏠 EN ESPERA (STANDBY)';
        document.getElementById('timer-remaining').innerText = '';
        document.getElementById('progress-wrapper').style.display = 'none';
        
        const hwBomba = document.getElementById('hw-bomba');
        const hwTanque = document.getElementById('hw-tanque');
        const hwFlotante = document.getElementById('hw-flotante');

        if(hwBomba) {
            hwBomba.className = 'hw-badge';
            hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: OFF</span>`;
        }
        if(hwTanque) {
            hwTanque.className = 'hw-badge closed';
            hwTanque.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
        }
        if(hwFlotante) {
            hwFlotante.className = 'hw-badge';
            hwFlotante.innerHTML = `<span>FLOTANTE: TANQUE OK</span>`;
        }
    }
    
    const sliderInput = document.getElementById('input-tiempo-manual-global');
    const sliderDisplay = document.getElementById('display-tiempo-manual-global');
    if(sliderInput && sliderDisplay) {
        sliderInput.value = tiempoManualGlobalConfigurado;
        sliderDisplay.innerText = tiempoManualGlobalConfigurado + "m";
    }

    const hunterInput = document.getElementById('input-hunter-estacional');
    const hunterDisplay = document.getElementById('display-hunter-estacional');
    if(hunterInput && hunterDisplay) {
        hunterInput.value = ajusteEstacionalHunter;
        hunterDisplay.innerText = ajusteEstacionalHunter + "%";
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
        ajuste_estacional_hunter: ajusteEstacionalHunter,
        programas: programas
    };
    console.log("JSON Maestro enviado hacia el LittleFS del ESP32:", JSON.stringify(payload, null, 2));
    alert("🚀 ¡Ajuste estacional Hunter y programas sincronizados con el ESP32!");
    navegarHacia("monitor.html");
}
