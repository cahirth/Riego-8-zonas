const diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const nombresDiasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

let zonas = [];
let cicloInterval = null;
let tanqueInterval = null;

let sistemaEstado = 'idle'; 
let zonaActivaId = null;
let tiempoRestanteActual = 0;
let tiempoLlenadoTanqueRestante = 0; 
let timeoutTanqueConfigurado = 1; 
let listaZonasPrioridad = [];
let tanqueLlamando = false;
let startTimeConfigurado = "07:00"; 
let diaHoyIndex = 0;

for (let i = 1; i <= 8; i++) {
    zonas.push({ id: i, nombre: `Zona Riego ${i}`, minutos: 5, dias: [1, 3, 5] });
}

function local_guardarEstadoGlobal() {
    const backup = {
        zonas: zonas,
        timeoutTanqueConfigurado: timeoutTanqueConfigurado,
        startTimeConfigurado: startTimeConfigurado
    };
    localStorage.setItem('TLC_RIEGO_DATA', JSON.stringify(backup));
}

function local_recuperarEstadoGoblal() {
    const datosGuardados = localStorage.getItem('TLC_RIEGO_DATA');
    if (datosGuardados) {
        const cache = JSON.parse(datosGuardados);
        zonas = cache.zonas;
        timeoutTanqueConfigurado = cache.timeoutTanqueConfigurado;
        startTimeConfigurado = cache.startTimeConfigurado;
    }
}

function actualizarFechaHoy() {
    const ahora = new Date();
    diaHoyIndex = ahora.getDay();
    const fechaString = ahora.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    
    const labelFecha = document.getElementById('display-fecha-hoy');
    const labelProximo = document.getElementById('display-proximo-riego');
    
    if(labelFecha) labelFecha.innerText = `Hoy: ${nombresDiasLargos[diaHoyIndex]} ${fechaString}`;
    if(labelProximo) labelProximo.innerText = `Programa automático fijado a las: ${startTimeConfigurado} hs`;
}

function renderizarBotonesManuales() {
    const container = document.getElementById('manual-buttons-container');
    if(!container) return; 
    container.innerHTML = '';

    const esBloqueadoPorTanque = sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro';

    zonas.forEach(zona => {
        const isActive = (zonaActivaId === zona.id && (sistemaEstado === 'riego_manual' || sistemaEstado === 'riego_auto'));
        const isPaused = (zonaActivaId === zona.id && sistemaEstado.startsWith('pausa_tanque'));
        
        let extraClass = '';
        let label = 'APAGADO';
        
        if(isActive) { extraClass = 'active'; label = 'REGANDO'; }
        else if(isPaused) { extraClass = 'paused'; label = 'PAUSADO'; }
        else if(esBloqueadoPorTanque) { extraClass = 'disabled'; label = 'BLOQUEADO'; }

        const btn = document.createElement('div');
        btn.className = `btn-manual ${extraClass}`;
        btn.onclick = () => { if(!esBloqueadoPorTanque) toggleZonaManual(zona.id); };
        btn.innerHTML = `
            <svg viewBox="0 0 24 24"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4Z"/></svg>
            <span>${zona.nombre}</span>
            <small style="font-size:10px; font-weight:bold;">${label}</small>
        `;
        container.appendChild(btn);
    });

    const btnAuto = document.getElementById('btn-auto-master');
    if(btnAuto) {
        if(esBloqueadoPorTanque) {
            btnAuto.classList.add('disabled');
            btnAuto.style.pointerEvents = 'none';
        } else {
            btnAuto.classList.remove('disabled');
            btnAuto.style.pointerEvents = 'auto';
        }
    }
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
        clearInterval(cicloInterval);
        document.getElementById('hw-bomba').className = 'hw-badge';
        document.getElementById('hw-bomba').innerText = 'BOMBA: OFF';

        setTimeout(() => {
            document.getElementById('hw-tanque').className = 'hw-badge';
            document.getElementById('hw-tanque').innerText = 'VALV. TANQUE: ABIERTA';
            document.getElementById('status-text').className = 'status-current paused';
            document.getElementById('status-text').innerText = `⏳ ESPERANDO BOMBA (500ms)`;

            setTimeout(() => {
                if (tanqueLlamando) {
                    document.getElementById('hw-bomba').className = 'hw-badge on';
                    document.getElementById('hw-bomba').innerText = 'BOMBA: RUNNING (LLENANDO TANQUE) ⚡';
                    if(timeoutTanqueConfigurado > 0) arrancarBucleTanque(timeoutTanqueConfigurado * 60);
                    else arrancarBucleTanqueInconmensurable();
                }
            }, 500);
            renderizarBotonesManuales();
        }, 500);
    } else {
        sistemaEstado = 'llenado_puro';
        renderizarBotonesManuales(); 
        document.getElementById('hw-tanque').className = 'hw-badge';
        document.getElementById('hw-tanque').innerText = 'VALV. TANQUE: ABIERTA';
        document.getElementById('status-text').className = 'status-current paused';
        document.getElementById('status-text').innerText = `⏳ ESPERANDO BOMBA (500ms)`;

        setTimeout(() => {
            if (tanqueLlamando) {
                document.getElementById('hw-bomba').className = 'hw-badge on';
                document.getElementById('hw-bomba').innerText = 'BOMBA: RUNNING (LLENANDO TANQUE) ⚡';
                if(timeoutTanqueConfigurado > 0) arrancarBucleTanque(timeoutTanqueConfigurado * 60);
                else arrancarBucleTanqueInconmensurable();
            }
        }, 500);
    }
}

