// -------------------- PARTE 1: Helpers, configuración y estado global --------------------

// Helpers cortos DOM
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

// ----------------------------------------------------------------
// CONFIGURACIÓN REQUERIDA
// Cambia esta URL para que apunte a tu backend (local o producción)
const API_BASE_URL = 'http://127.0.0.1:4000/api';
// ----------------------------------------------------------------

const KEY_SESSION = 'rutasmart_session_v1';
const KEY_ROUTE_ASSIGNMENTS = 'rutasmart_assignments_v1';
const KEY_ADMIN_ORIGIN = 'rutasmart_origin_admin_v1';
const KEY_DRIVER_BASE = 'rutasmart_driver_base_v1';
let VAN_CAPACITY = 10;

// -------------------- Storage helpers --------------------
function setItem(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function getItem(k){ try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function removeItem(k){ localStorage.removeItem(k); }
function saveAssignments(a){ setItem(KEY_ROUTE_ASSIGNMENTS, a); }
function loadAssignments(){ return getItem(KEY_ROUTE_ASSIGNMENTS) || []; }

// -------------------- estado global de mapas / servicios --------------------
const state = {
  // Orígenes
  origin: getItem(KEY_ADMIN_ORIGIN) || null,        // base del admin (state.origin)
  driverBaseLocation: getItem(KEY_DRIVER_BASE) || null, // base del chofer (driver only)

  // UI / rol
  currentRole: null,

  // Mapas y servicios
  mapAdmin: null,
  mapDriver: null,
  services: {
    geocoder: null,
    directionsService: null,
    distanceMatrix: null,
    directionsRenderers: [],    // renderers para admin (varias)
    driverRenderer: null,       // renderer exclusivo chofer
    driverMarkers: []           // marcadores en mapa chofer
  },

  // Marcadores y datos
  originMarker: null,          // marcador admin
  driverBaseMarker: null,      // marcador único de base del chofer
  workers: [],
  drivers: []
};

// -------------------- API WRAPPER --------------------
const api = {
  async request(method, path, body = null) {
    const url = `${API_BASE_URL}${path}`;
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    if (!res.ok) {
      let error;
      try { error = await res.json(); } catch { error = {}; }
      throw new Error(error.error || `Error ${res.status}`);
    }
    if (res.status === 204) return {};
    const type = res.headers.get('content-type') || '';
    return type.includes('application/json') ? res.json() : {};
  },

  // Auth
  loginAdmin: (identifier, password) => api.request('POST', '/auth/login', { identifier, password }),
  logoutAdmin: () => api.request('POST', '/auth/logout'),
  loginDriver: (username, password) => api.request('POST', '/auth/driver-login', { username, password }),

  // Drivers CRUD
  getDrivers: () => api.request('GET', '/drivers'),
  createDriver: (username, display_name, password) => api.request('POST', '/drivers', { username, display_name, password }),
  updateDriver: (id, display_name, password) => api.request('PUT', `/drivers/${id}`, { display_name, password }),
  deleteDriver: id => api.request('DELETE', `/drivers/${id}`),

  // Workers CRUD
  getWorkers: () => api.request('GET', '/workers'),
  createWorker: data => api.request('POST', '/workers', data),
  updateWorker: (id, data) => api.request('PATCH', `/workers/${id}`, data),
  deleteWorker: id => api.request('DELETE', `/workers/${id}`),

  // Driver specific
  getDriverWorkers: () => api.request('GET', '/driver/workers')
};

// -------------------- UI Refs --------------------
const homeScreen = qs('#homeScreen');
const adminLogin = qs('#adminLogin');
const driverLogin = qs('#driverLogin');
const adminArea  = qs('#adminArea');
const driverArea = qs('#driverArea');
const mapAdminEl = qs('#map');
const mapDriverEl = qs('#driverMap');
const roleButtons = qs('#roleButtons');
const btnHomeHeader = qs('#btnHome');
const btnLogoutHeader = qs('#btnLogout');
const btnToggleTheme = qs('#toggleTheme');
const goAdminBtn = qs('#goAdmin');
const goDriverBtn = qs('#goDriver');
const btnAdminView = qs('#btnAdminView');
const btnDriverView = qs('#btnDriverView');
const adminLoginForm = qs('#adminLoginForm');
const adminCancel = qs('#adminCancel');
const driverForm = qs('#driverForm');
const driversTableBody = qs('#driversTable tbody');
const workerForm = qs('#workerForm');
const workersTableBody = qs('#workersTable tbody');
const choferSelect = qs('#choferSelect');
const loginForm = qs('#loginForm');
const driverNameDisplay = qs('#driverNameDisplay');
const driverRoutesTableBody = qs('#driverRoutesTable tbody');
const logoutDriverBtn = qs('#logoutDriver');
const errorModal = qs('#errorModal');
const errorText = qs('#errorText');
const filterDayAdmin = qs('#filterDayAdmin');
const filterShiftAdmin = qs('#filterShiftAdmin');
const baseInput = qs("#base");         // admin base input
const addressInput = qs("#address");   // worker address input
const statsEl = qs('#stats');
const btnBuildRouteAdmin = qs("#buildRouteAdmin");

if (btnBuildRouteAdmin) {
    btnBuildRouteAdmin.onclick = () => buildRouteAdmin();
}

function showError(msg){ if(errorText) errorText.textContent = msg; try{ errorModal && errorModal.showModal && errorModal.showModal(); }catch(e){ alert(msg); } }

// -------------------- Tema persistente --------------------
(function initTheme(){
  const t = localStorage.getItem('theme') || 'light';
  if(t==='dark') document.body.classList.add('dark-theme');
  if(btnToggleTheme) btnToggleTheme.textContent = document.body.classList.contains('dark-theme')?'☀️':'🌙';
})();
if(btnToggleTheme) btnToggleTheme.onclick = ()=> {
  document.body.classList.toggle('dark-theme');
  const dark = document.body.classList.contains('dark-theme');
  localStorage.setItem('theme', dark?'dark':'light');
  btnToggleTheme.textContent = dark?'☀️':'🌙';
};

// -------------------- Días y turnos --------------------
const dias=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const turnos=["Mañana","Tarde","Noche"];

function fillDaySelects(){
  const daySelects = qsa('#day,#filterDayAdmin,#filterDayDriver');
  daySelects.forEach(sel=>{
    if(!sel) return;
    sel.innerHTML = '';
    if(sel.id === 'filterDayAdmin' || sel.id === 'filterDayDriver'){
      const optAll = document.createElement('option'); optAll.value=''; optAll.textContent='Todos'; sel.appendChild(optAll);
    }
    dias.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
  });
  if(filterDayAdmin) filterDayAdmin.onchange = () => renderWorkers();
}
fillDaySelects();

// -------------------- Sesión / Header --------------------
function setSession(o){ if(o) setItem(KEY_SESSION,o); else removeItem(KEY_SESSION); refreshHeaderForSession(); }
function getSession(){ return getItem(KEY_SESSION); }

function refreshHeaderForSession(){
  const s = getSession();
  if(!s){
    if(roleButtons) roleButtons.style.display='none';
    if(btnHomeHeader) btnHomeHeader.style.display='none';
    if(btnLogoutHeader) btnLogoutHeader.style.display='none';
    if(goAdminBtn) goAdminBtn.style.display='inline-block';
    if(goDriverBtn) goDriverBtn.style.display='inline-block';
  } else {
    if(roleButtons) roleButtons.style.display='flex';
    if(btnHomeHeader) btnHomeHeader.style.display='inline-block';
    if(btnLogoutHeader) btnLogoutHeader.style.display='inline-block';
    if(goAdminBtn) goAdminBtn.style.display='none';
    if(goDriverBtn) goDriverBtn.style.display='none';
  }
}

// -------------------- Inicialización Google Maps --------------------
window.initAppServices = async function(){
  // inicializar servicios Google
  state.services.geocoder = new google.maps.Geocoder();
  state.services.directionsService = new google.maps.DirectionsService();
  state.services.distanceMatrix = new google.maps.DistanceMatrixService();

  // mapas
  if(mapAdminEl) {
    state.mapAdmin = new google.maps.Map(mapAdminEl, { center:{lat:-33.4489,lng:-70.6693}, zoom:11, mapTypeControl:false });
    // renderer por defecto admin (podemos crear varios renderers cuando generemos rutas)
    state.services.directionsRenderers = state.services.directionsRenderers || [];
  }
  if(mapDriverEl) {
    state.mapDriver = new google.maps.Map(mapDriverEl, { center:{lat:-33.4489,lng:-70.6693}, zoom:11, mapTypeControl:false });
    state.services.driverRenderer = new google.maps.DirectionsRenderer({ map: state.mapDriver, suppressMarkers: false });
  }

  // Autocomplete (places)
  const opt = { componentRestrictions:{ country:'cl' }, fields:['geometry','name','formatted_address'] };
  if(baseInput) try { new google.maps.places.Autocomplete(baseInput, opt); } catch(e){ /* ignore if places not enabled */ }
  if(addressInput) try { new google.maps.places.Autocomplete(addressInput, opt); } catch(e){ /* ignore if places not enabled */ }

  // Si existe base admin guardada, poner marcador
  if(state.origin) placeOriginMarker();

  // Si existe base driver guardada, cargar marcador (si mapa driver ya inicializado)
  const savedDriverBase = getItem(KEY_DRIVER_BASE);
  if(savedDriverBase && savedDriverBase.lat && savedDriverBase.lng){
    state.driverBaseLocation = savedDriverBase;
    if(state.mapDriver){
      if(state.driverBaseMarker) state.driverBaseMarker.setMap(null);
      state.driverBaseMarker = new google.maps.Marker({
        position: { lat: savedDriverBase.lat, lng: savedDriverBase.lng },
        map: state.mapDriver,
        title: 'Base del Chofer',
        icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale:6, fillColor:'#007BFF', fillOpacity:1, strokeWeight:2, strokeColor:'#003E99' }
      });
    }
  }

  // Restaurar sesión si existe
  const s = getSession();
  if(s){
    try{
      if(s.role === 'admin'){ await api.getDrivers(); await showAdminArea(); }
      else if(s.role === 'driver'){ await api.getDriverWorkers(); await showDriverArea(s.name); }
    } catch (e) {
      console.warn('Sesión inválida, limpiando.', e);
      setSession(null);
      showHome();
    }
  } else {
    showHome();
  }

  initDriverAutocomplete();
};

// -------------------- placeOriginMarker (admin) --------------------
function placeOriginMarker(){
  if(!state.origin || !state.mapAdmin) return;
  if(state.originMarker) state.originMarker.setMap(null);
  state.originMarker = new google.maps.Marker({
    position: { lat: state.origin.lat, lng: state.origin.lng },
    map: state.mapAdmin,
    title: 'Base (Origen)',
    icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale:6, fillColor:'#33A0FF', fillOpacity:1, strokeWeight:2, strokeColor:'#0A5CB8' }
  });
  try { state.mapAdmin.panTo(new google.maps.LatLng(state.origin.lat, state.origin.lng)); state.mapAdmin.setZoom(13); } catch(e){}
}

