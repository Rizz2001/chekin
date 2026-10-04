const puppeteerCore = require('puppeteer-core');
const { addExtra } = require('puppeteer-extra');
const puppeteer = addExtra(puppeteerCore);
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

const { app } = require('electron');
const userDataPath = app.getPath('userData');

puppeteer.use(StealthPlugin());

// ---------------------------------------------------------------------------
// CONSTANTES DE CONFIGURACIÓN
// ---------------------------------------------------------------------------
const CACHE_MAX_DIAS          = 30;
const MONITOR_INTERVAL_S      = 10;
const MONITOR_TICK_MS         = 1_000;
const TABLE_LOAD_TIMEOUT_MS   = 60_000;
const RELOAD_TIMEOUT_MS       = 60_000;
const NAV_WAIT_RENDER_MS      = 5_000;
const NAV_WAIT_MENU_MS        = 3_000;
const BACKOFF_INITIAL_MS      = 5_000;
const BACKOFF_MAX_MS          = 120_000;
// ---------------------------------------------------------------------------

let browser = null;
let page = null;
let isInitializing = false; // FIX: evita llamadas paralelas a iniciarBanco

// Archivo de caché persistente (ahora en userData para evitar problemas de permisos)
const CACHE_FILE = path.join(userDataPath, 'cache_pagos.json');
const SHIFT_FILE = path.join(userDataPath, 'shift.json');
const DEBUG_FILE = path.join(userDataPath, 'debug.log');

