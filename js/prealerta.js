document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.sigloSupabase;
  const excelInput = document.getElementById('excelInput');
  const selectExcelBtn = document.getElementById('selectExcelBtn');
  const excelDropZone = document.getElementById('excelDropZone');
  const excelFileName = document.getElementById('excelFileName');
  const fileStatus = document.getElementById('fileStatus');
  const processExcelBtn = document.getElementById('processExcelBtn');
  const processMessage = document.getElementById('processMessage');
  const resultsSection = document.getElementById('resultsSection');
  const registerBtn = document.getElementById('registerBtn');

  let currentFile = null;
  let currentPayload = null;
  let currentValidation = null;
  let registered = false;

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");

  const text = value => String(value ?? '').trim();
  const upper = value => text(value).toUpperCase();
  const numberFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });

  function setMessage(message = '', type = '') {
    processMessage.textContent = message;
    processMessage.className = 'process-message' + (type ? ' ' + type : '');
  }

  function normalizeHeader(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .trim()
      .toUpperCase();
  }

  function pad(value) {
    return String(value).padStart(2,'0');
  }

  function formatDateParts(parts) {
    if (!parts || !parts.y || !parts.m || !parts.d) return '';
    return parts.y + '-' + pad(parts.m) + '-' + pad(parts.d) + ' ' +
      pad(parts.H || 0) + ':' + pad(parts.M || 0) + ':' + pad(Math.floor(parts.S || 0));
  }

  function normalizeExcelDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate()) + ' ' +
        pad(value.getHours()) + ':' + pad(value.getMinutes()) + ':' + pad(value.getSeconds());
    }
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      return formatDateParts(XLSX.SSF.parse_date_code(value));
    }
    return text(value);
  }

  function setFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setMessage('Selecciona un archivo Excel .xlsx o .xls.', 'error');
      return;
    }
    currentFile = file;
    excelFileName.textContent = file.name + ' · ' + (file.size / 1024).toFixed(1) + ' KB';
    fileStatus.textContent = 'Excel listo para procesar';
    fileStatus.className = 'catalog-status ready';
    processExcelBtn.disabled = false;
    resetResults();
  }

  function resetResults() {
    currentPayload = null;
    currentValidation = null;
    registered = false;
    resultsSection.hidden = true;
    registerBtn.disabled = true;
    setMessage('');
  }

  selectExcelBtn.addEventListener('click', event => {
    event.stopPropagation();
    excelInput.click();
  });

  excelInput.addEventListener('change', () => setFile(excelInput.files?.[0]));

  excelDropZone.addEventListener('click', event => {
    if (!event.target.closest('button')) excelInput.click();
  });

  excelDropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      excelInput.click();
    }
  });

  ['dragenter','dragover'].forEach(type => excelDropZone.addEventListener(type, event => {
    event.preventDefault();
    excelDropZone.classList.add('dragging');
  }));

  ['dragleave','drop'].forEach(type => excelDropZone.addEventListener(type, event => {
    event.preventDefault();
    excelDropZone.classList.remove('dragging');
  }));

  excelDropZone.addEventListener('drop', event => setFile(event.dataTransfer?.files?.[0]));

  document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
    if (!window.XLSX) {
      setMessage('No fue posible cargar el generador de Excel.', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();

    const serial = XLSX.utils.aoa_to_sheet([['FECHA','DOCUMENTO','SERIE']]);
    serial['!cols'] = [{wch:20},{wch:24},{wch:26}];
    XLSX.utils.book_append_sheet(wb, serial, 'SERIALIZADOS');

    const quantity = XLSX.utils.aoa_to_sheet([['FECHA','DOCUMENTO','CODIGO','CANTIDAD']]);
    quantity['!cols'] = [{wch:20},{wch:24},{wch:16},{wch:14}];
    XLSX.utils.book_append_sheet(wb, quantity, 'NO_SERIALIZADOS');

    const instructions = XLSX.utils.aoa_to_sheet([
      ['SIGLO · Plantilla Prealerta'],
      ['SERIALIZADOS: FECHA | DOCUMENTO | SERIE.'],
      ['NO_SERIALIZADOS: FECHA | DOCUMENTO | CODIGO | CANTIDAD.'],
      ['El archivo debe corresponder a un único documento de Prealerta.'],
      ['Los seriales deben existir en SIGLO como DESMONTE, estado Inversa o Garantía, y estado físico Dañado.'],
      ['Los no serializados se descuentan globalmente del saldo DESMONTE del Código SAP, tomando primero los saldos más antiguos.'],
      ['Procesar el archivo no modifica el inventario; el cambio ocurre únicamente al pulsar Registrar Prealerta.']
    ]);
    instructions['!cols'] = [{wch:115}];
    XLSX.utils.book_append_sheet(wb, instructions, 'INSTRUCCIONES');

    XLSX.writeFile(wb, 'SIGLO_Plantilla_Prealerta.xlsx');
  });

  function parseSheet(workbook, sheetName, requiredHeaders) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    const matrix = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'', raw:true });
    if (!matrix.length) return [];

    const headers = matrix[0].map(normalizeHeader);
    requiredHeaders.forEach(required => {
      if (!headers.includes(required)) {
        throw new Error('La hoja ' + sheetName + ' no contiene la columna ' + required + '.');
      }
    });

    const indexes = {};
    requiredHeaders.forEach(name => { indexes[name] = headers.indexOf(name); });

    return matrix.slice(1)
      .filter(row => row.some(cell => text(cell) !== ''))
      .map((row, index) => {
        const item = { _row:index + 2 };
        requiredHeaders.forEach(name => { item[name] = row[indexes[name]]; });
        return item;
      });
  }

  function buildPayload(workbook, fileName) {
    const serialRows = parseSheet(workbook, 'SERIALIZADOS', ['FECHA','DOCUMENTO','SERIE']);
    const quantityRows = parseSheet(workbook, 'NO_SERIALIZADOS', ['FECHA','DOCUMENTO','CODIGO','CANTIDAD']);

    if (!serialRows.length && !quantityRows.length) {
      throw new Error('El Excel no contiene registros en SERIALIZADOS ni NO_SERIALIZADOS.');
    }

    const allRows = [...serialRows, ...quantityRows];
    const documents = new Set();
    const dates = new Set();

    allRows.forEach(row => {
      const documento = text(row.DOCUMENTO);
      const fecha = normalizeExcelDate(row.FECHA);
      if (!documento) throw new Error('Hay una fila sin DOCUMENTO.');
      if (!fecha) throw new Error('Hay una fila sin FECHA.');
      documents.add(documento);
      dates.add(fecha);
    });

    if (documents.size !== 1) {
      throw new Error('El Excel debe corresponder a un único DOCUMENTO de Prealerta.');
    }

    if (dates.size !== 1) {
      throw new Error('El Excel debe manejar una única FECHA para el documento de Prealerta.');
    }

    const seriales = serialRows.map(row => {
      const serial = upper(row.SERIE);
      if (!serial) throw new Error('SERIALIZADOS fila ' + row._row + ': falta SERIE.');
      return { serial };
    });

    const quantityMap = new Map();
    quantityRows.forEach(row => {
      const codigo = text(row.CODIGO);
      const cantidad = Number(String(row.CANTIDAD ?? '').replace(',','.'));
      if (!codigo) throw new Error('NO_SERIALIZADOS fila ' + row._row + ': falta CODIGO.');
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new Error('NO_SERIALIZADOS fila ' + row._row + ': CANTIDAD inválida.');
      }
      quantityMap.set(codigo, (quantityMap.get(codigo) || 0) + cantidad);
    });

    return {
      documento: [...documents][0],
      fecha_documento: [...dates][0],
      archivo: fileName,
      seriales,
      no_serializados: [...quantityMap.entries()].map(([codigo_sap,cantidad]) => ({ codigo_sap, cantidad }))
    };
  }

  async function validatePayload(payload) {
    const { data, error } = await supabase.rpc('validar_prealerta', { p_payload: payload });
    if (error) throw error;
    currentPayload = payload;
    currentValidation = data;
    renderValidation();
  }

  function resultPill(result) {
    const cls = upper(result) === 'LISTO' ? 'ready' : 'error';
    return '<span class="result-pill ' + cls + '">' + escapeHtml(result || '—') + '</span>';
  }

  function renderValidation() {
    const validation = currentValidation || {};
    const summary = validation.resumen || {};
    const serialRows = validation.seriales || [];
    const quantityRows = validation.no_serializados || [];

    document.getElementById('countSerial').textContent = summary.serializados || 0;
    document.getElementById('countNoSerial').textContent = summary.no_serializados || 0;
    document.getElementById('countUnits').textContent = numberFormat.format(
      quantityRows.reduce((total,row) => total + Number(row.cantidad || 0), 0)
    );
    document.getElementById('countErrors').textContent = summary.errores || 0;

    document.getElementById('serialBody').innerHTML = serialRows.length
      ? serialRows.map(row => '<tr>' +
          '<td><strong>' + escapeHtml(row.serial || '—') + '</strong></td>' +
          '<td>' + escapeHtml(row.codigo_sap || '—') + '</td>' +
          '<td>' + escapeHtml(row.dominio || '—') + '</td>' +
          '<td>' + escapeHtml(row.descripcion || '—') + '</td>' +
          '<td>' + escapeHtml(row.segmento || '—') + '</td>' +
          '<td>' + escapeHtml(row.estado_inventario || '—') + '</td>' +
          '<td>' + resultPill(row.resultado) + '</td>' +
          '<td>' + escapeHtml(row.detalle || '') + '</td>' +
        '</tr>').join('')
      : '<tr class="empty-row"><td colspan="8">Sin registros</td></tr>';

    document.getElementById('noSerialBody').innerHTML = quantityRows.length
      ? quantityRows.map(row => '<tr>' +
          '<td><strong>' + escapeHtml(row.codigo_sap || '—') + '</strong></td>' +
          '<td>' + numberFormat.format(Number(row.cantidad || 0)) + '</td>' +
          '<td>' + numberFormat.format(Number(row.disponible || 0)) + '</td>' +
          '<td>' + resultPill(row.resultado) + '</td>' +
          '<td>' + escapeHtml(row.detalle || '') + '</td>' +
        '</tr>').join('')
      : '<tr class="empty-row"><td colspan="5">Sin registros</td></tr>';

    const globalErrors = validation.errores_globales || [];
    const card = document.getElementById('globalErrorsCard');
    document.getElementById('globalErrors').innerHTML = globalErrors
      .map(message => '<div class="review-message">' + escapeHtml(message) + '</div>')
      .join('');
    card.hidden = globalErrors.length === 0;

    const bar = document.querySelector('.register-bar');
    const title = document.getElementById('registerTitle');
    const help = document.getElementById('registerHelp');

    if (registered) {
      registerBtn.disabled = true;
      bar.className = 'register-bar ready';
      title.textContent = 'Prealerta registrada';
      help.textContent = 'Los equipos recogidos quedaron Prealertados y los saldos DESMONTE fueron descontados.';
    } else if ((summary.errores || 0) > 0) {
      registerBtn.disabled = true;
      bar.className = 'register-bar error';
      title.textContent = 'La Prealerta contiene errores';
      help.textContent = 'Corrige los bloqueos del archivo antes de registrar.';
    } else {
      registerBtn.disabled = false;
      bar.className = 'register-bar ready';
      title.textContent = 'Prealerta lista para registrar';
      help.textContent = 'Los serializados pasarán a RECOGIDO · Prealertado · Dañado y los no serializados saldrán del saldo DESMONTE.';
    }

    resultsSection.hidden = false;
  }

  processExcelBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.replace('index.html');
      return;
    }

    processExcelBtn.disabled = true;
    processExcelBtn.textContent = 'Procesando…';
    setMessage('Leyendo Excel y validando el inventario actual…');

    try {
      if (!window.XLSX) throw new Error('No fue posible cargar el lector de Excel.');
      const workbook = XLSX.read(await currentFile.arrayBuffer(), { type:'array', cellDates:true });
      const payload = buildPayload(workbook, currentFile.name);
      await validatePayload(payload);
      setMessage('Excel procesado. Revisa el resultado antes de registrar.', 'success');
      resultsSection.scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) {
      console.error('Error procesando Prealerta', error);
      setMessage(error.message || 'No fue posible procesar el Excel.', 'error');
      resultsSection.hidden = true;
    } finally {
      processExcelBtn.disabled = !currentFile;
      processExcelBtn.innerHTML = 'Procesar Excel <span>→</span>';
    }
  });

  registerBtn.addEventListener('click', async () => {
    if (registerBtn.disabled || !currentPayload) return;

    registerBtn.disabled = true;
    registerBtn.textContent = 'Registrando…';
    setMessage('Registrando Prealerta de forma transaccional…');

    const { data, error } = await supabase.rpc('registrar_prealerta', { p_payload: currentPayload });

    if (error) {
      console.error('Error registrando Prealerta', error);
      registered = false;
      setMessage(error.message || 'No fue posible registrar la Prealerta.', 'error');
      await validatePayload(currentPayload);
      return;
    }

    registered = true;
    registerBtn.textContent = 'Registrado ✓';
    setMessage(
      'Prealerta ' + (data?.documento || currentPayload.documento) +
      ' registrada · ' + (data?.movimientos || 0) + ' movimiento(s).',
      'success'
    );
    renderValidation();
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    currentFile = null;
    currentPayload = null;
    currentValidation = null;
    registered = false;
    excelInput.value = '';
    excelFileName.textContent = 'Ningún archivo seleccionado';
    fileStatus.textContent = 'Excel listo para seleccionar';
    fileStatus.className = 'catalog-status';
    processExcelBtn.disabled = true;
    resultsSection.hidden = true;
    setMessage('');
    window.scrollTo({ top:0, behavior:'smooth' });
  });
});