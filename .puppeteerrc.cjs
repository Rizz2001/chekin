const {join} = require('path');

/**
 * Le decimos a Puppeteer que descargue el navegador Chromium
 * dentro de la misma carpeta del proyecto (en .cache).
 * Así, cuando empaquetemos el .exe, el navegador viajará junto con él
 * a la otra computadora.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
