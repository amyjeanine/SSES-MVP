import { Router } from 'express';
import { z } from 'zod';
import { q, tx, audit } from './db.js';
import { rol } from './auth.js';
import { HttpError, mesDe, lunesDe } from './util.js';

export const acomp = Router();
export const sincro = Router();

export const TIPOS_ACTIVIDAD = ['Observación de clase', 'Retroalimentación', 'Taller con docentes', 'Planeación conjunta', 'Revisión de evidencias'];

const acompSchema = z.object({
  id: z.string().uuid(),
  estrategia_id: z.string().uuid({ message: 'Elige la estrategia' }),
  tipo: z.enum(['INDIVIDUAL', 'GRUPAL']),
  fecha: z.string().date('La fecha no es válida'),
  duracion_min: z.coerce.number().int().min(5, 'Duración mínima de 5 minutos').max(600),
  tipo_actividad: z.enum(TIPOS_ACTIVIDAD),
  observaciones: z.string().trim().min(5, 'Escribe las observaciones'),
  compromisos: z.string().trim().min(5, 'Escribe los compromisos acordados'),
  areas_mejora: z.string().trim().optional().nullable(),
  docente_ids: z.array(z.string().uuid()).min(1, 'Elige al menos un docente'),
  registrado_en: z.string().optional(),
}).superRefine((d, ctx) => {
  if (d.tipo === 'INDIVIDUAL' && d.docente_ids.length !== 1)
    ctx.addIssue({ code: 'custom', path: ['docente_ids'], message: 'Un acompañamiento individual lleva un solo docente' });
  if (d.tipo === 'GRUPAL' && d.docente_ids.length < 2)
    ctx.addIssue({ code: 'custom', path: ['docente_ids'], message: 'Un acompañamiento grupal necesita dos o más docentes' });
});

const segSchema = z.object({
  id: z.string().uuid(),
  acompanamiento_id: z.string().uuid(),
  fecha: z.string().date(),
  avance: z.string().trim().min(3, 'Escribe el avance'),
  observaciones: z.string().trim().min(5, 'Escribe las observaciones'),
  registrado_en: z.string().optional(),
});

async function tutorTieneEstrategia(c, user, estrategia_id) {
  if (user.rol !== 'TUTOR_LIDER') return;
  const r = await c.query('SELECT 1 FROM estrategia_tutores WHERE estrategia_id=$1 AND usuario_id=$2', [estrategia_id, user.sub]);
  if (!r.rowCount) throw new HttpError(403, 'Esa estrategia no está asignada a este tutor líder');
}

// RF_003 · reglas compartidas con la sincronización (RF_004)
export async function registrarAcompanamiento(req, datos) {
  const d = acompSchema.parse(datos);
  return tx(async (c) => {
    const ya = await c.query('SELECT * FROM acompanamientos WHERE id=$1', [d.id]);
    if (ya.rowCount) return { existente: true, registro: ya.rows[0] }; // idempotente
    await tutorTieneEstrategia(c, req.user, d.estrategia_id);
    const pert = await c.query(
      'SELECT docente_id FROM estrategia_docentes WHERE estrategia_id=$1 AND docente_id = ANY($2::uuid[])', [d.estrategia_id, d.docente_ids]);
    if (pert.rowCount !== d.docente_ids.length) throw new HttpError(400, 'Algún docente no pertenece a la estrategia elegida');
    const mes = mesDe(d.fecha);
    const dup = await c.query(
      `SELECT dc.nombre FROM acompanamiento_docentes ad JOIN docentes dc ON dc.id=ad.docente_id
       WHERE ad.estrategia_id=$1 AND ad.mes=$2 AND ad.docente_id = ANY($3::uuid[])`, [d.estrategia_id, mes, d.docente_ids]);
    if (dup.rowCount)
      throw new HttpError(409, `Ya existe un acompañamiento de este mes para: ${dup.rows.map((r) => r.nombre).join(', ')}`);
    const r = await c.query(
      `INSERT INTO acompanamientos (id, estrategia_id, tipo, fecha, duracion_min, tipo_actividad, observaciones, compromisos, areas_mejora, creado_por, registrado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now())) RETURNING *`,
      [d.id, d.estrategia_id, d.tipo, d.fecha, d.duracion_min, d.tipo_actividad, d.observaciones, d.compromisos, d.areas_mejora || null, req.user.sub, d.registrado_en || null]);
    for (const dId of d.docente_ids)
      await c.query('INSERT INTO acompanamiento_docentes VALUES ($1,$2,$3,$4)', [d.id, d.estrategia_id, dId, mes]);
    await audit(c, req, 'REGISTRAR', 'acompanamientos', d.id, { tipo: d.tipo, docentes: d.docente_ids.length });
    return { existente: false, registro: r.rows[0] };
  });
}

