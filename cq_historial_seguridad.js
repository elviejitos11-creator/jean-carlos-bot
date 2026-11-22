'use strict';

const fs = require('fs');
const path = require('path');

function guardarIncidencia(directorio, evento) {
  if (!evento || evento.duplicada) return false;

  fs.mkdirSync(directorio, { recursive: true });

  const archivo = path.join(
    directorio,
    'incidencias_seguridad.jsonl'
  );

  const registro = {
    fecha: new Date().toISOString(),
    perfil: String(evento.perfil || '').slice(0, 50),
    tipo: String(evento.tipo || '').slice(0, 100),
    motivo: String(evento.motivo || '').slice(0, 500),
    revision_manual: true
  };

  fs.appendFileSync(
    archivo,
    JSON.stringify(registro) + '\n',
    { encoding: 'utf8', mode: 0o600 }
  );

  return true;
}

module.exports = { guardarIncidencia };