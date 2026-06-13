// ============================================================================
// FIRMWARE FRONTEND: Riego Hidráulico TLC
// VERSION: v2.2.0 (Build: 20260613-1905)
// DESCRIPCIÓN: Consolidación total de Bugs (Bomba, Timeout, Modal) + Iconografía Profesional
// ============================================================================

const CONFIG_VERSION = "v2.2.0 (Build: 20260613-1905)";

window.cicloInterval = null;
window.tanqueInterval = null;

const diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const nombresDiasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// ÍCONOS SVG INDUSTRIALES EN ALTA RESOLUCIÓN
const ICONO_ASPERSOR = `<svg viewBox="0 0 24 24" style="width:24px; height:24px; margin-bottom:4px;"><path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v2.07c2.42.44 4.34 2.36 4.78 4.78H21a1 1 0 1 1 0 2h-3.15c-.44 2.42-2.36 4.34-4.78 4.78V21a1 1 0 1 1-2 0v-2.15c-2.42-.44-4.34-2.36-4.78-4.78H3a1 1 0 1 1 0-2h3.15c.44-2.42 2.36-4.34 4.78-4.78V3a1 1 0 0 1 1-1m0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10m0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>`;
const ICONO_BOMBA = `<svg viewBox="0 0 24 24" style="width:22px; height:22px; vertical-align:middle; margin-right:6px;"><path fill="currentColor" d="M12 2a3 3 0 0 0-3 3v1.17A5 5 0 0 0 5 11v2a5 5 0 0 0 4 4.9V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2.1a5 5 0 0 0 4-4.9v-2a5 5 0 0 0-4-4.83V5a3 3 0 0 0-3-3M11 5a1 1 0 0 1 2 0v1h-2V5m1 3a3 3 0 0 1 3 3v2h-6v-2a3 3 0 0 1 3-3z"/></svg>`;
const ICONO_VALVULA = `<svg viewBox="0 0 24 24" style="width:22px; height:22px; vertical-align:middle; margin-right:6px;"><path fill="currentColor" d="M19 6h-4V3a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-8-2h2v2h-2V4m8 8H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1M12 14c-3.31 0-6 2.69-6 6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1c0-3.31-2.69-6-6-6z"/></svg>`;

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
        `%c 💧 TLC MULTIPROGRAMA INDUSTRIAL — Active Version: ${CONFIG_VERSION} `,
        "background: #2196F3; color: #ffffff; font-weight: bold; padding: 4px; border-radius: 4px;"
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
    
    // Inyecta íconos dinámicos en los badges fijos del monitor de hardware
    const lblBomba = document.getElementById('hw-bomba');
    const lblValvula = document.getElementById('hw-tanque');
    if(lblBomba && !lblBomba.innerHTML.includes('<svg')) {
        lblBomba.insertAdjacentHTML('afterbegin', ICONO_BOMBA);
    }
    if(lblValvula && !lblValvula.innerHTML.includes('<svg')) {
        lblValvula.insertAdjacentHTML('afterbegin', ICONO_VALVULA);
    }
}

function actualizarDisplayTimeout(valor) {
    // FIX 3: El slider de ajustes ahora pisa inmediatamente la variable global
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
        
        // DISEÑO 1: Inyección de ícono de aspersor de impacto profesional
        btn.innerHTML = `
            ${ICONO_ASPERSOR}
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
    
    // FIX 2 (Línea 298): Función agregada explícitamente dentro del flujo para limpiar el ReferenceError
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

    // DISEÑO 2: Inyección de ícono de bomba centrífuga en el badge activo
    document.getElementById('hw-tanque').className = 'hw-badge closed';
    document.getElementById('hw-tanque').innerHTML = `${ICONO_VALVULA} VALV. TANQUE: CERRADA (NC) 🔴`;
    document.getElementById('hw-bomba').className = 'hw-badge on';
    document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: RUNNING ⚡`;

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

        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerHTML = `${ICONO_VALVULA} VALV. TANQUE: CERRADA (NC) 🔴`;
        document.getElementById('hw-bomba').className = 'hw-badge on';
        document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: RUNNING ⚡`;

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

    // FIX 1: Fuerza y asegura el re-encendido visual y lógico de la bomba al levantar el bucle tras la pausa
    const hwBomba = document.getElementById('hw-bomba');
    if(hwBomba) {
        hwBomba.className = 'hw-badge on';
        hwBomba.innerHTML = `${ICONO_BOMBA} BOMBA: RUNNING ⚡`;
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
            document.getElementById('hw-bomba').className = 'hw-badge';
            document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: OFF`;
            
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

    if (estadoPrevio === 'riego_manual' || estadoPrevio === 'riego_auto') {
        sistemaEstado = 'pausa_tanque_' + estadoPrevio; 
        if(window.cicloInterval) clearInterval(window.cicloInterval);
        document.getElementById('hw-bomba').className = 'hw-badge';
        document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: OFF`;

        setTimeout(() => {
            document.getElementById('hw-tanque').className = 'hw-badge';
            document.getElementById('hw-tanque').innerHTML = `${ICONO_VALVULA} VALV. TANQUE: ABIERTA`;
            document.getElementById('status-text').className = 'status-current paused';
            document.getElementById('status-text').innerText = `⏳ ESPERANDO BOMBA (500ms)`;

            setTimeout(() => {
                if (tanqueLlamando) {
                    document.getElementById('hw-bomba').className = 'hw-badge on';
                    document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: RUNNING (LLENANDO TANQUE) ⚡`;
                    arrancarBucleTanque(timeoutTanqueConfigurado * 60);
                }
            }, 500);
            renderizarBotonesManualesEmulados();
        }, 500);
    } else {
        sistemaEstado = 'llenado_puro';
        renderizarBotonesManualesEmulados();
        document.getElementById('hw-tanque').className = 'hw-badge';
        document.getElementById('hw-tanque').innerHTML = `${ICONO_VALVULA} VALV. TANQUE: ABIERTA`;
        setTimeout(() => {
            if (tanqueLlamando) {
                document.getElementById('hw-bomba').className = 'hw-badge on';
                document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: RUNNING (LLENANDO TANQUE) ⚡`;
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
    document.getElementById('hw-bomba').className = 'hw-badge';
    document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: OFF`;

    setTimeout(() => {
        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerHTML = `${ICONO_VALVULA} VALV. TANQUE: CERRADA (NC) 🔴`;

        tanqueLlamando = false;
        const btnSim = document.getElementById('btn-sim-flotante');
        if(btnSim) { btnSim.innerText = 'Simular Falta de Agua (Llamar)'; btnSim.style.background = 'var(--warning)'; }

        if (porTimeout && sistemaEstado.startsWith('pausa_tanque')) {
            alert("🚨 Abortado: Falla crítica de time-out en tanque.");
            forzarParadaTotal();
            return;
        }

        if (sistemaEstado.startsWith('pausa_tanque')) {
            // FIX 1 FINAL: Setea correctamente el estado recuperado antes de encender la bomba
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
        
        document.getElementById('hw-bomba').className = 'hw-badge';
        document.getElementById('hw-bomba').innerHTML = `${ICONO_BOMBA} BOMBA: OFF`;
        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerHTML = `${ICONO_VALVULA} VALV. TANQUE: CERRADA (NC) 🔴`;
        document.getElementById('hw-flotante').className = 'hw-badge';
        document.getElementById('hw-flotante').innerText = 'FLOTANTE: TANQUE OK';
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
