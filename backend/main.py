from __future__ import annotations

import io
import unicodedata
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="MRW Rentabilidad API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

CSV_ENCODINGS = ("utf-8-sig", "latin1", "cp1252")
EXCLUDED_ABONADO_VALUES = {"nan", "00nan", "none", ""}


def _normalize_header(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value))
    ascii_only = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return "".join(ch for ch in ascii_only.lower() if ch.isalnum())


def _resolve_required_columns(df: pd.DataFrame) -> dict[str, str]:
    normalized_map = {_normalize_header(column): column for column in df.columns}

    def by_exact(options: list[str]) -> str | None:
        return next((normalized_map.get(option) for option in options if option in normalized_map), None)

    def by_contains(chunks: list[str]) -> str | None:
        for normalized_name, original_name in normalized_map.items():
            if all(chunk in normalized_name for chunk in chunks):
                return original_name
        return None

    resolved = {
        "abonado": by_exact(["abonado"]) or by_contains(["abonado"]),
        "razon_social": (
            by_exact(["descripcionabonado", "razonsocial", "descabonado"])
            or by_contains(["descripci", "abonado"])
            or by_contains(["razon", "social"])
        ),
        "envio_id": (
            by_exact(["nenvio", "noenvio", "numeroenvio", "numenvio"])
            or by_contains(["envio"])
        ),
        "coste": by_exact(["costecentral", "coste"]) or by_contains(["coste"]),
        "pv": (
            by_exact(["valoraciong3", "valoracion"])
            or by_contains(["valoraci", "g3"])
            or by_contains(["valoraci"])
        ),
    }

    missing = [field for field, source in resolved.items() if source is None]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Faltan columnas obligatorias: {missing}. Columnas detectadas: {list(df.columns)}",
        )

    return resolved  # type: ignore[return-value]


def _clean_input_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    selected = _resolve_required_columns(df)
    work = df[
        [
            selected["abonado"],
            selected["razon_social"],
            selected["envio_id"],
            selected["coste"],
            selected["pv"],
        ]
    ].copy()
    work.columns = ["abonado", "razon_social", "envio_id", "coste", "pv"]

    work["abonado"] = (
        work["abonado"]
        .astype(str)
        .str.replace(".0", "", regex=False)
        .str.strip()
    )
    work = work[~work["abonado"].str.lower().isin(EXCLUDED_ABONADO_VALUES)]
    work["abonado"] = work["abonado"].str.zfill(6)

    work = work[work["razon_social"].astype(str).str.upper() != "SENDAL S.L.U"]

    work["pv"] = pd.to_numeric(work["pv"], errors="coerce")
    work["coste"] = pd.to_numeric(work["coste"], errors="coerce")
    work = work.dropna(subset=["abonado", "envio_id", "pv", "coste"])
    return work


def _aggregate_by_abonado(work: pd.DataFrame) -> pd.DataFrame:
    envios = (
        work.groupby(["abonado", "envio_id"], as_index=False)
        .agg(
            razon_social=("razon_social", "first"),
            pv=("pv", "max"),
            coste=("coste", "sum"),
        )
    )

    resumen = (
        envios.groupby("abonado", as_index=False)
        .agg(
            razon_social=("razon_social", "first"),
            pv=("pv", "sum"),
            coste=("coste", "sum"),
        )
    )
    resumen["margen"] = resumen["pv"] - resumen["coste"]
    resumen["rentabilidad_%"] = (
        (resumen["margen"] / resumen["pv"])
        .replace([float("inf"), -float("inf")], 0)
        .fillna(0)
        * 100
    )
    return resumen


def _read_csv_with_fallbacks(content: bytes) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in CSV_ENCODINGS:
        try:
            return pd.read_csv(io.BytesIO(content), sep=";", encoding=encoding, decimal=",")
        except Exception as exc:  # noqa: PERF203
            last_error = exc
    raise HTTPException(status_code=400, detail=f"No se pudo leer el CSV: {last_error}")


def _format_response(resumen: pd.DataFrame, all_abonados: list[str]) -> dict[str, Any]:
    resumen = resumen.sort_values("margen", ascending=False)

    total_pv = float(resumen["pv"].sum())
    total_coste = float(resumen["coste"].sum())
    total_margen = float(resumen["margen"].sum())
    rent_media = (total_margen / total_pv * 100) if total_pv else 0.0

    rows = [
        {
            "abonado": str(row.abonado),
            "razon_social": str(row.razon_social),
            "pv": round(float(row.pv), 2),
            "coste": round(float(row.coste), 2),
            "margen": round(float(row.margen), 2),
            "rentabilidad_pct": round(float(row["rentabilidad_%"]), 2),
        }
        for _, row in resumen.iterrows()
    ]

    top = resumen.head(10)
    return {
        "rows": rows,
        "all_abonados": all_abonados,
        "summary": {
            "total_pv": round(total_pv, 2),
            "total_coste": round(total_coste, 2),
            "total_margen": round(total_margen, 2),
            "rentabilidad_media_pct": round(rent_media, 2),
        },
        "charts": {
            "labels": top["abonado"].astype(str).tolist(),
            "names": top["razon_social"].astype(str).tolist(),
            "margenes": [round(float(v), 2) for v in top["margen"].tolist()],
            "pv": [round(float(v), 2) for v in top["pv"].tolist()],
            "coste": [round(float(v), 2) for v in top["coste"].tolist()],
            "rentabilidad_pct": [round(float(v), 2) for v in top["rentabilidad_%"].tolist()],
        },
    }


def _analyze_dataframe(df: pd.DataFrame, excluir: list[str], escenario_anual: bool) -> dict[str, Any]:
    work = _clean_input_dataframe(df)
    resumen = _aggregate_by_abonado(work)
    all_abonados = sorted(resumen["abonado"].astype(str).unique().tolist())

    if excluir:
        resumen = resumen[~resumen["abonado"].isin(excluir)].copy()

    if escenario_anual:
        resumen["pv"] *= 12
        resumen["coste"] *= 12
        resumen["margen"] *= 12

    resumen["rentabilidad_%"] = resumen["rentabilidad_%"].round(2)
    return _format_response(resumen, all_abonados)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/rentabilidad/analyze")
async def analyze(
    csv_file: UploadFile = File(...),
    excluir: str = Form(""),
    escenario_anual: bool = Form(False),
) -> dict[str, Any]:
    if not csv_file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="El archivo debe ser CSV.")

    content = await csv_file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo CSV esta vacio.")

    df = _read_csv_with_fallbacks(content)
    excluir_list = [value.strip().zfill(6) for value in excluir.split(",") if value.strip()]
    return _analyze_dataframe(df, excluir_list, escenario_anual)
