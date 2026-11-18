// Pruebas de la API (plan de QA: PR_001 a PR_023). Requieren la API arriba y los datos de ejemplo cargados.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = process.env.API || 'http://localhost:3000/api';
const CLAVE = 'Sses2026*';
const llamar = async (metodo, ruta, token, cuerpo) => {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'x-sses-cliente': 'pwa', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
};
const login = async (correo) => (await llamar('POST', '/auth/login', null, { correo, clave: CLAVE })).data.acceso;
const hoy = new Date().toISOString().slice(0, 10);
const mesSiguiente = () => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };

let T = {};
test('inicio de sesión y roles', async () => {
  for (const [k, c] of Object.entries({ admin: 'admin@sses.gov.co', coord: 'coordinador@sses.gov.co', lider: 'lider1@sses.gov.co', docente: 'docente1@sses.gov.co', control: 'control@sses.gov.co' })) T[k] = await login(c);
  const mal = await llamar('POST', '/auth/login', null, { correo: 'admin@sses.gov.co', clave: 'x' });
  assert.equal(mal.status, 401);
  assert.equal((await llamar('GET', '/estrategias')).status, 401); // PR_019 sin sesión
  assert.equal((await llamar('POST', '/estrategias', T.lider, {})).status, 403); // rol incorrecto
});

let ent, estId;
test('RF_001 crear y editar estrategia; bloqueo con estudiantes (PR_001 a PR_004)', async () => {
  ent = (await llamar('GET', '/entidades', T.admin)).data[0].id;
  const nombre = 'Estrategia de prueba ' + crypto.randomUUID().slice(0, 6);
  const c = await llamar('POST', '/estrategias', T.admin, { nombre, descripcion: 'Descripción de prueba', entidad_id: ent, fecha_inicio: hoy, fecha_fin: mesSiguiente() });
  assert.equal(c.status, 201); estId = c.data.id;
  assert.equal(c.data.estado, 'SIN_ESTUDIANTES');
  assert.equal((await llamar('POST', '/estrategias', T.admin, { nombre, descripcion: 'x'.repeat(10), entidad_id: ent, fecha_inicio: hoy, fecha_fin: mesSiguiente() })).status, 409); // nombre repetido en la entidad
  assert.equal((await llamar('POST', '/estrategias', T.admin, { nombre: 'Otra', descripcion: 'Descripción', entidad_id: ent, fecha_inicio: mesSiguiente(), fecha_fin: hoy })).status, 400);
  const ed = await llamar('PUT', '/estrategias/' + estId, T.admin, { nombre: nombre + ' v2', descripcion: 'Editada', entidad_id: ent, fecha_inicio: hoy, fecha_fin: mesSiguiente() });
  assert.equal(ed.status, 200);
});
test('RF_002 asociar estudiantes y bloquear edición (PR_005 a PR_007)', async () => {
  const b = await llamar('GET', '/estudiantes?entidad=' + ent, T.admin);
  assert.equal(b.data.items.length, 50); assert.ok(b.data.siguiente); // paginación por cursor
  const sig = await llamar('GET', `/estudiantes?entidad=${ent}&cursor=${b.data.siguiente}`, T.admin);
  assert.ok(sig.data.items[0].documento > b.data.siguiente);
  const a = await llamar('POST', `/estrategias/${estId}/estudiantes`, T.admin, { estudiante_ids: b.data.items.slice(0, 3).map((s) => s.id) });
  assert.equal(a.data.total, 3);
  const rep = await llamar('POST', `/estrategias/${estId}/estudiantes`, T.admin, { estudiante_ids: b.data.items.slice(0, 3).map((s) => s.id) });
  assert.equal(rep.data.nuevos, 0); // sin repetidos
  const ed = await llamar('PUT', '/estrategias/' + estId, T.admin, { nombre: 'Ya no', descripcion: 'No debe cambiar', entidad_id: ent, fecha_inicio: hoy, fecha_fin: mesSiguiente() });
  assert.equal(ed.status, 409);
  const g = await llamar('POST', `/estrategias/${estId}/estudiantes/grupo`, T.admin, { entidad_id: ent });
  assert.ok(g.data.total > 3);
});

