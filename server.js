const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let FormData = null;

try {
  FormData = require('form-data');
} catch (e) {
  console.log('⚠️ Falta form-data. Corre: npm install form-data');
}

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, X-Cliente-Token");
  next();
});





require('./cq_jean_cliente_v7')(app); // CQ_JEAN_CLIENTE_V7
require('./cliente_portal')(app);
require('./cq_agenda_cliente')(app); // CQ_AGENDA_CLIENTE_V10_CORREGIDA
require('./cliente_api')(app, {
  enviarTexto,
  enviarConBotonesCliente: (texto, chatId, cliente, id) =>
    apiTelegram('sendMessage', {
      chat_id: chatId,
      text: texto,
      reply_markup: require('./cliente_botones').botones(cliente, id)
    })
});

// CQ3_LOBO_ACCION_V2
const cq3LoboOrigenes = new Set([
  'https://megapersonals.eu',
  'https://www.megapersonals.eu'
]);

app.options('/accion', (req, res, next) => {
  if (!cq3LoboOrigenes.has(req.get('origin'))) {
    return next();
  }

  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers',
    'Content-Type, X-Cliente-Token');
  res.set('Vary', 'Origin');

  return res.sendStatus(204);
});

app.post('/accion', async (req, res, next) => {
  if (!cq3LoboOrigenes.has(req.get('origin'))) {
    return next();
  }

  const id = String(req.body?.id || '');
  const accion = String(req.body?.accion || '');

  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id) ||
      !['pausar', 'reanudar'].includes(accion)) {
    return res.status(400).json({
      ok: false, error: 'Orden no permitida'
    });
  }

  const perfil = leerData()[id];

  if (!perfil) {
    return res.status(404).json({
      ok: false, error: 'Perfil no encontrado'
    });
  }

  const esperado = String(perfil.cliente_token || '').trim();
  const recibido = String(req.get('x-cliente-token') || '').trim();

  if (!esperado || !recibido) {
    // CQ3_LOBO_AUTH_LOG_V2
    console.warn('[CQ3_LOBO_AUTH]', !esperado ? 'PERFIL_SIN_TOKEN' : 'LOBO_SIN_TOKEN');
    return res.status(401).json({
      ok: false, error: !esperado ? 'PERFIL_SIN_TOKEN' : 'LOBO_SIN_TOKEN'
    });
  }

  const a = Buffer.from(recibido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');

  if (a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
    console.warn('[CQ3_LOBO_AUTH] TOKEN_NO_COINCIDE');
    return res.status(401).json({
      ok: false, error: 'TOKEN_NO_COINCIDE'
    });
  }

  const estado = accion === 'pausar' ? 'PAUSADA' : 'ACTIVA';

  if (!cambiarEstadoPerfil(id, estado)) {
    return res.status(409).json({
      ok: false,
      error: 'Estado no guardado o plan vencido'
    });
  }

  try {
    await enviarEstadoPerfil(id);
  } catch (e) {
    console.error('Aviso Telegram CQ3:', e.message);
  }

  return res.json({ ok: true, estado });
});

require('./seguridad_admin')(app);
require('./admin_api')(app);
const PORT = Number(process.env.PORT || 3003);

// CAMBIA ESTAS 4 COSAS
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHAT_ID = '';
const SUPPORT_URL = 'https://t.me/tu_soporte';
const RULES_TEXT = `📜 Reglas del sistema

1. Usa el panel para controlar estados.
2. Verifica tus perfiles antes de trabajar.
3. Las fotos pueden no ser en vivo.
4. Si necesitas ayuda, usa el botón Contactar.`;

// archivos locales
const DATA_FILE = path.join(__dirname, 'data.json');
const STATE_FILE = path.join(__dirname, 'bot_state.json');
const DATA_BACKUP_FILE = path.join(__dirname, 'data.backup.json');
const STATE_BACKUP_FILE = path.join(__dirname, 'bot_state.backup.json');

// =========================
// BLOQUEOS DE CICLO
// =========================
let telegramEnProceso = false;
let cicloEnProceso = false;

// =========================
// COLA DE REANUDACIÓN
// =========================
let colaReanudacion = null;
let colaTimeout = null;
let colaVersion = 0;

function cancelarColaReanudacion() {
  if (colaTimeout) {
    clearTimeout(colaTimeout);
    colaTimeout = null;
  }

  colaReanudacion = null;
  colaVersion += 1;
}