function dlog(msg) {
    console.log(msg);
    try { fs.appendFileSync(DEBUG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch(e){}
}

let shiftStart = 0;

// FIX: Cambiado de Set a Map (ref -> fecha) para poder expirar entradas antiguas
let referenciasVistas = new Map();

// ---------------------------------------------------------------------------
// GESTIÓN DE CACHÉ Y RECUPERACIÓN DE APAGONES
// ---------------------------------------------------------------------------

let isFirstRun = true;

/**
 * Carga la caché desde disco.
 * Migra automáticamente el formato antiguo al nuevo ({ref, monto, fecha, textoCompleto}).
 * Purga entradas con más de CACHE_MAX_DIAS días.
 */
function cargarCache() {
    // 1. Cargar el inicio de la Jornada actual (Shift)
    try {
        if (fs.existsSync(SHIFT_FILE)) {
            const data = JSON.parse(fs.readFileSync(SHIFT_FILE, 'utf8'));
            shiftStart = data.shiftStart || Date.now();
        } else {
            shiftStart = Date.now();
            fs.writeFileSync(SHIFT_FILE, JSON.stringify({ shiftStart }), 'utf8');
        }
    } catch (e) {
        shiftStart = Date.now();
    }

    // 2. Cargar caché de pagos (historial de 30 días para evitar repetidos)
    try {
        if (!fs.existsSync(CACHE_FILE)) {
            isFirstRun = true;
            return;
        }
        
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (data.length === 0) {
            isFirstRun = true;
            return;
        }

        isFirstRun = false;
        const hoy = new Date().toISOString().slice(0, 10);
        const limite = new Date();
        limite.setDate(limite.getDate() - CACHE_MAX_DIAS);

        for (const item of data) {
            if (typeof item === 'string') {
                // Formato muy antiguo
                referenciasVistas.set(item, { ref: item, monto: '0,00', fecha: hoy, timestamp: Date.now() });
            } else if (item && item.ref && item.fecha) {
                const fechaItem = new Date(item.fecha);
                if (fechaItem >= limite) {
                    item.timestamp = item.timestamp || fechaItem.getTime();
                    referenciasVistas.set(item.ref, item);
                }
            }
        }
    } catch (e) {
        console.error("Error cargando caché:", e);
        isFirstRun = true; // Ante la duda, asume primera vez
    }
}

/** Guarda la caché al disco en el nuevo formato. */
function guardarCache() {
    try {
        const arr = Array.from(referenciasVistas.values());
        fs.writeFileSync(CACHE_FILE, JSON.stringify(arr), 'utf8');
    } catch (e) {
        console.error("Error guardando caché:", e);
    }
}

/** Agrega un movimiento al caché con la fecha actual. */
function agregarACache(mov) {
    // FIX: siempre usar la fecha REAL de hoy (no ayer)
    const ahora = new Date();
    const fecha = ahora.toISOString().slice(0, 10);
    const timestamp = ahora.getTime();
    if (typeof mov === 'string') {
        referenciasVistas.set(mov, { ref: mov, monto: '0,00', fecha, timestamp });
    } else {
        referenciasVistas.set(mov.referencia, { 
            ref: mov.referencia, 
            monto: mov.monto, 
            textoCompleto: mov.textoCompleto, 
            fecha,
            timestamp
        });
    }
}

/** Obtiene todos los pagos registrados desde que inició la jornada. */
function obtenerPagosDelDia() {
    const pagos = [];
    for (const item of referenciasVistas.values()) {
        const t = item.timestamp || 0;
        if (t >= shiftStart && item.monto && item.monto !== '0,00') {
            pagos.push(item);
        }
    }
    pagos.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    return pagos;
}

/** Cierra la jornada actual y empieza una nueva (reinicia los reportes pero mantiene el caché histórico). */
function cerrarJornada() {
    shiftStart = Date.now();
    try {
        fs.writeFileSync(SHIFT_FILE, JSON.stringify({ shiftStart }), 'utf8');
    } catch (e) { console.error(e); }
}

/**
 * Exporta los pagos del turno actual a un archivo CSV en el Escritorio del usuario.
 * @param {string} desktopPath - Ruta al Escritorio (viene de app.getPath('desktop'))
 * @returns {string} Ruta completa del archivo generado
 */
function exportarCSV(desktopPath) {
    const pagos = obtenerPagosDelDia();
    if (pagos.length === 0) return null;

    const dateSuffix = new Date().toISOString().slice(0, 10);
    const timeSuffix = new Date().toLocaleTimeString('es-VE', { hour12: false }).replace(/:/g, '');
    const fileName  = `Pagos_${dateSuffix}_${timeSuffix}.csv`;
    const filePath  = path.join(desktopPath, fileName);

    // Cabecera + filas
    const lineas = ['Nro,Referencia,Monto (Bs.),Fecha,Hora'];
    pagos.forEach((p, i) => {
        const fecha = p.fecha || dateSuffix;
        const hora  = p.timestamp
            ? new Date(p.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
            : '--:--';
        lineas.push(`${i + 1},${p.ref},${p.monto},${fecha},${hora}`);
    });

    fs.writeFileSync(filePath, lineas.join('\r\n'), 'utf8');
    console.log('[BOT] CSV exportado en:', filePath);
    return filePath;
}

// ---------------------------------------------------------------------------
// HELPERS DE NAVEGACIÓN — FIX: código duplicado extraído a función reutilizable
// ---------------------------------------------------------------------------

/**
 * Navega desde el dashboard principal a la sección de Movimientos o permite navegación manual.
 * @param {Function} logCallback
 */
async function navegarAMovimientos(logCallback = () => {}) {
    logCallback('Buscando movimientos o esperando tu intervención manual...');

    // Le damos hasta 2 minutos (TABLE_LOAD_TIMEOUT_MS * 2) de paciencia total
    const maxIntentos = (TABLE_LOAD_TIMEOUT_MS * 2) / 2000;
    let intentos = 0;

    while (intentos < maxIntentos) {
        if (!page || page.isClosed()) break;

        try {
            const estado = await page.evaluate(() => {
                const txt = document.body.textContent.toLowerCase();
                const hayTabla = document.querySelectorAll('tr').length > 0 ||
                                 document.querySelectorAll('table').length > 0 ||
                                 document.querySelectorAll('.mat-row').length > 0;
                
                // ¿Ya estamos en la tabla?
                const estamosEnMovimientos = (txt.includes('movimientos') && hayTabla) ||
                                             (txt.includes('fecha') && txt.includes('monto') && txt.includes('referencia'));
                if (estamosEnMovimientos) return 'LISTO';

                // ¿Está abierto el menú con la opción "Movimientos"?
                const allElements = Array.from(document.querySelectorAll('*'));
                const btnMov = allElements.find(el => {
                    const text = (el.textContent || '').trim().toLowerCase();
                    return (text === 'movimientos' || text === 'ver movimientos') && el.children.length === 0;
                });
                
                if (btnMov) {
                    btnMov.click();
                    if (btnMov.parentElement) btnMov.parentElement.click();
                    return 'CLICK_MENU_MOVIMIENTOS';
                }

                // ¿Vemos el botón general de "Más opciones"?
                const optionsBtn = document.querySelector('.summary-section-card-options');
                if (optionsBtn) {
                    optionsBtn.click();
                    const texto = document.querySelector('.summary-section-card-options__value');
                    if (texto) texto.click();
                    return 'CLICK_MAS_OPCIONES';
                }

                return 'ESPERANDO';
            });

            if (estado === 'LISTO') {
                logCallback('¡Tabla de movimientos detectada con éxito!');
                return; // Navegación completada
            } else if (estado === 'CLICK_MAS_OPCIONES') {
                logCallback('Presionando "Más opciones"... (puedes ayudar manualmente)');
            } else if (estado === 'CLICK_MENU_MOVIMIENTOS') {
                logCallback('Presionando "Ver Movimientos"... (puedes ayudar manualmente)');
            } else {
                // ESPERANDO: puede estar cargando o el usuario está seleccionando otra cuenta
                logCallback('Esperando a llegar a Movimientos... (puedes navegar tú mismo)');
            }

        } catch (e) {
            // Error silencioso, el DOM pudo estar recargándose
        }

        await new Promise(r => setTimeout(r, 2000));
        intentos++;
    }

    throw new Error('Tiempo de espera agotado. El bot no encontró la tabla ni detectó navegación manual.');
}

// ---------------------------------------------------------------------------
// FUNCIONES PRINCIPALES
// ---------------------------------------------------------------------------

/**
 * Busca un navegador (Chrome o Edge) instalado en el sistema
 * para no depender del Chromium descargado por Puppeteer (útil en modo portable).
 */
function findBrowserPath() {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Inicia el navegador y hace el login en el banco.
 * @param {Object} config - { cedula, clave }
 * @param {Function} logCallback - Función para enviar mensajes de estado a la interfaz
 */
async function iniciarBanco(config, logCallback = () => {}) {
    // FIX: semáforo para evitar condición de carrera con doble clic
    if (isInitializing) {
        return { exito: false, mensaje: 'Ya hay una sesión iniciándose, por favor espera.' };
    }
    isInitializing = true;

    try {
        if (!browser) {
            const execPath = findBrowserPath();
            const launchOptions = {
                headless: false,
                defaultViewport: null,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--start-maximized',
                    '--disable-dev-shm-usage',
                    '--disable-extensions'
                ]
            };
            
            if (config.recordarNavegador) {
                launchOptions.userDataDir = path.join(userDataPath, 'puppeteer_profile');
                dlog(`[BOT] Modo Recordar Navegador activado (userDataDir asignado).`);
            } else {
                // Solo deshabilitar GPU si no nos importa el fingerprinting
                launchOptions.args.push('--disable-gpu');
            }
            
            if (execPath) {
                launchOptions.executablePath = execPath;
                dlog(`[BOT] Usando navegador del sistema: ${execPath}`);
            } else {
                dlog(`[BOT] WARNING: No se encontró Chrome/Edge en rutas estándar. Usando Chromium interno.`);
            }

            browser = await puppeteer.launch(launchOptions);
        }

        const oldPage = page;
        page = await browser.newPage();
        if (oldPage) {
            await oldPage.close().catch(() => {});
        }
        // FIX: Evitar que el navegador se congele si el banco lanza un alert() nativo de sesión expirada
        page.on('dialog', async dialog => {
            console.log('[BOT] Alerta nativa descartada:', dialog.message());
            await dialog.accept().catch(() => {});
        });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        logCallback('Navegando al Banco Mercantil...');
        await page.goto('https://www30.mercantilbanco.com/login', { waitUntil: 'networkidle2' });

        logCallback('Ingresando credenciales...');

        // Esperar a que cargue la pantalla (ya sea pidiendo usuario o solo contraseña)
        await page.waitForSelector('#username, #password', { visible: true, timeout: 15000 });
        await new Promise(r => setTimeout(r, Math.random() * 500 + 500));

        // Verificar dinámicamente si el banco está pidiendo la cédula
        const pideUsuario = await page.evaluate(() => {
            const u = document.querySelector('#username');
            // Existe, no está bloqueado, y es visible en pantalla
            return u && !u.disabled && !u.readOnly && u.offsetParent !== null;
        });

        if (pideUsuario) {
            await page.type('#username', config.cedula, { delay: 120 });
            await new Promise(r => setTimeout(r, Math.random() * 800 + 400));
        }

        // Ingresar siempre la contraseña
        await page.type('#password', config.clave, { delay: 150 });

        await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 })
                .catch(() => console.log('Sin navegación completa (posiblemente SPA).')),
            page.keyboard.press('Enter')
        ]);

        logCallback('Validando inicio de sesión o intervención manual...');

        let detectoDashboard = false;
        let detectoPreguntas = false;
        let intentoMarcarFrecuente = false;

        // Loop de chequeo: esperamos a que el usuario resuelva las preguntas
        while (!detectoDashboard) {
            try {
                if (page.isClosed()) break;
                const estado = await page.evaluate(() => {
                    const txt = document.body.innerText.toLowerCase();
                    const dash = txt.includes('posición consolidada') ||
                                 txt.includes('mi posición actual') ||
                                 txt.includes('ocultar saldos') ||
                                 txt.includes('accesos rápidos') ||
                                 txt.includes('cerrar sesión') ||
                                 txt.includes('cuenta corriente') ||
                                 document.querySelector('mat-card') !== null;
                    const preg = txt.includes('preguntas de seguridad');
                    const verificar = txt.includes('verifica tu conexión');
                    return { dash, preg, verificar };
                });

                if (estado.dash) {
                    detectoDashboard = true;
                    logCallback('¡Panel principal detectado con éxito!');
                    break;
                }

                if ((estado.preg || estado.verificar) && !detectoPreguntas) {
                    detectoPreguntas = true;
                    logCallback('⚠️ ATENCIÓN: El banco solicita preguntas de seguridad. Resuélvelas en la ventana del navegador.');
                }
                
                // Intentar marcar el toggle de "Equipo Frecuente" automáticamente
                if (estado.preg && config.recordarNavegador && !intentoMarcarFrecuente) {
                    intentoMarcarFrecuente = await page.evaluate(() => {
                        const elementos = Array.from(document.querySelectorAll('.mat-slide-toggle-content, .mat-checkbox-label, label'));
                        const el = elementos.find(e => {
                            const txt = e.textContent.toLowerCase();
                            return txt.includes('frecuente') || txt.includes('recordar');
                        });
                        
                        if (el) {
                            const toggle = el.closest('mat-slide-toggle');
                            if (toggle && !toggle.classList.contains('mat-checked')) {
                                toggle.click(); return true;
                            }
                            const checkbox = el.closest('mat-checkbox');
                            if (checkbox && !checkbox.classList.contains('mat-checkbox-checked')) {
                                checkbox.click(); return true;
                            }
                            const input = el.parentElement.querySelector('input[type="checkbox"]');
                            if (input && !input.checked) {
                                input.click(); return true;
                            }
                        }
                        return false; // No lo encontró todavía (puede estar cargando)
                    });
                }

            } catch (err) {
                // Silencioso — la página puede estar navegando/cargando
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!detectoDashboard) {
            return { exito: false, mensaje: 'No se pudo detectar el panel principal después del login.' };
        }

        logCallback('Navegando a los movimientos de la cuenta...');
        // FIX: usar función centralizada en lugar de código duplicado
        await navegarAMovimientos(logCallback);

        logCallback('¡Inicio de sesión completado y movimientos listos!');
        return { exito: true, mensaje: 'Conectado al banco correctamente.' };

    } catch (error) {
        console.error("Error en iniciarBanco:", error);
        if (browser) {
            await browser.close().catch(() => {});
            browser = null;
            page = null;
        }
        return { exito: false, mensaje: error.message };
    } finally {
        // FIX: siempre liberar el semáforo, tanto en éxito como en error
        isInitializing = false;
    }
}

