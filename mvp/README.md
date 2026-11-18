# SSES – MVP (DeVora Technologies)

Sistema de Seguimiento de Estrategias Estudiantiles – piloto MinEducación.
PWA React + API Node/Express + PostgreSQL. Funciona sin internet (cola local + sincronización).

## Opción A – Docker (recomendada para la presentación)
1. Instala Docker Desktop (Windows: con WSL2).
2. En esta carpeta: `docker compose up --build`
3. Abre http://localhost:8080 (espera ~1 min la primera vez).
Cada vez que se inicia, los datos de ejemplo se reinician (3.000 estudiantes, 40 docentes, 4 estrategias).
Para repetir la demo limpia: `docker compose down` y `docker compose up`.

## Opción B – Sin Docker (Node 20+ y PostgreSQL 16/17)
```
createdb sses && psql -d sses -f db/init.sql
cd web && npm install && npm run build && cd ..
cd api && npm install && npm run seed
WEB_DIST=../web/dist npm start      # http://localhost:3000
```
(Si tu PostgreSQL tiene clave: `DATABASE_URL=postgres://usuario:clave@localhost:5432/sses`)

## Usuarios de demostración (clave `Sses2026*`)
| Rol | Correo |
|---|---|
| Administrador | admin@sses.gov.co |
| Coordinador institucional | coordinador@sses.gov.co |
| Tutor líder | lider1@sses.gov.co |
| Tutor docente | docente1@sses.gov.co |
| Ente de control (solo lectura) | control@sses.gov.co |

## Guion de demostración (≈ 6 min)
1. **Administrador**: crear una estrategia → asociar estudiantes (individual y por grupo, con confirmación) → asignar docentes. Intentar editarla ya con estudiantes: el sistema la bloquea.
2. **Tutor líder**: Calendario con días pendientes → **activar “Simular sin internet”** → registrar un acompañamiento (queda “Pendiente”, contador “1 por sincronizar”) → desactivar el interruptor: se sincroniza solo. Mostrar seguimiento semanal, historial con filtros y PDF, corrección dentro de 24 h.
3. **Coordinador**: Reportes de desempeño (KPIs, gráficas, exportar Excel) → Sesiones del piloto: registrar sesión, registrar incidente y marcarlo resuelto → Percepción de tutores.
4. **Tutor docente / líder**: Instrumento de percepción (escala 1–5, borrador, envío; luego queda solo lectura).
5. **Ente de control**: reportes de ley por periodo con descarga a Excel y bitácora de accesos; intentar modificar algo devuelve 403.
Mensaje comercial: lo que ven corresponde punto a punto a RF_001–RF_008 de la propuesta.

## Pruebas automáticas
`cd api && npm test` (API en marcha) – 12 pruebas sobre RF_001–RF_008, roles y anti-CSRF.
