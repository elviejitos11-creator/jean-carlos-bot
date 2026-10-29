/* CQ_REPARACION_CLIENTES_SEGURA_V3 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./clientes_store');

const sesiones = new Map();

function esc(x) {
  return String(x == null ? '' : x)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function pagina(titulo, contenido) {
  return `<!doctype html><html lang="es"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(titulo)}</title>
  <style>
  *{box-sizing:border-box}
  body{background:#0b1c2c;color:white;font-family:Arial,sans-serif;
  padding:20px;margin:0}
  main{max-width:850px;margin:auto}
  .card{background:#132f4c;padding:20px;border-radius:14px;margin:15px 0}
  input,select{display:block;width:100%;max-width:450px;
  padding:12px;margin:8px 0 15px;border-radius:8px;border:0}
  button,.btn{display:inline-block;border:0;border-radius:9px;
  background:#1565c0;color:white;padding:12px 17px;
  text-decoration:none;font-weight:bold;cursor:pointer;margin:4px}
  .danger{background:#b71c1c}
  .success{background:#2e7d32}
  small{color:#b8cee7}
  </style></head><body><main>${contenido}</main></body></html>`;
}

function archivoCliente(id) {
  return path.join(store.carpetaCliente(id),'data.json');
}

function leerPerfiles(id) {
  const archivo = archivoCliente(id);
  const datos = JSON.parse(fs.readFileSync(archivo,'utf8'));
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw Error('Datos invalidos');
  }
  return datos;
}

function guardarPerfiles(id, datos) {
  const archivo = archivoCliente(id);
  const temporal = archivo + '.tmp';
  fs.writeFileSync(temporal,JSON.stringify(datos,null,2),'utf8');
  fs.renameSync(temporal,archivo);
}

function cookie(req) {
  const entrada = String(req.headers.cookie || '')
    .split(';').find(x=>x.trim().startsWith('cq_cliente='));
  return entrada ? entrada.trim().slice(11) : '';
}

function clienteActual(req) {
  const token = cookie(req);
  const s = sesiones.get(token);
  if (!s || s.hasta <= Date.now()) return null;

  const c = store.listar().find(x=>x.id===s.id);
  if (!c || !c.activo || Date.parse(c.vencimiento)<=Date.now() || !s.claveHash || s.claveHash !== c.claveHash) {
    sesiones.delete(token);
    return null;
  }
  return c;
}

function exigirSesion(req,res,next) {
  const c = clienteActual(req);
  if (!c) return res.redirect('/login');

  if (req.method === 'POST') {
    const origen = req.headers.origin;
    const esperado = (req.get('x-forwarded-proto') || req.protocol)+'://'+req.get('host');
    if (origen && origen !== esperado) return res.sendStatus(403);
    if (req.body._csrf !== sesiones.get(cookie(req)).csrf) {
      return res.sendStatus(403);
    }
  }
  req.cliente = c;
  req.csrfCliente = sesiones.get(cookie(req)).csrf;
  next();
}

function campoCsrf(req) {
  return `<input type="hidden" name="_csrf" value="${esc(req.csrfCliente)}">`;
}


/* CQ_TELEGRAM_CLIENTES_V1 - INICIO */
async function cqNotificarClienteTelegram(perfil, cliente, accion) {
  const datos = leerPerfiles(cliente.id);
  const encontrado = Object.entries(datos).find(([id,p]) =>
    p.cliente_token === perfil.cliente_token
  );
  if (!encontrado) return false;
  return require('./jean_bot_cliente').enviar(
    cliente, encontrado[0], perfil, accion
  );
}
/* CQ_TELEGRAM_CLIENTES_V1 - FIN */

