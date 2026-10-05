---
name: compilar-chekin
description: Protocolo estricto para compilar, publicar actualizaciones y manejar versiones de Chekin en GitHub. Úsalo SIEMPRE que se pida lanzar una nueva actualización.
---

# Protocolo de Publicación de Actualizaciones de Chekin

Para garantizar que `electron-updater` descargue automáticamente las nuevas versiones, **nunca** compiles o subas archivos manualmente sin seguir estos pasos.

### 1. Incrementar la Versión
Edita `package.json` para subir la versión (ej. de `1.0.6` a `1.0.7`). No cambies el target (`nsis` debe mantenerse con configuración per-user para instalación silenciosa).

### 2. Crear y Enviar la Etiqueta (Git Tag) PRIMERO
Para evitar que GitHub marque el release como "Borrador" (Draft), **obligatoriamente** debes hacer commit, crear un tag y subirlo ANTES de ejecutar el comando de compilación:
```powershell
git add .
git commit -m "Bump a version 1.0.7"
git push origin main
git tag v1.0.7
git push origin v1.0.7
```

### 3. Compilar el Proyecto
Una vez el tag esté en GitHub, procede a ejecutar la compilación de Electron Builder:
```powershell
npm run build:release
```
*(Espera pacientemente a que termine el proceso).*

### 4. Verificar y Garantizar Publicación (Evitar Borrador / Draft)
**Paso Obligatorio:** Electron Builder o GitHub pueden dejar el Release en estado `draft: true` (borrador), lo que impide que `electron-updater` descargue la actualización en otros equipos.
Ejecuta SIEMPRE una verificación mediante la API de GitHub para asegurar que el Release esté publicado (`draft: false`):
```powershell
node -e "const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN; const https = require('https'); const opts = { headers: { 'User-Agent': 'node', 'Authorization': 'token ' + token } }; https.get('https://api.github.com/repos/Rizz2001/chekin/releases', opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=> { const rels = JSON.parse(d); const target = rels.find(r => r.draft); if(target) { const data = JSON.stringify({ draft: false }); const req = https.request('https://api.github.com/repos/Rizz2001/chekin/releases/' + target.id, { method: 'PATCH', headers: { 'User-Agent': 'node', 'Authorization': 'token ' + token, 'Content-Type': 'application/json', 'Content-Length': data.length } }, r => console.log('Release ' + target.tag_name + ' publicado exitosamente (draft: false)')); req.write(data); req.end(); } else { console.log('El release ya está publicado correctamente.'); } }); });"
```

### 5. Renombrar el Archivo `.exe` (Si es necesario)
Si por alguna razón el usuario llega a subir el archivo de manera manual desde la interfaz de GitHub, asegúrate de indicarle que NO suba archivos con espacios, o bien arréglalo usando la API de GitHub, ya que GitHub reemplazará los espacios con puntos (ej. `Chekin.Setup.1.0.7.exe`) y el archivo `latest.yml` fallará en encontrar el instalador que debe llamarse exactamente `Chekin-Setup-1.0.7.exe` (con guiones).

### 6. Confirmación al Usuario
Indica al usuario que el proceso ha finalizado y que en las demás PCs el software se actualizará de manera silenciosa descargando el Instalador de un Clic (`latest.yml`).
