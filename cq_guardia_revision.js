'use strict';

const { validarToken } = require('./cq_recepcion_alertas');

function autorizarIncidencia(datos, id, token) {
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(datos, id)) {
    return null;
  }

  const perfil = datos[id];

  if (!validarToken(token, perfil.cliente_token)) {
    return null;
  }

  return perfil;
}

module.exports = { autorizarIncidencia };