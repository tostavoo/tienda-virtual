// server.js
const express = require('express');
const reportesRoutes = require('./src/routes/reportesRoutes');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

dotenv.config();
const app = express();
const prisma = new PrismaClient();

// =====================
// Middleware base
// =====================
app.use(express.json());

// --- CORS con allowList ---
const allowList = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (allowList.includes('*') || !origin || allowList.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: false
}));

// =====================
// Helpers
// =====================
const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '2h' });

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

async function makeUniqueSlug(base) {
  let s = slugify(base) || 'producto';
  let candidate = s;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.product.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
    i++;
    candidate = `${s}-${i}`;
  }
}

// =====================
// Salud
// =====================
app.get('/', (_, res) => res.send('API OK 🚀'));

// =====================
// Auth básica
// =====================
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email y password son obligatorios' });
    }
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

// Helpers de rol
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

// === Me (protegida)
app.get('/api/me', auth, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true }
  });
  res.json(me);
});

// =====================
// Catálogo público
// =====================
// GET /api/products con filtros
// ?search=...&category=slug-o-nombre&min=20000&max=100000&sort=price_asc|price_desc|newest
app.get('/api/products', async (req, res) => {
  try {
    const { search = '', category = '', min, max, sort } = req.query;

    const where = { active: true };

    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { shortDescription: { contains: String(search) } },
        { category: { name: { contains: String(search) } } },
      ];
    }

    if (category) {
      where.category = {
        OR: [
          { slug: String(category) },
          { name: { contains: String(category) } },
        ],
      };
    }

    const priceCond = {};
    const minInt = Number.parseInt(min, 10);
    const maxInt = Number.parseInt(max, 10);
    if (Number.isFinite(minInt)) priceCond.gte = minInt * 100;
    if (Number.isFinite(maxInt)) priceCond.lte = maxInt * 100;

    where.variants = Object.keys(priceCond).length
      ? { some: { active: true, priceCent: priceCond } }
      : { some: { active: true } };

    const raw = await prisma.product.findMany({
      where,
      include: {
        images:   { orderBy: { sortOrder: 'asc' }, take: 1 },
        variants: { where: { active: true }, orderBy: { priceCent: 'asc' } },
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let products = [...raw];
    if (sort === 'price_asc' || sort === 'price_desc') {
      products.sort((a, b) => {
        const ap = a.variants[0]?.priceCent ?? Number.MAX_SAFE_INTEGER;
        const bp = b.variants[0]?.priceCent ?? Number.MAX_SAFE_INTEGER;
        return sort === 'price_asc' ? ap - bp : bp - ap;
      });
    } else if (sort === 'newest') {
      products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    res.json(products);
  } catch (e) {
    console.error('GET /api/products error:', e);
    res.status(500).json({ error: 'No se pudieron cargar productos' });
  }
});

// (Opcional) categorías para el dropdown del front
app.get('/api/categories', async (_req, res) => {
  try {
    const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(cats);
  } catch {
    res.status(500).json({ error: 'No se pudieron cargar categorías' });
  }
});

// =====================
// Checkout + Órdenes (cliente)
// =====================
app.post('/api/checkout', auth, async (req, res) => {
  try {
    const { items, addressId } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos un item' });
    }

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const taxPct = settings ? Number(settings.taxPercent) : 19;
    const shippingFixedCent = settings ? settings.shippingFixedCent : 0;

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

    const variantIds = items.map(i => Number(i.variantId));
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });
    const mapVar = new Map(variants.map(v => [v.id, v]));

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
            // 👇 NUEVO: guardar costo unitario histórico (para COGS)
            costSnapshotCent: v.costCent ?? 0,
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

app.get('/api/orders', auth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        items: { include: { variant: true, product: true } },
        address: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// =====================
// Admin: Compras
// =====================
app.post('/api/admin/purchases', auth, adminOnly, async (req, res) => {
  try {
    const { supplierId, items, invoiceNumber, notes } = req.body;

    if (!supplierId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'supplierId e items son obligatorios' });
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: Number(supplierId) } });
    if (!supplier) return res.status(400).json({ error: 'Proveedor no existe' });

    const purchase = await prisma.$transaction(async (tx) => {
      let subtotalCent = 0;
      let ivaCent = 0;
      let retefuenteCent = 0; // por ahora no lo calculamos

      const created = await tx.purchase.create({
        data: {
          supplierId: supplier.id,
          invoiceNumber: invoiceNumber || null,
          notes: notes || null,
          subtotalCent: 0,
          ivaCent: 0,
          retefuenteCent: 0,
          totalCent: 0,
        },
      });

      for (const it of items) {
        const variantId = Number(it.variantId);
        const qty = Number(it.qty);
        const unitCostCent = Number(it.unitCostCent);
        const ivaUnitCent = Number(it.ivaUnitCent || 0);

        if (!variantId || qty <= 0 || unitCostCent <= 0) {
          throw new Error('Datos de ítem inválidos');
        }

        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          include: { product: true },
        });
        if (!variant) throw new Error(`Variante ${variantId} no encontrada`);

        const lineSubtotal = unitCostCent * qty;
        subtotalCent += lineSubtotal;
        ivaCent += ivaUnitCent * qty;

        await tx.purchaseItem.create({
          data: {
            purchaseId: created.id,
            productId: variant.productId,
            variantId,
            qty,
            unitCostCent,
            ivaUnitCent,
            lineSubtotalCent: lineSubtotal,
          },
        });

        // ========== Recalcular costo promedio ==========
        const prevStock = variant.stock;
        const prevCost = variant.costCent || 0;

        const newStock = prevStock + qty;
        const newCost = Math.round(
          (prevStock * prevCost + qty * unitCostCent) / newStock
        );

        await tx.productVariant.update({
          where: { id: variantId },
          data: {
            stock: { increment: qty },
            costCent: newCost,
          },
        });
      }

      const totalCent = subtotalCent + ivaCent - retefuenteCent;

      await tx.purchase.update({
        where: { id: created.id },
        data: {
          subtotalCent,
          ivaCent,
          retefuenteCent,
          totalCent,
        },
      });

      return created;
    });

    res.status(201).json({ ok: true, purchaseId: purchase.id });
  } catch (e) {
    console.error('POST /api/admin/purchases', e);
    res.status(400).json({ error: e.message });
  }
});

