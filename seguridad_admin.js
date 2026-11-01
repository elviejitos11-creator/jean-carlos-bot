const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sesiones = new Map();
const intentos = new Map();
const archivo = path.join(__dirname, 'admin_auth.json');
const DURACION = 8 * 60 * 60 * 1000;

function comprobar(usuario, clave) {
  const cuenta = JSON.parse(((process.env.CQ_ADMIN_AUTH_B64 || '')
 ? Buffer.from((process.env.CQ_ADMIN_AUTH_B64 || ''), 'base64').toString('utf8')
 : fs.readFileSync(archivo, 'utf8')));

  if (usuario !== cuenta.usuario) return false;

  const salt = Buffer.from(cuenta.salt, 'base64');
  const bytes = Buffer.from(String(clave), 'utf8');
  const calculado = crypto.createHash('sha256')
    .update(Buffer.concat([salt, bytes])).digest();
  const esperado = Buffer.from(cuenta.hash, 'base64');

  return calculado.length === esperado.length &&
    crypto.timingSafeEqual(calculado, esperado);
}

function tokenSesion(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const cookie = cookies.find(c => c.trim().startsWith('cq_admin='));
  return cookie ? cookie.trim().slice('cq_admin='.length) : '';
}

function paginaLogin(error = '') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PANEL PRO - Acceso privado</title>
<link rel="apple-touch-icon" href="/cq3-postbot.png">
<link rel="icon" type="image/png" href="/cq3-postbot.png">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;
justify-content:center;padding:20px;font-family:Arial,sans-serif;
color:white;background:linear-gradient(135deg,#071b35,#210b43)}
.panel{width:100%;max-width:420px;padding:32px;
background:#101d38;border:1px solid #354579;border-radius:22px}
h1{text-align:center;margin:10px 0}
p{text-align:center;color:#adb9d9}
label{display:block;margin:20px 0 8px}
input{width:100%;padding:15px;background:#081326;color:white;
border:1px solid #405078;border-radius:10px;font-size:16px}
button{width:100%;padding:16px;margin-top:25px;color:white;
background:linear-gradient(90deg,#087fff,#b91de8);
border:0;border-radius:11px;font-size:16px;font-weight:bold}
.error{color:#ff9393}
</style>
</head>
<body>
<div class="panel">
<div style="text-align:center;margin-bottom:18px">
<img src="/cq3-postbot.png" alt="POSTBOT TELEGRAM"
style="width:150px;max-width:100%;height:auto;border-radius:22px">
</div>
<h1><span style="font-size:1.6em">🐺</span> PANEL PRO <span style="font-size:1.6em">🐺</span></h1>
<p>ACCESO PRIVADO</p>
<form method="POST" action="/login">
<label>Usuario</label>
<input name="usuario" autocomplete="username" required>
<label>Contraseña</label>
<input name="clave" type="password" autocomplete="current-password" required>
<button type="submit">ENTRAR AL PANEL</button>
</form>
<p class="error">${error ? 'Credenciales incorrectas o acceso temporalmente bloqueado' : ''}</p>
</div>
</body>
</html>`;
}

module.exports = function activarSeguridad(app) {
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

      // CQ3_DISENO_POSTBOT_V4
    app.get('/cq3-postbot.png', (req, res) => {
        return res.sendFile(path.join(__dirname, 'cq3-postbot.png'));
    });
app.get('/login', (req, res) => {
    res.send(paginaLogin());
  });

  app.post('/login', (req, res) => {
    const ip = req.ip || 'local';
    const ahora = Date.now();
    const actual = intentos.get(ip) || { fallos: 0, hasta: 0 };

    if (actual.hasta > ahora) {
      return res.status(429).send(paginaLogin('error'));
    }

    if (!comprobar(req.body.usuario, req.body.clave)) {
      actual.fallos++;
      if (actual.fallos >= 5) {
        actual.hasta = ahora + 15 * 60 * 1000;
        actual.fallos = 0;
      }
      intentos.set(ip, actual);
      return res.status(401).send(paginaLogin('error'));
    }

    intentos.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, Date.now() + DURACION);

    res.cookie('cq_admin', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
      maxAge: DURACION
    });

    res.redirect('/');
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/cliente')) return next();
    // CQ_CLIENTE_SOLO_SU_PANEL_V2
    const mCliente = /^\/admin\/panel\/([a-f0-9-]{36})(?:\/(nuevo|guardar-perfil|accion|editar\/[A-Za-z0-9_-]{1,50}))?\/?$/i.exec(req.path);

    if (mCliente) {
      const operacion = mCliente[2] || '';
      const permitir =
        (req.method === 'GET' &&
          (operacion === '' ||
           operacion === 'nuevo' ||
           operacion.startsWith('editar/'))) ||
        (req.method === 'POST' &&
          (operacion === 'guardar-perfil' ||
           operacion === 'accion'));

      if (permitir) {
        const obtenerCliente = app.locals.cqClienteActual;
        const c = typeof obtenerCliente === 'function'
          ? obtenerCliente(req) : null;

        if (c && c.id.toLowerCase() === mCliente[1].toLowerCase()) {
          if (req.method === 'POST') {
            const origen = req.get('origin');
            const esperado =
              (req.get('x-forwarded-proto') || req.protocol) +
              '://' + req.get('host');

            if (!origen || origen !== esperado) {
              return res.sendStatus(403);
            }
          }

          req.cliente = c;
          return next();
        }
      }
    }
        // CQ_REPARACION_API_ORIGINAL_3003
        // Conservar las rutas originales utilizadas por el script.
        if (
          req.method === 'GET' &&
          /^\/api\/(estado|licencia)\/[^/]+\/?$/.test(req.path)
        ) return next();

        if (
          req.method === 'POST' &&
          req.path === '/registrar-evento'
        ) return next();

    const token = tokenSesion(req);
    const vence = sesiones.get(token);

    if (!vence || vence <= Date.now()) {
      if (token) sesiones.delete(token);
      if (req.method === 'GET') return res.redirect('/login');
      return res.status(401).json({ ok: false, error: 'Acceso no autorizado' });
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origen = req.headers.origin;
      const esperado = (req.get('x-forwarded-proto') || req.protocol) + '://' + req.get('host');
      if (origen && origen !== esperado) {
        return res.status(403).json({ ok: false, error: 'Origen no permitido' });
      }
    }

    req.admin = true;
    next();
  });

  app.get('/salir', (req, res) => {
    sesiones.delete(tokenSesion(req));
    res.clearCookie('cq_admin', { path: '/' });
    res.redirect('/login');
  });
};
