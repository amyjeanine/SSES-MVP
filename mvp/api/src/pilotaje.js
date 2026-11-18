import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { q, tx, audit } from './db.js';
import { rol } from './auth.js';
import { HttpError } from './util.js';

export const pilotaje = Router();
export const instrumentos = Router();

// ---------- RF_008 · sesiones del piloto e incidentes ----------
const sesionSchema = z.object({
  fecha: z.string().date(),
  region: z.string().trim().min(2, 'Elige la región'),
  citados: z.coerce.number().int().min(0),
  asistentes: z.coerce.number().int().min(0),
  valoracion: z.coerce.number().int().min(1, 'La valoración va de 1 a 5').max(5, 'La valoración va de 1 a 5'),
  observaciones: z.string().trim().optional().nullable(),
}).refine((d) => d.asistentes <= d.citados, { message: 'Los asistentes no pueden superar a los citados', path: ['asistentes'] });

pilotaje.get('/sesiones', async (_req, res) => {
  const { rows } = await q(
    `SELECT s.*, s.fecha::text AS fecha,
        coalesce((SELECT json_agg(json_build_object('id', i.id, 'tipo', i.tipo, 'hora', to_char(i.hora,'HH24:MI'), 'descripcion', i.descripcion,
                  'estado', i.estado, 'solucion', i.solucion) ORDER BY i.hora) FROM incidentes i WHERE i.sesion_id=s.id), '[]'::json) AS incidentes
     FROM sesiones_piloto s ORDER BY s.fecha DESC, s.region`);
  res.json(rows);
});

pilotaje.post('/sesiones', rol('COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const d = sesionSchema.parse(req.body);
  const out = await tx(async (c) => {
    const dup = await c.query('SELECT 1 FROM sesiones_piloto WHERE region=$1 AND fecha=$2', [d.region, d.fecha]);
    if (dup.rowCount) throw new HttpError(409, 'Ya existe una sesión de esa región en esa fecha');
    const r = await c.query(
      `INSERT INTO sesiones_piloto (fecha, region, citados, asistentes, valoracion, observaciones, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.fecha, d.region, d.citados, d.asistentes, d.valoracion, d.observaciones || null, req.user.sub]);
    await audit(c, req, 'REGISTRAR', 'sesiones_piloto', r.rows[0].id, { region: d.region });
    return r.rows[0];
  });
  res.status(201).json(out);
});

pilotaje.post('/sesiones/:id/incidentes', rol('COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const d = z.object({
    tipo: z.enum(['CONECTIVIDAD', 'RENDIMIENTO', 'ACCESO', 'OTRO']),
    hora: z.string().regex(/^\d{2}:\d{2}/, 'Escribe la hora (HH:MM)'),
    descripcion: z.string().trim().min(5, 'Describe lo que ocurrió'),
  }).parse(req.body);
  const out = await tx(async (c) => {
    const s = await c.query('SELECT 1 FROM sesiones_piloto WHERE id=$1', [req.params.id]);
    if (!s.rowCount) throw new HttpError(404, 'La sesión no existe');
    const r = await c.query(
      `INSERT INTO incidentes (sesion_id, tipo, hora, descripcion, creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, d.tipo, d.hora, d.descripcion, req.user.sub]);
    await audit(c, req, 'REGISTRAR_INCIDENTE', 'incidentes', r.rows[0].id, { tipo: d.tipo });
    return r.rows[0];
  });
  res.status(201).json(out);
});

pilotaje.put('/incidentes/:id/resolver', rol('COORDINADOR_INSTITUCIONAL'), async (req, res) => {
  const { solucion } = z.object({ solucion: z.string().trim().min(5, 'Escribe la solución aplicada') }).parse(req.body);
  const out = await tx(async (c) => {
    const r = await c.query(
      `UPDATE incidentes SET estado='RESUELTO', solucion=$2, resuelto_en=now() WHERE id=$1 AND estado='ABIERTO' RETURNING *`,
      [req.params.id, solucion]);
    if (!r.rowCount) throw new HttpError(404, 'El incidente no existe o ya estaba resuelto');
    await audit(c, req, 'RESOLVER_INCIDENTE', 'incidentes', req.params.id);
    return r.rows[0];
  });
  res.json(out);
});

