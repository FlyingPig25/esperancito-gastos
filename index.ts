import { Telegraf } from "telegraf";
import { google } from "googleapis";
import http from "http";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const GOOGLE_CREDENTIALS = JSON.parse(
  process.env.GOOGLE_CREDENTIALS!
);

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

  viaje: "Viajes",
  viajes: "Viajes",
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

function usuarioTelegram(ctx: any) {
  return `${ctx.from.first_name}${
    ctx.from.last_name ? " " + ctx.from.last_name : ""
  }`;
}

function formatoPesos(valor: number) {
  return `$${valor.toLocaleString("es-AR")}`;
}

function serialSheetsAFecha(serial: number) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const fecha = new Date(base.getTime() + serial * 86400000);

  return fecha.toISOString().slice(0, 10);
}

function normalizarFecha(valor: any) {
  if (valor === undefined || valor === null) {
    return "";
  }

  const texto = String(valor).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  if (/^\d{1,5}(\.\d+)?$/.test(texto)) {
    return serialSheetsAFecha(Number(texto));
  }

  const partesBarra = texto.split("/");

  if (partesBarra.length === 3) {
    const [dia, mes, anio] = partesBarra;

    if (dia && mes && anio) {
      return `${anio.padStart(4, "0")}-${mes.padStart(
        2,
        "0"
      )}-${dia.padStart(2, "0")}`;
    }
  }

  return texto;
}

async function asegurarPestaña(nombre: string) {
  const libro = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const nombres =
    libro.data.sheets?.map(
      hoja => hoja.properties?.title ?? ""
    ) ?? [];

  if (!nombres.includes(nombre)) {
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
  await asegurarPestaña("resumen");

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "gastos!A1:E1",
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

async function obtenerGastos() {
  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "gastos!A2:E",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return respuesta.data.values ?? [];
}

async function actualizarResumen() {
  const gastos = await obtenerGastos();

  const totales = new Map<string, number>();

  for (const fila of gastos) {
    const [fechaRaw, , usuario, , monto] = fila;

    const fecha = normalizarFecha(fechaRaw);

    if (!fecha || !usuario || monto === undefined) continue;

    const valor = Number(monto);

    if (!Number.isFinite(valor)) continue;

    const mes = fecha.slice(0, 7);

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
    range: "resumen!A:D",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "resumen!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: filas,
    },
  });
}

bot.command("hoy", async (ctx) => {
  const gastos = await obtenerGastos();
  const hoy = fechaArgentina();

  let totalFamiliar = 0;
  const porUsuario = new Map<string, number>();

  for (const fila of gastos) {
    const [fechaRaw, , usuario, , monto] = fila;

    const fecha = normalizarFecha(fechaRaw);

    if (fecha !== hoy) continue;

    const valor = Number(monto);

    if (!Number.isFinite(valor)) continue;

    totalFamiliar += valor;

    porUsuario.set(
      usuario,
      (porUsuario.get(usuario) ?? 0) + valor
    );
  }

  let mensaje =
    `💰 Hoy: ${formatoPesos(totalFamiliar)}`;

  for (const [usuario, total] of porUsuario) {
    mensaje +=
      `\n${usuario}: ${formatoPesos(total)}`;
  }

  await ctx.reply(mensaje);
});

bot.command("mes", async (ctx) => {
  const gastos = await obtenerGastos();
  const mesActual = fechaArgentina().slice(0, 7);

  let totalFamiliar = 0;
  const porUsuario = new Map<string, number>();

  for (const fila of gastos) {
    const [fechaRaw, , usuario, , monto] = fila;

    const fecha = normalizarFecha(fechaRaw);

    if (!fecha.startsWith(mesActual)) continue;

    const valor = Number(monto);

    if (!Number.isFinite(valor)) continue;

    totalFamiliar += valor;

    porUsuario.set(
      usuario,
      (porUsuario.get(usuario) ?? 0) + valor
    );
  }

  let mensaje =
    `📅 Mes actual: ${formatoPesos(totalFamiliar)}`;

  for (const [usuario, total] of porUsuario) {
    mensaje +=
      `\n${usuario}: ${formatoPesos(total)}`;
  }

  await ctx.reply(mensaje);
});

