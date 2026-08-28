import http from "http";
import { Telegraf, Markup } from "telegraf";
import { google } from "googleapis";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const GOOGLE_CREDENTIALS = JSON.parse(
  process.env.GOOGLE_CREDENTIALS!
);

const bot = new Telegraf(TOKEN);

// ======================================================
// ID (siempre disponible, ANTES del control de acceso)
// ======================================================
// Se registra a propósito antes del bot.use(...) de más abajo:
// así queda exento del filtro de ALLOWED_CHAT_IDS. Si esa lista
// está mal configurada (o todavía no se configuró), /id sigue
// respondiendo el chat id — si no, quien queda bloqueado no
// tendría forma de saber qué id poner en ALLOWED_CHAT_IDS.
bot.command("id", async ctx => {
  await ctx.reply(
    `🆔 Chat: ${ctx.chat.id}\n` +
      `👤 Usuario: ${usuarioTelegram(ctx)} (${ctx.from.id})`
  );
});

// ======================================================
// CONTROL DE ACCESO
// ======================================================
// ALLOWED_CHAT_IDS: lista de chat.id separados por coma
// (ej: "-1001234567890,987654321"). Si queda vacía, el bot
// no bloquea a nadie (comportamiento anterior) — se recomienda
// configurarla en producción.

const ALLOWED_CHAT_IDS = (
  process.env.ALLOWED_CHAT_IDS ?? ""
)
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

bot.use(async (ctx, next) => {
  if (
    ALLOWED_CHAT_IDS.length > 0 &&
    ctx.chat &&
    !ALLOWED_CHAT_IDS.includes(String(ctx.chat.id))
  ) {
    console.warn(
      `⛔ Chat no autorizado: ${ctx.chat.id}`
    );
    return; // ignora el mensaje, no responde
  }

  return next();
});

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

// ======================================================
// CATEGORÍAS
// ======================================================

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

// Lista cerrada de categorías: el bot solo reconoce estos nombres
// (o los alias de arriba). Si el texto no matchea ninguno,
// normalizarCategoria devuelve null y quien llama debe pedir que
// se elija una categoría válida en vez de inventar una nueva.
const categoriasValidas = [
  ...new Set(Object.values(aliases)),
].sort((a, b) => a.localeCompare(b, "es"));

const aliasesNormalizados = new Map<
  string,
  string
>();

for (const [clave, valor] of Object.entries(
  aliases
)) {
  aliasesNormalizados.set(
    quitarAcentos(clave.toLowerCase()),
    valor
  );
}

for (const categoria of categoriasValidas) {
  aliasesNormalizados.set(
    quitarAcentos(categoria.toLowerCase()),
    categoria
  );
}

function normalizarCategoria(
  texto: string
): string | null {
  const limpia = quitarAcentos(
    texto.trim().toLowerCase()
  );

  return aliasesNormalizados.get(limpia) ?? null;
}

function listaCategorias() {
  return categoriasValidas.join(", ");
}
// ======================================================
// UTILIDADES
// ======================================================

