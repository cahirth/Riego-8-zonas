// ============================================================================
// FIRMWARE FRONTEND: Riego Hidráulico TLC
// VERSION: v2.2.5 (Build: 20260613-2115)
// DESCRIPCIÓN: Integración de iconografía industrial personalizada basada en JPGs
// ============================================================================

const CONFIG_VERSION = "v2.2.5 (Build: 20260613-2115)";

window.cicloInterval = null;
window.tanqueInterval = null;

const diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const nombresDiasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// ÍCONOS SVG PERSONALIZADOS BASADOS EN TUS FOTOS (CON DETALLE INDUSTRIAL)
const ICONO_ASPERSOR_JPG = `<svg viewBox="0 0 24 24" style="width:28px; height:28px; margin-bottom:4px; color:inherit;"><path fill="currentColor" d="M11 2h2v4h-2V2m-3.5 3.5l1.41 1.41L6.05 9.76 4.64 8.35 7.5 5.5M16.5 5.5l2.85 2.85-1.41 1.41-2.85-2.85 1.41-1.41M12 7a5 5 0 0 1 5 5c0 .73-.16 1.42-.44 2.05l2.44 2.44-1.42 1.42-2.44-2.44A5 5 0 0 1 12 17a5 5 0 0 1-5-5c0-.73.16-1.42.44-2.05L5 7.51l1.42-1.42 2.44 2.44A5 5 0 0 1 12 7m0 2a3 3 0 0 0-3 3c0 .41.08.8.23 1.16l3.93-3.93c-.36-.15-.75-.23-1.16-.23m1.16 1.16l-3.93 3.93c.36.15.75.23 1.16.23a3 3 0 0 0 3-3c0-.41-.08-.8-.23-1.16z"/></svg>`;
const ICONO_BOMBA_JPG = `<svg viewBox="0 0 24 24" style="width:24px; height:24px; vertical-align:middle; margin-right:8px;"><path fill="currentColor" d="M4 11h3v2H4v-2m15-4h-3v10h3c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2m-5 0h-2v10h2V7m-5 2h2v6H9V9m-4-5h14c1.66 0 3 1.34 3 3v10c0 1.66-1.34 3-3 3H5c-1.66 0-3-1.34-3-3V7c0-1.66 1.34-3 3-3z"/></svg>`;
const ICONO_FLOTANTE_JPG = `<svg viewBox="0 0 24 24" style="width:24px; height:24px; vertical-align:middle; margin-right:8px;"><path fill="currentColor" d="M12 2A2 2 0 0 1 14 4V7.16C17.45 7.82 20 10.85 20 14.5A8 8 0 0 1 12 22A8 8 0 0 1 4 14.5C4 10.85 6.55 7.82 10 7.16V4A2 2 0 0 1 12 2M12 9.5A5 5 0 0 0 7 14.5A5 5 0 0 0 12 19.5A5 5 0 0 0 17 14.5A5 5 0 0 0 12 9.5z"/></svg>`;

let zonasMaestras = [];
for (let i = 1; i <= 8; i++) {
    zonasMaestras.push({ id: i, nombre: `Zona Riego ${i}` });
}