export async function registrarSeguimiento(req, datos) {
  const d = segSchema.parse(datos);
  return tx(async (c) => {
    const ya = await c.query('SELECT * FROM seguimientos WHERE id=$1', [d.id]);
    if (ya.rowCount) return { existente: true, registro: ya.rows[0] };
    const a = await c.query('SELECT * FROM acompanamientos WHERE id=$1', [d.acompanamiento_id]);
    if (!a.rowCount) throw new HttpError(404, 'El acompañamiento no existe (¿todavía no se sincroniza?)');
    await tutorTieneEstrategia(c, req.user, a.rows[0].estrategia_id);
    const semana = lunesDe(d.fecha);
    if (lunesDe(a.rows[0].fecha instanceof Date ? a.rows[0].fecha.toISOString() : a.rows[0].fecha) > semana)
      throw new HttpError(400, 'El seguimiento no puede ser anterior al acompañamiento');
    const dup = await c.query('SELECT 1 FROM seguimientos WHERE acompanamiento_id=$1 AND semana_inicio=$2', [d.acompanamiento_id, semana]);
    if (dup.rowCount) throw new HttpError(409, 'Ya hay un seguimiento registrado para esa semana');
    const r = await c.query(
      `INSERT INTO seguimientos (id, acompanamiento_id, semana_inicio, avance, observaciones, creado_por, registrado_en)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now())) RETURNING *`,
      [d.id, d.acompanamiento_id, semana, d.avance, d.observaciones, req.user.sub, d.registrado_en || null]);
    await audit(c, req, 'REGISTRAR', 'seguimientos', d.id, { semana });
    return { existente: false, registro: r.rows[0] };
  });
}

acomp.get('/tipos-actividad', (_q, res) => res.json(TIPOS_ACTIVIDAD));

acomp.post('/', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const r = await registrarAcompanamiento(req, req.body);
  res.status(r.existente ? 200 : 201).json(r);
});

acomp.post('/:id/seguimientos', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const r = await registrarSeguimiento(req, { ...req.body, acompanamiento_id: req.params.id });
  res.status(r.existente ? 200 : 201).json(r);
});

// Historial con filtros por fecha, docente y estrategia
acomp.get('/', rol('TUTOR_LIDER', 'TUTOR_DOCENTE', 'COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const { desde, hasta, docente, estrategia } = req.query;
  const p = [], w = [];
  if (req.user.rol === 'TUTOR_LIDER') { p.push(req.user.sub); w.push(`a.estrategia_id IN (SELECT estrategia_id FROM estrategia_tutores WHERE usuario_id=$${p.length})`); }
  else if (req.user.rol === 'TUTOR_DOCENTE') { p.push(req.user.entidad_id); w.push(`a.estrategia_id IN (SELECT id FROM estrategias WHERE entidad_id=$${p.length})`); }
  if (desde) { p.push(desde); w.push(`a.fecha>=$${p.length}`); }
  if (hasta) { p.push(hasta); w.push(`a.fecha<=$${p.length}`); }
  if (estrategia) { p.push(estrategia); w.push(`a.estrategia_id=$${p.length}`); }
  if (docente) { p.push(docente); w.push(`EXISTS (SELECT 1 FROM acompanamiento_docentes x WHERE x.acompanamiento_id=a.id AND x.docente_id=$${p.length})`); }
  const { rows } = await q(
    `SELECT a.id, a.tipo, a.fecha, a.duracion_min, a.tipo_actividad, a.observaciones, a.compromisos, a.areas_mejora,
            a.creado_en, e.nombre AS estrategia, a.estrategia_id,
            (SELECT string_agg(d.nombre, ', ' ORDER BY d.nombre) FROM acompanamiento_docentes ad JOIN docentes d ON d.id=ad.docente_id WHERE ad.acompanamiento_id=a.id) AS docentes,
            (SELECT coalesce(json_agg(json_build_object('id', s.id, 'semana_inicio', s.semana_inicio, 'avance', s.avance, 'observaciones', s.observaciones) ORDER BY s.semana_inicio), '[]'::json)
               FROM seguimientos s WHERE s.acompanamiento_id=a.id) AS seguimientos
     FROM acompanamientos a JOIN estrategias e ON e.id=a.estrategia_id
     ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.fecha DESC, a.creado_en DESC LIMIT 300`, p);
  res.json(rows);
});