// =====================
// Admin: Gastos
// =====================
// Crea un gasto suelto (nómina, arriendo, servicios, etc.)
// body: { category, detail?, amountCent, date? (ISO) }
app.post('/api/admin/expenses', auth, adminOnly, async (req, res) => {
  try {
    const { category, detail, amountCent, date } = req.body || {};
    if (!category || !Number.isInteger(amountCent) || amountCent <= 0) {
      return res.status(400).json({ error: 'category y amountCent>0 son requeridos' });
    }

    const exp = await prisma.expense.create({
      data: {
        category,
        detail: detail || null,
        amountCent: Number(amountCent),
        date: date ? new Date(date) : undefined
      }
    });

    res.status(201).json(exp);
  } catch (e) {
    console.error('POST /api/admin/expenses', e);
    res.status(500).json({ error: 'No se pudo crear el gasto' });
  }
});


// =====================
// Admin: Reporte mensual
// =====================
// GET /api/admin/reports/monthly?year=2025&month=9
app.get('/api/admin/reports/monthly', auth, adminOnly, async (req, res) => {
  try {
    const year  = Number(req.query.year);
    const month = Number(req.query.month); // 1..12
    if (!year || !month) return res.status(400).json({ error: 'year y month requeridos' });

    const start = new Date(Date.UTC(year, month - 1, 1, 0,0,0));
    const end   = new Date(Date.UTC(year, month,     1, 0,0,0));

    // Ventas del mes
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        id: true, subtotalCent: true, discountCent: true, taxCent: true, retefuenteCent: true
      }
    });

    const orderIds = orders.map(o => o.id);

    const items = orderIds.length
      ? await prisma.orderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { qty: true, costSnapshotCent: true }
        })
      : [];

    const ventasBase = orders.reduce((s,o)=> s + Math.max(o.subtotalCent - o.discountCent,0), 0);
    const ivaCobrado = orders.reduce((s,o)=> s + (o.taxCent || 0), 0);
    const retefuenteVentas = orders.reduce((s,o)=> s + (o.retefuenteCent || 0), 0);

    const cogs = items.reduce((s,it)=> s + it.qty * it.costSnapshotCent, 0);

    // Gastos del mes
    const gastosAgg = await prisma.expense.aggregate({
      _sum: { amountCent: true },
      where: { date: { gte: start, lt: end } }
    });
    const gastos = gastosAgg._sum.amountCent || 0;

    // Compras del mes (para IVA descontable)
    const comprasAgg = await prisma.purchase.aggregate({
      _sum: { ivaCent: true },
      where: { createdAt: { gte: start, lt: end } }
    });
    const ivaDescontable = comprasAgg._sum.ivaCent || 0;

    const utilidadBruta = ventasBase - cogs;
    const utilidadNeta  = utilidadBruta - gastos;
    const ivaPorPagar   = ivaCobrado - ivaDescontable;

    res.json({
      period: { year, month },
      ventasBase, ivaCobrado,
      cogs, utilidadBruta,
      gastos, utilidadNeta,
      ivaDescontable,
      ivaPorPagar,
      retefuenteVentas
    });
  } catch (e) {
    console.error('GET /api/admin/reports/monthly', e);
    res.status(500).json({ error: 'No se pudo generar el reporte' });
  }
});

