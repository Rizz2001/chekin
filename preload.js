/**
 * preload.js — Puente seguro entre el proceso principal (main.js) y el renderer (index.html).
 * Usa contextBridge para exponer SOLO las APIs necesarias, sin dar acceso completo a Node.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Obtener configuración guardada
    getConfig: () => ipcRenderer.invoke('get-config'),

    // Iniciar sesión en el banco
    iniciarConexion: (config) => ipcRenderer.invoke('iniciar-conexion', config),

    // Verificar un pago manualmente
    verificarPago: (datos) => ipcRenderer.invoke('verificar-pago', datos),

    // Iniciar / detener el monitoreo automático
    iniciarMonitoreo: () => ipcRenderer.send('iniciar-monitoreo'),
    detenerMonitoreo: () => ipcRenderer.send('detener-monitoreo'),

    // Obtener los pagos del día registrados en el caché
    obtenerPagosDelDia: () => ipcRenderer.invoke('obtener-pagos-dia'),
    
    // Cerrar el turno actual para que los reportes se pongan en cero
    cerrarJornada: () => ipcRenderer.invoke('cerrar-jornada'),

    // NUEVO (Fase 4): Exportar historial del turno a CSV en el Escritorio
    exportarCSV: () => ipcRenderer.invoke('exportar-csv'),

    // NUEVO (Fase 4): Reconectar al banco con las credenciales guardadas
    reconectar: () => ipcRenderer.invoke('reconectar'),

    // Telegram: guardar credenciales del bot y aplicarlas inmediatamente
    guardarTelegram: (datos) => ipcRenderer.invoke('guardar-telegram', datos),

    // Telegram: enviar un mensaje de prueba para verificar la configuración
    probarTelegram: () => ipcRenderer.invoke('probar-telegram'),

    // Telegram: alerta directa cuando se cae la sesión
    enviarAlertaTelegram: (mensaje) => ipcRenderer.invoke('enviar-alerta-telegram', mensaje),

    // Escuchar mensajes del scraper (estado, logs)
    onEstadoScraper: (callback) => {
        ipcRenderer.removeAllListeners('estado-scraper'); // FIX: evita acumular listeners al reconectar
        ipcRenderer.on('estado-scraper', (_, mensaje) => callback(mensaje));
    },

    // Escuchar actualizaciones del monitoreo (saldo, nuevos pagos)
    onActualizacionMonitoreo: (callback) => {
        ipcRenderer.removeAllListeners('actualizacion-monitoreo'); // FIX: evita acumular listeners al reconectar
        ipcRenderer.on('actualizacion-monitoreo', (_, data) => callback(data));
    },
});
