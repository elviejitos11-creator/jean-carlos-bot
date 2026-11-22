"use strict";

const path = require("path");
const { guardarNotificacionFallida } =
  require("./cq_notificaciones_fallidas");

function crearColaNotificaciones({
  enviar,
  maxIntentos = 3,
  esperaMs = 2000,
  timeoutMs = 8000,
  directorioFallos = path.join(__dirname, "cq_fallos")
}) {
  if (typeof enviar !== "function") {
    throw new Error("Se necesita una funcion enviar");
  }

  const pendientes = [];
  let procesando = false;

  const esperar = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  async function conTimeout(promesa, ms) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(promesa),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Tiempo agotado")),
            ms
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function procesar() {
    if (procesando) return;
    procesando = true;

    try {
      while (pendientes.length) {
        const evento = pendientes.shift();
        let entregado = false;
        let ultimoError = "";

        for (let intento = 1; intento <= maxIntentos; intento++) {
          try {
            await conTimeout(
              enviar(evento.datos),
              timeoutMs
            );

            entregado = true;
            console.log("[COLA] Entrega completada:", evento.id);
            break;

          } catch (error) {
            ultimoError = error.message || String(error);

            console.error(
              "[COLA] Intento fallido:",
              evento.id,
              intento,
              ultimoError
            );

            if (intento < maxIntentos) {
              await esperar(esperaMs);
            }
          }
        }

        if (!entregado) {
          try {
            guardarNotificacionFallida(directorioFallos, {
              id: evento.id,
              tipo: "notificacion",
              motivo: ultimoError
            });

            console.log(
              "[COLA] Fallo definitivo registrado:",
              evento.id
            );
          } catch (error) {
            console.error(
              "[COLA] ERROR GUARDANDO FALLO:",
              error.message
            );
          }
        }
      }
    } finally {
      procesando = false;
    }
  }

  function agregar(id, datos) {
    pendientes.push({
      id: String(id),
      datos
    });

    void procesar();

    return {
      aceptado: true,
      pendientes: pendientes.length
    };
  }

  return {
    agregar,
    pendientes: () => pendientes.length
  };
}

module.exports = { crearColaNotificaciones };