pilotaje.get('/consolidado', rol('COORDINADOR_INSTITUCIONAL', 'ENTE_CONTROL'), async (_req, res) => {
  res.json(await consolidadoPilotaje());
});
export async function consolidadoPilotaje() {
  const { rows } = await q(
    `SELECT s.region, count(DISTINCT s.id)::int AS sesiones, sum(s.citados)::int AS citados, sum(s.asistentes)::int AS asistentes,
            round(avg(s.valoracion)::numeric, 2)::float AS valoracion_promedio,
            count(i.id) FILTER (WHERE i.estado='ABIERTO')::int AS incidentes_abiertos,
            count(i.id) FILTER (WHERE i.estado='RESUELTO')::int AS incidentes_resueltos
     FROM sesiones_piloto s LEFT JOIN incidentes i ON i.sesion_id=s.id GROUP BY s.region ORDER BY s.region`);
  return rows;
}

// ---------- RF_007 · instrumento de percepción ----------
async function vigente() {
  const i = (await q('SELECT * FROM instrumentos WHERE vigente ORDER BY version DESC LIMIT 1')).rows[0];
  if (!i) throw new HttpError(404, 'No hay un instrumento vigente');
  i.preguntas = (await q('SELECT id, orden, eje, texto, tipo, obligatoria FROM instrumento_preguntas WHERE instrumento_id=$1 ORDER BY orden', [i.id])).rows;
  return i;
}

instrumentos.get('/vigente', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const i = await vigente();
  const sesion = req.query.sesion || null;
  const mia = (await q(
    `SELECT estado, respuestas FROM respuestas_instrumento WHERE usuario_id=$1 AND instrumento_id=$2
     AND COALESCE(sesion_id,'00000000-0000-0000-0000-000000000000') = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000')`,
    [req.user.sub, i.id, sesion])).rows[0];
  res.json({ ...i, mia: mia || null });
});

const respSchema = z.object({ sesion_id: z.string().uuid().optional().nullable(), respuestas: z.record(z.string(), z.union([z.string(), z.number()])) });

instrumentos.put('/respuestas/borrador', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const d = respSchema.parse(req.body);
  const i = await vigente();
  const r = await q(
    `INSERT INTO respuestas_instrumento (instrumento_id, usuario_id, sesion_id, estado, respuestas)
     VALUES ($1,$2,$3,'BORRADOR',$4)
     ON CONFLICT (usuario_id, instrumento_id, COALESCE(sesion_id,'00000000-0000-0000-0000-000000000000'))
     DO UPDATE SET respuestas=EXCLUDED.respuestas, actualizado_en=now() WHERE respuestas_instrumento.estado='BORRADOR' RETURNING id`,
    [i.id, req.user.sub, d.sesion_id || null, d.respuestas]);
  if (!r.rowCount) throw new HttpError(409, 'Ya enviaste el instrumento de esta sesión');
  res.json({ ok: true });
});