// -------------------- Establecer Base (Administrador) --------------------
const establecerBaseBtn = qs('#establecerBase');
if (establecerBaseBtn) {
  establecerBaseBtn.onclick = async () => {
    const addr = baseInput ? baseInput.value.trim() : '';
    if (!addr) return showError('Ingresa una dirección base válida.');
    try {
      const g = await geocodeAddress(addr);
      state.origin = { lat: g.location.lat, lng: g.location.lng, address: g.address };
      setItem(KEY_ADMIN_ORIGIN, state.origin);
      placeOriginMarker();
      alert('✅ Base (admin) establecida correctamente.');
    } catch (err) {
      showError('No se pudo geocodificar la base: ' + err.message);
    }
  };
}

// -------------------- geocodeAddress & haversine --------------------
function geocodeAddress(addr){
  return new Promise((res, rej) => {
    if(!state.services.geocoder) return rej(new Error('Geocoder no disponible'));
    state.services.geocoder.geocode({ address: addr }, (r, s) => {
      if (s === 'OK' && r[0]) {
        res({ address: r[0].formatted_address, location: { lat: r[0].geometry.location.lat(), lng: r[0].geometry.location.lng() }, placeId: r[0].place_id });
      } else {
        rej(new Error('No se pudo geocodificar: ' + s));
      }
    });
  });
}
function haversine(a,b){
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// -------------------- UI actions (vistas) básico: showHome / showAdmin / showDriver --------------------
goAdminBtn && (goAdminBtn.onclick = () => showAdminLogin());
goDriverBtn && (goDriverBtn.onclick = () => showDriverLogin());
btnAdminView && (btnAdminView.onclick = async () => { const s = getSession(); if (s && s.role === 'admin') await showAdminArea(); else showAdminLogin(); });
btnDriverView && (btnDriverView.onclick = async () => { const s = getSession(); if (s && s.role === 'driver') await showDriverArea(s.name); else showDriverLogin(); });
btnHomeHeader && (btnHomeHeader.onclick = () => showHome());

function showHome(){
  homeScreen && (homeScreen.style.display = 'flex');
  adminLogin && (adminLogin.style.display = 'none');
  driverLogin && (driverLogin.style.display = 'none');
  adminArea && (adminArea.style.display = 'none');
  driverArea && (driverArea.style.display = 'none');
  const f1 = qs('#adminLoginForm'); f1 && f1.reset();
  const f2 = qs('#loginForm'); f2 && f2.reset();
  refreshHeaderForSession();
}
function showAdminLogin(){ homeScreen && (homeScreen.style.display = 'none'); adminLogin && (adminLogin.style.display = 'block'); driverLogin && (driverLogin.style.display = 'none'); adminArea && (adminArea.style.display = 'none'); driverArea && (driverArea.style.display = 'none'); refreshHeaderForSession(); }
function showDriverLogin(){ homeScreen && (homeScreen.style.display = 'none'); adminLogin && (adminLogin.style.display = 'none'); driverLogin && (driverLogin.style.display = 'block'); adminArea && (adminArea.style.display = 'none'); driverArea && (driverArea.style.display = 'none'); refreshHeaderForSession(); }
async function showAdminArea(){ adminArea && (adminArea.style.display = 'grid'); driverArea && (driverArea.style.display = 'none'); homeScreen && (homeScreen.style.display = 'none'); adminLogin && (adminLogin.style.display = 'none'); driverLogin && (driverLogin.style.display = 'none'); refreshHeaderForSession(); if(state.origin) placeOriginMarker(); await refreshAdminData(); }
async function showDriverArea(name){ driverArea && (driverArea.style.display = 'block'); adminArea && (adminArea.style.display = 'none'); homeScreen && (homeScreen.style.display = 'none'); adminLogin && (adminLogin.style.display = 'none'); driverLogin && (driverLogin.style.display = 'none'); refreshHeaderForSession(); if(driverNameDisplay) driverNameDisplay.textContent = name || ''; await loadDriverRoutes(); }

// Fin PARTE 1

// -------------------- PARTE 2: CRUD (Drivers & Workers), renderers y login handlers --------------------

// -------------------- Render Drivers / Workers / Stats --------------------
function escapeHtml(s){
  if(!s && s!==0) return '';
  return String(s).replace(/[&<>"']/g, function(m){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
  });
}

function renderDrivers(){
  const list = state.drivers || [];
  if(!driversTableBody) return;
  driversTableBody.innerHTML = '';
  list.forEach((d,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td>
      <td>${escapeHtml(d.display_name)}</td>
      <td>${escapeHtml(d.username)}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-action="edit" data-id="${d.id}">✏️</button>
        <button class="btn small" data-action="del" data-id="${d.id}">🗑️</button>
      </td>`;
    driversTableBody.appendChild(tr);
  });
}

function renderWorkers(){
  const filterDay = filterDayAdmin ? filterDayAdmin.value : '';
  const filterShift = filterShiftAdmin ? filterShiftAdmin.value : '';
  let list = (state.workers || []).slice();

  if(filterDay) list = list.filter(w=>w.day === filterDay);
  if(filterShift) list = list.filter(w=>w.shift === filterShift);

  if(!workersTableBody) return;
  workersTableBody.innerHTML = '';

  list.forEach((w,i)=>{
    const tr = document.createElement('tr');
    const driverDisplay = w.driver_name || w.chofer || w.driver || '—';
    const addr = w.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}" target="_blank">${escapeHtml(w.address)}</a>` : '—';
    tr.innerHTML = `<td>${i+1}</td>
      <td>${escapeHtml(w.name || '—')}</td>
      <td>${addr}</td>
      <td>${escapeHtml(driverDisplay)}</td>
      <td>${escapeHtml(w.day || '—')}</td>
      <td>${escapeHtml(w.shift || '—')}</td>
      <td>${escapeHtml(w.phone || '—')}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-action="edit" data-id="${w.id}">✏️</button>
        <button class="btn small" data-action="del" data-id="${w.id}">🗑️</button>
      </td>`;
    workersTableBody.appendChild(tr);
  });
}

function updateChoferSelect(){
  if(!choferSelect) return;
  choferSelect.innerHTML = '';
  const list = state.drivers || [];
  if(list.length === 0){
    const opt = document.createElement('option'); opt.value=''; opt.textContent='— Ninguno —'; choferSelect.appendChild(opt);
    return;
  }
  list.forEach(d=>{
    const opt = document.createElement('option'); opt.value = d.id; opt.textContent = d.display_name; choferSelect.appendChild(opt);
  });
  choferSelect.value = list[0] ? list[0].id : '';
}

function renderStats(){
  if(!statsEl) return;
  const list = state.workers || [];
  statsEl.innerHTML = dias.map(d=>`<span class="chip">${d}: <strong style="margin-left:6px">${list.filter(w=>w.day===d).length}</strong></span>`).join('');
}

// -------------------- refreshAdminData --------------------
async function refreshAdminData() {
  try {
    const [drivers, workers] = await Promise.all([ api.getDrivers(), api.getWorkers() ]);
    state.drivers = Array.isArray(drivers) ? drivers : [];
    state.workers = Array.isArray(workers) ? workers : [];
    renderDrivers();
    renderWorkers();
    updateChoferSelect();
    renderStats();
  } catch (err) {
    console.error('refreshAdminData error:', err);
    showError(`Error al cargar datos: ${err.message}. ¿La sesión expiró?`);
    setSession(null);
    showHome();
  }
}

// -------------------- Login (Admin + Driver) --------------------
if(adminLoginForm) {
  adminLoginForm.onsubmit = async e => {
    e.preventDefault();
    const identifier = qs('#adminUser').value.trim();
    const password = qs('#adminPass').value;
    if (!identifier || !password) return showError('Ingresa usuario y contraseña');
    try {
      const data = await api.loginAdmin(identifier, password);
      if (data.role === 'admin') {
        setSession({ role:'admin', name:'Administrador' });
        if(adminLogin) adminLogin.style.display='none';
        await showAdminArea();
      } else {
        throw new Error('Este usuario no tiene permisos de administrador.');
      }
    } catch (err) {
      console.error('admin login error', err);
      showError(`Error de login: ${err.message}. Verifica usuario y contraseña.`);
    }
  };
}

if(loginForm) {
  loginForm.onsubmit = async e => {
    e.preventDefault();
    const username = qs('#loginUsername').value.trim();
    const pass = qs('#loginPassword').value;
    if (!username || !pass) return showError("Ingresa usuario y contraseña");
    try {
      const data = await api.loginDriver(username, pass);
      setSession({ role:'driver', name: data.name, username: username });
      if(driverLogin) driverLogin.style.display = 'none';
      await showDriverArea(data.name);
    } catch (err) {
      console.error('driver login error', err);
      showError(`Credenciales incorrectas: ${err.message}`);
    }
  };
}

// Cancel buttons
if(adminCancel) adminCancel.onclick = () => showHome();
const driverCancelBtn = qs('#driverCancel');
if(driverCancelBtn) driverCancelBtn.onclick = () => showHome();

// Logout header (works for admin cookie)
if(btnLogoutHeader) btnLogoutHeader.onclick = async () => {
  try { await api.logoutAdmin(); } catch(e){ console.warn('logout err', e); }
  finally { setSession(null); showHome(); }
};

// Logout driver (frontend only)
if(logoutDriverBtn) logoutDriverBtn.onclick = () => { setSession(null); showHome(); };

// -------------------- Drivers CRUD (event delegation) --------------------
if(driversTableBody){
  driversTableBody.addEventListener('click', async e=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const driver = state.drivers.find(d=>d.id===id);
    if(!driver) return;
    if(action === 'del'){
      if(!confirm(`¿Eliminar chofer ${driver.display_name}?`)) return;
      try {
        await api.deleteDriver(driver.id);
        await refreshAdminData();
      } catch (err) {
        console.error('delete driver err', err);
        showError(`Error al eliminar: ${err.message}`);
      }
    } else if(action === 'edit'){
      const newName = prompt(`Editar nombre de ${driver.display_name}`, driver.display_name);
      if(newName == null) return;
      let newPassword = null;
      if(confirm('¿Deseas cambiar la contraseña? (Deja en blanco para no cambiar)')){
        newPassword = prompt('Nueva contraseña:');
        if(newPassword === '') newPassword = null;
      }
      try {
        await api.updateDriver(driver.id, newName.trim(), newPassword);
        await refreshAdminData();
      } catch (err) {
        console.error('update driver err', err);
        showError(`Error al actualizar: ${err.message}`);
      }
    }
  });
}

