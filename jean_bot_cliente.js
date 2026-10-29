// CQ_PROGRAMACIONES_ESTADO_SEGURO_V9
// CQ_PROGRAMACION_FORCE_REPLY_V8
// JEAN_BOT_CLIENTE_FOTOS_DISENO_V4

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const store = require('./clientes_store');

let tokenBot = '';
let ejecutando = false;
let timer = null;

const estadoArchivo = path.join(
  __dirname,
  'clientes_data',
  'jean_bot_estado.json'
);

function leerEstado() {
  try {
    return JSON.parse(
      fs.readFileSync(estadoArchivo, 'utf8')
    );
  } catch {
    return {
      offset: 0,
      iniciado: false,
      schedules: []
    };
  }
}

function guardarEstado(datos) {
  fs.mkdirSync(path.dirname(estadoArchivo), {
    recursive: true
  });

  const temporal = estadoArchivo + '.tmp';

  fs.writeFileSync(
    temporal,
    JSON.stringify(datos, null, 2),
    'utf8'
  );

  fs.renameSync(temporal, estadoArchivo);
}

function archivoCliente(cliente) {
  return path.join(
    store.carpetaCliente(cliente.id),
    'data.json'
  );
}

function leerPerfiles(cliente) {
  return JSON.parse(
    fs.readFileSync(archivoCliente(cliente), 'utf8')
  );
}

function guardarPerfiles(cliente, datos) {
  const archivo = archivoCliente(cliente);
  const temporal = archivo + '.tmp';

  fs.writeFileSync(
    temporal,
    JSON.stringify(datos, null, 2),
    'utf8'
  );

  fs.renameSync(temporal, archivo);
}

function clienteValido(cliente) {
  return cliente &&
    cliente.activo === true &&
    Date.parse(cliente.vencimiento) > Date.now();
}

function hashPerfil(cliente, id) {
  return crypto.createHash('sha256')
    .update(cliente.id + ':' + id)
    .digest('hex')
    .slice(0, 24);
}

function buscarPerfil(hash, chatId) {
  for (const cliente of store.listar()) {
    if (!clienteValido(cliente)) continue;

    let datos;

    try {
      datos = leerPerfiles(cliente);
    } catch {
      continue;
    }

    for (const [id, perfil] of Object.entries(datos)) {
      if (
        hashPerfil(cliente, id) === hash &&
        String(perfil.chat_id) === String(chatId)
      ) {
        return { cliente, id, perfil, datos };
      }
    }
  }

  return null;
}


function teclado(cliente, id) {
  const hash = hashPerfil(cliente, id);
  const cb = a => 'jc|' + a + '|' + hash;

  return {
    inline_keyboard: [
      [
        {
          text: '\u23f8\ufe0f Pausar',
          callback_data: cb('p')
        },
        {
          text: '\u25b6\ufe0f Reanudar',
          callback_data: cb('r')
        }
      ],
      [
        {
          text: '\u23f8\ufe0f Pausar todas',
          callback_data: cb('P')
        },
        {
          text: '\u25b6\ufe0f Reanudar todas',
          callback_data: cb('R')
        }
      ],
      [
        {
          text: '\u23f0 Programar pausa',
          callback_data: cb('s')
        },
        {
          text: '\u23f0 Programar reanudar',
          callback_data: cb('S')
        }
      ],
      [
        {
          text: '\u{1f552} \u00daltimo bump',
          callback_data: cb('u')
        }
      ],
      [
        {
          text: '\u{1f504} Reiniciar bot',
          callback_data: cb('i')
        }
      ],
      [
        {
          text: '\u{1f4de} Contactar',
          url: 'https://wa.me/18097760519'
        },
        {
          text: '\u{1f4dc} Ver reglas',
          callback_data: cb('g')
        }
      ],
      [
        {
          text: '\u{1f4f8} Ver una foto',
          callback_data: cb('f')
        }
      ],
      [
        {
          text: '\u{1f5c2}\ufe0f Ver \u00e1lbum completo',
          callback_data: cb('a')
        }
      ]
    ]
  };
}


