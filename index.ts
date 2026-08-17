import { Telegraf } from "telegraf";
import { google } from "googleapis";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS!);

const bot = new Telegraf(TOKEN);

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const aliases: Record<string, string> = {
  super: "Supermercado",
  supermercado: "Supermercado",
  despensa: "Supermercado",

  tarjeta: "Tarjetas",
  tarjetas: "Tarjetas",
  visa: "Tarjetas",
  master: "Tarjetas",
  mastercard: "Tarjetas",
  amex: "Tarjetas",

  nafta: "Combustible",
  gasoil: "Combustible",
  combustible: "Combustible",

  restaurante: "Comida afuera",
  delivery: "Comida afuera",
  "comida afuera": "Comida afuera",

  farmacia: "Salud",
  remedios: "Salud",
  medicamentos: "Salud",

  colegio: "Educación",
  escuela: "Educación",

  ropa: "Ropa",
  calzado: "Ropa",
  zapatillas: "Ropa",

  uber: "Transporte",
  taxi: "Transporte",
  remis: "Transporte",

  luz: "Servicios",
  gas: "Servicios",
  agua: "Servicios",
  internet: "Servicios",

  impuestos: "Impuestos",
  rentas: "Impuestos",

  viajes: "Viajes",
  viaje: "Viajes",
  hotel: "Viajes",

  regalo: "Regalos",
  regalos: "Regalos",

  limpieza: "Limpieza",
  hogar: "Hogar",
  entretenimiento: "Entretenimiento",
};

function normalizarCategoria(texto: string) {
  const limpia = texto.trim().toLowerCase();

  return (
    aliases[limpia] ??
    limpia.charAt(0).toUpperCase() + limpia.slice(1)
  );
}

function convertirMonto(texto: string) {
  return Number(
    texto
      .replace("$", "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

function fechaArgentina() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Argentina/Cordoba",
  });
}

function horaArgentina() {
  return new Date().toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function asegurarPestaña(nombre: string) {
  const libro = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const existe = libro.data.sheets?.some(
    (hoja) =>
      hoja.properties?.title?.trim().toLowerCase() ===
      nombre.toLowerCase()
  );

  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: nombre,
              },
            },
          },
        ],
      },
    });

    console.log(`✅ Pestaña "${nombre}" creada`);
  }
}

async function asegurarEstructura() {
  await asegurarPestaña("gastos");
  await asegurarPestaña("totales");

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "'gastos'!A1:E1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        "Fecha",
        "Hora",
        "Usuario",
        "Categoría",
        "Monto",
      ]],
    },
  });
}

async function actualizarTotales() {
  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'gastos'!A2:E",
  });

  const gastos = respuesta.data.values ?? [];

  const totales = new Map<string, number>();

  for (const fila of gastos) {
    const [fecha, , usuario, , monto] = fila;

    if (!fecha || !usuario || monto === undefined) continue;

    const valor = Number(
      String(monto)
        .replace(/\./g, "")
        .replace(",", ".")
    );

    if (!Number.isFinite(valor)) continue;

    const mes = String(fecha).slice(0, 7);

    const claves = [
      `Diario|${fecha}|Familiar`,
      `Diario|${fecha}|${usuario}`,
      `Mensual|${mes}|Familiar`,
      `Mensual|${mes}|${usuario}`,
    ];

    for (const clave of claves) {
      totales.set(
        clave,
        (totales.get(clave) ?? 0) + valor
      );
    }
  }

  const filas: (string | number)[][] = [
    ["Tipo", "Período", "Usuario", "Total"],
  ];

  for (const [clave, total] of totales) {
    const [tipo, periodo, usuario] = clave.split("|");

    filas.push([
      tipo,
      periodo,
      usuario,
      total,
    ]);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "'totales'!A:D",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "'totales'!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: filas,
    },
  });

  console.log("✅ Totales actualizados");
}

bot.on("text", async (ctx) => {
  const texto = ctx.message.text.trim();

  if (texto.startsWith("/")) return;

  const partes = texto.split(/\s+/);

  if (partes.length < 2) return;

  const ultimo = partes.at(-1)!;

  if (!/^\$?[\d.,]+$/.test(ultimo)) return;

  const monto = convertirMonto(ultimo);

  if (!Number.isFinite(monto) || monto <= 0) return;

  const categoriaOriginal =
    partes.slice(0, -1).join(" ");

  const categoria =
    normalizarCategoria(categoriaOriginal);

  const usuario =
    `${ctx.from.first_name}${
      ctx.from.last_name
        ? " " + ctx.from.last_name
        : ""
    }`;

  // PRIMERO: guardar el gasto
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "'gastos'!A:E",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          fechaArgentina(),
          horaArgentina(),
          usuario,
          categoria,
          monto,
        ]],
      },
    });
  } catch (error) {
    console.error(
      "❌ Error guardando gasto:",
      error
    );

    await ctx.reply(
      "❌ No pude guardar el gasto."
    );

    return;
  }

  // SEGUNDO: actualizar totales
  try {
    await actualizarTotales();
  } catch (error) {
    console.error(
      "⚠️ El gasto se guardó, pero falló totales:",
      error
    );
  }

  // Si llegamos acá, EL GASTO SE GUARDÓ
  await ctx.reply(
    `✅ ${categoria} — $${monto.toLocaleString("es-AR")}`
  );
});

async function iniciar() {
  await asegurarEstructura();
  await actualizarTotales();

  await bot.launch();

  console.log(
    "🤖 Esperancito está funcionando"
  );
}

iniciar().catch((error) => {
  console.error(
    "❌ Error iniciando Esperancito:",
    error
  );
});
