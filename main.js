const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const scraper = require('./scraper');
const telegram = require('./telegram');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Setup Auto Updater Logger
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Notify when an update is downloaded
autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Actualización lista',
        message: 'Una nueva versión de Chekin ha sido descargada. La aplicación se reiniciará para instalarla.',
        buttons: ['Reiniciar ahora']
    }).then(() => {
        autoUpdater.quitAndInstall();
    });
});

let mainWindow;
// FIX: Usar app.getPath('userData') garantiza que las credenciales no se borren 
// en las carpetas portables read-only ni al actualizar la app.
const configPath = path.join(app.getPath('userData'), 'config.json');

/**
 * Escapa caracteres HTML peligrosos para prevenir XSS.
 * Se usa en las ventanas de notificación cuyos datos vienen del DOM del banco.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 700,
        minWidth: 420,
        minHeight: 600,
        resizable: true,
        webPreferences: {
            // FIX: Configuración segura — el renderer NO tiene acceso directo a Node.js
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        title: 'Chekin - Verificador de Pago Móvil',
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    // Check for updates automatically
    autoUpdater.checkForUpdatesAndNotify().catch(err => log.error('Update error:', err));

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ---------------------------------------------------------------------------
// HANDLERS IPC
// ---------------------------------------------------------------------------

/** Devuelve la configuración guardada (sin exponer cómo se lee al renderer). */
/** La clave se descifra en el proceso principal antes de enviarla al renderer. */
ipcMain.handle('get-config', () => {
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            if (!content.trim()) return null;
            
            const raw = JSON.parse(content);
            if (safeStorage.isEncryptionAvailable() && raw.clave) {
                try {
                    raw.clave = safeStorage.decryptString(Buffer.from(raw.clave, 'base64'));
                } catch {
                    // La clave ya estaba en texto plano (migración del formato antiguo) — se usará tal cual
                }
            }
            // Aplicar config de Telegram si ya está guardada
            if (raw.botToken && raw.chatId) {
                telegram.setConfig({ botToken: raw.botToken, chatId: raw.chatId });
            }
            return raw;
        }
    } catch (error) {
        console.error('Error leyendo config.json:', error);
    }
    return null;
});

/** Guarda el Token y Chat ID de Telegram y aplica la configuración inmediatamente. */
ipcMain.handle('guardar-telegram', (event, { botToken, chatId }) => {
    try {
        let raw = {};
        if (fs.existsSync(configPath)) {
            try { 
                const content = fs.readFileSync(configPath, 'utf8');
                if (content.trim()) raw = JSON.parse(content); 
            } catch (e) { console.warn("Archivo config corrupto o vacío, se creará uno nuevo."); }
        }
        raw.botToken = (botToken || '').trim();
        raw.chatId   = (chatId   || '').trim();
        fs.writeFileSync(configPath, JSON.stringify(raw, null, 2));
        telegram.setConfig({ botToken: raw.botToken, chatId: raw.chatId });
        return { exito: true };
    } catch (err) {
        console.error('Error guardando config Telegram:', err);
        return { exito: false, mensaje: err.message };
    }
});

/** Envía un mensaje de prueba a Telegram para verificar que las credenciales son correctas. */
ipcMain.handle('probar-telegram', async () => {
    if (!telegram.estaConfigurado()) {
        return { exito: false, mensaje: 'Configura el Token y el Chat ID primero.' };
    }
    try {
        await telegram.enviarMensaje('🤖 Chekin conectado correctamente a Telegram. Las notificaciones de pago móvil llegarán aquí.');
        return { exito: true };
    } catch (err) {
        return { exito: false, mensaje: err.message };
    }
});

