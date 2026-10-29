const fs = require('fs');
const vm = require('vm');
const path = require('path');

const original = fs.readFileSync('server.js','utf8');
const arranque = original.indexOf('app.listen(PORT,');

if (arranque < 0 || !original.includes('const PORT = 3003;')) {
  throw Error('No se reconoce el servidor original');
}

const resultados = [];

function revisar(nombre, condicion) {
  resultados.push({nombre, correcto:!!condicion});
  console.log((condicion ? 'OK: ' : 'FALLO: ') + nombre);
}

const seguridad = fs.readFileSync('seguridad_admin.js','utf8');
const portal = fs.readFileSync('cliente_portal.js','utf8');
const api = fs.readFileSync('cliente_api.js','utf8');
const admin = fs.readFileSync('admin_api.js','utf8');

revisar('Login administrativo definido',
  seguridad.includes('/login'));

revisar('Login de clientes definido',
  portal.includes('/cliente/login'));

revisar('Revocacion de clientes implementada',
  fs.readFileSync('clientes_store.js','utf8').includes('revocarCliente'));

revisar('API de licencia por cliente',
  api.includes('/cliente-api/licencia/:id'));

revisar('API de eventos por cliente',
  api.includes('/cliente-api/registrar-evento'));

revisar('Botones independientes registrados',
  original.includes("require('./cliente_botones').manejar"));

revisar('Administracion de suspensiones',
  admin.includes('suspender'));

revisar('Puerto original conservado',
  original.includes('const PORT = 3003;'));

const fallos = resultados.filter(x=>!x.correcto);

console.log('\nRESULTADO:',resultados.length-fallos.length,
  'de',resultados.length,'comprobaciones');

if (fallos.length) process.exitCode=1;
