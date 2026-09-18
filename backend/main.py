import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from catalogs import get_segmento, get_topologia
from db import Base, engine, get_db
from models import Documento, Equipo, Movimiento, Saldo
from schemas import IngresoCreate, IngresoResponse


SERIALIZADO = "CON PERFIL DE SERIE"
NO_SERIALIZADO = "SIN PERFIL DE SERIE"


def parse_fecha(value: str | None) -> datetime | None:
    if not value:
        return None

    value = value.strip()
    for fmt in ("%d-%m-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass

    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Fecha de documento inválida: {value}") from exc


def clean_serial(value: str | None) -> str:
    return re.sub(r"\s+", "", (value or "").strip()).strip(",;:")


def serial_valido(value: str | None) -> bool:
    serial = clean_serial(value)
    return serial != "-" and len(re.findall(r"[A-Za-z0-9]", serial)) >= 5


def normalizar_ingreso(payload: IngresoCreate) -> list[dict]:
    normalizados: list[dict] = []
    seriales_vistos: set[str] = set()

    for item in payload.items:
        codigo_sap = item.codigo_sap.strip()
        topologia = get_topologia(codigo_sap)
        if not topologia:
            raise HTTPException(
                status_code=422,
                detail=f"Código SAP {codigo_sap}: no existe en el catálogo de topologías.",
            )

        ubicacion = item.ubicacion.strip().upper()
        segmento = get_segmento(ubicacion)
        if not segmento:
            raise HTTPException(
                status_code=422,
                detail=f"Ubicación {ubicacion}: no existe en el catálogo de ubicaciones.",
            )

        almacen = item.almacen.strip().upper()
        if almacen not in {"A221", "U020"}:
            raise HTTPException(
                status_code=422,
                detail=f"Almacén {almacen}: solo se permiten A221 o U020.",
            )

        lote = item.lote.strip().upper()
        if lote not in {"VALORADO", "NOVALORADO"}:
            raise HTTPException(status_code=422, detail=f"Lote inválido: {lote}.")

        serial = None
        cantidad = Decimal(item.cantidad)

        if topologia == SERIALIZADO:
            serial = clean_serial(item.serial)
            if not serial_valido(serial):
                raise HTTPException(
                    status_code=422,
                    detail=f"Código SAP {codigo_sap}: serial vacío o inválido.",
                )
            if serial in seriales_vistos:
                raise HTTPException(
                    status_code=422,
                    detail=f"Serial duplicado dentro del ingreso: {serial}.",
                )
            seriales_vistos.add(serial)
            cantidad = Decimal("1")

        if topologia == NO_SERIALIZADO:
            serial = None

        normalizados.append(
            {
                "codigo_sap": codigo_sap,
                "dominio": item.dominio_pdf.strip(),
                "descripcion": item.descripcion.strip(),
                "topologia": topologia,
                "serial": serial,
                "cantidad": cantidad,
                "lote": lote,
                "centro": "C903",
                "almacen": almacen,
                "ubicacion": ubicacion,
                "segmento": segmento,
                "stock": 1,
                "tipo": "LIBRE",
                "estado": "Bueno",
            }
        )

    return normalizados


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="SIGLO API",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "https://eyamayai.github.io,http://localhost:5500,http://127.0.0.1:5500",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "service": "SIGLO API"}


