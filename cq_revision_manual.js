'use strict';

const path = require('path');

const {
  crearRegistroAlertas
} = require('./cq_alertas_seguridad');

const {
  guardarIncidencia
} = require('./cq_historial_seguridad');

const registrar = crearRegistroAlertas();
const { crearNotificador } = require('./cq_notificar_seguridad');

module.exports = function instalarRevisionManual(app, opciones = {}) {
  app.post('/admin/incidencia-seguridad', async (req, res) => {
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

      let notificada = false;

      try {
        const datos = opciones.leerData?.();

        const registro = datos &&
          Object.prototype.hasOwnProperty.call(datos, perfil)
          ? datos[perfil]
          : null;

        const destino = String(registro?.chat_id || '').trim();

        if (destino && typeof opciones.enviarTexto === 'function') {
          const notificar = crearNotificador(opciones.enviarTexto);
          notificada = await notificar(evento, destino);
        }
      } catch (error) {
        console.error('[CQ3 SEGURIDAD] Error notificando incidencia');
      }

      return res.json({
        ok: true,
        revision_manual: true, notificada
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'No se pudo guardar la incidencia'
      });
    }
  });
};