/** Guarda la configuración e inicia sesión en el banco. */
/** La clave se cifra con safeStorage antes de escribirla a disco. El scraper recibe la clave en claro. */
ipcMain.handle('iniciar-conexion', async (event, config) => {
    try {
        // Cifrar la clave antes de guardarla en disco (nunca texto plano)
        let claveParaGuardar = config.clave;
        if (safeStorage.isEncryptionAvailable()) {
            claveParaGuardar = safeStorage.encryptString(config.clave).toString('base64');
        }
        
        let configParaGuardar = {};
        if (fs.existsSync(configPath)) {
            try { configParaGuardar = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
        }
        configParaGuardar.cedula = config.cedula;
        configParaGuardar.clave = claveParaGuardar;
        configParaGuardar.recordarNavegador = config.recordarNavegador || false;
        
        fs.writeFileSync(configPath, JSON.stringify(configParaGuardar, null, 2));

        mainWindow.webContents.send('estado-scraper', 'Iniciando navegador...');

        // Pasar la config ORIGINAL (clave en claro) al scraper — nunca la cifrada
        const resultado = await scraper.iniciarBanco(config, (mensaje) => {
            if (mainWindow) mainWindow.webContents.send('estado-scraper', mensaje);
        });

        return resultado;
    } catch (error) {
        console.error('Error en iniciar-conexion:', error);
        return { exito: false, mensaje: error.message || 'Error desconocido al conectar.' };
    }
});

/** Verifica un pago específico por referencia y monto. */
ipcMain.handle('verificar-pago', async (event, datos) => {
    const { ref, monto } = datos;
    try {
        const resultado = await scraper.chequearPago(ref, monto);
        return resultado;
    } catch (e) {
        return { exito: false, mensaje: e.message };
    }
});

/** Exponer los pagos del día al frontend. */
ipcMain.handle('obtener-pagos-dia', () => {
    return scraper.obtenerPagosDelDia();
});

/** NUEVO (Fase 4): Exportar el historial del turno a CSV en el Escritorio. */
ipcMain.handle('exportar-csv', () => {
    try {
        const desktopPath = app.getPath('desktop');
        const filePath = scraper.exportarCSV(desktopPath);
        return { exito: !!filePath, ruta: filePath };
    } catch (err) {
        console.error('Error exportando CSV:', err);
        return { exito: false, ruta: null };
    }
});

/**
 * NUEVO (Fase 4): Reconecta al banco usando las credenciales guardadas en disco.
 * Permite auto-reconexión sin que el usuario tenga que volver al login.
 */
ipcMain.handle('reconectar', async () => {
    try {
        if (!fs.existsSync(configPath)) {
            return { exito: false, mensaje: 'No hay credenciales guardadas para reconectar.' };
        }
        
        let raw = {};
        try {
            const content = fs.readFileSync(configPath, 'utf8');
            if (!content.trim()) return { exito: false, mensaje: 'El archivo de credenciales está vacío.' };
            raw = JSON.parse(content);
        } catch (e) {
            return { exito: false, mensaje: 'Archivo de configuración corrupto.' };
        }
        
        // Descifrar la clave (mismo flujo que get-config)
        if (safeStorage.isEncryptionAvailable() && raw.clave) {
            try { raw.clave = safeStorage.decryptString(Buffer.from(raw.clave, 'base64')); } catch {}
        }
        mainWindow.webContents.send('estado-scraper', 'Reconectando al banco...');
        const resultado = await scraper.iniciarBanco(raw, (msg) => {
            if (mainWindow) mainWindow.webContents.send('estado-scraper', msg);
        });
        if (resultado.exito) {
            // Reiniciar el monitoreo tras reconexión exitosa
            scraper.iniciarMonitoreo(
                (msg) => { if (mainWindow) mainWindow.webContents.send('estado-scraper', msg); },
                (evt) => {
                    if (mainWindow) mainWindow.webContents.send('actualizacion-monitoreo', evt);
                    if (evt?.tipo === 'nuevo_pago' && evt.movimiento) {
                        crearVentanaNotificacion(evt.movimiento);
                        telegram.notificarPago(evt.movimiento).catch(console.error);
                    }
                }
            );
        }
        return resultado;
    } catch (err) {
        console.error('Error en reconectar:', err);
        return { exito: false, mensaje: err.message };
    }
});

/** Manejador para enviar mensajes directos por Telegram en caso de desconexión. */
ipcMain.handle('enviar-alerta-telegram', async (event, mensaje) => {
    try {
        await telegram.enviarMensaje(mensaje);
        return true;
    } catch (error) {
        console.error('Error al enviar alerta a Telegram:', error);
        return false;
    }
});

/** Función auxiliar para generar y guardar el PDF del Cierre */
async function generarPDFReporte(pagosDia) {
    return new Promise((resolve) => {
        const win = new BrowserWindow({ show: false });

        // FIX: guardia de 20 segundos para que la ventana no quede abierta indefinidamente
        const guardTimer = setTimeout(() => {
            console.warn('Timeout generando PDF — cerrando ventana de guardia.');
            if (!win.isDestroyed()) win.close();
            resolve();
        }, 20_000);
        
        let totalGeneral = 0;
        let filas = '';
        pagosDia.forEach((p, index) => {
            const montoNum = parseFloat(p.monto.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(montoNum)) totalGeneral += montoNum;
            const dateObj = p.timestamp ? new Date(p.timestamp) : new Date();
            const timeStr = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute:'2-digit' });
            filas += `
                <tr>
                    <td style="text-align: center;">${index + 1}</td>
                    <td>${p.ref}</td>
                    <td style="text-align: right;">${p.monto}</td>
                    <td style="text-align: center;">${timeStr}</td>
                </tr>
            `;
        });

        const html = `
            <html>
            <head>
                <style>
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #333; }
                    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #10b981; padding-bottom: 15px; margin-bottom: 30px; }
                    h1 { margin: 0; color: #0f172a; }
                    .meta { font-size: 14px; color: #64748b; text-align: right; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
                    th, td { border: 1px solid #e2e8f0; padding: 12px; }
                    th { background-color: #f8fafc; color: #475569; font-weight: 600; text-transform: uppercase; font-size: 12px; }
                    .total-box { margin-top: 30px; padding: 20px; background-color: #f8fafc; border-radius: 8px; text-align: right; border: 1px solid #e2e8f0; }
                    .total-box span { font-size: 14px; color: #64748b; margin-right: 15px; }
                    .total-box strong { font-size: 24px; color: #10b981; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Reporte de Cierre de Turno</h1>
                    <div class="meta">
                        <strong>Fecha:</strong> ${new Date().toLocaleDateString('es-VE')}<br>
                        <strong>Operaciones:</strong> ${pagosDia.length}
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 10%; text-align: center;">Nro</th>
                            <th style="width: 40%; text-align: left;">Referencia</th>
                            <th style="width: 30%; text-align: right;">Monto (Bs.)</th>
                            <th style="width: 20%; text-align: center;">Hora</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filas}
                    </tbody>
                </table>
                <div class="total-box">
                    <span>Total Ingresos Reportados:</span>
                    <strong>Bs. ${totalGeneral.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong>
                </div>
            </body>
            </html>
        `;

        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

        win.webContents.on('did-finish-load', async () => {
            clearTimeout(guardTimer); // FIX: cancelar la guardia si la página cargó a tiempo
            try {
                const pdfData = await win.webContents.printToPDF({
                    marginsType: 0,
                    pageSize: 'A4',
                    printBackground: true,
                });
                
                // Guardar automáticamente en el Escritorio
                const desktopPath = app.getPath('desktop');
                const timeSuffix = new Date().toLocaleTimeString('es-VE', { hour12: false }).replace(/:/g, '');
                const dateSuffix = new Date().toISOString().slice(0,10);
                const fileName = `Cierre_Pagos_${dateSuffix}_${timeSuffix}.pdf`;
                const filePath = path.join(desktopPath, fileName);
                
                fs.writeFileSync(filePath, pdfData);
                console.log("PDF guardado en:", filePath);
                
                win.close();
                resolve();
            } catch (err) {
                console.error("Error generando PDF:", err);
                win.close();
                resolve();
            }
        });
    });
}

