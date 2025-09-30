// seed.js (versión no destructiva, mismas claves/valores que ya tenías)
// Cambios: solo URLs de imágenes para que se vean en el frontend.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  // Ajusta IVA y envío fijo
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { taxPercent: 19.0, shippingFixedCent: 8000 },
    create: { id: 1, taxPercent: 19.0, shippingFixedCent: 8000 },
  });

  // Admin y cliente demo (mismas credenciales)
  const adminPass = await bcrypt.hash('admin123', 10);
  const clientPass = await bcrypt.hash('cliente123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@mitienda.com' },
    update: {},
    create: {
      name: 'Admin Demo',
      email: 'admin@mitienda.com',
      password: adminPass,
      role: 'admin',
    },
  });

  const cliente = await prisma.user.upsert({
    where: { email: 'cliente@correo.com' },
    update: {},
    create: {
      name: 'Cliente Demo',
      email: 'cliente@correo.com',
      password: clientPass,
      role: 'cliente',
    },
  });

  // Dirección por defecto (campos requeridos según tu schema)
  await prisma.address.create({
    data: {
      userId: cliente.id,
      label: 'Casa',
      recipient: 'Cliente Demo',
      department: 'Santander',
      city: 'Floridablanca',
      street: 'Calle 123 #45-67',
      isDefault: true,
      // country tiene default "Colombia" en el schema
    },
  });

  // Categorías (sin cambios)
  const futbol = await prisma.category.upsert({
    where: { slug: 'futbol' },
    update: {},
    create: { name: 'Fútbol', slug: 'futbol' },
  });
  const basquet = await prisma.category.upsert({
    where: { slug: 'basquet' },
    update: {},
    create: { name: 'Básquet', slug: 'basquet' },
  });
  const boxeo = await prisma.category.upsert({
    where: { slug: 'boxeo' },
    update: {},
    create: { name: 'Boxeo', slug: 'boxeo' },
  });

  // Productos (sin cambios en slugs ni descuentos)
  const p1 = await prisma.product.upsert({
    where: { slug: 'balon-futbol' },
    update: {},
    create: {
      categoryId: futbol.id,
      name: 'Balón de fútbol',
      slug: 'balon-futbol',
      shortDescription: 'Balón tamaño 5 para cancha',
      discountPercent: null,
    },
  });

  const p2 = await prisma.product.upsert({
    where: { slug: 'balon-basket' },
    update: {},
    create: {
      categoryId: basquet.id,
      name: 'Balón de basket',
      slug: 'balon-basket',
      shortDescription: 'Balón oficial de baloncesto',
      discountPercent: 10.0,
    },
  });

  const p3 = await prisma.product.upsert({
    where: { slug: 'guantes-box' },
    update: {},
    create: {
      categoryId: boxeo.id,
      name: 'Guantes de box',
      slug: 'guantes-box',
      shortDescription: 'Guantes acolchados de entrenamiento',
      discountPercent: null,
    },
  });

  // Variantes (precio en centavos COP) — SIN cambios
await prisma.productVariant.createMany({
  data: [
    { productId: p1.id, sku: 'SKU-FUT-ROJO', color: 'Rojo', priceCent: 2000000, stock: 15 },
    { productId: p2.id, sku: 'SKU-BAS-STD', priceCent: 3500000, stock: 10 },
    { productId: p3.id, sku: 'SKU-BOX-M', color: 'Rojo', size: 'M', priceCent: 5000000, stock: 8 },
  ],
});

  // Imágenes: reemplazo de example.com -> picsum.photos (solo visual)
  await prisma.productImage.createMany({
  data: [
    { productId: p1.id, url: 'https://picsum.photos/seed/balon/800/600', sortOrder: 0 },
    { productId: p2.id, url: 'https://picsum.photos/seed/basket/800/600', sortOrder: 0 },
    { productId: p3.id, url: 'https://picsum.photos/seed/guantes/800/600', sortOrder: 0 },
  ],
});


  console.log('✅ Seed completado (mismos datos, imágenes actualizadas)');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
