// Almacenamiento en el dispositivo (IndexedDB con Dexie): cola de registros, borradores y datos de trabajo.
import Dexie, { Table } from 'dexie';

export type ItemCola = {
  clave: string; tipo: 'ACOMPANAMIENTO' | 'SEGUIMIENTO'; datos: any;
  estado: 'PENDIENTE' | 'SINCRONIZADO' | 'RECHAZADO'; motivo?: string; creado: number; resumen: string; usuario: string;
};
export type Borrador = { id: string; usuario: string; datos: any; actualizado: number };

class SsesDB extends Dexie {
  cola!: Table<ItemCola, string>;
  borradores!: Table<Borrador, string>;
  datos!: Table<{ k: string; v: any }, string>;
  constructor() {
    super('sses');
    this.version(1).stores({ cola: 'clave, estado, creado, usuario', borradores: 'id, usuario', datos: 'k' });
  }
}
export const db = new SsesDB();

// Al cerrar sesión se borra todo lo descargado en el dispositivo
export async function limpiarDispositivo() {
  await Promise.all([db.cola.clear(), db.borradores.clear(), db.datos.clear()]);
}
