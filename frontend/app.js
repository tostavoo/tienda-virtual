// =====================
// Config / Utilidades
// =====================
const API_BASE = 'http://localhost:4000/api';
const api = (p) => `${API_BASE}${p}`;

const fmtCOP = (n) =>
  Number(n || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const STORAGE_CART_KEY = "CART_V1";
const STORAGE_THEME_KEY = "THEME";

let cart = [];            // [{ name, price, variantId, qty }]
let lastFocus = null;

// Helpers de red robustos
async function parseJsonOrThrow(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — respuesta no JSON: ${txt.slice(0,120)}`);
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function getJSON(path, opts={}) {
  const res = await fetch(api(path), opts);
  return parseJsonOrThrow(res);
}

// =====================
// Referencias DOM
// =====================
// Header / generales
const $themeToggle = document.getElementById("theme-toggle");
const $btnCart     = document.getElementById("btn-cart");
const $panel       = document.getElementById("cart-panel");
const $closeCart   = document.getElementById("close-cart");

// Carrito
const $count    = document.getElementById("cart-count");
const $items    = document.getElementById("cart-items");
const $subtotal = document.getElementById("cart-subtotal");
const $iva      = document.getElementById("cart-iva");
const $total    = document.getElementById("cart-total");
const $checkout = document.querySelector(".checkout");

// Productos
const $listaProductos = document.querySelector(".productos");

// Auth
const $btnLogin    = document.getElementById("btn-login");
const $btnLogout   = document.getElementById("btn-logout");
const $authUser    = document.getElementById("auth-user");
const $adminLink   = document.getElementById("admin-link");

// Login modal
const $loginBox    = document.getElementById("login-box");
const $loginForm   = document.getElementById("login-form");
const $loginEmail  = document.getElementById("login-email");
const $loginPass   = document.getElementById("login-pass");
const $loginCancel = document.getElementById("login-cancel");

// Mis pedidos
const $ordersLink  = document.getElementById("orders-link");
const $ordersSec   = document.getElementById("orders-section");
const $ordersEmpty = document.getElementById("orders-empty");
const $ordersBody  = document.getElementById("orders-body");

// ===== Filtros catálogo (UI)
const $fSearch   = document.getElementById('f-search');
const $fCategory = document.getElementById('f-category');
const $fMin      = document.getElementById('f-min');
const $fMax      = document.getElementById('f-max');
const $fSort     = document.getElementById('f-sort');
const $fApply    = document.getElementById('f-apply');
const $fClear    = document.getElementById('f-clear');

// =====================
// Persistencia carrito
// =====================
function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_CART_KEY);
    cart = raw ? JSON.parse(raw) : [];
  } catch {
    cart = [];
  }
}
function saveCart() {
  localStorage.setItem(STORAGE_CART_KEY, JSON.stringify(cart));
}

// =====================
// Tema
// =====================
function applyTheme(theme) {
  document.body.classList.remove("light", "dark");
  const t = theme === "dark" ? "dark" : "light";
  document.body.classList.add(t);
}
function loadTheme() {
  const saved = localStorage.getItem(STORAGE_THEME_KEY);
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    const prefersDark = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
}
function toggleTheme() {
  const isDark = document.body.classList.contains("dark");
  const next = isDark ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(STORAGE_THEME_KEY, next);
}
$themeToggle?.addEventListener("click", toggleTheme);

// =====================
// Panel Carrito (UI)
// =====================
function openCart() {
  lastFocus = document.activeElement;
  document.body.classList.add("noscroll");
  $panel?.classList.add("open");
  $panel?.setAttribute("aria-hidden", "false");
  $closeCart?.focus();
}
function closeCart() {
  $panel?.classList.remove("open");
  $panel?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("noscroll");
  if (lastFocus) lastFocus.focus();
}
$btnCart?.addEventListener("click", openCart);
$closeCart?.addEventListener("click", closeCart);

// Esc / trampa de foco
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $panel?.classList.contains("open")) closeCart();

  if (e.key === "Tab" && $panel?.classList.contains("open")) {
    const focusables = $panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus(); e.preventDefault();
    }
  }
});

// =====================
// Carrito (lógica)
// =====================
function addToCart(item) {
  const found = cart.find((p) => p.variantId === item.variantId);
  if (found) found.qty++;
  else cart.push({ ...item, qty: 1 });
  renderCart();
  saveCart();
  openCart();
}

function removeOne(variantId) {
  const i = cart.findIndex((p) => p.variantId === variantId);
  if (i > -1) {
    cart[i].qty--;
    if (cart[i].qty <= 0) cart.splice(i, 1);
    renderCart();
    saveCart();
  }
}

function addOne(variantId) {
  const it = cart.find((p) => p.variantId === variantId);
  if (it) {
    it.qty++;
    renderCart();
    saveCart();
  }
}

// Render carrito con IVA 19%
function renderCart() {
  const totalQty = cart.reduce((acc, it) => acc + it.qty, 0);
  if ($count) $count.textContent = totalQty;

  if ($items) $items.innerHTML = "";
  cart.forEach((it) => {
    const li = document.createElement("li");
    li.className = "cart-row";
    li.dataset.variant = String(it.variantId);
    li.innerHTML = `
      <span>${it.qty}× ${it.name}</span>
      <span>${fmtCOP(it.price * it.qty)}</span>
      <div class="qty-controls">
        <button class="rm" title="Quitar uno" type="button" aria-label="Quitar uno">−</button>
        <button class="add" title="Agregar uno" type="button" aria-label="Agregar uno">+</button>
      </div>
    `;
    li.querySelector(".rm").addEventListener("click", () => removeOne(it.variantId));
    li.querySelector(".add").addEventListener("click", () => addOne(it.variantId));
    $items?.appendChild(li);
  });

  const sum = cart.reduce((acc, it) => acc + it.price * it.qty, 0);
  const IVA_PCT = 0.19;
  const iva   = Math.round(sum * IVA_PCT);
  const total = sum + iva;

  if ($subtotal) $subtotal.textContent = fmtCOP(sum);
  if ($iva)      $iva.textContent = fmtCOP(iva);
  if ($total)    $total.textContent = fmtCOP(total);

  if ($checkout) $checkout.disabled = cart.length === 0;
}

// =====================
// Filtros catálogo
// =====================
function buildProductQuery() {
  const params = new URLSearchParams();
  const s  = ($fSearch?.value || '').trim();
  const c  = ($fCategory?.value || '').trim();
  const mi = Number.parseInt($fMin?.value || '', 10);
  const ma = Number.parseInt($fMax?.value || '', 10);
  const so = ($fSort?.value || '').trim();

  if (s)  params.set('search', s);
  if (c)  params.set('category', c);
  if (!Number.isNaN(mi) && mi >= 0) params.set('min', String(mi));
  if (!Number.isNaN(ma) && ma >= 0) params.set('max', String(ma));
  if (so) params.set('sort', so);

  return params.toString();
}

async function cargarCategorias() {
  try {
    const cats = await getJSON('/categories');
    if (!$fCategory) return;
    $fCategory.innerHTML =
      '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${c.slug}">${c.name}</option>`).join('');
  } catch { /* noop */ }
}

