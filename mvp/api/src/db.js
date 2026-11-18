import pg from 'pg';
// Pool de 20 conexiones por instancia (RNF_001)
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/sses',
  max: 20,
});
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
