// Lógica pura del registro (fechas, totales, tablero).
// No habla con Sheets ni con Telegram: así se puede probar sin
// credenciales y sin tocar la planilla en vivo.

// RAW: Sheets guarda el valor tal cual. Con USER_ENTERED, en una
// hoja con locale es-AR, "2026-08", "2026-08-01", "diciembre de 2026"
// y "9/8" se interpretan como fechas. El formato de fecha queda
// pegado a la celda (values.clear no lo borra) y un importe como
// 21771 se ve como 9/8/1959.
export const ESCRITURA_PLANILLA = "RAW" as const;

export function convertirMonto(texto: string) {
  return Number(
    texto
      .replace(/\$/g, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

export function numeroDesdeSheet(valor: unknown) {
  if (typeof valor === "number") return valor;

  if (valor === undefined || valor === null) {
    return Number.NaN;
  }

  const texto = String(valor).trim();

  if (!texto) return Number.NaN;

  // "4/9", "9/8", "1/12": número de cuota o una fecha mal parseada,
  // nunca un importe. Number("9/8") es NaN, pero si en algún momento
  // se evaluara como fracción daría 1.125 y ensuciaría los totales.
  if (/^\d{1,2}\/\d{1,2}$/.test(texto)) {
    return Number.NaN;
  }

  const numero = Number(texto);

  return Number.isFinite(numero)
    ? numero
    : convertirMonto(texto);
}

export function serialSheetsAFecha(serial: number) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const fecha = new Date(
    base.getTime() + serial * 86400000
  );

  return fecha.toISOString().slice(0, 10);
}

export function normalizarFecha(valor: unknown) {
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

// Igual que normalizarFecha, pero para columnas "Mes" (formato
// YYYY-MM: ingresos, presupuestos, cuotas_datos, cuotas_registros,
// resumenes_enviados). Google Sheets, con USER_ENTERED, puede
// reconocer un texto como "2026-08" como fecha y convertirlo a un
// número de serie al guardarlo — si después se lo compara como
// String(valor) sin pasar por acá, nunca va a matchear "2026-08"
// y esa fila queda invisible para /balance, /presupuestos, la
// proyección de cuotas, etc. aunque el dato esté bien cargado.
export function normalizarMes(valor: unknown) {
  if (valor === undefined || valor === null) {
    return "";
  }

  if (typeof valor === "number") {
    return serialSheetsAFecha(
      valor
    ).slice(0, 7);
  }

  const texto = String(valor).trim();

  if (/^\d{4}-\d{2}$/.test(texto)) {
    return texto;
  }

  // Por si quedó guardada como fecha completa (texto) en vez de
  // como serial numérico.
  const fecha = normalizarFecha(texto);

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(fecha)
  ) {
    return fecha.slice(0, 7);
  }

  return texto;
}

export function normalizarHora(valor: unknown) {
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

export function sumarMeses(mes: string, cantidad: number) {
  const [anio, numeroMes] = mes.split("-").map(Number);

  const fecha = new Date(
    Date.UTC(anio, numeroMes - 1 + cantidad, 1)
  );

  return `${fecha.getUTCFullYear()}-${String(
    fecha.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

export function nombreMes(mes: string) {
  const [anio, numeroMes] = mes.split("-").map(Number);

  return new Date(
    Date.UTC(anio, numeroMes - 1, 1)
  ).toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function nombreMesCorto(mes: string) {
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

// "21:04", no "09:04 p. m.": el texto con "p. m." depende del locale
// y Sheets puede guardarlo como hora o como texto raro.
export function horaHHMM(
  fecha: Date,
  timeZone: string
) {
  const partes = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  ).formatToParts(fecha);

  let hora =
    partes.find(parte => parte.type === "hour")
      ?.value ?? "00";

  const minuto =
    partes.find(parte => parte.type === "minute")
      ?.value ?? "00";

  if (hora === "24") hora = "00";

  return `${hora.padStart(2, "0")}:${minuto.padStart(
    2,
    "0"
  )}`;
}

export function esFilaEnBlanco(fila: unknown) {
  if (!Array.isArray(fila) || fila.length === 0) {
    return true;
  }

  return fila.every(
    celda =>
      celda === undefined ||
      celda === null ||
      String(celda).trim() === ""
  );
}

const SEPARADOR_CLAVE = "\u001f";

// Arma las filas de la pestaña "resumen" (sin encabezado).
// Diario siempre lleva la fecha completa (YYYY-MM-DD) y Mensual
// solo el mes (YYYY-MM). No se invierten: si en la hoja se veían
// cruzados, era el formato de fecha de Sheets, no esta clave.
export function armarFilasResumen(
  gastos: unknown[][]
) {
  const totales = new Map<string, number>();

  for (const fila of gastos) {
    if (esFilaEnBlanco(fila)) continue;

    const [
      fechaRaw,
      ,
      usuarioRaw,
      ,
      montoRaw,
    ] = fila;

    const fecha = normalizarFecha(fechaRaw);
    const usuario = String(usuarioRaw ?? "").trim();
    const monto = numeroDesdeSheet(montoRaw);

    if (!fecha || !usuario) continue;
    if (!Number.isFinite(monto)) continue;

    const mes = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
      ? fecha.slice(0, 7)
      : /^\d{4}-\d{2}$/.test(fecha)
        ? fecha
        : "";

    const claves = [
      ["Diario", fecha, "Familiar"],
      ["Diario", fecha, usuario],
    ];

    if (mes) {
      claves.push(
        ["Mensual", mes, "Familiar"],
        ["Mensual", mes, usuario]
      );
    }

    for (const partes of claves) {
      const clave = partes.join(SEPARADOR_CLAVE);

      totales.set(
        clave,
        (totales.get(clave) ?? 0) + monto
      );
    }
  }

  const filas: (string | number)[][] = [];

  for (const [clave, total] of totales) {
    const [tipo, periodo, ...resto] =
      clave.split(SEPARADOR_CLAVE);

    filas.push([
      tipo,
      periodo,
      resto.join(SEPARADOR_CLAVE),
      total,
    ]);
  }

  return filas;
}

export type FilaConMontos = {
  etiqueta: string;
  montos: Map<string, number>;
};

// Tablero de cuotas: etiquetas de mes como texto (lo que devuelve
// nombreMes, p. ej. "diciembre de 2026") e importes como número.
// `detalles === null` omite la sección DETALLE DE COMPRAS.
export function armarFilasTablero(
  meses: string[],
  etiquetasMes: string[],
  grupos: FilaConMontos[],
  detalles: FilaConMontos[] | null
) {
  const filaDe = (
    etiqueta: string,
    montos: Map<string, number>
  ) => [
    etiqueta,
    ...meses.map(
      mes => montos.get(mes) ?? 0
    ),
  ];

  const filas: (string | number)[][] = [
    ["Usuario / Tarjeta", ...etiquetasMes],
  ];

  for (const grupo of grupos) {
    filas.push(
      filaDe(grupo.etiqueta, grupo.montos)
    );
  }

  const totalFamiliar = new Map<string, number>();

  for (const grupo of grupos) {
    for (const mes of meses) {
      totalFamiliar.set(
        mes,
        (totalFamiliar.get(mes) ?? 0) +
          (grupo.montos.get(mes) ?? 0)
      );
    }
  }

  filas.push(
    filaDe("TOTAL FAMILIAR", totalFamiliar)
  );

  if (detalles) {
    // Una celda vacía explícita ocupa la fila. Un array [] a veces
    // no cuenta como fila y corre el detalle hacia arriba.
    filas.push([""]);
    filas.push([
      "DETALLE DE COMPRAS",
      ...etiquetasMes,
    ]);

    for (const detalle of detalles) {
      filas.push(
        filaDe(detalle.etiqueta, detalle.montos)
      );
    }
  }

  return filas;
}
