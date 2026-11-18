import { useState } from 'react';
import { api, descargar } from '../api';
import { Aviso, Campo, Tabs, mesISO, useCarga } from '../ui';

export default function Control() {
  const [tab, setTab] = useState('resumen');
  return (
    <>
      <h1>Reportes de control y de ley</h1>
      <span style={{ color: 'var(--gris)' }}>Consulta de solo lectura. Cada consulta y descarga queda registrada en la bitácora.</span>
      <div style={{ height: '.8rem' }} />
      <Tabs actual={tab} onCambio={setTab} tabs={[['resumen', 'Resumen del piloto'], ['ley', 'Reportes de ley'], ['bitacora', 'Bitácora de accesos']]} />
      {tab === 'resumen' && <Resumen />}{tab === 'ley' && <Ley />}{tab === 'bitacora' && <Bitacora />}
    </>
  );
}
function Resumen() {
  const r = useCarga(() => api<any>('GET', '/control/reportes'));
  const s = r.data?.resumen;
  return <>{r.error && <Aviso tipo="mal">{r.error}</Aviso>}{s && <div className="grid g4">
    {[['estrategias', 'Estrategias creadas'], ['con_estudiantes', 'Con estudiantes vinculados'], ['estudiantes_vinculados', 'Estudiantes vinculados'], ['acompanamientos', 'Acompañamientos'], ['seguimientos', 'Seguimientos semanales'], ['sesiones', 'Sesiones del piloto'], ['incidentes_abiertos', 'Incidentes abiertos']].map(([k, t]) => <div className="kpi" key={k}><b>{s[k]}</b><span>{t}</span></div>)}</div>}</>;
}
function Ley() {
  const [tipo, setTipo] = useState('estrategias-vigentes'); const [periodo, setPeriodo] = useState(mesISO());
  const r = useCarga(() => api<any>('GET', `/control/reportes-ley/${tipo}?periodo=${periodo}`), [tipo, periodo]);
  const d = r.data;
  return (
    <div className="card">
      <div className="fila">
        <Campo etiqueta="Reporte"><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="estrategias-vigentes">Estrategias estudiantiles vigentes por entidad</option><option value="cobertura-docentes">Docentes acompañados frente a docentes asignados</option><option value="participacion-estudiantes">Estudiantes vinculados por estrategia</option></select></Campo>
        <Campo etiqueta="Periodo"><input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></Campo>
        <div style={{ flex: 0, alignSelf: 'end' }}><button className="btn" onClick={() => descargar('GET', `/control/reportes-ley/${tipo}?periodo=${periodo}&formato=xlsx`, `${tipo}_${periodo}.xlsx`)}>Descargar Excel</button></div>
      </div>
      {r.error && <Aviso tipo="mal">{r.error}</Aviso>}
      {d && <><p style={{ color: 'var(--gris)' }}>{d.titulo} · formato versión {d.version_plantilla} · {d.periodo}</p>
        <div className="scroll"><table><thead><tr>{d.columnas.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>{d.filas.map((f: any[], i: number) => <tr key={i}>{f.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody></table></div></>}
    </div>
  );
}
function Bitacora() {
  const r = useCarga(() => api<any[]>('GET', '/control/bitacora'));
  return <div className="card scroll"><table><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Sobre</th></tr></thead><tbody>
    {r.data?.map((b) => <tr key={b.id}><td>{new Date(b.fecha).toLocaleString('es-CO')}</td><td>{b.usuario || '—'}</td><td>{b.rol}</td><td>{b.accion}</td><td>{b.objeto}</td></tr>)}</tbody></table></div>;
}
