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
        this.faceColors = {};   // { cubeId: { top, right, bottom, left } } – user picks
        this.currentFilter = 'all';
        this.currentView = 'grid';
        this.searchTerm = '';

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
            faceColors: this.faceColors
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

        document.getElementById('gridView').style.display = this.currentView === 'grid' ? 'flex' : 'none';
        document.getElementById('listView').style.display = this.currentView === 'list' ? 'flex' : 'none';

        this.render();
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
        this.currentView === 'grid' ? this.renderGrid() : this.renderList();
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
        const zoom = Math.min(availW / naturalW, availH / naturalH, 1);
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

        const frontPalette = COLOR_PALETTE[cube.front] || COLOR_PALETTE[0];
        const lightColors = new Set([0, 1, 8, 10, 11]);
        const textColor = lightColors.has(cube.front) ? 'rgba(0,0,0,0.75)' : 'white';
        const facets = this.faceColors[id] || {};

        const facetHtml = ['top', 'right', 'bottom', 'left'].map(side => {
            const cid = facets[side];
            const bg = cid != null ? `style="background:${COLOR_PALETTE[cid]?.hex}"` : '';
            return `<div class="cube-facet-${side}" ${bg}></div>`;
        }).join('');

        card.innerHTML = `
            ${facetHtml}
            <div class="cube-face-inner" style="background:${frontPalette.hex}">
                ${isCompleted ? '<span class="cube-check">✓</span>' : ''}
                <span class="cube-number" style="color:${textColor}">${id}</span>
            </div>
        `;

        card.addEventListener('click', () => this.openCubeModal(id, cube));
        return card;
    }

    // ── Build the large cube diagram (center face + 4 colored facets) ──
    buildCubeVisual(id, cube, facets) {
        const visual = document.createElement('div');
        visual.className = 'cube-visual';

        const frontPalette = COLOR_PALETTE[cube.front] || COLOR_PALETTE[0];
        const lightColors = new Set([0, 1, 8, 10, 11]);
        const faceTextColor = lightColors.has(cube.front) ? 'rgba(0,0,0,0.75)' : 'white';

        ['top', 'right', 'bottom', 'left'].forEach(side => {
            const facet = document.createElement('div');
            facet.className = `modal-facet modal-facet-${side}`;
            const cid = facets[side];
            if (cid != null && COLOR_PALETTE[cid]) {
                const pal = COLOR_PALETTE[cid];
                facet.style.background = pal.hex;
                const nc = lightColors.has(cid) ? 'rgba(0,0,0,0.72)' : 'white';
                facet.innerHTML = `<span class="facet-code" style="color:${nc}">${cid}</span>`;
            }
            visual.appendChild(facet);
        });

        const face = document.createElement('div');
        face.className = 'modal-face';
        face.style.background = frontPalette.hex;
        face.innerHTML = `<span class="modal-cube-number" style="color:${faceTextColor}">${id}</span>`;
        visual.appendChild(face);

        return visual;
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
        const facesContainer = document.querySelector('#cubeModal .cube-faces');
        if (facesContainer) {
            facesContainer.innerHTML = '';
            const facets = this.faceColors[id] || {};
            facesContainer.appendChild(this.buildCubeVisual(id, this.cubes[id], facets));
            facesContainer.appendChild(this.buildFaceSelectors(id, facets));
        }
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
        facesContainer.appendChild(this.buildCubeVisual(id, cube, facets));
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
