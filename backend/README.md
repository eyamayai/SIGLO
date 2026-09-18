# SIGLO API

Backend de SIGLO para persistir inventario e historial en PostgreSQL.

## Tablas

- `documentos`: controla los PDF registrados y evita duplicados.
- `equipos`: estado actual de materiales CON PERFIL DE SERIE.
- `saldos`: estado actual por cantidad de materiales SIN PERFIL DE SERIE.
- `movimientos`: historial inmutable de cada ingreso y, más adelante, despacho/devolución.

## Llave de saldos

`Código SAP + Centro + Almacén + Lote + Ubicación + Segmento`

## Variables

Copia `.env.example` y configura `DATABASE_URL`.

## Ejecución local

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Al arrancar, SQLAlchemy crea las tablas faltantes automáticamente.

Prueba:

- `GET /health`
- `POST /api/ingresos`

El endpoint de ingresos vuelve a validar en el servidor:

- Topología desde `data/CodigosSAP.json`
- Segmento desde `data/Ubicaciones.json`
- Centro = `C903`
- Almacén = `A221` o `U020`
- Lote = `VALORADO` o `NOVALORADO`
- Seriales de al menos 5 caracteres alfanuméricos para CON PERFIL DE SERIE
- Un documento no puede registrarse dos veces
