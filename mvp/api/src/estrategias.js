import { Router } from 'express';
import { z } from 'zod';
import { q, tx, audit } from './db.js';
import { rol } from './auth.js';
import { HttpError } from './util.js';

export const estrategias = Router();
export const catalogos = Router();

const esquema = z.object({
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(150),
  descripcion: z.string().trim().min(5, 'La descripción es obligatoria').max(1000),
  entidad_id: z.string().uuid('Elige una entidad'),
  fecha_inicio: z.string().date(),
  fecha_fin: z.string().date(),
  tutor_lider_id: z.string().uuid().optional().nullable(),
}).refine((d) => d.fecha_fin > d.fecha_inicio, { message: 'La fecha final debe ser posterior a la inicial', path: ['fecha_fin'] });

const LISTA = `
  SELECT e.id, e.nombre, e.descripcion, e.fecha_inicio, e.fecha_fin, e.estado, e.entidad_id,
         en.nombre AS entidad, en.region,
         (SELECT count(*)::int FROM estrategia_estudiantes x WHERE x.estrategia_id=e.id) AS n_estudiantes,
         (SELECT count(*)::int FROM estrategia_docentes x WHERE x.estrategia_id=e.id) AS n_docentes,
         (SELECT string_agg(u.nombre, ', ') FROM estrategia_tutores t JOIN usuarios u ON u.id=t.usuario_id WHERE t.estrategia_id=e.id) AS tutores
  FROM estrategias e JOIN entidades en ON en.id=e.entidad_id`;

estrategias.get('/', async (req, res) => {
  const params = [];
  let filtro = '';
  if (req.user.rol === 'TUTOR_LIDER') {
    params.push(req.user.sub);
    filtro = ' WHERE e.id IN (SELECT estrategia_id FROM estrategia_tutores WHERE usuario_id=$1)';
  } else if (req.user.rol === 'RECTOR' || req.user.rol === 'COORDINADOR_INSTITUCIONAL') {
    params.push(req.user.entidad_id);
    filtro = ' WHERE e.entidad_id=$1';
  }
  const { rows } = await q(`${LISTA}${filtro} ORDER BY e.creado_en DESC`, params);
  res.json(rows);
});

estrategias.get('/:id', async (req, res) => {
  const { rows } = await q(`${LISTA} WHERE e.id=$1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'La estrategia no existe');
  // Rector y coordinador solo pueden ver estrategias de su propia entidad
  const scopedRoles = ['RECTOR', 'COORDINADOR_INSTITUCIONAL'];
  if (scopedRoles.includes(req.user.rol) && rows[0].entidad_id !== req.user.entidad_id) {
    throw new HttpError(403, 'No tienes permiso para ver esta estrategia');
  }
  const docentes = (await q(
    `SELECT d.id, d.documento, d.nombre FROM estrategia_docentes ed JOIN docentes d ON d.id=ed.docente_id
     WHERE ed.estrategia_id=$1 ORDER BY d.nombre`, [req.params.id])).rows;
  res.json({ ...rows[0], docentes });
});

// RF_001 · crear
estrategias.post('/', rol('ADMINISTRADOR'), async (req, res) => {
  const d = esquema.parse(req.body);
  const out = await tx(async (c) => {
    const ent = await c.query('SELECT 1 FROM entidades WHERE id=$1', [d.entidad_id]);
    if (!ent.rowCount) throw new HttpError(400, 'La entidad no existe en el catálogo');
    const r = await c.query(
      `INSERT INTO estrategias (nombre, descripcion, entidad_id, fecha_inicio, fecha_fin, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.nombre, d.descripcion, d.entidad_id, d.fecha_inicio, d.fecha_fin, req.user.sub]);
    if (d.tutor_lider_id)
      await c.query('INSERT INTO estrategia_tutores VALUES ($1,$2)', [r.rows[0].id, d.tutor_lider_id]);
    await audit(c, req, 'CREAR', 'estrategias', r.rows[0].id, { nombre: d.nombre });
    return r.rows[0];
  });
  res.status(201).json(out);
});