function convertirMonto(texto: string) {
  return Number(
    texto
      .replace(/\$/g, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

function numeroDesdeSheet(valor: any) {
  if (typeof valor === "number") return valor;

  const numero = Number(valor);

  return Number.isFinite(numero)
    ? numero
    : convertirMonto(String(valor));
}

function formatoPesos(valor: number) {
  return `$${valor.toLocaleString("es-AR", {
    maximumFractionDigits: 2,
  })}`;
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

function mesActual() {
  return fechaArgentina().slice(0, 7);
}

function usuarioTelegram(ctx: any) {
  return `${ctx.from.first_name}${
    ctx.from.last_name ? " " + ctx.from.last_name : ""
  }`;
}

function serialSheetsAFecha(serial: number) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const fecha = new Date(
    base.getTime() + serial * 86400000
  );

  return fecha.toISOString().slice(0, 10);
}

function normalizarFecha(valor: any) {
  if (valor === undefined || valor === null) return "";

  if (typeof valor === "number") {
    return serialSheetsAFecha(valor);
  }

  const texto = String(valor).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  if (/^\d{1,5}(\.\d+)?$/.test(texto)) {
    return serialSheetsAFecha(Number(texto));
  }

  const partes = texto.split("/");

  if (partes.length === 3) {
    const [dia, mes, anio] = partes;

    return `${anio.padStart(4, "0")}-${mes.padStart(
      2,
      "0"
    )}-${dia.padStart(2, "0")}`;
  }

  return texto;
}

function normalizarHora(valor: any) {
  if (typeof valor !== "number") {
    return String(valor ?? "");
  }

  const fraccion = valor - Math.floor(valor);
  const minutos = Math.round(fraccion * 24 * 60);

  const horas = Math.floor(minutos / 60) % 24;
  const mins = minutos % 60;

  return `${String(horas).padStart(2, "0")}:${String(
    mins
  ).padStart(2, "0")}`;
}

function sumarMeses(mes: string, cantidad: number) {
  const [anio, numeroMes] = mes.split("-").map(Number);

  const fecha = new Date(
    Date.UTC(anio, numeroMes - 1 + cantidad, 1)
  );

  return `${fecha.getUTCFullYear()}-${String(
    fecha.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

function nombreMes(mes: string) {
  const [anio, numeroMes] = mes.split("-").map(Number);

  return new Date(
    Date.UTC(anio, numeroMes - 1, 1)
  ).toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function nombreMesCorto(mes: string) {
  const [anio, numeroMes] = mes.split("-").map(Number);

  const texto = new Date(
    Date.UTC(anio, numeroMes - 1, 1)
  ).toLocaleDateString("es-AR", {
    month: "short",
    timeZone: "UTC",
  });

  const limpio = texto
    .replace(".", "")
    .trim();

  return (
    limpio.charAt(0).toUpperCase() +
    limpio.slice(1)
  );
}

function formatoFechaCorta(
  fechaISO: string
) {
  const [anio, mes, dia] =
    fechaISO.split("-").map(Number);

  return new Date(
    Date.UTC(anio, mes - 1, dia)
  ).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatoRangoFechas(
  desde: string,
  hasta: string
) {
  return `${formatoFechaCorta(
    desde
  )} al ${formatoFechaCorta(hasta)}`;
}

// Lunes (YYYY-MM-DD) de la semana calendario que contiene `fechaISO`.
function inicioSemana(fechaISO: string) {
  const [anio, mes, dia] =
    fechaISO.split("-").map(Number);

  const fecha = new Date(
    Date.UTC(anio, mes - 1, dia)
  );

  const diaSemana = fecha.getUTCDay(); // 0 = domingo … 6 = sábado
  const diasDesdeLunes =
    diaSemana === 0 ? 6 : diaSemana - 1;

  fecha.setUTCDate(
    fecha.getUTCDate() - diasDesdeLunes
  );

  return fecha
    .toISOString()
    .slice(0, 10);
}

// Día de la semana (0 = domingo … 6 = sábado) según la fecha de
// Argentina, no la del servidor.
function diaSemanaArgentina() {
  const [anio, mes, dia] =
    fechaArgentina()
      .split("-")
      .map(Number);

  return new Date(
    Date.UTC(anio, mes - 1, dia)
  ).getUTCDay();
}

// Hora (0-23) actual en Argentina.
function horaEnArgentina() {
  const partes = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        "America/Argentina/Cordoba",
      hour: "numeric",
      hourCycle: "h23",
    }
  ).formatToParts(new Date());

  const parteHora = partes.find(
    parte => parte.type === "hour"
  );

  return parteHora
    ? Number(parteHora.value)
    : new Date().getHours();
}

function claveSesion(ctx: any) {
  return `${ctx.chat.id}:${ctx.from.id}`;
}

function quitarAcentos(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarMedioPago(texto: string) {
  return quitarAcentos(
    texto
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
  );
}
// ======================================================
// PESTAÑAS
// ======================================================

const estructuras: Record<string, string[]> = {
  gastos: [
    "Fecha",
    "Hora",
    "Usuario",
    "Categoría",
    "Monto",
  ],

  resumen: [
    "Tipo",
    "Período",
    "Usuario",
    "Total",
  ],

  ingresos: [
    "Mes",
    "Persona",
    "Monto",
  ],

  presupuestos: [
    "Mes",
    "Categoría",
    "Presupuesto",
  ],

  cuotas_datos: [
    "Fecha de carga",
    "Usuario",
    "Medio de pago",
    "Concepto",
    "Mes",
    "Cuota",
    "Monto",
  ],

  // Un registro por cada (Mes, Usuario, Tarjeta) que ya se volcó a
  // "gastos" como pago real. Evita registrar dos veces el mismo pago
  // de tarjeta en un mes.
  cuotas_registros: [
    "Mes",
    "Usuario",
    "Medio de pago",
    "Monto",
    "Fecha de registro",
  ],

  // Un registro por cada resumen automático (semanal o mensual) ya
  // enviado, para no mandarlo dos veces en el mismo período.
  resumenes_enviados: [
    "Tipo",
    "Período",
    "Fecha de envío",
  ],

  proyeccion: [
    "Usuario / Tarjeta",
  ],
};

async function asegurarPestañas() {
  const libro = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const existentes =
    libro.data.sheets?.map(
      h => h.properties?.title ?? ""
    ) ?? [];

  for (const nombre of Object.keys(estructuras)) {
    if (!existentes.includes(nombre)) {
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

      console.log(`✅ Pestaña ${nombre} creada`);
    }

    if (nombre !== "proyeccion") {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombre}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [estructuras[nombre]],
        },
      });
    }
  }
}

async function obtenerFilas(
  pestaña: string,
  rango: string
) {
  const respuesta =
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${pestaña}!${rango}`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

  return respuesta.data.values ?? [];
}

// ======================================================
// RESUMEN
// ======================================================

async function obtenerGastos() {
  return obtenerFilas(
    "gastos",
    "A2:E"
  );
}

// Suma los gastos (total familiar + por usuario) que caen dentro
// del período que indique `dentroDelPeriodo`, recibiendo la fecha
// ya normalizada (YYYY-MM-DD) de cada fila. La usan /hoy, /mes y
// los resúmenes automáticos semanal/mensual.
function resumirGastos(
  gastos: any[][],
  dentroDelPeriodo: (
    fecha: string
  ) => boolean
) {
  let familiar = 0;

  const porUsuario = new Map<
    string,
    number
  >();

  for (const fila of gastos) {
    const [
      fechaRaw,
      ,
      usuario,
      ,
      montoRaw,
    ] = fila;

    const fecha =
      normalizarFecha(fechaRaw);

    if (!fecha || !usuario) continue;
    if (!dentroDelPeriodo(fecha)) {
      continue;
    }

    const monto =
      numeroDesdeSheet(montoRaw);

    if (!Number.isFinite(monto)) continue;

    familiar += monto;

    porUsuario.set(
      usuario,
      (porUsuario.get(usuario) ?? 0) +
        monto
    );
  }

  return { familiar, porUsuario };
}

async function actualizarResumen() {
  const gastos = await obtenerGastos();

  const totales =
    new Map<string, number>();

  for (const fila of gastos) {
    const [
      fechaRaw,
      ,
      usuario,
      ,
      montoRaw,
    ] = fila;

    const fecha =
      normalizarFecha(fechaRaw);

    const monto =
      numeroDesdeSheet(montoRaw);

    if (!fecha || !usuario) continue;
    if (!Number.isFinite(monto)) continue;

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
        (totales.get(clave) ?? 0) + monto
      );
    }
  }

  const filas: any[][] = [
    estructuras.resumen,
  ];

  for (const [clave, total] of totales) {
    const [tipo, periodo, usuario] =
      clave.split("|");

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

// ======================================================
// SESIONES DE DIÁLOGO
// ======================================================

type Sesion =
  | {
      tipo: "ingreso";
      paso: "persona" | "monto";
      persona?: string;
    }
  | {
      tipo: "presupuesto";
      paso: "categoria" | "monto";
      categoria?: string;
    }
  | {
      tipo: "cuotas";
      paso:
        | "monto"
        | "cantidad"
        | "medio"
        | "concepto"
        | "primerMes";
      monto?: number;
      cantidad?: number;
      medio?: string;
      concepto?: string;
    };

const sesiones = new Map<
  string,
  Sesion
>();

function cancelarSesion(ctx: any) {
  sesiones.delete(claveSesion(ctx));
}

// ======================================================
// HOY
// ======================================================

bot.command("hoy", async ctx => {
  cancelarSesion(ctx);

  const gastos = await obtenerGastos();
  const hoy = fechaArgentina();

  const { familiar, porUsuario } =
    resumirGastos(
      gastos,
      fecha => fecha === hoy
    );

  let mensaje =
    `💰 Hoy: ${formatoPesos(
      familiar
    )}`;

  for (const [usuario, total] of porUsuario) {
    mensaje +=
      `\n${usuario}: ${formatoPesos(
        total
      )}`;
  }

  await ctx.reply(mensaje);
});

// ======================================================
// MES
// ======================================================

bot.command("mes", async ctx => {
  cancelarSesion(ctx);

  const gastos = await obtenerGastos();
  const mes = mesActual();

  const { familiar, porUsuario } =
    resumirGastos(gastos, fecha =>
      fecha.startsWith(mes)
    );

  let mensaje =
    `📅 ${nombreMes(mes)}\n` +
    `Total familiar: ${formatoPesos(
      familiar
    )}`;

  for (const [usuario, total] of porUsuario) {
    mensaje +=
      `\n${usuario}: ${formatoPesos(
        total
      )}`;
  }

  await ctx.reply(mensaje);
});

// ======================================================
// ÚLTIMO
// ======================================================

bot.command("ultimo", async ctx => {
  cancelarSesion(ctx);

  const gastos = await obtenerGastos();

  if (!gastos.length) {
    await ctx.reply(
      "No hay gastos registrados."
    );
    return;
  }

  const fila =
    gastos[gastos.length - 1];

  const [
    fechaRaw,
    horaRaw,
    usuario,
    categoria,
    montoRaw,
  ] = fila;

  await ctx.reply(
    `🧾 Último gasto\n` +
      `${categoria} — ${formatoPesos(
        numeroDesdeSheet(montoRaw)
      )}\n` +
      `${usuario}\n` +
      `${normalizarFecha(
        fechaRaw
      )} ${normalizarHora(horaRaw)}`
  );
});
// ======================================================
// DESHACER
// ======================================================

bot.command("deshacer", async ctx => {
  cancelarSesion(ctx);

  const gastos = await obtenerGastos();

  const usuario =
    usuarioTelegram(ctx);

  let indice = -1;

  for (
    let i = gastos.length - 1;
    i >= 0;
    i--
  ) {
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

  const metadata =
    await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

  const hoja =
    metadata.data.sheets?.find(
      h =>
        h.properties?.title ===
        "gastos"
    );

  const sheetId =
    hoja?.properties?.sheetId;

  if (sheetId === undefined) {
    await ctx.reply(
      "No pude encontrar la pestaña gastos."
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
              startIndex: indice + 1,
              endIndex: indice + 2,
            },
          },
        },
      ],
    },
  });

  await actualizarResumen();

  await ctx.reply(
    `🗑️ Eliminado: ${
      fila[3]
    } — ${formatoPesos(
      numeroDesdeSheet(fila[4])
    )}`
  );
});

