import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { api, nuevoId, sesion } from '../api';
import { db, ItemCola } from '../db';
import { encolar, useLive } from '../sync';
import { Aviso, Campo, Tabs, fmtFecha, hoyISO, mesISO, useCarga } from '../ui';

const ACTIVIDADES = ['Observación de clase', 'Retroalimentación', 'Taller con docentes', 'Planeación conjunta', 'Revisión de evidencias'];

// Datos de trabajo del tutor líder: se descargan al dispositivo y se usan aunque no haya internet
function useMisDatos() {
  const [d, setD] = useState<any>(null); const [desdeCache, setDesdeCache] = useState(false);
  useEffect(() => {
    (async () => {
      try { const r = await api<any>('GET', '/mis-datos'); await db.datos.put({ k: 'mis-datos', v: r }); setD(r); setDesdeCache(false); }
      catch { const c = await db.datos.get('mis-datos'); if (c) { setD(c.v); setDesdeCache(true); } }
    })();
  }, []);
  return { datos: d, desdeCache };
}

export default function Acompanamientos() {
  const [tab, setTab] = useState('calendario');
  const [prefill, setPrefill] = useState<any>(null);
  const { datos, desdeCache } = useMisDatos();
  const abrirRegistro = (p: any) => { setPrefill(p); setTab('registrar'); };
  return (
    <>
      <h1>Acompañamientos y seguimiento</h1>
      <span style={{ color: 'var(--gris)' }}>Todo lo que registras se guarda primero en tu dispositivo y se envía solo cuando hay conexión.</span>
      {desdeCache && <Aviso tipo="amar">Estás viendo los datos de trabajo guardados en el dispositivo (sin conexión).</Aviso>}
      <div style={{ height: '.8rem' }} />
      <Tabs actual={tab} onCambio={setTab} tabs={[['calendario', 'Calendario'], ['registrar', 'Registrar acompañamiento'], ['seguimiento', 'Seguimiento semanal'], ['historial', 'Historial'], ['locales', 'Mis registros']]} />
      {!datos ? <div className="vacio">Cargando tus estrategias…</div> : <>
        {tab === 'calendario' && <Calendario />}
        {tab === 'registrar' && <Registrar datos={datos} inicial={prefill} onListo={() => { setPrefill(null); setTab('locales'); }} />}
        {tab === 'seguimiento' && <Seguimiento onListo={() => setTab('locales')} />}
        {tab === 'historial' && <Historial datos={datos} />}
        {tab === 'locales' && <Locales onCorregir={abrirRegistro} />}
      </>}
    </>
  );
}