let programas = [
    { id: 1, nombre: "Programa Mañana (A)", start_time: "06:00", dias: [1, 3, 5], zonas: [{id: 1, min: 10}, {id: 2, min: 15}] },
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

function trazarVersionCompilacion() {
    console.log(
        `%c 💧 TLC MULTIPROGRAMA CUSTOM — Active Version: ${CONFIG_VERSION} `,
        "background: #9C27B0; color: #ffffff; font-weight: bold; padding: 4px; border-radius: 4px;"
    );
}

function local_guardarEstadoGlobal() {
    const backup = {
        programas: programas,
        timeoutTanqueConfigurado: timeoutTanqueConfigurado,
        tiempoManualGlobalConfigurado: tiempoManualGlobalConfigurado
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
        if(cache.tiempoManualGlobalConfigurado) {
            tiempoManualGlobalConfigurado = cache.tiempoManualGlobalConfigurado;
        }
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

    if(lblBomba) {
        lblBomba.innerHTML = `${ICONO_BOMBA_JPG} <span id="txt-bomba">BOMBA: OFF</span>`;
    }
    if(lblValvula) {
        lblValvula.innerHTML = `${ICONO_FLOTANTE_JPG} <span id="txt-tanque">VALV. TANQUE: CERRADA (NC) 🔴</span>`;
    }
    if(lblFlotante) {
        lblFlotante.innerHTML = `<span>FLOTANTE: TANQUE OK</span>`;
    }
}

function actualizarDisplayTimeout(valor) {
    timeoutTanqueConfigurado = parseInt(valor);
    const display = document.getElementById('display-timeout-tanque');
    if(display) display.innerText = valor === '0' ? 'Manual' : valor + 'm';
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
        
        // INTEGRACIÓN FINAL: El botón de zona dibuja el aspersor sectorial de tu foto
        btn.innerHTML = `
            ${ICONO_ASPERSOR_JPG}
            <span>${zona.nombre}</span>
        `;
        gridZonas.appendChild(btn);
    });
    container.appendChild(gridZonas);

    const titleProgs = document.createElement('div');
    titleProgs.className = "manual-section-title";
    titleProgs.innerText = "Programas Automáticos Almacenados";
    container.appendChild(titleProgs);

    programas.forEach(prog => {
        const card = document.createElement('div');
        card.className = "zone-card";
        card.style.marginBottom = "10px";
        
        let stringDias = prog.dias.map(d => diasSemana[d]).join(' - ');
        let listadoZonas = prog.zonas.map(z => `Z${z.id} (${z.min}m)`).join(', ');

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>⚙️ ${prog.nombre}</strong> — <span style="color:var(--primary); font-weight:bold;">${prog.start_time} hs</span>
                    <div style="font-size:11px; color:#666; margin-top:4px;">Calendario: [${stringDias}]</div>
                    <div style="font-size:12px; color:var(--dark); font-weight:bold; margin-top:2px;">Zonas: ${listadoZonas || 'Ninguna'}</div>
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
        let totalMinutos = prog.zonas.reduce((acc, current) => acc + current.min, 0);

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
                <div>⏱️ Duración Total: <strong>${totalMinutos} min</strong></div>
                <div style="grid-column: span 2; margin-top:5px;">📅 Días de Riego: <span style="color:var(--primary); font-weight:bold;">${stringDias || 'Ninguno seleccionado'}</span></div>
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
                    <span style="font-size:11px; color:#777;">Tiempo:</span>
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
    if(path.includes("config.html")) {
        renderizarPantallaConfiguracion();
    } else {
        renderizarMonitorPrincipal();
    }
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

    const hwTanque = document.getElementById('hw-tanque');
    const hwBomba = document.getElementById('hw-bomba');
    if(hwTanque) {
        hwTanque.className = 'hw-badge closed';
        hwTanque.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
    }
    if(hwBomba) {
        hwBomba.className = 'hw-badge on';
        hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING ⚡</span>`;
    }

    arrancarBucleTiempoGenerico(false);
    renderizarMonitorPrincipal();
}

function lanzarProgramaDesdeMonitor(idProg) {
    forzarParadaTotal();
    const prog = programas.find(p => p.id === idProg);
    if(!prog || prog.zonas.length === 0) { alert("Este programa no tiene zonas asignadas."); return; }

    sistemaEstado = 'riego_auto';
    listaZonasPrioridad = [...prog.zonas]; 
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
            hwTanque.innerHTML = `${ICONO_FLOTANTE_JPG} <span>VALV. TANQUE: CERRADA (NC) 🔴</span>`;
        }
        if(hwBomba) {
            hwBomba.className = 'hw-badge on';
            hwBomba.innerHTML = `${ICONO_BOMBA_JPG} <span>BOMBA: RUNNING ⚡</span>`;
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
        programas: programas
    };
    console.log("JSON Maestro enviado hacia el LittleFS del ESP32:", JSON.stringify(payload, null, 2));
    alert("🚀 ¡Configuración de programas sincronizada por red con el ESP32!");
    navegarHacia("monitor.html");
}