// ======================================================
// INGRESOS
// ======================================================

bot.command("ingreso", async ctx => {
  cancelarSesion(ctx);

  sesiones.set(claveSesion(ctx), {
    tipo: "ingreso",
    paso: "persona",
  });

  await ctx.reply(
    "💰 ¿De quién es el ingreso?"
  );
});

bot.command("balance", async ctx => {
  cancelarSesion(ctx);

  const mes = mesActual();

  const ingresos =
    await obtenerFilas(
      "ingresos",
      "A2:C"
    );

  const gastos =
    await obtenerGastos();

  let totalIngresos = 0;

  const ingresoPersona =
    new Map<string, number>();

  for (const fila of ingresos) {
    if (String(fila[0]) !== mes) {
      continue;
    }

    const persona =
      String(fila[1]);

    const monto =
      numeroDesdeSheet(fila[2]);

    if (!Number.isFinite(monto)) continue;

    totalIngresos += monto;

    ingresoPersona.set(
      persona,
      (ingresoPersona.get(persona) ??
        0) + monto
    );
  }

  let totalGastos = 0;

  for (const fila of gastos) {
    const fecha =
      normalizarFecha(fila[0]);

    if (!fecha.startsWith(mes)) {
      continue;
    }

    const monto =
      numeroDesdeSheet(fila[4]);

    if (!Number.isFinite(monto)) continue;

    totalGastos += monto;
  }

  const saldo =
    totalIngresos - totalGastos;

  let mensaje =
    `📊 Balance — ${nombreMes(mes)}\n\n` +
    `💵 Ingresos: ${formatoPesos(
      totalIngresos
    )}`;

  for (
    const [persona, total]
    of ingresoPersona
  ) {
    mensaje +=
      `\n• ${persona}: ${formatoPesos(
        total
      )}`;
  }

  mensaje +=
    `\n\n💸 Gastos: ${formatoPesos(
      totalGastos
    )}` +
    `\n\n${
      saldo >= 0 ? "✅" : "🔴"
    } Saldo: ${formatoPesos(saldo)}`;

  await ctx.reply(mensaje);
});

// ======================================================
// PRESUPUESTOS
// ======================================================

bot.command("presupuesto", async ctx => {
  cancelarSesion(ctx);

  sesiones.set(claveSesion(ctx), {
    tipo: "presupuesto",
    paso: "categoria",
  });

  await ctx.reply(
    `📊 ¿Para qué categoría querés establecer el presupuesto?\n\n${listaCategorias()}`
  );
});

bot.command(
  "presupuestos",
  async ctx => {
    cancelarSesion(ctx);

    const mes = mesActual();

    const presupuestos =
      await obtenerFilas(
        "presupuestos",
        "A2:C"
      );

    const gastos =
      await obtenerGastos();

    const gastado =
      new Map<string, number>();

    for (const fila of gastos) {
      const fecha =
        normalizarFecha(fila[0]);

      if (!fecha.startsWith(mes)) {
        continue;
      }

      const categoria =
        String(fila[3]);

      const monto =
        numeroDesdeSheet(fila[4]);

      if (!Number.isFinite(monto)) {
        continue;
      }

      gastado.set(
        categoria,
        (gastado.get(categoria) ?? 0) +
          monto
      );
    }

    const actuales =
      presupuestos.filter(
        fila =>
          String(fila[0]) === mes
      );

    if (!actuales.length) {
      await ctx.reply(
        "Todavía no hay presupuestos cargados para este mes."
      );
      return;
    }

    let mensaje =
      `📊 Presupuestos — ${nombreMes(
        mes
      )}\n`;

    for (const fila of actuales) {
      const categoria =
        String(fila[1]);

      const limite =
        numeroDesdeSheet(fila[2]);

      const usado =
        gastado.get(categoria) ?? 0;

      const porcentaje =
        limite > 0
          ? Math.round(
              (usado / limite) * 100
            )
          : 0;

      let alerta = "";

      if (porcentaje >= 100) {
        alerta = " 🔴";
      } else if (porcentaje >= 80) {
        alerta = " ⚠️";
      }

      mensaje +=
        `\n${categoria}\n` +
        `${formatoPesos(
          usado
        )} / ${formatoPesos(
          limite
        )} — ${porcentaje}%${alerta}`;
    }

    await ctx.reply(mensaje);
  }
);
    // ======================================================
// CUOTAS + PROYECCIÓN HORIZONTAL
// ======================================================

bot.command("cuotas", async ctx => {
  cancelarSesion(ctx);

  sesiones.set(claveSesion(ctx), {
    tipo: "cuotas",
    paso: "monto",
  });

  await ctx.reply(
    "💳 ¿Cuál es el monto total de la compra?"
  );
});

async function obtenerCuotasDatos() {
  return obtenerFilas(
    "cuotas_datos",
    "A2:G"
  );
}

// Próximos `cantidad` meses, empezando por el mes que sigue al actual.
// Ej: si hoy es agosto 2026, construirMesesAdelante(3) =>
// [2026-09, 2026-10, 2026-11]
function construirMesesAdelante(
  cantidad: number
) {
  const meses: string[] = [];

  for (let i = 1; i <= cantidad; i++) {
    meses.push(
      sumarMeses(mesActual(), i)
    );
  }

  return meses;
}

type GrupoTarjeta = {
  usuario: string;
  medio: string;
  montos: Map<string, number>;
};

type DetalleCompra = GrupoTarjeta & {
  concepto: string;
};