function arrancarBucleTanque(segundosTotales) {
    tiempoLlenadoTanqueRestante = segundosTotales;
    document.getElementById('progress-wrapper').style.display = 'block';
    document.getElementById('cycle-progress').className = 'progress-bar paused'; 
    document.getElementById('status-text').className = 'status-current paused';
    document.getElementById('status-text').innerText = `⚠️ LLENANDO TANQUE`;

    if(tanqueInterval) clearInterval(tanqueInterval);
    tanqueInterval = setInterval(() => {
        if (tiempoLlenadoTanqueRestante > 0) {
            document.getElementById('timer-remaining').innerText = `Time-out activo. Restan: ${tiempoLlenadoTanqueRestante} seg`;
            let pct = ((segundosTotales - tiempoLlenadoTanqueRestante) / segundosTotales) * 100;
            document.getElementById('cycle-progress').style.width = `${pct}%`;
            tiempoLlenadoTanqueRestante--;
        } else {
            detenerLlenadoSecuencial(true); 
        }
    }, 1000); 
}

function arrancarBucleTanqueInconmensurable() {
    document.getElementById('progress-wrapper').style.display = 'block';
    document.getElementById('cycle-progress').className = 'progress-bar paused';
    document.getElementById('cycle-progress').style.width = `100%`;
    document.getElementById('status-text').className = 'status-current paused';
    document.getElementById('status-text').innerText = `⚠️ LLENANDO TANQUE (SIN TIMEOUT)`;
    document.getElementById('timer-remaining').innerText = `Requiere corte manual del flotante.`;
}

function detenerLlenadoSecuencial(porTimeout) {
    if(tanqueInterval) clearInterval(tanqueInterval);
    document.getElementById('hw-bomba').className = 'hw-badge';
    document.getElementById('hw-bomba').innerText = 'BOMBA: OFF';

    setTimeout(() => {
        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerText = 'VALV. TANQUE: CERRADA (NC) 🔴';

        tanqueLlamando = false;
        const btnSim = document.getElementById('btn-sim-flotante');
        if(btnSim) {
            btnSim.innerText = 'Simular Falta de Agua (Llamar)';
            btnSim.style.background = 'var(--warning)';
        }

        document.getElementById('hw-flotante').className = 'hw-badge';
        document.getElementById('hw-flotante').innerText = 'FLOTANTE: TANQUE OK';

        if (porTimeout && sistemaEstado.startsWith('pausa_tanque')) {
            alert("🚨 Alerta: Llenado excedió límite. Riego cancelado.");
            forzarParadaTotal();
            return;
        }

        if (sistemaEstado.startsWith('pausa_tanque')) restaurarRiegoPausado();
        else forzarParadaTotal();
    }, 500);
}