module.exports = function(app) {
  app.get('/cliente/login',(req,res)=>{
    res.send(pagina('Acceso clientes',`
      <div class="card">
      <h1>🔥 PANEL PRO</h1>
      <h2>Acceso de clientes</h2>
      <form method="POST" action="/cliente/login">
      <label>Usuario<input name="usuario" required></label>
      <label>Contraseña<input type="password" name="clave" required></label>
      <button>Entrar</button>
      </form></div>`));
  });

  // CQ_LOGIN_UNICO_CLIENTES_V1
  function iniciarSesionCliente(req,res,c) {
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');

    const actual = store.listar().find(x => x.id === c.id);
    if (!actual || !actual.activo ||
        Date.parse(actual.vencimiento) <= Date.now()) {
      return res.status(401).redirect('/login');
    }

    sesiones.set(token,{
      id:c.id,
      csrf,
      claveHash:actual.claveHash,
      hasta:Date.now()+8*3600000
    });

    res.cookie('cq_cliente',token,{
      httpOnly:true,
      sameSite:'strict',
      secure:req.secure || req.get('x-forwarded-proto')==='https',
      path:'/cliente',
      maxAge:8*3600000
    });

    return res.redirect('/cliente');
  }

  // El mismo formulario admite usuarios de clientes.
  // Si no es cliente, conserva el login original del administrador.
  app.post('/login',(req,res,next)=>{
    let c=null;
    try {
      c=store.autenticar(
        req.body.usuario,
        req.body.clave
      );
    } catch(e) {
      console.error('[CQ LOGIN CLIENTE]',e.message);
      return res.status(500).send('Error verificando cuenta');
    }

    if (!c) return next();

    return iniciarSesionCliente(req,res,c);
  });
  const fallos = new Map();

  app.post('/cliente/login',(req,res)=>{
    const ip = req.ip || 'local';
    const previo = fallos.get(ip) || {n:0,hasta:0};
    if (previo.hasta > Date.now()) {
      return res.status(429).send('Demasiados intentos. Intenta mas tarde.');
    }

    let c = null;
    try {
      c = store.autenticar(req.body.usuario,req.body.clave);
    } catch(e) {
      return res.sendStatus(500);
    }

    if (!c) {
      previo.n++;
      if (previo.n>=5) {
        previo.n=0;
        previo.hasta=Date.now()+15*60*1000;
      }
      fallos.set(ip,previo);
      return res.status(401).send(
        pagina('Acceso denegado',
          '<h2>Usuario o contraseña incorrectos</h2><a class="btn" href="/cliente/login">Volver</a>')
      );
    }

    fallos.delete(ip);
    return iniciarSesionCliente(req,res,c);
  });

  app.use('/cliente',exigirSesion);
  // CQ_CONTROL_SESIONES_CLIENTES_V1
  app.get('/cliente/session-check',(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true});
  });

  app.get('/cliente/salir',(req,res)=>{
    const token = cookie(req);
    if(token) sesiones.delete(token);

    res.clearCookie('cq_cliente',{
      path:'/cliente'
    });

    return res.redirect('/login');
  });

  // Boton de salida y comprobacion automatica en vistas privadas.
  app.use('/cliente',(req,res,next)=>{
    if(req.method !== 'GET') return next();

    const enviar = res.send.bind(res);

    res.send = function(html) {
      if(typeof html !== 'string' ||
         !/<\/body>/i.test(html) ||
         html.includes('id="cq-cerrar-sesion-v1"')) {
        return enviar(html);
      }

      const controles = `
      <div id="cq-cerrar-sesion-v1"
           style="padding:12px;text-align:right">
        <a href="/cliente/salir"
           style="display:inline-block;background:#b91c1c;
                  color:white;padding:12px 18px;
                  border-radius:9px;text-decoration:none;
                  font:bold 15px Arial">
          Cerrar sesión
        </a>
      </div>
      <script>
      (function(){
        if(window.__cqSesionActivaV1)return;
        window.__cqSesionActivaV1=true;

        async function verificarSesion(){
          try{
            const r=await fetch('/cliente/session-check',{
              credentials:'same-origin',
              cache:'no-store',
              redirect:'follow'
            });
            const tipo=r.headers.get('content-type')||'';

            if(!r.ok || r.redirected ||
               !tipo.includes('application/json')){
              window.location.replace('/login');
              return;
            }

            const d=await r.json();
            if(!d.ok)window.location.replace('/login');
          }catch(e){
            // Un fallo temporal de red no elimina la sesion.
          }
        }

        verificarSesion();
        setInterval(verificarSesion,10000);
      })();
      </script>`;

      return enviar(html.replace(/<body([^>]*)>/i,
        function(m){return m+controles;}));
    };

    next();
  });


// CQ_AGENDA_V12_CORREGIDA
const cqRutaEstadoAgenda12 = "C:\\Users\\yeimy\\OneDrive\\Documents\\ESCRITORIO GUARDADO CQ\\PANEL_PRO3_CLIENTES_DESARROLLO\\clientes_data\\jean_bot_estado.json";

