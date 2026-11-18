// Cliente de la API: agrega el token, renueva la sesión y distingue "sin conexión" de un error del servidor.
export type Usuario = { id: string; nombre: string; rol: string; correo: string };
export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = null) { super(message); }
  get sinConexion() { return this.status === 0; }
}

const K = { acceso: 'sses.acceso', refresco: 'sses.refresco', usuario: 'sses.usuario' };
export const sesion = {
  usuario(): Usuario | null { try { return JSON.parse(localStorage.getItem(K.usuario) || 'null'); } catch { return null; } },
  guardar(acceso: string, refresco: string, u: Usuario) { localStorage.setItem(K.acceso, acceso); localStorage.setItem(K.refresco, refresco); localStorage.setItem(K.usuario, JSON.stringify(u)); },
  limpiar() { Object.values(K).forEach((k) => localStorage.removeItem(k)); },
  acceso: () => localStorage.getItem(K.acceso),
};

// Para la demostración: simula que no hay internet sin tener que desconectar nada
let forzadoSinConexion = localStorage.getItem('sses.offline') === '1';
const oyentes = new Set<() => void>();
export const conexion = {
  get sin() { return forzadoSinConexion || !navigator.onLine; },
  get forzado() { return forzadoSinConexion; },
  forzar(v: boolean) { forzadoSinConexion = v; localStorage.setItem('sses.offline', v ? '1' : '0'); oyentes.forEach((f) => f()); },
  suscribir(f: () => void) {
    oyentes.add(f);
    window.addEventListener('online', f); window.addEventListener('offline', f);
    return () => { oyentes.delete(f); window.removeEventListener('online', f); window.removeEventListener('offline', f); };
  },
};

async function pedir(metodo: string, ruta: string, cuerpo?: any, intentoRefresco = true): Promise<Response> {
  if (conexion.sin) throw new ApiError(0, 'Sin conexión');
  let r: Response;
  try {
    r = await fetch('/api' + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-sses-cliente': 'pwa', ...(sesion.acceso() ? { Authorization: `Bearer ${sesion.acceso()}` } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sin conexión');
  }
  if (r.status === 401 && intentoRefresco && ruta !== '/auth/login') {
    const ref = localStorage.getItem(K.refresco);
    if (ref) {
      const rr = await fetch('/api/auth/refrescar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sses-cliente': 'pwa' }, body: JSON.stringify({ refresco: ref }) }).catch(() => null);
      if (rr?.ok) { localStorage.setItem(K.acceso, (await rr.json()).acceso); return pedir(metodo, ruta, cuerpo, false); }
    }
    sesion.limpiar();
    window.dispatchEvent(new Event('sses:sesion-vencida'));
  }
  return r;
}

export async function api<T = any>(metodo: string, ruta: string, cuerpo?: any): Promise<T> {
  const r = await pedir(metodo, ruta, cuerpo);
  let data: any = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new ApiError(r.status, data?.error || 'Error del servidor', data);
  return data as T;
}

export async function descargar(metodo: string, ruta: string, nombre: string, cuerpo?: any) {
  const r = await pedir(metodo, ruta, cuerpo);
  if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).error || 'No se pudo descargar');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
