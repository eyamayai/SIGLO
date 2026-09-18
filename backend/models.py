from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Documento(Base):
    __tablename__ = "documentos"
    __table_args__ = (
        UniqueConstraint("tipo", "numero", name="uq_documento_tipo_numero"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tipo: Mapped[str] = mapped_column(String(30), nullable=False)
    numero: Mapped[str] = mapped_column(String(80), nullable=False)
    fecha_documento: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    almacen_pdf: Mapped[str | None] = mapped_column(String(160))
    responsable_almacen: Mapped[str | None] = mapped_column(String(200))
    observacion: Mapped[str | None] = mapped_column(Text)
    usuario_registro: Mapped[str | None] = mapped_column(String(200))
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Equipo(Base):
    __tablename__ = "equipos"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    serial: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    codigo_sap: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    dominio: Mapped[str] = mapped_column(String(60), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    topologia: Mapped[str] = mapped_column(String(40), nullable=False)
    lote: Mapped[str] = mapped_column(String(20), nullable=False)
    centro: Mapped[str] = mapped_column(String(20), nullable=False)
    almacen: Mapped[str] = mapped_column(String(20), nullable=False)
    ubicacion: Mapped[str] = mapped_column(String(40), nullable=False)
    segmento: Mapped[str] = mapped_column(String(80), nullable=False)
    stock: Mapped[int] = mapped_column(nullable=False, default=1)
    tipo: Mapped[str] = mapped_column(String(30), nullable=False)
    estado: Mapped[str] = mapped_column(String(40), nullable=False)
    documento_ultimo_id: Mapped[int | None] = mapped_column(
        ForeignKey("documentos.id", ondelete="SET NULL")
    )
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Saldo(Base):
    __tablename__ = "saldos"
    __table_args__ = (
        UniqueConstraint(
            "codigo_sap",
            "centro",
            "almacen",
            "lote",
            "ubicacion",
            "segmento",
            name="uq_saldo_llave_maestra",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    codigo_sap: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    dominio: Mapped[str] = mapped_column(String(60), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    topologia: Mapped[str] = mapped_column(String(40), nullable=False)
    lote: Mapped[str] = mapped_column(String(20), nullable=False)
    centro: Mapped[str] = mapped_column(String(20), nullable=False)
    almacen: Mapped[str] = mapped_column(String(20), nullable=False)
    ubicacion: Mapped[str] = mapped_column(String(40), nullable=False)
    segmento: Mapped[str] = mapped_column(String(80), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    stock: Mapped[int] = mapped_column(nullable=False, default=1)
    tipo: Mapped[str] = mapped_column(String(30), nullable=False)
    estado: Mapped[str] = mapped_column(String(40), nullable=False)
    documento_ultimo_id: Mapped[int | None] = mapped_column(
        ForeignKey("documentos.id", ondelete="SET NULL")
    )
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Movimiento(Base):
    __tablename__ = "movimientos"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    documento_id: Mapped[int] = mapped_column(
        ForeignKey("documentos.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    tipo_movimiento: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    topologia: Mapped[str] = mapped_column(String(40), nullable=False)
    serial: Mapped[str | None] = mapped_column(String(120), index=True)
    codigo_sap: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    dominio: Mapped[str] = mapped_column(String(60), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    lote: Mapped[str] = mapped_column(String(20), nullable=False)
    centro: Mapped[str] = mapped_column(String(20), nullable=False)
    almacen: Mapped[str] = mapped_column(String(20), nullable=False)
    ubicacion: Mapped[str] = mapped_column(String(40), nullable=False)
    segmento: Mapped[str] = mapped_column(String(80), nullable=False)
    stock: Mapped[int] = mapped_column(nullable=False)
    tipo: Mapped[str] = mapped_column(String(30), nullable=False)
    estado: Mapped[str] = mapped_column(String(40), nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
