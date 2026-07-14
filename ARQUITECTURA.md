# Visor Geofísico — Arquitectura

## Stack
- Three.js v0.150.1 (local en `shared/js/`, sin CDN)
- OrbitControls adaptado a `THREE` global
- Sin bundlers, sin npm. 100% vanilla JS.
- 100% offline vía Service Worker.

## Estructura de carpetas

```
VisorGeofisico/
├── index.html                    ← Visor único (recibe ?p=proyecto&k=token)
├── admin.html                    ← Lista de proyectos (solo con ?k=admin-2024)
├── sw.js                         ← Service Worker (precache + cache dinámico)
├── ARQUITECTURA.md               ← Este archivo
├── shared/
│   ├── css/
│   │   └── visor-styles.css
│   └── js/
│       ├── three.min.js
│       ├── OrbitControls.js
│       ├── tokens.js             ← Pool de 20 tokens de proyectos + admin
│       └── visor-core.js         ← Motor del visor (render, UI, carga progresiva)
└── proyectos/
    └── proyecto-mariscal-01/     ← Solo datos y config.js (sin index.html)
        ├── config.js             ← window.PROYECTO_TOKEN_INDEX
        ├── terreno_data.js       ← window.DATA_TERRENO
        ├── pl_data.js            ← window.DATA_PROGRESIVAS
        ├── perfil1_data.js       ← carga dinámica desde visor-core.js
        ├── perfil2_data.js
        ├── perfil3_data.js
        └── perfil4_data.js
```

## Flujo de carga

1. `index.html` carga en `<head>`:
   `tokens.js` → `three.min.js` → `OrbitControls.js`
2. `visor-core.js` se ejecuta al final del `<body>`:
   a. Lee `?p=` (proyecto) y `?k=` (token) de la URL
   b. Carga dinámicamente `proyectos/<p>/config.js`
   c. Valida `k` contra `TOKEN_POOL[PROYECTO_TOKEN_INDEX]`. Si inválido → loading screen "Acceso denegado", no renderiza nada.
   d. Carga dinámicamente `terreno_data.js` y `pl_data.js`
   e. `initScene()` → renderer 3D, cámara, controles, UI
   f. Carga perfiles 1 a 4 (dinámico con yield y barra de progreso)
   g. Activa vista 2D del primer perfil
   h. Oculta loading screen

## Protección por token

Cada proyecto tiene un índice en `TOKEN_POOL` (definido en `tokens.js`).
El `config.js` del proyecto guarda solo el índice:

```js
// shared/js/tokens.js
window.TOKEN_POOL = ['vismar-2024', 'proy01-a8f3k', ...];
window.ADMIN_TOKEN = 'admin-2024';

// proyectos/mi-proyecto/config.js
window.PROYECTO_TOKEN_INDEX = 0;
```

**URL a compartir con el cliente:** `.../VisorGeofisico/?p=proyecto-mariscal-01&k=vismar-2024`
**URL del admin:** `.../VisorGeofisico/admin.html?k=admin-2024`

Sin `?k=TOKEN` → loading screen muestra "Acceso denegado", no se renderiza nada.

## Tabla de tokens

| Índice | Token           | Proyecto                |
|--------|-----------------|-------------------------|
| 0      | `vismar-2024`   | proyecto-mariscal-01    |
| 1      | `proy01-a8f3k`  | disponible              |
| 2      | `proy02-b7k2m`  | disponible              |
| 3      | `proy03-c4n9p`  | disponible              |
| 4      | `proy04-d5m1r`  | disponible              |
| 5      | `proy05-e2v8x`  | disponible              |
| 6      | `proy06-f3k9p`  | disponible              |
| 7      | `proy07-g4n1m`  | disponible              |
| 8      | `proy08-h5r2x`  | disponible              |
| 9      | `proy09-i6v3k`  | disponible              |
| 10     | `proy10-j7n4m`  | disponible              |
| 11     | `proy11-k8r5p`  | disponible              |
| 12     | `proy12-l9v6x`  | disponible              |
| 13     | `proy13-m1n7k`  | disponible              |
| 14     | `proy14-n2r8m`  | disponible              |
| 15     | `proy15-o3v9p`  | disponible              |
| 16     | `proy16-p4n1x`  | disponible              |
| 17     | `proy17-q5r2k`  | disponible              |
| 18     | `proy18-r6v3m`  | disponible              |
| 19     | `proy19-s7n4p`  | disponible              |
| Admin  | `admin-2024`    | admin.html              |

## Service Worker (`sw.js`)

- **Install**: precachea `shared/css/` + `shared/js/` (three, OrbitControls, tokens, visor-core)
- **Fetch**: cache-first con actualización dinámica (cachea todo lo que pasa)
- **Activate**: limpia caches viejos, `clients.claim()` para control inmediato
- Al cambiar versión de la app: incrementar `CACHE` en `sw.js` (ej. `visor-cache-v2`)

## Botón Compartir

- En `admin.html`, cada proyecto tiene un botón ⧉ al lado del nombre.
- Copia al portapapeles la URL completa: `index.html?p=PROYECTO&k=TOKEN`.
- Feedback: cambia a "✓" verde por 2 segundos.
- No hay botón compartir dentro del visor (solo en admin).

## Cómo agregar un nuevo proyecto

1. Elegir el siguiente índice libre de la tabla de tokens.
2. Crear carpeta: `proyectos/nuevo-cliente/`
3. Crear `config.js`: `window.PROYECTO_TOKEN_INDEX = N`
4. Poner sus datos: `terreno_data.js`, `pl_data.js`, `perfilN_data.js` (sin index.html)
5. Agregar `<li>` en `admin.html` con el enlace y botón ⧉: `<a class="proj-link" href="index.html?p=nuevo-cliente&k=TOKEN">📌 NOMBRE</a><button class="btn-share" onclick="copiarEnlace('nuevo-cliente','TOKEN',this)" title="Copiar enlace">⧉</button>`
6. `git add . && git commit -m "add proyecto X" && git push`
7. Compartir al cliente: `.../VisorGeofisico/index.html?p=nuevo-cliente&k=TOKEN`

## Publicación

- Repo privado en GitHub.
- GitHub Pages: branch `main`, carpeta `/VisorGeofisico`.
- URL base: `https://<user>.github.io/<repo>/VisorGeofisico/`
