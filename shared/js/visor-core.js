window.toggleAccordion = function(header) {
    header.classList.toggle('active');
    const content = header.nextElementSibling;
    const chevron = header.querySelector('.chevron');
    if (header.classList.contains('active')) {
        content.style.display = 'block';
        chevron.innerText = '▲';
    } else {
        content.style.display = 'none';
        chevron.innerText = '▼';
    }
};

let scene, camera, renderer, controls;
let terrenoMesh = null;
let terrenoCrudoData = null; 
let nombreArchivoTerreno = null; 

const perfilesCargados = {}; 
const perfilesRawData = {}; 
const progresivasCargadas = {}; 
const profileToTxtMap = {}; 

let centerOffset = null; 
let activeProfileName = null; 

let canvas2D, ctx2D;
let dataProyeccion2D = null; 
let isProcessing2D = false;
let currentRenderId = 0; 
let laserMesh = null; 

let snapS = null; 

let zoom2D = 1.0;
let panX = 0;
let panY = 0;

const rawMeshCanvas = document.createElement('canvas');
const ctxRaw = rawMeshCanvas.getContext('2d', { alpha: true });
let escalaRaw = 1;

const canvas2DCache = document.createElement('canvas');
const ctxCache = canvas2DCache.getContext('2d', { alpha: false });

let transX = 0, transY = 0, escalaGlobal = 1, minZ_grid = 0;
const dpr = Math.min(window.devicePixelRatio || 1, 2); 

let raycastTimeout = null; 

function init() {
    const container = document.getElementById('canvas-3d');
    canvas2D = document.getElementById('canvas-2d');
    ctx2D = canvas2D.getContext('2d', { alpha: false });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    
    const ch = container.clientHeight || window.innerHeight;
    const cw = container.clientWidth || window.innerWidth / 2;
    camera = new THREE.PerspectiveCamera(45, cw / ch, 1, 100000);
    camera.position.set(500, -800, 500);
    camera.up.set(0, 0, 1); 

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(cw, ch);
    renderer.setPixelRatio(dpr);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight.position.set(2000, 2000, 10000);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(10000, 100, 0x333333, 0x1a1a1a);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    const sg = new THREE.SphereGeometry(1, 16, 16);
    const sm = new THREE.MeshBasicMaterial({color: 0xff1744, depthTest: false});
    laserMesh = new THREE.Mesh(sg, sm);
    laserMesh.renderOrder = 999;
    laserMesh.visible = false;
    scene.add(laserMesh);

    vincularEventosUI();
    animate();
    setTimeout(onWindowResize, 100);

    cargarDatosPreestablecidos();
}

async function cargarDatosPreestablecidos() {
    const loadingScreen = document.getElementById('loading-screen');
    const updateProgress = (text) => {
        const el = document.getElementById('loading-text');
        if (el) el.innerText = text;
    };

    try {
        // 1. Carga del terreno 3D desde variable global window.DATA_TERRENO
        updateProgress("Cargando terreno 3D...");
        if (window.DATA_TERRENO) {
            const data = window.DATA_TERRENO;
            terrenoCrudoData = data; 
            nombreArchivoTerreno = "terreno_web.json";
            construirTerreno(data, "terreno_web.json");
        }

        // 2. Carga concurrente de TODOS los perfiles desde variable global window.DATA_PERFILES y window.DATA_PROGRESIVAS
        updateProgress("Cargando perfiles geofísicos...");
        if (window.DATA_PERFILES && window.DATA_PROGRESIVAS) {
            const nombresPerfiles = Object.keys(window.DATA_PERFILES);
            let primerValido = null;

            nombresPerfiles.forEach((nombre) => {
                try {
                    const dataPerfil = window.DATA_PERFILES[nombre];
                    construirPerfil(dataPerfil, nombre);
                    
                    const nombreTXT = nombre.replace('Perfil', 'PL').replace('.json', '.txt');
                    const txtData = window.DATA_PROGRESIVAS[nombreTXT];
                    if (txtData) {
                        procesarProgresivasTXT(txtData, nombreTXT);
                    }
                    if (!primerValido) {
                        primerValido = { nombre, data: dataPerfil };
                    }
                } catch (e) {
                    console.warn(`Error al cargar preestablecido ${nombre}:`, e);
                }
            });

            // 3. Activar la vista 2D del primer perfil válido de forma síncrona antes de retirar la pantalla de carga
            if (primerValido) {
                updateProgress("Procesando proyección 2D...");
                await activarPerfil2D(primerValido.nombre, primerValido.data);
            }
        }
    } catch (err) {
        console.error("Error durante la inicialización de datos:", err);
    } finally {
        // Cierra la pantalla de carga de manera segura
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            loadingScreen.style.visibility = 'hidden';
            setTimeout(() => loadingScreen.remove(), 500);
        }
    }
}

function procesarProgresivasTXT(text, filename) {
    const lines = text.trim().split('\n');
    const data = [];
    for(let line of lines) {
        const parts = line.trim().split(/\s+/);
        if(parts.length >= 5) {
            const id = parseInt(parts[0]);
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            const s = parseFloat(parts[4]);
            
            if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(s)) {
                data.push({ id, x, y, z, s });
            }
        }
    }
    if(data.length > 0) {
        data.sort((a,b) => a.s - b.s); 
        progresivasCargadas[filename] = data;
        
        let alt1 = filename.replace('PL', 'Perfil').replace('.txt', '.json');
        let alt2 = filename.replace('.txt', '.json');
        
        if (perfilesRawData[alt1] && !profileToTxtMap[alt1]) {
            profileToTxtMap[alt1] = filename;
        } else if (perfilesRawData[alt2] && !profileToTxtMap[alt2]) {
            profileToTxtMap[alt2] = filename;
        }
        
        renderListaProgresivas();
        actualizarEstadoVinculoTXT(); 
    }
}