// create driver form
if(driverForm){
  driverForm.onsubmit = async e => {
    e.preventDefault();
    const display_name = qs('#driverDisplayName').value.trim();
    const username = qs('#driverUsername').value.trim();
    const password = qs('#driverPassword').value;
    if(!display_name || !username || !password) return showError('Completa nombre, usuario y contraseña');
    try {
      await api.createDriver(username, display_name, password);
      e.target.reset();
      await refreshAdminData();
    } catch (err) {
      console.error('create driver err', err);
      showError(`Error al crear conductor: ${err.message}. ¿Ese usuario ya existe?`);
    }
  };
}

// -------------------- Workers CRUD (event delegation) --------------------
if(workersTableBody){
  workersTableBody.addEventListener('click', async e=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const worker = state.workers.find(w=>w.id===id);
    if(!worker) return;

    if(action === 'del'){
      if(!confirm(`¿Eliminar trabajador ${worker.name}?`)) return;
      try {
        await api.deleteWorker(worker.id);
        await refreshAdminData();
      } catch (err) {
        console.error('delete worker err', err);
        showError(`Error al eliminar: ${err.message}`);
      }
    } else if(action === 'edit'){
      try {
        const newName = prompt('Nombre', worker.name || '');
        if(newName == null) return;
        const newAddress = prompt('Dirección', worker.address || '');
        if(newAddress == null) return;
        const newPhone = prompt('Teléfono (sin +56 9 prefix)', (worker.phone || '').replace('+56 9 ',''));
        if(newPhone == null) return;
        const driverList = state.drivers.map(d=>`${d.id}:${d.display_name}`).join('\n');
        const chosen = prompt(`Chofer (elige id):\n${driverList}`, worker.driver_id || '');
        if(chosen == null) return;
        const driver_id = chosen ? Number(chosen) : null;
        const driver_name = state.drivers.find(d=>d.id===driver_id)?.display_name || null;
        const day = prompt('Día (ej: Lunes)', worker.day || '');
        if(day == null) return;
        const shift = prompt('Turno (Mañana/Tarde/Noche)', worker.shift || '');
        if(shift == null) return;
        const notes = prompt('Notas', worker.notes || '');
        if(notes == null) return;

        // geocodificar
        let lat = worker.lat || null, lng = worker.lng || null, formattedAddress = newAddress;
        try {
          const g = await geocodeAddress(newAddress);
          formattedAddress = g.address;
          lat = g.location.lat; lng = g.location.lng;
        } catch (geoErr) {
          if(!confirm(`No se pudo geocodificar la dirección (${geoErr.message}). ¿Actualizar sin coordenadas?`)) return;
          lat = null; lng = null;
        }

        const payload = {};
        if(newName.trim() !== worker.name) payload.name = newName.trim();
        if(formattedAddress !== worker.address) payload.address = formattedAddress;
        payload.lat = lat; payload.lng = lng;
        if(newPhone.trim()) payload.phone = '+56 9 ' + newPhone.trim();
        if(driver_id !== worker.driver_id) { payload.driver_id = driver_id; payload.driver_name = driver_name; }
        if(day !== worker.day) payload.day = day;
        if(shift !== worker.shift) payload.shift = shift;
        if(notes !== worker.notes) payload.notes = notes;

        await api.updateWorker(worker.id, payload);
        await refreshAdminData();
      } catch (err) {
        console.error('edit worker err', err);
        showError(`Error al actualizar trabajador: ${err.message}`);
      }
    }
  });
}