// =====================
// Admin: Órdenes
// =====================
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

// =====================
// Admin: Productos
// =====================

// Listar TODOS los productos (incluye inactivos)
app.get('/api/admin/products', auth, adminOnly, async (req, res) => {
  try {
    const items = await prisma.product.findMany({
      include: {
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { variants: true } },
      },
      orderBy: { id: 'desc' },
    });
    res.json(items);
  } catch (e) {
    console.error('GET /api/admin/products', e);
    res.status(500).json({ error: 'No se pudieron listar productos' });
  }
});

// Crear producto básico
// body: { categoryId, name, slug?, shortDescription?, active? }
app.post('/api/admin/products', auth, adminOnly, async (req, res) => {
  try {
    const { categoryId, name, slug, shortDescription, active } = req.body || {};
    const catId = Number(categoryId);

    if (!catId || !name) {
      return res.status(400).json({ error: 'categoryId y name son obligatorios' });
    }

    const cat = await prisma.category.findUnique({ where: { id: catId } });
    if (!cat) return res.status(400).json({ error: 'Categoría no existe' });

    let finalSlug = slug ? slugify(slug) : await makeUniqueSlug(name);
    if (!finalSlug) finalSlug = await makeUniqueSlug(name);

    const exists = await prisma.product.findUnique({ where: { slug: finalSlug } });
    if (exists) finalSlug = await makeUniqueSlug(finalSlug);

    const created = await prisma.product.create({
      data: {
        categoryId: catId,
        name,
        slug: finalSlug,
        shortDescription: shortDescription || null,
        active: typeof active === 'boolean' ? active : true,
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { variants: true } },
        images: true,
        variants: true,
      },
    });

    res.status(201).json(created);
  } catch (e) {
    console.error('POST /api/admin/products', e);
    if (e && e.code === 'P2002') {
      return res.status(409).json({ error: 'Slug ya existe' });
    }
    res.status(500).json({ error: 'No se pudo crear el producto' });
  }
});

// Actualizar producto (campos básicos)
app.put('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, slug, shortDescription, categoryId, active } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim();
    if (typeof shortDescription === 'string') data.shortDescription = shortDescription || null;
    if (typeof active === 'boolean') data.active = active;

    if (categoryId) {
      const catId = Number(categoryId);
      const cat = await prisma.category.findUnique({ where: { id: catId } });
      if (!cat) return res.status(400).json({ error: 'Categoría no existe' });
      data.categoryId = catId;
    }

    if (typeof slug === 'string' && slug.trim()) {
      const s = slugify(slug);
      if (!s) return res.status(400).json({ error: 'Slug inválido' });
      const exists = await prisma.product.findUnique({ where: { slug: s } });
      if (exists && exists.id !== id) {
        return res.status(409).json({ error: 'Slug ya está en uso' });
      }
      data.slug = s;
    }

    const updated = await prisma.product.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { variants: true } },
        images: true,
        variants: true,
      },
    });

    res.json(updated);
  } catch (e) {
    console.error('PUT /api/admin/products/:id', e);
    if (e && e.code === 'P2025') {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el producto' });
  }
});

