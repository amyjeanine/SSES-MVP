import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { q, audit } from './db.js';
import { HttpError } from './util.js';

// Llaves RS256: se generan una vez y se guardan para que los tokens sobrevivan reinicios
const keyDir = process.env.KEY_DIR || path.resolve('keys');
fs.mkdirSync(keyDir, { recursive: true });
const pubFile = path.join(keyDir, 'public.pem');
const privFile = path.join(keyDir, 'private.pem');
if (!fs.existsSync(privFile)) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.writeFileSync(pubFile, publicKey);
  fs.writeFileSync(privFile, privateKey, { mode: 0o600 });
}
const PUBLIC = fs.readFileSync(pubFile, 'utf8');
const PRIVATE = fs.readFileSync(privFile, 'utf8');

const firmar = (u, tipo, exp) =>
  jwt.sign({ sub: u.id, rol: u.rol, nombre: u.nombre, entidad_id: u.entidad_id ?? null, tipo }, PRIVATE, { algorithm: 'RS256', expiresIn: exp });

// Filtro de seguridad: valida el token (RS256) en cada petición
export function autenticar(req, _res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return next(new HttpError(401, 'Falta iniciar sesión'));
  try {
    const p = jwt.verify(h.slice(7), PUBLIC, { algorithms: ['RS256'] });
    if (p.tipo !== 'acceso') throw new Error('tipo');
    req.user = p;
    next();
  } catch {
    next(new HttpError(401, 'Sesión vencida o no válida'));
  }
}

// Control de acceso por rol (RBAC) en la API, no solo en la pantalla
export const rol = (...roles) => (req, _res, next) =>
  roles.includes(req.user.rol) ? next() : next(new HttpError(403, 'Tu rol no tiene permiso para esta acción'));

// El Ente de Control solo lee: cualquier escritura se rechaza con 403 (RF_006)
export function soloLecturaEnteControl(req, _res, next) {
  if (req.user?.rol === 'ENTE_CONTROL' && !['GET', 'HEAD'].includes(req.method))
    return next(new HttpError(403, 'El Ente de Control solo tiene permisos de lectura'));
  next();
}

export const authRouter = Router();
const loginSchema = z.object({ correo: z.string().email(), clave: z.string().min(1) });

authRouter.post('/login', async (req, res) => {
  const { correo, clave } = loginSchema.parse(req.body);
  const { rows } = await q('SELECT * FROM usuarios WHERE lower(correo)=lower($1)', [correo]);
  const u = rows[0];
  if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date())
    throw new HttpError(423, 'Cuenta bloqueada por intentos fallidos. Intenta de nuevo en unos minutos.');
  const ok = u && (await bcrypt.compare(clave, u.clave_hash));
  if (!ok) {
    if (u) {
      const bloqueo = u.intentos_fallidos + 1 >= 5;
      await q('UPDATE usuarios SET intentos_fallidos=$2, bloqueado_hasta=$3 WHERE id=$1', [
        u.id, bloqueo ? 0 : u.intentos_fallidos + 1, bloqueo ? new Date(Date.now() + 15 * 60000) : null]);
    }
    throw new HttpError(401, 'Correo o contraseña incorrectos');
  }
  await q('UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=$1', [u.id]);
  await audit(null, { user: { sub: u.id, rol: u.rol } }, 'INICIO_SESION', 'usuarios', u.id);
  res.json({
    acceso: firmar(u, 'acceso', '15m'),
    refresco: firmar(u, 'refresco', '8h'),
    usuario: { id: u.id, nombre: u.nombre, rol: u.rol, correo: u.correo },
  });
});

authRouter.post('/refrescar', async (req, res) => {
  try {
    const p = jwt.verify(String(req.body?.refresco || ''), PUBLIC, { algorithms: ['RS256'] });
    if (p.tipo !== 'refresco') throw new Error('tipo');
    res.json({ acceso: firmar({ id: p.sub, rol: p.rol, nombre: p.nombre, entidad_id: p.entidad_id ?? null }, 'acceso', '15m') });
  } catch {
    throw new HttpError(401, 'Sesión vencida: vuelve a iniciar sesión');
  }
});

export const hashClave = (c) => bcrypt.hash(c, 12);
