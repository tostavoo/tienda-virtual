// ===== Config y helpers de red
// frontend/admin.js
const API_BASE = 'http://localhost:4000/api';

const api = (p) => `${API_BASE}${p}`;

async function parseJsonOrThrow(res){
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const t = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} — respuesta no JSON: ${t.slice(0,120)}`);
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status; e.payload = data;
    throw e;
  }
  return data;
}
async function getJSON(path, opts={}) {
  const res = await fetch(api(path), opts);
  return parseJsonOrThrow(res);
}

// ===== Utils
const fmtCOP = (n) =>
  Number(n || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const getToken = () => localStorage.getItem("token");
const getUser  = () => { try { return JSON.parse(localStorage.getItem("user")||"null"); } catch { return null; } };
const setUser  = (u) => localStorage.setItem("user", JSON.stringify(u));
const clearAuth = () => { localStorage.removeItem("token"); localStorage.removeItem("user"); };

// ===== DOM base
const $guard   = document.getElementById("admin-guard");
const $content = document.getElementById("admin-content");
const $adminUser   = document.getElementById("admin-user");
const $adminLogout = document.getElementById("admin-logout");

// Tabs
const $tabOrders   = document.getElementById('tab-orders');
const $tabProducts = document.getElementById('tab-products');
const $secOrders   = document.getElementById('orders-section');
const $secProducts = document.getElementById('products-section');

// ===== Guard de admin
async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    return await getJSON('/me', { headers: { Authorization: `Bearer ${token}` } });
  } catch { return null; }
}

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me || me.role !== "admin") {
    if ($guard) $guard.textContent = "No tienes permisos de administrador.";
    setTimeout(() => { window.location.href = "index.html"; }, 1200);
    return null;
  }
  setUser(me);
  if ($adminUser) { $adminUser.hidden = false; $adminUser.textContent = `${me.name} (admin)`; }
  if ($adminLogout) $adminLogout.hidden = false;
  if ($guard) $guard.hidden = true;
  if ($content) $content.hidden = false;
  return me;
}

$adminLogout?.addEventListener("click", ()=>{
  clearAuth();
  window.location.href = "index.html";
});

// ====== PEDIDOS ======
const $tbody   = document.getElementById("admin-orders-body");
const $stats   = document.getElementById("admin-stats");
const $status  = document.getElementById("f-status");
const $q       = document.getElementById("f-q");
const $apply   = document.getElementById("f-apply");
const $clear   = document.getElementById("f-clear");

async function loadOrdersAdmin() {
  const token = getToken();
  if (!token) return [];
  return getJSON('/admin/orders', { headers: { Authorization: `Bearer ${token}` } });
}

function renderStats(orders) {
  if (!$stats) return;
  const total = orders.reduce((acc, o) => acc + Math.round(o.totalCent / 100), 0);
  const porEstado = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});
  $stats.innerHTML = `
    <div class="stat">Pedidos: <strong>${orders.length}</strong></div>
    <div class="stat">Pendientes: <strong>${porEstado.pendiente || 0}</strong></div>
    <div class="stat">Enviados: <strong>${porEstado.enviado || 0}</strong></div>
    <div class="stat">Entregados: <strong>${porEstado.entregado || 0}</strong></div>
    <div class="stat">Ventas totales: <strong>${fmtCOP(total)}</strong></div>
  `;
}

function renderOrdersAdmin(orders) {
  if (!$tbody) return;
  const rows = orders.map(o => {
    const fecha = new Date(o.createdAt);
    const fechaStr = fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    const totalPesos = Math.round(o.totalCent / 100);
    const itemsStr = (o.items || []).map(it => {
      const line = Math.round(it.lineTotalCent / 100);
      return `${it.qty}× ${it.nameSnapshot}${it.sizeSnapshot ? ' ('+it.sizeSnapshot+')' : ''}${it.colorSnapshot ? ' - '+it.colorSnapshot : ''} = ${fmtCOP(line)}`;
    }).join('<br>');

    const select = `
      <select class="stsel" data-id="${o.id}">
        <option value="pendiente" ${o.status==='pendiente'?'selected':''}>Pendiente</option>
        <option value="enviado"   ${o.status==='enviado'?'selected':''}>Enviado</option>
        <option value="entregado" ${o.status==='entregado'?'selected':''}>Entregado</option>
      </select>
    `;

    return `
      <tr>
        <td>#${o.id}</td>
        <td>${fechaStr}</td>
        <td>${o.user?.name || ''} <br><small>${o.user?.email || ''}</small></td>
        <td>${o.status}</td>
        <td>${itemsStr || '-'}</td>
        <td><strong>${fmtCOP(totalPesos)}</strong></td>
        <td>
          ${select}
          <button class="btn small do-update" data-id="${o.id}">Actualizar</button>
        </td>
      </tr>
    `;
  }).join("");
  $tbody.innerHTML = rows;

  $tbody.querySelectorAll(".do-update").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const sel = $tbody.querySelector(`.stsel[data-id="${id}"]`);
      const status = sel?.value;
      if (!status) return;
      await updateOrderStatus(id, status);
    });
  });
}

async function updateOrderStatus(id, status) {
  const token = getToken();
  try {
    const data = await getJSON(`/admin/orders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    alert(`Pedido #${id} ahora está en estado "${data.status}"`);
    await applyFilters();
  } catch (e) {
    alert(e.message);
  }
}

