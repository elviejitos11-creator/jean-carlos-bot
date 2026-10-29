const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./clientes_store');

function buscar(req, id) {
  const cid = String(req.headers['x-cliente-id'] || '');
  const token = String(req.headers['x-cliente-token'] || '');

  if (!/^[a-f0-9-]{36}$/.test(cid)) return null;
  if (!/^[a-f0-9]{64}$/.test(token)) return null;

  const cliente = store.listar().find(c =>
    c.id === cid &&
    c.activo === true &&
    Date.parse(c.vencimiento) > Date.now()
  );

  if (!cliente) return null;

  const archivo = path.join(store.carpetaCliente(cid), 'data.json');
  const data = JSON.parse(fs.readFileSync(archivo, 'utf8'));

  if (!Object.prototype.hasOwnProperty.call(data, id)) return null;

  const perfil = data[id];
  const esperado = String(perfil.cliente_token || '');

  if (!/^[a-f0-9]{64}$/.test(esperado)) return null;

  const a = Buffer.from(token, 'hex');
  const b = Buffer.from(esperado, 'hex');

  if (!crypto.timingSafeEqual(a, b)) return null;

  return { cliente, archivo, data, perfil };
}

function guardar(archivo, data) {
  const temporal = archivo + '.tmp';
  fs.writeFileSync(temporal, JSON.stringify(data, null, 2));
  fs.renameSync(temporal, archivo);
}

function autorizado(req, res, id) {
  try {
    const resultado = buscar(req, String(id || ''));
    if (!resultado) {
      res.status(403).json({ ok:false, estado:'NO_AUTORIZADO' });
      return null;
    }
    return resultado;
  } catch (e) {
    res.status(500).json({ ok:false, estado:'ERROR' });
    return null;
  }
}

module.exports = function(app, opciones = {}) {

  app.get('/cliente-api/licencia/:id', (req, res) => {
    const x = autorizado(req, res, req.params.id);
    if (!x) return;

    if (x.perfil.estado !== 'ACTIVA') {
      return res.json({ok:false, estado:'PAUSADA'});
    }

    return res.json({ok:true, estado:'ACTIVA'});
  });

  app.get('/cliente-api/estado/:id', (req, res) => {
    const x = autorizado(req, res, req.params.id);
    if (!x) return;

    res.json({
      ok:true,
      estado:x.perfil.estado
    });
  });

  app.post('/cliente-api/registrar-evento', async (req, res) => {
    const id = String(req.body.id || '');
    const x = autorizado(req, res, id);
    if (!x) return;

    if (x.perfil.estado !== 'ACTIVA') {
      return res.status(403).json({
        ok:false, estado:'PAUSADA'
      });
    }

    const tipo = String(req.body.tipo || '').slice(0, 60);

    x.perfil.ultima_hora = new Date().toISOString();
    x.perfil.ultima_accion = tipo || 'Evento recibido';

    if (typeof req.body.telefono === 'string') {
      x.perfil.telefono = req.body.telefono.slice(0, 100);
    }

    if (typeof req.body.codigo === 'string') {
      x.perfil.codigo = req.body.codigo.slice(0, 100);
    }

    if (typeof req.body.ubicacion === 'string') {
      x.perfil.ubicacion = req.body.ubicacion.slice(0, 200);
    }

    // JEAN BOT: datos recibidos del script
    for (const campo of ['texto','foto_modelo',
      'foto_pagina','foto_bump','foto_bump_base64',
      'fin_plan','modo_guardia','ultima_alerta']) {
      if (typeof req.body[campo] === "string") {
        const valor = req.body[campo];
        if (valor.length <= (campo.startsWith("foto")
          ? 4000000 : 8000)) {
          x.perfil[campo === "foto_bump_base64"
            ? "foto_bump" : campo] = valor;
        }
      }
    }
    if (Array.isArray(req.body.fotos_pagina)) {
      const fotos = req.body.fotos_pagina
        .filter(v => typeof v === "string" &&
          v.length < 100000)
        .slice(0,10);
      if (fotos.length) {
        x.perfil.historial_fotos = fotos;
        x.perfil.foto_pagina = fotos[0];
        x.perfil.foto_modelo = fotos[0];
      }
    }
    x.perfil.ultimo_evento = {
      tipo, hora: x.perfil.ultima_hora
    };
    if (tipo === "publicado") {
      const n = Number(req.body.minutos_siguientes);
      const minutos = Number.isFinite(n) &&
        n > 0 && n <= 1440 ? n : 16;
      x.perfil.proximo_post_ts =
        Date.now() + minutos * 60000;
      x.perfil.proximo_post = minutos + "m";
    }
    if (tipo === 'publicado') {
      const hoy = new Date().toISOString().slice(0, 10);

      if (x.perfil.bump_fecha !== hoy) {
        x.perfil.bump_fecha = hoy;
        x.perfil.bump_hoy = 0;
      }

      x.perfil.bump_hoy = (x.perfil.bump_hoy || 0) + 1;
      x.perfil.bump_total = (x.perfil.bump_total || 0) + 1;
    }

    guardar(x.archivo, x.data);
    
  // CQ_HISTORIAL_EVENTOS_V1
  try {
    require('./cq_historial_eventos').registrar(
      x.cliente,
      id,
      x.perfil,
      tipo,
      req.body
    );
  } catch (errorHistorial) {
    console.error(
      '[CQ HISTORIAL]',
      errorHistorial.message
    );
  }

if (tipo === 'publicado') {
      try {
        await require('./jean_bot_cliente').enviar(
          x.cliente, id, x.perfil, 'Publicado'
        );
      } catch (error) {
        console.error('[JEAN BOT EVENTO]', error.message);
      }
    }

        res.json({ok:true, perfil:x.perfil});
  });
};
