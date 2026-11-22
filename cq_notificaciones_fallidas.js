"use strict";

const fs = require("fs");
const path = require("path");

function guardarNotificacionFallida(carpeta, evento) {
  fs.mkdirSync(carpeta, { recursive: true });

  const archivo = path.join(
    carpeta,
    "notificaciones_fallidas.jsonl"
  );

  const registro = {
    fecha: new Date().toISOString(),
    id: String(evento.id || ""),
    tipo: String(evento.tipo || "general"),
    motivo: String(evento.motivo || "Error de entrega"),
    estado: "PENDIENTE_REVISION"
  };

  fs.appendFileSync(
    archivo,
    JSON.stringify(registro) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );

  return archivo;
}

module.exports = { guardarNotificacionFallida };