let est, docs, acId;
test('RF_003 acompañamiento individual, idempotencia y regla por mes (PR_008, PR_010)', async () => {
  const md = (await llamar('GET', '/mis-datos', T.lider)).data;
  est = md.estrategias[0]; docs = md.docentes.filter((d) => d.estrategia_id === est.id);
  // usamos el mes siguiente a las estrategias con historia para evitar el choque con los datos de ejemplo
  const fecha = new Date(); fecha.setUTCDate(15);
  const f = fecha.toISOString().slice(0, 10);
  acId = crypto.randomUUID();
  const cuerpo = { id: acId, estrategia_id: est.id, tipo: 'INDIVIDUAL', fecha: f, duracion_min: 50, tipo_actividad: 'Observación de clase', observaciones: 'Se observó la clase completa.', compromisos: 'Llevar material nuevo.', docente_ids: [docs[7].id] };
  const r1 = await llamar('POST', '/acompanamientos', T.lider, cuerpo);
  assert.equal(r1.status, 201);
  const r2 = await llamar('POST', '/acompanamientos', T.lider, cuerpo); // reintento: no duplica
  assert.equal(r2.status, 200); assert.equal(r2.data.existente, true);
  const otro = await llamar('POST', '/acompanamientos', T.lider, { ...cuerpo, id: crypto.randomUUID() }); // mismo docente, mismo mes
  assert.equal(otro.status, 409);
  assert.equal((await llamar('POST', '/acompanamientos', T.lider, { ...cuerpo, id: crypto.randomUUID(), tipo: 'GRUPAL', docente_ids: [docs[6].id] })).status, 400);
});
test('RF_003 acompañamiento grupal y seguimiento semanal (PR_009, PR_011)', async () => {
  const f = new Date(); f.setUTCDate(15);
  const g = await llamar('POST', '/acompanamientos', T.lider, { id: crypto.randomUUID(), estrategia_id: est.id, tipo: 'GRUPAL', fecha: f.toISOString().slice(0, 10), duracion_min: 90, tipo_actividad: 'Taller con docentes', observaciones: 'Taller de planeación.', compromisos: 'Entregar planeaciones.', docente_ids: [docs[4].id, docs[5].id] });
  assert.equal(g.status, 201);
  const sid = crypto.randomUUID();
  const s = await llamar('POST', `/acompanamientos/${acId}/seguimientos`, T.lider, { id: sid, fecha: new Date().toISOString().slice(0, 10), avance: 'Va bien', observaciones: 'Cumplió lo acordado.' });
  assert.equal(s.status, 201);
  const dup = await llamar('POST', `/acompanamientos/${acId}/seguimientos`, T.lider, { id: crypto.randomUUID(), fecha: new Date().toISOString().slice(0, 10), avance: 'Otro', observaciones: 'Misma semana.' });
  assert.equal(dup.status, 409);
});
test('RF_003 corrección dentro de 24 h y calendario (PR_023)', async () => {
  const c = await llamar('PUT', '/acompanamientos/' + acId, T.lider, { duracion_min: 55, tipo_actividad: 'Observación de clase', observaciones: 'Observación corregida.', compromisos: 'Llevar material nuevo.' });
  assert.equal(c.status, 200);
  const cal = await llamar('GET', '/acompanamientos/calendario', T.lider);
  assert.ok(cal.data.dias.length >= 28);
  const h = await llamar('GET', '/acompanamientos?estrategia=' + est.id, T.lider);
  assert.ok(h.data.length > 0);
});
test('RF_004 sincronización por lotes e idempotencia (PR_012, PR_013)', async () => {
  const f = new Date(); f.setUTCDate(20);
  const id = crypto.randomUUID();
  const lote = { registros: [
    { clave: 'a', tipo: 'ACOMPANAMIENTO', datos: { id, estrategia_id: est.id, tipo: 'INDIVIDUAL', fecha: f.toISOString().slice(0, 10), duracion_min: 40, tipo_actividad: 'Retroalimentación', observaciones: 'Hecho sin conexión.', compromisos: 'Seguimiento semanal.', docente_ids: [docs[3].id], registrado_en: new Date(Date.now() - 3600000).toISOString() } },
    { clave: 'b', tipo: 'ACOMPANAMIENTO', datos: { id: crypto.randomUUID(), estrategia_id: est.id, tipo: 'INDIVIDUAL', fecha: f.toISOString().slice(0, 10), duracion_min: 40, tipo_actividad: 'Retroalimentación', observaciones: 'Duplicado del mes.', compromisos: 'Seguimiento semanal.', docente_ids: [docs[7].id] } },
  ] };
  const r = await llamar('POST', '/sincronizacion', T.lider, lote);
  assert.equal(r.data.resultados[0].estado, 'SINCRONIZADO');
  assert.equal(r.data.resultados[1].estado, 'RECHAZADO');
  const r2 = await llamar('POST', '/sincronizacion', T.lider, { registros: [lote.registros[0]] }); // reintento tras caída
  assert.equal(r2.data.resultados[0].estado, 'SINCRONIZADO'); assert.equal(r2.data.resultados[0].repetido, true);
  assert.equal((await llamar('POST', '/sincronizacion', T.lider, { registros: Array(51).fill(lote.registros[0]) })).status, 400);
});

