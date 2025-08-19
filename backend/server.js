// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

dotenv.config();
const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '2h' });

app.get('/', (_, res) => res.send('API OK 🚀'));

// Registro
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email ya registrado' });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hash, phone, role: 'cliente' }
    });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- middleware de auth con JWT ---
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role, email }
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// --- ruta protegida ---
app.get('/api/me', auth, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true }
  });
  res.json(me);
});

// Productos
app.get('/api/products', async (req, res) => {
  try {
    const { search, category, min, max } = req.query;
    const where = {
      active: true,
      ...(category ? { category: { slug: String(category) } } : {}),
      ...(search ? {
        OR: [
          { name: { contains: String(search), mode: 'insensitive' } },
          { shortDescription: { contains: String(search), mode: 'insensitive' } },
        ]
      } : {}),
      ...(min || max ? {
        variants: {
          some: {
            AND: [
              min ? { priceCent: { gte: Number(min) } } : {},
              max ? { priceCent: { lte: Number(max) } } : {},
            ]
          }
        }
      } : {})
    };

    const products = await prisma.product.findMany({
      where,
      include: { category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json(products);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));

// ===== Helpers de rol =====
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

// ====== CHECKOUT (crear pedido) ======
// Espera body: { items: [{ variantId, qty }...], addressId?: number }
app.post('/api/checkout', auth, async (req, res) => {
  try {
    const { items, addressId } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos un item' });
    }

    // 1) Settings (IVA y envío fijo)
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const taxPct = settings ? Number(settings.taxPercent) : 19;
    const shippingFixedCent = settings ? settings.shippingFixedCent : 0;

    // 2) Dirección del usuario (si no mandan addressId, intenta usar la default)
    let address;
    if (addressId) {
      address = await prisma.address.findFirst({
        where: { id: Number(addressId), userId: req.user.id },
      });
      if (!address) return res.status(400).json({ error: 'Dirección inválida' });
    } else {
      address = await prisma.address.findFirst({
        where: { userId: req.user.id, isDefault: true },
      });
      if (!address) return res.status(400).json({ error: 'No tienes dirección. Crea una primero.' });
    }

    // 3) Traer variantes y productos para validar stock y precios
    const variantIds = items.map(i => Number(i.variantId));
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });

    // Mapear por id para buscar rápido
    const mapVar = new Map(variants.map(v => [v.id, v]));

    // 4) Calcular totales en centavos y validar stock
    let subtotalCent = 0;
    let discountCent = 0;

    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const v = mapVar.get(Number(it.variantId));
      if (!v) return res.status(400).json({ error: `Variante ${it.variantId} no existe` });
      if (qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
      if (!v.active || v.stock < qty) {
        return res.status(400).json({ error: `Sin stock suficiente para variante ${v.id}` });
      }

      const base = v.priceCent * qty;
      const pct = v.product.discountPercent ? Number(v.product.discountPercent) : 0;
      const disc = Math.round(base * (pct / 100));

      subtotalCent += base;
      discountCent += disc;
    }

    const taxableCent = Math.max(subtotalCent - discountCent, 0);
    const taxCent = Math.round(taxableCent * (taxPct / 100));
    const shippingCent = shippingFixedCent;
    const totalCent = taxableCent + taxCent + shippingCent;

    // 5) Transacción: crear Order + OrderItems y descontar stock
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: req.user.id,
          addressId: address.id,
          status: 'pendiente',
          subtotalCent,
          discountCent,
          taxCent,
          shippingCent,
          totalCent,
        },
      });

      // Items del pedido + update de stock
      for (const it of items) {
        const qty = Number(it.qty);
        const v = mapVar.get(Number(it.variantId));
        const pct = v.product.discountPercent ? Number(v.product.discountPercent) : 0;
        const unit = v.priceCent;
        const disc = Math.round(unit * (pct / 100));
        const lineUnit = unit - disc;
        const lineTotal = lineUnit * qty;

        await tx.orderItem.create({
          data: {
            orderId: created.id,
            productId: v.productId,
            variantId: v.id,
            nameSnapshot: v.product.name,
            colorSnapshot: v.color || null,
            sizeSnapshot: v.size || null,
            qty,
            unitPriceCent: unit,
            lineTotalCent: lineTotal,
          },
        });

        await tx.productVariant.update({
          where: { id: v.id },
          data: { stock: { decrement: qty } },
        });
      }

      return created;
    });

    res.json({ ok: true, orderId: order.id, totals: { subtotalCent, discountCent, taxCent, shippingCent, totalCent } });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// ====== Mis pedidos (usuario) ======
app.get('/api/orders', auth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        items: {
          include: { variant: true, product: true },
        },
        address: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ====== Admin: listar todos los pedidos ======
app.get('/api/admin/orders', auth, adminOnly, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        items: { include: { variant: true, product: true } },
        address: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ====== Admin: cambiar estado de pedido ======
// body: { status: "pendiente" | "enviado" | "entregado" }
app.patch('/api/admin/orders/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const valid = ['pendiente', 'enviado', 'entregado'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

    const updated = await prisma.order.update({
      where: { id },
      data: { status },
    });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
