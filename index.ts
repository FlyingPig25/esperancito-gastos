import http from "http";
import { Telegraf, Markup } from "telegraf";
import { google } from "googleapis";

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

function normalizarCategoria(texto: string) {
  const limpia = texto.trim().toLowerCase();

  return (
    aliases[limpia] ??
    limpia.charAt(0).toUpperCase() + limpia.slice(1)
  );
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

function claveSesion(ctx: any) {
  return `${ctx.chat.id}:${ctx.from.id}`;
}

function normalizarMedioPago(texto: string) {
  return texto
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

  let familiar = 0;

  const usuarios =
    new Map<string, number>();

  for (const fila of gastos) {
    const [
      fechaRaw,
      ,
      usuario,
      ,
      montoRaw,
    ] = fila;

    if (
      normalizarFecha(fechaRaw) !== hoy
    ) {
      continue;
    }

    const monto =
      numeroDesdeSheet(montoRaw);

    if (!Number.isFinite(monto)) continue;

    familiar += monto;

    usuarios.set(
      usuario,
      (usuarios.get(usuario) ?? 0) +
        monto
    );
  }

  let mensaje =
    `💰 Hoy: ${formatoPesos(
      familiar
    )}`;

  for (const [usuario, total] of usuarios) {
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

  let familiar = 0;

  const usuarios =
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

    if (!fecha.startsWith(mes)) {
      continue;
    }

    const monto =
      numeroDesdeSheet(montoRaw);

    if (!Number.isFinite(monto)) continue;

    familiar += monto;

    usuarios.set(
      usuario,
      (usuarios.get(usuario) ?? 0) +
        monto
    );
  }

  let mensaje =
    `📅 ${nombreMes(mes)}\n` +
    `Total familiar: ${formatoPesos(
      familiar
    )}`;

  for (const [usuario, total] of usuarios) {
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
    "📊 ¿Para qué categoría querés establecer el presupuesto?"
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

async function reconstruirProyeccionHorizontal() {
  const cuotas =
    await obtenerCuotasDatos();

  const meses: string[] = [];

  // Mostramos desde el mes siguiente y 12 meses hacia adelante
  for (let i = 1; i <= 12; i++) {
    meses.push(
      sumarMeses(mesActual(), i)
    );
  }

  // usuario|medioPago => nombre visible + montos por mes
  const agrupado = new Map<
    string,
    {
      usuario: string;
      medio: string;
      montos: Map<string, number>;
    }
  >();

  const detalleCompras = new Map<
    string,
    {
      usuario: string;
      medio: string;
      concepto: string;
      montos: Map<string, number>;
    }
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

    // Solo mostramos los 12 meses de la vista
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

  const encabezadoResumen = [
    "Usuario / Tarjeta",
    ...meses.map(nombreMes),
  ];

  const filasResumen: any[][] = [
    encabezadoResumen,
  ];

  const gruposOrdenados = [
    ...agrupado.values(),
  ].sort((a, b) => {
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

  await reconstruirProyeccionHorizontal();

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

bot.command(
  "proyeccion",
  async ctx => {
    cancelarSesion(ctx);

    await reconstruirProyeccionHorizontal();

    const filas =
      await obtenerCuotasDatos();

    const desde =
      mesActual();

    const meses =
      new Map<
        string,
        Map<string, number>
      >();

    for (const fila of filas) {
      const usuario =
        String(fila[1] ?? "").trim();

      const medio =
        String(fila[2] ?? "").trim();

      const mes =
        String(fila[4] ?? "").trim();

      const monto =
        numeroDesdeSheet(fila[6]);

      if (
        !usuario ||
        !medio ||
        !mes ||
        !Number.isFinite(monto)
      ) {
        continue;
      }

      if (mes <= desde) {
        continue;
      }

      if (!meses.has(mes)) {
        meses.set(
          mes,
          new Map<string, number>()
        );
      }

      const medios =
        meses.get(mes)!;

      const clave =
        `${usuario} — ${medio}`;

      medios.set(
        clave,
        (medios.get(clave) ?? 0) +
          monto
      );
    }

    const ordenados = [
      ...meses.entries(),
    ]
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .slice(0, 6);

    if (!ordenados.length) {
      await ctx.reply(
        "No hay pagos proyectados."
      );

      return;
    }

    let mensaje =
      "📆 Próximos pagos\n";

    for (
      const [mes, medios]
      of ordenados
    ) {
      let total = 0;

      mensaje +=
        `\n📅 ${nombreMes(
          mes
        )}`;

      for (
        const [medio, monto]
        of medios
      ) {
        total += monto;

        mensaje +=
          `\n• ${medio}: ${formatoPesos(
            monto
          )}`;
      }

      mensaje +=
        `\nTotal familiar: ${formatoPesos(
          total
        )}\n`;
    }

    await ctx.reply(mensaje);
      }
);
  }// ======================================================
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
      sesion.categoria =
        normalizarCategoria(
          texto
        );

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
      `/proyeccion — próximos pagos\n` +
      `/ultimo — último gasto\n\n` +

      `✏️ Cargar:\n` +
      `/ingreso — registrar ingreso\n` +
      `/presupuesto — definir presupuesto\n` +
      `/cuotas — registrar compra en cuotas\n\n` +

      `🗑️ /deshacer — borrar tu último gasto\n` +
      `❌ /cancelar — cancelar una carga`
    );
  }
);

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
// REFRESCO AUTOMÁTICO DE PROYECCIÓN
// ======================================================

setInterval(
  async () => {
    try {
      await reconstruirProyeccionHorizontal();

      console.log(
        "🔄 Proyección actualizada automáticamente"
      );
    } catch (error) {
      console.error(
        "⚠️ Error actualizando proyección automáticamente:",
        error
      );
    }
  },
  6 * 60 * 60 * 1000
);

// ======================================================
// INICIO
// ======================================================

async function iniciar() {
  await asegurarPestañas();

  await actualizarResumen();

  try {
    await reconstruirProyeccionHorizontal();
  } catch (error) {
    console.error(
      "⚠️ No pude reconstruir la proyección al iniciar:",
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
  ]);

  await bot.launch();

  console.log(
    "🤖 Esperancito está funcionando"
  );
}

iniciar().catch(
  error => {
    console.error(
      "❌ Error iniciando Esperancito:",
      error
    );
  }
);