// RF_001 · editar (solo mientras no tenga estudiantes)
estrategias.put('/:id', rol('ADMINISTRADOR'), async (req, res) => {
  const d = esquema.parse(req.body);
  const out = await tx(async (c) => {
    const e = await c.query('SELECT id FROM estrategias WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!e.rowCount) throw new HttpError(404, 'La estrategia no existe');
    const n = await c.query('SELECT count(*)::int AS n FROM estrategia_estudiantes WHERE estrategia_id=$1', [req.params.id]);
    if (n.rows[0].n > 0)
      throw new HttpError(409, `La estrategia ya tiene ${n.rows[0].n} estudiante(s) vinculado(s) y no se puede editar.`);
    const r = await c.query(
      `UPDATE estrategias SET nombre=$2, descripcion=$3, entidad_id=$4, fecha_inicio=$5, fecha_fin=$6 WHERE id=$1 RETURNING *`,
      [req.params.id, d.nombre, d.descripcion, d.entidad_id, d.fecha_inicio, d.fecha_fin]);
    await audit(c, req, 'EDITAR', 'estrategias', req.params.id, { nombre: d.nombre });
    return r.rows[0];
  });
  res.json(out);
});

// Docentes y tutor líder de la estrategia (no bloquean la edición)
estrategias.post('/:id/docentes', rol('ADMINISTRADOR'), async (req, res) => {
  const { docente_ids } = z.object({ docente_ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
  await tx(async (c) => {
    for (const id of docente_ids)
      await c.query('INSERT INTO estrategia_docentes VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, id]);
    await audit(c, req, 'ASIGNAR_DOCENTES', 'estrategias', req.params.id, { cantidad: docente_ids.length });
  });
  res.status(201).json({ ok: true });
});

// RF_002 · asociación individual
estrategias.post('/:id/estudiantes', rol('ADMINISTRADOR'), async (req, res) => {
  const { estudiante_ids } = z.object({ estudiante_ids: z.array(z.string().uuid()).min(1, 'Selecciona al menos un estudiante') }).parse(req.body);
  const out = await tx(async (c) => {
    const e = await c.query('SELECT id FROM estrategias WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!e.rowCount) throw new HttpError(404, 'La estrategia no existe');
    const r = await c.query(
      `INSERT INTO estrategia_estudiantes (estrategia_id, estudiante_id)
       SELECT $1, id FROM estudiantes WHERE id = ANY($2::uuid[]) ON CONFLICT DO NOTHING`,
      [req.params.id, estudiante_ids]);
    await c.query(`UPDATE estrategias SET estado='CON_ESTUDIANTES' WHERE id=$1`, [req.params.id]);
    await audit(c, req, 'VINCULAR_ESTUDIANTES', 'estrategias', req.params.id, { nuevos: r.rowCount });
    const total = await c.query('SELECT count(*)::int n FROM estrategia_estudiantes WHERE estrategia_id=$1', [req.params.id]);
    return { nuevos: r.rowCount, total: total.rows[0].n };
  });
  res.status(201).json(out);
});

// RF_002 · asociación por grupo (lotes de 5.000, sin repetir)
estrategias.post('/:id/estudiantes/grupo', rol('ADMINISTRADOR'), async (req, res) => {
  const { entidad_id } = z.object({ entidad_id: z.string().uuid() }).parse(req.body);
  const out = await tx(async (c) => {
    const e = await c.query('SELECT id FROM estrategias WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!e.rowCount) throw new HttpError(404, 'La estrategia no existe');
    let ultimo = '00000000-0000-0000-0000-000000000000', nuevos = 0;
    for (;;) {
      const r = await c.query(
        `WITH lote AS (SELECT id FROM estudiantes WHERE entidad_id=$1 AND id>$2 ORDER BY id LIMIT 5000),
              ins AS (INSERT INTO estrategia_estudiantes (estrategia_id, estudiante_id)
                      SELECT $3, id FROM lote ON CONFLICT DO NOTHING RETURNING 1)
         SELECT (SELECT max(id::text) FROM lote) AS ultimo, (SELECT count(*)::int FROM ins) AS n`,
        [entidad_id, ultimo, req.params.id]);
      if (!r.rows[0].ultimo) break;
      ultimo = r.rows[0].ultimo;
      nuevos += r.rows[0].n;
    }
    await c.query(`UPDATE estrategias SET estado='CON_ESTUDIANTES' WHERE id=$1 AND EXISTS
                   (SELECT 1 FROM estrategia_estudiantes WHERE estrategia_id=$1)`, [req.params.id]);
    await audit(c, req, 'VINCULAR_GRUPO', 'estrategias', req.params.id, { entidad_id, nuevos });
    const total = await c.query('SELECT count(*)::int n FROM estrategia_estudiantes WHERE estrategia_id=$1', [req.params.id]);
    return { nuevos, total: total.rows[0].n };
  });
  res.status(201).json(out);
});

estrategias.get('/:id/estudiantes', rol('ADMINISTRADOR', 'COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const { rows } = await q(
    `SELECT s.id, s.documento, s.nombre, en.nombre AS entidad FROM estrategia_estudiantes ee
     JOIN estudiantes s ON s.id=ee.estudiante_id JOIN entidades en ON en.id=s.entidad_id
     WHERE ee.estrategia_id=$1 ORDER BY s.nombre LIMIT 100`, [req.params.id]);
  res.json(rows);
});

// ---- Catálogos ----
let cacheEntidades = { t: 0, v: null };
catalogos.get('/entidades', async (_req, res) => {
  if (!cacheEntidades.v || Date.now() - cacheEntidades.t > 5 * 60000) {
    cacheEntidades = { t: Date.now(), v: (await q('SELECT id, nombre, region FROM entidades ORDER BY nombre')).rows };
  }
  res.json(cacheEntidades.v);
});

// RF_002 · búsqueda con paginación por cursor (50 por página)
catalogos.get('/estudiantes', rol('ADMINISTRADOR'), async (req, res) => {
  const { documento = '', nombre = '', entidad = '', cursor = '' } = req.query;
  const p = [], w = [];
  if (documento) { p.push(`${documento}%`); w.push(`s.documento LIKE $${p.length}`); }
  if (nombre) { p.push(`${String(nombre).toLowerCase()}%`); w.push(`lower(s.nombre) LIKE $${p.length}`); }
  if (entidad) { p.push(entidad); w.push(`s.entidad_id=$${p.length}`); }
  if (cursor) { p.push(cursor); w.push(`s.documento>$${p.length}`); }
  const { rows } = await q(
    `SELECT s.id, s.documento, s.nombre, en.nombre AS entidad FROM estudiantes s JOIN entidades en ON en.id=s.entidad_id
     ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY s.documento LIMIT 51`, p);
  const hayMas = rows.length > 50;
  const items = rows.slice(0, 50);
  res.json({ items, siguiente: hayMas ? items[items.length - 1].documento : null });
});

catalogos.get('/estudiantes/conteo', rol('ADMINISTRADOR'), async (req, res) => {
  const r = await q('SELECT count(*)::int AS n FROM estudiantes WHERE entidad_id=$1', [req.query.entidad]);
  res.json({ n: r.rows[0].n });
});

catalogos.get('/docentes', rol('ADMINISTRADOR', 'TUTOR_LIDER', 'TUTOR_DOCENTE', 'COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const { entidad = '' } = req.query;
  const { rows } = await q(
    `SELECT d.id, d.documento, d.nombre, d.entidad_id, en.nombre AS entidad FROM docentes d JOIN entidades en ON en.id=d.entidad_id
     ${entidad ? 'WHERE d.entidad_id=$1' : ''} ORDER BY d.nombre`, entidad ? [entidad] : []);
  res.json(rows);
});

catalogos.get('/tutores-lider', rol('ADMINISTRADOR'), async (_req, res) => {
  res.json((await q(`SELECT id, nombre FROM usuarios WHERE rol='TUTOR_LIDER' ORDER BY nombre`)).rows);
});

// Datos de trabajo del tutor líder para guardar en el dispositivo (solo lo asignado)
catalogos.get('/mis-datos', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  let est, doc;
  if (req.user.rol === 'TUTOR_LIDER') {
    est = (await q(
      `SELECT e.id, e.nombre, e.fecha_inicio, e.fecha_fin FROM estrategias e
       JOIN estrategia_tutores t ON t.estrategia_id=e.id WHERE t.usuario_id=$1 ORDER BY e.nombre`, [req.user.sub])).rows;
    doc = (await q(
      `SELECT ed.estrategia_id, d.id, d.documento, d.nombre FROM estrategia_docentes ed
       JOIN docentes d ON d.id=ed.docente_id JOIN estrategia_tutores t ON t.estrategia_id=ed.estrategia_id
       WHERE t.usuario_id=$1 ORDER BY d.nombre`, [req.user.sub])).rows;
  } else {
    // TUTOR_DOCENTE: estrategias de su entidad
    est = (await q(
      `SELECT id, nombre, fecha_inicio, fecha_fin FROM estrategias
       WHERE entidad_id=$1 ORDER BY nombre`, [req.user.entidad_id])).rows;
    doc = (await q(
      `SELECT ed.estrategia_id, d.id, d.documento, d.nombre FROM estrategia_docentes ed
       JOIN docentes d ON d.id=ed.docente_id
       JOIN estrategias e ON e.id=ed.estrategia_id
       WHERE e.entidad_id=$1 ORDER BY d.nombre`, [req.user.entidad_id])).rows;
  }
  res.json({ estrategias: est, docentes: doc, descargado_en: new Date().toISOString() });
});