function renderListaProgresivas() {
    const container = document.getElementById('lista-progresivas');
    const txtNames = Object.keys(progresivasCargadas);
    
    if (txtNames.length === 0) {
        container.innerHTML = `<div id="empty-txt-msg" style="font-size: 12px; color: #555; text-align: center; padding: 10px; border: 1px dashed #333; border-radius: 6px;">Sin progresivas (TXT)</div>`;
        return;
    }

    container.innerHTML = '';
    const perfilesDisponibles = Object.keys(perfilesRawData);

    txtNames.forEach(txtName => {
        const div = document.createElement('div');
        div.className = 'layer-item';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'stretch';
        div.style.gap = '6px';
        
        let currentProfile = "";
        for (const [pName, tName] of Object.entries(profileToTxtMap)) {
            if (tName === txtName) currentProfile = pName;
        }

        let optionsHtml = `<option value="">-- Ninguno --</option>`;
        perfilesDisponibles.forEach(pName => {
            const selected = pName === currentProfile ? 'selected' : '';
            optionsHtml += `<option value="${pName}" ${selected}>${pName.replace('.json', '')}</option>`;
        });

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size: 12px; font-weight:bold; color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    📄 ${txtName}
                </span>
                <button class="btn-action btn-del-txt" style="color:var(--danger-color); font-size:14px; font-weight:bold;" title="Eliminar archivo TXT">&times;</button>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap: 5px;">
                <span style="font-size:10px; color:#888;">Asignar a:</span>
                <select class="txt-select-profile" style="background:#222; border:1px solid #444; color:#fff; font-size:11px; padding:2px 4px; border-radius:4px; flex-grow:1; outline:none; cursor:pointer;">
                    ${optionsHtml}
                </select>
            </div>
        `;

        div.querySelector('.btn-del-txt').addEventListener('click', () => {
            delete progresivasCargadas[txtName];
            if (currentProfile) delete profileToTxtMap[currentProfile];
            renderListaProgresivas();
            actualizarEstadoVinculoTXT();
            if (activeProfileName === currentProfile) activarPerfil2D(activeProfileName, perfilesRawData[activeProfileName]);
        });

        div.querySelector('.txt-select-profile').addEventListener('change', (e) => {
            const newProfile = e.target.value;
            for (const pName in profileToTxtMap) {
                if (profileToTxtMap[pName] === txtName) delete profileToTxtMap[pName];
            }
            if (newProfile) profileToTxtMap[newProfile] = txtName;
            
            actualizarEstadoVinculoTXT();
            if (activeProfileName === newProfile || activeProfileName === currentProfile) {
                activarPerfil2D(activeProfileName, perfilesRawData[activeProfileName]);
            }
        });

        container.appendChild(div);
    });
}

function actualizarEstadoVinculoTXT() {
    for (const profileName in perfilesRawData) {
        const safeId = profileName.replace(/[^a-zA-Z0-9]/g, '_');
        const nameSpan = document.getElementById(`name-${safeId}`);
        if (nameSpan) {
            if (profileToTxtMap[profileName]) {
                nameSpan.style.textDecoration = 'underline';
                nameSpan.style.textDecorationColor = '#81c784';
                nameSpan.style.textDecorationStyle = 'dashed';
                nameSpan.style.textDecorationThickness = '1.5px';
                nameSpan.title = "Progresivas TXT Vinculadas";
            } else {
                nameSpan.style.textDecoration = 'none';
                nameSpan.title = "";
            }
        }
    }
}

function obtenerCoordenadasDesdeS(S, poliLinea) {
    if (!poliLinea || poliLinea.length === 0) return null;
    if (poliLinea.length === 1) return { x: poliLinea[0].x, y: poliLinea[0].y, z: poliLinea[0].z, s: S };

    let p1 = poliLinea[0];
    let p2 = poliLinea[poliLinea.length - 1];

    if (S <= p1.s) { 
        p2 = poliLinea[1]; 
    } else if (S >= p2.s) { 
        p1 = poliLinea[poliLinea.length - 2]; 
    } else {
        for(let i = 0; i < poliLinea.length - 1; i++) {
            if (S >= poliLinea[i].s && S <= poliLinea[i+1].s) {
                p1 = poliLinea[i];
                p2 = poliLinea[i+1];
                break;
            }
        }
    }

    let range = p2.s - p1.s;
    let t = (range === 0) ? 0 : (S - p1.s) / range;
    
    return {
        x: p1.x + t * (p2.x - p1.x),
        y: p1.y + t * (p2.y - p1.y),
        z: (p1.z !== undefined && p2.z !== undefined) ? p1.z + t * (p2.z - p1.z) : undefined,
        s: S
    };
}

function obtenerCoordenadasReales(S) {
    if (!activeProfileName) return null;
    let txtName = profileToTxtMap[activeProfileName];
    let txtData = txtName ? progresivasCargadas[txtName] : null;
    
    if (txtData) {
        return obtenerCoordenadasDesdeS(S, txtData); 
    } else if (dataProyeccion2D && dataProyeccion2D.spineFallback) {
        return obtenerCoordenadasDesdeS(S, dataProyeccion2D.spineFallback);
    }
    return null;
}

function crearSpineFallback(data) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let pMinX = null, pMaxX = null, pMinY = null, pMaxY = null;
    
    data.forEach(capa => {
        for (let i = 0; i < capa.vertices.length; i += 3) {
            let vx = capa.vertices[i], vy = capa.vertices[i+1];
            if (Number.isFinite(vx) && Number.isFinite(vy)) {
                if (vx < minX) { minX = vx; pMinX = {x:vx, y:vy}; }
                if (vx > maxX) { maxX = vx; pMaxX = {x:vx, y:vy}; }
                if (vy < minY) { minY = vy; pMinY = {x:vx, y:vy}; }
                if (vy > maxY) { maxY = vy; pMaxY = {x:vx, y:vy}; }
            }
        }
    });
    
    let pStart, pEnd;
    if ((maxX - minX) >= (maxY - minY)) { pStart = pMinX; pEnd = pMaxX; } 
    else { pStart = pMinY; pEnd = pMaxY; }
    
    let dirX = pEnd.x - pStart.x, dirY = pEnd.y - pStart.y;
    let length = Math.hypot(dirX, dirY);
    if (length === 0) return [];
    
    let uX = dirX / length, uY = dirY / length;
    
    let numBins = 100; 
    let bins = Array.from({length: numBins}, () => ({ sumX: 0, sumY: 0, count: 0 }));
    let minProj = Infinity, maxProj = -Infinity;
    
    data.forEach(capa => {
        for (let i = 0; i < capa.vertices.length; i += 3) {
            let vx = capa.vertices[i], vy = capa.vertices[i+1];
            if (Number.isFinite(vx)) {
                let proj = (vx - pStart.x) * uX + (vy - pStart.y) * uY;
                if (proj < minProj) minProj = proj;
                if (proj > maxProj) maxProj = proj;
            }
        }
    });
    
    let projRange = maxProj - minProj;
    if (projRange === 0) return [];

    data.forEach(capa => {
        for (let i = 0; i < capa.vertices.length; i += 3) {
            let vx = capa.vertices[i], vy = capa.vertices[i+1];
            if (Number.isFinite(vx)) {
                let proj = (vx - pStart.x) * uX + (vy - pStart.y) * uY;
                let t = (proj - minProj) / projRange;
                let binIdx = Math.max(0, Math.min(numBins - 1, Math.floor(t * numBins)));
                bins[binIdx].sumX += vx;
                bins[binIdx].sumY += vy;
                bins[binIdx].count++;
            }
        }
    });
    
    let spine = [];
    let currentS = 0;
    let lastPt = null;
    
    for (let i = 0; i < numBins; i++) {
        if (bins[i].count > 0) {
            let pt = { x: bins[i].sumX / bins[i].count, y: bins[i].sumY / bins[i].count };
            if (lastPt) {
                currentS += Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
            }
            spine.push({ x: pt.x, y: pt.y, s: currentS });
            lastPt = pt;
        }
    }
    return spine;
}

function toggle2DPanel() {
    document.getElementById('main-wrapper').classList.toggle('is-2d-collapsed');
    setTimeout(onWindowResize, 310);
}

function cambiarPerfilSiguiente(direccion) {
    const nombres = Object.keys(perfilesRawData);
    if (nombres.length === 0) return;
    let idx = nombres.indexOf(activeProfileName);
    if (idx === -1) {
        idx = 0;
    } else {
        idx = (idx + direccion + nombres.length) % nombres.length;
    }
    const nuevoNombre = nombres[idx];
    if (nuevoNombre && perfilesRawData[nuevoNombre]) {
        activarPerfil2D(nuevoNombre, perfilesRawData[nuevoNombre]);
    }
}

function centrarVistaEnProgresiva(S) {
    if (!dataProyeccion2D) return;
    const logicalW = canvas2D.width / dpr;
    const paddingLeft = 60;
    const paddingRight = 60;
    const w_canvas = logicalW - (paddingLeft + paddingRight);
    
    panX = (logicalW / 2) - paddingLeft - (w_canvas - dataProyeccion2D.longitud * escalaGlobal) / 2 - (S - dataProyeccion2D.minS) * escalaGlobal;
    
    reconstruirCacheScreen();
    actualizarHUDCentral();
}

function aplicarZoomCentrado(nuevoZoom) {
    if (!dataProyeccion2D) return;
    const logicalW = canvas2D.width / dpr;
    const logicalH = canvas2D.height / dpr;
    const cx = logicalW / 2;
    const cy = logicalH / 2;

    const sCentro = dataProyeccion2D.minS + (cx - transX) / escalaGlobal;
    const zCentro = dataProyeccion2D.minZ_grid + (transY - cy) / escalaGlobal;

    zoom2D = nuevoZoom;

    const paddingLeft = 60, paddingRight = 60, paddingTop = 40;
    const paddingBottom = window.innerWidth <= 768 ? 120 : 60;
    const w_canvas = logicalW - (paddingLeft + paddingRight);
    const h_canvas = logicalH - (paddingTop + paddingBottom);
    
    const rngS = Math.max(dataProyeccion2D.maxS - dataProyeccion2D.minS, 1);
    const rngZ = Math.max(dataProyeccion2D.maxZ_grid - dataProyeccion2D.minZ_grid, 1);
    const baseEscala = Math.min(w_canvas / rngS, h_canvas / rngZ);
    const nuevaEscalaGlobal = baseEscala * zoom2D;

    const nuevaBaseX = paddingLeft + (w_canvas - rngS * nuevaEscalaGlobal) / 2;
    const nuevaBaseY = paddingTop + (h_canvas + rngZ * nuevaEscalaGlobal) / 2;

    panX = cx - nuevaBaseX - (sCentro - dataProyeccion2D.minS) * nuevaEscalaGlobal;
    panY = cy - nuevaBaseY + (zCentro - dataProyeccion2D.minZ_grid) * nuevaEscalaGlobal;

    if (snapS !== null) {
        panX = cx - nuevaBaseX - (snapS - dataProyeccion2D.minS) * nuevaEscalaGlobal;
    }

    reconstruirCacheScreen();
    actualizarHUDCentral();
}

function vincularEventosUI() {
    const bindEvent = (id, event, callback) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, callback);
    }

    bindEvent('toggle-sidebar', 'click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('collapsed');
        const btn = document.getElementById('toggle-sidebar');
        btn.innerHTML = sidebar.classList.contains('collapsed') ? '☰' : '✕';
        setTimeout(onWindowResize, 310);
    });

    bindEvent('btn-toggle-2d', 'click', toggle2DPanel);
    bindEvent('toggle-2d-sidebar', 'click', toggle2DPanel);
    bindEvent('btn-prev-profile', 'click', () => cambiarPerfilSiguiente(-1));
    bindEvent('btn-next-profile', 'click', () => cambiarPerfilSiguiente(1));

    const searchInput = document.getElementById('search-progressive');

    searchInput.addEventListener('input', (e) => {
        if (!dataProyeccion2D) return;
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= dataProyeccion2D.minS && val <= dataProyeccion2D.maxS) {
            snapS = val;
            searchInput.style.color = "var(--accent-color)";
            centrarVistaEnProgresiva(snapS);
        } else {
            snapS = null;
            searchInput.style.color = e.target.value === '' ? "var(--accent-color)" : "var(--danger-color)";
            actualizarHUDCentral();
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
            searchInput.blur();
            if(e.key === 'Escape') {
                searchInput.value = '';
                snapS = null;
                searchInput.style.color = "var(--accent-color)";
                actualizarHUDCentral();
            }
        }
    });

    bindEvent('btn-refresh-2d', 'click', () => {
        zoom2D = 1.0; panX = 0; panY = 0; snapS = null; 
        document.getElementById('search-progressive').value = '';
        document.getElementById('search-progressive').style.color = "var(--accent-color)";
        if(dataProyeccion2D) {
            centrarVistaEnProgresiva(dataProyeccion2D.minS + (dataProyeccion2D.maxS - dataProyeccion2D.minS)/2);
        }
    });

    bindEvent('chk-terreno', 'change', (e) => { if (terrenoMesh) terrenoMesh.visible = e.target.checked; });
    
    bindEvent('color-terreno', 'input', (e) => { 
        document.getElementById('hex-terreno').innerText = e.target.value.toUpperCase();
        if (terrenoMesh) { 
            if (Array.isArray(terrenoMesh.material)) {
                terrenoMesh.material[0].color.set(e.target.value);
                terrenoMesh.material[1].color.set(e.target.value);
            } else {
                terrenoMesh.material.color.set(e.target.value); 
            }
        } 
    });

    bindEvent('opacity-terreno', 'input', (e) => { 
        if (terrenoMesh) { 
            const val = parseFloat(e.target.value);
            if (Array.isArray(terrenoMesh.material)) {
                terrenoMesh.material[0].opacity = val;
                if (!document.getElementById('chk-cortinas').checked) {
                    terrenoMesh.material[1].opacity = val;
                }
            } else {
                terrenoMesh.material.opacity = val; 
            }
        } 
    });
    
    bindEvent('chk-cortinas', 'change', (e) => { 
        if (terrenoMesh && Array.isArray(terrenoMesh.material)) {
            const cortinasTransparentes = e.target.checked;
            terrenoMesh.material[1].opacity = cortinasTransparentes ? 0.05 : parseFloat(document.getElementById('opacity-terreno').value);
            terrenoMesh.material[1].depthWrite = !cortinasTransparentes;
        }
    });

    bindEvent('z-limit-input', 'change', () => { 
        if (terrenoCrudoData) construirTerreno(terrenoCrudoData, nombreArchivoTerreno || "Terreno"); 
    });

    bindEvent('file-loader', 'change', (e) => {
        const files = e.target.files;
        for (let file of files) {
            const reader = new FileReader();
            reader.onload = function(event) {
                if (file.name.toLowerCase().endsWith('.txt')) {
                    procesarProgresivasTXT(event.target.result, file.name);
                } else {
                    try {
                        const data = JSON.parse(event.target.result);
                        if (data.tipo === "terreno") {
                            terrenoCrudoData = data; nombreArchivoTerreno = file.name;
                            construirTerreno(data, file.name);
                        } else if (Array.isArray(data)) {
                            construirPerfil(data, file.name);
                        }
                    } catch (err) { alert("Error al procesar el archivo JSON: " + err.message); }
                }
            };
            reader.readAsText(file);
        }
        e.target.value = '';
    });

    window.addEventListener('resize', onWindowResize);
    
    if (canvas2D) {
        let isDragging2D = false;
        let lastPanClientX = 0, lastPanClientY = 0;
        let touchStartDist = 0;
        let isPinchZooming = false;

        canvas2D.addEventListener('wheel', (e) => {
            if (!dataProyeccion2D) return;
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            aplicarZoomCentrado(Math.max(0.5, Math.min(30, zoom2D * zoomFactor)));
        }, { passive: false });

        canvas2D.addEventListener('mousedown', (e) => {
            if (!dataProyeccion2D) return;
            isDragging2D = true;
            lastPanClientX = e.clientX;
            lastPanClientY = e.clientY;
        });

        canvas2D.addEventListener('mousemove', (e) => {
            if (!dataProyeccion2D || !isDragging2D) return;
            const dx = e.clientX - lastPanClientX;
            const dy = e.clientY - lastPanClientY;
            lastPanClientX = e.clientX;
            lastPanClientY = e.clientY;

            if (snapS === null) panX += dx;
            panY += dy;
            
            reconstruirCacheScreen();
            actualizarHUDCentral();
        });

        window.addEventListener('mouseup', () => { isDragging2D = false; });

        canvas2D.addEventListener('touchstart', (e) => {
            if (!dataProyeccion2D) return;
            isDragging2D = true;

            if (e.touches.length === 1) {
                isPinchZooming = false;
                lastPanClientX = e.touches[0].clientX;
                lastPanClientY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                isPinchZooming = true;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                touchStartDist = Math.hypot(dx, dy);
            }
        }, { passive: false });

        canvas2D.addEventListener('touchmove', (e) => {
            if (!dataProyeccion2D) return;
            e.preventDefault(); 

            if (isPinchZooming && e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const currentDist = Math.hypot(dx, dy);
                if (touchStartDist > 0) {
                    const factor = currentDist / touchStartDist;
                    const dampFactor = 1 + (factor - 1) * 0.4; 
                    aplicarZoomCentrado(Math.max(0.5, Math.min(30, zoom2D * dampFactor)));
                    touchStartDist = currentDist;
                }
            } else if (isDragging2D && e.touches.length === 1 && !isPinchZooming) {
                const dx = e.touches[0].clientX - lastPanClientX;
                const dy = e.touches[0].clientY - lastPanClientY;
                lastPanClientX = e.touches[0].clientX;
                lastPanClientY = e.touches[0].clientY;

                if (snapS === null) panX += dx;
                panY += dy;
                
                reconstruirCacheScreen();
                actualizarHUDCentral();
            }
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) {
                isPinchZooming = false;
                if (e.touches.length === 1) {
                    lastPanClientX = e.touches[0].clientX;
                    lastPanClientY = e.touches[0].clientY;
                }
            }
            if (e.touches.length === 0) isDragging2D = false;
        });
    }
}

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }

function onWindowResize() {
    const container = document.getElementById('canvas-3d');
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    resize2DCanvas();
}

function resize2DCanvas() {
    if (!canvas2D) return;
    const rect = canvas2D.parentElement.getBoundingClientRect();
    const headerH = document.getElementById('view-2d-header').offsetHeight;
    
    const logicalW = rect.width;
    let logicalH = rect.height - headerH;
    if (logicalH < 0) logicalH = 0;
    
    canvas2D.width = logicalW * dpr;
    canvas2D.height = logicalH * dpr;
    canvas2D.style.width = `${logicalW}px`;
    canvas2D.style.height = `${logicalH}px`;
    
    if (logicalH > 0) {
        if (!isProcessing2D && dataProyeccion2D) {
            reconstruirCacheScreen(); 
            actualizarHUDCentral();
        } else if (!dataProyeccion2D) {
            ctx2D.fillStyle = '#0a0a0a';
            ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);
        }
    }
}

function obtenerOffset(vertices) {
    if (centerOffset === null && vertices && vertices.length >= 3) {
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;
        for (let i = 0; i < vertices.length; i += 3) { 
            if (Number.isFinite(vertices[i]) && Number.isFinite(vertices[i+1]) && Number.isFinite(vertices[i+2])) {
                sumX += vertices[i]; sumY += vertices[i+1]; sumZ += vertices[i+2]; count++;
            }
        }
        if (count > 0) {
            centerOffset = new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
        } else {
            centerOffset = new THREE.Vector3(0, 0, 0);
        }
    }
}

function liberarMemoriaMesh(mesh) {
    if (!mesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else mesh.material.dispose();
    }
}

function construirTerreno(data, nombreArchivo) {
    const inputVal = parseFloat(document.getElementById('z-limit-input').value);
    const zLimite = isNaN(inputVal) ? -999999 : inputVal;

    const carasSuperficie = [];
    const carasCortina = [];
    const numVertices = data.vertices.length / 3;

    for (let i = 0; i < data.caras.length; i += 3) {
        let idx1 = data.caras[i];
        let idx2 = data.caras[i+1];
        let idx3 = data.caras[i+2];

        if (idx1 >= numVertices || idx2 >= numVertices || idx3 >= numVertices) continue;

        let x1 = data.vertices[idx1 * 3],     y1 = data.vertices[idx1 * 3 + 1], z1 = data.vertices[idx1 * 3 + 2];
        let x2 = data.vertices[idx2 * 3],     y2 = data.vertices[idx2 * 3 + 1], z2 = data.vertices[idx2 * 3 + 2];
        let x3 = data.vertices[idx3 * 3],     y3 = data.vertices[idx3 * 3 + 1], z3 = data.vertices[idx3 * 3 + 2];
        
        if (Number.isFinite(z1) && Number.isFinite(z2) && Number.isFinite(z3)) {
            if (z1 >= zLimite && z2 >= zLimite && z3 >= zLimite) {
                let esParedVertical = false;
                
                let ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
                let vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;
                
                let nx = (uy * vz) - (uz * vy);
                let ny = (uz * vx) - (ux * vz);
                let nz = (ux * vy) - (uy * vx);
                
                let length = Math.sqrt(nx*nx + ny*ny + nz*nz);
                if (length > 0) {
                    let normalizedNz = Math.abs(nz / length);
                    if (normalizedNz < 0.15) { 
                        esParedVertical = true;
                    }
                }

                if (esParedVertical) {
                    carasCortina.push(idx1, idx2, idx3);
                } else {
                    carasSuperficie.push(idx1, idx2, idx3);
                }
            }
        }
    }

    if (carasSuperficie.length + carasCortina.length === 0) return;

    let isFirstLoad = (terrenoMesh === null);

    if (terrenoMesh) { 
        scene.remove(terrenoMesh); 
        liberarMemoriaMesh(terrenoMesh); 
    }

    obtenerOffset(data.vertices);
    
    const indexMap = new Map();
    const verticesEmpaquetados = [];
    const carasSupEmpaquetadas = [];
    const carasCortEmpaquetadas = [];
    let indexCounter = 0;

    const procesarCara = (oldIdx, arrayDestino) => {
        if (!indexMap.has(oldIdx)) {
            indexMap.set(oldIdx, indexCounter);
            verticesEmpaquetados.push(
                data.vertices[oldIdx * 3] - centerOffset.x,
                data.vertices[oldIdx * 3 + 1] - centerOffset.y,
                data.vertices[oldIdx * 3 + 2] - centerOffset.z
            );
            indexCounter++;
        }
        arrayDestino.push(indexMap.get(oldIdx));
    };

    for (let i = 0; i < carasSuperficie.length; i++) procesarCara(carasSuperficie[i], carasSupEmpaquetadas);
    for (let i = 0; i < carasCortina.length; i++) procesarCara(carasCortina[i], carasCortEmpaquetadas);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verticesEmpaquetados), 3));
    
    const allIndices = new Uint32Array(carasSupEmpaquetadas.length + carasCortEmpaquetadas.length);
    allIndices.set(carasSupEmpaquetadas, 0);
    allIndices.set(carasCortEmpaquetadas, carasSupEmpaquetadas.length);
    
    geometry.setIndex(new THREE.BufferAttribute(allIndices, 1));
    
    geometry.addGroup(0, carasSupEmpaquetadas.length, 0);
    geometry.addGroup(carasSupEmpaquetadas.length, carasCortEmpaquetadas.length, 1);
    
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere(); 

    const baseColor = document.getElementById('color-terreno').value;
    const baseOpacity = parseFloat(document.getElementById('opacity-terreno').value);
    const cortinasTrans = document.getElementById('chk-cortinas').checked;

    const matNormal = new THREE.MeshLambertMaterial({ 
        color: baseColor, transparent: true, opacity: baseOpacity, side: THREE.DoubleSide 
    });
    
    const matCortina = new THREE.MeshLambertMaterial({ 
        color: baseColor, transparent: true, 
        opacity: cortinasTrans ? 0.05 : baseOpacity, 
        depthWrite: !cortinasTrans,
        side: THREE.DoubleSide 
    });

    terrenoMesh = new THREE.Mesh(geometry, [matNormal, matCortina]);
    scene.add(terrenoMesh);
    
    if (isFirstLoad && geometry.boundingSphere && !isNaN(geometry.boundingSphere.center.x)) {
        controls.target.copy(geometry.boundingSphere.center);
        camera.position.set(
            geometry.boundingSphere.center.x + 300, 
            geometry.boundingSphere.center.y - 400, 
            geometry.boundingSphere.center.z + 300
        );
    }
    
    actualizarUILista(nombreArchivo, 'terreno');
}

function construirPerfil(data, nombreArchivo) {
    if (perfilesCargados[nombreArchivo]) { perfilesCargados[nombreArchivo].forEach(m => { scene.remove(m); liberarMemoriaMesh(m); }); }
    if (data.length > 0 && data[0].vertices && data[0].vertices.length > 0) obtenerOffset(data[0].vertices);

    perfilesRawData[nombreArchivo] = data; 

    const meshes = [];
    const bboxGlobal = new THREE.Box3();

    data.forEach(capa => {
        const geometry = new THREE.BufferGeometry();
        const verticesModificados = new Float32Array(capa.vertices.length);
        for (let i = 0; i < capa.vertices.length; i += 3) {
            verticesModificados[i]   = Number.isFinite(capa.vertices[i]) ? (capa.vertices[i] - centerOffset.x) : 0;
            verticesModificados[i+1] = Number.isFinite(capa.vertices[i+1]) ? (capa.vertices[i+1] - centerOffset.y) : 0;
            verticesModificados[i+2] = Number.isFinite(capa.vertices[i+2]) ? (capa.vertices[i+2] - centerOffset.z) : 0;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(verticesModificados, 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(capa.caras), 1)); 
        geometry.computeVertexNormals(); 
        geometry.computeBoundingBox();
        
        if (geometry.boundingBox && !isNaN(geometry.boundingBox.min.x)) {
            bboxGlobal.union(geometry.boundingBox);
        }

        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: capa.color, side: THREE.DoubleSide }));
        scene.add(mesh); meshes.push(mesh);
    });

    perfilesCargados[nombreArchivo] = meshes;
    actualizarUILista(nombreArchivo, 'perfil', data);
    
    if (!terrenoMesh && Object.keys(perfilesCargados).length === 1 && !bboxGlobal.isEmpty()) {
        const center = bboxGlobal.getCenter(new THREE.Vector3());
        if (!isNaN(center.x)) {
            controls.target.copy(center);
            camera.position.set(center.x + 150, center.y - 200, center.z + 150);
        }
    }
    
    renderListaProgresivas();
    actualizarEstadoVinculoTXT(); 
}

async function activarPerfil2D(nombre, data) {
    if (isProcessing2D) return; 
    
    document.getElementById('main-wrapper').classList.remove('is-2d-collapsed');
    setTimeout(onWindowResize, 310);

    isProcessing2D = true;
    currentRenderId++;
    const myRenderId = currentRenderId;

    activeProfileName = nombre;
    
    snapS = null;
    const searchInput = document.getElementById('search-progressive');
    if (searchInput) {
        searchInput.value = '';
        searchInput.style.color = "var(--accent-color)";
    }
    
    zoom2D = 1.0; panX = 0; panY = 0;

    const titleEl = document.getElementById('active-profile-title');
    titleEl.innerText = `[ Calculando... ]`;
    titleEl.style.color = "#ffb74d"; 

    const safeId = nombre.replace(/[^a-zA-Z0-9]/g, '_');
    document.querySelectorAll('.layer-item').forEach(el => el.classList.remove('active-2d'));
    const capDiv = document.getElementById(`capa-${safeId}`);
    if(capDiv) capDiv.classList.add('active-2d');

    laserMesh.visible = false;
    document.getElementById('laser-info').style.display = 'none';

    await new Promise(r => setTimeout(r, 20)); 

    let minZ = Infinity, maxZ = -Infinity;
    let countVertices = 0;

    data.forEach(capa => {
        for (let i = 0; i < capa.vertices.length; i += 3) {
            let vz = capa.vertices[i+2];
            if (Number.isFinite(vz)) {
                if (vz < minZ) minZ = vz;
                if (vz > maxZ) maxZ = vz;
                countVertices++;
            }
        }
    });

    if (countVertices === 0) { isProcessing2D = false; return; }

    let txtName = profileToTxtMap[nombre];
    let txtData = txtName ? progresivasCargadas[txtName] : null;
    
    let poliLineaActiva = txtData || crearSpineFallback(data);
    
    const optSegments = [];
    if (poliLineaActiva && poliLineaActiva.length > 1) {
        for (let i = 0; i < poliLineaActiva.length - 1; i++) {
            let p1 = poliLineaActiva[i];
            let p2 = poliLineaActiva[i+1];
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let l2 = dx*dx + dy*dy;
            optSegments.push({ p1, p2, dx, dy, l2 });
        }
    }

    const segCount = optSegments.length;
    const s_p1x = new Float32Array(segCount);
    const s_p1y = new Float32Array(segCount);
    const s_dx  = new Float32Array(segCount);
    const s_dy  = new Float32Array(segCount);
    const s_l2  = new Float32Array(segCount);
    const s_s1  = new Float32Array(segCount);
    const s_s2  = new Float32Array(segCount);

    for (let i = 0; i < segCount; i++) {
        s_p1x[i] = optSegments[i].p1.x;
        s_p1y[i] = optSegments[i].p1.y;
        s_dx[i]  = optSegments[i].dx;
        s_dy[i]  = optSegments[i].dy;
        s_l2[i]  = optSegments[i].l2;
        s_s1[i]  = optSegments[i].p1.s;
        s_s2[i]  = optSegments[i].p2.s;
    }

    let globalMinS = Infinity, globalMaxS = -Infinity;
    const estratosProyectados = [];

    for (let c = 0; c < data.length; c++) {
        let capa = data[c];
        const vLen = capa.vertices.length;
        
        const sCoords = new Float32Array(vLen / 3);
        const zCoords = new Float32Array(vLen / 3);
        let pIdx = 0;
        
        for (let i = 0; i < vLen; i += 3) {
            let vx = capa.vertices[i], vy = capa.vertices[i+1], vz = capa.vertices[i+2];
            if (Number.isFinite(vx)) {
                let minDistSq = Infinity;
                let bestS = 0;
                
                for (let j = 0; j < segCount; j++) {
                    let l2 = s_l2[j];
                    let t = 0;
                    if (l2 > 0) t = ((vx - s_p1x[j]) * s_dx[j] + (vy - s_p1y[j]) * s_dy[j]) / l2;
                    
                    let tc = t < 0 ? 0 : (t > 1 ? 1 : t);
                    let px = s_p1x[j] + tc * s_dx[j];
                    let py = s_p1y[j] + tc * s_dy[j];
                    let dx2 = vx - px;
                    let dy2 = vy - py;
                    let distSq = dx2*dx2 + dy2*dy2;
                    
                    if (distSq < minDistSq) {
                        minDistSq = distSq;
                        let trueT = tc;
                        if (j === 0 && t < 0) trueT = t;
                        if (j === segCount - 1 && t > 1) trueT = t;
                        bestS = s_s1[j] + trueT * (s_s2[j] - s_s1[j]);
                    }
                }

                if (bestS < globalMinS) globalMinS = bestS;
                if (bestS > globalMaxS) globalMaxS = bestS;
                
                sCoords[pIdx] = bestS;
                zCoords[pIdx] = vz;
            } else {
                sCoords[pIdx] = 0;
                zCoords[pIdx] = 0;
            }
            pIdx++;
        }

        await new Promise(r => setTimeout(r, 0));
        if (myRenderId !== currentRenderId) return; 

        estratosProyectados.push({ color: capa.color, caras: capa.caras, sCoords: sCoords, zCoords: zCoords });
    }

    if (txtData && txtData.length > 0) {
        globalMinS = txtData[0].s;
        globalMaxS = txtData[txtData.length - 1].s;
    }

    const rangeS = globalMaxS - globalMinS || 1;
    laserMesh.scale.setScalar(Math.max(rangeS * 0.015, 14)); 

    minZ_grid = Math.floor(minZ / 50) * 50;
    const maxZ_grid = Math.ceil(maxZ / 50) * 50;

    dataProyeccion2D = { 
        estratos: estratosProyectados, 
        longitud: rangeS, 
        minS: globalMinS, 
        maxS: globalMaxS, 
        minZ: minZ, 
        maxZ: maxZ, 
        minZ_grid: minZ_grid, 
        maxZ_grid: maxZ_grid,
        spineFallback: !txtData ? poliLineaActiva : null 
    };
    
    await generarRawMeshAsync(myRenderId);

    if (myRenderId === currentRenderId) {
        titleEl.innerText = nombre.replace(".json", "");
        titleEl.style.color = "var(--accent-color)";
        isProcessing2D = false;
        
        centrarVistaEnProgresiva(globalMinS + (globalMaxS - globalMinS)/2);
    }
}

async function generarRawMeshAsync(renderId) {
    const rngS = Math.max(dataProyeccion2D.maxS - dataProyeccion2D.minS, 1);
    const rngZ = Math.max(dataProyeccion2D.maxZ_grid - dataProyeccion2D.minZ_grid, 1);

    rawMeshCanvas.width = 8192; 
    escalaRaw = rawMeshCanvas.width / rngS;
    rawMeshCanvas.height = Math.max(1, rngZ * escalaRaw);
    
    ctxRaw.clearRect(0, 0, rawMeshCanvas.width, rawMeshCanvas.height);
    
    let totalCaras = 0, carasProcesadas = 0;
    dataProyeccion2D.estratos.forEach(c => totalCaras += c.caras.length / 3);
    const titleEl = document.getElementById('active-profile-title');

    const CHUNK_FACES = 10000; 

    for (let capa of dataProyeccion2D.estratos) {
        if (renderId !== currentRenderId) return; 

        ctxRaw.fillStyle = capa.color;
        ctxRaw.strokeStyle = capa.color; 
        ctxRaw.lineWidth = 0.5;

        for (let i = 0; i < capa.caras.length; i += CHUNK_FACES * 3) {
            ctxRaw.beginPath(); 
            
            let limit = Math.min(i + CHUNK_FACES * 3, capa.caras.length);
            for (let j = i; j < limit; j += 3) {
                const idx0 = capa.caras[j];
                const idx1 = capa.caras[j+1];
                const idx2 = capa.caras[j+2];

                let x0 = (capa.sCoords[idx0] - dataProyeccion2D.minS) * escalaRaw;
                let y0 = rawMeshCanvas.height - (capa.zCoords[idx0] - dataProyeccion2D.minZ_grid) * escalaRaw;
                let x1 = (capa.sCoords[idx1] - dataProyeccion2D.minS) * escalaRaw;
                let y1 = rawMeshCanvas.height - (capa.zCoords[idx1] - dataProyeccion2D.minZ_grid) * escalaRaw;
                let x2 = (capa.sCoords[idx2] - dataProyeccion2D.minS) * escalaRaw;
                let y2 = rawMeshCanvas.height - (capa.zCoords[idx2] - dataProyeccion2D.minZ_grid) * escalaRaw;

                ctxRaw.moveTo(x0, y0); ctxRaw.lineTo(x1, y1); ctxRaw.lineTo(x2, y2); ctxRaw.lineTo(x0, y0); 
            }
            ctxRaw.fill(); ctxRaw.stroke();

            carasProcesadas += (limit - i) / 3;
            reconstruirCacheScreen(); 
            titleEl.innerText = `Renderizando [ ${Math.round((carasProcesadas / totalCaras) * 100)}% ]...`;
            
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (renderId !== currentRenderId) return;
        }
    }
    reconstruirCacheScreen(); 
}

function reconstruirCacheScreen() {
    if (!dataProyeccion2D || !canvas2D) return;
    
    canvas2DCache.width = canvas2D.width;
    canvas2DCache.height = canvas2D.height;
    
    ctxCache.fillStyle = "#0a0a0a";
    ctxCache.fillRect(0, 0, canvas2DCache.width, canvas2DCache.height);
    
    ctxCache.save();
    ctxCache.scale(dpr, dpr); 

    const logicalW = canvas2D.width / dpr;
    const logicalH = canvas2D.height / dpr;
    
    const isMobile = window.innerWidth <= 768;
    const paddingLeft = 60;
    const paddingRight = 60;
    const paddingTop = 40;
    const paddingBottom = isMobile ? 120 : 60;

    const w_canvas = logicalW - (paddingLeft + paddingRight);
    const h_canvas = logicalH - (paddingTop + paddingBottom);

    if (w_canvas <= 0 || h_canvas <= 0) { ctxCache.restore(); return; }

    const rngS = Math.max(dataProyeccion2D.maxS - dataProyeccion2D.minS, 1);
    const rngZ = Math.max(dataProyeccion2D.maxZ_grid - dataProyeccion2D.minZ_grid, 1);

    const baseEscala = Math.min(w_canvas / rngS, h_canvas / rngZ);
    escalaGlobal = baseEscala * zoom2D;
    
    transX = paddingLeft + (w_canvas - rngS * escalaGlobal) / 2 + panX;
    transY = paddingTop + (h_canvas + rngZ * escalaGlobal) / 2 + panY; 

    ctxCache.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctxCache.fillStyle = "#888888"; 
    ctxCache.font = "11px 'Segoe UI', Tahoma, sans-serif";
    
    let pasoS = rngS > 1000000 ? 100000 : rngS > 100000 ? 10000 : rngS > 20000 ? 2000 : rngS > 5000 ? 500 : rngS > 1000 ? 100 : 50;
    let pasoZ = rngZ > 1000000 ? 100000 : rngZ > 100000 ? 10000 : rngZ > 20000 ? 2000 : rngZ > 5000 ? 500 : rngZ > 1000 ? 100 : 50;

    for (let z = dataProyeccion2D.minZ_grid; z <= dataProyeccion2D.maxZ_grid; z += pasoZ) {
        let y = transY - (z - dataProyeccion2D.minZ_grid) * escalaGlobal;
        ctxCache.beginPath(); ctxCache.moveTo(transX, y); ctxCache.lineTo(transX + rngS * escalaGlobal, y); ctxCache.stroke();
        ctxCache.fillText(`${z}m`, transX - 50, y + 4);
    }
    
    let startS = Math.floor(dataProyeccion2D.minS / pasoS) * pasoS;
    for (let s = startS; s <= dataProyeccion2D.maxS; s += pasoS) {
        let x = transX + (s - dataProyeccion2D.minS) * escalaGlobal;
        ctxCache.beginPath(); ctxCache.moveTo(x, transY - rngZ * escalaGlobal); ctxCache.lineTo(x, transY + 10); ctxCache.stroke();
        
        ctxCache.save();
        ctxCache.translate(x, transY + 18);
        ctxCache.rotate(-Math.PI / 4); 
        ctxCache.textAlign = "right";
        ctxCache.textBaseline = "middle";
        ctxCache.fillText(`S:${Math.round(s)}m`, 0, 0);
        ctxCache.restore();
    }

    const screenWidth = rngS * escalaGlobal;
    const screenHeight = rngZ * escalaGlobal;
    ctxCache.drawImage(rawMeshCanvas, transX, transY - screenHeight, screenWidth, screenHeight);
    ctxCache.restore();
    
    dibu2D();
}

function dibu2D() {
    if (!canvas2D) return;
    ctx2D.fillStyle = '#0a0a0a';
    ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

    if (dataProyeccion2D) {
        ctx2D.drawImage(canvas2DCache, 0, 0);

        ctx2D.save();
        ctx2D.scale(dpr, dpr);
        const logicalW = canvas2D.width / dpr;
        const logicalH = canvas2D.height / dpr;
        const cx = logicalW / 2;
        const cy = logicalH / 2;

        if (snapS !== null) {
            ctx2D.strokeStyle = "rgba(255, 235, 59, 0.4)"; 
            ctx2D.lineWidth = 2;
            ctx2D.setLineDash([6, 6]);
            ctx2D.beginPath();
            ctx2D.moveTo(cx, 0); ctx2D.lineTo(cx, logicalH);
            ctx2D.stroke();
            ctx2D.setLineDash([]);
        }

        ctx2D.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx2D.lineWidth = 1.5;
        ctx2D.shadowColor = "rgba(0,0,0,0.8)";
        ctx2D.shadowBlur = 4;
        ctx2D.beginPath();
        ctx2D.moveTo(cx - 16, cy); ctx2D.lineTo(cx + 16, cy);
        ctx2D.moveTo(cx, cy - 16); ctx2D.lineTo(cx, cy + 16);
        ctx2D.stroke();

        ctx2D.fillStyle = "var(--accent-color)";
        ctx2D.shadowBlur = 0;
        ctx2D.beginPath(); ctx2D.arc(cx, cy, 2.5, 0, Math.PI*2); ctx2D.fill();

        ctx2D.restore();
    }
}

function actualizarHUDCentral() {
    if (!dataProyeccion2D || isProcessing2D) return;

    const cx = (canvas2D.width / dpr) / 2;
    const cy = (canvas2D.height / dpr) / 2;

    let cursorMundoS = dataProyeccion2D.minS + (cx - transX) / escalaGlobal;
    let cursorMundoZ = dataProyeccion2D.minZ_grid + (transY - cy) / escalaGlobal;

    if (snapS !== null) cursorMundoS = snapS; 

    dibu2D(); 

    const laserInfo = document.getElementById('laser-info');

    if (cursorMundoS < dataProyeccion2D.minS || cursorMundoS > dataProyeccion2D.maxS) {
        laserInfo.style.display = 'none';
        laserMesh.visible = false;
        return;
    }

    let coordsReales = obtenerCoordenadasReales(cursorMundoS);
    let xScene = 0, yScene = 0, zScene = 0;

    if (coordsReales) {
        xScene = coordsReales.x - centerOffset.x;
        yScene = coordsReales.y - centerOffset.y;
        zScene = cursorMundoZ - centerOffset.z;
    }

    if (Number.isFinite(xScene) && Number.isFinite(yScene) && Number.isFinite(zScene)) {
        laserMesh.position.set(xScene, yScene, zScene);
        laserMesh.visible = true;
    }

    document.getElementById('hud-s').innerText = cursorMundoS.toFixed(1) + " m";
    document.getElementById('hud-z').innerText = cursorMundoZ.toFixed(1) + " m";
    
    laserInfo.style.display = 'flex';

    const elProf = document.getElementById('hud-prof');
    elProf.innerText = "---";
    elProf.style.color = "#888";

    if (raycastTimeout) clearTimeout(raycastTimeout);

    raycastTimeout = setTimeout(() => {
        let profTerreno = "N/A";
        let colorProf = "#fff";
        
        if (terrenoMesh && Number.isFinite(xScene)) {
            const raycaster = new THREE.Raycaster(new THREE.Vector3(xScene, yScene, 999999), new THREE.Vector3(0, 0, -1));
            const intersects = raycaster.intersectObject(terrenoMesh, false);
            if (intersects.length > 0) {
                const diff = intersects[0].point.z - zScene;
                if (diff >= 0) {
                    profTerreno = diff.toFixed(1) + " m";
                    colorProf = "#81c784";
                } else {
                    profTerreno = "Aire";
                    colorProf = "#ffb74d";
                }
            } else {
                profTerreno = "Lejos";
                colorProf = "#aaa";
            }
        } else {
            profTerreno = "Sin Terreno";
            colorProf = "#aaa";
        }
        
        elProf.innerText = profTerreno;
        elProf.style.color = colorProf;
    }, 100); 
}

function actualizarUILista(nombre, tipo, rawData = null) {
    if (tipo === 'progresiva') return;

    const container = document.getElementById('lista-capas');
    const emptyMsg = document.getElementById('empty-list-msg');
    if (emptyMsg) emptyMsg.remove();
    
    const safeId = nombre.replace(/[^a-zA-Z0-9]/g, '_');
    if (document.getElementById(`capa-${safeId}`)) return;

    const div = document.createElement('div');
    div.id = `capa-${safeId}`; 
    div.className = 'layer-item';

    div.innerHTML = `
        <div style="display:flex; align-items:center; width:100%; gap:8px;">
            <label class="switch" style="transform: scale(0.8); transform-origin: left center; margin:0; flex-shrink:0;">
                <input type="checkbox" checked id="chk-vis-${safeId}">
                <span class="slider"></span>
            </label>
            
            <div id="btn-select-${safeId}" style="flex-grow:1; overflow:hidden; cursor:pointer; display:flex; align-items:center; padding: 4px 0;" title="Click para proyectar en vista 2D">
                <span id="name-${safeId}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight:500; color:#ddd; font-size: 13px; transition: color 0.2s;">
                    ${nombre.replace(".json", "")}
                </span>
            </div>

            <div class="layer-actions" style="flex-shrink:0;">
                <button class="btn-action btn-del" style="color:var(--danger-color); padding: 0 4px; font-size:14px; font-weight:bold;" title="Eliminar archivo">&times;</button>
            </div>
        </div>`;

    div.querySelector(`#chk-vis-${safeId}`).addEventListener('change', (e) => {
        if (tipo === 'terreno' && terrenoMesh) { terrenoMesh.visible = e.target.checked; document.getElementById('chk-terreno').checked = e.target.checked; } 
        else if (tipo === 'perfil' && perfilesCargados[nombre]) { perfilesCargados[nombre].forEach(mesh => mesh.visible = e.target.checked); }
    });

    if (tipo === 'perfil') {
        div.querySelector(`#btn-select-${safeId}`).addEventListener('click', () => activarPerfil2D(nombre, rawData));
    }
    
    div.querySelector('.btn-del').addEventListener('click', () => {
        if (tipo === 'terreno' && terrenoMesh) { 
            scene.remove(terrenoMesh); liberarMemoriaMesh(terrenoMesh); terrenoMesh = null; terrenoCrudoData = null; nombreArchivoTerreno = null; 
        } else if (tipo === 'perfil' && perfilesCargados[nombre]) {
            perfilesCargados[nombre].forEach(mesh => { scene.remove(mesh); liberarMemoriaMesh(mesh); }); 
            delete perfilesCargados[nombre]; delete perfilesRawData[nombre];
            delete profileToTxtMap[nombre];
            
            if (activeProfileName === nombre) {
                activeProfileName = null; dataProyeccion2D = null; currentRenderId++; isProcessing2D = false;
                laserMesh.visible = false; document.getElementById('laser-info').style.display = 'none';
                document.getElementById('active-profile-title').innerText = "[Ninguno]";
                ctx2D.fillStyle = '#0a0a0a'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);
            }
        }
        
        div.remove();
        if (container.children.length === 0) container.innerHTML = `<div id="empty-list-msg" style="font-size: 12px; color: #555; text-align: center; padding: 15px; border: 1px dashed #333; border-radius: 6px;">Ningún archivo cargado</div>`;
        
        if (tipo === 'perfil') {
            renderListaProgresivas();
            actualizarEstadoVinculoTXT(); 
        }
    });
    
    container.appendChild(div);
}

init();