let _allOrdersCache = [];
function applyLocalFilters(orders) {
  const st = $status?.value.trim() || '';
  const q  = $q?.value.trim().toLowerCase() || '';
  return orders.filter(o => {
    const okSt = st ? o.status === st : true;
    const text = `${o.user?.name || ''} ${o.user?.email || ''}`.toLowerCase();
    const okQ = q ? text.includes(q) : true;
    return okSt && okQ;
  });
}
async function applyFilters() {
  if (!_allOrdersCache.length) {
    _allOrdersCache = await loadOrdersAdmin();
  }
  const filtered = applyLocalFilters(_allOrdersCache);
  renderStats(filtered);
  renderOrdersAdmin(filtered);
}
$apply?.addEventListener("click", applyFilters);
$clear?.addEventListener("click", async ()=>{
  if ($status) $status.value = "";
  if ($q) $q.value = "";
  await applyFilters();
});

// ====== PRODUCTOS ======
const $prodBody = document.getElementById('prod-body');
const $form = document.getElementById('prod-form');
const $pName = document.getElementById('p-name');
const $pCat  = document.getElementById('p-category');
const $pDesc = document.getElementById('p-desc');
const $pAct  = document.getElementById('p-active');
const $pReset= document.getElementById('p-reset');

async function loadCategories(){
  try{
    const cats = await getJSON('/categories');
    if ($pCat){
      $pCat.innerHTML = '<option value="">Selecciona…</option>' +
        cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
  }catch(e){
    if ($pCat) $pCat.innerHTML = '<option value="">Error cargando</option>';
  }
}

async function loadProducts(){
  const token = getToken();
  if (!token) return [];
  return getJSON('/admin/products', { headers: { Authorization: `Bearer ${token}` } });
}

function renderProducts(items){
  if (!$prodBody) return;
  const rows = items.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${p.category?.name || '-'}</td>
      <td><small>${p.slug}</small></td>
      <td>${p.active ? 'Sí' : 'No'}</td>
      <td>${p._count?.variants ?? 0}</td>
      <td style="display:flex; gap:6px; flex-wrap:wrap">
        <button class="btn small" data-act="toggle" data-id="${p.id}" data-active="${p.active ? '1':'0'}">
          ${p.active ? 'Desactivar' : 'Activar'}
        </button>
        <button class="btn small ghost" data-act="edit" data-id="${p.id}">Editar</button>
        <button class="btn small ghost" data-act="price" data-id="${p.id}">Precio</button>
        <button class="btn small ghost" data-act="add-variant" data-id="${p.id}">Variante</button>
        <button class="btn small ghost" data-act="images" data-id="${p.id}">Imágenes</button>
        <button class="btn small danger" data-act="delete" data-id="${p.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
  $prodBody.innerHTML = rows;

  // Acciones
  $prodBody.querySelectorAll('button[data-act="toggle"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      const curr = btn.dataset.active === '1';
      await toggleProduct(id, !curr);
    });
  });
  $prodBody.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      await editProductBasic(id);
    });
  });
  $prodBody.querySelectorAll('button[data-act="price"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      await editVariantPrice(id);
    });
  });
  $prodBody.querySelectorAll('button[data-act="add-variant"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      await quickAddVariant(id);
    });
  });
  $prodBody.querySelectorAll('button[data-act="images"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      await manageImages(id);
    });
  });
  $prodBody.querySelectorAll('button[data-act="delete"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      await deleteProduct(id);
    });
  });
}

