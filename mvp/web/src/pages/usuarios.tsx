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

  // Estado para el modal de edición
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editCorreo, setEditCorreo] = useState('');
  const [editClave, setEditClave] = useState('');
  const [editRol, setEditRol] = useState('');
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [exitoEdit, setExitoEdit] = useState('');
  const [errEdit, setErrEdit] = useState('');

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

  const abrirEdicion = (u: Usuario) => {
    setEditando(u);
    setEditNombre(u.nombre);
    setEditCorreo(u.correo);
    setEditClave('');
    setEditRol(u.rol);
    setErrEdit('');
    setExitoEdit('');
  };

  const cerrarEdicion = () => {
    setEditando(null);
    setErrEdit('');
    setExitoEdit('');
  };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    setGuardandoEdit(true);
    setErrEdit('');
    setExitoEdit('');
    const payload: Record<string, string> = {};
    if (editNombre !== editando.nombre) payload.nombre = editNombre;
    if (editCorreo !== editando.correo) payload.correo = editCorreo;
    if (editClave.trim()) payload.clave = editClave;
    if (editRol !== editando.rol) payload.rolUsuario = editRol;
    if (Object.keys(payload).length === 0) {
      setErrEdit('No hay cambios para guardar.');
      setGuardandoEdit(false);
      return;
    }
    try {
      await api('PATCH', `/usuarios/${editando.id}`, payload);
      setExitoEdit('Usuario actualizado correctamente.');
      recargar();
      setTimeout(cerrarEdicion, 1200);
    } catch (err: any) {
      setErrEdit(err.message || 'Error al actualizar el usuario.');
    } finally {
      setGuardandoEdit(false);
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
                  <td style={{ ...td, textAlign: 'right', display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                    <button
                      className="btn peq"
                      style={{ background: 'var(--primario, #2f9e8f)', color: '#fff', border: 'none' }}
                      onClick={() => abrirEdicion(u)}
                    >
                      Editar
                    </button>
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

      {/* Modal de edición */}
      {editando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, margin: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0 }}>Editar usuario</h2>
            <p style={{ color: 'var(--secundario, #666)', marginTop: 0, fontSize: '0.9rem' }}>{editando.nombre}</p>
            <form onSubmit={guardarEdicion} style={{ display: 'grid', gap: '0.75rem' }}>
              <Campo etiqueta="Nombre completo">
                <input
                  type="text"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </Campo>
              <Campo etiqueta="Correo electrónico">
                <input
                  type="email"
                  value={editCorreo}
                  onChange={(e) => setEditCorreo(e.target.value)}
                  required
                  maxLength={120}
                />
              </Campo>
              <Campo etiqueta="Nueva contraseña (dejar en blanco para no cambiar)">
                <input
                  type="password"
                  value={editClave}
                  onChange={(e) => setEditClave(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  placeholder="Mínimo 8 caracteres"
                />
              </Campo>
              <Campo etiqueta="Rol">
                <select value={editRol} onChange={(e) => setEditRol(e.target.value)} required>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {NOMBRE_ROL[r]}
                    </option>
                  ))}
                </select>
              </Campo>
              {errEdit && <Aviso tipo="mal">{errEdit}</Aviso>}
              {exitoEdit && <Aviso tipo="ok">{exitoEdit}</Aviso>}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn" style={{ background: 'var(--borde, #ddd)', color: '#333' }} onClick={cerrarEdicion}>
                  Cancelar
                </button>
                <button type="submit" disabled={guardandoEdit}>
                  {guardandoEdit ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
