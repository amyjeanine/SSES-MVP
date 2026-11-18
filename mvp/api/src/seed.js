import { pool, q } from './db.js';
import { hashClave } from './auth.js';

const CARGA = Number(process.argv[2] || process.env.SEED_ESTUDIANTES || 3000);
const CLAVE = 'Sses2026*';

const NOM = ['Camila','Santiago','Valentina','Juan','Sofía','Mateo','Isabella','Samuel','Mariana','Daniel','Luciana','Andrés','Laura','Sebastián','Paula','Nicolás','Daniela','David','Sara','Felipe','Ana','Julián','Gabriela','Esteban','Manuela','Tomás','Juliana','Emmanuel','Natalia','Miguel'];
const APE = ['García','Rodríguez','Martínez','López','Gómez','Hernández','Díaz','Pérez','Sánchez','Ramírez','Torres','Flórez','Vargas','Castro','Rojas','Moreno','Jiménez','Ortiz','Quintero','Cárdenas','Mejía','Restrepo','Ospina','Arias','Salazar'];

const ENT = [
  ['I.E. Francisco de Paula Santander', 'Caribe'], ['I.E. Rafael Núñez', 'Caribe'], ['Colegio Distrital La Esperanza', 'Caribe'],
  ['I.E. Simón Bolívar', 'Andina'], ['Colegio Nacional Agustín Codazzi', 'Andina'], ['I.E. Policarpa Salavarrieta', 'Andina'],
  ['I.E. Normal Superior de Quibdó', 'Pacífica'], ['I.E. Pedro Antonio Santacruz', 'Pacífica'],
  ['I.E. Jorge Eliécer Gaitán', 'Orinoquía'], ['I.E. Eduardo Santos', 'Orinoquía'],
  ['I.E. Etnoeducativa Amazónica', 'Amazonía'], ['I.E. Cristo Rey', 'Amazonía'],
];