// Activar/Desactivar rápido
app.put('/api/admin/products/:id/active', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { active } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active debe ser boolean' });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { active },
      select: { id: true, name: true, active: true },
    });

    res.json(updated);
  } catch (e) {
    console.error('PUT /api/admin/products/:id/active', e);
    if (e && e.code === 'P2025') {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el estado' });
  }
});

// 🔸 NUEVO: Eliminar producto
app.delete('/api/admin/products/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    // variantes del producto
    const variantIds = (await prisma.productVariant.findMany({
      where: { productId: id },
      select: { id: true }
    })).map(v => v.id);

    // si ya tiene ventas, no dejar borrar
    if (variantIds.length) {
      const used = await prisma.orderItem.count({ where: { variantId: { in: variantIds } } });
      if (used > 0) return res.status(409).json({ error: 'No se puede eliminar: el producto ya tiene ventas' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId: id } });
      await tx.productVariant.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/admin/products/:id', e);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

// =====================
// Admin: VARIANTES
// =====================

// Listar variantes de un producto
app.get('/api/admin/products/:id/variants', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const variants = await prisma.productVariant.findMany({
      where: { productId: id },
      orderBy: { id: 'asc' }
    });
    res.json(variants);
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron listar variantes' });
  }
});

// Crear variante
// body: { sku?, color?, size?, priceCent (int), stock (int), active? }
app.post('/api/admin/products/:id/variants', auth, adminOnly, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const { sku, color, size, priceCent, stock, active } = req.body || {};

    if (!Number.isInteger(priceCent) || priceCent <= 0)
      return res.status(400).json({ error: 'priceCent inválido' });
    if (!Number.isInteger(stock) || stock < 0)
      return res.status(400).json({ error: 'stock inválido' });

    const created = await prisma.productVariant.create({
      data: {
        productId,
        sku: sku || null,
        color: color || null,
        size: size || null,
        priceCent,
        stock,
        active: typeof active === 'boolean' ? active : true
      }
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear la variante' });
  }
});

// Actualizar variante
// body: { sku?, color?, size?, priceCent?, stock?, active? }
app.put('/api/admin/variants/:variantId', auth, adminOnly, async (req, res) => {
  try {
    const variantId = Number(req.params.variantId);
    const { sku, color, size, priceCent, stock, active } = req.body || {};
    const data = {};
    if (sku !== undefined)   data.sku = sku || null;
    if (color !== undefined) data.color = color || null;
    if (size !== undefined)  data.size = size || null;
    if (priceCent !== undefined) {
      if (!Number.isInteger(priceCent) || priceCent <= 0)
        return res.status(400).json({ error: 'priceCent inválido' });
      data.priceCent = priceCent;
    }
    if (stock !== undefined) {
      if (!Number.isInteger(stock) || stock < 0)
        return res.status(400).json({ error: 'stock inválido' });
      data.stock = stock;
    }
    if (typeof active === 'boolean') data.active = active;

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo actualizar la variante' });
  }
});


// =====================
// Admin: Inventario (listado de variantes con stock/costos/precios)
// =====================
app.get('/api/admin/inventory', auth, adminOnly, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const where = q
      ? {
          OR: [
            { sku:   { contains: q } },
            { color: { contains: q } },
            { size:  { contains: q } },
            { product: { name: { contains: q } } },
          ],
        }
      : {};

    const variants = await prisma.productVariant.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, category: { select: { name: true } } } },
      },
      orderBy: [{ productId: 'asc' }, { id: 'asc' }],
    });

    const items = variants.map(v => {
      const cost  = v.costCent ?? 0;
      const price = v.priceCent ?? 0;
      const profit = price - cost;
      const marginPct = price > 0 ? Math.round((profit / price) * 1000) / 10 : 0; // 1 decimal
      return {
        productId: v.productId,
        variantId: v.id,
        product: v.product?.name || '',
        category: v.product?.category?.name || null,
        sku: v.sku,
        color: v.color,
        size: v.size,
        stock: v.stock,
        active: v.active,
        costCent: cost,
        priceCent: price,
        profitCent: profit,
        marginPct,
        stockValueCostCent: cost  * v.stock,
        stockValueSaleCent: price * v.stock,
      };
    });

    res.json(items);
  } catch (e) {
    console.error('GET /api/admin/inventory', e);
    res.status(500).json({ error: 'No se pudo cargar el inventario' });
  }
});


