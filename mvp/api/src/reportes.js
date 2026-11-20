import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q, audit } from './db.js';
import { rol } from './auth.js';
import { HttpError, lunesDe } from './util.js';
import { consolidadoPilotaje } from './pilotaje.js';

export const reportes = Router();
export const control = Router();

// ---------- RF_005 · reportes de desempeño ----------
// entidad_id: uuid | null — cuando es uuid, filtra solo la institución del RECTOR/COORDINADOR
export async function desempeno({ desde, hasta, estrategia }, entidad_id = null) {
  const hoy = new Date().toISOString().slice(0, 10);
  desde = desde || new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  hasta = hasta || hoy;
  const p = [desde, hasta];
  let filtroE = '';
  let filtroEnt = '';
  // Scoping por entidad (RECTOR / COORDINADOR_INSTITUCIONAL ven solo su institución)
  if (entidad_id) { p.push(entidad_id); filtroEnt = ` AND e.entidad_id=$${p.length}`; }
  if (estrategia) { p.push(estrategia); filtroE = ` AND a.estrategia_id=$${p.length}`; }

  const acomp = (await q(
    `SELECT a.id, a.fecha::text AS fecha, a.creado_por, u.nombre AS tutor, a.estrategia_id, e.nombre AS estrategia,
            to_char(a.fecha,'YYYY-MM') AS mes,
            (SELECT count(*)::int FROM seguimientos s WHERE s.acompanamiento_id=a.id) AS seguimientos
     FROM acompanamientos a JOIN usuarios u ON u.id=a.creado_por JOIN estrategias e ON e.id=a.estrategia_id
     WHERE a.fecha BETWEEN $1 AND $2${filtroEnt}${filtroE}`, p)).rows;

  // Esperados: un acompañamiento por docente asignado a cada estrategia del tutor, por mes del periodo
  const meses = [];
  const d = new Date(`${desde.slice(0, 7)}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= hasta) { meses.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  const asigParams = [];
  let asigWhere = '';
  if (entidad_id) { asigParams.push(entidad_id); asigWhere += ` AND t.estrategia_id IN (SELECT id FROM estrategias WHERE entidad_id=$${asigParams.length})`; }
  if (estrategia) { asigParams.push(estrategia); asigWhere += ` AND t.estrategia_id=$${asigParams.length}`; }
  const asig = (await q(
    `SELECT t.usuario_id, u.nombre AS tutor, count(ed.docente_id)::int AS docentes FROM estrategia_tutores t
     JOIN usuarios u ON u.id=t.usuario_id JOIN estrategia_docentes ed ON ed.estrategia_id=t.estrategia_id
     WHERE 1=1${asigWhere} GROUP BY t.usuario_id, u.nombre`, asigParams)).rows;
  const porTutorMes = asig.map((t) => ({
    tutor: t.tutor,
    meses: meses.map((m) => ({ mes: m, realizados: acomp.filter((a) => a.creado_por === t.usuario_id && a.mes === m).length, esperados: t.docentes })),
  }));

  // Seguimientos semanales cumplidos
  let esperadosSeg = 0, hechosSeg = 0;
  const lunesHoy = lunesDe(hoy);
  for (const a of acomp) {
    const ini = lunesDe(a.fecha);
    const finMes = new Date(`${a.mes}-01T00:00:00Z`); finMes.setUTCMonth(finMes.getUTCMonth() + 1); finMes.setUTCDate(0);
    const tope = [lunesDe(finMes.toISOString().slice(0, 10)), lunesHoy].sort()[0];
    const semanas = Math.max(0, Math.round((new Date(tope) - new Date(ini)) / (7 * 86400000)) + 1);
    esperadosSeg += semanas; hechosSeg += Math.min(a.seguimientos, semanas);
  }

  // filtroEnt usa alias "e" (JOIN estrategias e); en la subquery interna no hay ese alias,
  // así que usamos una variante que filtra por estrategia_id subselect
  const filtroEntSub = entidad_id ? ` AND a2.estrategia_id IN (SELECT id FROM estrategias WHERE entidad_id=$3)` : '';
  const atendidos = (await q(
    `SELECT count(DISTINCT ad.docente_id)::int AS docentes,
            (SELECT count(DISTINCT ee.estudiante_id)::int FROM estrategia_estudiantes ee WHERE ee.estrategia_id IN
               (SELECT a2.estrategia_id FROM acompanamientos a2 WHERE a2.fecha BETWEEN $1 AND $2${filtroEntSub})) AS estudiantes
     FROM acompanamiento_docentes ad JOIN acompanamientos a ON a.id=ad.acompanamiento_id
     JOIN estrategias e ON e.id=a.estrategia_id
     WHERE a.fecha BETWEEN $1 AND $2${filtroEnt}${filtroE}`, p)).rows[0];

  const entFiltroEstr = entidad_id ? ` AND e.entidad_id=$3` : '';
  const porEstrategia = (await q(
    `SELECT e.nombre AS estrategia, count(DISTINCT a.id)::int AS acompanamientos, count(s.id)::int AS seguimientos
     FROM estrategias e LEFT JOIN acompanamientos a ON a.estrategia_id=e.id AND a.fecha BETWEEN $1 AND $2
     LEFT JOIN seguimientos s ON s.acompanamiento_id=a.id
     ${estrategia ? `WHERE e.id=$${entidad_id ? '4' : '3'}` : (entidad_id ? 'WHERE e.entidad_id=$3' : '')}
     GROUP BY e.nombre ORDER BY e.nombre`,
    estrategia && entidad_id ? [desde, hasta, entidad_id, estrategia]
      : estrategia ? [desde, hasta, estrategia]
      : entidad_id ? [desde, hasta, entidad_id]
      : [desde, hasta])).rows;

  return {
    periodo: { desde, hasta },
    por_tutor: porTutorMes,
    seguimientos: { esperados: esperadosSeg, realizados: hechosSeg, porcentaje: esperadosSeg ? Math.round((hechosSeg / esperadosSeg) * 100) : null },
    atendidos,
    por_estrategia: porEstrategia,
    pilotaje: await consolidadoPilotaje(),
  };
}

const scopedRoles = ['RECTOR', 'COORDINADOR_INSTITUCIONAL'];

reportes.get('/desempeno', rol('COORDINADOR_INSTITUCIONAL', 'RECTOR'), async (req, res) => {
  const entidad_id = scopedRoles.includes(req.user.rol) ? req.user.entidad_id : null;
  await audit(null, req, 'CONSULTAR', 'reporte_desempeno', null);
  res.json(await desempeno(req.query, entidad_id));
});

reportes.post('/exportar', rol('COORDINADOR_INSTITUCIONAL', 'RECTOR'), async (req, res) => {
  const entidad_id = scopedRoles.includes(req.user.rol) ? req.user.entidad_id : null;
  const r = await desempeno(req.body || {}, entidad_id);
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('Acompañamientos por tutor');
  a.columns = [{ header: 'Tutor líder', width: 30 }, { header: 'Mes', width: 12 }, { header: 'Realizados', width: 14 }, { header: 'Esperados', width: 14 }];
  r.por_tutor.forEach((t) => t.meses.forEach((m) => a.addRow([t.tutor, m.mes, m.realizados, m.esperados])));
  const b = wb.addWorksheet('Actividades por estrategia');
  b.columns = [{ header: 'Estrategia', width: 50 }, { header: 'Acompañamientos', width: 18 }, { header: 'Seguimientos', width: 16 }];
  r.por_estrategia.forEach((e) => b.addRow([e.estrategia, e.acompanamientos, e.seguimientos]));
  const c = wb.addWorksheet('Sesiones del piloto por región');
  c.columns = [{ header: 'Región', width: 20 }, { header: 'Sesiones', width: 10 }, { header: 'Citados', width: 10 }, { header: 'Asistentes', width: 12 }, { header: 'Valoración prom.', width: 16 }, { header: 'Incidentes abiertos', width: 18 }, { header: 'Incidentes resueltos', width: 18 }];
  r.pilotaje.forEach((p) => c.addRow([p.region, p.sesiones, p.citados, p.asistentes, p.valoracion_promedio, p.incidentes_abiertos, p.incidentes_resueltos]));
  const s = wb.addWorksheet('Resumen');
  s.addRows([['Periodo', `${r.periodo.desde} a ${r.periodo.hasta}`], ['Seguimientos semanales cumplidos (%)', r.seguimientos.porcentaje],
    ['Docentes atendidos', r.atendidos.docentes], ['Estudiantes atendidos', r.atendidos.estudiantes]]);
  s.getColumn(1).width = 40;
  [a, b, c].forEach((w) => (w.getRow(1).font = { bold: true }));
  await audit(null, req, 'DESCARGAR', 'reporte_desempeno', null);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="reporte_desempeno.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// ---------- RF_006 · reportes de control y de ley (solo lectura) ----------
// LEY queries accept ($1=periodo, [$2=entidad_id when scoped])
const LEY = {
  'estrategias-vigentes': {
    columnas: ['Entidad', 'Región', 'Estrategia', 'Inicio', 'Fin', 'Estado', 'Estudiantes en estrategia', 'Total estudiantes institución'],
    sql: (scoped) => `SELECT en.nombre, en.region, e.nombre, e.fecha_inicio::text, e.fecha_fin::text, e.estado,
                 (SELECT count(*) FROM estrategia_estudiantes x WHERE x.estrategia_id=e.id)::int,
                 (SELECT count(*) FROM estudiantes es WHERE es.entidad_id=en.id)::int
          FROM estrategias e JOIN entidades en ON en.id=e.entidad_id
          WHERE e.fecha_inicio <= ($1::date + interval '1 month') AND e.fecha_fin >= $1::date
          ${scoped ? 'AND e.entidad_id=$2' : ''} ORDER BY en.nombre, e.nombre`,
  },
  'cobertura-docentes': {
    columnas: ['Estrategia', 'Docentes asignados', 'Docentes acompañados en el mes', 'Cobertura (%)'],
    sql: (scoped) => `SELECT e.nombre,
                 (SELECT count(*) FROM estrategia_docentes x WHERE x.estrategia_id=e.id)::int,
                 (SELECT count(*) FROM acompanamiento_docentes ad WHERE ad.estrategia_id=e.id AND ad.mes=$1::date)::int,
                 CASE WHEN (SELECT count(*) FROM estrategia_docentes x WHERE x.estrategia_id=e.id)=0 THEN 0
                      ELSE round(100.0*(SELECT count(*) FROM acompanamiento_docentes ad WHERE ad.estrategia_id=e.id AND ad.mes=$1::date)
                           / (SELECT count(*) FROM estrategia_docentes x WHERE x.estrategia_id=e.id))::int END
          FROM estrategias e ${scoped ? 'WHERE e.entidad_id=$2' : ''} ORDER BY e.nombre`,
  },
  'participacion-estudiantes': {
    columnas: ['Estrategia', 'Entidad', 'Estudiantes vinculados'],
    sql: (scoped) => `SELECT e.nombre, en.nombre, (SELECT count(*) FROM estrategia_estudiantes x WHERE x.estrategia_id=e.id)::int
          FROM estrategias e JOIN entidades en ON en.id=e.entidad_id
          WHERE $1::date IS NOT NULL ${scoped ? 'AND e.entidad_id=$2' : ''} ORDER BY e.nombre`,
  },
};

control.use(rol('ENTE_CONTROL', 'COORDINADOR_INSTITUCIONAL', 'RECTOR'));

control.get('/reportes', async (req, res) => {
  const scopedRoles = ['RECTOR', 'COORDINADOR_INSTITUCIONAL'];
  const isScoped = scopedRoles.includes(req.user.rol);
  const eid = req.user.entidad_id;
  const entFiltro = isScoped ? `AND entidad_id=$1` : '';
  const entFiltroEst = isScoped
    ? `AND estrategia_id IN (SELECT id FROM estrategias WHERE entidad_id=$1)`
    : '';
  const params = isScoped ? [eid] : [];

  const r = (await q(
    `SELECT (SELECT count(*) FROM estrategias WHERE 1=1 ${entFiltro})::int AS estrategias,
            (SELECT count(*) FROM estrategias WHERE estado='CON_ESTUDIANTES' ${entFiltro})::int AS con_estudiantes,
            (SELECT count(DISTINCT estudiante_id) FROM estrategia_estudiantes WHERE 1=1 ${entFiltroEst})::int AS estudiantes_vinculados,
            (SELECT count(*) FROM acompanamientos WHERE estrategia_id IN (SELECT id FROM estrategias WHERE 1=1 ${entFiltro}))::int AS acompanamientos,
            (SELECT count(*) FROM seguimientos WHERE acompanamiento_id IN (SELECT id FROM acompanamientos WHERE estrategia_id IN (SELECT id FROM estrategias WHERE 1=1 ${entFiltro})))::int AS seguimientos,
            (SELECT count(*) FROM sesiones_piloto)::int AS sesiones,
            (SELECT count(*) FROM incidentes WHERE estado='ABIERTO')::int AS incidentes_abiertos`,
    params)).rows[0];
  const plantillas = (await q('SELECT tipo, version, titulo FROM plantillas_ley WHERE vigente ORDER BY tipo')).rows;
  await audit(null, req, 'CONSULTAR', 'reportes_control', null);
  res.json({ resumen: r, plantillas });
});

control.get('/reportes-ley/:tipo', async (req, res) => {
  const t = LEY[req.params.tipo];
  const pl = (await q('SELECT * FROM plantillas_ley WHERE tipo=$1 AND vigente ORDER BY version DESC LIMIT 1', [req.params.tipo])).rows[0];
  if (!t || !pl) throw new HttpError(404, 'Ese reporte de ley no existe');
  const periodo = /^\d{4}-\d{2}$/.test(String(req.query.periodo)) ? `${req.query.periodo}-01` : new Date().toISOString().slice(0, 7) + '-01';
  const scopedRoles = ['RECTOR', 'COORDINADOR_INSTITUCIONAL'];
  const isScoped = scopedRoles.includes(req.user.rol);
  const values = isScoped ? [periodo, req.user.entidad_id] : [periodo];
  const data = (await q({ text: t.sql(isScoped), values, rowMode: 'array' })).rows;
  await audit(null, req, req.query.formato === 'xlsx' ? 'DESCARGAR' : 'CONSULTAR', 'reporte_ley', req.params.tipo, { periodo });
  if (req.query.formato === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(pl.titulo.slice(0, 30));
    ws.addRow(t.columnas).font = { bold: true };
    data.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c) => (c.width = 28));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.tipo}_${periodo.slice(0, 7)}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  res.json({ tipo: req.params.tipo, titulo: pl.titulo, version_plantilla: pl.version, periodo: periodo.slice(0, 7), columnas: t.columnas, filas: data });
});

control.get('/bitacora', async (_req, res) => {
  const { rows } = await q(
    `SELECT a.id, a.fecha, a.accion, a.objeto, a.rol, u.nombre AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id
     ORDER BY a.id DESC LIMIT 60`);
  res.json(rows);
});
