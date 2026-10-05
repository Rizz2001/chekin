# Reglas de Arquitectura de Chekin

Este proyecto es una aplicación de escritorio desarrollada con Electron, Puppeteer (para Web Scraping) y Node.js. Sirve para automatizar la revisión de pagos móviles de un banco y enviar notificaciones vía Telegram.

## Reglas Principales:
1. **Límite de Sesión del Banco:** La sesión del banco dura alrededor de 18 minutos antes de vencerse. Existe una lógica de reconexión automática (`reconectar` en `main.js` y `scraper.js`). SIEMPRE que modifiques esta lógica, asegúrate de que las notificaciones de Telegram (`telegram.notificarPago()`) sigan activadas tras la reconexión.
2. **Sistema de Actualizaciones:** La app usa `electron-updater`. NUNCA utilices versiones "portables" puras (`target: ["portable"]`), ya que rompen el sistema de Auto-Update. El proyecto SIEMPRE debe compilarse utilizando el instalador NSIS en modo silencioso y de un solo clic (`oneClick: true`, `perMachine: false`, `allowElevation: false`) para asegurar que el actualizador de GitHub encuentre el `latest.yml`.
3. **Formatos:** El `telegram.js` utiliza parse mode de `HTML` para los mensajes para evitar problemas escapando caracteres especiales de Markdown.
4. **Almacenamiento:** Los datos como `tokens` de sesión y configuraciones se manejan cuidadosamente; las ventanas de Electron se controlan principalmente desde `main.js`.