/** Normaliza un monto con formato venezolano (1.000,00 o 150,00) a número JS. */
function parseMontoNum(m) {
    let str = String(m);
    if (str.includes(',') && str.includes('.')) {
        str = str.replace(/\./g, '').replace(',', '.'); // "1.000,00" -> "1000.00"
    } else if (str.includes(',')) {
        str = str.replace(',', '.'); // "150,00" -> "150.00"
    }
    return parseFloat(str);
}

/**
 * Verifica si existe un pago con la referencia y monto dados en los movimientos actuales.
 * @param {string} referencia - Últimos 4 dígitos (o referencia completa)
 * @param {string|number} monto
 */
async function chequearPago(referencia, monto) {
    if (!browser || !page) {
        return { exito: false, mensaje: "El navegador no está conectado al banco." };
    }

    try {
        const movimientos = await extraerMovimientosDOM();
        const match = movimientos.find(m =>
            m.referencia === referencia || m.referencia.endsWith(referencia)
        );

        if (match) {
            const montoBuscado = parseMontoNum(monto);
            const montoBanco = parseMontoNum(match.monto);

            if (montoBuscado === montoBanco) {
                return { exito: true, mensaje: `¡Pago verificado exacto! Ref: *${match.referencia} | Monto: Bs. ${match.monto}` };
            } else {
                return { exito: false, mensaje: `Referencia *${match.referencia} encontrada, PERO el monto es Bs. ${match.monto} (tú buscaste ${monto}).` };
            }
        } else {
            return { exito: false, mensaje: `No se encontró ningún pago con la referencia *${referencia} en la pantalla actual.` };
        }

    } catch (error) {
        console.error("Error al buscar el pago:", error);
        return { exito: false, mensaje: "Error interno al leer los movimientos." };
    }
}

