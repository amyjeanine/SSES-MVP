import { useEffect, useState } from 'react';
import { api } from '../api';
import { Aviso, Campo, Modal, fmtFecha, hoyISO, textoEstado, useCarga } from '../ui';

const vacia = { nombre: '', descripcion: '', entidad_id: '', fecha_inicio: hoyISO(), fecha_fin: '', tutor_lider_id: '' };

export default function Estrategias() {
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<any | null>(null);
  const lista = useCarga(() => api<any[]>('GET', '/estrategias'));
  if (sel) return <Detalle id={sel} onVolver={() => { setSel(null); lista.recargar(); }} />;
  return (
    <>
      <div className="fila" style={{ alignItems: 'center', marginBottom: '.8rem' }}>
        <div><h1>Estrategias estudiantiles</h1><span style={{ color: 'var(--gris)' }}>Crea estrategias y asóciales los estudiantes precargados.</span></div>
        <div style={{ flex: 0, textAlign: 'right' }}><button className="btn" onClick={() => setForm({ ...vacia })}>+ Nueva estrategia</button></div>
      </div>
      {lista.error && <Aviso tipo="mal">{lista.error}</Aviso>}
      <div className="card scroll">
        <table>
          <thead><tr><th>Estrategia</th><th>Entidad</th><th>Vigencia</th><th>Estudiantes</th><th>Estado</th></tr></thead>
          <tbody>
            {lista.data?.map((e) => (
              <tr key={e.id} className="click" onClick={() => setSel(e.id)}>
                <td><b>{e.nombre}</b><div style={{ color: 'var(--gris)', fontSize: '.82rem' }}>Tutor líder: {e.tutores || '— sin asignar'}</div></td>
                <td>{e.entidad}<div style={{ color: 'var(--gris)', fontSize: '.82rem' }}>{e.region}</div></td>
                <td>{fmtFecha(e.fecha_inicio)} – {fmtFecha(e.fecha_fin)}</td>
                <td>{e.n_estudiantes}</td>
                <td><span className={`pill ${e.estado === 'CON_ESTUDIANTES' ? 'verde' : 'amar'}`}>{textoEstado(e.estado)}</span></td>
              </tr>
            ))}
            {!lista.data?.length && !lista.cargando && <tr><td colSpan={5} className="vacio">Todavía no hay estrategias.</td></tr>}
          </tbody>
        </table>
      </div>
      {form && <FormEstrategia inicial={form} onCerrar={() => setForm(null)} onGuardada={() => { setForm(null); lista.recargar(); }} />}
    </>
  );
}

function FormEstrategia({ inicial, onCerrar, onGuardada }: { inicial: any; onCerrar: () => void; onGuardada: () => void }) {
  const [f, setF] = useState(inicial);
  const [error, setError] = useState(''); const [guardando, setGuardando] = useState(false);
  const ents = useCarga(() => api<any[]>('GET', '/entidades'));
  const tutores = useCarga(() => api<any[]>('GET', '/tutores-lider'));
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setGuardando(true);
    try {
      const cuerpo = { ...f, tutor_lider_id: f.tutor_lider_id || null };
      f.id ? await api('PUT', `/estrategias/${f.id}`, cuerpo) : await api('POST', '/estrategias', cuerpo);
      onGuardada();
    } catch (err: any) { setError(err.message); }
    setGuardando(false);
  };
  return (
    <Modal titulo={f.id ? 'Editar estrategia' : 'Nueva estrategia estudiantil'} onCerrar={onCerrar}>
      <form onSubmit={guardar}>
        <Campo etiqueta="Nombre (máx. 150 caracteres)"><input value={f.nombre} maxLength={150} onChange={(e) => set('nombre', e.target.value)} required /></Campo>
        <Campo etiqueta="Descripción (máx. 1.000 caracteres)"><textarea value={f.descripcion} maxLength={1000} onChange={(e) => set('descripcion', e.target.value)} required /></Campo>
        <Campo etiqueta="Entidad"><select value={f.entidad_id} onChange={(e) => set('entidad_id', e.target.value)} required><option value="">Elige una entidad…</option>{ents.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.region})</option>)}</select></Campo>
        <div className="fila">
          <Campo etiqueta="Fecha inicial"><input type="date" value={f.fecha_inicio?.slice(0, 10)} onChange={(e) => set('fecha_inicio', e.target.value)} required /></Campo>
          <Campo etiqueta="Fecha final"><input type="date" value={f.fecha_fin?.slice(0, 10)} onChange={(e) => set('fecha_fin', e.target.value)} required /></Campo>
        </div>
        {!f.id && <Campo etiqueta="Tutor líder (opcional)"><select value={f.tutor_lider_id} onChange={(e) => set('tutor_lider_id', e.target.value)}><option value="">Sin asignar por ahora</option>{tutores.data?.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>}
        {error && <Aviso tipo="mal">{error}</Aviso>}
        <div className="acciones"><button className="btn" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button><button type="button" className="btn sec" onClick={onCerrar}>Cancelar</button></div>
      </form>
    </Modal>
  );
}