// =====================
// Cargar productos API
// =====================
async function cargarProductos() {
  try {
    const qs = buildProductQuery();
    const path = qs ? `/products?${qs}` : '/products';
    const productos = await getJSON(path);

    if (!$listaProductos) return;
    $listaProductos.innerHTML = "";

    productos.forEach((p) => {
      const v = p.variants?.[0]; // primera variante (más barata)
      const img = p.images?.[0]?.url || "img/placeholder.jpg";
      const priceCent  = v?.priceCent ?? 0;
      const pricePesos = Math.round(priceCent / 100); // centavos -> pesos

      const card = document.createElement("article");
      card.className = "producto";
      card.dataset.name    = p.name;
      card.dataset.price   = String(pricePesos);
      card.dataset.variant = String(v?.id || 0);

      card.innerHTML = `
        <img src="${img}" alt="${p.name}" width="200" height="200" loading="lazy">
        <h3>${p.name}</h3>
        <p class="price">${fmtCOP(pricePesos)}</p>
        <button type="button" class="add-to-cart">Añadir al carrito</button>
      `;
      $listaProductos.appendChild(card);
    });

    // Conectar eventos de añadir al carrito
    $listaProductos.querySelectorAll(".add-to-cart").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const card = e.currentTarget.closest(".producto");
        const item = {
          name: card.dataset.name,
          price: parseInt(card.dataset.price, 10) || 0,
          variantId: parseInt(card.dataset.variant, 10) || 0,
        };
        if (!item.variantId) {
          alert('Este producto no tiene variante disponible.');
          return;
        }
        addToCart(item);
      });
    });
  } catch (err) {
    console.error("Error cargando productos:", err);
  }
}