// create worker form
if(workerForm){
  workerForm.onsubmit = async e => {
    e.preventDefault();
    const name = qs('#name').value.trim();
    const address = qs('#address').value.trim();
    const driverSelect = qs('#choferSelect');
    const driver_id = driverSelect && driverSelect.value ? Number(driverSelect.value) : null;
    const driver_name = driverSelect && driverSelect.options[driverSelect.selectedIndex]?.textContent?.trim() || null;
    const phoneValue = qs('#phone').value.trim();
    const phone = phoneValue ? '+56 9 ' + phoneValue : '';
    const day = qs('#day').value;
    const shift = qs('#shift').value;
    const notes = qs('#notes').value.trim();

    if(!name || !address || !day || !shift) return showError('Completa los campos requeridos');

    const workerData = { name, address, phone, day, shift, notes, driver_id, driver_name };
    try {
      const g = await geocodeAddress(address);
      workerData.address = g.address;
      workerData.lat = g.location.lat;
      workerData.lng = g.location.lng;
      await api.createWorker(workerData);
      e.target.reset();
      await refreshAdminData();
    } catch (err) {
      console.warn('create worker geocode err', err);
      if(confirm(`No se pudo geocodificar (${err.message}). ¿Guardar sin coordenadas?`)){
        workerData.lat = null; workerData.lng = null;
        try {
          await api.createWorker(workerData);
          e.target.reset();
          await refreshAdminData();
        } catch (err2) {
          console.error('create worker err', err2);
          showError(`Error al crear trabajador: ${err2.message}`);
        }
      } else {
        showError('Corrige la dirección antes de guardar.');
      }
    }
  };
}