async function main() {
  await q('TRUNCATE auditoria, incidentes, respuestas_instrumento, sesiones_piloto, instrumento_preguntas, instrumentos, seguimientos, acompanamiento_docentes, acompanamientos, estrategia_tutores, estrategia_docentes, estrategia_estudiantes, estrategias, docentes, estudiantes, usuarios, entidades RESTART IDENTITY CASCADE').catch(async () => {
    // la bitácora es inmutable: se recrea el trigger solo para el reinicio de datos de ejemplo
    await q('ALTER TABLE auditoria DISABLE TRIGGER trg_auditoria_inmutable');
    await q('TRUNCATE auditoria, incidentes, respuestas_instrumento, sesiones_piloto, instrumento_preguntas, instrumentos, seguimientos, acompanamiento_docentes, acompanamientos, estrategia_tutores, estrategia_docentes, estrategia_estudiantes, estrategias, docentes, estudiantes, usuarios, entidades RESTART IDENTITY CASCADE');
    await q('ALTER TABLE auditoria ENABLE TRIGGER trg_auditoria_inmutable');
  });

  const ents = [];
  for (const [n, r] of ENT) ents.push((await q('INSERT INTO entidades (nombre, region) VALUES ($1,$2) RETURNING id', [n, r])).rows[0].id);

  const hash = await hashClave(CLAVE);
  const U = [
    ['Marta Lucía Ortega', 'admin@sses.gov.co', 'ADMINISTRADOR'],
    ['Carlos Andrés Peña', 'coordinador@sses.gov.co', 'COORDINADOR_INSTITUCIONAL'],
    ['Diana Marcela Ruiz', 'lider1@sses.gov.co', 'TUTOR_LIDER'],
    ['Jorge Iván Castaño', 'lider2@sses.gov.co', 'TUTOR_LIDER'],
    ['Luz Adriana Mora', 'docente1@sses.gov.co', 'TUTOR_DOCENTE'],
    ['Ente de Control Nacional', 'control@sses.gov.co', 'ENTE_CONTROL'],
  ];
  const uid = {};
  for (const [n, c, r] of U) uid[c] = (await q('INSERT INTO usuarios (nombre, correo, clave_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id', [n, c, hash, r])).rows[0].id;

  // Estudiantes: se generan en la base de datos (rápido incluso para millones)
  await q(
    `INSERT INTO estudiantes (documento, nombre, entidad_id)
     SELECT (1000000000 + g)::text,
            ($1::text[])[1 + (g % $2)] || ' ' || ($3::text[])[1 + ((g / 7) % $4)] || ' ' || ($3::text[])[1 + ((g / 3) % $4)],
            ($5::uuid[])[1 + (g % $6)]
     FROM generate_series(1, $7) g`,
    [NOM, NOM.length, APE, APE.length, ents, ents.length, CARGA]);

  // Docentes (40)
  await q(
    `INSERT INTO docentes (documento, nombre, entidad_id)
     SELECT (52000000 + g)::text, ($1::text[])[1 + ((g*5) % $2)] || ' ' || ($3::text[])[1 + ((g*3) % $4)] || ' ' || ($3::text[])[1 + ((g*7+2) % $4)],
            ($5::uuid[])[1 + (g % $6)] FROM generate_series(1, 40) g`,
    [NOM, NOM.length, APE, APE.length, ents, ents.length]);

  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const sumaMeses = (m) => { const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + m, 1)); return d; };
  const ini = iso(sumaMeses(-2)), fin = iso(sumaMeses(6));

  const est = async (nombre, desc, ent, tutor) => {
    const r = await q(`INSERT INTO estrategias (nombre, descripcion, entidad_id, fecha_inicio, fecha_fin, creado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nombre, desc, ents[ent], ini, fin, uid['admin@sses.gov.co']]);
    if (tutor) await q('INSERT INTO estrategia_tutores VALUES ($1,$2)', [r.rows[0].id, uid[tutor]]);
    return r.rows[0].id;
  };
  const e1 = await est('Club de Lectura en Voz Alta', 'Espacio semanal de lectura compartida para fortalecer comprensión lectora y expresión oral.', 3, 'lider1@sses.gov.co');
  const e2 = await est('Semillero de Robótica Escolar', 'Talleres de construcción y programación básica de robots para estudiantes de básica secundaria.', 0, 'lider1@sses.gov.co');
  const e3 = await est('Escuela de Deportes Tradicionales', 'Práctica de juegos y deportes tradicionales de la región con acompañamiento de docentes de educación física.', 8, 'lider2@sses.gov.co');
  const e4 = await est('Taller de Huerta Escolar', 'Huerta pedagógica para aprender sobre alimentación sana y cuidado del ambiente. (Aún sin estudiantes: se puede editar.)', 6, null);

  // Docentes por estrategia (10 cada una) y estudiantes vinculados en las tres primeras
  const docs = (await q('SELECT id FROM docentes ORDER BY documento')).rows.map((r) => r.id);
  const asigna = async (e, desde) => { for (const d of docs.slice(desde, desde + 8)) await q('INSERT INTO estrategia_docentes VALUES ($1,$2)', [e, d]); };
  await asigna(e1, 0); await asigna(e2, 8); await asigna(e3, 16);
  for (const [e, ent] of [[e1, 3], [e2, 0], [e3, 8]])
    await q(`INSERT INTO estrategia_estudiantes (estrategia_id, estudiante_id)
             SELECT $1, id FROM estudiantes WHERE entidad_id=$2 ORDER BY documento LIMIT 120`, [e, ents[ent]]);
  await q(`UPDATE estrategias SET estado='CON_ESTUDIANTES' WHERE id = ANY($1::uuid[])`, [[e1, e2, e3]]);

  // Historia del mes pasado: acompañamientos y seguimientos de ejemplo para que los reportes tengan datos
  const mesPasado = sumaMeses(-1);
  const act = ['Observación de clase', 'Retroalimentación', 'Taller con docentes', 'Planeación conjunta'];
  let n = 0;
  for (const [e, tutor, desde] of [[e1, 'lider1@sses.gov.co', 0], [e2, 'lider1@sses.gov.co', 8], [e3, 'lider2@sses.gov.co', 16]]) {
    for (let i = 0; i < 5; i++) {
      const dia = new Date(Date.UTC(mesPasado.getUTCFullYear(), mesPasado.getUTCMonth(), 3 + i * 3));
      const a = (await q(
        `INSERT INTO acompanamientos (id, estrategia_id, tipo, fecha, duracion_min, tipo_actividad, observaciones, compromisos, creado_por, creado_en, registrado_en)
         VALUES (gen_random_uuid(),$1,'INDIVIDUAL',$2::date,$3,$4,$5,$6,$7,$2::date,$2::date) RETURNING id`,
        [e, iso(dia), 45 + 5 * i, act[n % 4], 'El docente aplica la estrategia con buen manejo del grupo.', 'Preparar la siguiente sesión con material de apoyo.', uid[tutor]])).rows[0].id;
      await q('INSERT INTO acompanamiento_docentes VALUES ($1,$2,$3,$4)', [a, e, docs[desde + i], iso(mesPasado)]);
      const semanas = 2 + (i % 3);
      for (let s = 0; s < semanas; s++) {
        const f = new Date(dia); f.setUTCDate(f.getUTCDate() + 7 * s);
        const lunes = new Date(f); lunes.setUTCDate(lunes.getUTCDate() - ((lunes.getUTCDay() + 6) % 7));
        await q(`INSERT INTO seguimientos (id, acompanamiento_id, semana_inicio, avance, observaciones, creado_por, creado_en, registrado_en)
                 VALUES (gen_random_uuid(),$1,$2::date,'Avance sostenido en la planeación.','Se revisaron los compromisos de la semana.',$3,$4::date,$4::date)`, [a, iso(lunes), uid[tutor], iso(f)]);
      }
      n++;
    }
  }

  // Instrumento de percepción v1
  const ins = (await q(`INSERT INTO instrumentos (version, titulo, vigente) VALUES (1, 'Percepción de los tutores sobre el SSES', true) RETURNING id`)).rows[0].id;
  const P = [
    ['FUNCIONALIDAD', 'El sistema me permitió registrar lo que necesitaba (acompañamientos, seguimientos, consultas).', 'ESCALA', true],
    ['FUNCIONALIDAD', 'La información que veo en el sistema está completa y es correcta.', 'ESCALA', true],
    ['FACILIDAD_DE_USO', 'Aprendí a usar el sistema con facilidad, sin ayuda de otra persona.', 'ESCALA', true],
    ['FACILIDAD_DE_USO', 'Las pantallas se entienden bien en mi celular, tablet o computador.', 'ESCALA', true],
    ['COMPORTAMIENTO', 'El sistema respondió con rapidez durante la sesión.', 'ESCALA', true],
    ['COMPORTAMIENTO', 'Pude seguir trabajando cuando se me fue o falló el internet.', 'ESCALA', true],
    ['FUNCIONALIDAD', '¿Qué funcionalidad le haría falta al sistema?', 'TEXTO', false],
    ['COMPORTAMIENTO', 'Cuéntanos si tuviste algún problema durante la sesión.', 'TEXTO', false],
  ];
  for (let i = 0; i < P.length; i++) await q('INSERT INTO instrumento_preguntas (instrumento_id, orden, eje, texto, tipo, obligatoria) VALUES ($1,$2,$3,$4,$5,$6)', [ins, i + 1, ...P[i]]);

  // Dos sesiones de ejemplo con un incidente
  const s1 = (await q(`INSERT INTO sesiones_piloto (fecha, region, citados, asistentes, valoracion, observaciones, creado_por) VALUES ($1,'Caribe',24,21,4,'Buen ritmo de la sesión.',$2) RETURNING id`, [iso(new Date(hoy - 5 * 86400000)), uid['coordinador@sses.gov.co']])).rows[0].id;
  await q(`INSERT INTO sesiones_piloto (fecha, region, citados, asistentes, valoracion, observaciones, creado_por) VALUES ($1,'Andina',30,28,5,NULL,$2)`, [iso(new Date(hoy - 3 * 86400000)), uid['coordinador@sses.gov.co']]);
  await q(`INSERT INTO incidentes (sesion_id, tipo, hora, descripcion, estado, solucion, resuelto_en, creado_por) VALUES ($1,'CONECTIVIDAD','10:20','Se fue la conexión durante 10 minutos en el salón de Montería.','RESUELTO','Los tutores siguieron registrando sin conexión y se sincronizó al volver.', now(), $2)`, [s1, uid['coordinador@sses.gov.co']]);

  const c = (await q('SELECT (SELECT count(*) FROM estudiantes) e, (SELECT count(*) FROM docentes) d')).rows[0];
  console.log(`Datos de ejemplo listos: ${c.e} estudiantes, ${c.d} docentes. Clave de todos los usuarios: ${CLAVE}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
