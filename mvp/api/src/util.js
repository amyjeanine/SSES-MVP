export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const mesDe = (fecha) => String(fecha).slice(0, 7) + '-01';
// Lunes de la semana de una fecha (YYYY-MM-DD)
export function lunesDe(fecha) {
  const d = new Date(String(fecha).slice(0, 10) + 'T00:00:00Z');
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}
