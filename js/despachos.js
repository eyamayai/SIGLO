document.addEventListener('DOMContentLoaded', () => {
  const VERSION = '20260918-10';
  const pdfInput = document.getElementById('pdfInput');
  const selectPdfBtn = document.getElementById('selectPdfBtn');
  const processPdfBtn = document.getElementById('processPdfBtn');
  const dropZone = document.getElementById('dropZone');
  const selectedFile = document.getElementById('selectedFile');
  const catalogStatus = document.getElementById('catalogStatus');
  const processMessage = document.getElementById('processMessage');
  const resultsSection = document.getElementById('resultsSection');
  const clearBtn = document.getElementById('clearBtn');
  const registerDispatchBtn = document.getElementById('registerDispatchBtn');

  let currentFile = null;
  let catalog = [];
  let catalogMap = new Map();
  let currentMetadata = {};
  let currentClassification = null;
  let despachoRegistrado = false;

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const normalizeCode = (value) => String(value ?? '').trim();
  const normalizeTopology = (value) => String(value ?? '').trim().toUpperCase();

  async function loadCatalog() {
    try {
      const supabase = window.sigloSupabase;
      if (supabase) {
        const { data, error } = await supabase.rpc('consultar_catalogo_codigos');
        if (!error && Array.isArray(data) && data.length) catalog = data;
      }

      if (!catalog.length) {
        const response = await fetch(`data/CodigosSAP.json?v=${VERSION}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        catalog = await response.json();
      }

      catalogMap = new Map(catalog.map(item => [normalizeCode(item.codigo_sap), item]));
      catalogStatus.textContent = `Catálogo listo · ${catalog.length} códigos SAP cargados`;
      catalogStatus.className = 'catalog-status ready';
      updateProcessButton();
    } catch (error) {
      catalogStatus.textContent = 'No fue posible cargar el catálogo de SIGLO';
      catalogStatus.className = 'catalog-status error';
      processMessage.textContent = 'No fue posible consultar la Maestra Códigos SAP.';
      processMessage.className = 'process-message error';
      console.error(error);
    }
  }

  function updateProcessButton() {
    processPdfBtn.disabled = !(currentFile && catalogMap.size && window.pdfjsLib);
  }

  function setFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      processMessage.textContent = 'Selecciona un archivo PDF válido.';
      processMessage.className = 'process-message error';
      return;
    }
    currentFile = file;
    selectedFile.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    processMessage.textContent = '';
    processMessage.className = 'process-message';
    updateProcessButton();
  }

  selectPdfBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    pdfInput.click();
  });
  dropZone?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    pdfInput.click();
  });
  dropZone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pdfInput.click();
    }
  });
  pdfInput?.addEventListener('change', () => setFile(pdfInput.files?.[0]));

  ['dragenter', 'dragover'].forEach(type => dropZone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(type => dropZone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  }));
  dropZone?.addEventListener('drop', (event) => setFile(event.dataTransfer?.files?.[0]));

  function pageToLines(items) {
    const rows = [];
    const serieHeader = items.find(item => String(item.str || '').trim().toUpperCase() === 'SERIE');
    const cantidadHeader = items.find(item => String(item.str || '').trim().toUpperCase() === 'CANTIDAD');
    const serieX = Number(serieHeader?.transform?.[4]);
    const cantidadX = Number(cantidadHeader?.transform?.[4]);
    const hasSeriesColumn = Number.isFinite(serieX) && Number.isFinite(cantidadX) && cantidadX > serieX;

    for (const item of items) {
      const text = String(item.str || '').trim();
      if (!text) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      let row = rows.find(r => Math.abs(r.y - y) <= 2.2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }

      const upper = text.toUpperCase();
      const isSeriesValue = hasSeriesColumn
        && upper !== 'SERIE'
        && x >= serieX - 4
        && x < cantidadX - 8;

      row.items.push({
        x,
        text: isSeriesValue ? `[[SERIE:${text}]]` : text
      });
    }

    return rows
      .sort((a, b) => b.y - a.y)
      .map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
      .join('\n');
  }

  async function extractTextFromPdf(file) {
    if (!window.pdfjsLib) throw new Error('No se pudo cargar el lector PDF del navegador.');
    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(pageToLines(content.items));
    }
    return pages.join('\n');
  }

  function extractMetadata(text) {
    // El marcado [[SERIE:...]] solo sirve para distinguir columnas de la tabla.
    // Para metadatos restauramos el texto original, porque CC, nombre o fecha
    // pueden coincidir horizontalmente con la columna Serie.
    const metadataText = text.replace(/\[\[SERIE:([^\]]+)\]\]/gi, '$1');

    const documento = metadataText.match(/RHAC1\s*\/\s*DES\s*\/\s*\d+/i)?.[0]?.replace(/\s/g, '') || '';
    const cedula = metadataText.match(/CC:\s*(\d+)/i)?.[1] || '';

    const nombreMatch = metadataText.match(
      /Nombre:\s*([\s\S]*?)(?=\s*(?:Bandeja:|Fecha\s+env[ií]o:|RHAC1\s*\/\s*DES\s*\/\s*\d+|DOMINION\s+COLOMBIA\s+SAS|$))/i
    );
    const nombre = (nombreMatch?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim();

    const fecha = metadataText.match(/Fecha\s+env[ií]o:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i)?.[1] || '';
    return { documento, cedula, nombre, fecha };
  }

  function findQuantityMatch(segment) {
    const re = /(\d+(?:[.,]\d+)?)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+([\d,.]+\.\d{2})/g;
    let match;
    while ((match = re.exec(segment)) !== null) {
      const value = Number(match[3].replaceAll(',', ''));
      if (Number.isFinite(value)) return match;
    }
    return null;
  }

  function materialDataRegion(segment) {
    const markers = [
      /\n\s*[0-9a-f]{8,}\|/i,
      /\n\s*Este\s+c[oó]digo\s+es\s+[uú]nico/i,
      /\n\s*CC:\s*\d+/i,
      /\n\s*Nombre:/i,
      /\n\s*Bandeja:/i,
      /\n\s*DOMINION\s+COLOMBIA\s+SAS/i,
      /\n\s*P[aá]gina:/i
    ];
    let end = segment.length;
    markers.forEach(re => {
      const match = re.exec(segment);
      if (match && match.index < end) end = match.index;
    });
    return segment.slice(0, end).trim();
  }

  function normalizeSerialBreaks(value) {
    return String(value || '')
      .replace(/[\uFFFE\uFFFD\u00AD\u2010\u2011\u2012\u2013\u2212]/g, '-')
      .replace(/([A-Z0-9]{5,30})-\s+([A-Z0-9]{2,30})/gi, '$1-$2');
  }

  function serialCandidates(materialRegion, quantity) {
    materialRegion = normalizeSerialBreaks(materialRegion);
    const expected = Math.max(0, Math.round(quantity));
    if (!expected) return [];

    const isLikelySerial = token => {
      const cleanToken = String(token || '').replace(/^[,;:]+|[,;:]+$/g, '');
      const digits = (cleanToken.match(/\d/g) || []).length;
      const compact = cleanToken.replaceAll('-', '');
      const hexadecimal = /^[A-F0-9]+$/i.test(compact);

      if (digits >= 6) return true;
      if (hexadecimal && compact.length >= 10 && digits >= 2) return true;

      const letters = (compact.match(/[A-Z]/gi) || []).length;
      return compact.length >= 10 && digits >= 2 && letters >= 4;
    };

    // Primera opción: usar exclusivamente lo que el PDF ubica físicamente
    // en la columna "Serie". Esto evita confundir modelos de producto
    // (por ejemplo CGA2121CLC) con seriales reales.
    const positionedStopwords = new Set(['SERIE','UNIDAD','UNID','CANTIDAD','VALORIZADO']);
    const positioned = [...materialRegion.matchAll(/\[\[SERIE:([^\]]+)\]\]/gi)]
      .flatMap(match => String(match[1] || '').split(/[\s,;]+/))
      .map(token => token.replace(/^[,;:]+|[,;:]+$/g, ''))
      .filter(token => {
        if (!token) return false;
        const compact = token.replaceAll('-', '').toUpperCase();
        return /^[A-Z0-9-]{5,40}$/i.test(token)
          && /[A-Z0-9]/i.test(compact)
          && !positionedStopwords.has(compact);
      });

    if (positioned.length >= expected) {
      return positioned.slice(0, expected);
    }

    // Respaldo para plantillas antiguas donde PDF.js no conserve la columna.
    const raw = materialRegion.match(/\b[A-Z0-9][A-Z0-9-]{7,30}\b/gi) || [];
    const fallback = raw
      .map(token => token.replace(/^[,;:]+|[,;:]+$/g, ''))
      .filter(token => isLikelySerial(token));

    const combined = [...positioned];
    fallback.forEach(token => {
      if (!combined.includes(token)) combined.push(token);
    });
    return combined.slice(-expected);
  }

  function cleanDescription(prefix, serials) {
    let description = prefix.replace(/\[\[SERIE:[^\]]+\]\]/gi, ' ');
    serials.forEach(serial => {
      description = description.replaceAll(serial, ' ');
    });
    return description
      .replace(/[,;]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractItems(text) {
    const headerRegex = /\[([^/\]]+)\/([^\]]+)\]/g;
    const headers = [];
    let match;
    while ((match = headerRegex.exec(text)) !== null) {
      headers.push({ index: match.index, end: headerRegex.lastIndex, dominio: match[1].trim(), codigo_sap: match[2].trim() });
    }

    const items = [];
    headers.forEach((header, index) => {
      const end = index + 1 < headers.length ? headers[index + 1].index : text.length;
      const segment = text.slice(header.end, end);
      const materialRegion = materialDataRegion(segment);
      const quantityMatch = findQuantityMatch(materialRegion);
      if (!quantityMatch) return;

      const cantidad = Number(quantityMatch[1].replace(',', '.'));
      const unidad = quantityMatch[2];
      const valor = Number(quantityMatch[3].replaceAll(',', ''));
      const config = catalogMap.get(normalizeCode(header.codigo_sap));
      const topologia = normalizeTopology(config?.topologia);
      const isSerial = topologia.includes('CON PERFIL DE SERIE') && !topologia.includes('SIN PERFIL DE SERIE');
      const serials = isSerial ? serialCandidates(materialRegion, cantidad) : [];
      const detailSource = materialRegion.replace(quantityMatch[0], ' ');
      const detalle = cleanDescription(detailSource, serials);

      items.push({
        dominio: header.dominio,
        codigo_sap: normalizeCode(header.codigo_sap),
        detalle,
        cantidad,
        unidad,
        valor,
        topologia: config?.topologia || 'NO CONFIGURADO',
        serials
      });
    });
    return items;
  }

  function classify(items, cedula) {
    const serializados = [];
    const noSerialMap = new Map();
    const revisar = [];
    const serialWarnings = [];

    items.forEach(item => {
      const topologia = normalizeTopology(item.topologia);
      if (topologia.includes('SIN PERFIL DE SERIE')) {
        const key = `${item.codigo_sap}|${item.dominio}`;
        const current = noSerialMap.get(key) || {
          codigo_sap: item.codigo_sap,
          dominio: item.dominio,
          cantidad: 0,
          cedula
        };
        current.cantidad += item.cantidad;
        noSerialMap.set(key, current);
        return;
      }

      if (topologia.includes('CON PERFIL DE SERIE')) {
        item.serials.forEach(serial => serializados.push({
          serial,
          codigo_sap: item.codigo_sap,
          dominio: item.dominio,
          cedula
        }));
        if (item.serials.length !== Math.round(item.cantidad)) {
          serialWarnings.push(`${item.codigo_sap}: se esperaban ${Math.round(item.cantidad)} seriales y se detectaron ${item.serials.length}.`);
        }
        return;
      }

      revisar.push(item);
    });

    return {
      serializados,
      noSerializados: [...noSerialMap.values()],
      revisar,
      serialWarnings
    };
  }

  function renderTableBody(bodyId, rows, columns, emptyColspan) {
    const body = document.getElementById(bodyId);
    if (!rows.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${emptyColspan}">Sin registros</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(row => `<tr>${columns.map(key => `<td>${escapeHtml(row[key])}</td>`).join('')}</tr>`).join('');
  }

  function renderResults(metadata, classification) {
    currentMetadata = { ...metadata };
    currentClassification = classification;
    despachoRegistrado = false;

    document.getElementById('metaDocumento').textContent = metadata.documento || 'No detectado';
    document.getElementById('metaTecnico').textContent = metadata.nombre || 'No detectado';
    document.getElementById('metaCedula').textContent = metadata.cedula || 'No detectada';
    document.getElementById('metaFecha').textContent = metadata.fecha || 'No detectada';

    document.getElementById('countSerializados').textContent = classification.serializados.length;
    document.getElementById('countNoSerializados').textContent = classification.noSerializados.length;

    renderTableBody('serialBody', classification.serializados, ['serial', 'codigo_sap', 'dominio', 'cedula'], 4);
    renderTableBody('noSerialBody', classification.noSerializados.map(row => ({
      ...row,
      cantidad: Number.isInteger(row.cantidad) ? row.cantidad : row.cantidad.toFixed(2)
    })), ['codigo_sap', 'dominio', 'cantidad', 'cedula'], 4);

    const reviewCard = document.getElementById('reviewCard');
    const reviewBody = document.getElementById('reviewBody');
    const reviewMessages = document.getElementById('reviewMessages');
    const reviewTableWrap = document.getElementById('reviewTableWrap');
    const messages = [];

    if (!metadata.documento) messages.push('No se detectó el número de documento del despacho.');
    if (!metadata.cedula) messages.push('No se detectó la cédula del técnico.');
    messages.push(...classification.serialWarnings);

    reviewMessages.innerHTML = messages.map(message =>
      `<div class="review-message"><strong>Bloqueo:</strong> ${escapeHtml(message)}</div>`
    ).join('');

    if (classification.revisar.length) {
      reviewBody.innerHTML = classification.revisar.map(item => `
        <tr>
          <td><strong>${escapeHtml(item.codigo_sap)}</strong></td>
          <td>${escapeHtml(item.dominio)}</td>
          <td>${escapeHtml(item.detalle)}</td>
          <td>${escapeHtml(Number.isInteger(item.cantidad) ? item.cantidad : item.cantidad.toFixed(2))}</td>
          <td><span class="status-pill">${escapeHtml(item.topologia)}</span></td>
        </tr>`).join('');
      reviewTableWrap.hidden = false;
    } else {
      reviewBody.innerHTML = '';
      reviewTableWrap.hidden = true;
    }

    const blockers = messages.length + classification.revisar.length;
    document.getElementById('countNoConfigurados').textContent = blockers;
    reviewCard.hidden = blockers === 0;

    resultsSection.hidden = false;
    validateDispatchRegistration();
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateDispatchRegistration() {
    if (resultsSection.hidden) return;

    const bar = document.querySelector('.dispatch-register-bar');
    const title = document.getElementById('dispatchRegisterTitle');
    const help = document.getElementById('dispatchRegisterHelp');

    if (despachoRegistrado) {
      registerDispatchBtn.disabled = true;
      bar.classList.remove('error');
      bar.classList.add('ready');
      title.textContent = 'Despacho registrado';
      help.textContent = 'La salida ya fue aplicada al inventario y almacenada en la base de datos.';
      return;
    }

    registerDispatchBtn.innerHTML = 'Registrar despacho <span>→</span>';

    const seriales = currentClassification?.serializados?.length || 0;
    const noSerializados = currentClassification?.noSerializados?.length || 0;
    const blockers =
      (currentMetadata.documento ? 0 : 1) +
      (currentMetadata.cedula ? 0 : 1) +
      (currentClassification?.serialWarnings?.length || 0) +
      (currentClassification?.revisar?.length || 0);

    if (!seriales && !noSerializados) {
      registerDispatchBtn.disabled = true;
      bar.classList.remove('ready', 'error');
      title.textContent = 'No hay materiales para registrar';
      help.textContent = 'Procesa un PDF de despacho válido.';
      return;
    }

    if (blockers) {
      registerDispatchBtn.disabled = true;
      bar.classList.remove('ready', 'error');
      title.textContent = 'El despacho requiere revisión';
      help.textContent = 'Resuelve los bloqueos indicados antes de registrar.';
      return;
    }

    registerDispatchBtn.disabled = false;
    bar.classList.remove('error');
    bar.classList.add('ready');
    title.textContent = 'Despacho listo para registrar';
    help.textContent = 'SIGLO validará existencias y estados nuevamente en la base de datos.';
  }

  processPdfBtn?.addEventListener('click', async () => {
    if (!currentFile) return;
    processPdfBtn.disabled = true;
    processPdfBtn.textContent = 'Procesando…';
    processMessage.textContent = 'Leyendo PDF y cruzando códigos SAP…';
    processMessage.className = 'process-message';

    try {
      const text = await extractTextFromPdf(currentFile);
      const metadata = extractMetadata(text);
      const items = extractItems(text);
      if (!items.length) throw new Error('No se detectaron materiales en el PDF.');

      const classification = classify(items, metadata.cedula);
      renderResults(metadata, classification);

      const warnings = [];
      if (!metadata.cedula) warnings.push('No se detectó la cédula del técnico.');
      warnings.push(...classification.serialWarnings);
      if (warnings.length) {
        processMessage.textContent = `Procesado con observaciones: ${warnings.join(' ')}`;
        processMessage.className = 'process-message error';
      } else {
        processMessage.textContent = `PDF procesado correctamente · ${items.length} materiales detectados.`;
        processMessage.className = 'process-message success';
      }
    } catch (error) {
      console.error(error);
      processMessage.textContent = error?.message || 'No fue posible procesar el PDF.';
      processMessage.className = 'process-message error';
      resultsSection.hidden = true;
    } finally {
      processPdfBtn.innerHTML = 'Procesar PDF <span>→</span>';
      updateProcessButton();
    }
  });

  registerDispatchBtn?.addEventListener('click', async () => {
    validateDispatchRegistration();
    if (registerDispatchBtn.disabled) return;

    const supabase = window.sigloSupabase;
    if (!supabase) {
      processMessage.textContent = 'No fue posible conectar con la base de datos.';
      processMessage.className = 'process-message error';
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      processMessage.textContent = 'Tu sesión expiró. Inicia sesión nuevamente antes de registrar el despacho.';
      processMessage.className = 'process-message error';
      setTimeout(() => window.location.replace('index.html'), 1400);
      return;
    }

    const payload = {
      documento: currentMetadata.documento || '',
      fecha: currentMetadata.fecha || null,
      tecnico: currentMetadata.nombre || null,
      cedula: currentMetadata.cedula || '',
      seriales: currentClassification.serializados.map(row => ({
        serial: row.serial,
        codigo_sap: row.codigo_sap,
        dominio: row.dominio
      })),
      no_serializados: currentClassification.noSerializados.map(row => ({
        codigo_sap: row.codigo_sap,
        dominio: row.dominio,
        cantidad: Number(row.cantidad || 0)
      }))
    };

    const oldText = registerDispatchBtn.innerHTML;
    registerDispatchBtn.disabled = true;
    registerDispatchBtn.innerHTML = 'Registrando…';
    processMessage.textContent = 'Validando existencias y aplicando el despacho en SIGLO…';
    processMessage.className = 'process-message';

    const { data, error } = await supabase.rpc('registrar_despacho', {
      p_payload: payload
    });

    if (error) {
      console.error('Error registrando despacho', error);
      const dbMessage = error.message || 'No fue posible registrar el despacho.';
      const registerBar = document.querySelector('.dispatch-register-bar');
      const registerTitle = document.getElementById('dispatchRegisterTitle');
      const registerHelp = document.getElementById('dispatchRegisterHelp');

      registerDispatchBtn.innerHTML = oldText;
      despachoRegistrado = false;
      processMessage.textContent = '';
      processMessage.className = 'process-message';

      validateDispatchRegistration();

      registerBar?.classList.remove('ready');
      registerBar?.classList.add('error');
      if (registerTitle) registerTitle.textContent = 'No se pudo registrar el despacho';
      if (registerHelp) registerHelp.textContent = dbMessage;

      registerBar?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    despachoRegistrado = true;
    registerDispatchBtn.innerHTML = 'Registrado ✓';
    processMessage.textContent =
      `Despacho ${data?.documento || payload.documento} registrado correctamente · ` +
      `${data?.serializados ?? payload.seriales.length} serial(es) · ` +
      `${data?.unidades_no_serializadas ?? 0} unidad(es) no serializada(s).`;
    processMessage.className = 'process-message success';
    validateDispatchRegistration();
  });

  clearBtn?.addEventListener('click', () => {
    currentFile = null;
    pdfInput.value = '';
    selectedFile.textContent = 'Ningún archivo seleccionado';
    processMessage.textContent = '';
    processMessage.className = 'process-message';
    resultsSection.hidden = true;
    currentMetadata = {};
    currentClassification = null;
    despachoRegistrado = false;
    registerDispatchBtn.innerHTML = 'Registrar despacho <span>→</span>';
    updateProcessButton();
    dropZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.querySelectorAll('[data-copy-table]').forEach(button => {
    button.addEventListener('click', async () => {
      const table = document.getElementById(button.dataset.copyTable);
      const rows = [...table.querySelectorAll('tr')].filter(row => !row.classList.contains('empty-row'));
      if (rows.length <= 1) return;
      const text = rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.innerText.trim()).join('\t')).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        const oldText = button.textContent;
        button.textContent = 'Copiado ✓';
        setTimeout(() => { button.textContent = oldText; }, 1600);
      } catch {
        processMessage.textContent = 'El navegador no permitió copiar automáticamente la tabla.';
        processMessage.className = 'process-message error';
      }
    });
  });

  loadCatalog();
});