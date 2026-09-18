import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def _load_json(name: str):
    with (DATA_DIR / name).open("r", encoding="utf-8") as file:
        return json.load(file)


TOPOLOGIAS = {
    str(item["codigo_sap"]).strip(): str(item["topologia"]).strip().upper()
    for item in _load_json("CodigosSAP.json")
}

SEGMENTOS = {
    str(item["ubicacion"]).strip().upper(): str(item["segmento"]).strip()
    for item in _load_json("Ubicaciones.json")
}


def get_topologia(codigo_sap: str) -> str | None:
    return TOPOLOGIAS.get(str(codigo_sap).strip())


def get_segmento(ubicacion: str) -> str | None:
    return SEGMENTOS.get(str(ubicacion).strip().upper())
