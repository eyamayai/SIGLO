from decimal import Decimal

from pydantic import BaseModel, Field


class IngresoItem(BaseModel):
    codigo_sap: str
    dominio_pdf: str
    descripcion: str
    topologia: str | None = None
    serial: str | None = None
    cantidad: Decimal = Field(gt=0)
    lote: str
    centro: str = "C903"
    almacen: str
    ubicacion: str
    segmento: str | None = None
    stock: int = 1
    tipo: str = "LIBRE"
    estado: str = "Bueno"


class IngresoCreate(BaseModel):
    documento: str
    fecha: str | None = None
    almacen_pdf: str | None = None
    responsable_almacen: str | None = None
    observacion: str | None = None
    usuario_registro: str | None = None
    items: list[IngresoItem] = Field(min_length=1)


class IngresoResponse(BaseModel):
    ok: bool
    documento_id: int
    documento: str
    serializados: int
    no_serializados: int
    movimientos: int
