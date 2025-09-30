echo "# Tienda virtual

## Stack
- Node.js + Express (backend)
- Prisma + MySQL (Clever Cloud)
- Frontend estático (HTML/CSS/JS)

## Requisitos
- Node 18+
- MySQL (o Clever Cloud)
- Variables de entorno: ver .env.example

## Backend
cd backend
npm install
# Configura .env (DATABASE_URL, JWT_SECRET)
npx prisma migrate dev
npm run dev

## Frontend
# Abrir frontend/index.html en el navegador
# o servirlo con cualquier servidor estático

" > README.md

git add README.md
git commit -m "docs: README básico"
git push
