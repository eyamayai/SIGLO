document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.sigloSupabase;
  const searchInput = document.getElementById('movementSearch');
  const typeFilter = document.getElementById('movementTypeFilter');
  const topologyFilter = document.getElementById('topologyFilter');
  const stockTypeFilter = document.getElementById('movementStockTypeFilter');
  const loteFilter = document.getElementById('movementLoteFilter');
  const refreshBtn = document.getElementById('refreshMovementsBtn');
  const resetBtn = document.getElementById('resetMovementsBtn');
  const message = document.getElementById('movementMessage');

  let movimientos = [];

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const numberFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
  const dateFormat = new Intl.DateTimeFormat('es-CO', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });

  function displayDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
  }

  function searchable(row) {
    return normalize([
      row.documento,
      row.tipo_movimiento,
      row.codigo_sap,
      row.dominio,
      row.descripcion,
      row.serial,
      row.lote,
      row.almacen,
      row.ubicacion,
      row.segmento,
      row.tipo,
      row.estado_inventario,
      row.tecnico,
      row.cedula,
      row.usuario_registro
    ].filter(Boolean).join(' '));
  }

  function filteredRows() {
    const query = normalize(searchInput.value);
    const type = typeFilter.value;
    const topology = topologyFilter.value;
    const stockType = stockTypeFilter.value;
    const lote = loteFilter.value;

    return movimientos.filter(row => {
      if (query && !searchable(row).includes(query)) return false;
      if (type && row.tipo_movimiento !== type) return false;
      if (topology && row.topologia !== topology) return false;
      if (stockType && row.tipo !== stockType) return false;
      if (lote && row.lote !== lote) return false;
      return true;
    });
  }

  function renderKpis(kpis = {}) {
    document.getElementById('kpiMovTotal').textContent = numberFormat.format(Number(kpis.movimientos_total || 0));
    document.getElementById('kpiIngresos').textContent = numberFormat.format(Number(kpis.movimientos_ingreso || 0));
    document.getElementById('kpiDespachos').textContent = numberFormat.format(Number(kpis.movimientos_despacho || 0));
    document.getElementById('kpiDocumentos').textContent = numberFormat.format(Number(kpis.documentos || 0));
  }

  function renderRows() {
    const rows = filteredRows();
    const body = document.getElementById('movementsBody');
    document.getElementById('movementCount').textContent = `${rows.length} movimiento${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="14">No hay movimientos que coincidan con los filtros.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => {
      const movementClass = row.tipo_movimiento === 'INGRESO'
        ? 'in'
        : (row.tipo_movimiento === 'DEVOLUCION'
          ? 'return'
          : (row.tipo_movimiento === 'DESMONTE'
            ? 'dismantle'
            : (row.tipo_movimiento === 'CARGA INICIAL' ? 'initial' : 'out')));
      const statusClass = row.estado_inventario === 'Disponible'
        ? 'available'
        : ((row.estado_inventario === 'Garantía' || row.estado_inventario === 'Inversa') ? 'guarantee' : 'dispatched');
      return `<tr>
        <td>${escapeHtml(displayDate(row.fecha_documento || row.fecha_registro))}</td>
        <td class="document-cell">${escapeHtml(row.documento)}</td>
        <td><span class="move-pill ${movementClass}">${escapeHtml(row.tipo_movimiento)}</span></td>
        <td class="code-cell">${escapeHtml(row.codigo_sap)}</td>
        <td class="description-cell">${escapeHtml(row.descripcion)}</td>
        <td class="serial-cell">${escapeHtml(row.serial || '—')}</td>
        <td class="quantity-cell">${numberFormat.format(Number(row.cantidad || 0))}</td>
        <td><span class="lote-pill">${escapeHtml(row.lote)}</span></td>
        <td><span class="type-pill ${row.tipo === 'DESMONTE' ? 'desmonte' : 'libre'}">${escapeHtml(row.tipo || '—')}</span></td>
        <td>${escapeHtml(row.almacen)}</td>
        <td>${escapeHtml(row.ubicacion)}</td>
        <td>${escapeHtml(row.segmento)}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(row.estado_inventario || '—')}</span></td>
        <td>${escapeHtml(row.tecnico || '—')}</td>
      </tr>`;
    }).join('');
  }

  async function loadMovements() {
    if (!supabase) {
      message.textContent = 'No fue posible conectar con la base de datos.';
      message.className = 'movement-message error';
      return;
    }

    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Actualizando…';
    message.textContent = 'Consultando historial de movimientos…';
    message.className = 'movement-message';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.replace('index.html');
      return;
    }

    const { data, error } = await supabase.rpc('consultar_movimientos');

    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Actualizar';

    if (error) {
      console.error('Error consultando movimientos', error);
      message.textContent = error.message || 'No fue posible consultar los movimientos.';
      message.className = 'movement-message error';
      return;
    }

    movimientos = Array.isArray(data?.movimientos) ? data.movimientos : [];
    renderKpis(data?.kpis || {});
    renderRows();

    message.textContent = `Historial actualizado · ${movimientos.length} movimiento(s) registrado(s).`;
    message.className = 'movement-message';
  }

  [searchInput, typeFilter, topologyFilter, stockTypeFilter, loteFilter].forEach(control => {
    control?.addEventListener(control === searchInput ? 'input' : 'change', renderRows);
  });

  resetBtn?.addEventListener('click', () => {
    searchInput.value = '';
    typeFilter.value = '';
    topologyFilter.value = '';
    stockTypeFilter.value = '';
    loteFilter.value = '';
    renderRows();
    message.textContent = 'Filtros restablecidos.';
    message.className = 'movement-message';
  });

  refreshBtn?.addEventListener('click', loadMovements);

  await loadMovements();
});