async function telegram(metodo, datos) {
  if (!tokenBot) return null;

  try {
    const r = await axios.post(
      'https://api.telegram.org/bot' +
      tokenBot + '/' + metodo,
      datos,
      { timeout: 30000 }
    );

    return r.data;
  } catch (error) {
    console.error(
      '[JEAN BOT]',
      metodo,
      error.response?.data?.description || error.message
    );

    return null;
  }
}

function restantePlan(perfil) {
  const fecha = Date.parse(perfil.fin_plan);

  if (!Number.isFinite(fecha)) {
    return perfil.fin_plan || 'N/A';
  }

  const restante = fecha - Date.now();

  if (restante <= 0) return 'Vencido';

  return Math.floor(restante / 86400000) + ' dias';
}

function proximoBump(perfil) {
  const fecha = Number(perfil.proximo_post_ts);

  if (fecha > 0) {
    const segundos = Math.max(
      0,
      Math.floor((fecha - Date.now()) / 1000)
    );

    return Math.floor(segundos / 60) + 'm ' +
      (segundos % 60) + 's';
  }

  return perfil.proximo_post || 'N/A';
}


function mensaje(cliente, id, perfil, accion) {
  const valor = (v, defecto = 'N/A') =>
    v === null || v === undefined || v === ''
      ? defecto
      : String(v);

  const fotos = Array.isArray(perfil.historial_fotos)
    ? perfil.historial_fotos.length
    : 0;

  const estado = valor(perfil.estado);

  const titulo = '\u{1f525} JEAN__BOT CLIENTE \u{1f525}';

  const lineas = [
    titulo,
    '',
    '\u{1f464} ' + valor(cliente.nombre, 'Cliente'),
    '\u{1f194} ' + valor(perfil.nombre, 'Perfil ' + id),
    '\u{1f514} ' + valor(accion),
    '',
    '\u{1f4de} N\u00famero: ' + valor(perfil.telefono),
    '\u{1f194} C\u00f3digo: ' + valor(perfil.codigo),
    '\u{1f4cd} Ubicaci\u00f3n: ' + valor(perfil.ubicacion),
    '',
    (estado === 'ACTIVA' ? '\u{1f7e2}' : '\u{1f534}') +
      ' Estado: ' + estado,
    '\u{1f552} Hora: ' + valor(perfil.ultima_hora),
    '\u23f1\ufe0f Pr\u00f3ximo bump: ' +
      proximoBump(perfil),
    '\u{1f4c5} Plan: ' + restantePlan(perfil),
    '\u{1f4ca} Bump hoy: ' + valor(perfil.bump_hoy, '0'),
    '\u{1f4c8} Bump total: ' + valor(perfil.bump_total, '0'),
    '\u{1f5bc}\ufe0f Fotos: ' + fotos
  ];

  if (perfil.modo_guardia) {
    lineas.push(
      '\u{1f6e1}\ufe0f Guardia: ' +
      valor(perfil.modo_guardia)
    );
  }

  if (perfil.ultima_alerta) {
    lineas.push(
      '\u{1f6a8} ' +
      valor(perfil.ultima_alerta).slice(0, 300)
    );
  }

  if (perfil.texto) {
    lineas.push(
      '',
      '\u{1f4dd} Texto:',
      valor(perfil.texto).slice(0, 1600)
    );
  }

  return lineas.join('\n');
}



function prepararImagen(entrada) {
  if (!entrada) return null;

  if (
    typeof entrada === 'object' &&
    !Buffer.isBuffer(entrada)
  ) {
    entrada =
      entrada.base64 ||
      entrada.data ||
      entrada.url ||
      entrada.file_id ||
      entrada.foto ||
      entrada.image ||
      null;
  }

  if (typeof entrada !== 'string') return null;

  const dato = entrada.trim();

  if (!dato) return null;

  const dataUrl = dato.match(
    /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i
  );

  let base64 = null;

  if (dataUrl) {
    base64 = dataUrl[2].replace(/\s/g, '');
  } else if (
    dato.length > 1000 &&
    /^[A-Za-z0-9+/=\s]+$/.test(dato)
  ) {
    base64 = dato.replace(/\s/g, '');
  }

  if (base64) {
    if (base64.length > 14000000) return null;

    const buffer = Buffer.from(base64, 'base64');

    if (
      !buffer.length ||
      buffer.length > 10000000
    ) {
      return null;
    }

    return {
      tipo: 'buffer',
      buffer
    };
  }

  if (
    /^https:\/\//i.test(dato) ||
    /^[A-Za-z0-9_-]{20,}$/.test(dato)
  ) {
    return {
      tipo: 'referencia',
      valor: dato
    };
  }

  return null;
}

