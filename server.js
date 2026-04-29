const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

const PORT = 3003;

// CAMBIA ESTAS 4 COSAS
const BOT_TOKEN = '8670917706:AAEp7uHCGx3FhHdMMw_tMQJWyOiTVGTHHKU';
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

function asegurarPerfil(data, id) {
  if (!data[id]) {
    data[id] = {
      nombre: `Perfil ${id}`,
      chat_id: '',
      telefono: '',
      codigo: '',
      ubicacion: '',
      texto: '',
      estado: 'ACTIVA',
      foto_modelo: 'https://picsum.photos/400/260',
      foto_pagina: 'https://picsum.photos/420/280',
      historial_fotos: [],
      ultima_hora: 'N/A',
      proximo_post: '16m',
      proximo_post_ts: null,
      fin_plan: '7 días',
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

function convertirFinPlan(valor) {
  if (!valor) return '';

  const texto = String(valor).trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}(t\d{2}:\d{2}:\d{2})?$/.test(texto)) {
    return valor;
  }

  const m = texto.match(/^(\d+)\s*d[ií]a?s?$/);
  if (m) {
    const dias = Number(m[1]);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    fecha.setHours(23, 59, 59, 0);
    return fecha.toISOString().slice(0, 19);
  }

  return valor;
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
        { text: '📂 Ver últimas 3', callback_data: `fotos3_${id}` },
        { text: '🗂 Ver últimas 4', callback_data: `fotos4_${id}` }
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
}

// =========================
// ESTADOS
// =========================
function cambiarEstadoPerfil(id, estado) {
  const data = leerData();
  if (!data[id]) return false;

  asegurarPerfil(data, id);
  data[id].estado = estado;
  data[id].ultima_hora = horaActual();
  data[id].ultima_accion = estado === 'ACTIVA' ? 'Reanudado' : 'Pausado';

  return guardarData(data);
}

function cambiarEstadoTodos(estado) {
  const data = leerData();
  for (const id of Object.keys(data)) {
    asegurarPerfil(data, id);
    data[id].estado = estado;
    data[id].ultima_hora = horaActual();
    data[id].ultima_accion =
      estado === 'ACTIVA' ? 'Reanudado globalmente' : 'Pausado globalmente';
  }
  guardarData(data);
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

  const caption = `🔥 jean carlos BOT 🔥

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

async function enviarReglas(chatId = CHAT_ID) {
  await enviarTexto(RULES_TEXT, chatId);
}

// =========================
// API LOCAL
// =========================
app.get('/api/estado/:id', (req, res) => {
  try {
    const data = leerData();
    const perfil = data[req.params.id];

    // SOLO pausa si está guardado explícitamente como PAUSADA
    if (perfil && perfil.estado === 'PAUSADA') {
      return res.json({
        estado: 'PAUSADA',
        motivo: 'Pausada por orden explícita del panel'
      });
    }

    // Si falta perfil, si hay duda, si algo raro pasa => ACTIVA
    return res.json({
      estado: 'ACTIVA',
      motivo: 'Modo seguro: solo se pausa por orden explícita'
    });
  } catch (error) {
    console.log('Error en /api/estado/:id =>', error?.message || error);

    // Ante cualquier fallo, JAMÁS apagar por defecto
    return res.json({
      estado: 'ACTIVA',
      motivo: 'Fallo del panel/lectura: se mantiene ACTIVA'
    });
  }
});

app.post('/registrar-evento', async (req, res) => {
  const {
    id,
    tipo = 'evento',
    telefono,
    codigo,
    ubicacion,
    texto,
    estado,
    foto_modelo,
    foto_pagina,
    fin_plan,
    ultima_accion,
    ultima_hora,
    minutos_siguientes = 16
  } = req.body;

  if (!id) {
    return res.status(400).json({ ok: false, error: 'Falta id' });
  }

  const data = leerData();
  asegurarPerfil(data, id);

  const perfil = data[id];

  if (telefono) perfil.telefono = telefono;
  if (codigo) perfil.codigo = codigo;
  if (ubicacion) perfil.ubicacion = ubicacion;
  if (typeof texto === 'string') perfil.texto = texto;
  if (estado) perfil.estado = estado;
  if (foto_modelo) perfil.foto_modelo = foto_modelo;
  if (foto_pagina) perfil.foto_pagina = foto_pagina;
  if (fin_plan) perfil.fin_plan = convertirFinPlan(fin_plan);

  perfil.ultima_hora = ultima_hora || horaActual();
  perfil.ultima_accion = ultima_accion || tipo;
  perfil.ultimo_evento = { tipo, hora: perfil.ultima_hora };

  if (tipo === 'publicado' || tipo === 'evento') {
    resetBumpSiCambioDia(perfil);
    perfil.bump_hoy = (perfil.bump_hoy || 0) + 1;
    perfil.bump_total = (perfil.bump_total || 0) + 1;
    perfil.bump_fecha = fechaHoy();
    perfil.proximo_post_ts = Date.now() + Number(minutos_siguientes) * 60 * 1000;
    perfil.proximo_post = tiempoProximoPost(perfil);
  }

  const ok = guardarData(data);

  if (!ok) {
    return res.status(500).json({ ok: false, error: 'No se pudo guardar data.json' });
  }

  await enviarUltimaActualizacion(id);

  res.json({ ok: true, perfil: data[id] });
});

// =========================
// TELEGRAM CALLBACKS
// =========================
async function procesarCallback(q) {
  const data = q.data || '';
  const callbackId = q.id;
  const chatId = q.message?.chat?.id || CHAT_ID;

  if (data === 'pausar_todas') {
    cambiarEstadoTodos('PAUSADA');
    await responderCallback(callbackId, 'Todas pausadas');
    await enviarTexto('⏸ Todas las páginas quedaron en PAUSADA.', chatId);
    return;
  }

  if (data === 'reanudar_todas') {
    cambiarEstadoTodos('ACTIVA');
    await responderCallback(callbackId, 'Todas reanudadas');
    await enviarTexto('▶️ Todas las páginas quedaron en ACTIVA.', chatId);
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
    programarAccion(id, 'PAUSADA', 30);
    await responderCallback(callbackId, 'Pausa programada');
    await enviarTexto(`⏰ Se programó una pausa para el perfil ${id} en 30 minutos.`, chatId);
    return;
  }

  if (accion === 'progreanudar') {
    programarAccion(id, 'ACTIVA', 30);
    await responderCallback(callbackId, 'Reanudación programada');
    await enviarTexto(`⏰ Se programó una reanudación para el perfil ${id} en 30 minutos.`, chatId);
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

  if (accion === 'reiniciar') {
    const ok = cambiarEstadoPerfil(id, 'ACTIVA');
    await responderCallback(callbackId, ok ? 'Bot reiniciado' : 'No encontrado');
    if (ok) {
      await enviarTexto(`🔄 Perfil ${id} reiniciado y puesto en ACTIVA.`, chatId);
      await enviarEstadoPerfil(id);
    }
    return;
  }

  if (accion === 'fotos3') {
    await responderCallback(callbackId, 'Enviando 3 fotos...');
    await enviarUltimasFotos(id, 3);
    return;
  }

  if (accion === 'fotos4') {
    await responderCallback(callbackId, 'Enviando 4 fotos...');
    await enviarUltimasFotos(id, 4);
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
      cambiarEstadoPerfil(item.id, item.accion);
      await enviarTexto(
        `⏰ Programación ejecutada\nPerfil: ${item.id}\nNuevo estado: ${item.accion}`
      );
      await enviarEstadoPerfil(item.id);
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
app.get('/', (req, res) => {
  const data = leerData();
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
    <h1>🔥 jean carlos BOT 🔥</h1>
    <div style="margin-bottom:16px;">
      <button class="danger" onclick="accionGlobal('pausar_todas')">⏸ Pausar todas</button>
      <button class="success" onclick="accionGlobal('reanudar_todas')">▶️ Reanudar todas</button>
      <a class="btn warning" href="/nuevo">➕ Nuevo perfil</a>
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
        <div class="row">📞 ${p.telefono}</div>
        <div class="row">🆔 Código: ${p.codigo}</div>
        <div class="row">📍 ${p.ubicacion}</div>
        <div class="row estado">🟢 ${p.estado}</div>
        <div class="row">🕒 ${p.ultima_hora}</div>
        <div class="row">⏱ Próximo bump: ${p.proximo_post_ts ? tiempoRestante(p.proximo_post_ts) : (p.proximo_post || 'N/A')}</div>
        <div class="row">📅 ${tiempoRestantePlan(p.fin_plan)}</div>
        <div class="row">📊 Bump hoy: ${p.bump_hoy || 0}</div>
        <div class="row">📈 Bump total: ${p.bump_total || 0}</div>
        <div class="row">🖼 Historial fotos: ${totalFotos}</div>
        <div class="row small">Última acción: ${p.ultima_accion || 'N/A'}</div>

        <button class="danger" onclick="accionPerfil('${id}','pausar')">⏸ Pausar</button>
        <button class="success" onclick="accionPerfil('${id}','reanudar')">▶️ Reanudar</button>
        <button class="muted" onclick="accionPerfil('${id}','progpausa')">⏰ Programar pausa</button>
        <button class="muted" onclick="accionPerfil('${id}','progreanudar')">⏰ Programar reanudar</button>
        <button class="info" onclick="accionPerfil('${id}','ultima')">🕒 Último bump</button>
        <button class="info" onclick="accionPerfil('${id}','foto')">📸 Ver foto</button>
        <button class="muted" onclick="accionPerfil('${id}','reiniciar')">🔄 Reiniciar bot</button>
        <a class="btn warning" href="/editar/${id}">✏️ Editar</a>
      </div>
    `;
  }

  html += `
    </div>
    <script>
      async function accionPerfil(id, accion) {
        await fetch('/accion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, accion })
        });
        location.reload();
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

  res.send(html);
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
  data[id].telefono = telefono || '';
  data[id].codigo = codigo || '';
  data[id].ubicacion = ubicacion || '';
  data[id].texto = texto || '';
  data[id].estado = estado || 'ACTIVA';
  data[id].foto_modelo = foto_modelo || 'https://picsum.photos/400/260';
  data[id].foto_pagina = foto_pagina || 'https://picsum.photos/420/280';
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
  } else if (accion === 'progpausa') {
    programarAccion(id, 'PAUSADA', 30);
    await enviarTexto(`⏰ Se programó una pausa para ${data[id].nombre} en 30 minutos.`);
  } else if (accion === 'progreanudar') {
    programarAccion(id, 'ACTIVA', 30);
    await enviarTexto(`⏰ Se programó una reanudación para ${data[id].nombre} en 30 minutos.`);
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
    cambiarEstadoTodos('PAUSADA');
    await enviarTexto('⏸ Todas las páginas quedaron en PAUSADA.');
  } else if (accion === 'reanudar_todas') {
    cambiarEstadoTodos('ACTIVA');
    await enviarTexto('▶️ Todas las páginas quedaron en ACTIVA.');
  }

  res.redirect('/');
});

// =========================
// CICLO SEGURO
// =========================
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