
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./clientes_store');

function campo(valor, max = 5000) {
  if (typeof valor !== 'string' &&
      typeof valor !== 'number') return '';

  return String(valor).slice(0, max);
}

function foto(valor) {
  const v = campo(valor, 2048);

  if (/^https?:\/\/[^\s]+$/i.test(v)) return v;

  if (/^[a-zA-Z0-9_-]{20,512}$/.test(v)) return v;

  return '';
}

function registrar(cliente, id, perfil, tipo, cuerpo) {
  if (!cliente || !cliente.id || !perfil) {
    throw Error('Cliente o perfil no autorizado');
  }

  const clienteId = String(cliente.id);
  const perfilId = String(id);

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(clienteId) ||
      !/^[0-9]{1,5}$/.test(perfilId)) {
    throw Error('Identificador invalido');
  }

  const datos =
    cuerpo && typeof cuerpo === 'object' &&
    !Array.isArray(cuerpo) ? cuerpo : {};

  const raiz = path.resolve(
    store.carpetaCliente(clienteId)
  );

  const carpeta = path.join(
    raiz, 'historial_eventos'
  );

  fs.mkdirSync(carpeta, { recursive: true });

  const archivo = path.join(
    carpeta, 'perfil_' + perfilId + '.jsonl'
  );

  const evento = {
    fecha: new Date().toISOString(),
    perfil_id: perfilId,
    tipo: campo(tipo, 60),
    nombre: campo(perfil.nombre, 100),
    estado: campo(perfil.estado, 30),
    telefono: campo(
      datos.telefono ?? perfil.telefono, 100
    ),
    codigo: campo(
      datos.codigo ?? perfil.codigo, 100
    ),
    ubicacion: campo(
      datos.ubicacion ?? perfil.ubicacion, 200
    ),
    texto: campo(
      datos.texto ?? perfil.texto, 5000
    ),
    bump_hoy: Number(perfil.bump_hoy) || 0,
    bump_total: Number(perfil.bump_total) || 0,
    foto_modelo: foto(
      datos.foto_modelo ?? perfil.foto_modelo
    ),
    foto_pagina: foto(
      datos.foto_pagina ?? perfil.foto_pagina
    ),
    foto: foto(
      datos.foto ?? datos.foto_url ??
      perfil.foto
    )
  };

  fs.appendFileSync(
    archivo,
    JSON.stringify(evento) + '\n',
    'utf8'
  );

  return true;
}

module.exports = { registrar };
