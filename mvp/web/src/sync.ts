// RF_004 · cola sin conexión y sincronización por lotes de 50, con reintentos 1, 2, 4, 8 y 16 s
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { db, ItemCola } from './db';
import { api, conexion, sesion, nuevoId } from './api';

let enCurso = false;
const estadoOyentes = new Set<(s: { sincronizando: boolean; ultimo?: string }) => void>();
let estado: { sincronizando: boolean; ultimo?: string } = { sincronizando: false };
const emitir = (e: typeof estado) => { estado = e; estadoOyentes.forEach((f) => f(e)); };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function encolar(tipo: ItemCola['tipo'], datos: any, resumen: string) {
  const u = sesion.usuario()!;
  const item: ItemCola = { clave: datos.id || nuevoId(), tipo, datos, estado: 'PENDIENTE', creado: Date.now(), resumen, usuario: u.id };
  await db.cola.put(item);
  void sincronizar();
  return item;
}

export async function sincronizar(): Promise<{ enviados: number; rechazados: number } | null> {
  if (enCurso || conexion.sin || !sesion.acceso()) return null;
  const u = sesion.usuario();
  if (u?.rol !== 'TUTOR_LIDER') return null;
  enCurso = true; emitir({ ...estado, sincronizando: true });
  let enviados = 0, rechazados = 0;
  try {
    const pendientes = (await db.cola.where('estado').equals('PENDIENTE').and((x) => x.usuario === u.id).sortBy('creado'));
    for (let i = 0; i < pendientes.length; i += 50) {
      const lote = pendientes.slice(i, i + 50);
      let ok = false;
      for (const demora of [0, 1000, 2000, 4000, 8000, 16000]) {
        if (demora) await espera(demora);
        try {
          const r = await api<{ resultados: { clave: string; estado: string; motivo?: string }[] }>('POST', '/sincronizacion', {
            registros: lote.map((x) => ({ clave: x.clave, tipo: x.tipo, datos: x.datos })),
          });
          for (const res of r.resultados) {
            await db.cola.update(res.clave, { estado: res.estado as any, motivo: res.motivo });
            res.estado === 'SINCRONIZADO' ? enviados++ : rechazados++;
          }
          ok = true; break;
        } catch (e: any) {
          if (!e.sinConexion && e.status !== 0) throw e; // error real del servidor: no se reintenta a ciegas
          if (conexion.sin) break;
        }
      }
      if (!ok) break;
    }
    emitir({ sincronizando: false, ultimo: new Date().toLocaleTimeString('es-CO') });
  } catch {
    emitir({ ...estado, sincronizando: false });
  } finally {
    enCurso = false; emitir({ ...estado, sincronizando: false });
  }
  return { enviados, rechazados };
}

export function useEstadoSync() {
  const [s, setS] = useState(estado);
  useEffect(() => { estadoOyentes.add(setS); return () => { estadoOyentes.delete(setS); }; }, []);
  return s;
}

export function useLive<T>(consulta: () => Promise<T> | T, inicial: T, deps: any[] = []): T {
  const [v, setV] = useState<T>(inicial);
  useEffect(() => {
    const sub = liveQuery(consulta).subscribe({ next: setV, error: () => {} });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

// Arranque: sincroniza al volver la conexión y cada 30 s mientras haya pendientes
export function iniciarSincronizacion() {
  conexion.suscribir(() => { if (!conexion.sin) void sincronizar(); });
  setInterval(async () => { if (!conexion.sin && (await db.cola.where('estado').equals('PENDIENTE').count())) void sincronizar(); }, 30000);
}
