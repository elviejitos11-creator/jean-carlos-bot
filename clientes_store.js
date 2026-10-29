const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = path.join(__dirname, 'clientes_data');
const REGISTRO = path.join(BASE, 'clientes.json');

function preparar() {
  fs.mkdirSync(BASE, { recursive: true });
  if (!fs.existsSync(REGISTRO)) {
    guardar(REGISTRO, []);
  }
}

function guardar(archivo, datos) {
  const temporal = archivo + '.tmp';
  fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), 'utf8');
  fs.renameSync(temporal, archivo);
}

function listar() {
  preparar();
  const datos = JSON.parse(fs.readFileSync(REGISTRO, 'utf8'));
  if (!Array.isArray(datos)) throw Error('Registro invalido');
  return datos;
}

function hashClave(clave, salt) {
  return crypto.scryptSync(clave, salt, 64).toString('hex');
}

function carpetaCliente(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('ID invalido');
  return path.join(BASE, id);
}

function crearCliente(nombre, usuario, clave, dias = 30, limite = 20) {
  const clientes = listar();
  nombre = String(nombre || '').trim();
  usuario = String(usuario || '').trim().toLowerCase();
  clave = String(clave || '');
  dias = Number(dias);
  limite = Number(limite);

  if (!nombre || !/^[a-z0-9_-]{3,40}$/.test(usuario)) {
    throw Error('Nombre o usuario invalido');
  }
  if (clave.length < 12) throw Error('La clave necesita 12 caracteres');
  if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
    throw Error('Dias invalidos');
  }
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
    throw Error('Limite invalido');
  }
  if (clientes.some(c => c.usuario === usuario)) {
    throw Error('Usuario existente');
  }

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(32).toString('hex');
  const vencimiento = new Date(Date.now() + dias * 86400000).toISOString();
  const carpeta = carpetaCliente(id);

  fs.mkdirSync(carpeta, { recursive: false });

  guardar(path.join(carpeta, 'data.json'), {});
  guardar(path.join(carpeta, 'bot_state.json'), {
    offset: 0,
    schedules: [],
    esperandoFoto: null
  });

  clientes.push({
    id, nombre, usuario,
    salt,
    claveHash: hashClave(clave, salt),
    vencimiento,
    limite,
    activo: true,
    creado: new Date().toISOString()
  });

  guardar(REGISTRO, clientes);
  return { id, nombre, usuario, vencimiento, limite };
}

function autenticar(usuario, clave) {
  const cliente = listar().find(
    c => c.usuario === String(usuario).trim().toLowerCase()
  );
  if (!cliente || !cliente.activo) return null;
  if (Date.parse(cliente.vencimiento) <= Date.now()) return null;

  const obtenido = Buffer.from(hashClave(String(clave), cliente.salt), 'hex');
  const esperado = Buffer.from(cliente.claveHash, 'hex');

  if (obtenido.length !== esperado.length) return null;
  if (!crypto.timingSafeEqual(obtenido, esperado)) return null;

  return {
    id: cliente.id,
    nombre: cliente.nombre,
    usuario: cliente.usuario,
    limite: cliente.limite, vencimiento: cliente.vencimiento
  };
}

function revocarCliente(id) {
  const clientes = listar();
  const cliente = clientes.find(c => c.id === id);
  if (!cliente) return false;
  cliente.activo = false;
  guardar(REGISTRO, clientes);
  return true;
}

function editarCliente(id, cambios) {
  const clientes = listar();
  const c = clientes.find(x => x.id === id);
  if (!c) throw Error('Cliente inexistente');

  const nombre = String(cambios.nombre || '').trim();
  const usuario = String(cambios.usuario || '').trim().toLowerCase();
  const clave = String(cambios.clave || '');
  const limite = Number(cambios.limite);
  const fecha = String(cambios.vencimiento || '').trim();

  if (!nombre || !/^[a-z0-9_-]{3,40}$/.test(usuario))
    throw Error('Nombre o usuario invalido');

  if (clientes.some(x => x.id !== id && x.usuario === usuario))
    throw Error('Ese usuario ya existe');

  if (!Number.isInteger(limite) || limite < 1 || limite > 100)
    throw Error('Limite de perfiles invalido');

  if (clave && clave.length < 12)
    throw Error('La nueva contraseña requiere 12 caracteres');

  let vencimiento;

  if (/^\+[0-9]{1,4}$/.test(fecha)) {
    const dias = Number(fecha.slice(1));
    if (dias < 1 || dias > 3650) throw Error('Dias invalidos');
    const base = Math.max(Date.now(), Date.parse(c.vencimiento));
    vencimiento = new Date(base + dias * 86400000).toISOString();
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))
      throw Error('Fecha invalida');

    const d = new Date(fecha + 'T23:59:59.000Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== fecha)
      throw Error('Fecha invalida');

    vencimiento = d.toISOString();
  }

  c.nombre = nombre;
  c.usuario = usuario;
  c.limite = limite;
  c.vencimiento = vencimiento;

  if (clave) c.claveHash = hashClave(clave, c.salt);

  guardar(REGISTRO, clientes);

  return {
    id:c.id, nombre:c.nombre, usuario:c.usuario,
    limite:c.limite, vencimiento:c.vencimiento,
    activo:c.activo
  };
}
module.exports = {
  crearCliente,
  editarCliente,
  autenticar,
  revocarCliente,
  listar,
  carpetaCliente
};