function imagenEvento(perfil, accion) {
  const esBump = /bump|publicad|captura/i.test(
    String(accion || '')
  );

  const candidatas = esBump
    ? [
        perfil.foto_bump,
        perfil.foto_bump_base64,
        perfil.foto_pagina,
        perfil.foto_modelo
      ]
    : [
        perfil.foto_modelo,
        perfil.foto_pagina,
        perfil.foto_bump,
        perfil.foto_bump_base64
      ];

  if (Array.isArray(perfil.historial_fotos)) {
    candidatas.push(...perfil.historial_fotos.slice(-10).reverse());
  }

  for (const candidata of candidatas) {
    const imagen = prepararImagen(candidata);
    if (imagen) return imagen;
  }

  return null;
}

async function enviarFotoReal(chatId, imagen, caption, botones) {
  if (!imagen) return null;

  if (imagen.tipo === 'referencia') {
    return telegram('sendPhoto', {
      chat_id: chatId,
      photo: imagen.valor,
      caption: caption.slice(0, 1024),
      reply_markup: botones
    });
  }

  const FormData = require('form-data');
  const form = new FormData();

  form.append('chat_id', String(chatId));
  form.append('caption', caption.slice(0, 1024));
  form.append('reply_markup', JSON.stringify(botones));
  form.append('photo', imagen.buffer, {
    filename: 'captura_cliente.jpg',
    contentType: 'image/jpeg'
  });

  try {
    const respuesta = await axios.post(
      'https://api.telegram.org/bot' +
      tokenBot + '/sendPhoto',
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: 12000000,
        timeout: 45000
      }
    );

    return respuesta.data;
  } catch (error) {
    console.error(
      '[JEAN BOT FOTO]',
      error.response?.data?.description ||
      error.message
    );
    return null;
  }
}

async function enviar(cliente, id, perfil, accion) {
  if (!clienteValido(cliente)) return false;

  const chatId = String(perfil.chat_id || '');

  if (!/^-?[0-9]{5,20}$/.test(chatId)) {
    return false;
  }

  const texto = mensaje(cliente, id, perfil, accion);
  const botones = teclado(cliente, id);
  const imagen = imagenEvento(perfil, accion);

  if (imagen) {
    const fotoEnviada = await enviarFotoReal(
      chatId, imagen, texto, botones
    );

    if (fotoEnviada?.ok) {
      if (texto.length > 1024) {
        await telegram('sendMessage', {
          chat_id: chatId,
          text: texto.slice(1024, 4096)
        });
      }

      return true;
    }
  }

  const respuesta = await telegram('sendMessage', {
    chat_id: chatId,
    text: texto.slice(0, 4096),
    reply_markup: botones
  });

  return !!respuesta?.ok;
}


async function responder(q, texto) {
  await telegram('answerCallbackQuery', {
    callback_query_id: q.id,
    text: String(texto).slice(0, 180)
  });
}

function programar(cliente, id, estado) {
  const datos = leerEstado();

  if (!Array.isArray(datos.schedules)) {
    datos.schedules = [];
  }

  datos.schedules.push({
    cliente_id: cliente.id,
    perfil_id: id,
    estado,
    ejecutar: Date.now() + 30 * 60000
  });

  guardarEstado(datos);
}