async function refreshProductsUI(){
  try{
    const items = await loadProducts();
    renderProducts(items);
  }catch(e){
    alert(e.message);
  }
}

$form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  try{
    const token = getToken();
    if (!$pName.value.trim() || !$pCat.value) {
      alert('Nombre y categoría son obligatorios'); return;
    }
    const body = {
      name: $pName.value.trim(),
      categoryId: Number($pCat.value),
      shortDescription: $pDesc.value.trim() || null,
      active: !!$pAct.checked
    };
    await getJSON('/admin/products', {
      method:'POST',
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    $form.reset();
    if ($pAct) $pAct.checked = true;
    await refreshProductsUI();
    alert('Producto creado');
  }catch(e){
    alert(e.message);
  }
});

$pReset?.addEventListener('click', ()=> $form?.reset());

async function toggleProduct(id, active){
  const token = getToken();
  try{
    await getJSON(`/admin/products/${id}/active`, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active })
    });
    await refreshProductsUI();
  }catch(e){
    alert(e.message);
  }
}

// Edición básica: pide nuevos valores por prompt
async function editProductBasic(id){
  const token = getToken();
  try{
    const newName = prompt('Nuevo nombre (deja vacío para no cambiar):', '');
    const newDesc = prompt('Nueva descripción corta (opcional):', '');

    const payload = {};
    if (newName && newName.trim()) payload.name = newName.trim();
    if (newDesc !== null) payload.shortDescription = newDesc.trim();

    if (Object.keys(payload).length === 0){
      alert('Sin cambios'); return;
    }

    await getJSON(`/admin/products/${id}`, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    await refreshProductsUI();
    alert('Producto actualizado');
  }catch(e){
    alert(e.message);
  }
}

// ==== NUEVO: editar precio de una variante ====
async function editVariantPrice(productId){
  try{
    const token = getToken();
    const variants = await getJSON(`/admin/products/${productId}/variants`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!Array.isArray(variants) || variants.length === 0) {
      alert('Este producto no tiene variantes aún. Crea una primero.'); return;
    }

    const list = variants.map(v =>
      `ID ${v.id} | SKU:${v.sku ?? '-'} | color:${v.color ?? '-'} | talla:${v.size ?? '-'} | precio: ${(v.priceCent/100).toLocaleString()}`
    ).join('\n');

    const chosen = prompt('Variantes:\n' + list + '\n\nEscribe el ID a editar:');
    const variantId = Number(chosen);
    if (!variantId) return;

    const priceStr = prompt('Nuevo precio en pesos (ej. 80000):');
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price <= 0) { alert('Precio inválido'); return; }

    await getJSON(`/admin/variants/${variantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ priceCent: Math.round(price * 100) })
    });
    alert('Precio actualizado ✔');
    await refreshProductsUI();
  }catch(e){
    alert(e.message);
  }
}

// ==== NUEVO: creación rápida de variantes ====
async function quickAddVariant(productId){
  try{
    const token = getToken();
    const pricePesos = prompt('Precio en pesos (solo números):', '100000');
    if (pricePesos === null) return;
    const pp = parseInt(pricePesos, 10);
    if (!Number.isFinite(pp) || pp <= 0) { alert('Precio inválido'); return; }

    const stockStr = prompt('Stock inicial:', '10');
    if (stockStr === null) return;
    const st = parseInt(stockStr, 10);
    if (!Number.isFinite(st) || st < 0) { alert('Stock inválido'); return; }

    const color = prompt('Color (opcional):', '') || null;
    const size  = prompt('Talla (opcional):', '') || null;
    const sku   = prompt('SKU (opcional):', '') || null;

    await getJSON(`/admin/products/${productId}/variants`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        priceCent: pp * 100,
        stock: st,
        color,
        size,
        sku,
        active: true
      })
    });

    await refreshProductsUI();
    alert('Variante creada.');
  }catch(e){
    alert(e.message);
  }
}

// ==== NUEVO: gestor de imágenes (listar/agregar/editar/ eliminar SIN PUT en server) ====
async function manageImages(productId){
  try{
    const token = getToken();
    const imgs = await getJSON(`/admin/products/${productId}/images`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    let menu = 'IMÁGENES ACTUALES:\n' + (
      imgs.length
        ? imgs.map(img => `ID ${img.id} | sort:${img.sortOrder} | ${img.url}`).join('\n')
        : '(sin imágenes)'
    );
    menu += '\n\nOpciones:\n1) Agregar\n2) Editar (reemplazar: elimina y vuelve a crear)\n3) Eliminar\n\nEscribe 1, 2 o 3:';

    const op = prompt(menu);
    if (!op) return;

    if (op === '1') {
      const url = prompt('URL de la imagen:'); if (!url) return;
      const sort = Number(prompt('sortOrder (entero, 0 por defecto):') || '0');

      await getJSON(`/admin/products/${productId}/images`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: url.trim(), sortOrder: Number.isInteger(sort) ? sort : 0 })
      });
      alert('Imagen agregada ✔');
    }

    if (op === '2') {
      const imgId = Number(prompt('ID de la imagen a reemplazar:')); if (!imgId) return;
      const newUrl = prompt('Nueva URL (obligatoria):'); if (!newUrl || !newUrl.trim()) { alert('URL requerida'); return; }
      const sortStr = prompt('Nuevo sortOrder (opcional, deja vacío para 0):');
      const s = sortStr ? Number(sortStr) : 0;
      // Reemplazo: DELETE + POST (no hay PUT en server.js actual)
      await getJSON(`/admin/images/${imgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      await getJSON(`/admin/products/${productId}/images`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: newUrl.trim(), sortOrder: Number.isInteger(s) ? s : 0 })
      });
      alert('Imagen reemplazada ✔');
    }

    if (op === '3') {
      const imgId = Number(prompt('ID de la imagen a eliminar:')); if (!imgId) return;
      await getJSON(`/admin/images/${imgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Imagen eliminada ✔');
    }

    await refreshProductsUI();
  }catch(e){
    alert(e.message);
  }
}

// ==== NUEVO: eliminar producto (con fallback a desactivar si no existe DELETE en server) ====
async function deleteProduct(productId){
  const token = getToken();
  if (!confirm('¿Eliminar este producto? Esta acción es permanente.')) return;
  try{
    // Intento DELETE real (si tu server tiene la ruta)
    await getJSON(`/admin/products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    alert('Producto eliminado ✔');
    await refreshProductsUI();
  }catch(e){
    // Fallback: si no existe el endpoint, desactivar
    if (e && e.status === 404) {
      if (confirm('No existe endpoint de eliminación. ¿Deseas desactivarlo en su lugar?')) {
        try{
          await getJSON(`/admin/products/${productId}/active`, {
            method:'PUT',
            headers:{ 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ active: false })
          });
          alert('Producto desactivado ✔');
          await refreshProductsUI();
        }catch(err){
          alert(err.message);
        }
      }
    } else {
      alert(e.message);
    }
  }
}