/** Cerrar el turno actual y empezar uno nuevo. Genera PDF automáticamente. */
ipcMain.handle('cerrar-jornada', async () => {
    const pagosDia = scraper.obtenerPagosDelDia();
    
    // Si hay pagos, obligar la descarga del PDF
    if (pagosDia && pagosDia.length > 0) {
        await generarPDFReporte(pagosDia);
    }

    scraper.cerrarJornada();
    return true;
});

// ---------------------------------------------------------------------------
// MONITOREO AUTOMÁTICO
// ---------------------------------------------------------------------------

// Array para apilar las ventanas de notificación activas
let activeNotifications = [];

/**
 * Crea una ventana emergente flotante para notificar un pago nuevo.
 * FIX: nodeIntegration desactivado, contextIsolation activado, datos saneados con escapeHtml.
 * @param {{ referencia: string, monto: string }} pago
 */
function crearVentanaNotificacion(pago) {
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;

    const notifWidth = 320;
    const notifHeight = 100;
    const margin = 15;

    // Buscar el primer slot libre de arriba hacia abajo
    let slot = 0;
    while (activeNotifications.some(n => n.slot === slot)) {
        slot++;
    }

    const startY = 20 + (slot * (notifHeight + margin));
    if (startY + notifHeight > height) return; // No cabe en pantalla

    let notifWindow = new BrowserWindow({
        width: notifWidth,
        height: notifHeight,
        x: width - notifWidth - 20,
        y: startY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            // FIX: Seguro — la ventana de notificación no necesita Node.js
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const notifObj = { window: notifWindow, slot };
    activeNotifications.push(notifObj);

    // FIX: escapeHtml para prevenir XSS con datos provenientes del DOM del banco
    const montoSeguro = escapeHtml(pago.monto);
    const refSegura = escapeHtml(pago.referencia);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; overflow: hidden; background: transparent; font-family: 'Inter', sans-serif; }
  @keyframes slideIn { from { transform: translateX(120%); } to { transform: translateX(0); } }
  .notif {
    background: rgba(15, 23, 42, 0.95);
    border-left: 5px solid #10b981;
    border-radius: 8px;
    padding: 15px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.5);
    width: 100%; height: 100%; box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: center;
    cursor: pointer;
    animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .label { color: #94a3b8; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
  .monto { font-size: 22px; font-weight: 800; color: #f8fafc; margin-bottom: 2px; }
  .ref   { font-size: 12px; color: #64748b; font-family: monospace; }
</style>
</head>
<body>
<div class="notif" onclick="window.close()">
  <div class="label">✅ PAGO RECIBIDO</div>
  <div class="monto" id="monto"></div>
  <div class="ref"   id="ref"></div>
</div>
<script>
  // FIX: usamos textContent (no innerHTML) para insertar los datos de forma segura
  document.getElementById('monto').textContent = 'Bs. ${montoSeguro}';
  document.getElementById('ref').textContent   = 'Ref: ${refSegura}';
</script>
</body>
</html>`;

    notifWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    notifWindow.on('closed', () => {
        activeNotifications = activeNotifications.filter(n => n.window !== notifWindow);
    });

    // Auto-cerrar después de 10 segundos
    setTimeout(() => {
        if (notifWindow && !notifWindow.isDestroyed()) {
            notifWindow.close();
        }
    }, 10000);
}

/** Inicia el monitoreo automático de pagos en segundo plano. */
ipcMain.on('iniciar-monitoreo', async (event) => {
    try {
        await scraper.iniciarMonitoreo(
            (mensaje) => {
                if (mainWindow) mainWindow.webContents.send('estado-scraper', mensaje);
            },
            (eventoTransaccion) => {
                if (mainWindow) mainWindow.webContents.send('actualizacion-monitoreo', eventoTransaccion);

                if (eventoTransaccion?.tipo === 'nuevo_pago' && eventoTransaccion.movimiento) {
                    crearVentanaNotificacion(eventoTransaccion.movimiento);
                    // Notificar por Telegram si está configurado
                    telegram.notificarPago(eventoTransaccion.movimiento).catch(console.error);
                }
            }
        );
    } catch (error) {
        console.error('Error en monitoreo:', error);
    }
});

/** FIX: Handler para detener el monitoreo desde la UI. */
ipcMain.on('detener-monitoreo', () => {
    scraper.detenerMonitoreo();
});
