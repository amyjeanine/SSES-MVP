import { descargar } from '../api';
import { api } from '../api';
import { Aviso, Graf, useCarga } from '../ui';

const EJES: Record<string, string> = { FUNCIONALIDAD: 'Funcionalidad', FACILIDAD_DE_USO: 'Facilidad de uso', COMPORTAMIENTO: 'Comportamiento real' };

export default function Percepcion() {
  const c = useCarga(() => api<any>('GET', '/instrumentos/consolidado'));
  const d = c.data;
  return (
    <>
      <div className="fila" style={{ alignItems: 'center' }}>
        <div><h1>Percepción de los tutores</h1><span style={{ color: 'var(--gris)' }}>Resultados del instrumento: funcionalidad, facilidad de uso y comportamiento en condiciones reales.</span></div>
        <div style={{ flex: 0, textAlign: 'right' }}><button className="btn" onClick={() => descargar('GET', '/instrumentos/consolidado.xlsx', 'percepcion_tutores.xlsx')}>Exportar a Excel</button></div>
      </div>
      {c.error && <Aviso tipo="mal">{c.error}</Aviso>}
      {d && <>
        <div className="grid g3" style={{ margin: '1rem 0' }}>
          <div className="kpi"><b>{d.enviados}</b><span>Instrumentos enviados</span></div>
          {d.promedios_por_eje.map((e: any) => <div className="kpi" key={e.eje}><b>{e.promedio} / 5</b><span>{EJES[e.eje]}</span></div>)}
        </div>
        {d.enviados === 0 ? <div className="card vacio">Todavía no hay respuestas enviadas.</div> : <>
          <div className="card"><h2>Promedio por pregunta (1 a 5)</h2>
            <Graf tipo="bar" alto={300} etiquetas={d.preguntas.filter((p: any) => p.tipo === 'ESCALA').map((p: any) => p.texto.slice(0, 38) + '…')} series={[{ nombre: 'Promedio', datos: d.preguntas.filter((p: any) => p.tipo === 'ESCALA').map((p: any) => p.promedio ?? 0) }]} />
          </div>
          <div className="card"><h2>Comentarios de los tutores</h2>
            {d.preguntas.filter((p: any) => p.tipo === 'TEXTO').map((p: any) => <div key={p.id}><h3>{p.texto}</h3>{p.comentarios.length ? <ul>{p.comentarios.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul> : <div className="vacio">Sin comentarios.</div>}</div>)}
          </div>
        </>}
      </>}
    </>
  );
}