// ===== Tabs
function showOrders(){
  $tabOrders?.classList.remove('ghost');
  $tabProducts?.classList.add('ghost');
  if ($secOrders)   $secOrders.hidden   = false;
  if ($secProducts) $secProducts.hidden = true;
}
function showProducts(){
  $tabProducts?.classList.remove('ghost');
  $tabOrders?.classList.add('ghost');
  if ($secOrders)   $secOrders.hidden   = true;
  if ($secProducts) $secProducts.hidden = false;
}

$tabOrders?.addEventListener('click', showOrders);
$tabProducts?.addEventListener('click', showProducts);

// ===== Init
(async function initAdmin(){
  const me = await ensureAdmin(); // verifica rol=admin
  if (!me) return;

  // Default: mostrar pedidos
  showOrders();

  // Cargar datos
  _allOrdersCache = await loadOrdersAdmin();
  await applyFilters();

  await loadCategories();
  await refreshProductsUI();
})();

// =====================
// Reportes (integración)  ✅
/* Usa /api/reportes/* con token Bearer */
(() => {
  const API_R = (window.API_BASE || 'http://127.0.0.1:4000');

  // Helpers
  const byId = (id) => document.getElementById(id);
  const $    = (sel) => document.querySelector(sel);
  const fmtCOP2 = (n) => Number(n || 0).toLocaleString('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:2 });
  const token = () => localStorage.getItem('token') || '';

  async function apiGet(path){
    const r = await fetch(API_R + path, { headers: { Authorization: `Bearer ${token()}` }});
    if(!r.ok){
      const t = await r.text();
      throw new Error(`HTTP ${r.status}: ${t}`);
    }
    return r.json();
  }

  async function cargarReportes(){
    const desde = byId('r-desde')?.value || '';
    const hasta = byId('r-hasta')?.value || '';
    const al    = byId('r-al')?.value   || (hasta || desde);

    if (!byId('k-ventas')) return; // si la sección no existe en este HTML, sal

    // KPIs
    const k = await apiGet(`/api/reportes/kpis?desde=${desde}&hasta=${hasta}`);
    byId('k-ventas').textContent  = fmtCOP2(k.ventas_totales || 0);
    byId('k-boletas').textContent = k.boletas || 0;
    byId('k-ticket').textContent  = fmtCOP2(k.ticket_promedio || 0);
    byId('k-top').textContent     = (k.top5_productos?.[0]?.nombre || '—') + (k.top5_productos?.[0]?.cantidad ? ` (${k.top5_productos[0].cantidad})` : '');

    // Estado de resultados
    const er = await apiGet(`/api/reportes/estado-resultados?desde=${desde}&hasta=${hasta}`);
    byId('er-ingresos').textContent = fmtCOP2(er.ingresos || 0);
    byId('er-cogs').textContent     = fmtCOP2(er.costo_ventas || 0);
    byId('er-ub').textContent       = fmtCOP2(er.utilidad_bruta || 0);
    byId('er-imp').textContent      = fmtCOP2(er.impuestos || 0);
    byId('er-un').textContent       = fmtCOP2(er.utilidad_neta || 0);

    // Balance
    const bal = await apiGet(`/api/reportes/balance-general?al=${al || ''}`);
    byId('bal-caja').textContent = fmtCOP2(bal.activos?.caja_estimada || 0);
    byId('bal-inv').textContent  = fmtCOP2(bal.activos?.inventario || 0);
    byId('bal-cxp').textContent  = fmtCOP2(bal.pasivos?.cuentas_por_pagar || 0);
    byId('bal-pat').textContent  = fmtCOP2(bal.patrimonio || 0);
  }

  function exportCSV(){
    if (!document.getElementById('k-ventas')) return;
    const rows = [
      ['Sección','Concepto','Valor'],
      ['KPIs','Ventas totales', document.getElementById('k-ventas').textContent],
      ['KPIs','Boletas', document.getElementById('k-boletas').textContent],
      ['KPIs','Ticket promedio', document.getElementById('k-ticket').textContent],
      ['KPIs','Top producto', document.getElementById('k-top').textContent],
      ['Estado de resultados','Ingresos', document.getElementById('er-ingresos').textContent],
      ['Estado de resultados','COGS', document.getElementById('er-cogs').textContent],
      ['Estado de resultados','Utilidad bruta', document.getElementById('er-ub').textContent],
      ['Estado de resultados','Impuestos', document.getElementById('er-imp').textContent],
      ['Estado de resultados','Utilidad neta', document.getElementById('er-un').textContent],
      ['Balance','Caja estimada', document.getElementById('bal-caja').textContent],
      ['Balance','Inventario', document.getElementById('bal-inv').textContent],
      ['Balance','Cuentas por pagar', document.getElementById('bal-cxp').textContent],
      ['Balance','Patrimonio', document.getElementById('bal-pat').textContent],
    ];
    const csv = rows.map(r => r.map(c => {
      const s = String(c ?? '');
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reportes_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showSection(which){
    const to = document.getElementById('tab-orders');
    const tp = document.getElementById('tab-products');
    const tr = document.getElementById('tab-reportes');
    const so = document.getElementById('orders-section');
    const sp = document.getElementById('products-section');
    const sr = document.getElementById('reportes-section');

    if (to) to.classList.toggle('ghost', which !== 'orders');
    if (tp) tp.classList.toggle('ghost', which !== 'products');
    if (tr) tr.classList.toggle('ghost', which !== 'reportes');

    if (so) so.hidden = which !== 'orders';
    if (sp) sp.hidden = which !== 'products';
    if (sr) sr.hidden = which !== 'reportes';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const tabRep = document.getElementById('tab-reportes');
    if (tabRep) {
      tabRep.addEventListener('click', async () => {
        showSection('reportes');
        if (document.getElementById('r-desde') && document.getElementById('r-hasta') && document.getElementById('r-al')) {
          if (!document.getElementById('r-desde').value || !document.getElementById('r-hasta').value) {
            const today = new Date();
            const d2 = today.toISOString().slice(0,10);
            const d1 = new Date(today.getTime() - 29*24*3600*1000).toISOString().slice(0,10);
            document.getElementById('r-desde').value = d1;
            document.getElementById('r-hasta').value = d2;
            document.getElementById('r-al').value    = d2;
          }
        }
        try {
          if (!token()) throw new Error('Falta token. Inicia sesión como admin.');
          await cargarReportes();
        } catch (e) {
          alert(e.message);
        }
      });
    }

    const btnCargar = document.getElementById('r-cargar');
    if (btnCargar) {
      btnCargar.addEventListener('click', async () => {
        try {
          btnCargar.disabled = true;
          await cargarReportes();
        } catch (e) {
          alert(e.message);
        } finally {
          btnCargar.disabled = false;
        }
      });
    }

    const btnCsv = document.getElementById('r-csv');
    if (btnCsv) btnCsv.addEventListener('click', exportCSV);
  });
})();

// ========= Inventario (popup con estilos + botón volver) =========
function _fmtPesosCent(c) { return fmtCOP(Math.round((c || 0) / 100)); }

async function openInventoryPopup() {
  try {
    const token = getToken();
    const items = await getJSON('/admin/inventory', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const rows = items.map(it => `
      <tr>
        <td>${it.product}</td>
        <td>${it.sku ?? ''}</td>
        <td>${it.color ?? ''}</td>
        <td>${it.size ?? ''}</td>
        <td class="num">${it.stock}</td>
        <td class="num">${_fmtPesosCent(it.costCent)}</td>
        <td class="num">${_fmtPesosCent(it.priceCent)}</td>
        <td class="num">${_fmtPesosCent(it.profitCent)}</td>
        <td class="num">${it.marginPct}%</td>
        <td class="num">${_fmtPesosCent(it.stockValueCostCent)}</td>
        <td class="num">${_fmtPesosCent(it.stockValueSaleCent)}</td>
        <td>${it.active ? '<span class="badge ok">Sí</span>' : '<span class="badge no">No</span>'}</td>
      </tr>
    `).join('');

    const totQty   = items.reduce((s, it) => s + (it.stock || 0), 0);
    const totCostC = items.reduce((s, it) => s + (it.stockValueCostCent || 0), 0);
    const totSaleC = items.reduce((s, it) => s + (it.stockValueSaleCent || 0), 0);

    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Inventario</title>
        <style>
          :root{
            --bg:#0f1115; --card:#151922; --muted:#8fa0b3;
            --text:#eaf2ff; --acc:#f97316; --ok:#22c55e; --no:#ef4444; --line:#232a36;
            --bar-h: 64px;
          }
          *{box-sizing:border-box}
          html,body{height:100%}
          body{
            margin:0; background:var(--bg); color:var(--text);
            font:14px/1.45 ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;
          }
          .bar{
            position:sticky; top:0; z-index:5;
            display:flex; align-items:center; gap:8px;
            height:var(--bar-h); padding:0 16px;
            background:linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
            border-bottom:1px solid var(--line);
          }
          .bar h1{font-size:16px; margin:0; font-weight:600}
          .bar .grow{flex:1}
          .btn{
            border:1px solid var(--line); background:var(--card); color:var(--text);
            padding:8px 10px; border-radius:10px; cursor:pointer;
          }
          .btn:hover{border-color:#334155; transform:translateY(-0.5px)}
          .btn.primary{background:var(--acc); border-color:var(--acc); color:#111827}

          .wrap{padding:16px}
          .card{background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden;}
          .scroller{overflow:auto; max-height:calc(100vh - var(--bar-h) - 140px);} /* deja hueco para resumen */
          table{width:100%; border-collapse:collapse; min-width:1000px;}
          th,td{padding:10px 12px; border-bottom:1px solid var(--line)}
          th{
            position: sticky; top: 0; z-index: 1;
            background:var(--card); color:#c7d2fe; text-align:left; font-weight:600; font-size:12px; letter-spacing:.02em;
            box-shadow: inset 0 -1px 0 var(--line);
          }
          tr:nth-child(odd) td{background:rgba(255,255,255,0.02)}
          tr:hover td{background:rgba(249,115,22,0.08)}
          .num{text-align:right; white-space:nowrap}
          .muted{color:var(--muted)}
          .summary{
            display:flex; gap:16px; flex-wrap:wrap; padding:12px 16px;
            border-top:1px solid var(--line); background:#0d121a;
          }
          .chip{
            background:#0b1220; border:1px solid var(--line); border-radius:999px; padding:6px 10px; color:var(--muted);
          }
          .chip strong{color:var(--text); margin-left:6px}
          .badge{padding:2px 8px; border-radius:999px; font-size:12px}
          .badge.ok{background:rgba(34,197,94,.15); color:#86efac; border:1px solid rgba(34,197,94,.25)}
          .badge.no{background:rgba(239,68,68,.15); color:#fecaca; border:1px solid rgba(239,68,68,.25)}
          @media print{
            .bar, .summary{position:static; box-shadow:none}
            .btn{display:none}
            body{background:#fff; color:#000}
            .card{border-color:#ddd}
            th{top:auto; background:#f5f5f5; color:#000}
          }
        </style>
      </head>
      <body>
        <div class="bar">
          <button class="btn" onclick="if (window.opener && !window.opener.closed){ window.close(); } else { window.location.href='admin.html'; }">← Volver al admin</button>
          <div class="grow"></div>
          <h1>Inventario</h1>
          <div class="grow"></div>
          <button class="btn" onclick="window.print()">Imprimir</button>
        </div>

        <div class="wrap">
          <div class="card">
            <div class="scroller">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th>Color</th>
                    <th>Talla</th>
                    <th>Stock</th>
                    <th>Costo (u)</th>
                    <th>Venta (u)</th>
                    <th>Utilidad (u)</th>
                    <th>Margen %</th>
                    <th>Valorización @costo</th>
                    <th>Valorización @venta</th>
                    <th>Activo</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>

            <div class="summary">
              <div class="chip">Ítems: <strong>${items.length}</strong></div>
              <div class="chip">Unidades totales: <strong>${totQty}</strong></div>
              <div class="chip">Total @costo: <strong>${_fmtPesosCent(totCostC)}</strong></div>
              <div class="chip">Total @venta: <strong>${_fmtPesosCent(totSaleC)}</strong></div>
              <div class="chip muted">Generado: <strong>${new Date().toLocaleString('es-CO')}</strong></div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const w = window.open('', '_blank');
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    alert(e.message);
  }
}



// Crea un botón "Inventario" al lado del tab de Productos si no existe
(function injectInventoryButton(){
  const anchor = document.getElementById('tab-products');
  if (!anchor) return;
  const btn = document.getElementById('tab-inventory') || document.createElement('button');
  btn.id = 'tab-inventory';
  btn.className = 'btn ghost';
  btn.textContent = 'Inventario';
  btn.style.marginLeft = '6px';
  if (!btn.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
  btn.addEventListener('click', openInventoryPopup);
})();
