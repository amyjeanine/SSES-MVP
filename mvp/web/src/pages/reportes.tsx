import { useState } from 'react';
import { api, descargar } from '../api';
import { Aviso, Campo, Graf, hoyISO, useCarga } from '../ui';

export default function Reportes() {
  const [f, setF] = useState({ desde: '', hasta: hoyISO(), estrategia: '' });
  const ests = useCarga(() => api<any[]>('GET', '/estrategias'));
  const q = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString();
  const r = useCarga(() => api<any>('GET', `/reportes/desempeno?${q()}`), [f.desde, f.hasta, f.estrategia]);
  const [msg, setMsg] = useState('');
  const d = r.data;
  const meses: string[] = d ? Array.from(new Set(d.por_tutor.flatMap((t: any) => t.meses.map((m: any) => m.mes)))) as string[] : [];
  return (
    <>
      <h1>Reportes de desempeño</h1>
      <span style={{ color: 'var(--gris)' }}>Qué tanto se está acompañando a los docentes y cómo va el piloto.</span>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="fila">
          <Campo etiqueta="Desde"><input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></Campo>
          <Campo etiqueta="Hasta"><input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></Campo>
          <Campo etiqueta="Estrategia"><select value={f.estrategia} onChange={(e) => setF({ ...f, estrategia: e.target.value })}><option value="">Todas</option>{ests.data?.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
          <div style={{ flex: 0, alignSelf: 'end' }}><button className="btn" onClick={() => descargar('POST', '/reportes/exportar', 'reporte_desempeno.xlsx', { desde: f.desde || undefined, hasta: f.hasta || undefined, estrategia: f.estrategia || undefined }).then(() => setMsg('Archivo de Excel descargado.')).catch((e) => setMsg(e.message))}>Exportar a Excel</button></div>
        </div>
        {msg && <Aviso tipo="info">{msg}</Aviso>}
      </div>
      {r.error && <Aviso tipo="mal">{r.error}</Aviso>}
      {d && <>
        <div className="grid g4" style={{ marginBottom: '1rem' }}>
          <div className="kpi"><b>{d.seguimientos.porcentaje ?? '—'}{d.seguimientos.porcentaje !== null && '%'}</b><span>Seguimientos semanales cumplidos ({d.seguimientos.realizados} de {d.seguimientos.esperados})</span></div>
          <div className="kpi"><b>{d.atendidos.docentes}</b><span>Docentes acompañados</span></div>
          <div className="kpi"><b>{d.atendidos.estudiantes}</b><span>Estudiantes atendidos</span></div>
          <div className="kpi"><b>{d.pilotaje.reduce((a: number, p: any) => a + p.sesiones, 0)}</b><span>Sesiones del piloto registradas</span></div>
        </div>
        <div className="grid g2">
          <div className="card"><h2>Acompañamientos: realizados frente a esperados</h2>
            <Graf etiquetas={d.por_tutor.flatMap((t: any) => meses.map((m) => `${t.tutor.split(' ')[0]} · ${m}`))} series={[
              { nombre: 'Realizados', datos: d.por_tutor.flatMap((t: any) => meses.map((m) => t.meses.find((x: any) => x.mes === m)?.realizados ?? 0)) },
              { nombre: 'Esperados', datos: d.por_tutor.flatMap((t: any) => meses.map((m) => t.meses.find((x: any) => x.mes === m)?.esperados ?? 0)), color: '#c9d6e0' }]} />
          </div>
          <div className="card"><h2>Actividades por estrategia</h2>
            <Graf etiquetas={d.por_estrategia.map((e: any) => e.estrategia.slice(0, 22))} series={[{ nombre: 'Acompañamientos', datos: d.por_estrategia.map((e: any) => e.acompanamientos) }, { nombre: 'Seguimientos', datos: d.por_estrategia.map((e: any) => e.seguimientos), color: '#2f9e8f' }]} />
          </div>
        </div>
        <div className="card scroll"><h2>Sesiones del piloto e incidentes por región</h2>
          <table><thead><tr><th>Región</th><th>Sesiones</th><th>Asistencia</th><th>Valoración</th><th>Incidentes abiertos</th><th>Incidentes resueltos</th></tr></thead>
            <tbody>{d.pilotaje.map((p: any) => <tr key={p.region}><td>{p.region}</td><td>{p.sesiones}</td><td>{p.asistentes} de {p.citados}</td><td>{p.valoracion_promedio} / 5</td><td>{p.incidentes_abiertos}</td><td>{p.incidentes_resueltos}</td></tr>)}
              {!d.pilotaje.length && <tr><td colSpan={6} className="vacio">Aún no hay sesiones registradas.</td></tr>}</tbody></table>
        </div>
      </>}
    </>
  );
}
