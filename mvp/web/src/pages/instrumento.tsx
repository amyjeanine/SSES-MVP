import { useEffect, useState } from 'react';
import { api } from '../api';
import { Aviso, Campo, fmtFecha, useCarga } from '../ui';

const EJES: Record<string, string> = { FUNCIONALIDAD: 'Funcionalidad', FACILIDAD_DE_USO: 'Facilidad de uso', COMPORTAMIENTO: 'Comportamiento en condiciones reales' };

export default function Instrumento() {
  const sesiones = useCarga(() => api<any[]>('GET', '/pilotaje/sesiones'));
  const [sesion, setSesion] = useState('');
  const inst = useCarga(() => api<any>('GET', `/instrumentos/vigente${sesion ? `?sesion=${sesion}` : ''}`), [sesion]);
  const [resp, setResp] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<{ t: 'ok' | 'mal' | 'info'; m: string } | null>(null);
  const [faltan, setFaltan] = useState<string[]>([]);
  const i = inst.data;
  useEffect(() => { setResp(i?.mia?.respuestas || {}); setMsg(null); setFaltan([]); }, [i?.id, i?.mia?.estado, sesion]);
  const enviado = i?.mia?.estado === 'ENVIADO';
  const cuerpo = () => ({ sesion_id: sesion || null, respuestas: resp });
  const borrador = async () => { try { await api('PUT', '/instrumentos/respuestas/borrador', cuerpo()); setMsg({ t: 'ok', m: 'Borrador guardado. Puedes salir y retomarlo después.' }); } catch (e: any) { setMsg({ t: 'mal', m: e.message }); } };
  const enviar = async () => {
    try { await api('POST', '/instrumentos/respuestas', cuerpo()); setMsg({ t: 'ok', m: '¡Gracias! Tus respuestas se enviaron.' }); inst.recargar(); }
    catch (e: any) { setFaltan(e.data?.faltan || []); setMsg({ t: 'mal', m: e.message }); }
  };
  const ejes = Array.from(new Set(i?.preguntas.map((p: any) => p.eje) || [])) as string[];
  return (
    <>
      <h1>Instrumento de percepción</h1>
      <span style={{ color: 'var(--gris)' }}>Cuéntanos cómo te fue con el sistema. Tus respuestas ayudan al Ministerio a decidir qué mejorar.</span>
      <div className="card" style={{ marginTop: '.8rem', maxWidth: 820 }}>
        <Campo etiqueta="¿Sobre qué sesión del piloto quieres responder?">
          <select value={sesion} onChange={(e) => setSesion(e.target.value)}><option value="">Valoración general del piloto</option>{sesiones.data?.map((s) => <option key={s.id} value={s.id}>{s.region} · {fmtFecha(s.fecha)}</option>)}</select>
        </Campo>
        {inst.error && <Aviso tipo="mal">{inst.error}</Aviso>}
        {enviado && <Aviso tipo="ok">Ya enviaste este instrumento. ¡Gracias por tus respuestas!</Aviso>}
        {i?.mia?.estado === 'BORRADOR' && <Aviso tipo="info">Tienes un borrador guardado; ya cargamos tus respuestas.</Aviso>}
        {i && ejes.map((eje) => (
          <div key={eje} style={{ marginTop: '1rem' }}>
            <h3 style={{ color: 'var(--azul)' }}>{EJES[eje]}</h3>
            {i.preguntas.filter((p: any) => p.eje === eje).map((p: any) => (
              <div key={p.id} style={{ margin: '.7rem 0' }}>
                <label style={{ marginBottom: '.4rem' }}>{p.texto}{p.obligatoria && <span style={{ color: 'var(--mal)' }}> *</span>}</label>
                {p.tipo === 'ESCALA'
                  ? <div className="escala">{[1, 2, 3, 4, 5].map((n) => <label key={n} className={resp[p.id] == n ? 'sel' : ''}><input type="radio" disabled={enviado} checked={resp[p.id] == n} onChange={() => setResp({ ...resp, [p.id]: n })} />{n}</label>)}<small style={{ alignSelf: 'center', color: 'var(--gris)' }}>1 = muy mal · 5 = excelente</small></div>
                  : <textarea disabled={enviado} value={resp[p.id] || ''} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })} />}
                {faltan.includes(p.id) && <div className="err">Esta pregunta es obligatoria</div>}
              </div>
            ))}
          </div>
        ))}
        {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
        {i && !enviado && <div className="acciones"><button className="btn" onClick={enviar}>Enviar respuestas</button><button className="btn sec" onClick={borrador}>Guardar borrador</button></div>}
      </div>
    </>
  );
}