function cqParseFecha(entrada) {
  const texto = String(entrada || '')
    .trim()
    .toUpperCase()
    .replace(/\u00D1/g, 'N')
    .replace(/\?/g, 'N')
    .replace(/\s+/g, ' ');

  const patron = /^(?:(HOY|MANANA)\s+)?(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)?$/;

  const m = texto.match(patron);
  if (!m) return null;

  const ahora = new Date();
  const dia = m[2] ? Number(m[2]) : null;
  const mes = m[3] ? Number(m[3]) : null;
  const anio = m[4] ? Number(m[4]) : null;

  let hora = Number(m[5]);
  const minuto = Number(m[6]);
  const periodo = m[7];

  if (minuto > 59) return null;

  if (periodo) {
    if (hora < 1 || hora > 12) return null;
    hora = hora % 12;
    if (periodo === 'PM') hora += 12;
  } else if (hora > 23) {
    return null;
  }

  let fecha;

  if (dia !== null) {
    const year = anio || ahora.getFullYear();
    fecha = new Date(year, mes - 1, dia, hora, minuto);

    if (
      fecha.getFullYear() !== year ||
      fecha.getMonth() !== mes - 1 ||
      fecha.getDate() !== dia ||
      fecha.getHours() !== hora ||
      fecha.getMinutes() !== minuto
    ) return null;

    if (anio === null && fecha <= ahora) {
      fecha = new Date(year + 1, mes - 1, dia, hora, minuto);
    }
  } else {
    fecha = new Date(ahora);

    if (m[1] === 'MANANA') {
      fecha.setDate(fecha.getDate() + 1);
    }

    fecha.setHours(hora, minuto, 0, 0);

    if (!m[1] && fecha <= ahora) {
      fecha.setDate(fecha.getDate() + 1);
    }
  }

  const ts = fecha.getTime();

  if (
    !Number.isFinite(ts) ||
    ts <= Date.now() ||
    ts > Date.now() + 366 * 86400000
  ) return null;

  return ts;
}

function cqPendienteClave(chat, usuario) {
  return String(chat) + ':' + String(usuario);
}

async function cqMensajeHorario(m) {
  const chat = String(m?.chat?.id || '');
  const usuario = String(m?.from?.id || '');

  if (!chat || !usuario || m.from?.is_bot) return;

  const estado = leerEstado();
  const clave = cqPendienteClave(chat, usuario);
  const pendiente = estado.pendientes?.[clave];

  if (!pendiente) return;

  if (
    !pendiente.creado ||
    Date.now() - pendiente.creado > 15 * 60000
  ) {
    delete estado.pendientes[clave];
    guardarEstado(estado);
    return;
  }

  const cliente = store.listar().find(
    c => c.id === pendiente.cliente_id
  );

  if (!clienteValido(cliente)) {
    delete estado.pendientes[clave];
    guardarEstado(estado);
    return;
  }

  let perfiles;

  try {
    perfiles = leerPerfiles(cliente);
  } catch {
    return;
  }

  const perfil = perfiles[pendiente.perfil_id];

  if (
    !perfil ||
    String(perfil.chat_id) !== chat
  ) {
    delete estado.pendientes[clave];
    guardarEstado(estado);
    return;
  }

  const texto = String(m.text || '').trim();

  if (/^CANCELAR$/i.test(texto)) {
    estado.schedules = (estado.schedules || [])
      .filter(t => !(
        t.cliente_id === pendiente.cliente_id &&
        t.perfil_id === pendiente.perfil_id &&
        t.estado === pendiente.estado
      ));

    delete estado.pendientes[clave];
    guardarEstado(estado);

    await telegram('sendMessage', {
      chat_id: chat,
      text: 'Programaci?n cancelada.'
    });

    return;
  }

  const ts = cqParseFecha(texto);

  if (!ts) {
    await telegram('sendMessage', {
      chat_id: chat,
      text:
        'Fecha inv?lida.\n' +
        'Ejemplos:\n' +
        'MA?ANA 5:00 AM\n' +
        '30/10 7:30 PM\n\n' +
        'Para salir escribe CANCELAR.'
    });

    return;
  }

  estado.schedules = Array.isArray(estado.schedules)
    ? estado.schedules
    : [];

  estado.schedules = estado.schedules.filter(t => !(
    t.cliente_id === pendiente.cliente_id &&
    t.perfil_id === pendiente.perfil_id &&
    t.estado === pendiente.estado
  ));

  estado.schedules.push({
    cliente_id: pendiente.cliente_id,
    perfil_id: pendiente.perfil_id,
    estado: pendiente.estado,
    ejecutar: ts
  });

  delete estado.pendientes[clave];
  guardarEstado(estado);

  await telegram('sendMessage', {
    chat_id: chat,
    text:
      'Programaci?n guardada:\n' +
      (pendiente.estado === 'PAUSADA'
        ? 'PAUSAR'
        : 'REANUDAR') +
      '\n' +
      new Date(ts).toLocaleString('es-DO')
  });
}

