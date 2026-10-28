import assert from "node:assert/strict";
import {
  ESCRITURA_PLANILLA,
  armarFilasResumen,
  armarFilasTablero,
  esFilaEnBlanco,
  horaHHMM,
  nombreMes,
  normalizarFecha,
  normalizarMes,
  numeroDesdeSheet,
  serialSheetsAFecha,
} from "./logica.ts";

assert.equal(ESCRITURA_PLANILLA, "RAW");

// 21771 es el serial de Sheets para el 9 de agosto de 1959.
// Con formato de fecha es-AR se ve "9/8/1959" (o "9/8" si la
// columna es angosta). No es la cuota "9/8".
assert.equal(serialSheetsAFecha(21771), "1959-08-09");

assert.equal(
  normalizarFecha(46296),
  "2026-10-01"
);
assert.equal(
  normalizarMes(46296),
  "2026-10"
);
assert.equal(normalizarMes("2026-08"), "2026-08");
assert.equal(
  normalizarMes("2026-08-01"),
  "2026-08"
);
assert.equal(
  normalizarFecha("1/12/2026"),
  "2026-12-01"
);

assert.equal(numeroDesdeSheet(""), Number.NaN);
assert.equal(numeroDesdeSheet("9/8"), Number.NaN);
assert.equal(numeroDesdeSheet("4/9"), Number.NaN);
assert.equal(numeroDesdeSheet(21771), 21771);
assert.equal(numeroDesdeSheet("1500,50"), 1500.5);

assert.equal(
  nombreMes("2026-12"),
  "diciembre de 2026"
);

assert.equal(
  horaHHMM(
    new Date("2026-10-27T21:04:00-03:00"),
    "America/Argentina/Cordoba"
  ),
  "21:04"
);

assert.equal(
  armarFilasResumen([
    ["2026-08-01", "10:00", "Ana", "Super", ""],
    ["2026-08-01", "10:00", "Ana", "Super", "9/8"],
  ]).length,
  0
);

assert.equal(esFilaEnBlanco([]), true);
assert.equal(esFilaEnBlanco(["", "  ", null]), true);
assert.equal(esFilaEnBlanco(["2026-08-01"]), false);

const gastos = [
  ["2026-08-01", "21:04", "Joaquín Comba", "Supermercado", 100],
  [],
  ["2026-08-02", "10:00", "Joaquín Comba", "Nafta", 50],
  ["2026-08-01", "11:00", "Romina", "Super", 20],
];

const resumen = armarFilasResumen(gastos);

function fila(
  tipo: string,
  periodo: string,
  usuario: string
) {
  const encontrada = resumen.find(
    f =>
      f[0] === tipo &&
      f[1] === periodo &&
      f[2] === usuario
  );

  assert.ok(
    encontrada,
    `falta ${tipo} ${periodo} ${usuario}`
  );

  return encontrada[3];
}

assert.equal(
  fila("Diario", "2026-08-01", "Familiar"),
  120
);
assert.equal(
  fila("Diario", "2026-08-01", "Joaquín Comba"),
  100
);
assert.equal(
  fila("Diario", "2026-08-02", "Familiar"),
  50
);
assert.equal(
  fila("Mensual", "2026-08", "Familiar"),
  170
);
assert.equal(
  fila("Mensual", "2026-08", "Joaquín Comba"),
  150
);

assert.equal(
  resumen.some(
    f => f[0] === "Diario" && f[1] === "2026-08"
  ),
  false
);
assert.equal(
  resumen.some(
    f =>
      f[0] === "Mensual" &&
      String(f[1]).length !== 7
  ),
  false
);

// Un nombre con el separador viejo "|" no tiene que correr las columnas.
const conBarra = armarFilasResumen([
  ["2026-09-03", "09:00", "Ana|Extra", "Super", 10],
]);
const usuarioConBarra = conBarra.find(
  f => f[0] === "Diario" && f[2] !== "Familiar"
);
assert.equal(usuarioConBarra?.[1], "2026-09-03");
assert.equal(usuarioConBarra?.[2], "Ana|Extra");

const montos = new Map<string, number>([
  ["2026-11", 21771],
  ["2026-12", 21771],
]);

const tablero = armarFilasTablero(
  ["2026-11", "2026-12"],
  ["2026-11", "2026-12"].map(nombreMes),
  [
    {
      etiqueta: "Joaquín Comba — MercadoPago Romi",
      montos,
    },
  ],
  [
    {
      etiqueta:
        "Joaquín Comba — MercadoPago Romi — Compra",
      montos,
    },
  ]
);

assert.deepEqual(tablero[0], [
  "Usuario / Tarjeta",
  "noviembre de 2026",
  "diciembre de 2026",
]);
assert.deepEqual(tablero[1], [
  "Joaquín Comba — MercadoPago Romi",
  21771,
  21771,
]);
assert.equal(tablero[1].includes("9/8"), false);
assert.equal(tablero[1].includes("1/12"), false);
assert.equal(tablero[3][0], "");
assert.equal(tablero[4][0], "DETALLE DE COMPRAS");
assert.equal(tablero[4][2], "diciembre de 2026");
assert.equal(tablero[5][2], 21771);

console.log("logica.test.ts: ok");
