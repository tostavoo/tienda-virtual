// =====================
// Utilidades / Estado
// =====================
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
// Cargar productos API
// =====================
async function cargarProductos() {
  try {
    const res = await fetch("http://localhost:3000/api/products");
    const productos = await res.json();
    if (!$listaProductos) return;
    $listaProductos.innerHTML = "";

    productos.forEach((p) => {
      const v = p.variants?.[0]; // primera variante
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
        addToCart(item);
      });
    });
  } catch (err) {
    console.error("Error cargando productos:", err);
  }
}

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
    const res = await fetch("http://localhost:3000/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error en checkout");

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
    $authUser.textContent = `${user.name} (${user.role})`;
    $authUser.hidden = false;
    $btnLogout.hidden = false;
    $btnLogin.hidden  = true;
    if ($adminLink)  $adminLink.hidden  = user.role !== 'admin';
    if ($ordersLink) $ordersLink.hidden = false;
  } else {
    $authUser.hidden = true;
    $btnLogout.hidden = true;
    $btnLogin.hidden  = false;
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
    const res = await fetch('http://localhost:3000/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciales inválidas');

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
    const res = await fetch('http://localhost:3000/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw 0;
    return await res.json();
  } catch { return null; }
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
    const res = await fetch('http://localhost:3000/api/orders', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los pedidos');
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
  await cargarProductos();

  // Sincronizar auth (si hay token)
  const me = await fetchMe();
  if (me) { setUserInfo(me); setAuthUI(me); }
  else     { clearToken(); setUserInfo(null); setAuthUI(null); }
})();