async function procesar(q) {
  const partes = String(q.data || '').split('|');

  if (
    partes.length !== 3 ||
    partes[0] !== 'jc' ||
    !/^[a-zA-Z]$/.test(partes[1]) ||
    !/^[a-f0-9]{24}$/.test(partes[2])
  ) {
    return;
  }

  const accion = partes[1];
  const x = buscarPerfil(
    partes[2],
    q.message?.chat?.id
  );

  if (!x) {
    await responder(q, 'Acceso denegado');
    return;
  }

  const { cliente, id, perfil, datos } = x;

  if (['p', 'r', 'i'].includes(accion)) {
    perfil.estado = accion === 'p'
      ? 'PAUSADA'
      : 'ACTIVA';

    perfil.ultima_hora = new Date().toISOString();
    perfil.ultima_accion = accion === 'p'
      ? 'Pausado desde Telegram'
      : accion === 'r'
        ? 'Reanudado desde Telegram'
        : 'Reiniciado desde Telegram';

    guardarPerfiles(cliente, datos);

    await responder(q, 'Estado actualizado');

    await enviar(
      cliente,
      id,
      perfil,
      perfil.ultima_accion
    );

    return;
  }

  if (accion === 'P' || accion === 'R') {
    const estado = accion === 'P'
      ? 'PAUSADA'
      : 'ACTIVA';

    for (const perfilActual of Object.values(datos)) {
      perfilActual.estado = estado;
      perfilActual.ultima_hora =
        new Date().toISOString();
    }

    guardarPerfiles(cliente, datos);

    await responder(q, 'Perfiles actualizados');

    await telegram('sendMessage', {
      chat_id: q.message.chat.id,
      text: '? Perfiles del cliente: ' + estado
    });

    return;
  }

  if (accion === 's' || accion === 'S') {
    const agenda = leerEstado();
    agenda.pendientes = agenda.pendientes || {};
    const clave = cqPendienteClave(
      q.message.chat.id, q.from.id
    );
    agenda.pendientes[clave] = {
      cliente_id: cliente.id,
      perfil_id: id,
      estado: accion === 's' ? 'PAUSADA' : 'ACTIVA',
      creado: Date.now()
    };
    guardarEstado(agenda);
    await responder(q, 'Escribe fecha y hora');
    await telegram('sendMessage', {
      chat_id: q.message.chat.id,
      text: 'PROGRAMACION - Perfil ' + id +
        '\nEscribe fecha y hora:' +
        '\nMA?ANA 5:00 AM' +
        '\n30/10 7:30 PM' +
        '\nPara cancelar: CANCELAR',
      reply_markup: {
        force_reply: true,
        selective: true,
        input_field_placeholder: 'MA?ANA 7:00 AM'
      }
    });
    return;
  }

  if (accion === 'u') {
    await responder(q, '?ltimo bump');

    await enviar(
      cliente,
      id,
      perfil,
      '?ltimo bump'
    );

    return;
  }


  if (accion === 'f') {
    await responder(q, 'Consultando foto');

    const imagen = imagenEvento(perfil, 'Foto');

    if (!imagen) {
      await telegram('sendMessage', {
        chat_id: q.message.chat.id,
        text: 'No hay una fotograf\u00eda guardada.'
      });
      return;
    }

    await enviarFotoReal(
      q.message.chat.id,
      imagen,
      '\u{1f4f8} ' + (perfil.nombre || 'Perfil ' + id),
      teclado(cliente, id)
    );

    return;
  }

  if (accion === 'a') {
    await responder(q, 'Consultando \u00e1lbum');

    const historial = Array.isArray(perfil.historial_fotos)
      ? perfil.historial_fotos
      : [];

    const fotos = historial
      .slice(-10)
      .map(prepararImagen)
      .filter(Boolean);

    if (!fotos.length) {
      const ultima = imagenEvento(perfil, 'Foto');
      if (ultima) fotos.push(ultima);
    }

    if (!fotos.length) {
      await telegram('sendMessage', {
        chat_id: q.message.chat.id,
        text: 'El perfil todav\u00eda no tiene capturas.'
      });
      return;
    }

    let enviadas = 0;

    for (const foto of fotos) {
      const resultado = await enviarFotoReal(
        q.message.chat.id,
        foto,
        '\u{1f5c2}\ufe0f \u00c1lbum del perfil ' + id,
        teclado(cliente, id)
      );

      if (resultado?.ok) enviadas++;
    }

    if (!enviadas) {
      await telegram('sendMessage', {
        chat_id: q.message.chat.id,
        text: 'No se pudieron enviar las fotos guardadas.'
      });
    }

    return;
  }



  if (accion === 'g') {
    await responder(q, 'Reglas');

    await telegram('sendMessage', {
      chat_id: q.message.chat.id,
      text: '?? Reglas del sistema\n' +
        'Controla tus perfiles desde este grupo.\n' +
        'Consulta soporte cuando lo necesites.'
    });

    return;
  }

  await responder(q, 'Acci?n no reconocida');
}

