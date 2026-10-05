---
name: diseno-premium
description: Utiliza este skill CADA VEZ que vayas a modificar o crear la interfaz gráfica (UI) de Chekin. Obliga a utilizar un diseño Dark Mode Premium, Glassmorphism y estéticas financieras de alta gama.
---

# Sistema de Diseño Premium (Dark Analytics)

Este proyecto requiere una interfaz que deslumbre al usuario, emulando paneles financieros modernos de alta gama (tipo SaaS). **Jamás** debes utilizar diseños básicos, tablas HTML por defecto, o fondos genéricos.

## REGLA DE ORO: Integridad Funcional
**NUNCA cambies ni borres las funcionalidades internas de la aplicación (JavaScript, lógica de botones, llamadas a API o atributos clave de los elementos HTML como sus IDs).** Tu trabajo con este skill se limita estricta y EXCLUSIVAMENTE a modificar lo visual (CSS, animaciones, disposición de elementos y estética HTML). Todo el motor por debajo debe seguir intacto.

## 1. Paleta de Colores Estricta (Dark Mode)
Debes configurar estas variables CSS en el archivo principal de estilos y usarlas exclusivamente:

```css
:root {
  /* Fondos */
  --bg-app: #0A0A0B;          /* Negro profundo para el fondo principal */
  --bg-sidebar: #111114;      /* Negro ligeramente más claro para la barra lateral */
  --bg-card: #151518;         /* Gris muy oscuro para las tarjetas y paneles */
  
  /* Textos */
  --text-primary: #FFFFFF;    /* Blanco puro para títulos y números gigantes */
  --text-secondary: #8A8A93;  /* Gris claro para subtítulos y etiquetas */
  
  /* Acentos Vibrantes (Tipo Pastel/Neon) */
  --accent-blue: #60A5FA;     /* Azul vibrante para botones o tarjetas primarias */
  --accent-orange: #FB923C;   /* Naranja pastel para estados de espera */
  --accent-yellow: #FBBF24;   /* Amarillo pastel para elementos intermedios */
  --accent-green: #4ADE80;    /* Verde pastel para éxitos o tarjetas de "Completado" */
  
  /* Bordes y Divisores */
  --border-color: #27272A;
}
```

## 2. Tipografía y Estructura
- **Fuente:** Importa y utiliza SIEMPRE `Inter` o `Plus Jakarta Sans` desde Google Fonts (`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`).
- **Números:** Los números importantes (ej. montos de dinero, cantidad de órdenes) deben ser gigantes (ej. `font-size: 2.5rem; font-weight: 700;`).

## 3. Radios de Borde (Border Radius)
La estética se basa en bordes muy redondeados para suavizar el modo oscuro:
- **Tarjetas y Paneles:** `border-radius: 20px;` o `24px;`.
- **Botones y Etiquetas (Badges):** `border-radius: 9999px;` (completamente redondos/píldoras).
- **Tarjetas Activas (Sidebar):** Fondo blanco con ícono/texto negro para el elemento activo, bordes de `12px` a `16px`.

## 4. Estructura de Diseño (Layout)
- **Barra Lateral (Sidebar):** Ultra compacta a la izquierda (aprox 80px de ancho). Solo iconos centrados.
- **Tarjetas (Cards):** Utiliza Flexbox o CSS Grid con un `gap` (espaciado) de `1.5rem` o `24px` entre ellas. Las tarjetas deben tener un `padding` interno generoso (`1.5rem` mínimo).
- **Tablas de Datos:** 
  - Elimina los bordes verticales (`border-left`/`border-right`).
  - Usa un borde muy sutil (`var(--border-color)`) solo abajo de cada fila.
  - Mucho `padding` (`1rem` vertical).
  - El texto de las cabeceras (`<th>`) debe ir en minúsculas, color `var(--text-secondary)`, y `font-weight: 500`.

## 5. Micro-Animaciones
Toda tarjeta o botón debe sentirse "viva". 
Agrega un `transition: all 0.3s ease;` y en el estado `:hover` haz que la tarjeta se eleve un poco (`transform: translateY(-3px);`) y aumente sutilmente su brillo (ej. `background: #1c1c20;`). No uses sombras (`box-shadow`) pesadas; en modo oscuro se usan bordes de 1px o brillos muy ligeros.