function Detalle({ id, onVolver }: { id: string; onVolver: () => void }) {
  const d = useCarga(() => api<any>('GET', `/estrategias/${id}`), [id]);
  const [editar, setEditar] = useState<any | null>(null);
  const [tab, setTab] = useState<'individual' | 'grupo'>('individual');
  const e = d.data;
  if (!e) return <>{d.error ? <Aviso tipo="mal">{d.error}</Aviso> : <div className="vacio">Cargando…</div>}<button className="btn sec" onClick={onVolver}>← Volver</button></>;
  const bloqueada = e.estado === 'CON_ESTUDIANTES';
  return (
    <>
      <button className="btn sec peq" onClick={onVolver}>← Volver a las estrategias</button>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="fila" style={{ alignItems: 'start' }}>
          <div style={{ flex: 3 }}>
            <h1>{e.nombre}</h1>
            <p style={{ margin: '.3rem 0' }}>{e.descripcion}</p>
            <div style={{ color: 'var(--gris)' }}>{e.entidad} · {e.region} · {fmtFecha(e.fecha_inicio)} – {fmtFecha(e.fecha_fin)}</div>
            <div style={{ marginTop: '.3rem' }}><span className={`pill ${bloqueada ? 'verde' : 'amar'}`}>{textoEstado(e.estado)}</span> <span className="pill gris">{e.n_estudiantes} estudiantes</span> <span className="pill gris">{e.n_docentes} docentes</span></div>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}><button className="btn sec" disabled={bloqueada} onClick={() => setEditar({ ...e, fecha_inicio: e.fecha_inicio.slice(0, 10), fecha_fin: e.fecha_fin.slice(0, 10) })}>Editar estrategia</button></div>
        </div>
        {bloqueada && <Aviso tipo="info">Esta estrategia ya tiene estudiantes vinculados, por eso ya no se puede editar. Puedes seguir vinculando estudiantes y asignando docentes.</Aviso>}
      </div>
      <div className="grid g2">
        <div><AsociarEstudiantes id={id} tab={tab} setTab={setTab} onCambio={d.recargar} /></div>
        <div><Docentes estrategia={e} onCambio={d.recargar} /></div>
      </div>
      {editar && <FormEstrategia inicial={editar} onCerrar={() => setEditar(null)} onGuardada={() => { setEditar(null); d.recargar(); }} />}
    </>
  );
}

function Docentes({ estrategia, onCambio }: { estrategia: any; onCambio: () => void }) {
  const [abrir, setAbrir] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const todos = useCarga(() => api<any[]>('GET', '/docentes'), []);
  const ya = new Set(estrategia.docentes.map((d: any) => d.id));
  const guardar = async () => { await api('POST', `/estrategias/${estrategia.id}/docentes`, { docente_ids: sel }); setAbrir(false); setSel([]); onCambio(); };
  return (
    <div className="card">
      <h2>Docentes de la estrategia</h2>
      {estrategia.docentes.length ? <div className="scroll" style={{ maxHeight: 260, overflow: 'auto' }}><table><tbody>{estrategia.docentes.map((d: any) => <tr key={d.id}><td>{d.nombre}</td><td style={{ color: 'var(--gris)' }}>{d.documento}</td></tr>)}</tbody></table></div> : <div className="vacio">Aún no tiene docentes asignados.</div>}
      <div className="acciones"><button className="btn sec" onClick={() => setAbrir(!abrir)}>{abrir ? 'Cerrar' : '+ Asignar docentes'}</button></div>
      {abrir && <>
        <div className="chk" style={{ marginTop: '.6rem' }}>{todos.data?.filter((d) => !ya.has(d.id)).map((d) => <label key={d.id}><input type="checkbox" checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />{d.nombre} <small style={{ color: 'var(--gris)' }}>· {d.entidad}</small></label>)}</div>
        <div className="acciones"><button className="btn" disabled={!sel.length} onClick={guardar}>Asignar {sel.length || ''} docente(s)</button></div>
      </>}
    </div>
  );
}

