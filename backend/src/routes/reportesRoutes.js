const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportesController');

// Ya NO pongas auth ni requireRole aquí; el grupo está protegido en server.js
router.get('/kpis', ctrl.getKpis);
router.get('/estado-resultados', ctrl.getEstadoResultados);
router.get('/balance-general', ctrl.getBalanceGeneral);

module.exports = router;