app.get('/cliente/agenda-datos', (req,res) => {
  try {
    const datos = JSON.parse(
      fs.readFileSync(cqRutaEstadoAgenda12, 'utf8')
    );
    const agenda = (Array.isArray(datos.schedules)
      ? datos.schedules : [])
      .filter(t =>
        t &&
        t.cliente_id === req.cliente.id &&
        Number.isFinite(Number(t.ejecutar)) &&
        Number(t.ejecutar) > Date.now()
      )
      .map(t => ({
        perfil:String(t.perfil_id || ''),
        todos:t.todos === true,
        estado:String(t.estado || ''),
        ejecutar:Number(t.ejecutar)
      }))
      .sort((a,b)=>a.ejecutar-b.ejecutar);
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,agenda});
  } catch(e) {
    console.error('[CQ AGENDA]',e.message);
    res.status(500).json({ok:false,error:"Error de agenda"});
  }
});

app.use('/cliente', (req,res,next) => {
  if(req.method !== 'GET' || req.path !== '/') return next();
  const enviar = res.send.bind(res);
  res.send = function(html) {
    if(typeof html !== 'string' || !/<\/body>/i.test(html))
      return enviar(html);
    if(html.includes('id="cq-agenda-v12"')) return enviar(html);
    const bloque = "<style>#cq-agenda-v12{background:#132f4d;color:#fff;padding:16px;border-radius:13px;margin:16px 0;border:1px solid #32618c}#cq-agenda-v12 h2{color:white;margin:0 0 12px}.cq-agenda-tarea{background:#1c4163;padding:12px;margin:8px 0;border-radius:9px}.cq-agenda-tarea small{display:block;color:#bddbf2}</style><section id=\"cq-agenda-v12\"><h2>? Programaciones activas</h2><div id=\"cq-agenda-lista\">Consultando...</div></section><script>(function(){\nif(window.__cqAgenda12)return;\nwindow.__cqAgenda12=true;\nconst lista=document.getElementById(\"cq-agenda-lista\");\nif(!lista)return;\nasync function actualizar(){\ntry{\nconst r=await fetch(\"/cliente/agenda-datos\",{\ncredentials:\"same-origin\",cache:\"no-store\"\n});\nif(!r.ok)throw Error(\"Consulta fallida\");\nconst d=await r.json();\nif(!d.ok)throw Error(\"Sin datos\");\nlista.replaceChildren();\nif(!d.agenda.length){\nlista.textContent=\"No hay programaciones pendientes.\";\nreturn;\n}\nfor(const t of d.agenda){\nconst caja=document.createElement(\"div\");\ncaja.className=\"cq-agenda-tarea\";\nconst titulo=document.createElement(\"strong\");\ntitulo.textContent=\n(t.estado===\"PAUSADA\"?\"? Pausar\":\"?? Reanudar\")\n+(t.todos?\" todas\":\" ? Perfil \"+t.perfil);\nconst fecha=document.createElement(\"div\");\nfecha.textContent=new Date(t.ejecutar).toLocaleString(\n\"es-DO\",{timeZone:\"America/Santo_Domingo\",\ndateStyle:\"medium\",timeStyle:\"short\"});\nconst tiempo=document.createElement(\"small\");\nconst minutos=Math.max(0,Math.ceil(\n(t.ejecutar-Date.now())/60000));\ntiempo.textContent=\"Faltan \"+minutos+\" minutos\";\ncaja.append(titulo,fecha,tiempo);\nlista.append(caja);\n}\n}catch(e){\nlista.textContent=\"No se pudo consultar la agenda.\";\n}\n}\nactualizar();\nsetInterval(actualizar,10000);\n})();</script>";
    return enviar(html.replace(/<\/body>/i,bloque+'</body>'));
  };
  next();
});


  
  // CQ_CLIENTE_ENSAMBLADO_V2
  app.get('/cliente', (req, res) => {
    try {
      const datos = leerPerfiles(req.cliente.id);
      const vista = require('./cq_cliente_vista_original');
      res.send(vista.renderizar(
        req.cliente, datos, req.csrfCliente
      ));
    } catch (e) {
      console.error('[CQ VISTA]', e.message);
      res.status(500).send('Error cargando perfiles');
    }
  });

  app.get('/cliente/cq-nuevo', (req, res) => {
    res.redirect('/cliente/formulario-original');
  });

  app.post('/cliente/cq-accion', (req, res) => {
    try {
      const c = req.cliente;
      const id = String(req.body.id || '');
      const accion = String(req.body.accion || '');
      const datos = leerPerfiles(c.id);

      if (!Object.prototype.hasOwnProperty.call(datos, id)) {
        return res.sendStatus(404);
      }

      if (accion === 'pausar' || accion === 'reanudar') {
        datos[id].estado =
          accion === 'pausar' ? 'PAUSADA' : 'ACTIVA';

        datos[id].ultima_hora = new Date().toISOString();
        datos[id].ultima_accion =
          accion === 'pausar' ? 'Pausado' : 'Reanudado';

        guardarPerfiles(c.id, datos);

        void cqNotificarClienteTelegram(
          datos[id], c, datos[id].ultima_accion
        );

        return res.redirect('/cliente');
      }

      return res.status(501).send(
        'Esta accion todavia requiere conectar su funcion original.'
      );
    } catch (e) {
      console.error('[CQ ACCION]', e.message);
      return res.sendStatus(500);
    }
  });


  app.get('/cliente/formulario-original',(req,res)=>{
    const c=req.cliente;
    const datos=leerPerfiles(c.id);
    const ids=Object.keys(datos);

    let contenido=`
      <h1>🔥 PANEL PRO — ${esc(c.nombre)}</h1>
      <p>Tu espacio privado</p>
      <p>Perfiles: ${ids.length} / ${c.limite}</p>
      <p>Licencia hasta: ${esc(c.vencimiento)}</p>
      <a class="btn" href="/cliente/salir">Cerrar sesión</a>
      <div class="card">
      <h2>➕ Nuevo perfil</h2>
      <form method="POST" action="/cliente/crear">
      ${campoCsrf(req)}
      <label>Número o ID del perfil
      <input name="id" maxlength="40" required></label>
      <label>Chat ID de Telegram<input name="chat_id" required pattern="-?[0-9]{5,20}"></label><label>Nombre del perfil
      <input name="nombre" maxlength="100" required></label>
      <button class="success">Crear perfil</button>
      </form></div>`;

    for(const id of ids) {
      const p=datos[id];
      contenido+=`
        <div class="card">
        <h2>${esc(p.nombre)}</h2>
        <p>ID: ${esc(id)}</p><p>Cliente ID: ${esc(c.id)}</p><p>Token del perfil: ${esc(p.cliente_token || "SIN TOKEN")}</p>
        <form method="POST" action="/cliente/estado">
        ${campoCsrf(req)}
        <input type="hidden" name="id" value="${esc(id)}">
        <select name="estado">
        <option value="ACTIVA" ${p.estado==='ACTIVA'?'selected':''}>ACTIVA</option>
        <option value="PAUSADA" ${p.estado==='PAUSADA'?'selected':''}>PAUSADA</option>
        </select>
        <button>Guardar estado</button>
        </form>
        <a href="/cliente/editar?id=${encodeURIComponent(id)}" style="display:inline-block;background:#f97316;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;margin:6px 4px">✏️ Editar</a>
<form method="POST" action="/cliente/borrar"
          onsubmit="return confirm('¿Eliminar este perfil?')">
        ${campoCsrf(req)}
        <input type="hidden" name="id" value="${esc(id)}">
        <button class="danger">Borrar perfil</button>
        </form></div>`;
    }

    res.send(pagina('Mis perfiles',contenido));
  });

  app.post('/cliente/crear',(req,res)=>{
    const c=req.cliente;
    const id=String(req.body.id||'').trim();
    const nombre=String(req.body.nombre||'').trim();

    if(!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || !nombre || nombre.length>100) {
      return res.status(400).send('Datos invalidos');
    }

    const datos=leerPerfiles(c.id);

    if(Object.prototype.hasOwnProperty.call(datos,id)) {
      return res.status(409).send('Perfil existente');
    }

    if(Object.keys(datos).length>=c.limite) {
      return res.status(403).send('Limite de perfiles alcanzado');
    }

    const chat_id=String(req.body.chat_id||'').trim(); if(!/^-?[0-9]{5,20}$/.test(chat_id)) return res.status(400).send('Chat ID invalido'); datos[id]={nombre,chat_id,estado:'PAUSADA',cliente_token:crypto.randomBytes(32).toString('hex')};
    guardarPerfiles(c.id,datos);
    void cqNotificarClienteTelegram(
      datos[id],
      c,
      'PERFIL CREADO'
    );
    res.redirect('/cliente');
  });

  