function AsociarEstudiantes({ id, tab, setTab, onCambio }: { id: string; tab: string; setTab: (t: any) => void; onCambio: () => void }) {
  const ents = useCarga(() => api<any[]>('GET', '/entidades'));
  const [b, setB] = useState({ documento: '', nombre: '', entidad: '' });
  const [items, setItems] = useState<any[]>([]); const [sig, setSig] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ t: 'ok' | 'mal' | 'info'; m: string } | null>(null);
  const [grupo, setGrupo] = useState({ entidad: '', n: null as number | null }); const [confirmar, setConfirmar] = useState(false);
  const buscar = async (cursor = '') => {
    const p = new URLSearchParams({ ...b, ...(cursor ? { cursor } : {}) } as any);
    try {
      const r = await api<any>('GET', `/estudiantes?${p}`);
      setItems(cursor ? [...items, ...r.items] : r.items); setSig(r.siguiente);
      if (!cursor && !r.items.length) setMsg({ t: 'info', m: 'No hay estudiantes que cumplan ese filtro.' }); else setMsg(null);
    } catch (e: any) { setMsg({ t: 'mal', m: e.message }); }
  };
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const asociar = async () => {
    try {
      const r = await api<any>('POST', `/estrategias/${id}/estudiantes`, { estudiante_ids: ids });
      setMsg({ t: 'ok', m: `Listo: se vincularon ${r.nuevos} estudiante(s). La estrategia ya tiene ${r.total} y quedó bloqueada para edición.` }); setSel({}); onCambio();
    } catch (e: any) { setMsg({ t: 'mal', m: e.message }); }
  };
  useEffect(() => { if (grupo.entidad) api<any>('GET', `/estudiantes/conteo?entidad=${grupo.entidad}`).then((r) => setGrupo((g) => ({ ...g, n: r.n }))); }, [grupo.entidad]);
  const asociarGrupo = async () => {
    setConfirmar(false);
    try {
      const r = await api<any>('POST', `/estrategias/${id}/estudiantes/grupo`, { entidad_id: grupo.entidad });
      setMsg({ t: 'ok', m: `Se vincularon ${r.nuevos} estudiantes nuevos (total en la estrategia: ${r.total}).` }); onCambio();
    } catch (e: any) { setMsg({ t: 'mal', m: e.message }); }
  };
  return (
    <div className="card">
      <h2>Asociar estudiantes</h2>
      <div className="tabs"><button className={tab === 'individual' ? 'act' : ''} onClick={() => setTab('individual')}>Uno por uno</button><button className={tab === 'grupo' ? 'act' : ''} onClick={() => setTab('grupo')}>Por grupo</button></div>
      {tab === 'individual' ? <>
        <div className="fila">
          <Campo etiqueta="Documento"><input value={b.documento} onChange={(e) => setB({ ...b, documento: e.target.value })} /></Campo>
          <Campo etiqueta="Nombre"><input value={b.nombre} onChange={(e) => setB({ ...b, nombre: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Entidad"><select value={b.entidad} onChange={(e) => setB({ ...b, entidad: e.target.value })}><option value="">Todas</option>{ents.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
        <div className="acciones"><button className="btn" onClick={() => buscar()}>Buscar</button></div>
        {items.length > 0 && <>
          <div className="scroll" style={{ maxHeight: 300, overflow: 'auto', marginTop: '.6rem' }}><table><tbody>{items.map((s) => <tr key={s.id}><td style={{ width: 30 }}><input type="checkbox" checked={!!sel[s.id]} onChange={(e) => setSel({ ...sel, [s.id]: e.target.checked })} /></td><td>{s.nombre}<div style={{ color: 'var(--gris)', fontSize: '.8rem' }}>{s.documento} · {s.entidad}</div></td></tr>)}</tbody></table></div>
          <div className="acciones">{sig && <button className="btn sec peq" onClick={() => buscar(sig)}>Cargar más</button>}<button className="btn" disabled={!ids.length} onClick={asociar}>Vincular {ids.length || ''} seleccionado(s)</button></div>
        </>}
      </> : <>
        <Campo etiqueta="Entidad cuyos estudiantes se vincularán"><select value={grupo.entidad} onChange={(e) => setGrupo({ entidad: e.target.value, n: null })}><option value="">Elige una entidad…</option>{ents.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
        {grupo.entidad && grupo.n !== null && <Aviso tipo="info">Esa entidad tiene <b>{grupo.n}</b> estudiantes precargados.</Aviso>}
        <div className="acciones"><button className="btn" disabled={!grupo.entidad || !grupo.n} onClick={() => setConfirmar(true)}>Vincular a todos</button></div>
      </>}
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      {confirmar && <Modal titulo="Confirma la vinculación" onCerrar={() => setConfirmar(false)}>
        <p>Vas a vincular a <b>{grupo.n}</b> estudiantes a esta estrategia en una sola operación. Los que ya estaban vinculados no se repiten, y después la estrategia ya no podrá editarse.</p>
        <div className="acciones"><button className="btn" onClick={asociarGrupo}>Sí, vincular</button><button className="btn sec" onClick={() => setConfirmar(false)}>Cancelar</button></div>
      </Modal>}
    </div>
  );
}