async function ejecutarProgramaciones() {
  const estado = leerEstado();

  if (!Array.isArray(estado.schedules)) return;

  const pendientes = [];

  for (const tarea of estado.schedules) {
    if (tarea.ejecutar > Date.now()) {
      pendientes.push(tarea);
      continue;
    }

    const cliente = store.listar().find(
      c => c.id === tarea.cliente_id
    );

    if (!clienteValido(cliente)) continue;

    const datos = leerPerfiles(cliente);
    const perfil = datos[tarea.perfil_id];

    if (!perfil) continue;

    perfil.estado = tarea.estado;
    perfil.ultima_hora = new Date().toISOString();
    perfil.ultima_accion = 'Programaci?n ejecutada';

    guardarPerfiles(cliente, datos);

    await enviar(
      cliente,
      tarea.perfil_id,
      perfil,
      'Programaci?n ejecutada'
    );
  }

  if (pendientes.length !== estado.schedules.length) {
    estado.schedules = pendientes;
    guardarEstado(estado);
  }
}

async function revisar() {
  if (ejecutando) return;
  ejecutando = true;

  try {
    const estado = leerEstado();

    const respuesta = await telegram('getUpdates', {
      offset: (Number(estado.offset) || 0) + 1,
      timeout: 0,
      limit: 30,
      allowed_updates: ['callback_query', 'message']
    });

    if (respuesta?.ok &&
        Array.isArray(respuesta.result)) {
      for (const update of respuesta.result) {
        if (update.message) {
          try {
            await cqMensajeHorario(update.message);
          } catch (error) {
            console.error('[JEAN HORARIO]', error.message);
          }
        }
        if (update.callback_query) {
          try {
            await procesar(update.callback_query);
          } catch (error) {
            console.error(
              '[JEAN BOT CALLBACK]',
              error.message
            );
          }
        }

        // Actualizar solo el offset, sin borrar las
        // programaciones guardadas durante este evento.
        const estadoActual = leerEstado();
        estadoActual.offset = update.update_id;
        guardarEstado(estadoActual);
      }
    }

    await ejecutarProgramaciones();
  } catch (error) {
    console.error('[JEAN BOT]', error.message);
  } finally {
    ejecutando = false;
  }
}

async function iniciar(token) {
  if (timer) return;

  tokenBot = String(token || '');

  if (!tokenBot) return;

  const webhook = await telegram('getWebhookInfo', {});

  if (!webhook?.ok || webhook.result?.url) {
    console.error(
      '[JEAN BOT] Webhook activo o no verificable.'
    );
    return;
  }

  const estado = leerEstado();

  if (!estado.iniciado) {
    const r = await telegram('getUpdates', {
      offset: -1,
      limit: 1,
      timeout: 0
    });

    if (!r?.ok) return;

    estado.offset = r.result?.length
      ? r.result[r.result.length - 1].update_id
      : 0;

    estado.iniciado = true;
    guardarEstado(estado);
  }

  timer = setInterval(() => {
    void revisar();
  }, 3500);

  console.log(
    '[JEAN BOT] Receptor de clientes iniciado.'
  );
}

module.exports = {
  iniciar,
  enviar,
  teclado
};
