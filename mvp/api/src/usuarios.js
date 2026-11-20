import { Router } from 'express';
import { z } from 'zod';
import { q, audit } from './db.js';
import { hashClave, rol } from './auth.js';
import { HttpError } from './util.js';

export const usuariosRouter = Router();

const ROLES_VALIDOS = ['ADMINISTRADOR', 'COORDINADOR_INSTITUCIONAL', 'TUTOR_LIDER', 'TUTOR_DOCENTE', 'ENTE_CONTROL', 'RECTOR'];

const crearSchema = z.object({
  nombre:  z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(120),
  correo:  z.string().email('Correo no válido').max(120),
  clave:   z.string().min(8, 'La clave debe tener al menos 8 caracteres').max(128),
  rolUsuario: z.enum(ROLES_VALIDOS, { errorMap: () => ({ message: 'Rol no válido' }) }),
});

// GET /api/usuarios — lista todos los usuarios (solo ADMINISTRADOR)
usuariosRouter.get('/', rol('ADMINISTRADOR'), async (_req, res) => {
  const { rows } = await q(
    'SELECT id, nombre, correo, rol, bloqueado_hasta, intentos_fallidos FROM usuarios ORDER BY nombre'
  );
  res.json(rows);
});

// POST /api/usuarios — crea un nuevo usuario (solo ADMINISTRADOR)
usuariosRouter.post('/', rol('ADMINISTRADOR'), async (req, res) => {
  const { nombre, correo, clave, rolUsuario } = crearSchema.parse(req.body);

  // Verificar que el correo no esté ya en uso
  const { rows: existe } = await q('SELECT id FROM usuarios WHERE lower(correo)=lower($1)', [correo]);
  if (existe.length > 0) throw new HttpError(409, 'Ya existe un usuario con ese correo.');

  const clave_hash = await hashClave(clave);
  const { rows } = await q(
    'INSERT INTO usuarios (nombre, correo, clave_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, correo, rol',
    [nombre, correo, clave_hash, rolUsuario]
  );
  const usuario = rows[0];
  await audit(null, req, 'CREAR_USUARIO', 'usuarios', usuario.id);
  res.status(201).json(usuario);
});

// PATCH /api/usuarios/:id — edita nombre, correo, clave y/o rol (solo ADMINISTRADOR)
const editarSchema = z.object({
  nombre:     z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(120).optional(),
  correo:     z.string().email('Correo no válido').max(120).optional(),
  clave:      z.string().min(8, 'La clave debe tener al menos 8 caracteres').max(128).optional(),
  rolUsuario: z.enum(ROLES_VALIDOS, { errorMap: () => ({ message: 'Rol no válido' }) }).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Debes enviar al menos un campo para actualizar.' });

usuariosRouter.patch('/:id', rol('ADMINISTRADOR'), async (req, res) => {
  const { id } = req.params;
  const data = editarSchema.parse(req.body);

  // Verificar que el usuario exista
  const { rows: existe } = await q('SELECT id FROM usuarios WHERE id=$1', [id]);
  if (existe.length === 0) throw new HttpError(404, 'Usuario no encontrado.');

  // Si cambia correo, verificar unicidad
  if (data.correo) {
    const { rows: dup } = await q('SELECT id FROM usuarios WHERE lower(correo)=lower($1) AND id<>$2', [data.correo, id]);
    if (dup.length > 0) throw new HttpError(409, 'Ya existe otro usuario con ese correo.');
  }

  // Construir SET dinámico
  const sets = [];
  const vals = [];
  if (data.nombre)     { sets.push(`nombre=$${sets.length + 1}`);     vals.push(data.nombre); }
  if (data.correo)     { sets.push(`correo=$${sets.length + 1}`);     vals.push(data.correo); }
  if (data.clave)      { sets.push(`clave_hash=$${sets.length + 1}`); vals.push(await hashClave(data.clave)); }
  if (data.rolUsuario) { sets.push(`rol=$${sets.length + 1}`);        vals.push(data.rolUsuario); }
  vals.push(id);

  const { rows } = await q(
    `UPDATE usuarios SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id, nombre, correo, rol`,
    vals
  );
  await audit(null, req, 'EDITAR_USUARIO', 'usuarios', id, { campos: Object.keys(data) });
  res.json(rows[0]);
});

// DELETE /api/usuarios/:id — elimina un usuario (solo ADMINISTRADOR, no puede eliminarse a sí mismo)
usuariosRouter.delete('/:id', rol('ADMINISTRADOR'), async (req, res) => {
  const { id } = req.params;
  if (id === req.user.sub) throw new HttpError(400, 'No puedes eliminarte a ti mismo.');

  const { rows } = await q('DELETE FROM usuarios WHERE id=$1 RETURNING id', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Usuario no encontrado.');
  await audit(null, req, 'ELIMINAR_USUARIO', 'usuarios', id);
  res.status(204).end();
});
