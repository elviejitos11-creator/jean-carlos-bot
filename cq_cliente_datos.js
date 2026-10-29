
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./clientes_store');

function carpeta(clienteId) {
  if (typeof clienteId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(clienteId)) {
    throw new Error('ID de cliente invalido');
  }

  const ruta = path.resolve(store.carpetaCliente(clienteId));

  fs.mkdirSync(ruta, { recursive: true });

  return ruta;
}

function archivo(clienteId, nombre) {
  return path.join(carpeta(clienteId), nombre);
}

function leerJSON(ruta, defecto) {
  if (!fs.existsSync(ruta)) return defecto;

  const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));

  if (!datos || typeof datos !== 'object') {
    throw new Error('Estructura de datos invalida');
  }

  return datos;
}

function guardarJSON(ruta, datos) {
  const dir = path.dirname(ruta);
  fs.mkdirSync(dir, { recursive: true });

  const temporal = path.join(
    dir,
    '.' + path.basename(ruta) + '.' +
    process.pid + '.' + require('crypto').randomUUID() + '.tmp'
  );

  try {
    fs.writeFileSync(
      temporal,
      JSON.stringify(datos, null, 2),
      { encoding: 'utf8', flag: 'wx' }
    );

    // Se conserva el destino anterior si falla la escritura
    // antes de reemplazarlo.
    fs.renameSync(temporal, ruta);
  } finally {
    if (fs.existsSync(temporal)) {
      fs.unlinkSync(temporal);
    }
  }
}

function idPerfil(id) {
  const valor = String(id);

  if (!/^[0-9]{1,5}$/.test(valor)) {
    throw new Error('ID de perfil invalido');
  }

  return valor;
}

function leerPerfiles(clienteId) {
  return leerJSON(archivo(clienteId, 'data.json'), {});
}

function leerPerfil(clienteId, perfilId) {
  const id = idPerfil(perfilId);
  const datos = leerPerfiles(clienteId);

  if (!Object.prototype.hasOwnProperty.call(datos, id)) {
    return null;
  }

  return datos[id];
}

function rutasPerfil(clienteId, perfilId) {
  const id = idPerfil(perfilId);
  const raiz = carpeta(clienteId);

  const ruta = path.join(raiz, 'perfil_' + id);

  return {
    raiz: ruta,
    fotos: path.join(ruta, 'fotos'),
    historial: path.join(ruta, 'historial.json'),
    publicaciones: path.join(ruta, 'publicaciones.json'),
    configuracion: path.join(ruta, 'configuracion.json')
  };
}

function prepararPerfil(clienteId, perfilId) {
  const rutas = rutasPerfil(clienteId, perfilId);

  fs.mkdirSync(rutas.fotos, { recursive: true });

  const iniciales = [
    [rutas.historial, []],
    [rutas.publicaciones, []],
    [rutas.configuracion, {}]
  ];

  for (const [ruta, defecto] of iniciales) {
    if (!fs.existsSync(ruta)) {
      guardarJSON(ruta, defecto);
    }
  }

  return rutas;
}

function guardarConfiguracion(clienteId, perfilId, cambios) {
  if (!cambios || typeof cambios !== 'object' ||
      Array.isArray(cambios)) {
    throw new Error('Configuracion invalida');
  }

  const rutas = prepararPerfil(clienteId, perfilId);
  const anterior = leerJSON(rutas.configuracion, {});

  const nuevo = { ...anterior, ...cambios };

  guardarJSON(rutas.configuracion, nuevo);

  return nuevo;
}

function agregarHistorial(clienteId, perfilId, evento) {
  if (!evento || typeof evento !== 'object' ||
      Array.isArray(evento)) {
    throw new Error('Evento invalido');
  }

  const rutas = prepararPerfil(clienteId, perfilId);
  const historial = leerJSON(rutas.historial, []);

  if (!Array.isArray(historial)) {
    throw new Error('Historial invalido');
  }

  historial.push({
    ...evento,
    fecha_registro: new Date().toISOString()
  });

  guardarJSON(rutas.historial, historial);

  return historial.length;
}

function guardarReferenciaFoto(clienteId, perfilId, foto) {
  if (!foto || typeof foto !== 'object' ||
      typeof foto.url !== 'string' ||
      !/^https?:\/\//i.test(foto.url)) {
    throw new Error('Referencia de foto invalida');
  }

  return agregarHistorial(clienteId, perfilId, {
    tipo: 'foto',
    url: foto.url,
    descripcion: String(foto.descripcion || '')
  });
}

module.exports = {
  carpeta,
  archivo,
  leerPerfiles,
  leerPerfil,
  rutasPerfil,
  prepararPerfil,
  guardarConfiguracion,
  agregarHistorial,
  guardarReferenciaFoto
};
