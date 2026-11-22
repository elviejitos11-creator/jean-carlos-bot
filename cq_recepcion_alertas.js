'use strict';

const crypto = require('crypto');

function validarToken(recibido, esperado) {
  if (!recibido || !esperado) return false;

  const a = Buffer.from(String(recibido));
  const b = Buffer.from(String(esperado));

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

module.exports = { validarToken };