// Toma las filas de cuotas_datos y las agrupa por usuario+tarjeta
// (sumando todas las cuotas que caen en el mismo mes), y además
// por usuario+tarjeta+concepto para el detalle de cada compra.
// El agrupado por tarjeta usa el medio de pago normalizado (sin
// mayúsculas/acentos) como clave, así "BNA Máster" y "bna master"
// se suman juntos en vez de aparecer como tarjetas distintas.
function agruparCuotas(
  cuotas: any[][],
  meses: string[]
) {
  const agrupado = new Map<
    string,
    GrupoTarjeta
  >();

  const detalleCompras = new Map<
    string,
    DetalleCompra
  >();

  for (const fila of cuotas) {
    const [
      ,
      usuarioRaw,
      medioRaw,
      conceptoRaw,
      mesRaw,
      ,
      montoRaw,
    ] = fila;

    const usuario =
      String(usuarioRaw ?? "").trim();

    const medioVisible =
      String(medioRaw ?? "").trim();

    const concepto =
      String(conceptoRaw ?? "").trim();

    const mes =
      String(mesRaw ?? "").trim();

    const monto =
      numeroDesdeSheet(montoRaw);

    if (
      !usuario ||
      !medioVisible ||
      !mes ||
      !Number.isFinite(monto)
    ) {
      continue;
    }

    // Solo mostramos los meses de la ventana pedida
    if (!meses.includes(mes)) {
      continue;
    }

    const medioNormalizado =
      normalizarMedioPago(medioVisible);

    const claveAgrupada =
      `${usuario}|${medioNormalizado}`;

    if (!agrupado.has(claveAgrupada)) {
      agrupado.set(claveAgrupada, {
        usuario,
        medio: medioVisible,
        montos: new Map<string, number>(),
      });
    }

    const grupo =
      agrupado.get(claveAgrupada)!;

    grupo.montos.set(
      mes,
      (grupo.montos.get(mes) ?? 0) +
        monto
    );

    const claveDetalle =
      `${usuario}|${medioNormalizado}|${concepto}`;

    if (!detalleCompras.has(claveDetalle)) {
      detalleCompras.set(claveDetalle, {
        usuario,
        medio: medioVisible,
        concepto,
        montos: new Map<string, number>(),
      });
    }

    const detalle =
      detalleCompras.get(claveDetalle)!;

    detalle.montos.set(
      mes,
      (detalle.montos.get(mes) ?? 0) +
        monto
    );
  }

  return { agrupado, detalleCompras };
}

function ordenarPorUsuarioYMedio<
  T extends {
    usuario: string;
    medio: string;
  }
>(items: T[]) {
  return [...items].sort((a, b) => {
    const usuarioCompare =
      a.usuario.localeCompare(
        b.usuario,
        "es"
      );

    if (usuarioCompare !== 0) {
      return usuarioCompare;
    }

    return a.medio.localeCompare(
      b.medio,
      "es"
    );
  });
}

// Reconstruye la pestaña "proyeccion" con los próximos 12 meses en
// columnas. Si ya se leyeron las filas de cuotas_datos en otro lado
// (por ejemplo desde /proyeccion) se pueden pasar en `cuotasPrecargadas`
// para no leer la hoja dos veces.
async function reconstruirProyeccionHorizontal(
  cuotasPrecargadas?: any[][]
) {
  const cuotas =
    cuotasPrecargadas ??
    (await obtenerCuotasDatos());

  const meses =
    construirMesesAdelante(12);

  const { agrupado, detalleCompras } =
    agruparCuotas(cuotas, meses);

  const encabezadoResumen = [
    "Usuario / Tarjeta",
    ...meses.map(nombreMes),
  ];

  const filasResumen: any[][] = [
    encabezadoResumen,
  ];

  const gruposOrdenados =
    ordenarPorUsuarioYMedio([
      ...agrupado.values(),
    ]);

  for (const grupo of gruposOrdenados) {
    filasResumen.push([
      `${grupo.usuario} — ${grupo.medio}`,
      ...meses.map(
        mes => grupo.montos.get(mes) ?? 0
      ),
    ]);
  }

  // TOTAL FAMILIAR
  const totalFamiliarPorMes =
    new Map<string, number>();

  for (const grupo of agrupado.values()) {
    for (const mes of meses) {
      totalFamiliarPorMes.set(
        mes,
        (totalFamiliarPorMes.get(mes) ?? 0) +
          (grupo.montos.get(mes) ?? 0)
      );
    }
  }

  filasResumen.push([
    "TOTAL FAMILIAR",
    ...meses.map(
      mes =>
        totalFamiliarPorMes.get(mes) ?? 0
    ),
  ]);

  // Separador + detalle de compras
  filasResumen.push([]);
  filasResumen.push([
    "DETALLE DE COMPRAS",
    ...meses.map(nombreMes),
  ]);

  const detallesOrdenados = [
    ...detalleCompras.values(),
  ].sort((a, b) => {
    const usuarioCompare =
      a.usuario.localeCompare(
        b.usuario,
        "es"
      );

    if (usuarioCompare !== 0) {
      return usuarioCompare;
    }

    const medioCompare =
      a.medio.localeCompare(
        b.medio,
        "es"
      );

    if (medioCompare !== 0) {
      return medioCompare;
    }

    return a.concepto.localeCompare(
      b.concepto,
      "es"
    );
  });

  for (
    const detalle
    of detallesOrdenados
  ) {
    filasResumen.push([
      `${detalle.usuario} — ${detalle.medio} — ${detalle.concepto}`,
      ...meses.map(
        mes =>
          detalle.montos.get(mes) ?? 0
      ),
    ]);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "proyeccion!A:Z",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "proyeccion!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: filasResumen,
    },
  });

  console.log(
    "✅ Proyección horizontal actualizada"
  );
}

// ======================================================
// PAGO MENSUAL DE TARJETAS (cuotas -> gastos reales)
// ======================================================
// Cada mes, la cuota que corresponde a ese mes para cada tarjeta
// (usuario + medio de pago) se vuelca como UN gasto real en la
// pestaña "gastos" (categoría "Tarjetas"), sumando todas las
// compras en cuotas de esa tarjeta que caen ese mes. Así el pago
// de la tarjeta impacta en /mes, /balance y /presupuestos como
// cualquier otro gasto, en vez de vivir solo en la proyección.
//
// cuotas_registros lleva un renglón por cada (Mes, Usuario,
// Tarjeta) ya volcado, para no duplicar el pago si esta función
// se llama más de una vez en el mismo mes (arranque del bot +
// chequeo periódico).

async function obtenerCuotasRegistradas() {
  return obtenerFilas(
    "cuotas_registros",
    "A2:E"
  );
}

function claveRegistroPago(
  mes: string,
  usuario: string,
  medio: string
) {
  return `${mes}|${usuario}|${normalizarMedioPago(
    medio
  )}`;
}

