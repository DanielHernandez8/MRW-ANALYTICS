# MRW Rentabilidad Dashboard

Aplicación web para analizar rentabilidad por abonado a partir de CSV.

## Estructura

- `backend/`: API FastAPI que procesa el CSV y devuelve métricas.
- `frontend/`: interfaz web (HTML/CSS/JS) con gráficos y tabla avanzada.

## Funcionalidades

- Carga de CSV.
- Exclusión de abonados.
- Escenario anual estimado (x12).
- KPIs: PV total, coste total, margen total y rentabilidad media.
- Gráficos Top 10 (margen, PV vs coste, rentabilidad).
- Tabla con búsqueda, filtros por columna, ordenación y paginación.
- Botón de demo con fichero ficticio (`frontend/assets/demo_mrw_ficticio.csv`).
- Botón para ocultar/mostrar KPIs sensibles.

## Requisitos

- Python 3.11+ (recomendado)

## Ejecutar en local

### 1) Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2) Frontend

En otra terminal:

```powershell
cd frontend
python -m http.server 5500
```

Abrir:

- `http://127.0.0.1:5500`

## API

- `GET /api/health`
- `POST /api/rentabilidad/analyze`
  - Form-data:
    - `csv_file` (archivo CSV)
    - `excluir` (opcional, abonados separados por coma)
    - `escenario_anual` (opcional: `true/false`)

## Privacidad de datos

- No se persiste información en base de datos.
- El CSV se procesa en memoria durante la petición.
- Para demos públicas, usar datos ficticios.
- Creado como practica y a modo de prueba, extrapolable a otros ambitos.
