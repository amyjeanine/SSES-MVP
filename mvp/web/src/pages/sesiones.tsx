import { useState } from 'react';
import { api } from '../api';
import { Aviso, Campo, Modal, fmtFecha, hoyISO, useCarga } from '../ui';

const REGIONES = ['Caribe', 'Andina', 'Pacífica', 'Orinoquía', 'Amazonía'];
const TIPOS: Record<string, string> = { CONECTIVIDAD: 'Conectividad', RENDIMIENTO: 'Rendimiento', ACCESO: 'Acceso', OTRO: 'Otro' };

export default function Sesiones() {
  const l = useCarga(() => api<any[]>('GET', '/pilotaje/sesiones'));
  const [form, setForm] = useState(false);
  const [inc, setInc] = useState<any>(null); const [res, setRes] = useState<any>(null);
  const abiertos = l.data?.reduce((a, s) => a + s.incidentes.filter((i: any) => i.estado === 'ABIERTO').length, 0) || 0;
  return (
    <>
      <div className="fila" style={{ alignItems: 'center', marginBottom: '.8rem' }}>
        <div><h1>Sesiones del piloto</h1><span style={{ color: 'var(--gris)' }}>Lleva el registro de cada sesión con tutores y de lo que pasó con el sistema.</span></div>
        <div style={{ flex: 0, textAlign: 'right' }}><button className="btn" onClick={() => setForm(true)}>+ Registrar sesión</button></div>
      </div>
      {abiertos > 0 && <Aviso tipo="amar">Hay {abiertos} incidente(s) abierto(s) por resolver.</Aviso>}
      {l.error && <Aviso tipo="mal">{l.error}</Aviso>}
      {l.data?.map((s) => (
        <div className="card" key={s.id}>
          <div className="fila" style={{ alignItems: 'start' }}>
            <div style={{ flex: 3 }}><h2 style={{ marginBottom: '.2rem' }}>{s.region} · {fmtFecha(s.fecha)}</h2>
              <span className="pill gris">{s.asistentes} de {s.citados} asistieron</span> <span className="pill verde">Valoración {s.valoracion}/5</span>
              {s.observaciones && <p style={{ margin: '.5rem 0 0' }}>{s.observaciones}</p>}</div>
            <div style={{ flex: 1, textAlign: 'right' }}><button className="btn sec peq" onClick={() => setInc(s)}>+ Registrar incidente</button></div>
          </div>
          {s.incidentes.length > 0 && <table style={{ marginTop: '.6rem' }}><tbody>{s.incidentes.map((i: any) => (
            <tr key={i.id}><td style={{ width: 70 }}>{i.hora}</td><td><span className="pill gris">{TIPOS[i.tipo]}</span> {i.descripcion}{i.solucion && <div style={{ color: 'var(--ok)' }}>✔ {i.solucion}</div>}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{i.estado === 'ABIERTO' ? <button className="btn sec peq" onClick={() => setRes(i)}>Marcar como resuelto</button> : <span className="pill verde">Resuelto</span>}</td></tr>))}</tbody></table>}
        </div>
      ))}
      {l.data && !l.data.length && <div className="card vacio">Todavía no hay sesiones registradas.</div>}
      {form && <FormSesion onCerrar={() => setForm(false)} onListo={() => { setForm(false); l.recargar(); }} />}
      {inc && <FormIncidente sesion={inc} onCerrar={() => setInc(null)} onListo={() => { setInc(null); l.recargar(); }} />}
      {res && <FormResolver incidente={res} onCerrar={() => setRes(null)} onListo={() => { setRes(null); l.recargar(); }} />}
    </>
  );
}

function useEnvio(fn: () => Promise<any>, onListo: () => void) {
  const [error, setError] = useState('');
  const enviar = async (e: React.FormEvent) => { e.preventDefault(); setError(''); try { await fn(); onListo(); } catch (er: any) { setError(er.message); } };
  return { error, enviar };
}

function FormSesion({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ fecha: hoyISO(), region: '', citados: 20, asistentes: 20, valoracion: 4, observaciones: '' });
  const { error, enviar } = useEnvio(() => api('POST', '/pilotaje/sesiones', f), onListo);
  return (
    <Modal titulo="Registrar sesión del piloto" onCerrar={onCerrar}>
      <form onSubmit={enviar}>
        <div className="fila"><Campo etiqueta="Fecha"><input type="date" value={f.fecha} max={hoyISO()} onChange={(e) => setF({ ...f, fecha: e.target.value })} required /></Campo>
          <Campo etiqueta="Región"><select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} required><option value="">Elige…</option>{REGIONES.map((r) => <option key={r}>{r}</option>)}</select></Campo></div>
        <div className="fila"><Campo etiqueta="Tutores citados"><input type="number" min={0} value={f.citados} onChange={(e) => setF({ ...f, citados: +e.target.value })} /></Campo>
          <Campo etiqueta="Asistentes"><input type="number" min={0} value={f.asistentes} onChange={(e) => setF({ ...f, asistentes: +e.target.value })} /></Campo>
          <Campo etiqueta="Cómo funcionó el sistema (1 a 5)"><select value={f.valoracion} onChange={(e) => setF({ ...f, valoracion: +e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Campo></div>
        <Campo etiqueta="Observaciones"><textarea value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Campo>
        {error && <Aviso tipo="mal">{error}</Aviso>}
        <div className="acciones"><button className="btn">Guardar sesión</button><button type="button" className="btn sec" onClick={onCerrar}>Cancelar</button></div>
      </form>
    </Modal>
  );
}
function FormIncidente({ sesion, onCerrar, onListo }: { sesion: any; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ tipo: 'CONECTIVIDAD', hora: new Date().toTimeString().slice(0, 5), descripcion: '' });
  const { error, enviar } = useEnvio(() => api('POST', `/pilotaje/sesiones/${sesion.id}/incidentes`, f), onListo);
  return (
    <Modal titulo={`Incidente · ${sesion.region}, ${fmtFecha(sesion.fecha)}`} onCerrar={onCerrar}>
      <form onSubmit={enviar}>
        <div className="fila"><Campo etiqueta="Tipo"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          <Campo etiqueta="Hora"><input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} required /></Campo></div>
        <Campo etiqueta="¿Qué ocurrió?"><textarea value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required /></Campo>
        {error && <Aviso tipo="mal">{error}</Aviso>}
        <div className="acciones"><button className="btn">Guardar incidente</button><button type="button" className="btn sec" onClick={onCerrar}>Cancelar</button></div>
      </form>
    </Modal>
  );
}
function FormResolver({ incidente, onCerrar, onListo }: { incidente: any; onCerrar: () => void; onListo: () => void }) {
  const [solucion, setSolucion] = useState('');
  const { error, enviar } = useEnvio(() => api('PUT', `/pilotaje/incidentes/${incidente.id}/resolver`, { solucion }), onListo);
  return (
    <Modal titulo="Marcar incidente como resuelto" onCerrar={onCerrar}>
      <p style={{ marginTop: 0 }}>{incidente.descripcion}</p>
      <form onSubmit={enviar}>
        <Campo etiqueta="Solución aplicada"><textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} required /></Campo>
        {error && <Aviso tipo="mal">{error}</Aviso>}
        <div className="acciones"><button className="btn">Marcar como resuelto</button><button type="button" className="btn sec" onClick={onCerrar}>Cancelar</button></div>
      </form>
    </Modal>
  );
}