async function registrarPagosDelMes(
  cuotasPrecargadas?: any[][]
) {
  const mes = mesActual();

  const cuotas =
    cuotasPrecargadas ??
    (await obtenerCuotasDatos());

  const { agrupado } = agruparCuotas(
    cuotas,
    [mes]
  );

  if (!agrupado.size) {
    return [];
  }

  const registrados =
    await obtenerCuotasRegistradas();

  const yaRegistrados = new Set(
    registrados.map(fila =>
      claveRegistroPago(
        String(fila[0] ?? ""),
        String(fila[1] ?? ""),
        String(fila[2] ?? "")
      )
    )
  );

  const nuevosGastos: any[][] = [];
  const nuevosRegistros: any[][] = [];
  const pagosRealizados: {
    usuario: string;
    medio: string;
    monto: number;
  }[] = [];

  for (const grupo of agrupado.values()) {
    const monto =
      grupo.montos.get(mes) ?? 0;

    if (monto <= 0) {
      continue;
    }

    const clave = claveRegistroPago(
      mes,
      grupo.usuario,
      grupo.medio
    );

    if (yaRegistrados.has(clave)) {
      continue;
    }

    nuevosGastos.push([
      fechaArgentina(),
      horaArgentina(),
      grupo.usuario,
      "Tarjetas",
      monto,
    ]);

    nuevosRegistros.push([
      mes,
      grupo.usuario,
      grupo.medio,
      monto,
      fechaArgentina(),
    ]);

    pagosRealizados.push({
      usuario: grupo.usuario,
      medio: grupo.medio,
      monto,
    });
  }

  if (!nuevosGastos.length) {
    return [];
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "gastos!A:E",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: nuevosGastos,
    },
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "cuotas_registros!A:E",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: nuevosRegistros,
    },
  });

  await actualizarResumen();

  console.log(
    `✅ ${pagosRealizados.length} pago(s) de tarjeta registrados como gasto para ${nombreMes(mes)}`
  );

  return pagosRealizados;
}

// Manda `mensaje` a todos los chats en ALLOWED_CHAT_IDS (los avisos
// de pago de tarjeta y los resúmenes automáticos usan este mismo
// mecanismo). Si no hay ningún chat configurado, no hay a quién
// mandarle nada: se avisa por log y se devuelve false para que
// quien llama sepa que el envío no se hizo (y no lo marque como
// enviado).
async function enviarATodos(
  mensaje: string
) {
  if (!ALLOWED_CHAT_IDS.length) {
    console.warn(
      "⚠️ ALLOWED_CHAT_IDS no está configurado: no hay a quién mandar el mensaje automático."
    );

    return false;
  }

  for (const chatId of ALLOWED_CHAT_IDS) {
    try {
      await bot.telegram.sendMessage(
        chatId,
        mensaje
      );
    } catch (error) {
      console.error(
        `⚠️ No pude enviar el mensaje a ${chatId}:`,
        error
      );
    }
  }

  return true;
}

async function notificarPagosRegistrados(
  pagos: {
    usuario: string;
    medio: string;
    monto: number;
  }[]
) {
  if (!pagos.length) {
    return;
  }

  let mensaje =
    `💳 Se registraron los pagos de tarjeta de ${nombreMes(
      mesActual()
    )}:\n`;

  for (const pago of pagos) {
    mensaje +=
      `\n${pago.usuario} — ${pago.medio}: ${formatoPesos(
        pago.monto
      )}`;
  }

  await enviarATodos(mensaje);
}

// ======================================================
// RESÚMENES AUTOMÁTICOS (semanal y mensual)
// ======================================================
// Se mandan solos, sin que nadie tenga que pedirlos, a los mismos
// chats de ALLOWED_CHAT_IDS que reciben el aviso de pago de
// tarjeta. Si esa variable no está configurada, no hay a quién
// mandarle el resumen (ver enviarATodos) y por lo tanto tampoco se
// marca como enviado, para reintentar apenas se configure.
//
// - Semanal: domingo desde las 20hs, con la semana lunes a domingo
//   que recién termina.
// - Mensual: día 1 desde las 9hs, con el mes calendario que recién
//   terminó.
//
// resumenes_enviados guarda un renglón por (Tipo, Período) ya
// mandado, para no duplicar el resumen si el chequeo se dispara
// más de una vez dentro de la misma ventana horaria.

const HORA_RESUMEN_SEMANAL = 20;
const HORA_RESUMEN_MENSUAL = 9;

async function obtenerResumenesEnviados() {
  return obtenerFilas(
    "resumenes_enviados",
    "A2:C"
  );
}

async function yaEnviadoResumen(
  tipo: string,
  periodo: string
) {
  const filas =
    await obtenerResumenesEnviados();

  return filas.some(
    fila =>
      String(fila[0]) === tipo &&
      String(fila[1]) === periodo
  );
}

async function marcarResumenEnviado(
  tipo: string,
  periodo: string
) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "resumenes_enviados!A:C",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        tipo,
        periodo,
        `${fechaArgentina()} ${horaArgentina()}`,
      ]],
    },
  });
}

async function generarResumenSemanal() {
  const hoy = fechaArgentina();
  const desde = inicioSemana(hoy);

  const gastos = await obtenerGastos();

  const { familiar, porUsuario } =
    resumirGastos(
      gastos,
      fecha =>
        fecha >= desde && fecha <= hoy
    );

  let mensaje =
    `📆 Resumen semanal — ${formatoRangoFechas(
      desde,
      hoy
    )}\n` +
    `💸 Total: ${formatoPesos(
      familiar
    )}`;

  for (const [usuario, total] of porUsuario) {
    mensaje +=
      `\n• ${usuario}: ${formatoPesos(
        total
      )}`;
  }

  return { mensaje, periodo: desde };
}

async function generarResumenMensual() {
  // El mes calendario que recién terminó: si hoy es el día 1,
  // mesActual() ya es el mes nuevo.
  const mes = sumarMeses(
    mesActual(),
    -1
  );

  const gastos = await obtenerGastos();

  const {
    familiar: totalGastos,
    porUsuario: gastosPorUsuario,
  } = resumirGastos(gastos, fecha =>
    fecha.startsWith(mes)
  );

  const ingresos = await obtenerFilas(
    "ingresos",
    "A2:C"
  );

  let totalIngresos = 0;

  const ingresoPorPersona = new Map<
    string,
    number
  >();

  for (const fila of ingresos) {
    if (String(fila[0]) !== mes) {
      continue;
    }

    const persona = String(fila[1]);
    const monto = numeroDesdeSheet(
      fila[2]
    );

    if (!Number.isFinite(monto)) {
      continue;
    }

    totalIngresos += monto;

    ingresoPorPersona.set(
      persona,
      (ingresoPorPersona.get(
        persona
      ) ?? 0) + monto
    );
  }

  const saldo =
    totalIngresos - totalGastos;

  let mensaje =
    `📅 Resumen mensual — ${nombreMes(
      mes
    )}\n\n` +
    `💸 Gastos: ${formatoPesos(
      totalGastos
    )}`;

  for (const [
    usuario,
    total,
  ] of gastosPorUsuario) {
    mensaje +=
      `\n• ${usuario}: ${formatoPesos(
        total
      )}`;
  }

  mensaje +=
    `\n\n💵 Ingresos: ${formatoPesos(
      totalIngresos
    )}`;

  for (const [
    persona,
    total,
  ] of ingresoPorPersona) {
    mensaje +=
      `\n• ${persona}: ${formatoPesos(
        total
      )}`;
  }

  mensaje +=
    `\n\n${
      saldo >= 0 ? "✅" : "🔴"
    } Saldo: ${formatoPesos(saldo)}`;

  return { mensaje, periodo: mes };
}

