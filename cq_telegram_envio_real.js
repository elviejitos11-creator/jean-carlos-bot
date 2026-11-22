"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const directorio = path.join(__dirname, ".cq_telegram_pendientes");

function guardar(evento) {
  fs.mkdirSync(directorio, { recursive: true });
  const destino = path.join(directorio, evento.id + ".json");
  const temporal = destino + ".tmp";

  fs.writeFileSync(
    temporal,
    JSON.stringify(evento, null, 2),
    { mode: 0o600 }
  );

  fs.renameSync(temporal, destino);
  return destino;
}

async function enviarTelegram(evento) {
  const token = process.env.CQ_TEST_BOT_TOKEN;

  if (!token) {
    throw new Error("Falta token de Telegram");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const respuesta = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: evento.chatId,
          text: evento.texto
        }),
        signal: controller.signal
      }
    );

    const datos = await respuesta.json();

    if (!respuesta.ok || datos.ok !== true) {
      throw new Error(
        datos.description || "Telegram rechazó el envío"
      );
    }

    return datos.result?.message_id || null;

  } finally {
    clearTimeout(timer);
  }
}

async function procesar(archivo) {
  const evento = JSON.parse(fs.readFileSync(archivo, "utf8"));

  for (let intento = 1; intento <= 3; intento++) {
    try {
      const mensajeId = await enviarTelegram(evento);

      fs.unlinkSync(archivo);

      console.log("TELEGRAM: ENVIO CONFIRMADO");
      console.log("MENSAJE ID:", mensajeId);
      console.log("INTENTO:", intento);

      return true;

    } catch (error) {
      console.log(
        "INTENTO", intento,
        "ERROR:", error.message
      );

      if (intento < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  console.log("TELEGRAM: ENVIO NO CONFIRMADO");
  console.log("MENSAJE CONSERVADO PARA REINTENTO");

  return false;
}

async function main() {
  const accion = process.argv[2];

  if (accion === "test") {
    const chatId = process.env.CQ_TEST_CHAT_ID;

    if (!chatId || !process.env.CQ_TEST_BOT_TOKEN) {
      throw new Error("Faltan credenciales de prueba");
    }

    const evento = {
      id: crypto.randomUUID(),
      chatId,
      texto: "CQ - Prueba real de Telegram independiente.",
      creado: new Date().toISOString()
    };

    const archivo = guardar(evento);
    const correcto = await procesar(archivo);

    process.exitCode = correcto ? 0 : 1;

  } else if (accion === "retry") {
    if (!fs.existsSync(directorio)) {
      console.log("NO HAY MENSAJES PENDIENTES");
      return;
    }

    const archivos = fs.readdirSync(directorio)
      .filter(nombre => nombre.endsWith(".json"));

    let fallos = 0;

    for (const nombre of archivos) {
      const correcto = await procesar(
        path.join(directorio, nombre)
      );

      if (!correcto) fallos++;
    }

    console.log("PENDIENTES SIN CONFIRMAR:", fallos);
    process.exitCode = fallos ? 1 : 0;

  } else {
    throw new Error("Usa test o retry");
  }
}

main().catch(error => {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
});