function restaurarRiegoPausado() {
    const origen = sistemaEstado;
    document.getElementById('cycle-progress').className = 'progress-bar'; 
    document.getElementById('status-text').className = 'status-current running';
    document.getElementById('status-text').innerText = `⏳ PREPARANDO RIEGO (500ms)`;

    setTimeout(() => {
        document.getElementById('hw-bomba').className = 'hw-badge on';
        document.getElementById('hw-bomba').innerText = 'BOMBA: RUNNING ⚡';

        if (origen === 'pausa_tanque_riego_manual') {
            sistemaEstado = 'riego_manual';
            arrancarBucleTiempo(false);
        } else if (origen === 'pausa_tanque_riego_auto') {
            sistemaEstado = 'riego_auto';
            arrancarBucleTiempo(true);
        }
        renderizarBotonesManuales();
    }, 500);
}

function toggleZonaManual(zonaId) {
    if (sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro') return;
    if (zonaActivaId === zonaId && sistemaEstado === 'riego_manual') { forzarParadaTotal(); return; }

    forzarParadaTotal();
    const zonaConfig = zonas.find(z => z.id === zonaId);
    if(zonaConfig.minutos === 0) return;

    sistemaEstado = 'riego_manual';
    zonaActivaId = zonaId;
    tiempoRestanteActual = zonaConfig.minutos;

    document.getElementById('hw-tanque').className = 'hw-badge closed';
    document.getElementById('hw-tanque').innerText = 'VALV. TANQUE: CERRADA (NC) 🔴';
    document.getElementById('hw-bomba').className = 'hw-badge on';
    document.getElementById('hw-bomba').innerText = 'BOMBA: RUNNING ⚡';

    arrancarBucleTiempo(false);
    renderizarBotonesManuales();
}

function arrancarBucleTiempo(esAutomatico) {
    document.getElementById('progress-wrapper').style.display = 'block';
    const zonaConfig = zonas.find(z => z.id === zonaActivaId);

    if(cicloInterval) clearInterval(cicloInterval);
    document.getElementById('status-text').className = 'status-current running';
    document.getElementById('status-text').innerText = `${esAutomatico ? 'AUTO' : 'MANUAL'}: RIEGO ZONA ${zonaActivaId} 💧`;

    cicloInterval = setInterval(() => {
        if (tiempoRestanteActual > 0) {
            document.getElementById('timer-remaining').innerText = `Tiempo restante: ${tiempoRestanteActual} min`;
            let pct = ((zonaConfig.minutos - tiempoRestanteActual) / zonaConfig.minutos) * 100;
            document.getElementById('cycle-progress').style.width = `${pct}%`;
            tiempoRestanteActual--;
        } else {
            clearInterval(cicloInterval);
            document.getElementById('hw-bomba').className = 'hw-badge';
            document.getElementById('hw-bomba').innerText = 'BOMBA: OFF';
            if (esAutomatico) avanzarCicloAutomatico();
            else forzarParadaTotal();
        }
    }, 1000); 
}

function ejecutarCicloAutomatico() {
    if (sistemaEstado.startsWith('pausa_tanque') || sistemaEstado === 'llenado_puro') return;
    forzarParadaTotal();
    sistemaEstado = 'riego_auto';
    listaZonasPrioridad = zonas.filter(z => z.minutos > 0).map(z => z.id);
    if(listaZonasPrioridad.length === 0) { sistemaEstado = 'idle'; return; }
    avanzarCicloAutomatico();
}

function avanzarCicloAutomatico() {
    if (listaZonasPrioridad.length > 0) {
        zonaActivaId = listaZonasPrioridad.shift();
        tiempoRestanteActual = zonas.find(z => z.id === zonaActivaId).minutos;
        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerText = 'VALV. TANQUE: CERRADA (NC) 🔴';
        document.getElementById('hw-bomba').className = 'hw-badge on';
        document.getElementById('hw-bomba').innerText = 'BOMBA: RUNNING ⚡';
        arrancarBucleTiempo(true);
        renderizarBotonesManuales();
    } else {
        forzarParadaTotal();
        setTimeout(() => { alert("✅ Ciclo de riego completo finalizado."); }, 200);
    }
}

function forzarParadaTotal() {
    if(cicloInterval) clearInterval(cicloInterval);
    if(tanqueInterval) clearInterval(tanqueInterval);
    
    sistemaEstado = 'idle';
    zonaActivaId = null;
    tiempoRestanteActual = 0;
    listaZonasPrioridad = [];
    tanqueLlamando = false;

    const lblText = document.getElementById('status-text');
    const lblTime = document.getElementById('timer-remaining');
    const wrapper = document.getElementById('progress-wrapper');
    const progress = document.getElementById('cycle-progress');

    if(lblText) {
        lblText.className = 'status-current';
        lblText.innerText = '🏠 EN ESPERA (STANDBY)';
        lblTime.innerText = '';
        wrapper.style.display = 'none';
        progress.style.width = '0%';
        progress.className = 'progress-bar';
        
        document.getElementById('hw-bomba').className = 'hw-badge';
        document.getElementById('hw-bomba').innerText = 'BOMBA: OFF';
        document.getElementById('hw-tanque').className = 'hw-badge closed';
        document.getElementById('hw-tanque').innerText = 'VALV. TANQUE: CERRADA (NC) 🔴';
        document.getElementById('hw-flotante').className = 'hw-badge';
        document.getElementById('hw-flotante').innerText = 'FLOTANTE: TANQUE OK';
    }

    actualizarFechaHoy();
    renderizarBotonesManuales();
}

function actualizarDisplayTimeout(valor) {
    timeoutTanqueConfigurado = parseInt(valor);
    document.getElementById('display-timeout-tanque').innerText = valor === '0' ? 'Manual' : valor + 'm';
}

function actualizarStartTime(valor) {
    startTimeConfigurado = valor;
}

function renderizarConfiguracion() {
    document.getElementById('input-timeout-tanque').value = timeoutTanqueConfigurado;
    document.getElementById('display-timeout-tanque').innerText = timeoutTanqueConfigurado === 0 ? 'Manual' : timeoutTanqueConfigurado + 'm';
    document.getElementById('input-start-time').value = startTimeConfigurado;

    const container = document.getElementById('zones-master');
    container.innerHTML = '';
    
    const hoyIdx = new Date().getDay();

    zonas.forEach((zona, index) => {
        const card = document.createElement('div');
        card.className = 'zone-card';
        card.innerHTML = `
            <div class="zone-title-card">
                <svg viewBox="0 0 24 24"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4Z"/></svg>
                <span>${zona.nombre}</span>
            </div>
            <div class="timer-control">
                <span>Minutos:</span>
                <input type="range" min="0" max="60" value="${zona.minutos}" oninput="cambiarMinutos(${index}, this.value)">
                <span class="time-display" id="display-min-${index}">${zona.minutos}m</span>
            </div>
            <div class="days-selector">
                ${diasSemana.map((dia, dIdx) => `
                    <div class="day-btn ${zona.dias.includes(dIdx) ? 'selected' : ''} ${dIdx === hoyIdx ? 'today' : ''}" 
                         onclick="toggleDia(${index}, ${dIdx})">${dia}</div>
                `).join('')}
            </div>
        `;
        container.appendChild(card);
    });
}

function cambiarMinutos(index, valor) {
    zonas[index].minutos = parseInt(valor);
    document.getElementById(`display-min-${index}`).innerText = valor + 'm';
}

function toggleDia(zIdx, dIdx) {
    const arr = zonas[zIdx].dias;
    const posicion = arr.indexOf(dIdx);
    if(posicion > -1) arr.splice(posicion, 1);
    else arr.push(dIdx);
    renderizarConfiguracion();
}

function guardarConfiguracion() {
    local_guardarEstadoGlobal(); 
    window.location.href = "monitor.html"; 
}
