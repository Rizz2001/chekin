
        // 1. Inicializar íconos modernos
        lucide.createIcons();

        // --- FUNCIONES DE SONIDO Y GRÁFICOS ---
        function playDing() {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1046.50, ctx.currentTime); // C6
                osc.frequency.exponentialRampToValueAtTime(1318.51, ctx.currentTime + 0.05); // E6
                
                gain.gain.setValueAtTime(0, ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
                // FIX: cerrar el AudioContext cuando el oscilador termina — evita memory leak acumulativo
                osc.addEventListener('ended', () => ctx.close());
            } catch(e) {}
        }

        let chartInstance = null;
        function initChart() {
            const ctx = document.getElementById('chartActividad').getContext('2d');
            Chart.defaults.color = '#94a3b8';
            Chart.defaults.font.family = 'Inter';
            
            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(16, 185, 129, 0.2)', borderColor: '#10b981', borderWidth: 1, borderRadius: 4 }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: { label: (ctx) => `Pagos: ${ctx.raw}` } } },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
                        x: { grid: { display: false }, border: { display: false } }
                    }
                }
            });
        }
        
        async function updateChart() {
            if (!chartInstance) return;
            try {
                const pagos = await window.electronAPI.obtenerPagosDelDia();
                const horasMap = {};
                pagos.forEach(p => {
                    const d = p.timestamp ? new Date(p.timestamp) : new Date();
                    const hr = d.getHours().toString().padStart(2, '0') + ':00';
                    horasMap[hr] = (horasMap[hr] || 0) + 1;
                });
                const horas = Object.keys(horasMap).sort();
                chartInstance.data.labels = horas;
                chartInstance.data.datasets[0].data = horas.map(h => horasMap[h]);
                chartInstance.update();
            } catch(e) { console.log(e); }
        }
        // ----------------------------------------

        // 2. Variables de estado del Dashboard
        let sessionTotalBs = 0;
        let sessionCount = 0;
        let saldoReal = "0,00";
        let saldoVisible = true;
        let turnoTimerInterval = null;
        let turnoStart = null;

        // --- MODAL DE CONFIRMACIÓN (reemplaza confirm() y alert() nativos) ---
        function showModal({ icon = '⚠️', titulo, mensaje, confirmText = 'Confirmar', cancelText = 'Cancelar', soloOk = false } = {}) {
            return new Promise((resolve) => {
                document.getElementById('modal-icon').textContent  = icon;
                document.getElementById('modal-title').textContent = titulo;
                document.getElementById('modal-body').textContent  = mensaje;
                document.getElementById('modal-confirm').textContent = confirmText;
                document.getElementById('modal-cancel').textContent  = cancelText;
                document.getElementById('modal-cancel').style.display = soloOk ? 'none' : '';
                document.getElementById('modal-overlay').classList.add('show');

                const close = (result) => {
                    document.getElementById('modal-overlay').classList.remove('show');
                    document.getElementById('modal-confirm').onclick = null;
                    document.getElementById('modal-cancel').onclick  = null;
                    resolve(result);
                };
                document.getElementById('modal-confirm').onclick = () => close(true);
                document.getElementById('modal-cancel').onclick  = () => close(false);
            });
        }

        // --- TIMER DEL TURNO ---
        function iniciarTimerTurno() {
            if (turnoTimerInterval) clearInterval(turnoTimerInterval);
            turnoStart = Date.now();
            turnoTimerInterval = setInterval(() => {
                const elapsed = Date.now() - turnoStart;
                const h = String(Math.floor(elapsed / 3_600_000)).padStart(2, '0');
                const m = String(Math.floor((elapsed % 3_600_000) / 60_000)).padStart(2, '0');
                const s = String(Math.floor((elapsed % 60_000) / 1000)).padStart(2, '0');
                document.getElementById('timer-turno').textContent = `${h}:${m}:${s}`;
            }, 1000);
        }

        // 3. Referencias al DOM
        const vConfig = document.getElementById('view-config');
        const vDash = document.getElementById('view-dashboard');
        
        const inputCed = document.getElementById('cedula');
        const inputPass = document.getElementById('clave');
        const btnConectar = document.getElementById('btnConectar');
        const resConfig = document.getElementById('res-config');

        const inputRef = document.getElementById('ref');
        const inputMonto = document.getElementById('monto');
        const btnVerificar = document.getElementById('btnVerificar');
        const resVerify = document.getElementById('res-verify');

        // 4. Utilidad para mostrar alertas
        function showMsg(element, text, type) {
            element.textContent = text;
            element.className = `alert show ${type}`;
        }

        // 5. Lógica del menú de Pestañas (Tabs)
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(btn.dataset.target).classList.add('active');
                
                // Actualizar título del header principal
                const title = btn.dataset.target === 'tab-live' ? 'Panel General' : 'Auditoría Manual';
                document.getElementById('top-title').textContent = title;
            });
        });

        // 6. Lógica para Ocultar/Mostrar Saldo
        document.getElementById('btnToggleSaldo').addEventListener('click', (e) => {
            saldoVisible = !saldoVisible;
            const btn = e.currentTarget;
            if (saldoVisible) {
                btn.innerHTML = '<i data-lucide="eye" style="width: 16px; height: 16px;"></i>';
                document.getElementById('saldo-actual').textContent = `Bs. ${saldoReal}`;
                btn.style.color = 'var(--text-muted)';
            } else {
                btn.innerHTML = '<i data-lucide="eye-off" style="width: 16px; height: 16px;"></i>';
                document.getElementById('saldo-actual').textContent = 'Bs. ***';
                btn.style.color = 'white';
            }
            lucide.createIcons({ root: btn });
        });

        // 5. Utilidad para agregar pagos visualmente y sumar contadores
        // FIX: retorna el elemento DOM creado para que el llamador pueda manipularlo directamente
        function agregarPagoVisual(mov) {
            const pc = document.getElementById('pagos-container');
            const empty = document.getElementById('empty-pagos');

            if(empty) empty.style.display = 'none';

            // Actualizar Estadísticas de Sesión
            const montoStr = mov.monto.replace(/\./g, '').replace(',', '.');
            const montoNumStats = parseFloat(montoStr); // renombrado para evitar colisión con montoNum del filtro
            
            if(!isNaN(montoNumStats)) {
                sessionTotalBs += montoNumStats;
                sessionCount++;
                document.getElementById('contador-pagos').textContent = sessionCount;
                document.getElementById('total-ingresos').textContent = `Bs. ${sessionTotalBs.toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                // NUEVO: actualizar el promedio por pago
                const promedio = sessionTotalBs / sessionCount;
                document.getElementById('promedio-pago').textContent = `Bs. ${promedio.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }

            // Crear elemento visual del pago
            const item = document.createElement('div');
            item.className = 'payment-item new';
            
            // Extraer hora si existe, o usar la actual
            const time = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute:'2-digit' });
            
            const payLeft = document.createElement('div');
            payLeft.className = 'pay-left';
            
            const payIcon = document.createElement('div');
            payIcon.className = 'pay-icon';
            payIcon.innerHTML = '<i data-lucide="arrow-down-left"></i>';
            
            const payInfo = document.createElement('div');
            payInfo.className = 'pay-info';
            
            const divRef = document.createElement('div');
            divRef.className = 'ref';
            divRef.textContent = `Ref: ${mov.ref || mov.referencia}`;
            
            const divTime = document.createElement('div');
            divTime.className = 'time';
            divTime.textContent = time;
            
            payInfo.appendChild(divRef);
            payInfo.appendChild(divTime);
            payLeft.appendChild(payIcon);
            payLeft.appendChild(payInfo);
            
            const payRight = document.createElement('div');
            payRight.className = 'pay-right';
            payRight.innerHTML = `Bs. ${mov.monto} <i data-lucide="check-circle-2" style="width: 14px; color: var(--success);"></i>`;
            
            item.appendChild(payLeft);
            item.appendChild(payRight);
            
            pc.prepend(item);
            lucide.createIcons({ root: item });
            return item; // FIX: retornar el elemento para manipulación externa precisa
        }

        // Lógica de Login
        window.addEventListener('DOMContentLoaded', async () => {
            initChart();
            const config = await window.electronAPI.getConfig();
            if (config) {
                if (config.cedula) inputCed.value = config.cedula;
                if (config.clave) inputPass.value = config.clave;
                if (config.recordarNavegador) document.getElementById('recordar-navegador').checked = true;
                // Cargar config de Telegram si existe
                if (config.botToken) document.getElementById('tg-token').value  = config.botToken;
                if (config.chatId)   document.getElementById('tg-chatid').value = config.chatId;
                if (config.botToken && config.chatId) actualizarBadgeTelegram(true);
            }
        });

        function actualizarBadgeTelegram(activo) {
            const badge = document.getElementById('tg-badge');
            if (activo) {
                badge.textContent = 'Activo';
                badge.className = 'tg-badge on';
            } else {
                badge.textContent = 'Desactivado';
                badge.className = 'tg-badge off';
            }
        }

        document.getElementById('btnGuardarTelegram').addEventListener('click', async () => {
            const botToken = document.getElementById('tg-token').value.trim();
            const chatId   = document.getElementById('tg-chatid').value.trim();
            const resEl    = document.getElementById('res-telegram');

            if (!botToken || !chatId) {
                resEl.textContent = '⚠️ Completa ambos campos.';
                resEl.style.color = '#f59e0b';
                return;
            }

            const r = await window.electronAPI.guardarTelegram({ botToken, chatId });
            if (r.exito) {
                resEl.textContent = '✅ Guardado correctamente.';
                resEl.style.color = 'var(--success)';
                actualizarBadgeTelegram(true);
            } else {
                resEl.textContent = '❌ ' + (r.mensaje || 'Error al guardar.');
                resEl.style.color = 'var(--danger)';
            }
        });

        document.getElementById('btnProbarTelegram').addEventListener('click', async () => {
            const resEl = document.getElementById('res-telegram');
            resEl.textContent = '⏳ Enviando mensaje de prueba...';
            resEl.style.color = 'var(--text-muted)';

            const r = await window.electronAPI.probarTelegram();
            if (r.exito) {
                resEl.textContent = '✅ Mensaje enviado. Revisa tu Telegram.';
                resEl.style.color = 'var(--success)';
            } else {
                resEl.textContent = '❌ ' + (r.mensaje || 'Error al enviar.');
                resEl.style.color = 'var(--danger)';
            }
        });

        btnConectar.addEventListener('click', async () => {
            const cedula = inputCed.value.trim();
            const clave = inputPass.value.trim();
            const recordar = document.getElementById('recordar-navegador').checked;
            
            if (!cedula || !clave) return showMsg(resConfig, 'Credenciales incompletas.', 'error');

            btnConectar.disabled = true;
            btnConectar.classList.add('loading');
            showMsg(resConfig, 'Conectando...', 'info');

            try {
                const resp = await window.electronAPI.iniciarConexion({ cedula, clave, recordarNavegador: recordar });
                if (resp.exito) {
                    showMsg(resConfig, '¡Conectado!', 'success');
                    
                    // RECUPERACIÓN DE DATOS (Anti-apagones): 
                    // Obtener los pagos que ya estaban guardados hoy para restablecer el historial
                    const pagosHoy = await window.electronAPI.obtenerPagosDelDia();
                    if (pagosHoy && pagosHoy.length > 0) {
                        pagosHoy.forEach(p => {
                            // Simulamos el pago visualmente y obtenemos el elemento creado
                            const el = agregarPagoVisual({
                                referencia: p.ref,
                                monto: p.monto
                            });
                            // FIX: quitamos 'new' al elemento recién insertado (no al primero del DOM)
                            if (el) el.classList.remove('new');
                        });
                        updateChart();
                    }

                    window.electronAPI.iniciarMonitoreo();
                    iniciarTimerTurno(); // NUEVO: arrancar el contador del turno al conectar
                    setTimeout(() => {
                        vConfig.classList.remove('active');
                        vDash.classList.add('active');
                    }, 800);
                } else {
                    showMsg(resConfig, resp.mensaje, 'error');
                }
            } catch (e) {
                showMsg(resConfig, e.message, 'error');
            } finally {
                btnConectar.disabled = false;
                btnConectar.classList.remove('loading');
            }
        });

        // 7. Lógica de Búsqueda Manual
        btnVerificar.addEventListener('click', async () => {
            const ref = inputRef.value.trim();
            const monto = inputMonto.value.trim();
            if (!ref || !monto) return showMsg(resVerify, 'Datos incompletos.', 'error');

            btnVerificar.disabled = true;
            btnVerificar.classList.add('loading');
            showMsg(resVerify, 'Buscando...', 'info');

            try {
                const r = await window.electronAPI.verificarPago({ ref, monto });
                showMsg(resVerify, r.mensaje, r.exito ? 'success' : 'warning');
            } catch (e) {
                showMsg(resVerify, e.message, 'error');
            } finally {
                btnVerificar.disabled = false;
                btnVerificar.classList.remove('loading');
            }
        });

        // FILTRO DE BÚSQUEDA en tiempo real sobre el historial
        document.getElementById('filtro-pagos').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.payment-item').forEach(item => {
                item.style.display = !q || item.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
            });
        });

        // 8. Controles de Monitoreo
        document.getElementById('btnDetener').addEventListener('click', (e) => {
            window.electronAPI.detenerMonitoreo();
            const btn = e.currentTarget;
            btn.disabled = true;
            document.getElementById('txt-status').textContent = 'Pausado';
            document.querySelector('.pulse-dot').style.display = 'none';
            document.getElementById('status-container').style.color = 'var(--text-muted)';
            document.getElementById('status-container').style.borderColor = 'var(--glass-border)';
            document.getElementById('status-container').style.background = 'transparent';
        });

        // 9. Lógica para Cerrar Jornada (reemplaza confirm() nativo por modal propio)
        document.getElementById('btnCerrarJornada').addEventListener('click', async () => {
            const confirmar = await showModal({
                icon: '🔒',
                titulo: 'Cerrar Turno',
                mensaje: 'Esto generará el PDF de reporte, reiniciará el historial y cerrará la aplicación. ¿Continuar?',
                confirmText: 'Cerrar Turno',
                cancelText: 'Cancelar'
            });
            if (confirmar) {
                await window.electronAPI.cerrarJornada();
                window.close();
            }
        });

        // NUEVO (Fase 4): Exportar CSV del turno actual al Escritorio
        document.getElementById('btnExportarCSV').addEventListener('click', async () => {
            const result = await window.electronAPI.exportarCSV();
            if (result.exito) {
                await showModal({ icon: '✅', titulo: 'CSV Exportado', mensaje: `Archivo guardado en el Escritorio:\n${result.ruta}`, confirmText: 'OK', soloOk: true });
            } else {
                await showModal({ icon: '⚠️', titulo: 'Sin datos', mensaje: 'No hay pagos en el turno actual para exportar.', confirmText: 'OK', soloOk: true });
            }
        });

        // LÓGICA DE IMPRESIÓN DEL REPORTE DEL DÍA
        document.getElementById('btnImprimir').addEventListener('click', async () => {
            const pagosDia = await window.electronAPI.obtenerPagosDelDia();
            
            if (pagosDia.length === 0) {
                await showModal({ icon: 'ℹ️', titulo: 'Sin pagos', mensaje: 'No hay pagos registrados hoy para imprimir.', confirmText: 'OK', soloOk: true });
                return;
            }

            const printDiv = document.getElementById('print-section');
            let totalGeneral = 0;

            let html = `
                <h1>Reporte de Pagos Móviles del Día</h1>
                <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-VE')}</p>
                <p><strong>Cantidad de Transacciones:</strong> ${pagosDia.length}</p>
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>Nro.</th>
                            <th>Referencia</th>
                            <th>Monto (Bs.)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            pagosDia.forEach((p, index) => {
                const montoNum = parseFloat(p.monto.replace(/\./g, '').replace(',', '.'));
                if (!isNaN(montoNum)) totalGeneral += montoNum;
                html += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${p.ref}</td>
                        <td>${p.monto}</td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
                <div class="print-total">Total del Día: Bs. ${totalGeneral.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
            `;

            printDiv.innerHTML = html;
            window.print();
        });

        // 9. Eventos del Scraper (Main Process)
        window.electronAPI.onEstadoScraper((msg) => {
            if(!msg) return;
            if(vConfig.classList.contains('active')) showMsg(resConfig, msg, 'info');
        });

        window.electronAPI.onActualizacionMonitoreo((data) => {
            if (data.saldo) {
                saldoReal = data.saldo;
                if (saldoVisible) {
                    document.getElementById('saldo-actual').textContent = `Bs. ${saldoReal}`;
                }
            }

            if (data.tipo === 'actualizacion_saldo') {
                // Cuando hay éxito de lectura (y actualiza saldo), restaurar indicador visual de Monitoreando por si estaba en Reconectando
                document.getElementById('txt-status').textContent = 'Monitoreando';
                document.getElementById('status-container').style.color = 'var(--success)';
                document.getElementById('status-container').style.borderColor = 'rgba(16, 185, 129, 0.2)';
                document.getElementById('status-container').style.background = 'rgba(16, 185, 129, 0.1)';
                document.querySelector('.pulse-dot').style.display = 'block';
                document.querySelector('.pulse-dot').style.background = 'var(--success)';
                document.querySelector('.pulse-dot').style.boxShadow = '0 0 8px var(--success)';
            }

            if (data.tipo === 'nuevo_pago') {
                agregarPagoVisual(data.movimiento);
                // FIX: verificar permisos antes de mostrar notificación del sistema
                if ('Notification' in window) {
                    if (Notification.permission === 'granted') {
                        new Notification('Nuevo Pago', { body: `Bs. ${data.movimiento.monto} | Ref: ${data.movimiento.referencia}` });
                    } else if (Notification.permission !== 'denied') {
                        Notification.requestPermission().then(perm => {
                            if (perm === 'granted') {
                                new Notification('Nuevo Pago', { body: `Bs. ${data.movimiento.monto} | Ref: ${data.movimiento.referencia}` });
                            }
                        });
                    }
                }
                playDing();
                updateChart();
            } else if (data.tipo === 'reconectando') {
                document.getElementById('txt-status').textContent = 'Internet inestable...';
                document.getElementById('status-container').style.color = '#f59e0b';
                document.getElementById('status-container').style.borderColor = '#f59e0b';
                document.getElementById('status-container').style.background = 'rgba(245, 158, 11, 0.1)';
                document.querySelector('.pulse-dot').style.display = 'block';
                document.querySelector('.pulse-dot').style.background = '#f59e0b';
                document.querySelector('.pulse-dot').style.boxShadow = '0 0 8px #f59e0b';

            } else if (data.tipo === 'desconexion') {
                // Sesión expirada (por los 20 min del banco), iniciar auto-reconexión silenciosa
                document.getElementById('txt-status').textContent = 'Reconectando al banco...';
                document.getElementById('status-container').style.color = '#3b82f6';
                document.getElementById('status-container').style.borderColor = '#3b82f6';
                document.getElementById('status-container').style.background = 'rgba(59, 130, 246, 0.1)';
                document.querySelector('.pulse-dot').style.display = 'block';
                document.querySelector('.pulse-dot').style.background = '#3b82f6';
                document.querySelector('.pulse-dot').style.boxShadow = '0 0 8px #3b82f6';

                // Enviar mensaje a Telegram notificando
                window.electronAPI.enviarAlertaTelegram('La sesión expiró (20 min). El bot se está auto-reconectando de forma invisible...').catch(console.error);

                // Llamar auto-reconexión
                window.electronAPI.reconectar().then(res => {
                    if (!res || !res.exito) {
                        // Solo si falla definitivamente, volvemos a la pantalla de configuración
                        btnConectar.disabled = false;
                        btnConectar.classList.remove('loading');
                        vDash.classList.remove('active');
                        vConfig.classList.add('active');
                        showMsg(resConfig, 'La sesión expiró y la auto-reconexión falló. Debes volver a conectar manualmente.', 'error');
                    }
                });
                
            } else if (data.tipo === 'error_critico') {
                document.getElementById('txt-status').textContent = 'Error Crítico';
                document.querySelector('.pulse-dot').style.display = 'none';
                document.getElementById('status-container').style.color = '#f43f5e';
                document.getElementById('status-container').style.borderColor = '#f43f5e';
                document.getElementById('status-container').style.background = 'rgba(244, 63, 94, 0.1)';

                window.electronAPI.enviarAlertaTelegram(data.mensaje).catch(console.error);

                btnConectar.disabled = false;
                btnConectar.classList.remove('loading');
                vDash.classList.remove('active');
                vConfig.classList.add('active');
                showMsg(resConfig, data.mensaje, 'error');
            }
        });
    