'use strict';

const crypto = require('crypto');

function crearRegistroAlertas() {
  const recientes = new Map();
  const ventana = 300000;

  return function registrar(incidencia) {
    const ahora = Date.now();

    for (const [clave, fecha] of recientes) {
      if (ahora - fecha >= ventana) {
        recientes.delete(clave);
      }
    }

    const evento = {
      perfil: String(incidencia.perfil || '').slice(0, 50),
      tipo: String(incidencia.tipo || 'error').slice(0, 100),
      motivo: String(incidencia.motivo || '').slice(0, 500)
    };

    const clave = crypto
      .createHash('sha256')
      .update(JSON.stringify(evento))
      .digest('hex');

    if (recientes.has(clave)) {
      return { duplicada: true };
    }

    recientes.set(clave, ahora);

    return {
      duplicada: false,
      revision_manual: true,
      fecha: new Date(ahora).toISOString(),
      ...evento
    };
  };
}

module.exports = { crearRegistroAlertas };