/** Extrae el saldo disponible del DOM de la página actual. */
async function extraerSaldo() {
    if (!page) return "0,00";
    return await page.evaluate(() => {
        // FIX: textContent en vez de innerText — evita forzar layout reflow del navegador
        // Opción 1: Fila "SALDO FINAL" en la tabla
        let rows = Array.from(document.querySelectorAll('tr'));
        for (let row of rows) {
            let text = row.textContent;
            if (text.toUpperCase().includes('SALDO FINAL')) {
                let montoMatch = text.match(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/);
                if (montoMatch) return montoMatch[0];
            }
        }

        // Opción 2: Tarjetas con "DISPONIBLE" y "Bs."
        const elements = Array.from(document.querySelectorAll('div, mat-card'));
        for (let el of elements) {
            let txt = el.textContent;
            if (txt && txt.toUpperCase().includes('DISPONIBLE') && txt.includes('Bs.')) {
                let montoMatch = txt.match(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/);
                if (montoMatch) return montoMatch[0];
            }
        }

        return "0,00";
    });
}

/** Extrae todos los movimientos de Pago Móvil desde la tabla del DOM. */
async function extraerMovimientosDOM() {
    if (!page) return [];
    return await page.evaluate(() => {
        // FIX: textContent en vez de innerText — más rápido, no fuerza reflow
        let rows = Array.from(document.querySelectorAll('tr'));
        let result = [];
        for (let row of rows) {
            // Extraer el texto de cada celda/div hijo directo para asegurar que haya espacios entre columnas
            let text = Array.from(row.children).map(cell => cell.textContent.trim()).join(' ');
            
            // Si la fila no tiene hijos (raro, pero como prevención), usar textContent
            if (!text) text = row.textContent;

            let refMatch = text.match(/\b\d{10,16}\b/);
            let montoMatch = text.match(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/);
            
            // Normalizar para evitar que tildes ("MÓVIL") o espacios múltiples rompan la detección
            const textNormalizado = text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

            // Detectar si es un débito explícito (signo negativo antes del monto)
            const esNegativo = text.includes('-' + (montoMatch ? montoMatch[0] : '')) || text.includes('- ' + (montoMatch ? montoMatch[0] : ''));

            // Lista de palabras que indican que es dinero saliendo de la cuenta (Débitos)
            const esGasto = textNormalizado.includes('COMISION') || 
                            textNormalizado.includes('ITF') || 
                            textNormalizado.includes('DEBITO') || 
                            textNormalizado.includes('RETIRO') || 
                            textNormalizado.includes('COBRO ') ||
                            textNormalizado.includes('MANTENIMIENTO');

            // Si hay referencia, hay monto, no tiene signo de resta y no es un gasto/comisión, se toma como ingreso
            if (refMatch && montoMatch && !esNegativo && !esGasto) {
                result.push({
                    referencia: refMatch[0],
                    monto: montoMatch[0],
                    textoCompleto: text
                });
            }
        }
        return result;
    });
}

