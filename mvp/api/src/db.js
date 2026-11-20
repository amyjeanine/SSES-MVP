import pg from 'pg';
// Pool de 20 conexiones por instancia (RNF_001)
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/sses',
  max: 20,
});

// Migración idempotente: agrega RECTOR al CHECK constraint de usuarios.rol si aún no está
pool.connect().then(async (c) => {
  try {
    await c.query('BEGIN');
    // Verifica si el constraint ya incluye RECTOR
    const { rows } = await c.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'usuarios'::regclass AND contype = 'c' AND conname LIKE '%rol%'
      LIMIT 1
    `);
    if (rows.length > 0 && !rows[0].def.includes('RECTOR')) {
      // Elimina el constraint viejo y lo recrea con RECTOR incluido
      await c.query(`
        ALTER TABLE usuarios
          DROP CONSTRAINT IF EXISTS usuarios_rol_check,
          DROP CONSTRAINT IF EXISTS "usuarios_rol_check1";
      `);
      await c.query(`
        ALTER TABLE usuarios
          ADD CONSTRAINT usuarios_rol_check
          CHECK (rol IN ('ADMINISTRADOR','COORDINADOR_INSTITUCIONAL','TUTOR_LIDER','TUTOR_DOCENTE','ENTE_CONTROL','RECTOR'));
      `);
      console.log('[db] Migración aplicada: RECTOR agregado al CHECK de usuarios.rol');
    }

    // Migración idempotente: agrega entidad_id a usuarios si aún no existe
    await c.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS entidad_id uuid REFERENCES entidades(id);
    `);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[db] Error en migración de roles:', e.message);
  } finally {
    c.release();
  }
}).catch((e) => console.error('[db] No se pudo conectar para migración:', e.message));

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(client, req, accion, objeto, objeto_id, detalle = null) {
  const run = (client || pool).query.bind(client || pool);
  await run(
    'INSERT INTO auditoria (usuario_id, rol, accion, objeto, objeto_id, detalle) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.user?.sub ?? null, req.user?.rol ?? null, accion, objeto, objeto_id ? String(objeto_id) : null, detalle]
  );
}
