'use strict';

const path = require('path');

const {
  crearRegistroAlertas
} = require('./cq_alertas_seguridad');

const {
  guardarIncidencia
} = require('./cq_historial_seguridad');

const registrar = crearRegistroAlertas();

module.exports = function instalarRevisionManual(app) {
  app.post('/admin/incidencia-seguridad', (req, res) => {
    if (req.admin !== true) {
      return res.sendStatus(403);
    }

    const perfil = String(req.body?.perfil || '').trim();

    if (!/^[A-Za-z0-9_-]{1,50}$/.test(perfil)) {
      return res.status(400).json({
        ok: false,
        error: 'Perfil invalido'
      });
    }

    const evento = registrar({
      perfil,
      tipo: req.body?.tipo || 'ERROR_NAVEGADOR',
      motivo: req.body?.motivo || 'Revision manual'
    });

    if (evento.duplicada) {
      return res.json({
        ok: true,
        duplicada: true
      });
    }

    try {
      const directorio = path.join(
        process.env.CQ_DATA_DIR || __dirname,
        'seguridad'
      );

      guardarIncidencia(directorio, evento);

      return res.json({
        ok: true,
        revision_manual: true
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'No se pudo guardar la incidencia'
      });
    }
  });
};