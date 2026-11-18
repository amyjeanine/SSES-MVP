import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { ZodError } from 'zod';
import { authRouter, autenticar, soloLecturaEnteControl } from './auth.js';
import { estrategias, catalogos } from './estrategias.js';
import { acomp, sincro } from './acompanamientos.js';
import { pilotaje, instrumentos } from './pilotaje.js';
import { reportes, control } from './reportes.js';
import { q } from './db.js';
import { HttpError } from './util.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Anti-CSRF: las peticiones que cambian datos deben venir de nuestra aplicación (cabecera propia + token Bearer, sin cookies)
app.use('/api', (req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-sses-cliente'] !== 'pwa')
    return next(new HttpError(403, 'Petición no permitida'));
  next();
});

app.get('/api/salud', async (_req, res) => {
  await q('SELECT 1');
  res.json({ ok: true, hora: new Date().toISOString() });
});
app.use('/api/auth', authRouter);

app.use('/api', autenticar, soloLecturaEnteControl);
app.use('/api/estrategias', estrategias);
app.use('/api', catalogos);
app.use('/api/acompanamientos', acomp);
app.use('/api/sincronizacion', sincro);
app.use('/api/pilotaje', pilotaje);
app.use('/api/instrumentos', instrumentos);
app.use('/api/reportes', reportes);
app.use('/api/control', control);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Servicio no encontrado')));

// Si existe la PWA compilada, la sirve (en Docker lo hace NGINX)
const dist = path.resolve(process.env.WEB_DIST || '../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

app.use((err, _req, res, _next) => {
  if (err instanceof ZodError)
    return res.status(400).json({ error: err.issues.map((i) => i.message).join('. '), campos: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.code === '23505') return res.status(409).json({ error: 'Ese registro ya existe (nombre repetido en la entidad o dato duplicado).' });
  if (err?.code === '23000') return res.status(409).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
});

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`SSES API escuchando en http://localhost:${port}`));
}
