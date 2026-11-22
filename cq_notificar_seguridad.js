'use strict';

function crearNotificador(enviarTexto) {
  return async function notificar(evento, chatId) {
    if (!evento || evento.duplicada) return false;
    if (!chatId) return false;

    const mensaje = [
      'ALERTA DE SEGURIDAD',
      '',
      'Perfil: ' + evento.perfil,
      'Tipo: ' + evento.tipo,
      'Motivo: ' + evento.motivo,
      'Fecha: ' + evento.fecha,
      '',
      'Se requiere revision manual.'
    ].join('\n');

    const resultado = await enviarTexto(mensaje, chatId);

    return resultado?.ok === true;
  };
}

module.exports = { crearNotificador };