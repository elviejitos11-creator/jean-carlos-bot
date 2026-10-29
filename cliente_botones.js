const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./clientes_store');

function clave(c, id) {
  return crypto.createHash('sha256')
    .update(c.id + ':' + id).digest('hex').slice(0,24);
}

function localizar(hash) {
  for (const c of store.listar()) {
    if (!c.activo || Date.parse(c.vencimiento) <= Date.now()) continue;
    const archivo = path.join(store.carpetaCliente(c.id),'data.json');
    if (!fs.existsSync(archivo)) continue;
    const datos = JSON.parse(fs.readFileSync(archivo,'utf8'));
    for (const id of Object.keys(datos)) {
      if (clave(c,id) === hash) {
        return {c,id,archivo,datos,perfil:datos[id]};
      }
    }
  }
  return null;
}

function botones(c,id) {
  const h = clave(c,id);
  return {inline_keyboard:[
    [{text:'⏸ Pausar',callback_data:'cq|p|'+h},
     {text:'▶️ Reanudar',callback_data:'cq|r|'+h}],
    [{text:'🔄 Reiniciar',callback_data:'cq|i|'+h}]
  ]};
}

async function manejar(q,apiTelegram) {
  const texto = String(q.data || '');
  if (!texto.startsWith('cq|')) return false;

  const partes = texto.split('|');
  const accion = partes[1];
  const hash = partes[2];

  let mensaje = 'Acceso denegado';

  try {
    if (partes.length === 3 &&
        ['p','r','i'].includes(accion) &&
        /^[a-f0-9]{24}$/.test(hash)) {

      const x = localizar(hash);

      if (x && String(q.message?.chat?.id) === String(x.perfil.chat_id)) {
        x.perfil.estado = accion === 'p' ? 'PAUSADA' : 'ACTIVA';
        x.perfil.ultima_accion = accion === 'i'
          ? 'Reiniciado desde Telegram'
          : 'Estado cambiado desde Telegram';

        const temporal = x.archivo + '.tmp';
        fs.writeFileSync(temporal,JSON.stringify(x.datos,null,2),'utf8');
        fs.renameSync(temporal,x.archivo);

        mensaje = 'Perfil '+x.id+': '+x.perfil.estado;
      }
    }
  } catch(e) {
    console.log('Error en control de cliente:',e.message);
    mensaje = 'Error procesando solicitud';
  }

  await apiTelegram('answerCallbackQuery',{
    callback_query_id:q.id,text:mensaje
  });
  return true;
}

module.exports = {manejar,botones};
