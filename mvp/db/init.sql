-- SSES MVP · esquema PostgreSQL (versión 16/17)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE entidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  region text NOT NULL
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  correo text NOT NULL UNIQUE,
  clave_hash text NOT NULL,
  rol text NOT NULL CHECK (rol IN ('ADMINISTRADOR','COORDINADOR_INSTITUCIONAL','TUTOR_LIDER','TUTOR_DOCENTE','ENTE_CONTROL','RECTOR')),
  intentos_fallidos int NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz
);

CREATE TABLE estudiantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento text NOT NULL UNIQUE,
  nombre text NOT NULL,
  entidad_id uuid NOT NULL REFERENCES entidades(id)
);
CREATE INDEX idx_estudiantes_entidad ON estudiantes(entidad_id, documento);
CREATE INDEX idx_estudiantes_nombre ON estudiantes(lower(nombre) text_pattern_ops);

CREATE TABLE docentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento text NOT NULL UNIQUE,
  nombre text NOT NULL,
  entidad_id uuid NOT NULL REFERENCES entidades(id)
);

CREATE TABLE estrategias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (char_length(nombre) <= 150),
  descripcion text NOT NULL CHECK (char_length(descripcion) <= 1000),
  entidad_id uuid NOT NULL REFERENCES entidades(id),
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado text NOT NULL DEFAULT 'SIN_ESTUDIANTES' CHECK (estado IN ('SIN_ESTUDIANTES','CON_ESTUDIANTES')),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_fin > fecha_inicio),
  UNIQUE (entidad_id, nombre)
);

CREATE TABLE estrategia_estudiantes (
  estrategia_id uuid NOT NULL REFERENCES estrategias(id),
  estudiante_id uuid NOT NULL REFERENCES estudiantes(id),
  vinculado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estrategia_id, estudiante_id)
);

-- La regla "solo se edita mientras no tenga estudiantes" también vive en la base de datos
CREATE FUNCTION bloquear_edicion_estrategia() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM estrategia_estudiantes WHERE estrategia_id = OLD.id)
     AND (NEW.nombre, NEW.descripcion, NEW.entidad_id, NEW.fecha_inicio, NEW.fecha_fin)
         IS DISTINCT FROM (OLD.nombre, OLD.descripcion, OLD.entidad_id, OLD.fecha_inicio, OLD.fecha_fin) THEN
    RAISE EXCEPTION 'La estrategia ya tiene estudiantes vinculados y no se puede editar' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_bloquear_edicion BEFORE UPDATE ON estrategias
  FOR EACH ROW EXECUTE FUNCTION bloquear_edicion_estrategia();

CREATE TABLE estrategia_docentes (
  estrategia_id uuid NOT NULL REFERENCES estrategias(id),
  docente_id uuid NOT NULL REFERENCES docentes(id),
  PRIMARY KEY (estrategia_id, docente_id)
);
CREATE TABLE estrategia_tutores (
  estrategia_id uuid NOT NULL REFERENCES estrategias(id),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  PRIMARY KEY (estrategia_id, usuario_id)
);

CREATE TABLE acompanamientos (
  id uuid PRIMARY KEY,                       -- lo genera el dispositivo: envío idempotente
  estrategia_id uuid NOT NULL REFERENCES estrategias(id),
  tipo text NOT NULL CHECK (tipo IN ('INDIVIDUAL','GRUPAL')),
  fecha date NOT NULL,
  duracion_min int NOT NULL CHECK (duracion_min BETWEEN 5 AND 600),
  tipo_actividad text NOT NULL,
  observaciones text NOT NULL,
  compromisos text NOT NULL,
  areas_mejora text,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),   -- hora en que quedó en el servidor
  registrado_en timestamptz NOT NULL DEFAULT now(), -- hora en que el tutor lo registró (puede ser sin conexión)
  actualizado_en timestamptz
);
CREATE INDEX idx_acomp_fecha ON acompanamientos(fecha);
CREATE TABLE acompanamiento_docentes (
  acompanamiento_id uuid NOT NULL REFERENCES acompanamientos(id) ON DELETE CASCADE,
  estrategia_id uuid NOT NULL,
  docente_id uuid NOT NULL REFERENCES docentes(id),
  mes date NOT NULL,
  PRIMARY KEY (acompanamiento_id, docente_id),
  UNIQUE (estrategia_id, docente_id, mes)         -- un acompañamiento por docente por mes
);
CREATE TABLE seguimientos (
  id uuid PRIMARY KEY,
  acompanamiento_id uuid NOT NULL REFERENCES acompanamientos(id),
  semana_inicio date NOT NULL,
  avance text NOT NULL,
  observaciones text NOT NULL,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  registrado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acompanamiento_id, semana_inicio)       -- un seguimiento por semana
);

CREATE TABLE instrumentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL,
  titulo text NOT NULL,
  vigente boolean NOT NULL DEFAULT false
);
CREATE TABLE instrumento_preguntas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrumento_id uuid NOT NULL REFERENCES instrumentos(id),
  orden int NOT NULL,
  eje text NOT NULL CHECK (eje IN ('FUNCIONALIDAD','FACILIDAD_DE_USO','COMPORTAMIENTO')),
  texto text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ESCALA','TEXTO')),
  obligatoria boolean NOT NULL DEFAULT true
);
CREATE TABLE sesiones_piloto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  region text NOT NULL,
  citados int NOT NULL CHECK (citados >= 0),
  asistentes int NOT NULL CHECK (asistentes >= 0),
  valoracion int NOT NULL CHECK (valoracion BETWEEN 1 AND 5),
  observaciones text,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (asistentes <= citados),
  UNIQUE (region, fecha)                           -- una sesión por región y fecha
);
CREATE TABLE respuestas_instrumento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrumento_id uuid NOT NULL REFERENCES instrumentos(id),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  sesion_id uuid REFERENCES sesiones_piloto(id),
  estado text NOT NULL CHECK (estado IN ('BORRADOR','ENVIADO')),
  respuestas jsonb NOT NULL DEFAULT '{}',
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_respuesta_tutor_sesion
  ON respuestas_instrumento (usuario_id, instrumento_id, COALESCE(sesion_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE incidentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id uuid NOT NULL REFERENCES sesiones_piloto(id),
  tipo text NOT NULL CHECK (tipo IN ('CONECTIVIDAD','RENDIMIENTO','ACCESO','OTRO')),
  hora time NOT NULL,
  descripcion text NOT NULL,
  estado text NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','RESUELTO')),
  solucion text,
  resuelto_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incidentes_sesion ON incidentes(sesion_id);

-- Bitácora: solo admite inserciones
CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  usuario_id uuid,
  rol text,
  accion text NOT NULL,
  objeto text,
  objeto_id text,
  detalle jsonb,
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION auditoria_solo_inserta() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'La bitácora solo admite inserciones'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_solo_inserta();

-- Plantillas de reportes de ley (configuración versionada)
CREATE TABLE plantillas_ley (
  tipo text NOT NULL,
  version int NOT NULL,
  titulo text NOT NULL,
  vigente boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tipo, version)
);
INSERT INTO plantillas_ley VALUES
  ('estrategias-vigentes',1,'Estrategias estudiantiles vigentes por entidad',true),
  ('cobertura-docentes',1,'Docentes acompañados frente a docentes asignados',true),
  ('participacion-estudiantes',1,'Estudiantes vinculados por estrategia',true);