// ---------------------------------------------------------------------------
// MONITOREO AUTOMÁTICO
// ---------------------------------------------------------------------------

let isMonitoring = false;

/**
 * Inicia el loop en segundo plano que recarga la página y detecta movimientos nuevos.
 * @param {Function} logCallback
 * @param {Function} onNuevaTransaccion
 */
async function iniciarMonitoreo(logCallback, onNuevaTransaccion) {
    if (isMonitoring) {
        logCallback("El monitoreo ya está en curso.");
        return;
    }
    isMonitoring = true;
    const sessionStartTime = Date.now();
    logCallback(`Iniciando monitoreo en segundo plano (actualización cada ${MONITOR_INTERVAL_S}s)...`);

    cargarCache();

    try {
        // FIX: Asegurar que la tabla esté cargada antes de extraer el estado inicial
        // para no detectar todo el historial como "pagos nuevos" en el primer ciclo
        await page.waitForFunction(
            () => document.querySelectorAll('tr').length > 1,
            { timeout: TABLE_LOAD_TIMEOUT_MS }
        ).catch(() => console.log('Aviso: Tabla no lista en estado inicial'));

        const movimientosIniciales = await extraerMovimientosDOM();
        const saldoInicial = await extraerSaldo();

        if (isFirstRun) {
            // Es la primerísima vez que se corre el programa, guardar estado actual sin alertar
            movimientosIniciales.forEach(m => agregarACache(m));
            guardarCache();
        } else {
            // RECUPERACIÓN DE APAGONES: El programa se cerró y volvió a abrir.
            // Revisamos si en los movimientos iniciales hay algún pago que no esté en nuestro caché guardado.
            let huboPagosRecuperados = false;
            for (let m of movimientosIniciales) {
                const yaVisto = referenciasVistas.get(m.referencia);
                const esNuevo = !yaVisto || !yaVisto.monto || yaVisto.monto === '0,00';

                if (esNuevo) {
                    console.log(`[BOT] -> ¡PAGO RECUPERADO TRAS APAGÓN/REINICIO! Ref: ${m.referencia}`);
                    agregarACache(m);
                    huboPagosRecuperados = true;
                    // Notificamos a la interfaz que entró un pago mientras la PC estaba apagada
                    onNuevaTransaccion({ tipo: 'nuevo_pago', movimiento: m, saldo: saldoInicial });
                }
            }
            if (huboPagosRecuperados) guardarCache();
        }

        onNuevaTransaccion({ tipo: 'inicio', saldo: saldoInicial });
    } catch (e) {
        console.error("Error al cargar estado inicial del monitoreo:", e);
    }

    // FIX: backoff exponencial — en errores de red no se martella el servidor del banco
    let backoffMs = BACKOFF_INITIAL_MS;
    let erroresConsecutivos = 0;

    while (isMonitoring) {
        // Esperar el intervalo configurado pero revisando cada segundo si se ordenó detener
        // Así el botón "Detener" reacciona inmediatamente
        for (let i = 0; i < MONITOR_INTERVAL_S; i++) {
            if (!isMonitoring) break;
            await new Promise(r => setTimeout(r, MONITOR_TICK_MS));
        }

        // Si se detuvo durante la espera, salimos del ciclo antes de recargar
        if (!isMonitoring) break;

        // FIX PROACTIVO: Los bancos suelen tener un límite duro de 20 minutos de sesión.
        // Forzamos una reconexión preventiva a los 18 minutos para evitar errores o pantallas de bloqueo de sesión.
        const tiempoSesionMin = (Date.now() - sessionStartTime) / 60000;
        if (tiempoSesionMin >= 18) {
            console.log(`[BOT] Renovando sesión bancaria de forma proactiva (${tiempoSesionMin.toFixed(1)} min).`);
            isMonitoring = false;
            onNuevaTransaccion({ tipo: 'desconexion', mensaje: 'Renovando sesión con el banco (Mantenimiento preventivo 18 min)...' });
            break;
        }

        try {
            if (!browser || !page || page.isClosed()) {
                isMonitoring = false;
                onNuevaTransaccion({ 
                    tipo: 'error_critico', 
                    mensaje: 'EL NAVEGADOR SE CERRO INESPERADAMENTE. EL BOT SE DETUVO. REINICIE PARA CONTINUAR.' 
                });
                break;
            }

            await page.reload({ waitUntil: 'domcontentloaded', timeout: RELOAD_TIMEOUT_MS })
                .catch(e => console.log("Error silencioso al recargar:", e));

            await page.waitForFunction(() => {
                const txt = document.body.textContent.toLowerCase();
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('inicia tu sesión'));
                return txt.includes('movimientos del mes') || 
                       txt.includes('cuenta corriente') ||
                       txt.includes('cédula o tarjeta') ||
                       txt.includes('sesión finalizada') ||
                       txt.includes('hemos cerrado esta sesión') ||
                       txt.includes('inicio de otra sesión') ||
                       txt.includes('inicia tu sesión') ||
                       txt.includes('otro equipo') ||
                       txt.includes('seguridad') ||
                       txt.includes('inactividad') ||
                       txt.includes('expirado') ||
                       btn !== undefined;
            }, { timeout: RELOAD_TIMEOUT_MS }).catch(() => {});

            const desconectado = await page.evaluate(() => {
                const txt = document.body.textContent.toLowerCase();
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('inicia tu sesión'));
                return txt.includes('cédula o tarjeta') || 
                       txt.includes('vuelve a ingresar') || 
                       txt.includes('sesión finalizada') ||
                       txt.includes('hemos cerrado esta sesión') ||
                       txt.includes('inicio de otra sesión') ||
                       txt.includes('inicia tu sesión') ||
                       txt.includes('otro equipo') ||
                       txt.includes('seguridad') ||
                       txt.includes('inactividad') ||
                       txt.includes('expirado') ||
                       btn !== undefined;
            });

            if (desconectado) {
                isMonitoring = false;
                onNuevaTransaccion({ tipo: 'desconexion', mensaje: 'La sesión del banco ha expirado por inactividad. Intentando reconectar...' });
                // FIX: No cerramos el browser para permitir una auto-reconexión fluida sin bloqueos de caché.
                break;
            }

            const enMovimientos = await page.evaluate(() =>
                document.body.textContent.includes('Movimientos del mes')
            );

            if (!enMovimientos) {
                // FIX: usar función centralizada en lugar de código duplicado
                await navegarAMovimientos(logCallback);
            } else {
                await page.waitForFunction(
                    () => document.querySelectorAll('tr').length > 1,
                    { timeout: TABLE_LOAD_TIMEOUT_MS }
                ).catch(() => {});
            }

            const saldo = await extraerSaldo();
            const movimientos = await extraerMovimientosDOM();

            if (movimientos.length === 0) {
                const debugTr = await page.evaluate(() => Array.from(document.querySelectorAll('tr')).slice(0, 5).map(tr => tr.textContent.trim().replace(/\s+/g, ' ')));
                dlog(`[BOT] WARNING: 0 movimientos detectados. Primeros 5 TRs de la página: ` + JSON.stringify(debugTr));
            }

            dlog(`[BOT] enMovimientos=${enMovimientos}, saldo=${saldo}, movimientos extraidos=${movimientos.length}`);

            let hayNuevos = false;
            for (let m of movimientos) {
                dlog(`[BOT] Evaluando fila: Ref ${m.referencia} | Monto: ${m.monto}`);

                const yaVisto = referenciasVistas.get(m.referencia);

                // FIX: se considera NUEVO si:
                // 1. Nunca se ha visto, O
                // 2. Se guardó antes sin monto válido (entrada fantasma con 0,00 o sin monto)
                const esNuevo = !yaVisto || !yaVisto.monto || yaVisto.monto === '0,00';

                if (esNuevo) {
                    dlog(`[BOT] -> ¡NUEVO PAGO DETECTADO! Ref: ${m.referencia} | Bs. ${m.monto}`);
                    agregarACache(m);
                    guardarCache();
                    hayNuevos = true;
                    onNuevaTransaccion({ tipo: 'nuevo_pago', movimiento: m, saldo });
                } else {
                    dlog(`[BOT] Ref ${m.referencia} ya conocida (Bs. ${yaVisto.monto}) — ignorada.`);
                }
            }

            if (!hayNuevos) {
                onNuevaTransaccion({ tipo: 'actualizacion_saldo', saldo });
            }

            backoffMs = BACKOFF_INITIAL_MS; // FIX: resetear backoff en cada ciclo exitoso
            erroresConsecutivos = 0; // Resetear errores al tener éxito

        } catch (error) {
            console.error("Error en el ciclo de monitoreo:", error.message);
            erroresConsecutivos++;

            // En lugar de detenerse a los 3 errores, informamos a la interfaz que estamos reintentando
            onNuevaTransaccion({ tipo: 'reconectando' });

            console.log(`[BOT] Reintentando en ${backoffMs / 1000}s...`);
            await new Promise(r => setTimeout(r, backoffMs));
            backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS); // FIX: duplicar espera hasta el máximo
        }
    }

    logCallback("Monitoreo detenido.");
}

/** FIX: Detiene el loop de monitoreo de forma controlada. */
function detenerMonitoreo() {
    isMonitoring = false;
}

// FIX: module.exports movido al FINAL del archivo (antes estaba en línea 211, antes de declarar iniciarMonitoreo)
module.exports = {
    iniciarBanco,
    chequearPago,
    iniciarMonitoreo,
    detenerMonitoreo,
    obtenerPagosDelDia,
    cerrarJornada,
    exportarCSV         // NUEVO: exportar historial del turno a CSV
};