async function verificarResumenesAutomaticos() {
  const diaSemana =
    diaSemanaArgentina(); // 0 = domingo
  const hora = horaEnArgentina();

  if (
    diaSemana === 0 &&
    hora >= HORA_RESUMEN_SEMANAL
  ) {
    const { mensaje, periodo } =
      await generarResumenSemanal();

    if (
      !(await yaEnviadoResumen(
        "Semanal",
        periodo
      ))
    ) {
      const enviado =
        await enviarATodos(mensaje);

      if (enviado) {
        await marcarResumenEnviado(
          "Semanal",
          periodo
        );

        console.log(
          `✅ Resumen semanal enviado (semana del ${periodo})`
        );
      }
    }
  }

  const diaDelMes = Number(
    fechaArgentina().split("-")[2]
  );

  if (
    diaDelMes === 1 &&
    hora >= HORA_RESUMEN_MENSUAL
  ) {
    const { mensaje, periodo } =
      await generarResumenMensual();

    if (
      !(await yaEnviadoResumen(
        "Mensual",
        periodo
      ))
    ) {
      const enviado =
        await enviarATodos(mensaje);

      if (enviado) {
        await marcarResumenEnviado(
          "Mensual",
          periodo
        );

        console.log(
          `✅ Resumen mensual enviado (${periodo})`
        );
      }
    }
  }
}

async function guardarCuotas(
  ctx: any,
  sesion: Extract<
    Sesion,
    { tipo: "cuotas" }
  >,
  demora: number
) {
  const total =
    sesion.monto!;

  const cantidad =
    sesion.cantidad!;

  const medio =
    sesion.medio!;

  const concepto =
    sesion.concepto!;

  const usuario =
    usuarioTelegram(ctx);

  const fechaCarga =
    fechaArgentina();

  const totalCentavos =
    Math.round(total * 100);

  const base =
    Math.floor(
      totalCentavos / cantidad
    );

  let resto =
    totalCentavos -
    base * cantidad;

  const primera =
    sumarMeses(
      mesActual(),
      demora
    );

  const filas: any[][] = [];

  for (
    let i = 0;
    i < cantidad;
    i++
  ) {
    let centavos = base;

    if (resto > 0) {
      centavos++;
      resto--;
    }

    filas.push([
      fechaCarga,
      usuario,
      medio,
      concepto,
      sumarMeses(primera, i),
      `${i + 1}/${cantidad}`,
      centavos / 100,
    ]);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "cuotas_datos!A:G",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: filas,
    },
  });

  await actualizarProyeccionYPagos();

  const ultima =
    sumarMeses(
      primera,
      cantidad - 1
    );

  sesiones.delete(
    claveSesion(ctx)
  );

  await ctx.reply(
    `✅ Compra proyectada\n\n` +
      `${concepto} — ${formatoPesos(
        total
      )}\n` +
      `💳 ${medio}\n` +
      `👤 ${usuario}\n` +
      `${cantidad} cuotas\n` +
      `Primera: ${nombreMes(
        primera
      )}\n` +
      `Última: ${nombreMes(
        ultima
      )}`
  );
}

bot.action(
  "cuotas_mes_1",
  async ctx => {
    const sesion =
      sesiones.get(
        claveSesion(ctx)
      );

    if (
      !sesion ||
      sesion.tipo !== "cuotas"
    ) {
      await ctx.answerCbQuery(
        "La carga ya no está activa."
      );

      return;
    }

    await ctx.answerCbQuery();

    await guardarCuotas(
      ctx,
      sesion,
      1
    );
  }
);

bot.action(
  "cuotas_mes_2",
  async ctx => {
    const sesion =
      sesiones.get(
        claveSesion(ctx)
      );

    if (
      !sesion ||
      sesion.tipo !== "cuotas"
    ) {
      await ctx.answerCbQuery(
        "La carga ya no está activa."
      );

      return;
    }

    await ctx.answerCbQuery();

    await guardarCuotas(
      ctx,
      sesion,
      2
    );
  }
);

// ======================================================
// PROYECCIÓN EN TELEGRAM
// ======================================================
// Agrupa por tarjeta (usuario + medio de pago) y muestra los
// próximos meses como columnas, así "BNA Máster — $xxxx — 6
// cuotas" se suma automáticamente con el resto de las compras
// de esa misma tarjeta en cada mes. Por defecto muestra los
// próximos 6 meses; se puede pedir otra ventana con
// "/proyeccion 3" (mínimo 1, máximo 12).

const MESES_PROYECCION_DEFECTO = 6;
const MESES_PROYECCION_MAXIMO = 12;

bot.command(
  "proyeccion",
  async ctx => {
    cancelarSesion(ctx);

    const argumento =
      ctx.message.text
        .split(/\s+/)[1];

    const pedido =
      Number(argumento);

    const cantidadMeses =
      Number.isInteger(pedido) &&
      pedido > 0
        ? Math.min(
            pedido,
            MESES_PROYECCION_MAXIMO
          )
        : MESES_PROYECCION_DEFECTO;

    // Leemos cuotas_datos una sola vez y la reusamos tanto para
    // refrescar la hoja "proyeccion" como para armar el mensaje.
    const cuotas =
      await obtenerCuotasDatos();

    await reconstruirProyeccionHorizontal(
      cuotas
    );

    const meses =
      construirMesesAdelante(
        cantidadMeses
      );

    const { agrupado } =
      agruparCuotas(cuotas, meses);

    if (!agrupado.size) {
      await ctx.reply(
        "No hay pagos proyectados."
      );

      return;
    }

    const gruposOrdenados =
      ordenarPorUsuarioYMedio([
        ...agrupado.values(),
      ]);

    const totalPorMes =
      new Map<string, number>();

    let totalGeneral = 0;

    let mensaje =
      `📆 Proyección de pagos — próximos ${cantidadMeses} ${
        cantidadMeses === 1
          ? "mes"
          : "meses"
      }\n`;

    for (
      const grupo
      of gruposOrdenados
    ) {
      let totalTarjeta = 0;

      mensaje +=
        `\n💳 ${grupo.usuario} — ${grupo.medio}`;

      for (const mes of meses) {
        const monto =
          grupo.montos.get(mes) ?? 0;

        totalTarjeta += monto;

        totalPorMes.set(
          mes,
          (totalPorMes.get(mes) ?? 0) +
            monto
        );

        if (monto > 0) {
          mensaje +=
            `\n   ${nombreMesCorto(
              mes
            )}: ${formatoPesos(monto)}`;
        }
      }

      mensaje +=
        `\n   Subtotal: ${formatoPesos(
          totalTarjeta
        )}\n`;

      totalGeneral += totalTarjeta;
    }

    mensaje +=
      `\n📊 Total familiar por mes`;

    for (const mes of meses) {
      mensaje +=
        `\n${nombreMesCorto(
          mes
        )}: ${formatoPesos(
          totalPorMes.get(mes) ?? 0
        )}`;
    }

    mensaje +=
      `\n\n💰 Total proyectado: ${formatoPesos(
        totalGeneral
      )}`;

    await ctx.reply(mensaje);
  }
);
// CANCELAR
// ======================================================

bot.command("cancelar", async ctx => {
  cancelarSesion(ctx);

  await ctx.reply(
    "✅ Carga cancelada."
  );
});