function Calendario() {
  const [mes, setMes] = useState(mesISO());
  const [cal, setCal] = useState<any>(null); const [cache, setCache] = useState(false);
  useEffect(() => {
    (async () => {
      try { const r = await api<any>('GET', `/acompanamientos/calendario?mes=${mes}`); await db.datos.put({ k: `cal-${mes}`, v: r }); setCal(r); setCache(false); }
      catch { const c = await db.datos.get(`cal-${mes}`); setCal(c?.v || null); setCache(!!c); }
    })();
  }, [mes]);
  const mover = (n: number) => { const d = new Date(mes + '-15T12:00:00'); d.setMonth(d.getMonth() + n); setMes(mesISO(d)); };
  const dias = cal?.dias || [];
  const offset = dias.length ? (new Date(dias[0].fecha + 'T12:00:00').getDay() + 6) % 7 : 0;
  const pend = dias.filter((d: any) => d.pendiente).length;
  return (
    <div className="card">
      <div className="fila" style={{ alignItems: 'center' }}>
        <div style={{ flex: 0 }}><button className="btn sec peq" onClick={() => mover(-1)}>←</button></div>
        <h2 style={{ textAlign: 'center', margin: 0, textTransform: 'capitalize' }}>{new Date(mes + '-15T12:00:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</h2>
        <div style={{ flex: 0, textAlign: 'right' }}><button className="btn sec peq" onClick={() => mover(1)}>→</button></div>
      </div>
      {cache && <Aviso tipo="amar">Calendario guardado en el dispositivo; puede estar desactualizado.</Aviso>}
      {!cal ? <div className="vacio">No hay calendario para este mes sin conexión.</div> : <>
        <div className="cal" style={{ marginTop: '.8rem' }}>
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="cab">{d}</div>)}
          {Array.from({ length: offset }).map((_, i) => <div key={'o' + i} />)}
          {dias.map((d: any) => {
            const fin = [0, 6].includes(new Date(d.fecha + 'T12:00:00').getDay());
            return <div key={d.fecha} className={`dia ${d.pendiente ? 'pend' : d.acompanamientos || d.seguimientos ? 'con' : fin ? 'fin' : ''}`} title={d.pendiente ? 'Día pendiente de registro' : ''}>
              <b>{Number(d.fecha.slice(8))}</b>
              {d.acompanamientos > 0 && <div>● {d.acompanamientos} acomp.</div>}
              {d.pendiente && <div style={{ color: 'var(--aviso)' }}>pendiente</div>}
            </div>;
          })}
        </div>
        <div style={{ marginTop: '.8rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="pill verde">Con registro</span><span className="pill amar">{pend} día(s) hábil(es) pendiente(s)</span>
        </div>
        <h3 style={{ marginTop: '1rem' }}>Acompañamientos del mes</h3>
        {cal.acompanamientos.length ? <table><tbody>{cal.acompanamientos.map((a: any) => <tr key={a.id}><td style={{ width: 110 }}>{fmtFecha(a.fecha)}</td><td><b>{a.estrategia}</b><div style={{ color: 'var(--gris)' }}>{a.docentes}</div></td></tr>)}</tbody></table> : <div className="vacio">Sin acompañamientos en este mes.</div>}
      </>}
    </div>
  );
}

function Registrar({ datos, inicial, onListo }: { datos: any; inicial: any; onListo: () => void }) {
  const base = { id: nuevoId(), estrategia_id: '', tipo: 'INDIVIDUAL', fecha: hoyISO(), duracion_min: 45, tipo_actividad: ACTIVIDADES[0], observaciones: '', compromisos: '', areas_mejora: '', docente_ids: [] as string[] };
  const [f, setF] = useState<any>(inicial ? { ...base, ...inicial } : base);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const docentes = useMemo(() => datos.docentes.filter((d: any) => d.estrategia_id === f.estrategia_id), [datos, f.estrategia_id]);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  const validar = () => {
    const e: Record<string, string> = {};
    if (!f.estrategia_id) e.estrategia_id = 'Elige la estrategia';
    if (!f.fecha) e.fecha = 'Elige la fecha';
    if (!(f.duracion_min >= 5)) e.duracion_min = 'La duración mínima es de 5 minutos';
    if (f.observaciones.trim().length < 5) e.observaciones = 'Escribe las observaciones';
    if (f.compromisos.trim().length < 5) e.compromisos = 'Escribe los compromisos acordados';
    if (f.tipo === 'INDIVIDUAL' && f.docente_ids.length !== 1) e.docente_ids = 'Elige el docente acompañado';
    if (f.tipo === 'GRUPAL' && f.docente_ids.length < 2) e.docente_ids = 'Marca dos o más docentes';
    return e;
  };
  const guardar = async () => {
    const e = validar(); setErrores(e);
    if (Object.keys(e).length) return;
    const est = datos.estrategias.find((x: any) => x.id === f.estrategia_id)?.nombre;
    const nombres = docentes.filter((d: any) => f.docente_ids.includes(d.id)).map((d: any) => d.nombre).join(', ');
    await encolar('ACOMPANAMIENTO', { ...f, duracion_min: Number(f.duracion_min), registrado_en: new Date().toISOString() }, `${f.tipo === 'GRUPAL' ? 'Grupal' : 'Individual'} · ${est} · ${nombres} · ${fmtFecha(f.fecha)}`);
    await db.borradores.delete(f.id);
    onListo();
  };
  const borrador = async () => {
    await db.borradores.put({ id: f.id, usuario: sesion.usuario()!.id, datos: f, actualizado: Date.now() });
    setMsg('Borrador guardado en tu dispositivo. Lo encuentras en "Mis registros".');
  };
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2>Registrar acompañamiento pedagógico</h2>
      {inicial && <Aviso tipo="info">Estás corrigiendo un registro. Revisa los datos y vuelve a guardarlo.</Aviso>}
      <Campo etiqueta="Estrategia" error={errores.estrategia_id}>
        <select value={f.estrategia_id} onChange={(e) => setF({ ...f, estrategia_id: e.target.value, docente_ids: [] })}><option value="">Elige una estrategia…</option>{datos.estrategias.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
      </Campo>
      <label>Tipo de acompañamiento</label>
      <div className="escala">{[['INDIVIDUAL', 'Individual (un docente)'], ['GRUPAL', 'Grupal (varios docentes)']].map(([v, t]) => <label key={v} className={f.tipo === v ? 'sel' : ''}><input type="radio" checked={f.tipo === v} onChange={() => setF({ ...f, tipo: v, docente_ids: [] })} />{t}</label>)}</div>
      <Campo etiqueta={f.tipo === 'INDIVIDUAL' ? 'Docente acompañado' : 'Docentes participantes'} error={errores.docente_ids}>
        {f.tipo === 'INDIVIDUAL'
          ? <select value={f.docente_ids[0] || ''} onChange={(e) => set('docente_ids', e.target.value ? [e.target.value] : [])}><option value="">{f.estrategia_id ? 'Elige un docente…' : 'Primero elige la estrategia'}</option>{docentes.map((d: any) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select>
          : <div className="chk">{docentes.length ? docentes.map((d: any) => <label key={d.id}><input type="checkbox" checked={f.docente_ids.includes(d.id)} onChange={(e) => set('docente_ids', e.target.checked ? [...f.docente_ids, d.id] : f.docente_ids.filter((x: string) => x !== d.id))} />{d.nombre}</label>) : <small>Primero elige la estrategia.</small>}</div>}
      </Campo>
      <div className="fila">
        <Campo etiqueta="Fecha" error={errores.fecha}><input type="date" max={hoyISO()} value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></Campo>
        <Campo etiqueta="Duración (minutos)" error={errores.duracion_min}><input type="number" min={5} max={600} value={f.duracion_min} onChange={(e) => set('duracion_min', e.target.value)} /></Campo>
        <Campo etiqueta="Tipo de actividad"><select value={f.tipo_actividad} onChange={(e) => set('tipo_actividad', e.target.value)}>{ACTIVIDADES.map((a) => <option key={a}>{a}</option>)}</select></Campo>
      </div>
      <Campo etiqueta="Observaciones" error={errores.observaciones}><textarea value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} /></Campo>
      <Campo etiqueta="Compromisos acordados" error={errores.compromisos}><textarea value={f.compromisos} onChange={(e) => set('compromisos', e.target.value)} /></Campo>
      <Campo etiqueta="Áreas de mejora (opcional)"><textarea value={f.areas_mejora} onChange={(e) => set('areas_mejora', e.target.value)} /></Campo>
      {msg && <Aviso tipo="ok">{msg}</Aviso>}
      <div className="acciones"><button className="btn" onClick={guardar}>Guardar</button><button className="btn sec" onClick={borrador}>Guardar borrador</button></div>
    </div>
  );
}

function Seguimiento({ onListo }: { onListo: () => void }) {
  const local = useLive(() => db.cola.where('tipo').equals('ACOMPANAMIENTO').filter((x) => x.estado !== 'RECHAZADO').toArray(), [] as ItemCola[]);
  const [serv, setServ] = useState<any[]>([]);
  useEffect(() => { (async () => { try { const r = await api<any[]>('GET', '/acompanamientos'); await db.datos.put({ k: 'historial', v: r }); setServ(r); } catch { setServ((await db.datos.get('historial'))?.v || []); } })(); }, []);
  const opciones = useMemo(() => {
    const m = new Map<string, string>();
    serv.forEach((a) => m.set(a.id, `${fmtFecha(a.fecha)} · ${a.estrategia} · ${a.docentes}`));
    local.forEach((a) => m.set(a.clave, a.resumen + (a.estado === 'PENDIENTE' ? ' (pendiente de sincronizar)' : '')));
    return [...m.entries()];
  }, [serv, local]);
  const [f, setF] = useState({ acompanamiento_id: '', fecha: hoyISO(), avance: '', observaciones: '' });
  const [e, setE] = useState<Record<string, string>>({});
  const guardar = async () => {
    const er: Record<string, string> = {};
    if (!f.acompanamiento_id) er.a = 'Elige el acompañamiento';
    if (f.avance.trim().length < 3) er.av = 'Escribe el avance';
    if (f.observaciones.trim().length < 5) er.o = 'Escribe las observaciones';
    setE(er); if (Object.keys(er).length) return;
    await encolar('SEGUIMIENTO', { id: nuevoId(), ...f, registrado_en: new Date().toISOString() }, `Seguimiento semanal · ${opciones.find(([k]) => k === f.acompanamiento_id)?.[1]} · ${fmtFecha(f.fecha)}`);
    onListo();
  };
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2>Seguimiento semanal</h2>
      <Aviso tipo="info">Se registra un seguimiento por semana para cada acompañamiento.</Aviso>
      <Campo etiqueta="Acompañamiento" error={e.a}><select value={f.acompanamiento_id} onChange={(x) => setF({ ...f, acompanamiento_id: x.target.value })}><option value="">Elige un acompañamiento…</option>{opciones.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Campo>
      <Campo etiqueta="Fecha del seguimiento"><input type="date" max={hoyISO()} value={f.fecha} onChange={(x) => setF({ ...f, fecha: x.target.value })} /></Campo>
      <Campo etiqueta="Avance del docente" error={e.av}><input value={f.avance} onChange={(x) => setF({ ...f, avance: x.target.value })} placeholder="Ej.: cumplió el 80 % de los compromisos" /></Campo>
      <Campo etiqueta="Observaciones" error={e.o}><textarea value={f.observaciones} onChange={(x) => setF({ ...f, observaciones: x.target.value })} /></Campo>
      <div className="acciones"><button className="btn" onClick={guardar}>Guardar seguimiento</button></div>
    </div>
  );
}

function Historial({ datos }: { datos: any }) {
  const [filtro, setFiltro] = useState({ desde: '', hasta: '', docente: '', estrategia: '' });
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const buscar = async () => {
    try { setErr(''); setRows(await api<any[]>('GET', `/acompanamientos?${new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as any)}`)); }
    catch (e: any) { setErr(e.sinConexion ? 'Sin conexión: el historial completo necesita internet.' : e.message); }
  };
  useEffect(() => { buscar(); }, []); // eslint-disable-line
  const pdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const PW = 277; // A4 landscape: 297 - 2*10 márgenes
    const ML = 10;
    const PAGE_H = 210;
    const FOOTER = 10;

    // Cabecera del documento
    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text('Historial de acompañamientos y seguimientos', ML, 12);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(`Tutor líder: ${sesion.usuario()?.nombre ?? ''}   ·   Generado: ${new Date().toLocaleString('es-CO')}`, ML, 18);

    // Columnas [etiqueta, ancho en mm]
    const cols: [string, number][] = [
      ['Fecha', 22], ['Tipo', 20], ['Estrategia', 38], ['Docentes', 38],
      ['Actividad', 30], ['Dur.', 14], ['Observaciones', 45], ['Compromisos', 45], ['Seguim.', 25],
    ];
    const totalW = cols.reduce((s, [, w]) => s + w, 0);
    const scale = PW / totalW;
    const colW = cols.map(([, w]) => w * scale);
    const colX: number[] = [];
    colW.reduce((acc, w) => { colX.push(acc); return acc + w; }, ML);

    const ROW_PAD = 1.5;
    const FONT_SZ = 7;
    const LINE_H = FONT_SZ * 0.3528 + 0.6;
    let y = 24;

    const drawHeader = () => {
      doc.setFillColor(30, 80, 160); doc.setTextColor(255, 255, 255);
      doc.setFontSize(FONT_SZ); doc.setFont('helvetica', 'bold');
      const hh = LINE_H + ROW_PAD * 2;
      doc.rect(ML, y, PW, hh, 'F');
      cols.forEach(([label], i) => {
        doc.text(label, colX[i] + 1, y + ROW_PAD + LINE_H - 0.5, { maxWidth: colW[i] - 2 });
      });
      y += hh;
      doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
    };

    drawHeader();

    (rows || []).forEach((a, ri) => {
      const cells = [
        fmtFecha(a.fecha),
        a.tipo ?? '',
        a.estrategia ?? '',
        a.docentes ?? '',
        a.tipo_actividad ?? '',
        `${a.duracion_min ?? ''} min`,
        a.observaciones ?? '—',
        a.compromisos ?? '—',
        a.seguimientos?.length
          ? a.seguimientos.map((s: any) => `${fmtFecha(s.fecha)}: ${s.observacion}`).join(' | ')
          : '—',
      ];

      doc.setFontSize(FONT_SZ);
      const wrapped = cells.map((txt, i) => doc.splitTextToSize(String(txt), colW[i] - 2));
      const maxLines = Math.max(...wrapped.map(l => l.length));
      const rh = maxLines * LINE_H + ROW_PAD * 2;

      if (y + rh > PAGE_H - FOOTER) { doc.addPage(); y = 10; drawHeader(); }

      if (ri % 2 === 0) { doc.setFillColor(240, 245, 255); doc.rect(ML, y, PW, rh, 'F'); }
      doc.setDrawColor(200, 210, 230);
      doc.line(ML, y + rh, ML + PW, y + rh);

      doc.setFontSize(FONT_SZ); doc.setFont('helvetica', 'normal');
      wrapped.forEach((lines, i) => {
        doc.text(lines, colX[i] + 1, y + ROW_PAD + LINE_H - 0.5, { maxWidth: colW[i] - 2 });
      });
      y += rh;
    });

    doc.setDrawColor(30, 80, 160);
    doc.rect(ML, 24, PW, Math.max(y - 24, 1));

    doc.save('historial_acompanamientos.pdf');
  };
  const docentes = Array.from(new Map(datos.docentes.map((d: any) => [d.id, d])).values()) as any[];
  return (
    <div className="card">
      <div className="fila">
        <Campo etiqueta="Desde"><input type="date" value={filtro.desde} onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={filtro.hasta} onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} /></Campo>
        <Campo etiqueta="Estrategia"><select value={filtro.estrategia} onChange={(e) => setFiltro({ ...filtro, estrategia: e.target.value })}><option value="">Todas</option>{datos.estrategias.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Docente"><select value={filtro.docente} onChange={(e) => setFiltro({ ...filtro, docente: e.target.value })}><option value="">Todos</option>{docentes.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select></Campo>
      </div>
      <div className="acciones"><button className="btn" onClick={buscar}>Filtrar</button><button className="btn sec" disabled={!rows?.length} onClick={pdf}>Descargar PDF</button></div>
      {err && <Aviso tipo="amar">{err}</Aviso>}
      <div className="scroll" style={{ marginTop: '.8rem' }}>
        <table>
          <thead><tr><th>Fecha</th><th>Estrategia / docentes</th><th>Actividad</th><th>Seguimientos</th></tr></thead>
          <tbody>
            {rows?.map((a) => <tr key={a.id}><td>{fmtFecha(a.fecha)}<div><span className="pill gris">{a.tipo === 'GRUPAL' ? 'Grupal' : 'Individual'}</span></div></td><td><b>{a.estrategia}</b><div style={{ color: 'var(--gris)' }}>{a.docentes}</div></td><td>{a.tipo_actividad}<div style={{ color: 'var(--gris)' }}>{a.duracion_min} min</div></td><td>{a.seguimientos.length ? a.seguimientos.map((s: any) => <div key={s.id}>• {fmtFecha(s.semana_inicio)}: {s.avance}</div>) : <span style={{ color: 'var(--gris)' }}>—</span>}</td></tr>)}
            {rows && !rows.length && <tr><td colSpan={4} className="vacio">No hay registros con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Locales({ onCorregir }: { onCorregir: (p: any) => void }) {
  const u = sesion.usuario()!;
  const cola = useLive(() => db.cola.where('usuario').equals(u.id).reverse().sortBy('creado'), [] as ItemCola[]);
  const bor = useLive(() => db.borradores.where('usuario').equals(u.id).toArray(), [] as any[]);
  const pill = (e: string) => <span className={`pill ${e === 'SINCRONIZADO' ? 'verde' : e === 'RECHAZADO' ? 'rojo' : 'amar'}`}>{e === 'SINCRONIZADO' ? 'Sincronizado' : e === 'RECHAZADO' ? 'Rechazado' : 'Pendiente'}</span>;
  return (
    <>
      <div className="card">
        <h2>Registros guardados en este dispositivo</h2>
        <Aviso tipo="info">Los pendientes se envían solos al volver la conexión. Los rechazados no cumplieron una regla del servidor: corrígelos y vuelve a guardarlos.</Aviso>
        <div className="scroll"><table>
          <thead><tr><th>Registro</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {cola.map((x) => <tr key={x.clave}>
              <td>{x.resumen}{x.motivo && <div className="err">{x.motivo}</div>}</td><td>{pill(x.estado)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {x.estado === 'RECHAZADO' && x.tipo === 'ACOMPANAMIENTO' && <button className="btn sec peq" onClick={async () => { await db.cola.delete(x.clave); onCorregir({ ...x.datos, id: nuevoId() }); }}>Corregir</button>}{' '}
                {x.estado !== 'PENDIENTE' && <button className="btn sec peq" onClick={() => db.cola.delete(x.clave)}>Quitar</button>}
              </td></tr>)}
            {!cola.length && <tr><td colSpan={3} className="vacio">Aún no has guardado registros en este dispositivo.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Borradores</h2>
        {bor.length ? <table><tbody>{bor.map((b) => <tr key={b.id}><td>{b.datos.observaciones?.slice(0, 70) || 'Borrador sin observaciones'}<div style={{ color: 'var(--gris)', fontSize: '.8rem' }}>{new Date(b.actualizado).toLocaleString('es-CO')}</div></td><td style={{ whiteSpace: 'nowrap' }}><button className="btn sec peq" onClick={() => onCorregir(b.datos)}>Continuar</button> <button className="btn sec peq" onClick={() => db.borradores.delete(b.id)}>Eliminar</button></td></tr>)}</tbody></table> : <div className="vacio">No tienes borradores.</div>}
      </div>
    </>
  );
}
