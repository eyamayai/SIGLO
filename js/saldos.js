document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.sigloSupabase;
  const searchInput = document.getElementById('balanceSearch');
  const stateFilter = document.getElementById('stateFilter');
  const loteFilter = document.getElementById('loteFilter');
  const segmentFilter = document.getElementById('segmentFilter');
  const refreshBtn = document.getElementById('refreshBalancesBtn');
  const message = document.getElementById('balanceMessage');

  let equipos = [];
  let saldos = [];

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const numberFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });

  function searchText(row) {
    return normalize([
      row.serial,
      row.codigo_sap,
      row.dominio,
      row.descripcion,
      row.lote,
      row.almacen,
      row.ubicacion,
      row.segmento,
      row.estado_fisico,
      row.estado_inventario,
      row.ultimo_documento
    ].filter(Boolean).join(' '));
  }

  function fillSegments() {
    const current = segmentFilter.value;
    const values = [...new Set(
      [...equipos, ...saldos]
        .map(row => String(row.segmento || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'es'));

    segmentFilter.innerHTML = '<option value="">Todos</option>' +
      values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

    if (values.includes(current)) segmentFilter.value = current;
  }

  function renderKpis(kpis = {}) {
    document.getElementById('kpiDisponibles').textContent = numberFormat.format(Number(kpis.equipos_disponibles || 0));
    document.getElementById('kpiDespachados').textContent = numberFormat.format(Number(kpis.equipos_despachados || 0));
    document.getElementById('kpiUnidades').textContent = numberFormat.format(Number(kpis.unidades_no_serializadas || 0));
    document.getElementById('kpiCodigos').textContent = numberFormat.format(Number(kpis.codigos_con_saldo || 0));
  }

  function filteredEquipos() {
    const query = normalize(searchInput.value);
    const state = stateFilter.value;
    const lote = loteFilter.value;
    const segment = segmentFilter.value;

    return equipos.filter(row => {
      if (query && !searchText(row).includes(query)) return false;
      if (state && row.estado_inventario !== state) return false;
      if (lote && row.lote !== lote) return false;
      if (segment && row.segmento !== segment) return false;
      return true;
    });
  }

  function filteredSaldos() {
    const query = normalize(searchInput.value);
    const lote = loteFilter.value;
    const segment = segmentFilter.value;

    return saldos.filter(row => {
      if (query && !searchText(row).includes(query)) return false;
      if (lote && row.lote !== lote) return false;
      if (segment && row.segmento !== segment) return false;
      return true;
    });
  }

  function renderEquipos() {
    const rows = filteredEquipos();
    const body = document.getElementById('serialBalancesBody');
    document.getElementById('serialCount').textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="9">No hay equipos que coincidan con los filtros.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => {
      const inventoryClass = row.estado_inventario === 'Disponible' ? 'available' : 'dispatched';
      return `<tr>
        <td class="serial-cell">${escapeHtml(row.serial)}</td>
        <td class="code-cell">${escapeHtml(row.codigo_sap)}</td>
        <td class="description-cell">${escapeHtml(row.descripcion)}</td>
        <td><span class="lote-pill">${escapeHtml(row.lote)}</span></td>
        <td>${escapeHtml(row.almacen)}</td>
        <td>${escapeHtml(row.ubicacion)}</td>
        <td>${escapeHtml(row.segmento)}</td>
        <td><span class="physical-pill">${escapeHtml(row.estado_fisico)}</span></td>
        <td><span class="status-pill ${inventoryClass}">${escapeHtml(row.estado_inventario)}</span></td>
      </tr>`;
    }).join('');
  }

  function renderSaldos() {
    const rows = filteredSaldos();
    const body = document.getElementById('quantityBalancesBody');
    document.getElementById('quantityCount').textContent = `${rows.length} saldo${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="7">No hay saldos que coincidan con los filtros.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `<tr>
      <td class="code-cell">${escapeHtml(row.codigo_sap)}</td>
      <td class="description-cell">${escapeHtml(row.descripcion)}</td>
      <td><span class="lote-pill">${escapeHtml(row.lote)}</span></td>
      <td>${escapeHtml(row.almacen)}</td>
      <td>${escapeHtml(row.ubicacion)}</td>
      <td>${escapeHtml(row.segmento)}</td>
      <td>${numberFormat.format(Number(row.cantidad || 0))}</td>
    </tr>`).join('');
  }

  function renderAll() {
    renderEquipos();
    renderSaldos();
  }

  async function loadBalances() {
    if (!supabase) {
      message.textContent = 'No fue posible conectar con la base de datos.';
      message.className = 'balance-message error';
      return;
    }

    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Actualizando…';
    message.textContent = 'Consultando inventario actual…';
    message.className = 'balance-message';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.replace('index.html');
      return;
    }

    const { data, error } = await supabase.rpc('consultar_saldos');

    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Actualizar';

    if (error) {
      console.error('Error consultando saldos', error);
      message.textContent = error.message || 'No fue posible consultar los saldos.';
      message.className = 'balance-message error';
      return;
    }

    equipos = Array.isArray(data?.equipos) ? data.equipos : [];
    saldos = Array.isArray(data?.saldos) ? data.saldos : [];

    renderKpis(data?.kpis || {});
    fillSegments();
    renderAll();

    message.textContent = `Inventario actualizado · ${equipos.length} equipo(s) · ${saldos.length} saldo(s) activos.`;
    message.className = 'balance-message';
  }

  [searchInput, stateFilter, loteFilter, segmentFilter].forEach(control => {
    control?.addEventListener(control === searchInput ? 'input' : 'change', renderAll);
  });

  refreshBtn?.addEventListener('click', loadBalances);

  await loadBalances();
});