@app.post("/api/ingresos", response_model=IngresoResponse, status_code=201)
def registrar_ingreso(payload: IngresoCreate, db: Session = Depends(get_db)):
    numero = payload.documento.strip()
    if not numero:
        raise HTTPException(status_code=422, detail="El número de documento es obligatorio.")

    if db.scalar(
        select(Documento).where(
            Documento.tipo == "INGRESO",
            Documento.numero == numero,
        )
    ):
        raise HTTPException(
            status_code=409,
            detail=f"El ingreso {numero} ya fue registrado anteriormente.",
        )

    items = normalizar_ingreso(payload)

    documento = Documento(
        tipo="INGRESO",
        numero=numero,
        fecha_documento=parse_fecha(payload.fecha),
        almacen_pdf=(payload.almacen_pdf or "").strip() or None,
        responsable_almacen=(payload.responsable_almacen or "").strip() or None,
        observacion=(payload.observacion or "").strip() or None,
        usuario_registro=(payload.usuario_registro or "").strip() or None,
    )

    serializados = 0
    no_serializados = 0

    try:
        db.add(documento)
        db.flush()

        for item in items:
            if item["topologia"] == SERIALIZADO:
                serializados += 1

                insert_equipo = pg_insert(Equipo).values(
                    serial=item["serial"],
                    codigo_sap=item["codigo_sap"],
                    dominio=item["dominio"],
                    descripcion=item["descripcion"],
                    topologia=item["topologia"],
                    lote=item["lote"],
                    centro=item["centro"],
                    almacen=item["almacen"],
                    ubicacion=item["ubicacion"],
                    segmento=item["segmento"],
                    stock=item["stock"],
                    tipo=item["tipo"],
                    estado=item["estado"],
                    documento_ultimo_id=documento.id,
                )

                db.execute(
                    insert_equipo.on_conflict_do_update(
                        index_elements=[Equipo.serial],
                        set_={
                            "codigo_sap": insert_equipo.excluded.codigo_sap,
                            "dominio": insert_equipo.excluded.dominio,
                            "descripcion": insert_equipo.excluded.descripcion,
                            "topologia": insert_equipo.excluded.topologia,
                            "lote": insert_equipo.excluded.lote,
                            "centro": insert_equipo.excluded.centro,
                            "almacen": insert_equipo.excluded.almacen,
                            "ubicacion": insert_equipo.excluded.ubicacion,
                            "segmento": insert_equipo.excluded.segmento,
                            "stock": insert_equipo.excluded.stock,
                            "tipo": insert_equipo.excluded.tipo,
                            "estado": insert_equipo.excluded.estado,
                            "documento_ultimo_id": documento.id,
                        },
                    )
                )

            else:
                no_serializados += 1

                insert_saldo = pg_insert(Saldo).values(
                    codigo_sap=item["codigo_sap"],
                    dominio=item["dominio"],
                    descripcion=item["descripcion"],
                    topologia=item["topologia"],
                    lote=item["lote"],
                    centro=item["centro"],
                    almacen=item["almacen"],
                    ubicacion=item["ubicacion"],
                    segmento=item["segmento"],
                    cantidad=item["cantidad"],
                    stock=item["stock"],
                    tipo=item["tipo"],
                    estado=item["estado"],
                    documento_ultimo_id=documento.id,
                )

                db.execute(
                    insert_saldo.on_conflict_do_update(
                        constraint="uq_saldo_llave_maestra",
                        set_={
                            "dominio": insert_saldo.excluded.dominio,
                            "descripcion": insert_saldo.excluded.descripcion,
                            "topologia": insert_saldo.excluded.topologia,
                            "cantidad": Saldo.cantidad + insert_saldo.excluded.cantidad,
                            "stock": insert_saldo.excluded.stock,
                            "tipo": insert_saldo.excluded.tipo,
                            "estado": insert_saldo.excluded.estado,
                            "documento_ultimo_id": documento.id,
                        },
                    )
                )

            db.add(
                Movimiento(
                    documento_id=documento.id,
                    tipo_movimiento="INGRESO",
                    topologia=item["topologia"],
                    serial=item["serial"],
                    codigo_sap=item["codigo_sap"],
                    dominio=item["dominio"],
                    descripcion=item["descripcion"],
                    cantidad=item["cantidad"],
                    lote=item["lote"],
                    centro=item["centro"],
                    almacen=item["almacen"],
                    ubicacion=item["ubicacion"],
                    segmento=item["segmento"],
                    stock=item["stock"],
                    tipo=item["tipo"],
                    estado=item["estado"],
                )
            )

        db.commit()

    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="No fue posible registrar el ingreso por un conflicto de datos.",
        ) from exc
    except Exception:
        db.rollback()
        raise

    return IngresoResponse(
        ok=True,
        documento_id=documento.id,
        documento=documento.numero,
        serializados=serializados,
        no_serializados=no_serializados,
        movimientos=len(items),
    )
