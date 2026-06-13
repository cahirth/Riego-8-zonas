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
        document.getElementById('hw-tanque').className