// -------------------- Export / Import --------------------
const exportBtn = qs('#exportBtn');
if(exportBtn) exportBtn.onclick = () => {
  const blob = new Blob([JSON.stringify(state.workers, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'trabajadores.json'; a.click(); URL.revokeObjectURL(url);
};
const importBtn = qs('#importBtn');
if(importBtn) importBtn.onclick = () => qs('#importFile').click();
const importFile = qs('#importFile');
if(importFile) importFile.onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const parsed = JSON.parse(r.result);
      if(!Array.isArray(parsed)) throw new Error('Archivo inválido');
      state.workers = parsed;
      renderWorkers();
      renderStats();
      alert('Importado localmente (solo para visualización). Recarga la página para volver a los datos del servidor.');
    } catch (err) {
      console.error('import file err', err);
      alert('Archivo inválido');
    }
  };
  r.readAsText(f);
};

// Fin PARTE 2
// -------------------- PARTE 3: Clustering, rutas del ADMIN y asignaciones --------------------

// -------------------- Haversine --------------------
function haversine(a, b) {
  const R = 6371e3;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

// -------------------- K-Means simple --------------------
function kMeans(points, k, maxIter = 30) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (k <= 0) k = 1;
  if (k >= points.length) return points.map(p => [p]);

  const centroids = [];
  const used = new Set();

  while (centroids.length < k) {
    const i = Math.floor(Math.random() * points.length);
    if (!used.has(i)) {
      used.add(i);
      centroids.push({ lat: points[i].lat, lng: points[i].lng });
    }
  }

  let clusters = [];

  for (let iter = 0; iter < maxIter; iter++) {
    clusters = Array.from({ length: k }, () => []);

    points.forEach(p => {
      let best = 0;
      let bestDist = Infinity;

      centroids.forEach((c, i) => {
        const d = haversine(p, c);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });

      clusters[best].push(p);
    });

    let changed = false;

    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;

      const avgLat = clusters[i].reduce((s, p) => s + p.lat, 0) / clusters[i].length;
      const avgLng = clusters[i].reduce((s, p) => s + p.lng, 0) / clusters[i].length;

      if (Math.abs(avgLat - centroids[i].lat) > 1e-6 ||
          Math.abs(avgLng - centroids[i].lng) > 1e-6) {
        changed = true;
      }

      centroids[i].lat = avgLat;
      centroids[i].lng = avgLng;
    }

    if (!changed) break;
  }

  return clusters.filter(c => c.length > 0);
}

// -------------------- Guardar / Cargar asignaciones --------------------
function saveAssignments(arr) {
  try { setItem('assignments_v2', arr); }
  catch (e) { console.warn('saveAssignments error', e); }
}

function loadAssignments() {
  try { return getItem('assignments_v2') || []; }
  catch { return []; }
}

// -------------------- Construcción de rutas ADMIN --------------------
async function buildAndRenderRoutes(capacity = VAN_CAPACITY) {

    // limpiar rutas anteriores
    if (state.services.directionsRenderers) {
        state.services.directionsRenderers.forEach(r => r.set("directions", null));
    }
    state.services.directionsRenderers = [];

    const routeListEl = qs('#routeList');
    if (routeListEl) routeListEl.innerHTML = '';

    const summary = qs('#routeSummary');
    if (summary) summary.textContent = '';

    if (!state.origin) {
        showError("Primero define la base (origen).");
        return;
    }

    const filterDay  = filterDayAdmin?.value || '';
    const filterShift = filterShiftAdmin?.value || '';

    let workers = state.workers.filter(w => w.lat && w.lng);

    if (filterDay) workers = workers.filter(w => w.day === filterDay);
    if (filterShift) workers = workers.filter(w => w.shift === filterShift);

    if (workers.length === 0) {
        showError("No hay trabajadores con coordenadas.");
        return;
    }

    // ORDEN REAL POR DISTANCIA A LA BASE (como chofer)
    const ordered = await orderByBaseDistance(workers, state.origin);

    // GENERAR RUTA CIRCULAR RESPETANDO TU ORDEN
    const routeResult = await buildCircularRoute(ordered, state.origin);

    // Render Lista
    ordered.forEach((w, i) => {
        const div = document.createElement("div");
        div.innerHTML = `${i + 1}. ${w.name} — ${w.address}`;
        routeListEl.appendChild(div);
    });

    // Render mapa ADMIN
    renderRouteOnAdminMap({
        ordered,
        routeResult
    });

    // Resumen
    if (summary) {
        summary.textContent = `Total trabajadores: ${ordered.length}`;
    }

    alert("Ruta generada correctamente.");
}

// -------------------- Botón ADMIN: Generar Rutas --------------------
if (qs('#buildRouteAdmin')) {
  qs('#buildRouteAdmin').onclick = async () => {
    if (!state.origin) return showError("Debes establecer primero la Base del ADMIN.");

    const workersToRoute = (state.workers || [])
      .filter(w => w.lat && w.lng);

    if (workersToRoute.length === 0) {
      return showError("No hay trabajadores geocodificados.");
    }

    const capInput = prompt(
      'Capacidad por VAN (actual: ' + VAN_CAPACITY + ')',
      String(VAN_CAPACITY)
    );

    if (!capInput) return;

    const cap = Number(capInput);
    if (!Number.isInteger(cap) || cap <= 0) {
      return showError("Capacidad inválida.");
    }

    VAN_CAPACITY = cap;

    await buildAndRenderRoutes(VAN_CAPACITY);
  };
}
// -------------------- PARTE 4 COMPLETA: Lógica del CHOFER --------------------