// =========================
// UTILIDADES SEGURAS JSON
// =========================
function existeArchivoSeguro(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function copiarArchivoSiExiste(origen, destino) {
  try {
    if (existeArchivoSeguro(origen)) {
      fs.copyFileSync(origen, destino);
      return true;
    }
  } catch (e) {
    console.log(`No se pudo crear backup de ${origen}:`, e.message);
  }
  return false;
}

function guardarJSONSeguro(file, backupFile, data) {
  const tempFile = `${file}.tmp`;

  try {
    if (existeArchivoSeguro(file)) {
      copiarArchivoSiExiste(file, backupFile);
    }

    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
    return true;
  } catch (e) {
    console.log(`Error guardando ${file}:`, e.message);

    try {
      if (existeArchivoSeguro(tempFile)) fs.unlinkSync(tempFile);
    } catch {}

    return false;
  }
}

function leerJSONSeguro(file, backupFile, fallback, opciones = {}) {
  const { protegerContraVacio = false } = opciones;

  if (!existeArchivoSeguro(file)) {
    guardarJSONSeguro(file, backupFile, fallback);
    return fallback;
  }

  try {
    const raw = fs.readFileSync(file, 'utf8');

    if (protegerContraVacio && (!raw || !raw.trim())) {
      throw new Error('Archivo vacío');
    }

    const parsed = JSON.parse(raw);

    if (
      protegerContraVacio &&
      (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      )
    ) {
      throw new Error('JSON inválido para objeto principal');
    }

    return parsed;
  } catch (e) {
    console.log(`Error leyendo ${file}:`, e.message);
  }

  if (existeArchivoSeguro(backupFile)) {
    try {
      const rawBackup = fs.readFileSync(backupFile, 'utf8');

      if (protegerContraVacio && (!rawBackup || !rawBackup.trim())) {
        throw new Error('Backup vacío');
      }

      const parsedBackup = JSON.parse(rawBackup);

      if (
        protegerContraVacio &&
        (
          parsedBackup === null ||
          typeof parsedBackup !== 'object' ||
          Array.isArray(parsedBackup)
        )
      ) {
        throw new Error('Backup inválido');
      }

      console.log(`Recuperado desde backup: ${backupFile}`);
      guardarJSONSeguro(file, backupFile, parsedBackup);
      return parsedBackup;
    } catch (e) {
      console.log(`Error leyendo backup ${backupFile}:`, e.message);
    }
  }

  return fallback;
}

function leerData() {
  return leerJSONSeguro(DATA_FILE, DATA_BACKUP_FILE, {}, { protegerContraVacio: true });
}

function leerState() {
  return leerJSONSeguro(
    STATE_FILE,
    STATE_BACKUP_FILE,
    {
      offset: 0,
      schedules: [],
      esperandoFoto: null
    },
    { protegerContraVacio: false }
  );
}

function guardarData(data) {
  return guardarJSONSeguro(DATA_FILE, DATA_BACKUP_FILE, data);
}

function guardarState(state) {
  return guardarJSONSeguro(STATE_FILE, STATE_BACKUP_FILE, state);
}

function horaActual() {
  return new Date().toLocaleString();
}

function fechaHoy() {
  return new Date().toISOString().slice(0, 10);
}

function generarTokenAcceso() {
  const parte1 = Math.floor(1000 + Math.random() * 9000);
  const parte2 = Math.random().toString(36).slice(2, 6).toUpperCase();
  const parte3 = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${parte1}-${parte2}-${parte3}`;
}

function asegurarPerfil(data, id) {
  if (!data[id]) {
    data[id] = {
      nombre: `Perfil ${id}`,
      chat_id: '',
      cliente_token: '',
      telefono: '',
      codigo: '',
      ubicacion: '',
      texto: '',
      estado: 'ACTIVA',
      foto_modelo: 'https://picsum.photos/400/260',
      foto_pagina: 'https://picsum.photos/420/280',
      foto_bump: '',
      historial_fotos: [],
      ultima_hora: 'N/A',
      proximo_post: '16m',
      proximo_post_ts: null,
      fin_plan: new Date(Date.now() + 7 * 86400000).toISOString(),
      ultima_accion: 'Creado',
      ultimo_evento: null,
      bump_hoy: 0,
      bump_total: 0,
      bump_fecha: ''
    };
  } else {
    if (typeof data[id].bump_hoy !== 'number') data[id].bump_hoy = 0;
    if (typeof data[id].bump_total !== 'number') data[id].bump_total = 0;
    if (typeof data[id].bump_fecha !== 'string') data[id].bump_fecha = '';
    if (!('proximo_post_ts' in data[id])) data[id].proximo_post_ts = null;
    if (!Array.isArray(data[id].historial_fotos)) data[id].historial_fotos = [];
    if (!data[id].estado) data[id].estado = 'ACTIVA';
    if (!('cliente_token' in data[id])) data[id].cliente_token = '';
    if (!('foto_bump' in data[id])) data[id].foto_bump = '';
    if (!('foto_modelo' in data[id])) data[id].foto_modelo = 'https://picsum.photos/400/260';
    if (!('foto_pagina' in data[id])) data[id].foto_pagina = 'https://picsum.photos/420/280';
  }
}

function resetBumpSiCambioDia(perfil) {
  const hoy = fechaHoy();
  if (perfil.bump_fecha !== hoy) {
    perfil.bump_fecha = hoy;
    perfil.bump_hoy = 0;
  }
}

function tiempoRestante(ts) {
  if (!ts) return 'N/A';
  const faltan = Math.max(0, ts - Date.now());
  const totalSeg = Math.floor(faltan / 1000);
  const m = Math.floor(totalSeg / 60);
  const s = totalSeg % 60;
  return `${m}m ${s}s`;
}

function tiempoProximoPost(perfil) {
  return perfil.proximo_post_ts
    ? tiempoRestante(perfil.proximo_post_ts)
    : (perfil.proximo_post || 'N/A');
}

function tiempoRestantePlan(fechaFin) {
  if (!fechaFin) return 'N/A';

  const ahora = new Date();
  const fin = new Date(fechaFin);

  if (isNaN(fin.getTime())) return fechaFin;

  const diff = fin - ahora;

  if (diff <= 0) return '❌ Vencido';

  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  const horas = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutos = Math.floor((diff / (1000 * 60)) % 60);
  const segundos = Math.floor((diff / 1000) % 60);

  return `${dias} días, ${horas}h ${minutos}m ${segundos}s`;
}

function planVencido(perfil) {
  if (!perfil || !perfil.fin_plan) return true;
  const fecha = Date.parse(perfil.fin_plan);
  if (!Number.isFinite(fecha)) return true;
  return fecha <= Date.now();
}

function puedeContarBump(perfil) {
  if (!perfil) return false;
  if (perfil.estado === 'PAUSADA') return false;
  if (planVencido(perfil)) return false;
  return true;
}

function convertirFinPlan(valor) {
  if (!valor) return '';

  const texto=String(valor).trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}(t\d{2}:\d{2}:\d{2})?$/.test(texto))
    return valor;

  const combinado=texto.match(
    /^(\d+)\s*d[ií]a?s?\s+(\d+)\s*horas?$/
  );

  if (combinado) {
    const dias=Number(combinado[1]);
    const horas=Number(combinado[2]);
    const ms=(dias*24+horas)*3600000;
    if (!Number.isSafeInteger(ms)) return valor;
    return new Date(Date.now()+ms-(ms===0?1000:0)).toISOString();
  }

  const m=texto.match(/^(\d+)\s*d[ií]a?s?$/);

  if (m) {
    const dias=Number(m[1]);
    if (dias===0)
      return new Date(Date.now()-1000).toISOString();

    const fecha=new Date();
    fecha.setDate(fecha.getDate()+dias);
    fecha.setHours(23,59,59,0);
    return fecha.toISOString();
  }

  return valor;
}

function tokenDesdeRequest(req) {
  return String(
    req.query?.token ||
    req.body?.token ||
    req.headers['x-cliente-token'] ||
    ''
  ).trim();
}

function tokenValidoParaPerfil(req, perfil) {
  const token = tokenDesdeRequest(req);

  if (!perfil.cliente_token) return true;

  return token === String(perfil.cliente_token).trim();
}

// =========================
// TELEGRAM
// =========================
function tecladoTelegram(id) {
  return {
    inline_keyboard: [
      [
        { text: '⏸ Pausar', callback_data: `pausar_${id}` },
        { text: '▶️ Reanudar', callback_data: `reanudar_${id}` }
      ],
      [
        { text: '⏸ Pausar todas', callback_data: 'pausar_todas' },
        { text: '▶️ Reanudar todas', callback_data: 'reanudar_todas' }
      ],
      [
        { text: '⏰ Programar pausa', callback_data: `progpausa_${id}` },
        { text: '⏰ Programar reanudar', callback_data: `progreanudar_${id}` }
      ],
      [
        { text: '🕒 Último bump', callback_data: `ultima_${id}` }
      ],
      [
        { text: '🔄 Reiniciar bot', callback_data: `reiniciar_${id}` }
      ],
      [
        { text: '📞 Contactar', url: SUPPORT_URL },
        { text: '📜 Ver reglas', callback_data: 'reglas' }
      ],
      [
        { text: '📸 Ver una foto', callback_data: `foto_${id}` }
      ],
      [
        { text: '🗂 Ver álbum completo', callback_data: `album_${id}` }
      ]
    ]
  };
}

async function apiTelegram(method, payload) {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      payload,
      { timeout: 30000 }
    );
    return res.data;
  } catch (error) {
    const msg = error.response?.data || error.message || '';

    if (
      String(msg).includes('ECONNRESET') ||
      String(msg).includes('ETIMEDOUT') ||
      String(msg).includes('socket hang up')
    ) {
      return null;
    }

    console.log(`Error Telegram ${method}:`);
    console.log(msg);
    return null;
  }
}

async function apiTelegramForm(method, form) {
  try {
    const headers = form.getHeaders ? form.getHeaders() : {};

    const res = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      form,
      {
        headers,
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    return res.data;
  } catch (error) {
    console.log(`Error Telegram FORM ${method}:`);
    console.log(error.response?.data || error.message || error);
    return null;
  }
}

async function responderCallback(callbackQueryId, text = 'OK') {
  await apiTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text
  });
}

async function enviarTexto(texto, chatId = CHAT_ID, idTeclado = null) {
  await apiTelegram('sendMessage', {
    chat_id: chatId,
    text: texto,
    reply_markup: idTeclado ? tecladoTelegram(idTeclado) : undefined
  });
}

async function enviarFoto(photo, caption, id) {
  const data = leerData();
  const perfil = data[id];
  const destino = perfil?.chat_id || CHAT_ID;

  const res = await apiTelegram('sendPhoto', {
    chat_id: destino,
    photo,
    caption,
    reply_markup: tecladoTelegram(id)
  });

  if (!res || !res.ok) {
    await apiTelegram('sendMessage', {
      chat_id: destino,
      text: caption,
      reply_markup: tecladoTelegram(id)
    });
  }

  return !!(res && res.ok);
}

function esImagenBase64(valor) {
  return typeof valor === 'string' && valor.startsWith('data:image/');
}

function bufferDesdeBase64(valor) {
  const limpio = String(valor || '').replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(limpio, 'base64');
}

async function enviarBufferComoFoto(buffer, caption, id, filename = 'ultimo_bump.jpg') {
  const data = leerData();
  const perfil = data[id];
  const destino = perfil?.chat_id || CHAT_ID;

  if (!FormData) {
    await enviarTexto('⚠️ Falta form-data. Corre: npm install form-data', destino, id);
    return false;
  }

  const form = new FormData();
  form.append('chat_id', String(destino));
  form.append('caption', caption);
  form.append('reply_markup', JSON.stringify(tecladoTelegram(id)));
  form.append('photo', buffer, {
    filename,
    contentType: 'image/jpeg'
  });

  const res = await apiTelegramForm('sendPhoto', form);

  if (res && res.ok) return true;

  await apiTelegram('sendMessage', {
    chat_id: destino,
    text: caption,
    reply_markup: tecladoTelegram(id)
  });

  return false;
}

async function enviarFotoFlexible(photo, caption, id) {
  if (esImagenBase64(photo)) {
    try {
      const buffer = bufferDesdeBase64(photo);
      return await enviarBufferComoFoto(buffer, caption, id, `ultimo_bump_${id}.jpg`);
    } catch (e) {
      console.log('No se pudo enviar foto base64:', e.message);
      return false;
    }
  }

  return await enviarFoto(photo, caption, id);
}

// =========================
// ESTADOS
// =========================
function cambiarEstadoPerfil(id, estado) {
  const data = leerData();
  if (!data[id]) return false;

  asegurarPerfil(data, id);

  if (estado === 'ACTIVA' && planVencido(data[id])) {
    return false;
  }

  if (estado === 'PAUSADA' && Array.isArray(colaReanudacion)) {
    colaReanudacion = colaReanudacion.filter(x => String(x) !== String(id));
  }

  data[id].estado = estado;
  data[id].ultima_hora = horaActual();
  data[id].ultima_accion = estado === 'ACTIVA' ? 'Reanudado' : 'Pausado';

  return guardarData(data);
}

function cambiarEstadoTodos(estado) {
  if (estado === 'PAUSADA') {
    cancelarColaReanudacion();
  }

  const data = leerData();

  for (const id of Object.keys(data)) {
    asegurarPerfil(data, id);
    if (estado === 'ACTIVA' && planVencido(data[id])) continue;
    data[id].estado = estado;
    data[id].ultima_hora = horaActual();
    data[id].ultima_accion =
      estado === 'ACTIVA' ? 'Reanudado globalmente' : 'Pausado globalmente';
  }

  guardarData(data);
}

function resetearAccesoPerfil(id) {
  const data = leerData();
  if (!data[id]) return null;

  asegurarPerfil(data, id);

  const nuevoToken = generarTokenAcceso();

  data[id].cliente_token = nuevoToken;
  data[id].estado = 'PAUSADA';

  // LIMPIEZA COMPLETA PARA CLIENTE NUEVO
  data[id].telefono = '';
  data[id].codigo = '';
  data[id].ubicacion = '';
  data[id].texto = '';

  // BORRAR FOTOS VIEJAS
  data[id].foto_modelo = 'https://picsum.photos/400/260';
  data[id].foto_pagina = 'https://picsum.photos/420/280';
  data[id].foto_bump = '';
  data[id].historial_fotos = [];

  // RESETEAR CONTADORES
  data[id].bump_hoy = 0;
  data[id].bump_total = 0;
  data[id].bump_fecha = '';
  data[id].proximo_post = '16m';
  data[id].proximo_post_ts = null;

  // LIMPIAR EVENTOS
  data[id].ultimo_evento = null;
  data[id].ultima_hora = horaActual();
  data[id].ultima_accion = `Acceso reseteado y perfil limpiado. Nueva clave: ${nuevoToken}`;

  const ok = guardarData(data);

  if (!ok) return null;

  return nuevoToken;
}

function limpiarProgramacionesPerfil(id) {
  const state = leerState();

  if (!Array.isArray(state.schedules)) {
    state.schedules = [];
  }

  const antes = state.schedules.length;

  state.schedules = state.schedules.filter(item => {
    return String(item.id) !== String(id);
  });

  const borradas = antes - state.schedules.length;

  if (borradas > 0) {
    guardarState(state);
  }

  return borradas;
}

function borrarPerfil(id) {
  const data = leerData();

  if (!data[id]) return false;

  // Quitar de la cola de reanudación si estaba pendiente
  if (Array.isArray(colaReanudacion)) {
    colaReanudacion = colaReanudacion.filter(x => String(x) !== String(id));

    if (colaReanudacion.length === 0) {
      cancelarColaReanudacion();
    }
  }

  // Borrar programaciones pendientes de ese perfil
  limpiarProgramacionesPerfil(id);

  // Borrar perfil completo del data.json
  delete data[id];

  return guardarData(data);
}


const cq3Pendientes = new Map();

function cq3Clave(chat, usuario) {
  return String(chat) + ':' + String(usuario);
}

function cq3Fecha(texto) {
  const intervalo = String(texto).trim().toUpperCase()
    .match(/^EN\s+(\d+)\s*(MIN|MINUTO|MINUTOS)$/);

  if (intervalo) {
    const minutos = Number(intervalo[1]);
    if (!Number.isSafeInteger(minutos) ||
        minutos < 1 || minutos > 10080) {
      throw Error('Indica entre 1 y 10080 minutos.');
    }
    return Date.now() + minutos * 60000;
  }

  const m = String(texto).trim().toUpperCase().match(
    /^(HOY|MAÑANA|MANANA|\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/
  );
  if (!m) throw Error('Formato inválido. Ejemplo: MAÑANA 2:00 AM');

  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());

  const dato = t => Number(partes.find(x => x.type === t).value);
  let anio = dato('year');
  let mes = dato('month');
  let dia = dato('day');

  if (m[1] === 'MAÑANA' || m[1] === 'MANANA') {
    const d = new Date(Date.UTC(anio, mes - 1, dia + 1));
    anio = d.getUTCFullYear();
    mes = d.getUTCMonth() + 1;
    dia = d.getUTCDate();
  } else if (m[1] !== 'HOY') {
    const p = m[1].split('/').map(Number);
    dia = p[0];
    mes = p[1];
    if (p.length === 3) anio = p[2];
  }

  let hora = Number(m[2]);
  const minuto = Number(m[3]);
  const periodo = m[4];

  if (minuto > 59 || (periodo && (hora < 1 || hora > 12)) ||
      (!periodo && hora > 23)) {
    throw Error('La hora no es válida.');
  }

  if (periodo) {
    hora = hora % 12 + (periodo === 'PM' ? 12 : 0);
  }

  const d = new Date(Date.UTC(anio, mes - 1, dia));

  if (d.getUTCFullYear() !== anio ||
      d.getUTCMonth() + 1 !== mes ||
      d.getUTCDate() !== dia) {
    throw Error('La fecha no es válida.');
  }

  const timestamp = Date.UTC(anio, mes - 1, dia, hora + 4, minuto);

  if (timestamp <= Date.now()) {
    throw Error('La fecha y hora deben ser futuras.');
  }

  return timestamp;
}

function cq3Formato(timestamp) {
  return new Date(timestamp).toLocaleString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

async function cq3IniciarProgramacion(q, id, accion, chatId) {
  if (id !== '__TODAS__' && !Object.prototype.hasOwnProperty.call(leerData(), id)) {
    await responderCallback(q.id, 'Perfil no encontrado');
    return;
  }

  cq3Pendientes.set(cq3Clave(chatId, q.from?.id), { id, accion });

  const existente = (leerState().schedules || []).find(
    x => String(x.id) === String(id) && x.accion === accion
  );

  const nombre = id === '__TODAS__' ? (accion === 'PAUSADA' ? 'PAUSAR TODAS' : 'REANUDAR TODAS') : (accion === 'PAUSADA' ? 'PAUSAR' : 'REANUDAR');

  await responderCallback(q.id, 'Introduce fecha y hora');

  await enviarTexto(
    '⏰ PROGRAMACIÓN\n\n' +
    'Alcance: ' + (id === '__TODAS__' ? 'TODAS LAS PAGINAS' : 'Perfil ID ' + id) + '\n' +
    'Acción: ' + nombre + '\n' +
    'Estado actual: ' +
    (existente ? cq3Formato(existente.ejecutarEn) : 'No programado') +
    '\n\nEscribe fecha y hora:\n\n' +
    'HOY 5:00 AM\n' +
    'MAÑANA 2:00 AM\n' +
    '09/05 5:00 AM\n\n' +
    'Formato: DÍA/MES HORA\n' +
    'Zona horaria: República Dominicana\n\n' +
    'Escribe CANCELAR para quitar esa programación.',
    chatId
  );
}

async function cq3LeerProgramacion(msg) {
  const chatId = msg.chat?.id;
  const key = cq3Clave(chatId, msg.from?.id);
  const pendiente = cq3Pendientes.get(key);

  if (!pendiente) return false;

  const texto = String(msg.text || '').trim();
  if (!texto) return false;

  const { id, accion } = pendiente;

  if (texto.toUpperCase() === 'CANCELAR') {
    const estado = leerState();
    const antes = (estado.schedules || []).length;

    estado.schedules = (estado.schedules || []).filter(
      x => !(String(x.id) === String(id) && x.accion === accion)
    );

    guardarState(estado);
    cq3Pendientes.delete(key);

    await enviarTexto(
      antes !== estado.schedules.length
        ? '✅ PROGRAMACIÓN CANCELADA\nPerfil ID: ' + id
        : '✅ No había una programación pendiente para el perfil ' + id,
      chatId
    );
    return true;
  }

  try {
    const ejecutarEn = cq3Fecha(texto);
    const estado = leerState();

    estado.schedules = (estado.schedules || []).filter(
      x => !(String(x.id) === String(id) && x.accion === accion)
    );

    estado.schedules.push({ id, accion, ejecutarEn });

    if (!guardarState(estado)) {
      throw Error('No se pudo guardar la programación.');
    }

    cq3Pendientes.delete(key);

    await enviarTexto(
      '✅ PROGRAMACIÓN GUARDADA\n\n' +
      'Alcance: ' + (id === '__TODAS__' ? 'TODAS LAS PAGINAS' : 'Perfil ID ' + id) + '\n' +
      'Acción: ' + (accion === 'PAUSADA' ? 'PAUSAR' : 'REANUDAR') +
      '\nFecha y hora: ' + cq3Formato(ejecutarEn) +
      '\nZona horaria: República Dominicana',
      chatId
    );
  } catch (e) {
    await enviarTexto(
      '⚠️ ' + e.message +
      '\n\nIntenta de nuevo o escribe CANCELAR.',
      chatId
    );
  }

  return true;
}

function programarAccion(id, accion, minutos = 30) {
  const state = leerState();
  state.schedules.push({
    id,
    accion,
    ejecutarEn: Date.now() + minutos * 60 * 1000
  });
  guardarState(state);
}

// =========================
// MENSAJES
// =========================
async function enviarEstadoPerfil(id) {
  const data = leerData();
  const perfil = data[id];
  if (!perfil) return;

  const caption = `🔥 jean calos BOT 🔥

Perfil: ${perfil.nombre}
📞 Teléfono: ${perfil.telefono}
🆔 Código: ${perfil.codigo}
📍 Ubicación: ${perfil.ubicacion}
🟢 Estado: ${perfil.estado}
🕒 Hora: ${perfil.ultima_hora}
⏱ Próximo bump: ${tiempoProximoPost(perfil)}
📅 Tiempo para acabar plan: ${tiempoRestantePlan(perfil.fin_plan)}
📊 Bump hoy: ${perfil.bump_hoy || 0}
📈 Bump total: ${perfil.bump_total || 0}`;

  await enviarFoto(perfil.foto_modelo, caption, id);
}

async function enviarUltimaActualizacion(id) {
  const data = leerData();
  const perfil = data[id];
  if (!perfil) return;

  const caption = `🔥 ÚLTIMO BUMP
🐺 Los lobos del sistema te desean mucho éxito
💰 Que esta publicación te genere mucho dinero
🚀 Y que la próxima te deje aún más ganancias
📄 Información:

📞 Número: ${perfil.telefono}
🆔 Código: ${perfil.codigo}
📍 Ubicación: ${perfil.ubicacion}
📝 Texto: ${perfil.texto || 'N/A'}
🟢 Estado: ${perfil.estado}
🕒 Hora del bump: ${perfil.ultima_hora}
⏱ Tiempo para próximo bump: ${tiempoProximoPost(perfil)}
📅 Tiempo para acabar plan: ${tiempoRestantePlan(perfil.fin_plan)}

📊 Bump hoy: ${perfil.bump_hoy || 0}
📈 Bump total: ${perfil.bump_total || 0}`;

  if (perfil.foto_bump) {
    const ok = await enviarFotoFlexible(perfil.foto_bump, caption, id);
    if (ok) return;
  }

  await enviarFoto(perfil.foto_modelo, caption, id);
}

async function enviarFotoPagina(id) {
  const data = leerData();
  const perfil = data[id];
  if (!perfil) return;

  const caption = `📸 Foto guardada

📞 Número: ${perfil.telefono}
🆔 Código: ${perfil.codigo}`;

  await enviarFoto(perfil.foto_pagina, caption, id);
}

async function enviarUltimasFotos(id, cantidad) {
  const data = leerData();
  const perfil = data[id];
  if (!perfil) return;

  const fotos = Array.isArray(perfil.historial_fotos) ? perfil.historial_fotos : [];

  if (fotos.length === 0) {
    await enviarTexto(`⚠️ No hay fotos guardadas para el perfil ${id}`);
    return;
  }

  const lista = fotos.slice(0, cantidad);

  for (let i = 0; i < lista.length; i++) {
    await enviarFoto(lista[i], `📂 Foto ${i + 1} de ${lista.length}`, id);
  }
}

async function enviarAlbumCompleto(id) {
  const data = leerData();
  const perfil = data[id];
  if (!perfil) return;

  const destino = perfil?.chat_id || CHAT_ID;
  const fotos = Array.isArray(perfil.historial_fotos) ? perfil.historial_fotos : [];

  if (fotos.length === 0) {
    await enviarTexto(`⚠️ No hay fotos guardadas para el perfil ${id}`, destino, id);
    return;
  }

  const lista = fotos.filter(Boolean).slice(0, 10);

  if (lista.length === 1) {
    await enviarFoto(lista[0], `🗂 Álbum completo\nFoto 1 de 1`, id);
    return;
  }

  const media = lista.map((foto, index) => ({
    type: 'photo',
    media: foto,
    caption: index === 0 ? `🗂 Álbum completo\n${lista.length} fotos guardadas` : undefined
  }));

  const res = await apiTelegram('sendMediaGroup', {
    chat_id: destino,
    media
  });

  if (!res || !res.ok) {
    await enviarUltimasFotos(id, 10);
    return;
  }

  await enviarTexto('🗂 Álbum completo enviado.', destino, id);
}

async function enviarReglas(chatId = CHAT_ID) {
  await enviarTexto(RULES_TEXT, chatId);
}

// =========================
// API LOCAL
// =========================
app.get('/api/licencia/:id', (req, res) => {
  try {
    const id = req.params.id;
    const token = req.query.token || '';

    const data = leerData();
    const perfil = data[id];

    if (!perfil) {
      return res.json({
        ok: false,
        estado: 'NO_EXISTE',
        motivo: 'Perfil no existe'
      });
    }

    if (perfil.cliente_token && token !== perfil.cliente_token) {
      return res.json({
        ok: false,
        estado: 'TOKEN_INVALIDO',
        motivo: 'Token inválido'
      });
    }

    if (perfil.estado === 'PAUSADA') {
      return res.json({
        ok: false,
        estado: 'PAUSADA',
        motivo: 'Cliente pausado desde el panel'
      });
    }

    if (planVencido(perfil)) {
      return res.json({
        ok: false,
        estado: 'VENCIDA',
        motivo: 'Plan vencido'
      });
    }

    return res.json({
      ok: true,
      estado: 'ACTIVA',
      motivo: 'Licencia activa'
    });
  } catch (error) {
    console.log('Error en /api/licencia/:id =>', error?.message || error);

    return res.json({
      ok: false,
      estado: 'ERROR',
      motivo: 'Error verificando licencia'
    });
  }
});

app.get('/api/estado/:id', (req, res) => {
  try {
    const data = leerData();
    const perfil = data[req.params.id];

    if (!perfil) {
      return res.json({
        estado: 'NO_EXISTE',
        motivo: 'Perfil no existe'
      });
    }

    if (planVencido(perfil)) {
      return res.json({
        estado: 'VENCIDA',
        motivo: 'Plan vencido o sin fecha valida'
      });
    }

    if (perfil.estado === 'PAUSADA') {
      return res.json({
        estado: 'PAUSADA',
        motivo: 'Pausada por orden explícita del panel'
      });
    }

    return res.json({
      estado: 'ACTIVA',
      motivo: 'Modo seguro: solo se pausa por orden explícita'
    });
  } catch (error) {
    console.log('Error en /api/estado/:id =>', error?.message || error);

    return res.json({
      estado: 'ERROR',
      motivo: 'Fallo del panel/lectura'
    });
  }
});

app.post('/registrar-evento', async (req, res) => {
  const {
    id,
    tipo = 'silencioso',
    telefono,
    codigo,
    ubicacion,
    texto,
    foto_modelo,
    foto_pagina,
    foto_bump,
    foto_bump_base64,
    fotos_pagina,
    fin_plan,
    ultima_accion,
    ultima_hora,
    minutos_siguientes = 16
  } = req.body;

  if (!id) {
    return res.status(400).json({ ok: false, error: 'Falta id' });
  }

  const tipoNormal = String(tipo || 'silencioso').trim().toLowerCase();

  const data = leerData();
  asegurarPerfil(data, id);

  const perfil = data[id];

  if (!tokenValidoParaPerfil(req, perfil)) {
    return res.status(403).json({
      ok: false,
      estado: 'TOKEN_INVALIDO',
      error: 'Token inválido para registrar evento'
    });
  }

  if (telefono) perfil.telefono = telefono;
  if (codigo) perfil.codigo = codigo;
  if (ubicacion) perfil.ubicacion = ubicacion;
  if (typeof texto === 'string') perfil.texto = texto;

  // IMPORTANTE:
  // /registrar-evento NO puede cambiar estado.
  // Solo el panel/botones pueden poner ACTIVA o PAUSADA.

  if (foto_modelo) perfil.foto_modelo = foto_modelo;
  if (foto_pagina) perfil.foto_pagina = foto_pagina;

  const pruebaBump = foto_bump_base64 || foto_bump;
  if (pruebaBump && typeof pruebaBump === 'string') {
    perfil.foto_bump = pruebaBump;
  }

  if (Array.isArray(fotos_pagina)) {
    const fotosLimpias = fotos_pagina
      .filter(foto => foto && typeof foto === 'string')
      .slice(0, 10);

    if (fotosLimpias.length >= 3) {
      perfil.historial_fotos = fotosLimpias;
      perfil.foto_pagina = fotosLimpias[0] || perfil.foto_pagina;
      perfil.foto_modelo = fotosLimpias[0] || perfil.foto_modelo;
    } else if (
      fotosLimpias.length === 1 &&
      (!Array.isArray(perfil.historial_fotos) || perfil.historial_fotos.length === 0)
    ) {
      perfil.historial_fotos = fotosLimpias;
      perfil.foto_pagina = fotosLimpias[0];
      perfil.foto_modelo = fotosLimpias[0];
    }
  }

  // La vigencia se administra desde el panel.
  // Los eventos del motor no pueden renovarla.

  perfil.ultima_hora = ultima_hora || horaActual();
  perfil.ultima_accion = ultima_accion || tipoNormal;
  perfil.ultimo_evento = { tipo: tipoNormal, hora: perfil.ultima_hora };

  let contarBump = false;

  if (tipoNormal === 'publicado') {
    if (puedeContarBump(perfil)) {
      contarBump = true;

      resetBumpSiCambioDia(perfil);
      perfil.bump_hoy = (perfil.bump_hoy || 0) + 1;
      perfil.bump_total = (perfil.bump_total || 0) + 1;
      perfil.bump_fecha = fechaHoy();
      perfil.proximo_post_ts = Date.now() + Number(minutos_siguientes) * 60 * 1000;
      perfil.proximo_post = tiempoProximoPost(perfil);
      perfil.ultima_accion = ultima_accion || 'Publicado con éxito';
    } else {
      perfil.ultima_accion = `Publicado ignorado: perfil ${perfil.estado}${planVencido(perfil) ? ' / vencido' : ''}`;
      perfil.ultimo_evento = {
        tipo: 'publicado_ignorado',
        hora: perfil.ultima_hora,
        motivo: perfil.estado === 'PAUSADA' ? 'PAUSADA' : (planVencido(perfil) ? 'VENCIDA' : 'BLOQUEADO')
      };
    }
  }

  const ok = guardarData(data);

  if (!ok) {
    return res.status(500).json({ ok: false, error: 'No se pudo guardar data.json' });
  }

  if (contarBump) {
    await enviarUltimaActualizacion(id);
  }

  res.json({
    ok: true,
    tipo: tipoNormal,
    bump_contado: contarBump,
    perfil: data[id]
  });
});

// =========================
// TELEGRAM CALLBACKS
// =========================
async function procesarCallback(q) {
  if (await require('./cliente_botones').manejar(q,apiTelegram)) return;
  const data = q.data || '';
  const callbackId = q.id;
  const chatId = q.message?.chat?.id || CHAT_ID;

  if (data === 'pausar_todas') {
    cancelarColaReanudacion();
    cambiarEstadoTodos('PAUSADA');
    await responderCallback(callbackId, 'Todas pausadas');
    await enviarTexto('⏸ Todas las páginas quedaron en PAUSADA. Cola cancelada.', chatId);
    return;
  }

  if (data === 'reanudar_todas') {
    reanudarTodasEnCola();
    await responderCallback(callbackId, 'Reanudando en cola');
    await enviarTexto('▶️ Reanudando todas en cola cada 45 segundos.', chatId);
    return;
  }

  if (data === 'reglas') {
    await responderCallback(callbackId, 'Reglas');
    await enviarReglas(chatId);
    return;
  }

  const [accion, id] = data.split('_');
  if (!id) {
    await responderCallback(callbackId, 'Acción inválida');
    return;
  }

  if (accion === 'pausar') {
    cambiarEstadoPerfil(id, 'PAUSADA');
    await responderCallback(callbackId, 'Perfil pausado');
    await enviarEstadoPerfil(id);
    return;
  }

  if (accion === 'reanudar') {
    cambiarEstadoPerfil(id, 'ACTIVA');
    await responderCallback(callbackId, 'Perfil reanudado');
    await enviarEstadoPerfil(id);
    return;
  }

  if (accion === 'progpausa') {
    await cq3IniciarProgramacion(q, '__TODAS__', 'PAUSADA', chatId);
    return;
  }

  if (accion === 'progreanudar') {
    await cq3IniciarProgramacion(q, '__TODAS__', 'ACTIVA', chatId);
    return;
  }

  if (accion === 'ultima') {
    await responderCallback(callbackId, 'Último bump');
    await enviarUltimaActualizacion(id);
    return;
  }

  if (accion === 'foto') {
    await responderCallback(callbackId, 'Foto enviada');
    await enviarFotoPagina(id);
    return;
  }

  if (accion === 'album') {
    await responderCallback(callbackId, 'Enviando álbum completo...');
    await enviarAlbumCompleto(id);
    return;
  }

  if (accion === 'reiniciar') {
    const ok = cambiarEstadoPerfil(id, 'ACTIVA');
    await responderCallback(callbackId, ok ? 'Bot reiniciado' : 'No encontrado');
    if (ok) {
      await enviarTexto(`🔄 Perfil ${id} reiniciado y puesto en ACTIVA.`, chatId);
      await enviarEstadoPerfil(id);
    }
    return;
  }

  await responderCallback(callbackId, 'No manejado');
}

async function revisarTelegram() {
  if (telegramEnProceso) return;
  telegramEnProceso = true;

  try {
    const state = leerState();

    const updates = await apiTelegram('getUpdates', {
      offset: state.offset + 1,
      timeout: 10
    });

    if (!updates || !updates.ok || !Array.isArray(updates.result)) {
      return;
    }

    for (const u of updates.result) {
      state.offset = u.update_id;

      if (u.callback_query) {
        await procesarCallback(u.callback_query);
      }

      if (u.message) {
        const msg = u.message;
        const chatId = msg.chat?.id || CHAT_ID;

        if (msg.text) {
          const texto = msg.text.trim().toUpperCase();

          if (await cq3LeerProgramacion(msg)) {
            state.schedules = leerState().schedules;
            guardarState(state);
            continue;
          }

          if (/^P\d+$/.test(texto)) {
            const id = texto.replace('P', '');
            const data = leerData();
            asegurarPerfil(data, id);
            guardarData(data);

            state.esperandoFoto = id;
            guardarState(state);

            await enviarTexto(`📸 Ahora envía la foto para el perfil ${id}`, chatId);
          }
        }

        if (msg.photo) {
          const id = state.esperandoFoto;

          if (!id) {
            await enviarTexto('⚠️ Primero escribe P + número. Ejemplo: P15', chatId);
            continue;
          }

          const data = leerData();
          asegurarPerfil(data, id);

          const fileId = msg.photo[msg.photo.length - 1].file_id;

          data[id].foto_modelo = fileId;
          data[id].foto_pagina = fileId;

          if (!Array.isArray(data[id].historial_fotos)) {
            data[id].historial_fotos = [];
          }

          data[id].historial_fotos.unshift(fileId);
          data[id].historial_fotos = data[id].historial_fotos.slice(0, 10);

          data[id].ultima_hora = horaActual();
          data[id].ultima_accion = 'Foto guardada desde Telegram';

          guardarData(data);

          state.esperandoFoto = null;
          guardarState(state);

          await enviarTexto(`✅ Foto guardada para perfil ${id}`, chatId);
          await enviarFotoPagina(id);
        }
      }
    }

    state.schedules = leerState().schedules;
    guardarState(state);
  } catch (error) {
    console.log('Error en revisarTelegram:', error?.message || error);
  } finally {
    telegramEnProceso = false;
  }
}

async function ejecutarProgramaciones() {
  const state = leerState();
  const pendientes = [];
  let cambio = false;

  for (const item of state.schedules) {
    if (Date.now() >= item.ejecutarEn) {
      cambio = true;
      if (item.id === '__TODAS__') {
        cambiarEstadoTodos(item.accion);
      } else if (item.id === '__CQ3_WEB_TODAS__') {
        const permitidos = new Set(cq3IdsDePanel(item.cq3Scope));
        for (const id of permitidos) {
          if (permitidos.has(String(id))) {
            cambiarEstadoPerfil(String(id), item.accion);
          }
        }
      } else {
        cambiarEstadoPerfil(item.id, item.accion);
      }
      await enviarTexto(
        `⏰ Programación ejecutada\nAlcance: ${item.id === '__TODAS__' || item.id === '__CQ3_WEB_TODAS__' ? 'TODAS LAS PAGINAS' : item.id}\nNuevo estado: ${item.accion}`
      );
      if (item.id !== '__TODAS__' && item.id !== '__CQ3_WEB_TODAS__') await enviarEstadoPerfil(item.id);
    } else {
      pendientes.push(item);
    }
  }

  if (cambio) {
    state.schedules = pendientes;
    guardarState(state);
  }
}

// =========================
// PANEL WEB
// =========================

function cq3IdsDePanel(scope) {
  const datos = leerData();
  const cfg = cqPropietarios();
  const propietarios = cfg.propietarios || {};
  const ocultos = cfg.ocultarEnPrincipal || {};

  return Object.keys(datos).filter(id => {
    if (scope === 'principal') {
      return !Object.prototype.hasOwnProperty.call(ocultos, id);
    }
    return propietarios[id] === scope;
  });
}

function cqPantallaCompartida(req, res) {
  const todos = leerData();
  const data = {};

  if (req.cqClienteSeleccionado) {
    const cfg = JSON.parse((require('fs').existsSync(require('path').join(__dirname,'clientes_data','cq_propietarios_perfiles.json')) ? require('fs').readFileSync(require('path').join(__dirname,'clientes_data','cq_propietarios_perfiles.json'),'utf8') : '{}'));

    for (const id of Object.keys(todos)) {
      if ((cfg.propietarios || {})[id] ===
          req.cqClienteSeleccionado) {
        data[id] = todos[id];
      }
    }
  } else {
    // CQ_SEPARACION_SEGURA_V2
    const cfgPrincipal = JSON.parse(
      (require('fs').existsSync(require('path').join(__dirname,'clientes_data','cq_propietarios_perfiles.json')) ? require('fs').readFileSync(require('path').join(__dirname,'clientes_data','cq_propietarios_perfiles.json'),'utf8') : '{}')
    );

    const ocultos = cfgPrincipal.ocultarEnPrincipal || {};

    for (const id of Object.keys(todos)) {
      if (!Object.prototype.hasOwnProperty.call(ocultos, id)) {
        data[id] = todos[id];
      }
    }
  }
  let html = `
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>PANEL PRO</title>
    <style>
      body { background:#0b1c2c; color:white; font-family:Arial,sans-serif; margin:0; padding:20px; }
      h1, h2 { margin-top:0; }
      .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
      .card { background:#132f4c; padding:20px; border-radius:14px; }
      .row { margin:6px 0; }
      .estado { font-weight:bold; }
      button, .btn {
        margin:6px 6px 0 0; padding:10px 14px; border:none; border-radius:10px;
        cursor:pointer; font-weight:bold; text-decoration:none; display:inline-block;
      }
      .danger { background:#c62828; color:white; }
      .success { background:#2e7d32; color:white; }
      .info { background:#1565c0; color:white; }
      .muted { background:#455a64; color:white; }
      .warning { background:#ef6c00; color:white; }
      .small { font-size:12px; opacity:.9; }
      input, textarea, select {
        width:100%; padding:10px; border-radius:8px; border:none; margin-top:4px; margin-bottom:12px;
      }
      label { font-weight:bold; }
      .form-box { max-width:700px; background:#132f4c; padding:20px; border-radius:14px; }
    </style>
  </head>
  <body>
    <h1>🔥 PANEL PRO 🔥</h1>
    <div style="margin-bottom:16px;">
      <button class="danger" onclick="accionGlobal('pausar_todas')">⏸ Pausar todas</button>
      <button class="success" onclick="accionGlobal('reanudar_todas')">▶️ Reanudar todas</button>
      <a class="btn warning" href="/nuevo">➕ Nuevo perfil</a>
      <a class="btn info" href="/administracion">⚙️ Administrar clientes</a>
    </div>
    <div class="grid">
  `;

  for (const id of Object.keys(data)) {
    const p = data[id];
    const totalFotos = Array.isArray(p.historial_fotos) ? p.historial_fotos.length : 0;

    html += `
      <div class="card">
        <div class="row"><strong>${p.nombre}</strong></div>
        <div class="row">🆔 Perfil: ${id}</div>
        <div class="row">💬 Chat ID: ${p.chat_id || 'N/A'}</div>
        <div class="row">🔑 Cliente token: ${p.cliente_token || 'SIN CLAVE'}</div>
        <div class="row">📞 ${p.telefono || 'N/A'}</div>
        <div class="row">🆔 Código: ${p.codigo || 'N/A'}</div>
        <div class="row">📍 ${p.ubicacion || 'N/A'}</div>
        <div class="row estado">${planVencido(p) ? "❌ VENCIDA" : (p.estado === "ACTIVA" ? "🟢 ACTIVA" : "🔴 PAUSADA")}</div>
        <div class="row">🕒 ${p.ultima_hora}</div>
        <div class="row">⏱ Próximo bump: ${p.proximo_post_ts ? tiempoRestante(p.proximo_post_ts) : (p.proximo_post || 'N/A')}</div>
        <div class="row">📅 ${tiempoRestantePlan(p.fin_plan)}</div>
        <div class="row">📊 Bump hoy: ${p.bump_hoy || 0}</div>
        <div class="row">📈 Bump total: ${p.bump_total || 0}</div>
        <div class="row">🖼 Historial fotos: ${totalFotos}</div>
        <div class="row small">Última acción: ${p.ultima_accion || 'N/A'}</div>

        <button class="danger" onclick="accionPerfil('${id}','pausar')">⏸ Pausar</button>
        <button class="success" onclick="accionPerfil('${id}','reanudar')">▶️ Reanudar</button>
        <button class="warning" onclick="accionPerfil('${id}','resetacceso')">🔐 Resetear acceso</button>
        <button class="muted" onclick="accionPerfil('${id}','progpausa')">⏰ Programar pausa</button>
        <button class="muted" onclick="accionPerfil('${id}','progreanudar')">⏰ Programar reanudar</button>
        <button class="info" onclick="accionPerfil('${id}','ultima')">🕒 Último bump</button>
        <button class="info" onclick="accionPerfil('${id}','foto')">📸 Ver foto</button>
        <button class="muted" onclick="accionPerfil('${id}','reiniciar')">🔄 Reiniciar bot</button>
        <a class="btn warning" href="/editar/${id}">✏️ Editar</a>
        <button class="danger" onclick="accionPerfil('${id}','borrarperfil')">🗑️ Borrar perfil</button>
      </div>
    `;
  }

  html += `
    </div>
    <script>
      setInterval(() => {
        location.reload();
      }, 10000);

      async function accionPerfil(id, accion) {
        let fechaHora = null;
        const esProgramacion =
          accion === 'progpausa' || accion === 'progreanudar';

        if (esProgramacion) {
          fechaHora = prompt(
            '⏰ PROGRAMACIÓN - TODAS LAS PÁGINAS' +
            '\\n\\nEscribe fecha y hora:' +
            '\\nHOY 5:00 AM' +
            '\\nMAÑANA 2:00 AM' +
            '\\n09/05 5:00 AM' +
            '\\n\\nEscribe CANCELAR para quitarla.' +
            '\\n\\nHorario: República Dominicana'
          );

          if (fechaHora === null) return;
          fechaHora = fechaHora.trim();

          if (!fechaHora) {
            alert('Debes escribir fecha y hora.');
            return;
          }
        }
        if (accion === 'resetacceso') {
          const ok = confirm('¿Seguro que quieres resetear este perfil? Se borrarán fotos, datos viejos, contadores y la clave vieja dejará de funcionar.');
          if (!ok) return;
        }

        if (accion === 'borrarperfil') {
          const ok = confirm('¿Seguro que quieres BORRAR este perfil completo? Esta acción no se puede deshacer.');
          if (!ok) return;

          const ok2 = confirm('Última confirmación: se borrará el perfil, fotos, datos, token y programaciones pendientes.');
          if (!ok2) return;
        }

        try {
          const respuesta = await fetch('/accion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, accion, fechaHora })
          });

          if (esProgramacion) {
            const datos = await respuesta.json();

            if (!respuesta.ok || !datos.ok) {
              alert(datos.error || 'No se pudo programar.');
              return;
            }

            alert(datos.mensaje);
          } else if (!respuesta.ok) {
            alert('La acción no se completó.');
            return;
          }

          location.reload();
        } catch (error) {
          alert('Error de conexión. Intenta nuevamente.');
        }
      }

      async function accionGlobal(accion) {
        await fetch('/accion-global', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion })
        });
        location.reload();
      }
    </script>
  </body>
  </html>
  `;

  if (req.cqClienteSeleccionado) {
    const pref = '/admin/panel/' +
      encodeURIComponent(req.cqClienteSeleccionado);

    // Misma pantalla y tarjetas originales.
    html = html.replace(
      /<button[^>]+onclick="accionGlobal\([^"]+"[^>]*>[^<]*<\/button>/g,
      ''
    );

    html = html.replace('href="/nuevo"',
      'href="' + pref + '/nuevo"');

    html = html.replace('href="/administracion"',
      'href="/administracion"');

    html = html.replace(/href="\/editar\//g,
      'href="' + pref + '/editar/');

    html = html.replaceAll("fetch('/accion'",
      "fetch('" + pref + "/accion'");
  }

  if (req.cqClienteSeleccionado) {
    html = html.replace(
      /<a\b[^>]*href=["']\/administracion["'][^>]*>[\s\S]*?<\/a>/gi,
      ''
    );
  }

  // CQ_LOGIN_PANEL_CORRECTO_V2
  if (req.cliente && req.cqClienteSeleccionado === req.cliente.id) {
    const bloque = `<div style="padding:12px 16px;text-align:right">
      <a href="/cliente/salir"
         style="display:inline-block;background:#b32626;color:white;
                padding:12px 18px;text-decoration:none;
                border-radius:9px;font-weight:bold">
        Cerrar sesión
      </a>
    </div>
    <script>
    (function(){
      async function comprobar(){
        try {
          const r = await fetch('/cliente/session-check',{
            credentials:'same-origin',
            redirect:'follow',
            cache:'no-store'
          });
          if (!r.ok || r.redirected ||
              !(r.headers.get('content-type')||'').includes('application/json')) {
            location.replace('/login');
            return;
          }
          const d = await r.json();
          if (!d.ok) location.replace('/login');
        } catch(e) {}
      }
      comprobar();
      setInterval(comprobar,10000);
    })();
    </script>`;

    html = html.replace(/<body([^>]*)>/i, m => m + bloque);
  }

  // CQ3_AGENDA_WEB_VISIBLE_V1
  const agendaVisible = (leerState().schedules || [])
    .filter(item => {
      if (!item || !Number.isFinite(Number(item.ejecutarEn))) {
        return false;
      }

      if (Number(item.ejecutarEn) <= Date.now()) return false;

      if (item.id === '__TODAS__') {
        return !req.cqClienteSeleccionado;
      }
      if (item.id === '__CQ3_WEB_TODAS__') {
        return item.cq3Scope ===
          String(req.cqClienteSeleccionado || 'principal');
      }

      return Object.prototype.hasOwnProperty.call(
        data, String(item.id)
      );
    })
    .sort((a, b) => Number(a.ejecutarEn) - Number(b.ejecutarEn));

  const filasAgenda = agendaVisible.map(item => {
    const alcance =
      item.id === '__TODAS__' || item.id === '__CQ3_WEB_TODAS__'
        ? 'TODAS LAS PÁGINAS'
        : 'Perfil ' + String(item.id).replace(/[^a-zA-Z0-9_-]/g, '');

    const accionTexto = item.accion === 'PAUSADA'
      ? '⏸ PAUSAR' : '▶️ REANUDAR';

    return '<div style="padding:10px;border-bottom:1px solid #38516b">' +
      '<strong>' + accionTexto + '</strong> — ' + alcance +
      '<div style="margin-top:5px">' +
      cq3Formato(Number(item.ejecutarEn)) +
      '</div></div>';
  }).join('');

  const bloqueAgenda =
    '<section style="background:#132f4c;padding:18px;' +
    'border-radius:14px;margin:0 0 20px">' +
    '<h2>⏰ PROGRAMACIONES PENDIENTES</h2>' +
    (filasAgenda || '<p>No hay programaciones pendientes.</p>') +
    '</section>';

  html = html.replace(
    '<div class="grid">',
    bloqueAgenda + '<div class="grid">'
  );

  res.send(html);
}

app.get('/', cqPantallaCompartida);

// CQ_PANEL_ADMIN_COMPARTIDO_V2
function cqAutorizarPanel(req, res, next) {
  const cid = String(req.params.cid || '');
  if (req.admin !== true &&
      (!req.cliente || req.cliente.id !== cid)) {
    return res.sendStatus(403);
  }

  if (!/^[a-f0-9-]{36}$/i.test(cid)) {
    return res.sendStatus(400);
  }

  const cliente = require('./clientes_store')
    .listar().find(c => c.id === cid);

  if (!cliente) return res.sendStatus(404);

  req.cqClienteSeleccionado = cid;
  next();
}

function cqPropietarios() {
  const io = require('fs');
  const ruta = require('path').join(__dirname,
    'clientes_data', 'cq_propietarios_perfiles.json');

  if (!io.existsSync(ruta)) {
    io.mkdirSync(require('path').dirname(ruta), {
      recursive: true
    });
    io.writeFileSync(ruta, JSON.stringify({
      propietarios: {},
      ocultarEnPrincipal: {}
    }, null, 2), 'utf8');
  }

  return JSON.parse(io.readFileSync(ruta, 'utf8'));
}

function cqHandler(method, ruta) {
  const stack =
    (app.router && app.router.stack) ||
    (app._router && app._router.stack) || [];

  const match = stack.find(layer =>
    layer.route &&
    layer.route.path === ruta &&
    layer.route.methods[method]
  );

  if (!match) throw Error('No existe ruta original: ' + ruta);
  return match.route.stack[0].handle;
}

app.get('/admin/panel/:cid',
  cqAutorizarPanel, cqPantallaCompartida);

app.get('/admin/panel/:cid/nuevo',
  cqAutorizarPanel, (req, res, next) => {
    try {
      const pref = '/admin/panel/' +
        encodeURIComponent(req.cqClienteSeleccionado);

      const enviar = res.send.bind(res);
      res.send = html => enviar(String(html)
        .replace('action="/guardar-perfil"',
          'action="' + pref + '/guardar-perfil"')
        .replace('href="/"', 'href="' + pref + '"'));

      cqHandler('get', '/nuevo')(req, res, next);
    } catch(e) { next(e); }
  });

app.post('/admin/panel/:cid/guardar-perfil',
  cqAutorizarPanel, (req, res, next) => {
    try {
      const id = String(req.body.id || '');

      if (!/^[a-zA-Z0-9_-]{1,50}$/.test(id)) {
        return res.status(400).send('ID invalido');
      }

      const cfg = cqPropietarios();
      const propietarios = cfg.propietarios || {};
      const original = leerData();

      if (Object.prototype.hasOwnProperty.call(original, id) &&
          propietarios[id] !== req.cqClienteSeleccionado) {
        return res.status(409).send('Este ID ya existe');
      }

      if (propietarios[id] &&
          propietarios[id] !== req.cqClienteSeleccionado) {
        return res.status(409).send('ID asignado a otro cliente');
      }

      const mapaRuta = require('path').join(__dirname,
        'clientes_data', 'cq_propietarios_perfiles.json');

      const eraNuevo = !Object.prototype.hasOwnProperty.call(
        propietarios, id);

      const copiaMapa = require('fs').existsSync(mapaRuta) ? require('fs').readFileSync(mapaRuta) : Buffer.from('{}');

      if (eraNuevo) {
        cfg.propietarios = cfg.propietarios || {};
        cfg.propietarios[id] = req.cqClienteSeleccionado;
        cfg.ocultarEnPrincipal =
          cfg.ocultarEnPrincipal || {};
        cfg.ocultarEnPrincipal[id] =
          req.cqClienteSeleccionado;

        const tmp = mapaRuta + '.cq_nuevo_tmp';
        require('fs').writeFileSync(tmp,
          JSON.stringify(cfg, null, 2));
        require('fs').renameSync(tmp, mapaRuta);
      }

      const anteriorRedirect = res.redirect.bind(res);
      const pref = '/admin/panel/' +
        encodeURIComponent(req.cqClienteSeleccionado);

      res.redirect = () => anteriorRedirect(pref);

      try {
        cqHandler('post', '/guardar-perfil')(req, res, next);
      } catch (error) {
        if (eraNuevo) {
          require('fs').writeFileSync(mapaRuta, copiaMapa);
        }
        throw error;
      }
    } catch(e) { next(e); }
  });

app.post('/admin/panel/:cid/accion',
  cqAutorizarPanel, (req, res, next) => {
    try {
      const id = String(req.body.id || '');
      const cfg = cqPropietarios();

      if ((cfg.propietarios || {})[id] !==
          req.cqClienteSeleccionado) {
        return res.sendStatus(403);
      }

      // CQ3_BORRADO_CORREGIDO_V1
      if (req.body.accion === 'borrarperfil') {
        if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) {
          return res.sendStatus(400);
        }

        const io = require('fs');
        const pt = require('path');

        const datos = leerData();
        if (!Object.prototype.hasOwnProperty.call(datos, id)) {
          return res.sendStatus(404);
        }

        // El propietario ya fue comprobado arriba.
        const mapaRuta = pt.join(
          __dirname,
          'clientes_data',
          'cq_propietarios_perfiles.json'
        );

        if (!io.existsSync(mapaRuta) ||
            !io.existsSync(DATA_FILE) ||
            !io.existsSync(STATE_FILE)) {
          return res.status(500).send(
            'No se puede crear respaldo completo'
          );
        }

        const carpeta = pt.join(
          pt.dirname(mapaRuta),
          'respaldos_borrado'
        );
        io.mkdirSync(carpeta, { recursive: true });

        const marca = Date.now() + '-' + id;

        for (const [archivo, nombre] of [
          [DATA_FILE, 'perfiles'],
          [STATE_FILE, 'estado'],
          [mapaRuta, 'propietarios']
        ]) {
          io.copyFileSync(
            archivo,
            pt.join(carpeta, marca + '-' + nombre + '.bak')
          );
        }

        // Motor original: borra perfil y programaciones.
        const ok = borrarPerfil(id);
        if (!ok) {
          return res.status(500).send(
            'No se pudo borrar el perfil'
          );
        }

        cfg.propietarios = cfg.propietarios || {};
        cfg.ocultarEnPrincipal =
          cfg.ocultarEnPrincipal || {};

        delete cfg.propietarios[id];
        delete cfg.ocultarEnPrincipal[id];

        const temporal = mapaRuta + '.cq3_delete_tmp';
        io.writeFileSync(
          temporal,
          JSON.stringify(cfg, null, 2),
          'utf8'
        );
        io.renameSync(temporal, mapaRuta);

        return res.redirect(
          '/admin/panel/' +
          encodeURIComponent(req.cqClienteSeleccionado)
        );
      }

      const pref = '/admin/panel/' +
        encodeURIComponent(req.cqClienteSeleccionado);

      const redirigir = res.redirect.bind(res);
      res.redirect = () => redirigir(pref);

      return Promise.resolve(
        cqHandler('post', '/accion')(req, res, next)
      ).catch(next);
    } catch(e) { next(e); }
  });

app.get('/admin/panel/:cid/editar/:id',
  cqAutorizarPanel, (req, res, next) => {
    try {
      const cfg = cqPropietarios();

      if ((cfg.propietarios || {})[req.params.id] !==
          req.cqClienteSeleccionado) {
        return res.sendStatus(403);
      }

      const pref = '/admin/panel/' +
        encodeURIComponent(req.cqClienteSeleccionado);

      const enviar = res.send.bind(res);
      res.send = html => enviar(String(html)
        .replace('action="/guardar-perfil"',
          'action="' + pref + '/guardar-perfil"')
        .replace('href="/"', 'href="' + pref + '"'));

      cqHandler('get', '/editar/:id')(req, res, next);
    } catch(e) { next(e); }
  });

// FORM NUEVO PERFIL
app.get('/nuevo', (req, res) => {
  res.send(`
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>Nuevo perfil</title>
    <style>
      body { background:#0b1c2c; color:white; font-family:Arial,sans-serif; margin:0; padding:20px; }
      input, textarea, select { width:100%; padding:10px; border-radius:8px; border:none; margin-top:4px; margin-bottom:12px; }
      label { font-weight:bold; }
      .form-box { max-width:700px; background:#132f4c; padding:20px; border-radius:14px; }
      button, a { padding:10px 14px; border:none; border-radius:10px; text-decoration:none; display:inline-block; }
      .success { background:#2e7d32; color:white; }
      .muted { background:#455a64; color:white; }
    </style>
  </head>
  <body>
    <h1>➕ Nuevo perfil</h1>
    <div class="form-box">
      <form method="POST" action="/guardar-perfil">
        <label>ID del perfil</label>
        <input name="id" required />

        <label>Nombre</label>
        <input name="nombre" />

        <label>Chat ID</label>
        <input name="chat_id" />

        <label>Cliente token / Clave de acceso</label>
        <input name="cliente_token" />

        <label>Teléfono</label>
        <input name="telefono" />

        <label>Código</label>
        <input name="codigo" />

        <label>Ubicación</label>
        <input name="ubicacion" />

        <label>Texto</label>
        <textarea name="texto"></textarea>

        <label>Estado</label>
        <select name="estado">
          <option value="ACTIVA">ACTIVA</option>
          <option value="PAUSADA">PAUSADA</option>
        </select>

        <label>Foto modelo (URL o file_id)</label>
        <input name="foto_modelo" />

        <label>Foto página (URL o file_id)</label>
        <input name="foto_pagina" />

        <label>Próximo post</label>
        <input name="proximo_post" value="16m" />

        <label>Fin de plan</label>
        <input name="fin_plan" value="7 días" />

        <button class="success" type="submit">Guardar perfil</button>
        <a class="muted" href="/">Volver</a>
      </form>
    </div>
  </body>
  </html>
  `);
});

// FORM EDITAR PERFIL
app.get('/editar/:id', (req, res) => {
  const data = leerData();
  const id = req.params.id;

  if (!data[id]) {
    return res.status(404).send('Perfil no encontrado');
  }

  const p = data[id];

  res.send(`
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>Editar perfil ${id}</title>
    <style>
      body { background:#0b1c2c; color:white; font-family:Arial,sans-serif; margin:0; padding:20px; }
      input, textarea, select { width:100%; padding:10px; border-radius:8px; border:none; margin-top:4px; margin-bottom:12px; }
      label { font-weight:bold; }
      .form-box { max-width:700px; background:#132f4c; padding:20px; border-radius:14px; }
      button, a { padding:10px 14px; border:none; border-radius:10px; text-decoration:none; display:inline-block; }
      .success { background:#2e7d32; color:white; }
      .muted { background:#455a64; color:white; }
    </style>
  </head>
  <body>
    <h1>✏️ Editar perfil ${id}</h1>
    <div class="form-box">
      <form method="POST" action="/guardar-perfil">
        <input type="hidden" name="id" value="${id}" />

        <label>Nombre</label>
        <input name="nombre" value="${p.nombre || ''}" />

        <label>Chat ID</label>
        <input name="chat_id" value="${p.chat_id || ''}" />

        <label>Cliente token / Clave de acceso</label>
        <input name="cliente_token" value="${p.cliente_token || ''}" />

        <label>Teléfono</label>
        <input name="telefono" value="${p.telefono || ''}" />

        <label>Código</label>
        <input name="codigo" value="${p.codigo || ''}" />

        <label>Ubicación</label>
        <input name="ubicacion" value="${p.ubicacion || ''}" />

        <label>Texto</label>
        <textarea name="texto">${p.texto || ''}</textarea>

        <label>Estado</label>
        <select name="estado">
          <option value="ACTIVA" ${p.estado === 'ACTIVA' ? 'selected' : ''}>ACTIVA</option>
          <option value="PAUSADA" ${p.estado === 'PAUSADA' ? 'selected' : ''}>PAUSADA</option>
        </select>

        <label>Foto modelo (URL o file_id)</label>
        <input name="foto_modelo" value="${p.foto_modelo || ''}" />

        <label>Foto página (URL o file_id)</label>
        <input name="foto_pagina" value="${p.foto_pagina || ''}" />

        <label>Próximo post</label>
        <input name="proximo_post" value="${p.proximo_post || ''}" />

        <label>Fin de plan</label>
        <input name="fin_plan" value="${p.fin_plan || ''}" />

        <button class="success" type="submit">Guardar cambios</button>
        <a class="muted" href="/">Volver</a>
      </form>
    </div>
  </body>
  </html>
  `);
});

// GUARDAR PERFIL
app.post('/guardar-perfil', (req, res) => {
  const {
    id,
    nombre,
    chat_id,
    cliente_token,
    telefono,
    codigo,
    ubicacion,
    texto,
    estado,
    foto_modelo,
    foto_pagina,
    proximo_post,
    fin_plan
  } = req.body;

  if (!id) {
    return res.status(400).send('Falta ID');
  }

  const data = leerData();
  asegurarPerfil(data, id);

  data[id].nombre = nombre || `Perfil ${id}`;
  data[id].chat_id = chat_id || '';
  data[id].cliente_token = String(cliente_token || '').trim() || data[id].cliente_token || '';
  data[id].telefono = telefono || '';
  data[id].codigo = codigo || '';
  data[id].ubicacion = ubicacion || '';
  data[id].texto = texto || '';
  data[id].estado = estado || 'ACTIVA';
  data[id].foto_modelo = foto_modelo || data[id].foto_modelo || 'https://picsum.photos/400/260';
  data[id].foto_pagina = foto_pagina || data[id].foto_pagina || 'https://picsum.photos/420/280';
  data[id].proximo_post = proximo_post || '16m';
  data[id].fin_plan = convertirFinPlan(fin_plan || '7 días');
  data[id].ultima_hora = horaActual();
  data[id].ultimaAccion = 'Perfil editado desde panel';
  data[id].ultima_accion = 'Perfil editado desde panel';

  const ok = guardarData(data);

  if (!ok) {
    return res.status(500).send('No se pudo guardar el perfil');
  }

  res.redirect('/');
});

// =========================
// ACCIONES PANEL
// =========================
app.post('/accion', async (req, res) => {
  const { id, accion } = req.body;
  const data = leerData();

  if (!data[id]) {
    return res.status(404).send('Perfil no encontrado');
  }

  if (accion === 'pausar') {
    cambiarEstadoPerfil(id, 'PAUSADA');
    await enviarEstadoPerfil(id);
  } else if (accion === 'reanudar') {
    cambiarEstadoPerfil(id, 'ACTIVA');
    await enviarEstadoPerfil(id);
  } else if (accion === 'resetacceso') {
    const nuevoToken = resetearAccesoPerfil(id);

    if (nuevoToken) {
      await enviarTexto(`🔐 Acceso reseteado y perfil limpiado\nPerfil: ${id}\nNueva clave: ${nuevoToken}\nEstado: PAUSADA`);
    }
  } else if (accion === 'borrarperfil') {
    const ok = borrarPerfil(id);

    if (ok) {
      await enviarTexto(`🗑️ Perfil borrado correctamente\nPerfil eliminado: ${id}`);
    } else {
      await enviarTexto(`⚠️ No se pudo borrar el perfil ${id}`);
    }
  } else if (accion === 'progpausa' || accion === 'progreanudar') {
    const estadoNuevo = accion === 'progpausa'
      ? 'PAUSADA' : 'ACTIVA';

    const scope = String(req.cqClienteSeleccionado || 'principal');
    const ids = cq3IdsDePanel(scope);

    if (!ids.includes(String(id))) {
      return res.status(403).json({
        ok: false, error: 'Perfil fuera de este panel.'
      });
    }

    try {
      const entrada = String(req.body.fechaHora || '').trim();

      if (!entrada) {
        return res.status(400).json({
          ok: false, error: 'Escribe fecha y hora o EN 5 MIN.'
        });
      }

      const state = leerState();
      state.schedules = Array.isArray(state.schedules)
        ? state.schedules : [];

      const antes = state.schedules.length;

      state.schedules = state.schedules.filter(t =>
        !(
          t.accion === estadoNuevo &&
          (
            (t.id === '__CQ3_WEB_TODAS__' &&
              t.cq3Scope === scope)
          )
        )
      );

      let mensaje;

      if (entrada.toUpperCase() === 'CANCELAR') {
        mensaje = antes !== state.schedules.length
          ? 'Programación cancelada para TODAS LAS PÁGINAS'
          : 'No había programación para cancelar.';
      } else {
        const ejecutarEn = cq3Fecha(entrada);

        const conflicto = state.schedules.some(t =>
          t.id === '__CQ3_WEB_TODAS__' &&
          t.cq3Scope === scope &&
          t.accion !== estadoNuevo &&
          Number(t.ejecutarEn) === ejecutarEn
        );

        if (conflicto) {
          return res.status(400).json({
            ok: false,
            error: 'Ya existe una orden contraria a esa misma hora.'
          });
        }

        state.schedules.push({
          id: '__CQ3_WEB_TODAS__',
          cq3Scope: scope,
          accion: estadoNuevo,
          ejecutarEn
        });

        mensaje = 'PROGRAMACIÓN GUARDADA\n' +
          'Alcance: TODAS LAS PÁGINAS (' + ids.length + ')\n' +
          'Acción: ' +
          (estadoNuevo === 'PAUSADA' ? 'PAUSAR' : 'REANUDAR') +
          '\nFecha: ' + cq3Formato(ejecutarEn);
      }

      if (!guardarState(state)) {
        return res.status(500).json({
          ok: false, error: 'No se pudo guardar la agenda.'
        });
      }

      return res.json({ ok: true, mensaje });
    } catch (error) {
      return res.status(400).json({
        ok: false, error: error.message
      });
    }
  } else if (accion === 'ultima') {
    await enviarUltimaActualizacion(id);
  } else if (accion === 'foto') {
    await enviarFotoPagina(id);
  } else if (accion === 'reiniciar') {
    cambiarEstadoPerfil(id, 'ACTIVA');
    await enviarTexto(`🔄 ${data[id].nombre} reiniciado.`);
    await enviarEstadoPerfil(id);
  }

  res.redirect('/');
});

app.post('/accion-global', async (req, res) => {
  const { accion } = req.body;

  if (accion === 'pausar_todas') {
    cancelarColaReanudacion();
    cambiarEstadoTodos('PAUSADA');
    await enviarTexto('⏸ Todas las páginas quedaron en PAUSADA. Cola cancelada.');
  } else if (accion === 'reanudar_todas') {
    reanudarTodasEnCola();
    await enviarTexto('▶️ Reanudando todas en cola cada 45 segundos.');
  }

  res.redirect('/');
});

// =========================
// CICLO SEGURO
// =========================
async function procesarColaReanudacion(versionActiva) {
  if (versionActiva !== colaVersion) return;

  if (!colaReanudacion || colaReanudacion.length === 0) {
    cancelarColaReanudacion();
    return;
  }

  const id = colaReanudacion.shift();

  if (versionActiva !== colaVersion) return;

  const reanudado = cambiarEstadoPerfil(id, 'ACTIVA');

  if (reanudado) {
    await enviarTexto('Perfil ' + id + ' reanudado en cola.');
    await enviarEstadoPerfil(id);
  } else {
    await enviarTexto(
      'Perfil ' + id +
      ': reanudacion denegada. Verificar licencia y vencimiento.'
    );
  }

  if (versionActiva !== colaVersion) return;

  if (colaReanudacion && colaReanudacion.length > 0) {
    colaTimeout = setTimeout(() => {
      procesarColaReanudacion(versionActiva);
    }, 45000);
  } else {
    cancelarColaReanudacion();
  }
}

function reanudarTodasEnCola() {
  cancelarColaReanudacion();

  const data = leerData();
  colaReanudacion = Object.keys(data);

  const versionActiva = colaVersion;

  if (colaReanudacion.length > 0) {
    procesarColaReanudacion(versionActiva);
  }
}

async function cicloPrincipal() {
  if (cicloEnProceso) {
    setTimeout(cicloPrincipal, 3003);
    return;
  }

  cicloEnProceso = true;

  try {
    await revisarTelegram();
    await ejecutarProgramaciones();
  } catch (error) {
    console.log('Error en cicloPrincipal:', error?.message || error);
  } finally {
    cicloEnProceso = false;
    setTimeout(cicloPrincipal, 3003);
  }
}

// =========================
// START
// =========================
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);

  if (!existeArchivoSeguro(DATA_FILE)) {
    guardarData({});
  }

  if (!existeArchivoSeguro(STATE_FILE)) {
    guardarState({
      offset: 0,
      schedules: [],
      esperandoFoto: null
    });
  }

  await apiTelegram('deleteWebhook', {});
  cicloPrincipal();
});

app.get('/administracion', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_clientes.html'));
});


// JEAN_BOT_CLIENTE_INTEGRACION_V1
require('./jean_bot_cliente').iniciar(BOT_TOKEN).catch(e => console.error('[JEAN BOT]',e.message));
