const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===== Helpers =====
function parseDateOnly(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}
function rangeFromQuery(q) {
  const desde = parseDateOnly(q.desde);
  const hasta = parseDateOnly(q.hasta);
  let hastaEnd = null;
  if (hasta) hastaEnd = new Date(hasta.getTime() + (23*3600+59*60+59)*1000);
  return { desde, hasta: hastaEnd };
}
const toCOP = n => Math.round((n || 0) * 100) / 100;

// ===== GET /api/reportes/kpis =====
// Ventas totales, N° órdenes, ticket promedio y top productos por cantidad
exports.getKpis = async (req, res) => {
  try {
    const { desde, hasta } = rangeFromQuery(req.query);
    const whereOrders = {};
    if (desde || hasta) whereOrders.createdAt = {};
    if (desde) whereOrders.createdAt.gte = desde;
    if (hasta) whereOrders.createdAt.lte = hasta;

    // Órdenes en rango (status no filtrado; si tienes canceladas agrega where: { status: { in: [...] } })
    const orders = await prisma.order.findMany({
      where: whereOrders,
      select: { id: true, totalCent: true }
    });
    const boletas = orders.length;
    const ventas_totales_cent = orders.reduce((s, o) => s + (o.totalCent || 0), 0);
    const ticket_promedio_cent = boletas ? ventas_totales_cent / boletas : 0;

    // Ítems para top productos
    const orderIds = orders.map(o => o.id);
    const items = orderIds.length
      ? await prisma.orderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { productId: true, qty: true, lineTotalCent: true, product: { select: { name: true } } }
        })
      : [];

    const map = new Map();
    for (const it of items) {
      const key = it.productId;
      const prev = map.get(key) || { producto_id: key, nombre: it.product?.name || `Producto ${key}`, cantidad: 0, ingreso_cent: 0 };
      prev.cantidad += it.qty;
      prev.ingreso_cent += it.lineTotalCent || 0;
      map.set(key, prev);
    }
    const top5_productos = Array.from(map.values())
      .sort((a,b) => b.cantidad - a.cantidad)
      .slice(0, 5)
      .map(p => ({ producto_id: p.producto_id, nombre: p.nombre, cantidad: p.cantidad, ingreso: toCOP((p.ingreso_cent||0)/100) }));

    return res.json({
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
      ventas_totales: toCOP(ventas_totales_cent / 100),
      boletas,
      ticket_promedio: toCOP(ticket_promedio_cent / 100),
      top5_productos
    });
  } catch (err) {
    console.error('getKpis error:', err);
    return res.status(500).json({ error: 'Error en KPIs' });
  }
};

// ===== GET /api/reportes/estado-resultados =====
// Ingresos (base + impuestos si quieres), COGS desde costSnapshotCent, utilidad
exports.getEstadoResultados = async (req, res) => {
  try {
    const { desde, hasta } = rangeFromQuery(req.query);
    const whereOrders = {};
    if (desde || hasta) whereOrders.createdAt = {};
    if (desde) whereOrders.createdAt.gte = desde;
    if (hasta) whereOrders.createdAt.lte = hasta;

    // Ingresos: puedes usar totalCent o base (subtotal - discount) + impuestos/ envío según tu criterio contable
    const orders = await prisma.order.findMany({
      where: whereOrders,
      select: { id: true, subtotalCent: true, discountCent: true, taxCent: true, shippingCent: true, totalCent: true }
    });

    // Aquí tomamos ingresos = total facturado (totalCent). Cambia si prefieres base sin envío.
    const ingresos_cent = orders.reduce((s,o)=> s + (o.totalCent || 0), 0);

    const orderIds = orders.map(o => o.id);
    const items = orderIds.length
      ? await prisma.orderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { qty: true, costSnapshotCent: true }
        })
      : [];

    const cogs_cent = items.reduce((s,it)=> s + (it.qty * (it.costSnapshotCent || 0)), 0);

    const utilidad_bruta_cent = ingresos_cent - cogs_cent;
    const impuestos_cent = 0; // si quieres restar algo adicional aquí
    const utilidad_neta_cent = utilidad_bruta_cent - impuestos_cent;

    return res.json({
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
      ingresos: toCOP(ingresos_cent / 100),
      costo_ventas: toCOP(cogs_cent / 100),
      utilidad_bruta: toCOP(utilidad_bruta_cent / 100),
      impuestos: toCOP(impuestos_cent / 100),
      utilidad_neta: toCOP(utilidad_neta_cent / 100)
    });
  } catch (err) {
    console.error('getEstadoResultados error:', err);
    return res.status(500).json({ error: 'Error en estado de resultados' });
  }
};

// ===== GET /api/reportes/balance-general =====
// Caja estimada = sum(totalCent) acumulado hasta 'al'
// Inventario = sum(stock * costCent) de productVariant
exports.getBalanceGeneral = async (req, res) => {
  try {
    const al = parseDateOnly(req.query.al);
    let alEnd = null;
    if (al) alEnd = new Date(al.getTime() + (23*3600+59*60+59)*1000);

    // Caja (acumulado)
    const ordersHasta = await prisma.order.findMany({
      where: alEnd ? { createdAt: { lte: alEnd } } : {},
      select: { totalCent: true }
    });
    const caja_cent = ordersHasta.reduce((s,o)=> s + (o.totalCent || 0), 0);

    // Inventario valorizado
    const variants = await prisma.productVariant.findMany({
      select: { stock: true, costCent: true }
    });
    const inventario_cent = variants.reduce((s,v)=> s + ((v.stock || 0) * (v.costCent || 0)), 0);

    const activos = {
      caja_estimada: toCOP(caja_cent / 100),
      inventario: toCOP(inventario_cent / 100),
    };
    const pasivos = { cuentas_por_pagar: 0 };
    const totalPasivos = Object.values(pasivos).reduce((a,b)=> a + b, 0);
    const patrimonio = toCOP((caja_cent + inventario_cent - totalPasivos) / 100);

    return res.json({
      al: req.query.al || null,
      activos,
      pasivos,
      patrimonio
    });
  } catch (err) {
    console.error('getBalanceGeneral error:', err);
    return res.status(500).json({ error: 'Error en balance general' });
  }
};