const driverBaseInput = qs('#driverBaseInput');
const driverSetBaseBtn = qs('#driverSetBase');
const driverUseMyLocationBtn = qs('#driverUseMyLocation');
const filterDayDriver = qs('#filterDayDriver');
const filterShiftDriver = qs('#filterShiftDriver');
const applyFiltersDriver = qs('#applyFiltersDriver');

if (filterDayDriver) {
    filterDayDriver.innerHTML =
        '<option value="">Todos</option>' +
        dias.map(d => `<option value="${d}">${d}</option>`).join('');
}

// Guardar base del chofer
function setDriverBase(obj) {
    if (!obj || !obj.lat || !obj.lng) return;

    state.driverBaseLocation = {
        lat: Number(obj.lat),
        lng: Number(obj.lng),
        address: obj.address || `${obj.lat},${obj.lng}`
    };

    setItem(KEY_DRIVER_BASE, state.driverBaseLocation);

    if (state.driverBaseMarker) {
        try { state.driverBaseMarker.setMap(null); } catch { }
    }

    if (state.mapDriver) {
        state.driverBaseMarker = new google.maps.Marker({
            position: { lat: state.driverBaseLocation.lat, lng: state.driverBaseLocation.lng },
            map: state.mapDriver,
            title: 'Base del Chofer',
            icon: {
                path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                scale: 7,
                fillColor: '#007BFF',
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#003E99'
            }
        });

        state.mapDriver.panTo({
            lat: state.driverBaseLocation.lat,
            lng: state.driverBaseLocation.lng
        });

        state.mapDriver.setZoom(13);
    }
}

// Botón: establecer base desde input
if (driverSetBaseBtn) {
    driverSetBaseBtn.onclick = async () => {
        const address = driverBaseInput?.value?.trim();
        if (!address) return showError('Ingresa una dirección válida.');

        try {
            const g = await geocodeAddress(address);
            setDriverBase({ lat: g.location.lat, lng: g.location.lng, address: g.address });
            alert('Base del chofer establecida.');
            await loadDriverRoutes();
        } catch (err) {
            showError('No se pudo geocodificar: ' + err.message);
        }
    };
}

// Botón: usar ubicación actual
if (driverUseMyLocationBtn) {
    driverUseMyLocationBtn.onclick = () => {
        if (!navigator.geolocation) return showError('Geolocalización no disponible');

        navigator.geolocation.getCurrentPosition(pos => {
            setDriverBase({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                address: 'Mi ubicación'
            });

            if (driverBaseInput) driverBaseInput.value = 'Mi ubicación';

            alert('Base establecida en tu ubicación.');
            loadDriverRoutes();
        }, err => showError('Error geolocalizando: ' + err.message), { enableHighAccuracy: true });
    };
}
// Autocomplete para el input de base del chofer
function initDriverAutocomplete() {
    if (!driverBaseInput) return;

    const autocomplete = new google.maps.places.Autocomplete(driverBaseInput, {
        componentRestrictions: { country: "cl" },
        fields: ["formatted_address", "geometry"]
    });

    autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place || !place.geometry) {
            showError("No se pudo obtener la ubicación seleccionada.");
            return;
        }

        state.driverBaseLocation = {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address: place.formatted_address
        };

        setItem("rutasmart_driver_base", state.driverBaseLocation);
        loadDriverRoutes();
    });
}


// Aplicar filtros
if (applyFiltersDriver) {
    applyFiltersDriver.onclick = () => loadDriverRoutes();
}

// Limpiar render y marcadores
function clearDriverMapRenderers() {
    try {
        if (state.services.driverRenderer)
            state.services.driverRenderer.set('directions', null);
    } catch { }

    (state.services.driverMarkers || []).forEach(m => {
        try { m.setMap(null); } catch { }
    });

    state.services.driverMarkers = [];
}

// Dibujar ruta en el mapa del chofer
function renderRouteOnDriverMap(routeObj) {
    if (!state.mapDriver) return;

    clearDriverMapRenderers();

    const base = state.driverBaseLocation;

    // Si hay ruta optimizada
    if (routeObj && routeObj.routeResult) {
        try {
            state.services.driverRenderer.setDirections(routeObj.routeResult);
        } catch (e) {
            console.warn("Error renderizando ruta:", e);
        }

        // Colocar marcador de base
        if (base) {
            if (state.driverBaseMarker) state.driverBaseMarker.setMap(null);

            state.driverBaseMarker = new google.maps.Marker({
                position: { lat: base.lat, lng: base.lng },
                map: state.mapDriver,
                title: 'Base del Chofer',
                icon: {
                    path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                    scale: 7,
                    fillColor: '#007BFF',
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: '#003E99'
                }
            });
        }

        // Ajustar mapa
        const bounds = new google.maps.LatLngBounds();
        routeObj.routeResult.routes[0].legs.forEach(leg => {
            bounds.extend(leg.start_location);
            bounds.extend(leg.end_location);
        });

        if (!bounds.isEmpty()) state.mapDriver.fitBounds(bounds);

        return;
    }

    // Si NO hay ruta optimizada → solo marcadores ordenados
    const pts = routeObj.ordered || [];
    const bounds = new google.maps.LatLngBounds();

    pts.forEach((p, i) => {
        if (!p.lat || !p.lng) return;

        const m = new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map: state.mapDriver,
            label: String(i + 1),
            title: p.name || p.address
        });

        state.services.driverMarkers.push(m);
        bounds.extend({ lat: p.lat, lng: p.lng });
    });

    // Base
    if (base) {
        bounds.extend({ lat: base.lat, lng: base.lng });

        if (state.driverBaseMarker) state.driverBaseMarker.setMap(null);

        state.driverBaseMarker = new google.maps.Marker({
            position: { lat: base.lat, lng: base.lng },
            map: state.mapDriver,
            title: 'Base del Chofer',
            icon: {
                path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                scale: 7,
                fillColor: '#007BFF',
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#003E99'
            }
        });
    }

    if (!bounds.isEmpty()) state.mapDriver.fitBounds(bounds);
}

// ---------------------- PARTE EXTRA: ORDENAR Y OPTIMIZAR RUTA ----------------------