// =====================
// Admin: IMÁGENES
// =====================

// Listar imágenes de un producto
app.get('/api/admin/products/:id/images', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const imgs = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' }
    });
    res.json(imgs);
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron listar imágenes' });
  }
});

// Crear imagen
// body: { url (string), sortOrder? (int) }
app.post('/api/admin/products/:id/images', auth, adminOnly, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const { url, sortOrder } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url requerida' });

    const created = await prisma.productImage.create({
      data: {
        productId,
        url,
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0
      }
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear la imagen' });
  }
});

// 🔸 NUEVO: Actualizar imagen (url y/o sortOrder)
app.put('/api/admin/images/:imageId', auth, adminOnly, async (req, res) => {
  try {
    const imageId = Number(req.params.imageId);
    const { url, sortOrder } = req.body || {};
    const data = {};
    if (typeof url === 'string' && url.trim()) data.url = url.trim();
    if (Number.isInteger(sortOrder)) data.sortOrder = sortOrder;

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Nada para actualizar' });
    }

    const updated = await prisma.productImage.update({
      where: { id: imageId },
      data
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /api/admin/images/:imageId', e);
    if (e && e.code === 'P2025') return res.status(404).json({ error: 'Imagen no encontrada' });
    res.status(500).json({ error: 'No se pudo actualizar la imagen' });
  }
});

// Eliminar imagen
app.delete('/api/admin/images/:imageId', auth, adminOnly, async (req, res) => {
  try {
    const imageId = Number(req.params.imageId);
    await prisma.productImage.delete({ where: { id: imageId } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo eliminar la imagen' });
  }
});

// =====================
// Rutas DEV (solo para pruebas con Thunder) ⚠️
// =====================
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  // Crear proveedor rápido
  app.post('/api/dev/suppliers', auth, adminOnly, async (req, res) => {
    try {
      const { name, nit, phone, email } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name requerido' });
      const s = await prisma.supplier.create({
        data: { name, nit: nit || null, phone: phone || null, email: email || null }
      });
      res.status(201).json(s);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Crear dirección por defecto para el usuario autenticado (DEV)
  app.post('/api/dev/addresses', auth, async (req, res) => {
    try {
      const {
        recipient,
        street,
        line1,
        city,
        department,
        state,
        country,
        phone,
        isDefault
      } = req.body || {};

      if (!recipient) return res.status(400).json({ error: 'recipient requerido' });

      // Prisma espera `street` (aceptamos `line1` por compatibilidad)
      const streetVal = (street ?? line1 ?? '').toString().trim();
      if (!streetVal) return res.status(400).json({ error: 'street requerido (puedes enviar line1)' });

      // Prisma espera `department` (aceptamos `state` por compatibilidad)
      const dept = (department ?? state ?? '').toString().trim();
      if (!dept) return res.status(400).json({ error: 'department requerido (puedes enviar state)' });

      if (isDefault) {
        await prisma.address.updateMany({
          where: { userId: req.user.id, isDefault: true },
          data: { isDefault: false }
        });
      }

      const a = await prisma.address.create({
        data: {
          userId: req.user.id,
          recipient: recipient.trim(),
          street: streetVal,
          city: city || null,
          department: dept,
          country: country || null,
          // OJO: NO enviamos postalCode porque tu modelo no lo tiene
          phone: phone || null,   // Si tu modelo no tiene phone, coméntalo
          isDefault: !!isDefault
        }
      });

      res.status(201).json(a);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

// =====================
// Rutas de Reportes (PROTEGIDAS para todo el grupo)
// =====================
app.use('/api/reportes', auth, adminOnly, reportesRoutes);

// =====================
// Escucha
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