instrumentos.post('/respuestas', rol('TUTOR_LIDER', 'TUTOR_DOCENTE'), async (req, res) => {
  const d = respSchema.parse(req.body);
  const i = await vigente();
  const faltan = i.preguntas.filter((p) => p.obligatoria && (d.respuestas[p.id] === undefined || String(d.respuestas[p.id]).trim() === ''));
  if (faltan.length) throw new HttpError(400, `Faltan ${faltan.length} pregunta(s) obligatoria(s) por responder`, { faltan: faltan.map((p) => p.id) });
  for (const p of i.preguntas.filter((x) => x.tipo === 'ESCALA' && d.respuestas[x.id] !== undefined)) {
    const v = Number(d.respuestas[p.id]);
    if (!(v >= 1 && v <= 5)) throw new HttpError(400, 'Las respuestas de escala van de 1 a 5');
  }
  const out = await tx(async (c) => {
    const ya = await c.query(
      `SELECT estado FROM respuestas_instrumento WHERE usuario_id=$1 AND instrumento_id=$2
       AND COALESCE(sesion_id,'00000000-0000-0000-0000-000000000000') = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000') FOR UPDATE`,
      [req.user.sub, i.id, d.sesion_id || null]);
    if (ya.rows[0]?.estado === 'ENVIADO') throw new HttpError(409, 'Ya enviaste el instrumento de esta sesión');
    if (ya.rowCount)
      await c.query(
        `UPDATE respuestas_instrumento SET estado='ENVIADO', respuestas=$4, actualizado_en=now() WHERE usuario_id=$1 AND instrumento_id=$2
         AND COALESCE(sesion_id,'00000000-0000-0000-0000-000000000000') = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000')`,
        [req.user.sub, i.id, d.sesion_id || null, d.respuestas]);
    else
      await c.query(`INSERT INTO respuestas_instrumento (instrumento_id, usuario_id, sesion_id, estado, respuestas) VALUES ($1,$2,$3,'ENVIADO',$4)`,
        [i.id, req.user.sub, d.sesion_id || null, d.respuestas]);
    await audit(c, req, 'ENVIAR_INSTRUMENTO', 'respuestas_instrumento', i.id);
    return { ok: true };
  });
  res.status(201).json(out);
});

export async function consolidadoInstrumento() {
  const i = await vigente();
  const resp = (await q(`SELECT respuestas FROM respuestas_instrumento WHERE instrumento_id=$1 AND estado='ENVIADO'`, [i.id])).rows;
  const preguntas = i.preguntas.map((p) => {
    const vals = resp.map((r) => r.respuestas[p.id]).filter((v) => v !== undefined && String(v).trim() !== '');
    if (p.tipo === 'ESCALA') {
      const nums = vals.map(Number);
      const dist = [1, 2, 3, 4, 5].map((n) => nums.filter((x) => x === n).length);
      return { ...p, n: nums.length, promedio: nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : null, distribucion: dist };
    }
    return { ...p, n: vals.length, comentarios: vals.map(String) };
  });
  const ejes = {};
  for (const p of preguntas.filter((x) => x.tipo === 'ESCALA' && x.promedio !== null)) (ejes[p.eje] ||= []).push(p.promedio);
  const promedios_por_eje = Object.entries(ejes).map(([eje, v]) => ({ eje, promedio: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) }));
  return { instrumento: { id: i.id, titulo: i.titulo, version: i.version }, enviados: resp.length, promedios_por_eje, preguntas };
}

instrumentos.get('/consolidado', rol('COORDINADOR_INSTITUCIONAL', 'ENTE_CONTROL'), async (_req, res) => {
  res.json(await consolidadoInstrumento());
});

instrumentos.get('/consolidado.xlsx', rol('COORDINADOR_INSTITUCIONAL', 'ENTE_CONTROL'), async (req, res) => {
  const c = await consolidadoInstrumento();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Percepción');
  ws.columns = [{ header: 'Eje', width: 22 }, { header: 'Pregunta', width: 70 }, { header: 'Respuestas', width: 12 }, { header: 'Promedio (1-5)', width: 16 }];
  c.preguntas.filter((p) => p.tipo === 'ESCALA').forEach((p) => ws.addRow([p.eje, p.texto, p.n, p.promedio]));
  const wc = wb.addWorksheet('Comentarios');
  wc.columns = [{ header: 'Pregunta', width: 60 }, { header: 'Comentario', width: 90 }];
  c.preguntas.filter((p) => p.tipo === 'TEXTO').forEach((p) => p.comentarios.forEach((t) => wc.addRow([p.texto, t])));
  ws.getRow(1).font = { bold: true }; wc.getRow(1).font = { bold: true };
  await audit(null, req, 'DESCARGAR', 'instrumento_consolidado', null);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="percepcion_tutores.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});