// Generar ruta optimizada desde la base del chofer
async function generateDriverRoute(points, base) {
    return new Promise((resolve, reject) => {

        if (!points.length) return resolve(null);

        const waypoints = points.map(p => ({
            location: new google.maps.LatLng(p.lat, p.lng),
            stopover: true
        }));

        state.services.directionsService.route({
            origin: new google.maps.LatLng(base.lat, base.lng),
            destination: new google.maps.LatLng(base.lat, base.lng),
            waypoints,
            optimizeWaypoints: true,
            travelMode: google.maps.TravelMode.DRIVING
        }, (result, status) => {
            if (status !== 'OK') {
                return reject(status);
            }

            const order = result.routes[0].waypoint_order;
            const ordered = order.map(i => points[i]);

            resolve({ ordered, routeResult: result });
        });
    });
}

// Cargar rutas del chofer con optimización real
async function loadDriverRoutes() {

    if (driverRoutesTableBody) driverRoutesTableBody.innerHTML = '';

    let workers = [];
    try {
        workers = await api.getDriverWorkers();
    } catch (err) {
        showError('Error cargando trabajadores: ' + err.message);
        return;
    }

    // Filtros
    const day = filterDayDriver?.value;
    const shift = filterShiftDriver?.value;

    if (day) workers = workers.filter(w => w.day === day);
    if (shift) workers = workers.filter(w => w.shift === shift);

    const base = state.driverBaseLocation;

    if (!base) {
        showError('Debes establecer tu base primero.');
        return;
    }

    // Ordenar por ruta real optimizada
    let optimized = null;

    try {
        optimized = await generateDriverRoute(workers, base);
    } catch (err) {
        console.warn("Error generando ruta:", err);
    }

    // Si hay ruta → usamos orden real
    if (optimized) workers = optimized.ordered;

    // Render tabla
    workers.forEach((w, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${escapeHtml(w.name)}</td>
            <td>${escapeHtml(w.address)}</td>
            <td>${escapeHtml(w.phone || '')}</td>
            <td>${escapeHtml(w.day || '')}</td>
            <td>${escapeHtml(w.shift || '')}</td>
        `;
        driverRoutesTableBody.appendChild(tr);
    });

    // Mapa
    if (optimized) {
        renderRouteOnDriverMap(optimized);
    } else {
        renderRouteOnDriverMap({ ordered: workers });
    }
}
// ========================================================================================
//                GENERAR RUTA DEL ADMIN ORDENADA COMO EN EL CHOFER
// ========================================================================================

// Dibujar ruta en mapa admin
function renderRouteOnAdminMap(routeObj) {
    if (!state.mapAdmin) return;

    // Limpiar renderers previos
    (state.services.directionsRenderers || []).forEach(r => {
        try { r.set('directions', null); } catch {}
    });
    state.services.directionsRenderers = [];

    const renderer = new google.maps.DirectionsRenderer({
        map: state.mapAdmin,
        suppressMarkers: false
    });

    state.services.directionsRenderers.push(renderer);

    // Si hay ruta optimizada real
    if (routeObj && routeObj.routeResult) {
        try {
            renderer.setDirections(routeObj.routeResult);
        } catch (e) {
            console.warn("Error renderizando admin:", e);
        }

        const bounds = new google.maps.LatLngBounds();
        routeObj.routeResult.routes[0].legs.forEach(leg => {
            bounds.extend(leg.start_location);
            bounds.extend(leg.end_location);
        });
        if (!bounds.isEmpty()) state.mapAdmin.fitBounds(bounds);
        return;
    }

    // Si NO hay ruta → marcadores básicos
    const pts = routeObj.ordered || [];
    const bounds = new google.maps.LatLngBounds();
    pts.forEach((p, i) => {
        if (!p.lat || !p.lng) return;

        const m = new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map: state.mapAdmin,
            label: String(i + 1),
            title: p.name || p.address
        });
        bounds.extend({ lat: p.lat, lng: p.lng });
    });

    if (state.origin) bounds.extend(state.origin);
    if (!bounds.isEmpty()) state.mapAdmin.fitBounds(bounds);
}

// Mostrar lista ordenada en tabla del admin
function displayAdminRouteList(ordered) {
    const listEl = qs("#routeList");
    const sumEl = qs("#routeSummary");

    if (listEl) listEl.innerHTML = "";
    if (sumEl) sumEl.innerHTML = "";

    ordered.forEach((w, i) => {
        const div = document.createElement("div");
        div.className = "chip";
        div.textContent = `${i + 1}. ${w.name || ""} — ${w.address}`;
        sumEl.appendChild(div);
    });
}

// --------------------------- buildRouteAdmin ORDENADA ---------------------------
async function buildRouteAdmin() {

    if (!state.origin) {
        showError("Debes establecer la base primero.");
        return;
    }

    let workers = state.filteredWorkers || [];

    if (!workers.length) {
        showError("No hay trabajadores para generar ruta.");
        return;
    }

    const base = state.origin;

    try {
        // Orden igual que chofer (más cercano → más lejano)
        const ordered = await orderByBaseDistance(workers, base);

        // Ruta circular manteniendo ese orden
        const routeResult = await buildCircularRoute(ordered, base);

        // Renderizar
        renderRouteOnAdminMap({ ordered, routeResult });

        // Listar
        displayAdminRouteList(ordered);

    } catch (err) {
        console.error("Error generando ruta admin:", err);
        showError("No se pudo generar la ruta.");
    }
}

// ========================================================================================
//      ORDENAR DIRECCIONES POR DISTANCIA A LA BASE DEL CHOFER + RUTA CIRCULAR REAL
// ========================================================================================

// ----------- ORDENAR POR DISTANCIA A LA BASE DEL CHOFER -----------
async function orderByBaseDistance(points, base) {
  return new Promise((resolve, reject) => {

    if (!points.length) return resolve([]);

    const destinations = points.map(p =>
      new google.maps.LatLng(p.lat, p.lng)
    );

    state.services.distanceMatrix.getDistanceMatrix({
      origins: [new google.maps.LatLng(base.lat, base.lng)],
      destinations,
      travelMode: google.maps.TravelMode.DRIVING
    }, (res, status) => {
      if (status !== 'OK') {
        console.error('DistanceMatrix error:', status);
        return reject(status);
      }

      const distances = res.rows[0].elements;

      const withDistance = points.map((p, i) => ({
        ...p,
        distVal: distances[i].status === 'OK'
          ? distances[i].distance.value
          : Number.MAX_SAFE_INTEGER
      }));

      // ORDENAR DE MÁS CERCANO → MÁS LEJANO
      withDistance.sort((a, b) => a.distVal - b.distVal);
      resolve(withDistance);
    });
  });
}
// -------------------- Helpers: calcular distancia kM (base -> worker) --------------------
function computeDistanceKm(base, worker) {
    if (!base || !worker || !worker.lat || !worker.lng) return Promise.resolve(null);

    return new Promise((resolve) => {
        state.services.distanceMatrix.getDistanceMatrix({
            origins: [new google.maps.LatLng(base.lat, base.lng)],
            destinations: [new google.maps.LatLng(worker.lat, worker.lng)],
            travelMode: google.maps.TravelMode.DRIVING
        }, (res, status) => {
            if (status !== "OK" || !res.rows || !res.rows[0] || !res.rows[0].elements) return resolve(null);

            const el = res.rows[0].elements[0];
            if (!el || el.status !== "OK" || typeof el.distance?.value === 'undefined') return resolve(null);

            resolve(el.distance.value / 1000); // km
        });
    });
}


// ----------- GENERAR RUTA CIRCULAR RESPETANDO TU ORDEN -----------
async function buildCircularRoute(orderedPoints, base) {
  return new Promise((resolve, reject) => {

    if (!orderedPoints.length) return resolve(null);

    const waypoints = orderedPoints.map(p => ({
      location: new google.maps.LatLng(p.lat, p.lng),
      stopover: true
    }));

    state.services.directionsService.route({
      origin: new google.maps.LatLng(base.lat, base.lng),
      destination: new google.maps.LatLng(base.lat, base.lng),
      waypoints,
      optimizeWaypoints: false,   // ← CLAVE: NO CAMBIAR ORDEN
      travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
      if (status !== 'OK') {
        console.error('Error ruta circular chofer:', status);
        return reject(status);
      }
      resolve(result);
    });
  });
}


// ========================================================================================
//                      INTEGRACIÓN EN loadDriverRoutes()
// ========================================================================================

const _oldLoadDriverRoutes = loadDriverRoutes;

loadDriverRoutes = async function () {

  if (driverRoutesTableBody) driverRoutesTableBody.innerHTML = '';

  let workersToDisplay = [];
  try {
    workersToDisplay = await api.getDriverWorkers();
  } catch (err) {
    console.error('loadDriverRoutes error', err);
    showError(`Error al cargar rutas: ${err.message}`);
    setSession(null);
    showHome();
    return;
  }

  // Filtros de día y turno
  const dayFilter = filterDayDriver ? filterDayDriver.value : '';
  const shiftFilter = filterShiftDriver ? filterShiftDriver.value : '';

  if (dayFilter) workersToDisplay = workersToDisplay.filter(w => w.day === dayFilter);
  if (shiftFilter) workersToDisplay = workersToDisplay.filter(w => w.shift === shiftFilter);

  // Base del chofer (driverBase o origen)
  const base = state.driverBaseLocation || state.origin;
  if (!base) {
    showError("Por favor define una base primero.");
    return;
  }

  // ---------- ORDEN + RUTA CIRCULAR ----------
  try {
    // 1) Orden real por distancia a la base
    const ordered = await orderByBaseDistance(workersToDisplay, base);

    // 2) Crear ruta circular respetando EL ORDEN
    const routeResult = await buildCircularRoute(ordered, base);

    // 3) Actualizar lista para tabla
    workersToDisplay = ordered;

    // 4) Mostrar ruta y marcadores en mapa
    renderRouteOnDriverMap({
      ordered,
      routeResult
    });

  } catch (err) {
    console.error("Error generando ruta circular del chofer:", err);
    renderRouteOnDriverMap({ ordered: workersToDisplay });
  }
// ----------------- RENDER TABLA (con Distancia calculada) -----------------
try {
    // Preparar destinos para DistanceMatrix (todos a la vez)
    const destinations = workersToDisplay
        .filter(w => w.lat && w.lng)
        .map(w => new google.maps.LatLng(w.lat, w.lng));

    if (destinations.length > 0) {
        // pedir distances en un solo llamado
        const dmRes = await new Promise((resolve, reject) => {
            state.services.distanceMatrix.getDistanceMatrix({
                origins: [ new google.maps.LatLng(base.lat, base.lng) ],
                destinations,
                travelMode: google.maps.TravelMode.DRIVING,
            }, (res, status) => {
                if (status !== 'OK') return reject(status);
                resolve(res);
            });
        });

        const elements = (dmRes.rows && dmRes.rows[0] && dmRes.rows[0].elements) ? dmRes.rows[0].elements : [];

        // asignar distKm a los correspondientes workers (respeta el orden de workersToDisplay)
        let destIndex = 0;
        for (let i = 0; i < workersToDisplay.length; i++) {
            const w = workersToDisplay[i];
            if (w.lat && w.lng) {
                const el = elements[destIndex];
                if (el && el.status === 'OK' && el.distance && typeof el.distance.value !== 'undefined') {
                    w.distKm = el.distance.value / 1000;
                } else {
                    w.distKm = null;
                }
                destIndex++;
            } else {
                w.distKm = null;
            }
        }
    } else {
        // ninguno tenía coordenadas
        workersToDisplay.forEach(w => w.distKm = null);
    }
} catch (dmErr) {
    console.warn('DistanceMatrix batch error:', dmErr);
    // fallback: sin distancias
    workersToDisplay.forEach(w => w.distKm = null);
}

// ahora renderizar fila por fila (con columna Distancia)
workersToDisplay.forEach((w, i) => {
    const tr = document.createElement('tr');
    const addressLink = w.address
      ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}" target="_blank">${escapeHtml(w.address)}</a>`
      : '—';

    const distText = (typeof w.distKm === 'number' && !isNaN(w.distKm))
      ? (w.distKm < 1 ? (Math.round(w.distKm * 1000) + ' m') : (w.distKm.toFixed(1) + ' km'))
      : '—';

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(w.name)}</td>
      <td>${addressLink}</td>
      <td>${escapeHtml(w.phone || '—')}</td>
      <td>${distText}</td>
      <td>${escapeHtml(w.day || '—')}</td>
      <td>${escapeHtml(w.shift || '—')}</td>
    `;

    if (driverRoutesTableBody) driverRoutesTableBody.appendChild(tr);
});

};