// ======================================================
// DIÁLOGOS
// ======================================================

async function procesarSesion(
  ctx: any,
  texto: string
) {
  const clave =
    claveSesion(ctx);

  const sesion =
    sesiones.get(clave);

  if (!sesion) {
    return false;
  }

  // --------------------------
  // INGRESO
  // --------------------------

  if (
    sesion.tipo === "ingreso"
  ) {
    if (
      sesion.paso === "persona"
    ) {
      sesion.persona =
        texto.trim();

      sesion.paso =
        "monto";

      sesiones.set(
        clave,
        sesion
      );

      await ctx.reply(
        `¿Cuánto ingresó ${sesion.persona}?`
      );

      return true;
    }

    const monto =
      convertirMonto(texto);

    if (
      !Number.isFinite(monto) ||
      monto <= 0
    ) {
      await ctx.reply(
        "Ingresá un monto válido."
      );

      return true;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId:
        SPREADSHEET_ID,

      range:
        "ingresos!A:C",

      valueInputOption:
        "USER_ENTERED",

      insertDataOption:
        "INSERT_ROWS",

      requestBody: {
        values: [[
          mesActual(),
          sesion.persona,
          monto,
        ]],
      },
    });

    sesiones.delete(clave);

    await ctx.reply(
      `✅ Ingreso registrado\n` +
      `${sesion.persona}: ${formatoPesos(
        monto
      )}`
    );

    return true;
  }

  // --------------------------
  // PRESUPUESTO
  // --------------------------

  if (
    sesion.tipo ===
    "presupuesto"
  ) {
    if (
      sesion.paso ===
      "categoria"
    ) {
      const categoria =
        normalizarCategoria(texto);

      if (!categoria) {
        await ctx.reply(
          `❌ No reconozco esa categoría. Elegí una de estas:\n${listaCategorias()}`
        );

        return true;
      }

      sesion.categoria = categoria;

      sesion.paso =
        "monto";

      sesiones.set(
        clave,
        sesion
      );

      await ctx.reply(
        `¿Cuál es el presupuesto mensual para ${sesion.categoria}?`
      );

      return true;
    }

    const monto =
      convertirMonto(texto);

    if (
      !Number.isFinite(monto) ||
      monto <= 0
    ) {
      await ctx.reply(
        "Ingresá un monto válido."
      );

      return true;
    }

    const filas =
      await obtenerFilas(
        "presupuestos",
        "A2:C"
      );

    const filaExistente =
      filas.findIndex(
        fila =>
          String(fila[0]) ===
            mesActual() &&
          String(fila[1]) ===
            sesion.categoria
      );

    if (
      filaExistente >= 0
    ) {
      const numeroFila =
        filaExistente + 2;

      await sheets.spreadsheets.values.update({
        spreadsheetId:
          SPREADSHEET_ID,

        range:
          `presupuestos!C${numeroFila}`,

        valueInputOption:
          "USER_ENTERED",

        requestBody: {
          values: [[monto]],
        },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId:
          SPREADSHEET_ID,

        range:
          "presupuestos!A:C",

        valueInputOption:
          "USER_ENTERED",

        insertDataOption:
          "INSERT_ROWS",

        requestBody: {
          values: [[
            mesActual(),
            sesion.categoria,
            monto,
          ]],
        },
      });
    }

    sesiones.delete(clave);

    await ctx.reply(
      `✅ Presupuesto establecido\n` +
      `${sesion.categoria}: ${formatoPesos(
        monto
      )}`
    );

    return true;
  }

  // --------------------------
  // CUOTAS
  // --------------------------

  if (
    sesion.tipo === "cuotas"
  ) {
    if (
      sesion.paso === "monto"
    ) {
      const monto =
        convertirMonto(texto);

      if (
        !Number.isFinite(monto) ||
        monto <= 0
      ) {
        await ctx.reply(
          "Ingresá un monto válido."
        );

        return true;
      }

      sesion.monto =
        monto;

      sesion.paso =
        "cantidad";

      sesiones.set(
        clave,
        sesion
      );

      await ctx.reply(
        "¿En cuántas cuotas?"
      );

      return true;
    }

    if (
      sesion.paso ===
      "cantidad"
    ) {
      const cantidad =
        Number(texto);

      if (
        !Number.isInteger(
          cantidad
        ) ||
        cantidad <= 0 ||
        cantidad > 60
      ) {
        await ctx.reply(
          "Ingresá una cantidad válida de cuotas."
        );

        return true;
      }

      sesion.cantidad =
        cantidad;

      sesion.paso =
        "medio";

      sesiones.set(
        clave,
        sesion
      );

      await ctx.reply(
        "¿Con qué tarjeta o medio de pago?"
      );

      return true;
    }

    if (
      sesion.paso === "medio"
    ) {
      sesion.medio =
        texto.trim();

      sesion.paso =
        "concepto";

      sesiones.set(
        clave,
        sesion
      );

      await ctx.reply(
        "¿Cuál es el concepto de la compra?"
      );

      return true;
    }

    if (
      sesion.paso ===
      "concepto"
    ) {
      sesion.concepto =
        texto.trim();

      sesion.paso =
        "primerMes";

      sesiones.set(
        clave,
        sesion
      );

      const siguiente =
        sumarMeses(
          mesActual(),
          1
        );

      const dosMeses =
        sumarMeses(
          mesActual(),
          2
        );

      await ctx.reply(
        "¿Cuándo entra la primera cuota?",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              nombreMes(
                siguiente
              ),
              "cuotas_mes_1"
            ),
          ],
          [
            Markup.button.callback(
              nombreMes(
                dosMeses
              ),
              "cuotas_mes_2"
            ),
          ],
        ])
      );

      return true;
    }
  }

  return false;
}

// ======================================================
// GASTOS NORMALES
// ======================================================

bot.on(
  "text",
  async ctx => {
    const texto =
      ctx.message.text.trim();

    if (
      texto.startsWith("/")
    ) {
      return;
    }

    if (
      await procesarSesion(
        ctx,
        texto
      )
    ) {
      return;
    }

    const partes =
      texto.split(/\s+/);

    if (
      partes.length < 2
    ) {
      return;
    }

    const ultimo =
      partes.at(-1)!;

    if (
      !/^\$?[\d.,]+$/.test(
        ultimo
      )
    ) {
      return;
    }

    const monto =
      convertirMonto(
        ultimo
      );

    if (
      !Number.isFinite(
        monto
      ) ||
      monto <= 0
    ) {
      return;
    }

    const categoria =
      normalizarCategoria(
        partes
          .slice(0, -1)
          .join(" ")
      );

    if (!categoria) {
      await ctx.reply(
        `❌ No reconozco esa categoría. Elegí una de estas:\n${listaCategorias()}`
      );

      return;
    }

    const usuario =
      usuarioTelegram(ctx);

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId:
          SPREADSHEET_ID,

        range:
          "gastos!A:E",

        valueInputOption:
          "USER_ENTERED",

        insertDataOption:
          "INSERT_ROWS",

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

      await actualizarResumen();

      await ctx.reply(
        `✅ ${categoria} — ${formatoPesos(
          monto
        )}`
      );
    } catch (error) {
      console.error(
        "❌ Error registrando gasto:",
        error
      );

      await ctx.reply(
        "❌ No pude registrar el gasto."
      );
    }
  }
);