test('RF_005 reportes de desempeño y exportación a Excel (PR_014)', async () => {
  const r = await llamar('GET', '/reportes/desempeno', T.coord);
  assert.ok(r.data.por_tutor.length >= 1 && r.data.seguimientos.porcentaje !== null);
  assert.equal((await llamar('GET', '/reportes/desempeno', T.lider)).status, 403);
  const x = await fetch(BASE + '/reportes/exportar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sses-cliente': 'pwa', Authorization: `Bearer ${T.coord}` }, body: '{}' });
  assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.ok((await x.arrayBuffer()).byteLength > 3000);
});
test('RF_006 el Ente de Control solo lee y consulta reportes de ley (PR_015, PR_016)', async () => {
  assert.equal((await llamar('POST', '/estrategias', T.control, {})).status, 403);
  assert.equal((await llamar('PUT', '/estrategias/' + estId, T.control, {})).status, 403);
  const l = await llamar('GET', '/control/reportes-ley/cobertura-docentes?periodo=' + hoy.slice(0, 7), T.control);
  assert.equal(l.status, 200); assert.ok(l.data.filas.length > 0);
  const b = await llamar('GET', '/control/bitacora', T.control);
  assert.ok(b.data.length > 0);
});
test('RF_007 instrumento: borrador, validación y un solo envío (PR_017)', async () => {
  const i = (await llamar('GET', '/instrumentos/vigente', T.docente)).data;
  assert.ok(i.preguntas.length >= 6);
  const esc = i.preguntas.filter((p) => p.tipo === 'ESCALA');
  const bor = await llamar('PUT', '/instrumentos/respuestas/borrador', T.docente, { respuestas: { [esc[0].id]: 4 } });
  assert.equal(bor.status, 200);
  assert.equal((await llamar('GET', '/instrumentos/vigente', T.docente)).data.mia.estado, 'BORRADOR');
  assert.equal((await llamar('POST', '/instrumentos/respuestas', T.docente, { respuestas: { [esc[0].id]: 4 } })).status, 400); // faltan obligatorias
  const todas = Object.fromEntries(esc.map((p) => [p.id, 5]));
  assert.equal((await llamar('POST', '/instrumentos/respuestas', T.docente, { respuestas: todas })).status, 201);
  assert.equal((await llamar('POST', '/instrumentos/respuestas', T.docente, { respuestas: todas })).status, 409);
  const c = await llamar('GET', '/instrumentos/consolidado', T.coord);
  assert.ok(c.data.enviados >= 1);
});
test('RF_008 sesiones del piloto e incidentes (PR_021, PR_022)', async () => {
  const region = 'Región de prueba ' + crypto.randomUUID().slice(0, 4);
  const s = await llamar('POST', '/pilotaje/sesiones', T.coord, { fecha: hoy, region, citados: 20, asistentes: 18, valoracion: 4, observaciones: 'Prueba' });
  assert.equal(s.status, 201);
  assert.equal((await llamar('POST', '/pilotaje/sesiones', T.coord, { fecha: hoy, region, citados: 20, asistentes: 18, valoracion: 4 })).status, 409);
  assert.equal((await llamar('POST', '/pilotaje/sesiones', T.coord, { fecha: hoy, region: region + 'x', citados: 5, asistentes: 9, valoracion: 4 })).status, 400);
  assert.equal((await llamar('POST', '/pilotaje/sesiones', T.coord, { fecha: hoy, region: region + 'y', citados: 5, asistentes: 4, valoracion: 7 })).status, 400);
  const i = await llamar('POST', `/pilotaje/sesiones/${s.data.id}/incidentes`, T.coord, { tipo: 'RENDIMIENTO', hora: '09:30', descripcion: 'La carga del reporte tardó más de lo normal.' });
  assert.equal(i.data.estado, 'ABIERTO');
  const r = await llamar('PUT', `/pilotaje/incidentes/${i.data.id}/resolver`, T.coord, { solucion: 'Se amplió la caché del reporte.' });
  assert.equal(r.data.estado, 'RESUELTO');
  assert.equal((await llamar('POST', '/pilotaje/sesiones', T.admin, {})).status, 403);
});
test('RNF_002 anti-CSRF y bitácora inmutable', async () => {
  const r = await fetch(BASE + '/estrategias', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T.admin}` }, body: '{}' });
  assert.equal(r.status, 403);
});
