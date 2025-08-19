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

// ===== DOM
const $guard   = document.getElementById("admin-guard");
const $content = document.getElementById("admin-content");
const $tbody   = document.getElementById("admin-orders-body");
const $stats   = document.getElementById("admin-stats");

const $status  = document.getElementById("f-status");
const $q       = document.getElementById("f-q");
const $apply   = document.getElementById("f-apply");
const $clear   = document.getElementById("f-clear");

const $adminUser   = document.getElementById("admin-user");
const $adminLogout = document.getElementById("admin-logout");

// ===== Guard de admin
async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch("http://localhost:3000/api/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me || me.role !== "admin") {
    $guard.textContent = "No tienes permisos de administrador.";
    setTimeout(() => { window.location.href = "index.html"; }, 1200);
    return null;
  }
  setUser(me);
  $adminUser.hidden = false;
  $adminUser.textContent = `${me.name} (admin)`;
  $adminLogout.hidden = false;

  $guard.hidden = true;
  $content.hidden = false;
  return me;
}

// ===== Cargar pedidos (admin)
async function loadOrdersAdmin() {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch("http://localhost:3000/api/admin/orders", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo cargar pedidos");

    return Array.isArray(data) ? data : [];
  } catch (e) {
    alert(e.message);
    return [];
  }
}

// ===== Render
function renderStats(orders) {
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

    // Selector estado
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

  // Listeners para actualizar estado
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
    const res = await fetch(`http://localhost:3000/api/admin/orders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo actualizar");
    alert(`Pedido #${id} ahora está en estado "${status}"`);
    await applyFilters(); // recargar vista
  } catch (e) {
    alert(e.message);
  }
}

// ===== Filtros (cliente/email + estado)
let _allOrdersCache = [];

function applyLocalFilters(orders) {
  const st = $status.value.trim();
  const q  = $q.value.trim().toLowerCase();
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

$apply?.addEventListener("click", async ()=>{
  if (!_allOrdersCache.length) _allOrdersCache = await loadOrdersAdmin();
  const filtered = applyLocalFilters(_allOrdersCache);
  renderStats(filtered);
  renderOrdersAdmin(filtered);
});

$clear?.addEventListener("click", async ()=>{
  $status.value = "";
  $q.value = "";
  await applyFilters();
});

// ===== Logout
$adminLogout?.addEventListener("click", ()=>{
  clearAuth();
  window.location.href = "index.html";
});

// ===== Init
(async function initAdmin(){
  const me = await ensureAdmin(); // verifica rol=admin
  if (!me) return;

  _allOrdersCache = await loadOrdersAdmin();
  await applyFilters();
})();
