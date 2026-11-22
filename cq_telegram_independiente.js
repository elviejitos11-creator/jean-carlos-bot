"use strict";

const { crearColaNotificaciones } =
  require("./cq_cola_notificaciones");

function crearServicioTelegram({
  enviarTelegram,
  maxIntentos = 3
}) {
  if (typeof enviarTelegram !== "function") {
    throw new Error("Falta la funcion de envio a Telegram");
  }

  const cola = crearColaNotificaciones({
    enviar: async evento => {
      await enviarTelegram(evento.chatId, evento.texto);
    },
    maxIntentos,
    esperaMs: 2000,
    timeoutMs: 8000
  });

  function notificar(chatId, texto) {
    if (!chatId || !texto) {
      throw new Error("Falta chatId o texto");
    }

    return cola.agregar(
      String(chatId),
      {
        chatId: String(chatId),
        texto: String(texto)
      }
    );
  }

  return { notificar, cola };
}

module.exports = { crearServicioTelegram };
