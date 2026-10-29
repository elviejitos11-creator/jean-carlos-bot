const fs = require('fs');
const crypto = require('crypto');

const servidor = 'server.js';
const portal = 'cliente_portal.js';

const s = fs.readFileSync(servidor, 'utf8');
const p = fs.readFileSync(portal, 'utf8');

const marca = "require('./seguridad_admin')(app);";
const api = "require('./cliente_api')(app);";

const crear = "datos[id]={nombre,estado:'PAUSADA'};";
const crearNuevo = "datos[id]={nombre,estado:'PAUSADA',cliente_token:crypto.randomBytes(32).toString('hex')};";

const mostrar = '<p>ID: ${esc(id)}</p>';
const mostrarNuevo = mostrar +
  '<p>Cliente ID: ${esc(c.id)}</p>' +
  '<p>Token del perfil: ${esc(p.cliente_token || "SIN TOKEN")}</p>';

if (!s.includes('const PORT = 3003;')) {
  throw Error('Puerto 3003 no confirmado');
}

if (!s.includes(marca)) {
  throw Error('Punto de integracion no encontrado');
}

if (!p.includes(crear) && !p.includes(crearNuevo)) {
  throw Error('Formulario de perfiles no reconocido');
}

if (!p.includes(mostrar)) {
  throw Error('Pantalla de perfiles no reconocida');
}

if (!s.includes(api)) {
  fs.copyFileSync(servidor, servidor+'.antes_api_clientes.bak');
  fs.writeFileSync(servidor, s.replace(marca, api+'\n'+marca));
}

if (p.includes(crear)) {
  fs.copyFileSync(portal, portal+'.antes_api_clientes.bak');

  fs.writeFileSync(
    portal,
    p.replace(crear, crearNuevo)
     .replace(mostrar, mostrarNuevo)
  );
}

console.log('INTEGRACION DE API COMPLETADA');
