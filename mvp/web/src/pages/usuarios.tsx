import { useState } from 'react';
import { api } from '../api';
import { Aviso, Campo, useCarga } from '../ui';

const ROLES = [
  'ADMINISTRADOR',
  'COORDINADOR_INSTITUCIONAL',
  'TUTOR_LIDER',
  'TUTOR_DOCENTE',
  'ENTE_CONTROL',
  'RECTOR',
] as const;

const NOMBRE_ROL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  COORDINADOR_INSTITUCIONAL: 'Coordinador Institucional',
  TUTOR_LIDER: 'Tutor Líder',
  TUTOR_DOCENTE: 'Tutor Docente',
  ENTE_CONTROL: 'Ente de Control',
  RECTOR: 'Rector',
};

interface Usuario {
  id: string;
  nombre: string;
  correo: string;
  rol: string;
  bloqueado_hasta: string | null;
  intentos_fallidos: number;
}

export default function Usuarios() {
  const { data, error, cargando, recargar } = useCarga<Usuario[]>(() =>
    api('GET', '/usuarios')
  );

  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [rolUsuario, setRolUsuario] = useState<string>('COORDINADOR_INSTITUCIONAL');
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState('');
  const [errForm, setErrForm] = useState('');
  const [eliminando, setEliminando] = useState<string | null>(null);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setErrForm('');
    setExito('');
    try {
      await api('POST', '/usuarios', { nombre, correo, clave, rolUsuario });
      setExito(`Usuario "${nombre}" creado correctamente.`);
      setNombre('');
      setCorreo('');
      setClave('');
      setRolUsuario('COORDINADOR_INSTITUCIONAL');
      recargar();
    } catch (err: any) {
      setErrForm(err.message || 'Error al crear el usuario.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id: string, nombreUsuario: string) => {
    if (!confirm(`¿Eliminar al usuario "${nombreUsuario}"? Esta acción no se puede deshacer.`)) return;
    setEliminando(id);
    try {
      await api('DELETE', `/usuarios/${id}`);
      recargar();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar el usuario.');
    } finally {
      setEliminando(null);
    }
  };

  return (
    <>
      <h1>Gestión de usuarios</h1>

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Crear nuevo usuario</h2>
        <form onSubmit={crear} style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
          <Campo etiqueta="Nombre completo">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              minLength={2}
              maxLength={120}
              placeholder="Ej. Carlos Ramírez"
            />
          </Campo>
          <Campo etiqueta="Correo electrónico">
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              required
              maxLength={120}
              placeholder="correo@ejemplo.com"
            />
          </Campo>
          <Campo etiqueta="Contraseña inicial">
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              placeholder="Mínimo 8 caracteres"
            />
          </Campo>
          <Campo etiqueta="Rol">
            <select value={rolUsuario} onChange={(e) => setRolUsuario(e.target.value)} required>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_ROL[r]}
                </option>
              ))}
            </select>
          </Campo>
          {errForm && <Aviso tipo="mal">{errForm}</Aviso>}
          {exito && <Aviso tipo="ok">{exito}</Aviso>}
          <button type="submit" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear usuario'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Usuarios registrados</h2>
        {cargando && <p>Cargando…</p>}
        {error && <Aviso tipo="mal">{error}</Aviso>}
        {data && data.length === 0 && <p>No hay usuarios registrados.</p>}
        {data && data.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Correo</th>
                <th style={th}>Rol</th>
                <th style={th}>Estado</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td style={td}>{u.nombre}</td>
                  <td style={td}>{u.correo}</td>
                  <td style={td}>{NOMBRE_ROL[u.rol] ?? u.rol}</td>
                  <td style={td}>
                    {u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()
                      ? <span style={{ color: '#c2553b' }}>Bloqueado</span>
                      : <span style={{ color: '#2f9e8f' }}>Activo</span>
                    }
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      className="btn mal peq"
                      onClick={() => eliminar(u.id, u.nombre)}
                      disabled={eliminando === u.id}
                    >
                      {eliminando === u.id ? '…' : 'Eliminar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '2px solid var(--borde, #ddd)',
  fontWeight: 600,
};
const td: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid var(--borde, #eee)',
  verticalAlign: 'middle',
};
