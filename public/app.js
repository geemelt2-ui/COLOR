// Grid layout constants (based on PDF's 25.5-unit grid)
const GRID_MIN_COL = 8;
const GRID_MIN_ROW = 2;
const GRID_MAX_COL = 43;
const GRID_MAX_ROW = 26;
const CELL_SIZE = 40; // px per grid cell

class CubeTracker {
    constructor() {
        this.cubes = CUBE_GRID;
        this.completedCubes = new Set();
        this.cubNotes = {};
        this.faceColors = {};    // { cubeId: { top, right, bottom, left } } – user picks
        this.paintedFaces = {}; // { cubeId: { front, back, top, right, bottom, left } } – painted tracking
        this.currentFilter = 'all';
        this.currentView = 'grid';
        this.currentDirection = 'front';
        this.searchTerm = '';
        this.rot3X = -20;
        this.rot3Y = 15;
        this._drag3d = null;

        this.init();
    }

    // Storage Management
    async loadFromStorage() {
        // Load localStorage for instant display
        const cached = localStorage.getItem('cubeTrackerData');
        if (cached) {
            const data = JSON.parse(cached);
            this.completedCubes = new Set(data.completedCubes || []);
            this.cubNotes = data.cubNotes || {};
            this.faceColors = data.faceColors || {};
            this.paintedFaces = data.paintedFaces || {};
        }

        // Load from Firestore (authoritative source for cross-device sync)
        const fs = window.__firestore;
        if (!fs) return;
        try {
            const snap = await fs.getDoc(fs.doc(fs.db, 'cubeTracker', 'data'));
            if (snap.exists()) {
                const data = snap.data();
                this.completedCubes = new Set(data.completedCubes || []);
                this.cubNotes = data.cubNotes || {};
                this.faceColors = data.faceColors || {};
                this.paintedFaces = data.paintedFaces || {};
            }
        } catch (e) {
            console.warn('Firestore load failed, using localStorage:', e);
        }
    }

    saveToStorage() {
        if (this._loading) return;
        const data = {
            completedCubes: Array.from(this.completedCubes),
            cubNotes: this.cubNotes,
            faceColors: this.faceColors,
            paintedFaces: this.paintedFaces
        };
        localStorage.setItem('cubeTrackerData', JSON.stringify(data));

        const fs = window.__firestore;
        if (fs) {
            fs.setDoc(fs.doc(fs.db, 'cubeTracker', 'data'), data)
              .catch(e => console.error('Firestore save failed:', e));
        }
    }

    // Initialize
    async init() {
        this._loading = true;
        this.setupEventListeners();
        await this.loadFromStorage();
        this._loading = false;
        this.render();
        this.updateStats();
    }