bot.command("ultimo", async (ctx) => {
  const gastos = await obtenerGastos();

  if (gastos.length === 0) {
    await ctx.reply("No hay gastos registrados.");
    return;
  }

  const ultimo = gastos[gastos.length - 1];

  const [
    fechaRaw,
    hora,
    usuario,
    categoria,
    monto,
  ] = ultimo;

  const fecha = normalizarFecha(fechaRaw);

  await ctx.reply(
    `🧾 Último gasto\n` +
    `${categoria} — ${formatoPesos(Number(monto))}\n` +
    `${usuario}\n` +
    `${fecha} ${hora}`
  );
});

bot.command("deshacer", async (ctx) => {
  const gastos = await obtenerGastos();
  const usuario = usuarioTelegram(ctx);

  let indice = -1;

  for (let i = gastos.length - 1; i >= 0; i--) {
    if (gastos[i][2] === usuario) {
      indice = i;
      break;
    }
  }

  if (indice === -1) {
    await ctx.reply(
      "No encontré gastos tuyos para borrar."
    );
    return;
  }

  const fila = gastos[indice];
  const numeroFilaSheets = indice + 2;

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const hojaGastos = metadata.data.sheets?.find(
    hoja => hoja.properties?.title === "gastos"
  );

  const sheetId =
    hojaGastos?.properties?.sheetId;

  if (sheetId === undefined) {
    await ctx.reply(
      "No pude encontrar la hoja de gastos."
    );
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: numeroFilaSheets - 1,
              endIndex: numeroFilaSheets,
            },
          },
        },
      ],
    },
  });

  await actualizarResumen();

  const [, , , categoria, monto] = fila;

  await ctx.reply(
    `🗑️ Eliminado: ${categoria} — ${formatoPesos(
      Number(monto)
    )}`
  );
});

bot.command("ayuda", async (ctx) => {
  await ctx.reply(
    `🤖 Esperancito\n\n` +
    `Para registrar un gasto:\n` +
    `Supermercado $25000\n` +
    `Tarjetas $150000\n` +
    `Nafta $50000\n\n` +
    `Comandos:\n` +
    `/hoy — gastos de hoy\n` +
    `/mes — gastos del mes\n` +
    `/ultimo — último gasto registrado\n` +
    `/deshacer — elimina tu último gasto\n` +
    `/ayuda — muestra esta ayuda`
  );
});

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

  const usuario = usuarioTelegram(ctx);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "gastos!A:E",
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

  try {
    await actualizarResumen();
  } catch (error) {
    console.error(
      "⚠️ Gasto guardado, pero falló el resumen:",
      error
    );
  }

  await ctx.reply(
    `✅ ${categoria} — ${formatoPesos(monto)}`
  );
});

async function iniciar() {
  await asegurarEstructura();
  await actualizarResumen();

  await bot.telegram.setMyCommands([
    {
      command: "hoy",
      description: "Ver gastos de hoy",
    },
    {
      command: "mes",
      description: "Ver gastos del mes",
    },
    {
      command: "ultimo",
      description: "Ver último gasto",
    },
    {
      command: "deshacer",
      description: "Borrar tu último gasto",
    },
    {
      command: "ayuda",
      description: "Ver ayuda",
    },
  ]);

  await bot.launch();

  console.log(
    "🤖 Esperancito está funcionando"
  );
}
const PORT = Number(process.env.PORT || 3000);

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("Esperancito está vivo 🤖");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Servidor HTTP activo en puerto ${PORT}`);
  });

iniciar().catch((error) => {
  console.error(
    "❌ Error iniciando Esperancito:",
    error
  );
});
