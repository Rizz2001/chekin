---
name: desktop-responsive-pro
description: Implementa diseño responsivo 100% profesional para aplicaciones de escritorio (PC). Úsala para adaptar interfaces en distintas resoluciones, manejar redimensionamiento de ventanas y estructurar layouts escalables.
---

# Desktop Responsive Pro

Esta skill asegura que las aplicaciones de escritorio mantengan una interfaz 100% profesional, fluida y escalable en cualquier tamaño de monitor y resolución.

## Cuándo usar
- Al implementar o mejorar el diseño responsivo de una aplicación para PC.
- Cuando se adaptan interfaces para distintas resoluciones de escritorio (ej. laptops de 13", monitores 1080p, 1440p o 4K).
- Al estructurar layouts profesionales utilizando tecnologías web (HTML/CSS/JS) o frameworks multiplataforma (como Flutter).

## Pasos

### 1. Evaluar la Arquitectura del Layout
Determinar el entorno de la aplicación. Para interfaces basadas en web, priorizar CSS Grid y Flexbox. En entornos multiplataforma (ej. Flutter), utilizar `LayoutBuilder` y `MediaQuery` para reaccionar de forma natural a los cambios en el tamaño de la ventana.

### 2. Implementar Medidas Relativas
Sustituir medidas fijas en píxeles por unidades relativas (%, vh, vw, rem, o fr). Esto garantiza que los paneles y tarjetas se adapten proporcionalmente al área disponible.

### 3. Definir Límites de Expansión
En monitores ultra anchos o pantallas grandes, la interfaz no debe estirarse infinitamente. Configurar un `max-width` en los contenedores principales y centrar el contenido para mantener la legibilidad y usabilidad.

### 4. Gestión de Redimensionamiento (Performance)
Al manejar eventos de ajuste de ventana (por ejemplo, con un `addEventListener('resize')` en JavaScript o listeners nativos), implementar técnicas de "debouncing" para evitar que los recálculos excesivos saturen la CPU o GPU (como una GTX 1060) y generen lag visual.

### 5. Optimización de Tipografía y Espaciado
Utilizar funciones dinámicas como `clamp()` o factores de escala para que las fuentes y los márgenes sean perfectos tanto en resoluciones compactas como en monitores amplios.

## Consideraciones y Gotchas
- **Evitar scroll horizontal accidental:** Asegurar que los elementos hijos no desborden su contenedor principal; el contenido de escritorio debe sentirse como un panel sólido, no como una página web rota.
- **Scrollbars (Barras de desplazamiento):** Personalizar el estilo de los scrollbars para que coincidan con la estética profesional del sistema operativo, evitando las barras toscas por defecto.
- **Transiciones fluidas:** Aplicar transiciones sutiles (ej. 0.2s o 0.3s) a los cambios de layout para que el reacomodo de elementos se vea intencional y elegante al cambiar el tamaño de la aplicación.