    setupEventListeners() {
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleFilter(e));
        });

        // View toggle buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleViewChange(e));
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchTerm = e.target.value;
            this.render();
        });

        // Modal close
        document.querySelector('.close-btn').addEventListener('click', () => {
            this.closeModal();
        });

        // Modal buttons
        document.getElementById('markCompleteBtn').addEventListener('click', () => {
            this.toggleComplete();
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            document.getElementById('cubeNotes').value = '';
        });

        // Modal click outside
        document.getElementById('cubeModal').addEventListener('click', (e) => {
            if (e.target.id === 'cubeModal') {
                this.closeModal();
            }
        });

        // Direction toggle buttons
        document.querySelectorAll('.direction-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleDirectionChange(e));
        });

        // Re-fit grid on window resize
        window.addEventListener('resize', () => {
            if (this.currentView === 'grid') this.fitGrid();
        });
    }

    handleFilter(e) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        this.currentFilter = e.target.dataset.filter;
        this.render();
    }

    handleViewChange(e) {
        document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        this.currentView = e.target.dataset.view;

        document.getElementById('gridView').style.display        = this.currentView === 'grid' ? 'flex'  : 'none';
        document.getElementById('view3D').style.display          = this.currentView === '3d'   ? 'flex'  : 'none';
        document.getElementById('listView').style.display        = this.currentView === 'list' ? 'flex'  : 'none';
        document.getElementById('directionToggle').style.display = this.currentView === 'grid' ? 'flex'  : 'none';

        this.render();
    }

    handleDirectionChange(e) {
        document.querySelectorAll('.direction-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentDirection = e.target.dataset.dir;
        this.renderGrid();
    }

    // Filtering logic
    getFilteredCubes() {
        return Object.entries(this.cubes)
            .filter(([id, _cube]) => {
                if (this.currentFilter === 'completed' && !this.completedCubes.has(parseInt(id))) {
                    return false;
                }
                if (this.currentFilter === 'pending' && this.completedCubes.has(parseInt(id))) {
                    return false;
                }
                if (this.searchTerm && !id.includes(this.searchTerm)) {
                    return false;
                }
                return true;
            });
    }

    // Rendering
    render() {
        if (this.currentView === 'grid')     this.renderGrid();
        else if (this.currentView === '3d')  this.render3D();
        else                                 this.renderList();
        this.updateStats();
    }

    renderGrid() {
        const gridView = document.getElementById('gridView');
        gridView.innerHTML = '';

        const cols = GRID_MAX_COL - GRID_MIN_COL + 1;
        const rows = GRID_MAX_ROW - GRID_MIN_ROW + 1;

        const mapContainer = document.createElement('div');
        mapContainer.className = 'cube-map';
        mapContainer.style.width = (cols * CELL_SIZE) + 'px';
        mapContainer.style.height = (rows * CELL_SIZE) + 'px';

        this.getFilteredCubes().forEach(([id, cube]) => {
            const card = this.createCubeCard(id, cube);
            card.style.left = ((cube.col - GRID_MIN_COL) * CELL_SIZE) + 'px';
            card.style.top  = ((cube.row - GRID_MIN_ROW) * CELL_SIZE) + 'px';
            mapContainer.appendChild(card);
        });

        gridView.appendChild(mapContainer);
        requestAnimationFrame(() => this.fitGrid());
    }

    fitGrid() {
        const gridView = document.getElementById('gridView');
        const map = gridView.querySelector('.cube-map');
        if (!map) return;

        map.style.zoom = '';
        const naturalW = map.offsetWidth;
        const naturalH = map.offsetHeight;
        if (!naturalW || !naturalH) return;

        const availW = gridView.clientWidth - 8;
        const availH = gridView.clientHeight - 8;
        const zoom = Math.min(availW / naturalW, availH / naturalH);
        map.style.zoom = zoom;
    }

    renderList() {
        const listView = document.getElementById('listView');
        listView.innerHTML = '';

        this.getFilteredCubes().forEach(([id, cube]) => {
            const listItem = this.createListItem(id, cube);
            listView.appendChild(listItem);
        });
    }

    // ── 3D View ──────────────────────────────────────────────────────────────

    render3D() {
        const container = document.getElementById('view3D');
        container.innerHTML = '';

        const cols = GRID_MAX_COL - GRID_MIN_COL + 1;
        const rows = GRID_MAX_ROW - GRID_MIN_ROW + 1;

        const world = document.createElement('div');
        world.className = 'world3d';
        world.style.width  = (cols * CELL_SIZE) + 'px';
        world.style.height = (rows * CELL_SIZE) + 'px';

        Object.entries(this.cubes).forEach(([id, cube]) => {
            const el = this.createCube3D(id, cube);
            el.style.left = ((cube.col - GRID_MIN_COL) * CELL_SIZE) + 'px';
            el.style.top  = ((cube.row - GRID_MIN_ROW) * CELL_SIZE) + 'px';
            world.appendChild(el);
        });

        container.appendChild(world);
        this.setup3DDrag(container, world);
        requestAnimationFrame(() => this.apply3DTransform(world));
    }

    createCube3D(id, cube) {
        const el = document.createElement('div');
        el.className = 'cube3d';

        const facets = this.faceColors[id] || {};
        const frontColor = COLOR_PALETTE[cube.front]?.hex || '#909090';

        const faces = {
            front:  frontColor,
            back:   '#444444',
            top:    facets.top    != null ? COLOR_PALETTE[facets.top].hex    : frontColor,
            bottom: facets.bottom != null ? COLOR_PALETTE[facets.bottom].hex : frontColor,
            right:  facets.right  != null ? COLOR_PALETTE[facets.right].hex  : frontColor,
            left:   facets.left   != null ? COLOR_PALETTE[facets.left].hex   : frontColor,
        };

        const lightColors = new Set([0, 1, 8, 10, 11]);
        const textColor = lightColors.has(cube.front) ? 'rgba(0,0,0,0.75)' : 'white';

        for (const [side, color] of Object.entries(faces)) {
            const face = document.createElement('div');
            face.className = `face face-${side}`;
            face.style.background = color;
            if (side === 'front') {
                const label = document.createElement('span');
                label.className = 'cube3d-label';
                label.textContent = id;
                label.style.color = textColor;
                face.appendChild(label);
            }
            el.appendChild(face);
        }
        return el;
    }

    apply3DTransform(world) {
        const container = document.getElementById('view3D');
        if (!container || !world) return;
        const naturalW = world.offsetWidth  || (36 * CELL_SIZE);
        const naturalH = world.offsetHeight || (25 * CELL_SIZE);
        const availW = container.clientWidth  - 80;
        const availH = container.clientHeight - 80;
        const scale = Math.min(availW / naturalW, availH / naturalH, 0.9);
        world.style.transform =
            `rotateX(${this.rot3X}deg) rotateY(${this.rot3Y}deg) scale3d(${scale},${scale},${scale})`;
    }

    setup3DDrag(container, world) {
        // Remove old listeners by cloning
        const fresh = container.cloneNode(false);
        container.parentNode.replaceChild(fresh, container);
        // Re-append world
        fresh.appendChild(world);

        const SENS = 0.4;

        fresh.addEventListener('mousedown', e => {
            this._drag3d = {
                startX: e.clientX, startY: e.clientY,
                startRotX: this.rot3X, startRotY: this.rot3Y
            };
        });
        const onMove = e => {
            if (!this._drag3d) return;
            const dx = e.clientX - this._drag3d.startX;
            const dy = e.clientY - this._drag3d.startY;
            this.rot3X = Math.max(-85, Math.min(85, this._drag3d.startRotX - dy * SENS));
            this.rot3Y = this._drag3d.startRotY + dx * SENS;
            this.apply3DTransform(world);
        };
        const onUp = () => { this._drag3d = null; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
    }

    // ─────────────────────────────────────────────────────────────────────────

    // Build the background style for a cube tile
    buildBackground(colors) {
        if (!colors || colors.length === 0) return '#D0D0D0';
        if (colors.length === 1) return COLOR_PALETTE[colors[0]].hex;

        const pct = 100 / colors.length;
        const stops = colors.map((cid, i) => {
            const hex = COLOR_PALETTE[cid].hex;
            return `${hex} ${(i * pct).toFixed(1)}%, ${hex} ${((i + 1) * pct).toFixed(1)}%`;
        });
        return `linear-gradient(90deg, ${stops.join(', ')})`;
    }

    createCubeCard(id, cube) {
        const card = document.createElement('div');
        const isCompleted = this.completedCubes.has(parseInt(id));
        card.className = `cube-card ${isCompleted ? 'completed' : 'pending'}`;

        const lightColors = new Set([0, 1, 8, 10, 11]);
        const facets = this.faceColors[id] || {};
        const paintedData = this.paintedFaces[id] || {};

        if (this.currentDirection !== 'front') {
            // Direction view: fill entire tile with the face color
            const dir = this.currentDirection;
            const dirColorId = facets[dir];
            const bgColor = dirColorId != null ? COLOR_PALETTE[dirColorId].hex : '#d0d0d0';
            const textColor = dirColorId != null && !lightColors.has(dirColorId) ? 'white' : 'rgba(0,0,0,0.6)';
            card.style.background = bgColor;
            if (paintedData[dir]) card.style.filter = 'brightness(0.48)';
            card.innerHTML = `
                <div class="cube-face-inner" style="background:transparent">
                    ${isCompleted ? '<span class="cube-check">✓</span>' : ''}
                    <span class="cube-number" style="color:${textColor}">${id}</span>
                </div>
            `;
        } else {
            // Front view: normal display with facet strips
            const frontPalette = COLOR_PALETTE[cube.front] || COLOR_PALETTE[0];
            const textColor = lightColors.has(cube.front) ? 'rgba(0,0,0,0.75)' : 'white';

            const facetHtml = ['top', 'right', 'bottom', 'left'].map(side => {
                const cid = facets[side];
                let styleStr = cid != null ? `background:${COLOR_PALETTE[cid]?.hex};` : '';
                if (paintedData[side]) styleStr += 'opacity:0.35;';
                return `<div class="cube-facet-${side}"${styleStr ? ` style="${styleStr}"` : ''}></div>`;
            }).join('');

            const frontStyle = `background:${frontPalette.hex};${paintedData['front'] ? 'opacity:0.42;' : ''}`;
            card.innerHTML = `
                ${facetHtml}
                <div class="cube-face-inner" style="${frontStyle}">
                    ${isCompleted ? '<span class="cube-check">✓</span>' : ''}
                    <span class="cube-number" style="color:${textColor}">${id}</span>
                </div>
            `;
        }

        card.addEventListener('click', () => this.openCubeModal(id, cube));
        return card;
    }

    // ── Build the large cube diagram – all 6 faces, each clickable to mark as painted ──
    buildCubeVisual(id, cube, facets, painted) {
        painted = painted || {};
        const lightColors = new Set([0, 1, 8, 10, 11]);
        const frontPalette = COLOR_PALETTE[cube.front] || COLOR_PALETTE[0];
        const faceTextColor = lightColors.has(cube.front) ? 'rgba(0,0,0,0.75)' : 'white';

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;';

        const visual = document.createElement('div');
        visual.className = 'cube-visual';

        // Side facets: top, right, bottom, left, back
        const SIDE_FACETS = [
            { side: 'top',    bgDefault: null },
            { side: 'right',  bgDefault: null },
            { side: 'bottom', bgDefault: null },
            { side: 'left',   bgDefault: null },
            { side: 'back',   bgDefault: '#555555' },
        ];

        SIDE_FACETS.forEach(({ side, bgDefault }) => {
            const facet = document.createElement('div');
            facet.className = `modal-facet modal-facet-${side}`;
            facet.style.cursor = 'pointer';
            facet.title = painted[side] ? 'צבוע ✓ – לחץ לביטול' : 'לחץ לסמן כצבוע';

            const cid = side !== 'back' ? facets[side] : null;
            if (cid != null && COLOR_PALETTE[cid]) {
                const pal = COLOR_PALETTE[cid];
                facet.style.background = pal.hex;
                const nc = lightColors.has(cid) ? 'rgba(0,0,0,0.72)' : 'white';
                facet.innerHTML = `<span class="facet-code" style="color:${nc}">${cid}</span>`;
            } else if (bgDefault) {
                facet.style.background = bgDefault;
                facet.innerHTML = `<span class="facet-code" style="color:rgba(255,255,255,0.5);font-size:1.2em">↩</span>`;
            }

            if (painted[side]) {
                const overlay = document.createElement('div');
                overlay.className = 'face-painted-overlay';
                overlay.textContent = '✓';
                facet.appendChild(overlay);
            }

            facet.addEventListener('click', () => this.toggleFacePainted(id, side));
            visual.appendChild(facet);
        });

        // Front face
        const face = document.createElement('div');
        face.className = 'modal-face';
        face.style.background = frontPalette.hex;
        face.style.cursor = 'pointer';
        face.title = painted['front'] ? 'צבוע ✓ – לחץ לביטול' : 'לחץ לסמן כצבוע';
        face.innerHTML = `<span class="modal-cube-number" style="color:${faceTextColor}">${id}</span>`;

        if (painted['front']) {
            const overlay = document.createElement('div');
            overlay.className = 'face-painted-overlay';
            overlay.textContent = '✓';
            face.appendChild(overlay);
        }

        face.addEventListener('click', () => this.toggleFacePainted(id, 'front'));
        visual.appendChild(face);

        wrapper.appendChild(visual);

        const hint = document.createElement('p');
        hint.style.cssText = 'font-size:0.72em;color:#aaa;text-align:center;margin-top:5px;';
        hint.textContent = 'לחץ על פאה לסמן כצבועה';
        wrapper.appendChild(hint);

        return wrapper;
    }

    // ── Build 4 rows of color-swatch pickers, one per face ──
    buildFaceSelectors(id, facets) {
        const container = document.createElement('div');
        container.className = 'face-selectors';

        const SIDES = [
            { key: 'top',    label: '⬆ למעלה' },
            { key: 'right',  label: '← מימין'  },
            { key: 'bottom', label: '⬇ למטה'   },
            { key: 'left',   label: '→ משמאל'  },
        ];
        const lightSwatchColors = new Set([1, 8, 10, 11]);

        SIDES.forEach(({ key, label }) => {
            const row = document.createElement('div');
            row.className = 'face-selector-row';

            const lbl = document.createElement('span');
            lbl.className = 'face-label';
            lbl.textContent = label;
            row.appendChild(lbl);

            const swatches = document.createElement('div');
            swatches.className = 'face-swatches';

            // "No color" clear button
            const none = document.createElement('div');
            none.className = `color-swatch swatch-none${facets[key] == null ? ' swatch-active' : ''}`;
            none.title = 'ללא צבע';
            none.textContent = '✕';
            none.addEventListener('click', () => this.pickFaceColor(id, key, null));
            swatches.appendChild(none);

            for (let i = 1; i <= 12; i++) {
                const sw = document.createElement('div');
                sw.className = `color-swatch${facets[key] === i ? ' swatch-active' : ''}`;
                sw.style.background = COLOR_PALETTE[i].hex;
                sw.style.color = lightSwatchColors.has(i) ? 'rgba(0,0,0,0.75)' : 'white';
                sw.title = `צבע ${i}`;
                sw.textContent = i;
                sw.addEventListener('click', () => this.pickFaceColor(id, key, i));
                swatches.appendChild(sw);
            }

            row.appendChild(swatches);
            container.appendChild(row);
        });

        return container;
    }

    // ── Toggle painted state for a face and refresh ──
    toggleFacePainted(id, side) {
        if (!this.paintedFaces[id]) this.paintedFaces[id] = {};
        if (this.paintedFaces[id][side]) {
            delete this.paintedFaces[id][side];
        } else {
            this.paintedFaces[id][side] = true;
        }
        if (Object.keys(this.paintedFaces[id]).length === 0) delete this.paintedFaces[id];
        this.saveToStorage();
        this.renderGrid();
        this._refreshModalFaces(id);
    }

    _refreshModalFaces(id) {
        const facesContainer = document.querySelector('#cubeModal .cube-faces');
        if (!facesContainer) return;
        facesContainer.innerHTML = '';
        const facets = this.faceColors[id] || {};
        const painted = this.paintedFaces[id] || {};
        facesContainer.appendChild(this.buildCubeVisual(id, this.cubes[id], facets, painted));
        facesContainer.appendChild(this.buildFaceSelectors(id, facets));
    }

    // ── Save a face-color pick and refresh the modal + map ──
    pickFaceColor(id, side, colorId) {
        if (!this.faceColors[id]) this.faceColors[id] = {};
        if (colorId === null) {
            delete this.faceColors[id][side];
        } else {
            this.faceColors[id][side] = colorId;
        }
        if (Object.keys(this.faceColors[id]).length === 0) delete this.faceColors[id];

        this.saveToStorage();
        this.renderGrid();   // refresh map tiles

        // Refresh modal faces section in-place
        this._refreshModalFaces(id);
    }

    createListItem(id, cube) {
        const item = document.createElement('div');
        const isCompleted = this.completedCubes.has(parseInt(id)) || this.completedCubes.has(id);
        item.className = `list-item ${isCompleted ? 'completed' : ''}`;

        const colors = cube.colors || [];
        const colorNames = colors.map(cid => COLOR_PALETTE[cid].name).join(', ') || 'טבעי';

        // Face colors the user picked (top, right, bottom, left)
        const facets = this.faceColors[id] || {};
        const faceDotsHtml = ['top', 'right', 'bottom', 'left'].map(side => {
            const cid = facets[side];
            const bg = cid != null ? COLOR_PALETTE[cid].hex : '#e0e0e0';
            return `<div class="list-face-dot" title="${side}" style="background:${bg}"></div>`;
        }).join('');

        const status = isCompleted ? '✓ הושלם' : '⏳ בתהליך';
        const statusClass = isCompleted ? 'completed' : 'pending';

        item.innerHTML = `
            <div class="list-number">${id}</div>
            <div>${colorNames}</div>
            <div class="list-faces">${faceDotsHtml}</div>
            <div class="list-status ${statusClass}">${status}</div>
        `;

        item.addEventListener('click', () => this.openCubeModal(id, cube));
        return item;
    }

    // Modal Management
    openCubeModal(id, cube) {
        this.currentCubeId = id;

        const modal = document.getElementById('cubeModal');
        document.getElementById('cubeNumber').textContent = id;

        const facesContainer = modal.querySelector('.cube-faces');
        facesContainer.innerHTML = '';

        const facets = this.faceColors[id] || {};
        const painted = this.paintedFaces[id] || {};
        facesContainer.appendChild(this.buildCubeVisual(id, cube, facets, painted));
        facesContainer.appendChild(this.buildFaceSelectors(id, facets));

        document.getElementById('cubeNotes').value = this.cubNotes[id] || '';

        const btn = document.getElementById('markCompleteBtn');
        if (this.completedCubes.has(parseInt(id))) {
            btn.textContent = 'בטל סימון';
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        } else {
            btn.textContent = 'סימן כהושלם';
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-secondary');
        }

        modal.classList.add('show');

        // Replace any old listener by cloning the element
        const notes = document.getElementById('cubeNotes');
        const fresh = notes.cloneNode(true);
        notes.parentNode.replaceChild(fresh, notes);
        fresh.addEventListener('change', () => {
            this.cubNotes[this.currentCubeId] = fresh.value;
            this.saveToStorage();
        });
    }

    closeModal() {
        document.getElementById('cubeModal').classList.remove('show');
        this.saveToStorage();
    }

    toggleComplete() {
        const id = parseInt(this.currentCubeId);
        if (this.completedCubes.has(id)) {
            this.completedCubes.delete(id);
        } else {
            this.completedCubes.add(id);
        }
        this.saveToStorage();
        this.render();
        this.openCubeModal(this.currentCubeId, this.cubes[this.currentCubeId]);
    }

    // Stats
    updateStats() {
        const total = Object.keys(this.cubes).length;
        const completed = this.completedCubes.size;
        const remaining = total - completed;
        const percentage = total > 0 ? (completed / total * 100) : 0;

        document.getElementById('totalCount').textContent = total;
        document.getElementById('completedCount').textContent = completed;
        document.getElementById('remainCount').textContent = remaining;
        document.getElementById('progressFill').style.width = percentage + '%';
    }
}

// CubeTracker is initialized by the Firebase module script in index.html
