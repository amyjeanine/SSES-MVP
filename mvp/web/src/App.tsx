import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, conexion, sesion, Usuario } from './api';
import { limpiarDispositivo, db } from './db';
import { sincronizar, useEstadoSync, useLive } from './sync';
import { Aviso } from './ui';
import Estrategias from './pages/estrategias';
import Acompanamientos from './pages/acompanamientos';
import Reportes from './pages/reportes';
import Sesiones from './pages/sesiones';
import Instrumento from './pages/instrumento';
import Percepcion from './pages/percepcion';
import Control from './pages/control';
import Usuarios from './pages/usuarios';

const NOMBRE_ROL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador', COORDINADOR_INSTITUCIONAL: 'Coordinador institucional', TUTOR_LIDER: 'Tutor líder', TUTOR_DOCENTE: 'Tutor docente', ENTE_CONTROL: 'Ente de Control', RECTOR: 'Rector',
};
const MENU: Record<string, [string, string][]> = {
  ADMINISTRADOR: [['estrategias', 'Estrategias'], ['usuarios', 'Usuarios']],
  COORDINADOR_INSTITUCIONAL: [['reportes', 'Reportes de desempeño'], ['sesiones', 'Sesiones del piloto'], ['percepcion', 'Percepción de tutores'], ['control', 'Reportes de ley']],
  TUTOR_LIDER: [['acompanamientos', 'Acompañamientos'], ['instrumento', 'Instrumento de percepción']],
  TUTOR_DOCENTE: [['instrumento', 'Instrumento de percepción']],
  ENTE_CONTROL: [['control', 'Reportes de control y de ley'], ['percepcion', 'Percepción de tutores']],
  RECTOR: [['reportes', 'Reportes de desempeño'], ['control', 'Reportes de ley']],
};
const DEMO = [['admin@sses.gov.co', 'Administrador'], ['coordinador@sses.gov.co', 'Coordinador institucional'], ['lider1@sses.gov.co', 'Tutor líder'], ['docente1@sses.gov.co', 'Tutor docente'], ['control@sses.gov.co', 'Ente de Control'], ['rector@sses.gov.co', 'Rector']];

const useHash = () => useSyncExternalStore((f) => { window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, () => location.hash.slice(2) || '');
const useConexion = () => useSyncExternalStore((f) => conexion.suscribir(f), () => conexion.sin);

function Login({ onEntrar }: { onEntrar: (u: Usuario) => void }) {
  const [correo, setCorreo] = useState(''); const [clave, setClave] = useState('');
  const [error, setError] = useState(''); const [cargando, setCargando] = useState(false);
  const entrar = async (e?: React.FormEvent, c = correo, k = clave) => {
    e?.preventDefault(); setError(''); setCargando(true);
    try {
      const r = await api('POST', '/auth/login', { correo: c, clave: k });
      sesion.guardar(r.acceso, r.refresco, r.usuario); onEntrar(r.usuario);
    } catch (err: any) { setError(err.sinConexion ? 'Sin conexión: para iniciar sesión necesitas internet.' : err.message); }
    setCargando(false);
  };
  return (
    <div className="login">
      <div className="card">
        <div className="marca" style={{ color: 'var(--azul)', fontSize: '1.6rem' }}>SSES<small style={{ fontSize: '.8rem', color: 'var(--gris)' }}>Sistema de Seguimiento de Estrategias Estudiantiles · Piloto</small></div>
        <form onSubmit={entrar}>
          <label>Correo</label><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="username" required />
          <label>Contraseña</label><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required />
          {error && <Aviso tipo="mal">{error}</Aviso>}
          <div className="acciones"><button className="btn" disabled={cargando}>{cargando ? 'Entrando…' : 'Ingresar'}</button></div>
        </form>
        <hr style={{ border: 0, borderTop: '1px solid var(--borde)', margin: '1.2rem 0 .8rem' }} />
        <small style={{ color: 'var(--gris)' }}>Usuarios de demostración (clave: Sses2026*)</small>
        <div className="demo">{DEMO.map(([c, n]) => <button key={c} type="button" className="btn sec peq" onClick={() => { setCorreo(c); setClave('Sses2026*'); void entrar(undefined, c, 'Sses2026*'); }}>{n}</button>)}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(sesion.usuario());
  const ruta = useHash();
  const sinConexion = useConexion();
  const sync = useEstadoSync();
  const pendientes = useLive(() => (usuario ? db.cola.where('estado').equals('PENDIENTE').and((x) => x.usuario === usuario.id).count() : 0), 0, [usuario?.id]);

  useEffect(() => {
    const f = () => { sesion.limpiar(); setUsuario(null); };
    window.addEventListener('sses:sesion-vencida', f);
    return () => window.removeEventListener('sses:sesion-vencida', f);
  }, []);

  const salir = async () => {
    if (pendientes && !confirm(`Tienes ${pendientes} registro(s) sin sincronizar. Si sales, se perderán. ¿Salir de todos modos?`)) return;
    await limpiarDispositivo(); sesion.limpiar(); setUsuario(null); location.hash = '';
  };
  if (!usuario) return <Login onEntrar={(u) => { setUsuario(u); location.hash = ''; }} />;

  const menu = MENU[usuario.rol] || [];
  const actual = menu.find(([k]) => k === ruta)?.[0] || menu[0]?.[0];
  const pagina = {
    estrategias: <Estrategias />, acompanamientos: <Acompanamientos />, reportes: <Reportes />, sesiones: <Sesiones />,
    instrumento: <Instrumento />, percepcion: <Percepcion />, control: <Control />, usuarios: <Usuarios />,
  }[actual as string];

  return (
    <div className="app">
      <header className="top">
        <div className="marca">SSES<small>Piloto · MinEducación</small></div>
        <nav className="menu">{menu.map(([k, t]) => <a key={k} href={`#/${k}`} className={k === actual ? 'act' : ''}>{t}</a>)}</nav>
        <div className="estado">
          <span className={`pill ${sinConexion ? 'off' : 'on'}`}>{sinConexion ? '● Sin conexión' : '● En línea'}</span>
          {usuario.rol === 'TUTOR_LIDER' && <>
            <span className="pill gris">{pendientes} por sincronizar</span>
            <button className="btn sec peq" style={{ background: 'transparent', color: '#fff', borderColor: '#9fc2d8' }} disabled={sinConexion || sync.sincronizando} onClick={() => sincronizar()}>{sync.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
          </>}
          <label className="sw" title="Para la demostración: simula que se cae el internet"><input type="checkbox" checked={conexion.forzado} onChange={(e) => conexion.forzar(e.target.checked)} /> Simular sin internet</label>
          <span>{usuario.nombre} · <b>{NOMBRE_ROL[usuario.rol]}</b></span>
          <button className="btn sec peq" style={{ background: 'transparent', color: '#fff', borderColor: '#9fc2d8' }} onClick={salir}>Salir</button>
        </div>
      </header>
      <main>{pagina}</main>
    </div>
  );
}