// Botones de filtros
$fApply?.addEventListener('click', () => cargarProductos());
$fClear?.addEventListener('click', () => {
  if ($fSearch)   $fSearch.value = '';
  if ($fCategory) $fCategory.value = '';
  if ($fMin)      $fMin.value = '';
  if ($fMax)      $fMax.value = '';
  if ($fSort)     $fSort.value = '';
  cargarProductos();
});

// =====================
// Checkout
// =====================
$checkout?.addEventListener("click", checkoutDesdeCarrito);

async function checkoutDesdeCarrito() {
  const token = getToken();
  if (!token) {
    // abrir login si no hay sesión
    window.__deferredCheckout = true;
    openLogin();
    return;
  }

  const items = cart.map((i) => ({ variantId: i.variantId, qty: i.qty }));
  if (items.length === 0) { alert("Carrito vacío"); return; }

  try {
    // Intento 1: API nueva
    let data;
    try {
      data = await getJSON('/orders', {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items })
      });
    } catch (e1) {
      // Fallback: API antigua
      data = await getJSON('/checkout', {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items })
      });
    }

    alert(
      `Pedido #${data.orderId} creado.\n` +
      `Subtotal: ${fmtCOP(Math.round(data.totals.subtotalCent/100))}\n` +
      `IVA: ${fmtCOP(Math.round(data.totals.taxCent/100))}\n` +
      `Envío: ${fmtCOP(Math.round(data.totals.shippingCent/100))}\n` +
      `Total: ${fmtCOP(Math.round(data.totals.totalCent/100))}`
    );

    cart = [];
    saveCart();
    renderCart();
    closeCart();
  } catch (err) {
    console.error(err);
    alert("No se pudo completar el checkout: " + err.message);
  }
}

// =====================
// Auth (login/logout)
// =====================
function getToken(){ return localStorage.getItem('token'); }
function setToken(t){ localStorage.setItem('token', t); }
function clearToken(){ localStorage.removeItem('token'); }

function setUserInfo(u){
  if (u) localStorage.setItem('user', JSON.stringify({ id:u.id, name:u.name, email:u.email, role:u.role }));
  else   localStorage.removeItem('user');
}
function getUserInfo(){
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch { return null; }
}

function setAuthUI(user){
  if (user) {
    if ($authUser) {
      $authUser.textContent = `${user.name} (${user.role})`;
      $authUser.hidden = false;
    }
    if ($btnLogout) $btnLogout.hidden = false;
    if ($btnLogin)  $btnLogin.hidden  = true;
    if ($adminLink)  $adminLink.hidden  = user.role !== 'admin';
    if ($ordersLink) $ordersLink.hidden = false;
  } else {
    if ($authUser)  $authUser.hidden = true;
    if ($btnLogout) $btnLogout.hidden = true;
    if ($btnLogin)  $btnLogin.hidden  = false;
    if ($adminLink)  $adminLink.hidden  = true;
    if ($ordersLink) $ordersLink.hidden = true;
  }
}

