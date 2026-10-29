
'use strict';

// CQ_DIVISION_ORIGINAL_V1
// Vista privada sobre el data.json del motor original.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data.json');
const MAPA = path.join(
  __dirname,
  'clientes_data',
  'cq_propietarios_perfiles.json'
);

function leer(ruta) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

function guardar(ruta, contenido) {
  const temporal = ruta + '.cq_division_tmp';
  fs.writeFileSync(
    temporal,
    JSON.stringify(contenido, null, 2),
    'utf8'
  );
  fs.renameSync(temporal, ruta);
}

function propio(objeto, clave) {
  return Object.prototype.hasOwnProperty.call(objeto, clave);
}

function validar(clienteId) {
  if (!/^[a-f0-9-]{36}$/i.test(String(clienteId))) {
    throw Error('Identificador de cliente invalido');
  }
}

function leerPerfiles(clienteId) {
  validar(clienteId);

  const principal = leer(DATA);
  const configuracion = leer(MAPA);
  const propietarios = configuracion.propietarios || {};
  const resultado = {};

  for (const id of Object.keys(propietarios)) {
    if (
      propietarios[id] === clienteId &&
      propio(principal, id)
    ) {
      Object.defineProperty(resultado, id, {
        value: principal[id],
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  }

  return resultado;
}

function guardarPerfiles(clienteId, perfiles) {
  validar(clienteId);

  if (
    !perfiles ||
    typeof perfiles !== 'object' ||
    Array.isArray(perfiles)
  ) {
    throw Error('Formato de perfiles invalido');
  }

  const principal = leer(DATA);
  const configuracion = leer(MAPA);
  const propietarios = configuracion.propietarios || {};

  // Verificar todo antes de modificar archivos.
  for (const id of Object.keys(perfiles)) {
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(id)) {
      throw Error('Identificador de perfil invalido');
    }

    if (propio(propietarios, id)) {
      if (propietarios[id] !== clienteId) {
        throw Error('Perfil asignado a otro cliente: ' + id);
      }
    } else if (propio(principal, id)) {
      throw Error('Perfil original no asignado: ' + id);
    }
  }

  const nuevoData = { ...principal };
  const nuevosPropietarios = { ...propietarios };

  // Actualizar solamente los perfiles de este cliente.
  for (const id of Object.keys(perfiles)) {
    Object.defineProperty(nuevoData, id, {
      value: perfiles[id],
      writable: true,
      enumerable: true,
      configurable: true
    });

    Object.defineProperty(nuevosPropietarios, id, {
      value: clienteId,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }

  // Eliminar solamente perfiles propios borrados
  // desde el panel privado.
  for (const id of Object.keys(propietarios)) {
    if (
      propietarios[id] === clienteId &&
      !propio(perfiles, id)
    ) {
      delete nuevoData[id];
      delete nuevosPropietarios[id];
    }
  }

  const nuevoMapa = {
    ...configuracion,
    propietarios: nuevosPropietarios
  };

  const respaldoData = fs.readFileSync(DATA);
  const respaldoMapa = fs.readFileSync(MAPA);

  try {
    guardar(DATA, nuevoData);
    guardar(MAPA, nuevoMapa);
  } catch (error) {
    fs.writeFileSync(DATA, respaldoData);
    fs.writeFileSync(MAPA, respaldoMapa);
    throw error;
  }
}

module.exports = {
  leerPerfiles,
  guardarPerfiles
};
