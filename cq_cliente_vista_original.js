
'use strict';

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dato(p, clave, defecto = 'N/A') {
  const v = p[clave];
  return v === undefined || v === null || v === ''
    ? defecto : String(v);
}

function tiempoPlan(p) {
  const v = p.fin_plan;
  if (!v) return 'N/A';

  const fecha = new Date(v);
  if (!Number.isFinite(fecha.getTime())) return String(v);

  const ms = fecha.getTime() - Date.now();
  if (ms <= 0) return 'Vencido';

  const dias = Math.floor(ms / 86400000);
  const horas = Math.floor(ms / 3600000) % 24;
  const minutos = Math.floor(ms / 60000) % 60;

  return dias + ' dias, ' + horas + 'h ' + minutos + 'm';
}

function siguiente(p) {
  if (Number.isFinite(Number(p.proximo_post_ts)) &&
      Number(p.proximo_post_ts) > 0) {
    const ms = Math.max(0, Number(p.proximo_post_ts) - Date.now());
    return Math.floor(ms / 60000) + 'm ' +
      Math.floor(ms / 1000) % 60 + 's';
  }
  return dato(p, 'proximo_post');
}

function fila(icono, etiqueta, valor) {
  return '<div class="fila">' + icono + ' ' +
    esc(etiqueta) + ': ' + esc(valor) + '</div>';
}

function tarjeta(id, p, csrf) {
  const activa = p.estado === 'ACTIVA';
  const fotos = Array.isArray(p.historial_fotos)
    ? p.historial_fotos.length : 0;

  const nombre = dato(p, 'nombre', 'Perfil ' + id);

  const estado = activa ? 'ACTIVA' : 'PAUSADA';

  const accion = (tipo, titulo, clase) =>
    '<form method="POST" action="/cliente/cq-accion">' +
    '<input type="hidden" name="_csrf" value="' + esc(csrf) + '">' +
    '<input type="hidden" name="id" value="' + esc(id) + '">' +
    '<input type="hidden" name="accion" value="' + esc(tipo) + '">' +
    '<button class="' + clase + '">' + titulo + '</button>' +
    '</form>';

  const foto = (valor) => {
    if (typeof valor !== 'string') return '';
    if (!/^https?:\/\//i.test(valor)) return '';
    try {
      const u = new URL(valor);
      if (!['http:', 'https:'].includes(u.protocol)) return '';
      return '<a class="boton azul" target="_blank" rel="noopener noreferrer" href="' +
        esc(u.href) + '">📸 Ver foto</a>';
    } catch {
      return '';
    }
  };

  return '<section class="tarjeta">' +
    '<h3>' + esc(nombre) + '</h3>' +
    fila('??', 'Perfil', id) +
    fila('??', 'Chat ID', dato(p, 'chat_id')) +
    fila('??', 'Telefono', dato(p, 'telefono')) +
    fila('??', 'Codigo', dato(p, 'codigo')) +
    fila('??', 'Ubicacion', dato(p, 'ubicacion')) +
    '<div class="estado">' +
    (activa ? '??' : '??') + ' ' + estado + '</div>' +
    fila('??', 'Ultima hora', dato(p, 'ultima_hora')) +
    fila('??', 'Proximo bump', siguiente(p)) +
    fila('??', 'Fin de plan', tiempoPlan(p)) +
    fila('??', 'Bump hoy', dato(p, 'bump_hoy', '0')) +
    fila('??', 'Bump total', dato(p, 'bump_total', '0')) +
    fila('???', 'Historial fotos', fotos) +
    '<div class="pequeno">Ultima accion: ' +
    esc(dato(p, 'ultima_accion')) + '</div>' +

    '<details><summary>?? Texto de publicacion</summary>' +
    '<div class="texto">' + esc(dato(p, 'texto')) +
    '</div></details>' +

    '<div class="acciones">' +
    accion('pausar', '? Pausar', 'rojo') +
    accion('reanudar', '?? Reanudar', 'verde') +
    accion('progpausa', '? Programar pausa', 'gris') +
    accion('progreanudar', '? Programar reanudar', 'gris') +
    accion('ultima', '?? Ultimo bump', 'azul') +
    foto(p.foto_pagina || p.foto_modelo) +
    '<a class="boton naranja" href="/cliente/editar?id=' +
      encodeURIComponent(id) + '">✏️ Editar</a>' +
    '</div>' +
    '</section>';
}

function renderizar(cliente, perfiles, csrf) {
  const ids = Object.keys(perfiles);

  const tarjetas = ids.map(id => tarjeta(id, perfiles[id], csrf))
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>CQ PANEL PRO - CLIENTE</title>',
    '<style>',
    '*{box-sizing:border-box}',
    'body{background:#0b1c2c;color:white;font-family:Arial,sans-serif;margin:0;padding:20px}',
    'main{max-width:1200px;margin:auto}',
    'h1{font-size:27px;margin-bottom:22px}',
    '.cuadricula{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}',
    '.tarjeta{background:#132f4c;padding:20px;border-radius:14px;min-width:0}',
    '.fila{margin:7px 0;font-size:14px;overflow-wrap:anywhere}',
    '.estado{font-weight:bold;margin:14px 0}',
    '.pequeno{font-size:12px;opacity:.8;margin:12px 0}',
    '.acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}',
    '.acciones form{margin:0}',
    'button,.boton{border:0;border-radius:9px;color:white;padding:11px 14px;font-weight:bold;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}',
    '.rojo{background:#c62828}.verde{background:#2e7d32}',
    '.gris{background:#455a64}.azul{background:#1565c0}',
    '.naranja{background:#ef6c00}',
    'details{margin:15px 0}',
    'summary{cursor:pointer}',
    '.texto{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;margin-top:8px;background:#09243a;border-radius:8px}',
    '.barra{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}',
    '.aviso{padding:12px;border:1px solid #416485;border-radius:9px;margin-bottom:15px}',
    '@media(max-width:700px){.cuadricula{grid-template-columns:1fr}}',
    '</style></head><body><main>',
    '<h1>?? PANEL PRO ??</h1>',
    '<h2>' + esc(cliente.nombre) + '</h2>',
    '<p>Perfiles: ' + ids.length + ' / ' + esc(cliente.limite) + '</p>',
    '<div class="barra">',
    '<a class="boton naranja" href="/cliente/cq-nuevo">? Nuevo perfil</a>',
    '<a class="boton gris" href="/cliente/salir">Cerrar sesion</a>',
    '</div>',
    '<div class="aviso">Panel de clientes. Las operaciones avanzadas de Telegram requieren activar y verificar el receptor de callbacks.</div>',
    '<div class="cuadricula">' + tarjetas + '</div>',
    '</main></body></html>'
  ].join('\n');
}

module.exports = { renderizar };