// ======================================================
// CATEGORÍAS DISPONIBLES
// ======================================================

bot.command(
  "categorias",
  async ctx => {
    cancelarSesion(ctx);

    await ctx.reply(
      `🏷️ Categorías reconocidas:\n${listaCategorias()}`
    );
  }
);

// ======================================================
// AYUDA
// ======================================================

bot.command(
  "ayuda",
  async ctx => {
    cancelarSesion(ctx);

    await ctx.reply(
      `🤖 Esperancito\n\n` +

      `💸 Registrar gasto:\n` +
      `Supermercado $25000\n` +
      `Tarjetas $150000\n` +
      `Nafta $50000\n\n` +

      `📊 Consultas:\n` +
      `/hoy — gastos de hoy\n` +
      `/mes — gastos del mes\n` +
      `/balance — balance familiar\n` +
      `/presupuestos — ver presupuestos\n` +
      `/proyeccion [meses] — próximos pagos por tarjeta (default 6)\n` +
      `/categorias — categorías reconocidas\n` +
      `/ultimo — último gasto\n\n` +

      `✏️ Cargar:\n` +
      `/ingreso — registrar ingreso\n` +
      `/presupuesto — definir presupuesto\n` +
      `/cuotas — registrar compra en cuotas\n\n` +

      `🗑️ /deshacer — borrar tu último gasto\n` +
      `❌ /cancelar — cancelar una carga\n` +
      `🆔 /id — tu chat id (para configurar ALLOWED_CHAT_IDS)`
    );
  }
);

// ======================================================
// MANEJO GLOBAL DE ERRORES
// ======================================================
// Atrapa cualquier excepción no manejada dentro de un handler
// (comando, texto, callback) para que el bot no quede colgado
// ni tire el proceso, y avisa al usuario.

bot.catch((error, ctx) => {
  console.error(
    `❌ Error no manejado en el update ${ctx.updateType}:`,
    error
  );

  ctx
    .reply(
      "❌ Ocurrió un error inesperado. Probá de nuevo en un momento."
    )
    .catch(() => {
      // Si ni siquiera se puede responder, solo lo dejamos en el log.
    });
});

// ======================================================
// SERVIDOR HTTP PARA RENDER
// ======================================================

const PORT =
  Number(
    process.env.PORT
  ) || 3000;

http
  .createServer(
    (req, res) => {
      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8",
        }
      );

      res.end(
        "Esperancito está vivo 🤖"
      );
    }
  )
  .listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `🌐 Servidor activo en puerto ${PORT}`
      );
    }
  );

// ======================================================
// REFRESCO AUTOMÁTICO DE PROYECCIÓN Y PAGOS DE TARJETA
// ======================================================
// Lee cuotas_datos una sola vez, refresca la hoja "proyeccion" y
// registra en "gastos" el pago del mes de cada tarjeta que todavía
// no se hubiera volcado (ver registrarPagosDelMes).

async function actualizarProyeccionYPagos() {
  const cuotas = await obtenerCuotasDatos();

  await reconstruirProyeccionHorizontal(
    cuotas
  );

  const pagos = await registrarPagosDelMes(
    cuotas
  );

  if (pagos.length) {
    await notificarPagosRegistrados(pagos);
  }

  return pagos;
}

setInterval(
  async () => {
    try {
      await actualizarProyeccionYPagos();

      console.log(
        "🔄 Proyección y pagos de tarjeta actualizados automáticamente"
      );
    } catch (error) {
      console.error(
        "⚠️ Error actualizando proyección/pagos automáticamente:",
        error
      );
    }
  },
  6 * 60 * 60 * 1000
);

// ======================================================
// REFRESCO AUTOMÁTICO DE RESÚMENES (semanal y mensual)
// ======================================================
// Chequeo horario: verificarResumenesAutomaticos ya se fija por sí
// sola si hoy/ahora corresponde mandar el resumen y si todavía no
// se mandó, así que no importa que el intervalo no caiga justo en
// la hora exacta.

setInterval(
  async () => {
    try {
      await verificarResumenesAutomaticos();
    } catch (error) {
      console.error(
        "⚠️ Error chequeando resúmenes automáticos:",
        error
      );
    }
  },
  60 * 60 * 1000
);

// ======================================================
// INICIO
// ======================================================

async function iniciar() {
  await asegurarPestañas();

  await actualizarResumen();

  try {
    // Por si el bot estuvo apagado cuando cambió el mes, al
    // arrancar también chequeamos si hay pagos de tarjeta
    // pendientes de volcar a "gastos".
    await actualizarProyeccionYPagos();
  } catch (error) {
    console.error(
      "⚠️ No pude reconstruir la proyección / registrar pagos al iniciar:",
      error
    );
  }

  try {
    // Igual que arriba: si el bot estuvo apagado justo cuando
    // correspondía mandar un resumen, lo chequeamos también al
    // arrancar.
    await verificarResumenesAutomaticos();
  } catch (error) {
    console.error(
      "⚠️ No pude chequear los resúmenes automáticos al iniciar:",
      error
    );
  }

  await bot.telegram.setMyCommands([
    {
      command: "hoy",
      description:
        "Gastos de hoy",
    },
    {
      command: "mes",
      description:
        "Gastos del mes",
    },
    {
      command:
        "balance",
      description:
        "Balance del mes",
    },
    {
      command:
        "ingreso",
      description:
        "Registrar ingreso",
    },
    {
      command:
        "presupuesto",
      description:
        "Definir presupuesto",
    },
    {
      command:
        "presupuestos",
      description:
        "Ver presupuestos",
    },
    {
      command:
        "cuotas",
      description:
        "Registrar compra en cuotas",
    },
    {
      command:
        "proyeccion",
      description:
        "Ver próximos pagos",
    },
    {
      command:
        "categorias",
      description:
        "Ver categorías reconocidas",
    },
    {
      command:
        "ultimo",
      description:
        "Último gasto",
    },
    {
      command:
        "deshacer",
      description:
        "Borrar tu último gasto",
    },
    {
      command:
        "cancelar",
      description:
        "Cancelar una carga",
    },
    {
      command:
        "ayuda",
      description:
        "Ver ayuda",
    },
    {
      command: "id",
      description:
        "Ver tu chat id (para configurar ALLOWED_CHAT_IDS)",
    },
  ]);

  await bot.launch();

  console.log(
    "🤖 Esperancito está funcionando"
  );
}

// Apagado prolijo: si no le avisamos a Telegraf que pare el
// polling antes de que Render mate el proceso (redeploy, restart),
// la próxima instancia puede chocar con la anterior y Telegram
// devuelve error 409 (conflicto de getUpdates).
process.once("SIGINT", () =>
  bot.stop("SIGINT")
);

process.once("SIGTERM", () =>
  bot.stop("SIGTERM")
);

iniciar().catch(
  error => {
    console.error(
      "❌ Error iniciando Esperancito:",
      error
    );
  }
);