function openLogin(){ if ($loginBox) $loginBox.hidden = false; }
function closeLogin(){ if ($loginBox) { $loginBox.hidden = true; $loginForm?.reset(); } }

$btnLogin?.addEventListener('click', openLogin);
$loginCancel?.addEventListener('click', closeLogin);

$loginForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  try {
    const email = $loginEmail.value.trim();
    const password = $loginPass.value;

    // Intento 1: /auth/login
    let data;
    try {
      data = await getJSON('/auth/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
    } catch (e1) {
      // Fallback: /login
      data = await getJSON('/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
    }

    setToken(data.token);
    setUserInfo(data.user);
    setAuthUI(data.user);
    closeLogin();
    if (window.__deferredCheckout) {
      window.__deferredCheckout = false;
      checkoutDesdeCarrito();
    } else {
      alert('Sesión iniciada');
    }
  } catch (err) {
    alert(err.message);
  }
});

$btnLogout?.addEventListener('click', ()=>{
  clearToken();
  setUserInfo(null);
  setAuthUI(null);
  alert('Sesión cerrada');
});

async function fetchMe(){
  const token = getToken();
  if (!token) return null;
  try {
    try {
      // Preferente API nueva
      return await getJSON('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    } catch (e1) {
      // Fallback API antigua
      return await getJSON('/me', { headers: { Authorization: `Bearer ${token}` } });
    }
  } catch {
    return null;
  }
}

// =====================
// Mis pedidos (UI)
// =====================
$ordersLink?.addEventListener('click', async (e) => {
  e.preventDefault();
  await loadMyOrders();
  if ($ordersSec) {
    $ordersSec.hidden = false;
    $ordersSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

async function loadMyOrders() {
  const token = getToken();
  if (!token) { openLogin(); return; }

  try {
    let data;
    try {
      data = await getJSON('/orders/mine', { headers: { Authorization: `Bearer ${token}` } });
    } catch (e1) {
      data = await getJSON('/orders', { headers: { Authorization: `Bearer ${token}` } });
    }
    renderOrders(data);
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

function renderOrders(orders) {
  if (!$ordersBody || !$ordersEmpty) return;

  if (!Array.isArray(orders) || orders.length === 0) {
    $ordersBody.innerHTML = '';
    $ordersEmpty.hidden = false;
    return;
  }
  $ordersEmpty.hidden = true;

  const rows = orders.map(o => {
    const fecha = new Date(o.createdAt);
    const fechaStr = fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    const totalPesos = Math.round(o.totalCent / 100);

    const itemsStr = (o.items || []).map(it => {
      const lineTotal = Math.round(it.lineTotalCent / 100);
      return `<span class="item">• ${it.qty} × ${it.nameSnapshot}${it.sizeSnapshot ? ' ('+it.sizeSnapshot+')' : ''}${it.colorSnapshot ? ' - '+it.colorSnapshot : ''} — ${fmtCOP(lineTotal)}</span>`;
    }).join('');

    return `
      <tr>
        <td>#${o.id}</td>
        <td>${fechaStr}</td>
        <td>${o.status}</td>
        <td>${itemsStr || '-'}</td>
        <td><strong>${fmtCOP(totalPesos)}</strong></td>
      </tr>
    `;
  }).join('');

  $ordersBody.innerHTML = rows;
}

// =====================
// Init
// =====================
(async function init() {
  loadTheme();
  loadCart();
  renderCart();

  await cargarCategorias();  // llena dropdown
  await cargarProductos();   // respeta filtros actuales (si hay)

  // Sincronizar auth (si hay token)
  const me = await fetchMe();
  if (me) { setUserInfo(me); setAuthUI(me); }
  else     { clearToken(); setUserInfo(null); setAuthUI(null); }
})();