// Calendario mensual y semanal: marca los días pendientes de registro
acomp.get('/calendario', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes)) ? String(req.query.mes) : new Date().toISOString().slice(0, 7);
  const ini = `${mes}-01`;
  const { rows } = await q(
    `SELECT a.fecha::text AS fecha, count(*)::int AS acomp FROM acompanamientos a
     WHERE a.fecha >= $2::date AND a.fecha < ($2::date + interval '1 month')
       AND a.estrategia_id IN (SELECT estrategia_id FROM estrategia_tutores WHERE usuario_id=$1) GROUP BY 1`, [req.user.sub, ini]);
  const seg = (await q(
    `SELECT s.semana_inicio::text AS semana, count(*)::int AS n FROM seguimientos s
     JOIN acompanamientos a ON a.id=s.acompanamiento_id
     WHERE s.semana_inicio >= ($2::date - interval '6 days') AND s.semana_inicio < ($2::date + interval '1 month')
       AND a.estrategia_id IN (SELECT estrategia_id FROM estrategia_tutores WHERE usuario_id=$1) GROUP BY 1`, [req.user.sub, ini])).rows;
  const porDia = Object.fromEntries(rows.map((r) => [r.fecha, r.acomp]));
  const segPorSemana = Object.fromEntries(seg.map((r) => [r.semana, r.n]));
  const hoy = new Date().toISOString().slice(0, 10);
  const dias = [];
  const d = new Date(`${ini}T00:00:00Z`);
  while (d.toISOString().slice(0, 7) === mes) {
    const f = d.toISOString().slice(0, 10);
    const finSemana = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const sem = lunesDe(f);
    dias.push({
      fecha: f, acompanamientos: porDia[f] || 0, seguimientos: segPorSemana[sem] || 0,
      pendiente: !finSemana && f <= hoy && !(porDia[f] || 0) && !(segPorSemana[sem] || 0),
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const abiertos = (await q(
    `SELECT a.id, a.fecha::text, e.nombre AS estrategia,
            (SELECT string_agg(d.nombre, ', ') FROM acompanamiento_docentes ad JOIN docentes d ON d.id=ad.docente_id WHERE ad.acompanamiento_id=a.id) AS docentes
     FROM acompanamientos a JOIN estrategias e ON e.id=a.estrategia_id
     WHERE a.fecha >= $2::date AND a.fecha < ($2::date + interval '1 month')
       AND a.estrategia_id IN (SELECT estrategia_id FROM estrategia_tutores WHERE usuario_id=$1) ORDER BY a.fecha`, [req.user.sub, ini])).rows;
  res.json({ mes, dias, acompanamientos: abiertos });
});

// Corrección: tutor líder solo dentro de las 24 h; el Coordinador institucional, siempre
acomp.put('/:id', rol('TUTOR_LIDER', 'COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const d = z.object({
    duracion_min: z.coerce.number().int().min(5).max(600),
    tipo_actividad: z.enum(TIPOS_ACTIVIDAD),
    observaciones: z.string().trim().min(5),
    compromisos: z.string().trim().min(5),
    areas_mejora: z.string().trim().optional().nullable(),
  }).parse(req.body);
  const out = await tx(async (c) => {
    const a = await c.query('SELECT * FROM acompanamientos WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!a.rowCount) throw new HttpError(404, 'El acompañamiento no existe');
    await tutorTieneEstrategia(c, req.user, a.rows[0].estrategia_id);
    if (req.user.rol === 'TUTOR_LIDER' && Date.now() - new Date(a.rows[0].creado_en).getTime() > 24 * 3600 * 1000)
      throw new HttpError(409, 'Pasaron más de 24 horas desde el registro. La corrección debe pedirse al Coordinador institucional.');
    const r = await c.query(
      `UPDATE acompanamientos SET duracion_min=$2, tipo_actividad=$3, observaciones=$4, compromisos=$5, areas_mejora=$6, actualizado_en=now()
       WHERE id=$1 RETURNING *`,
      [req.params.id, d.duracion_min, d.tipo_actividad, d.observaciones, d.compromisos, d.areas_mejora || null]);
    await audit(c, req, 'CORREGIR', 'acompanamientos', req.params.id);
    return r.rows[0];
  });
  res.json(out);
});

// RF_004 · sincronización por lotes de hasta 50 registros, en el orden en que se crearon
sincro.post('/', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const { registros } = z.object({
    registros: z.array(z.object({ clave: z.string(), tipo: z.enum(['ACOMPANAMIENTO', 'SEGUIMIENTO']), datos: z.any() })).max(50),
  }).parse(req.body);
  const resultados = [];
  for (const r of registros) {
    try {
      const out = r.tipo === 'ACOMPANAMIENTO' ? await registrarAcompanamiento(req, r.datos) : await registrarSeguimiento(req, r.datos);
      resultados.push({ clave: r.clave, estado: 'SINCRONIZADO', repetido: out.existente });
    } catch (e) {
      const motivo = e?.issues ? e.issues.map((i) => i.message).join('; ') : e.message;
      resultados.push({ clave: r.clave, estado: 'RECHAZADO', motivo });
    }
  }
  res.json({ resultados });
});
