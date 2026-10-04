/**
 * telegram.js - Módulo de notificaciones de Telegram para Chekin.
 * Usa el módulo `https` nativo de Node.js (sin dependencias externas).
 */

'use strict';

const https = require('https');

let _token  = '';
let _chatId = '';

function setConfig({ botToken, chatId }) {
    _token  = (botToken  || '').trim();
    _chatId = (chatId    || '').trim();
}

function estaConfigurado() {
    return !!_token && !!_chatId;
}

function enviarMensaje(texto, usarMd = false) {
    return new Promise((resolve) => {
        if (!estaConfigurado()) {
            console.warn('[Telegram] Módulo no configurado - mensaje omitido.');
            return resolve();
        }

        const body = JSON.stringify({
            chat_id:    _chatId,
            text:       texto,
            ...(usarMd ? { parse_mode: 'HTML' } : {})
        });

        const options = {
            hostname: 'api.telegram.org',
            path:     `/bot${_token}/sendMessage`,
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    if (json.ok) {
                        console.log(`[Telegram] Mensaje enviado al chat ${_chatId}`);
                    } else {
                        console.error('[Telegram] Error de API:', json.description);
                    }
                } catch {
                    console.error('[Telegram] Respuesta invalida:', raw);
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            console.error('[Telegram] Error de red:', err.message);
            resolve();
        });

        req.write(body);
        req.end();
    });
}

function notificarPago(movimiento) {
    if (!estaConfigurado()) return Promise.resolve();

    const ref   = movimiento.referencia || movimiento.ref || 'N/A';
    const monto = movimiento.monto      || '0,00';
    const hora  = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const texto = [
        '✅ <b>PAGO MÓVIL RECIBIDO</b>',
        '',
        `💵 <b>Monto:</b> Bs. ${escHtml(monto)}`,
        `📄 <b>Ref:</b> <code>${escHtml(ref)}</code>`,
        `🕒 <b>Hora:</b> ${escHtml(hora)}`,
    ].join('\n');

    return enviarMensaje(texto, true);
}

module.exports = { setConfig, estaConfigurado, enviarMensaje, notificarPago };
