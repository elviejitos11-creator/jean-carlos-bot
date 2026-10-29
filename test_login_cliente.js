const assert = require('assert');
const store = require('./clientes_store');

const usuario = 'cliente_prueba';
const clave = 'PruebaSegura2026!';

const c = store.crearCliente(
  'Cliente Prueba', usuario, clave, 30, 20
);

assert(c && c.id, 'No se creo el cliente');
assert(store.autenticar(usuario, clave), 'Login incorrecto');
assert(!store.autenticar(usuario, 'ClaveIncorrecta'), 'Acepta clave incorrecta');

store.revocarCliente(c.id);

assert(!store.autenticar(usuario, clave), 'Revocacion fallida');

console.log('LOGIN CORRECTO');
console.log('CONTRASENA INCORRECTA RECHAZADA');
console.log('CLIENTE REVOCADO CORRECTAMENTE');