/* CQ_EDICION_CLIENTES_V1 */

function cqEscapar(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get('/cliente/editar', (req, res) => {
  if (!req.cliente || !req.cliente.id) {
    return res.status(403).send('Acceso no autorizado');
  }

  const id = String(req.query.id || '');
  const datos = leerPerfiles(req.cliente.id);

  if (!Object.prototype.hasOwnProperty.call(datos, id)) {
    return res.status(404).send('Perfil no encontrado');
  }

  const p = datos[id];

  const campo = (titulo, nombre, valor) =>
    '<label style="display:block;margin-top:14px">' +
      '<b>' + cqEscapar(titulo) + '</b>' +
      '<input style="display:block;width:100%;box-sizing:border-box;' +
      'padding:12px;margin-top:6px" name="' +
      cqEscapar(nombre) + '" value="' +
      cqEscapar(valor) + '" />' +
    '</label>';

  const contenido =
    '<div class="card">' +
    '<h2>✏️ Editar perfil ' + cqEscapar(id) + '</h2>' +
    '<form method="POST" action="/cliente/guardar-edicion">' +
    campoCsrf(req) +
    '<input type="hidden" name="id" value="' +
      cqEscapar(id) + '">' +

    campo('Nombre', 'nombre', p.nombre) +
    campo('Chat ID', 'chat_id', p.chat_id) +
    campo('Telefono', 'telefono', p.telefono) +
    campo('Codigo', 'codigo', p.codigo) +
    campo('Ubicacion', 'ubicacion', p.ubicacion) +

    '<label style="display:block;margin-top:14px">' +
    '<b>Texto</b>' +
    '<textarea name="texto" rows="5" ' +
      'style="display:block;width:100%;box-sizing:border-box;' +
      'padding:12px;margin-top:6px">' +
    cqEscapar(p.texto) +
    '</textarea></label>' +

    '<p>El token del perfil se conserva sin cambios.</p>' +

    '<div style="margin-top:20px">' +
    '<button type="submit">Guardar cambios</button> ' +
    '<a href="/cliente">Volver</a>' +
    '</div></form></div>';

  return res.send(pagina('Editar perfil', contenido));
});

app.post('/cliente/guardar-edicion', (req, res) => {
  if (!req.cliente || !req.cliente.id) {
    return res.status(403).send('Acceso no autorizado');
  }

  const id = String(req.body.id || '');
  const datos = leerPerfiles(req.cliente.id);

  if (!Object.prototype.hasOwnProperty.call(datos, id)) {
    return res.status(404).send('Perfil no encontrado');
  }

  const campos = [
    'nombre',
    'chat_id',
    'telefono',
    'codigo',
    'ubicacion',
    'texto'
  ];

  const nuevos = {};

  for (const campo of campos) {
    if (typeof req.body[campo] !== 'string') {
      return res.status(400).send('Dato invalido: ' + campo);
    }

    nuevos[campo] = req.body[campo].trim();

    if (nuevos[campo].length > 5000) {
      return res.status(400).send('Campo demasiado largo');
    }
  }

  if (!nuevos.nombre || nuevos.nombre.length > 100) {
    return res.status(400).send('Nombre invalido');
  }

  if (!/^-?[0-9]{5,20}$/.test(nuevos.chat_id)) {
    return res.status(400).send('Chat ID invalido');
  }

  if (
    nuevos.telefono.length > 100 ||
    nuevos.codigo.length > 100 ||
    nuevos.ubicacion.length > 200
  ) {
    return res.status(400).send('Datos demasiado largos');
  }

  // Actualizar el perfil existente.
  // No cambiar token, ID, estadisticas ni fotos.
  Object.assign(datos[id], nuevos);

  guardarPerfiles(req.cliente.id, datos);

  return res.redirect('/cliente');
});

/* FIN CQ_EDICION_CLIENTES_V1 */

app.post('/cliente/estado',(req,res)=>{
    const datos=leerPerfiles(req.cliente.id);
    const id=String(req.body.id||'');
    const estado=String(req.body.estado||'');

    if(!Object.prototype.hasOwnProperty.call(datos,id) ||
       !['ACTIVA','PAUSADA'].includes(estado)) {
      return res.sendStatus(400);
    }

    datos[id].estado=estado;
    guardarPerfiles(req.cliente.id,datos);
    void cqNotificarClienteTelegram(
      datos[id],
      req.cliente,
      estado === 'ACTIVA' ? 'REANUDADO' : 'PAUSADO'
    );
    res.redirect('/cliente');
  });

  app.post('/cliente/borrar',(req,res)=>{
    const datos=leerPerfiles(req.cliente.id);
    const id=String(req.body.id||'');

    if(!Object.prototype.hasOwnProperty.call(datos,id)) {
      return res.sendStatus(404);
    }

    delete datos[id];
    guardarPerfiles(req.cliente.id,datos);
    res.redirect('/cliente');
  });

  app.get('/cliente/salir',(req,res)=>{
    sesiones.delete(cookie(req));
    res.clearCookie('cq_cliente',{path:'/cliente'});
    res.redirect('/cliente/login');
  });
};
