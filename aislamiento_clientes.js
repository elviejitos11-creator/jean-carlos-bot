const crypto = require('crypto');

function validarCliente(clienteId) {
  if (!/^[0-9a-f-]{36}$/.test(String(clienteId))) {
    throw new Error('Cliente invalido');
  }
  return String(clienteId);
}

function validarPerfil(perfilId) {
  const id = String(perfilId);
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) {
    throw new Error('Perfil invalido');
  }
  return id;
}

function identificar(clienteId, perfilId) {
  const cliente = validarCliente(clienteId);
  const perfil = validarPerfil(perfilId);

  return crypto.createHash('sha256')
    .update(cliente + ':' + perfil)
    .digest('hex');
}

function mismoPropietario(clienteA, clienteB) {
  return validarCliente(clienteA) === validarCliente(clienteB);
}

module.exports = {
  identificar,
  mismoPropietario,
  validarCliente,
  validarPerfil
};
