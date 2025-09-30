// Config
const API = 'http://127.0.0.1:4000';
const TOKEN = localStorage.getItem('token') || ''; // pega tu token si prefieres

function fmt(n){
  return n.toLocaleString('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:2 });
}
function qs(id){ return document.getElementById(id); }

async function getJSON(url){
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }});
  if(!r.ok){
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text}`);
  }
  return r.json();
}

// CSV helper
function toCSV(rows){
  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',' )).join('\n');
}
function download(name, content, type='text/csv;charset=utf-8'){
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function cargar(){
  const desde = qs('f-desde').value || '';
  const hasta = qs('f-hasta').value || '';
  const al    = qs('f-al').value   || (hasta || desde);

  // KPIs
  const kpis = await getJSON(`${API}/api/reportes/kpis?desde=${desde}&hasta=${hasta}`);
  qs('k-ventas').textContent = fmt(kpis.ventas_totales || 0);
  qs('k-boletas').textContent = Number(kpis.boletas || 0);
  qs('k-ticket').textContent = fmt(kpis.ticket_promedio || 0);
  qs('k-top').textContent = (kpis.top5_productos?.[0]?.nombre || '—') + (kpis.top5_productos?.[0]?.cantidad ? ` (${kpis.top5_productos[0].cantidad})` : '');

  // Estado de resultados
  const er = await getJSON(`${API}/api/reportes/estado-resultados?desde=${desde}&hasta=${hasta}`);
  qs('er-ingresos').textContent = fmt(er.ingresos || 0);
  qs('er-cogs').textContent     = fmt(er.costo_ventas || 0);
  qs('er-ub').textContent       = fmt(er.utilidad_bruta || 0);
  qs('er-imp').textContent      = fmt(er.impuestos || 0);
  qs('er-un').textContent       = fmt(er.utilidad_neta || 0);

  // Balance
  const bal = await getJSON(`${API}/api/reportes/balance-general?al=${al || ''}`);
  qs('bal-caja').textContent = fmt(bal.activos?.caja_estimada || 0);
  qs('bal-inv').textContent  = fmt(bal.activos?.inventario || 0);
  qs('bal-cxp').textContent  = fmt(bal.pasivos?.cuentas_por_pagar || 0);
  qs('bal-pat').textContent  = fmt(bal.patrimonio || 0);

  // Etiquetas de rango
  qs('tag-rango').textContent = (desde && hasta) ? `${desde} → ${hasta}` : 'Sin rango';
  qs('er-rango').textContent  = (desde && hasta) ? `${desde} → ${hasta}` : '—';
  qs('bal-corte').textContent = al || '—';
}

function exportarCSV(){
  const filas = [
    ['Sección','Concepto','Valor'],
    ['KPIs','Ventas totales', qs('k-ventas').textContent],
    ['KPIs','Boletas',       qs('k-boletas').textContent],
    ['KPIs','Ticket promedio', qs('k-ticket').textContent],
    ['Estado de resultados','Ingresos', qs('er-ingresos').textContent],
    ['Estado de resultados','COGS',     qs('er-cogs').textContent],
    ['Estado de resultados','Utilidad bruta', qs('er-ub').textContent],
    ['Estado de resultados','Impuestos', qs('er-imp').textContent],
    ['Estado de resultados','Utilidad neta', qs('er-un').textContent],
    ['Balance','Caja estimada', qs('bal-caja').textContent],
    ['Balance','Inventario',    qs('bal-inv').textContent],
    ['Balance','Cuentas por pagar', qs('bal-cxp').textContent],
    ['Balance','Patrimonio',    qs('bal-pat').textContent],
  ];
  const csv = toCSV(filas);
  download(`reportes_${new Date().toISOString().slice(0,10)}.csv`, csv);
}

document.addEventListener('DOMContentLoaded', () => {
  qs('btn-cargar').addEventListener('click', async () => {
    try {
      qs('btn-cargar').disabled = true;
      await cargar();
    } catch (e) {
      alert(e.message);
    } finally {
      qs('btn-cargar').disabled = false;
    }
  });

  qs('btn-csv').addEventListener('click', exportarCSV);

  // Prefill: últimos 30 días
  const today = new Date();
  const d2 = today.toISOString().slice(0,10);
  const d1 = new Date(today.getTime() - 29*24*3600*1000).toISOString().slice(0,10);
  qs('f-desde').value = d1;
  qs('f-hasta').value = d2;
  qs('f-al').value    = d2;

  // Carga inicial
  if(!TOKEN){
    console.warn('No hay token en localStorage. Usa localStorage.setItem("token", "<JWT>")');
  } else {
    cargar().catch(err => console.error(err));
  }
});
