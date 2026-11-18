import { ReactNode, useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

export const fmtFecha = (f: string) => (f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const hoyISO = () => new Date().toISOString().slice(0, 10);
export const mesISO = (d = new Date()) => d.toISOString().slice(0, 7);

export function Aviso({ tipo = 'info', children }: { tipo?: 'ok' | 'mal' | 'info' | 'amar'; children: ReactNode }) {
  return <div className={`aviso ${tipo}`} role={tipo === 'mal' ? 'alert' : 'status'}>{children}</div>;
}

export function Campo({ etiqueta, error, children }: { etiqueta: string; error?: string; children: ReactNode }) {
  return <div><label>{etiqueta}</label>{children}{error && <div className="err">{error}</div>}</div>;
}

export function Modal({ titulo, children, onCerrar }: { titulo: string; children: ReactNode; onCerrar: () => void }) {
  return <div className="modal" onClick={onCerrar}><div className="card" onClick={(e) => e.stopPropagation()}><h2>{titulo}</h2>{children}</div></div>;
}

export function Tabs({ tabs, actual, onCambio }: { tabs: [string, string][]; actual: string; onCambio: (k: string) => void }) {
  return <div className="tabs">{tabs.map(([k, t]) => <button key={k} className={k === actual ? 'act' : ''} onClick={() => onCambio(k)}>{t}</button>)}</div>;
}

export function Graf({ tipo = 'bar', etiquetas, series, apilado, alto = 260 }: { tipo?: 'bar' | 'line'; etiquetas: string[]; series: { nombre: string; datos: number[]; color?: string }[]; apilado?: boolean; alto?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // Paleta categórica validada (contraste y daltonismo): azul, teal, ámbar, terracota
    const colores = ['#1d6a96', '#2f9e8f', '#e0a02c', '#c2553b'];
    const ch = new Chart(ref.current, {
      type: tipo,
      data: { labels: etiquetas, datasets: series.map((s, i) => ({ label: s.nombre, data: s.datos, backgroundColor: s.color || colores[i % 4], borderColor: s.color || colores[i % 4], borderRadius: 4 })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: series.length > 1 } }, scales: { x: { stacked: apilado }, y: { beginAtZero: true, stacked: apilado, ticks: { precision: 0 } } } },
    });
    return () => ch.destroy();
  }, [JSON.stringify(etiquetas), JSON.stringify(series), tipo]);
  return <div style={{ height: alto }}><canvas ref={ref} /></div>;
}

export function useCarga<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const recargar = () => {
    setCargando(true);
    fn().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.sinConexion ? 'Sin conexión: esta información necesita internet.' : e.message)).finally(() => setCargando(false));
  };
  useEffect(recargar, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, cargando, recargar, setData };
}

export const textoEstado = (e: string) => ({ SIN_ESTUDIANTES: 'Sin estudiantes', CON_ESTUDIANTES: 'Con estudiantes' } as any)[e] || e;
