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
    const textPages = [];
    let inheritedLayout = null;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = pageToRows(content.items);
      const layout = findPageLayout(rows, inheritedLayout);
      inheritedLayout = layout;
      pages.push({ page: pageNumber, rows, layout });
      textPages.push(pageToLines(content.items));
      try { page.cleanup(); } catch (_) {}
    }
    try { await pdf.destroy(); } catch (_) {}
    return { text: textPages.join('\n'), pages };
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


  // Reconstruye las filas del PDF conservando las coordenadas originales.
  // No mezclar Producto, Serie y Cantidad: pueden estar en la misma altura.
  function pageToRows(items) {
    const rows = [];
    for (const item of items) {
      const text = String(item.str || '').trim();
      if (!text) continue;
      const x = Number(item.transform?.[4] ?? 0);
      const y = Number(item.transform?.[5] ?? 0);
      let row = rows.find(entry => Math.abs(entry.y - y) <= 2.2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, text });
    }
    return rows.sort((a, b) => b.y - a.y).map(row => {
      row.items.sort((a, b) => a.x - b.x);
      return { ...row, text: row.items.map(item => item.text).join(' ') };
    });
  }

  function findPageLayout(rows, previous = null) {
    for (const row of rows) {
      const labels = row.items.map(item => ({ x: item.x, label: item.text.toUpperCase().trim() }));
      const product = labels.find(item => item.label === 'PRODUCTO' || item.label === 'MATERIAL');
      const serie = labels.find(item => item.label === 'SERIE');
      const cantidad = labels.find(item => item.label === 'CANTIDAD');
      const unidad = labels.find(item => item.label === 'UNIDAD' || item.label === 'UMED');
      if (product && serie && cantidad && unidad &&
          product.x < serie.x && serie.x < cantidad.x && cantidad.x < unidad.x) {
        return {
          productMin: Math.max(0, product.x - 24),
          productMax: serie.x - 4,
          serieMin: serie.x - 4,
          serieMax: cantidad.x - 4,
          quantityMin: cantidad.x - 4,
          quantityMax: unidad.x - 4
        };
      }
    }
    return previous;
  }

  function cellText(row, min, max) {
    return row.items.filter(item => item.x >= min && item.x < max)
      .map(item => item.text).join(' ').trim();
  }

  function parseQuantityCell(value) {
    const text = String(value || '').trim();
    if (!/^\\d+(?:[.,]\\d+)?$/.test(text)) return null;
    const number = Number(text.replace(',', '.'));
    return Number.isFinite(number) ? number : null;
  }

  function serialTokens(value) {
    const pieces = String(value || '')
      .replace(/[\\uFFFD\\u00AD\\u2010-\\u2013\\u2212]/g, '-')
      .split(/[\\s,;]+/)
      .map(token => token.replace(/^[,;:]+|[,;:]+$/g, ''))
      .filter(Boolean);
    const result = [];
    for (const piece of pieces) {
      if (result.length && /-$/.test(result[result.length - 1]) &&
          /^[A-Z0-9]{2,35}$/i.test(piece)) {
        result[result.length - 1] += piece;
        continue;
      }
      if (!/^[A-Z0-9-]{5,50}$/i.test(piece)) continue;
      const compact = piece.replace(/-/g, '');
      if ((compact.match(/\\d/g) || []).length < 2) continue;
      result.push(piece.toUpperCase());
    }
    return result;
  }

  function extractItemsFromPages(pages) {
    const items = [];
    const errors = [];
    let current = null;
    let totalHeaders = 0;
    let quantityRows = 0;

    const resolveHeader = () => {
      if (!current || current.headerResolved) return;
      const match = current.headerBuffer.match(/\\[\\s*DOM\\s*-\\s*(\\d+)\\s*\\/\\s*([A-Z0-9]+)\\s*\\]/i);
      if (!match) return;
      current.dominio = 'DOM-' + match[1];
      current.codigo_sap = normalizeCode(match[2].toUpperCase());
      const remainder = current.headerBuffer.slice(match.index + match[0].length).trim();
      if (remainder) current.descriptionParts.push(remainder);
      current.headerResolved = true;
    };

    const finalize = () => {
      if (!current) return;
      resolveHeader();
      if (!current.headerResolved) {
        errors.push('Código Dominion/SAP incompleto en página ' + current.pagina + '.');
      }
      if (current.cantidad === null || current.cantidad <= 0) {
        errors.push('Cantidad ausente o inválida en SAP ' +
          (current.codigo_sap || 'sin identificar') + ' (página ' + current.pagina + ').');
      }
      const seen = new Set();
      for (const serial of current.serials) {
        if (seen.has(serial)) {
          errors.push('Serial duplicado ' + serial + ' en SAP ' + current.codigo_sap + '.');
        }
        seen.add(serial);
      }
      current.serials = [...seen];
      current.detalle = current.descriptionParts.join(' ').replace(/\\s+/g, ' ').trim();
      delete current.headerBuffer;
      delete current.headerResolved;
      delete current.descriptionParts;
      items.push(current);
      current = null;
    };

    for (const page of pages) {
      if (!page.layout) {
        errors.push('No se identificaron las columnas de la tabla en página ' + page.page + '.');
        continue;
      }
      const layout = page.layout;
      for (const row of page.rows) {
        const product = cellText(row, layout.productMin, layout.productMax);
        const serie = cellText(row, layout.serieMin, layout.serieMax);
        const qty = cellText(row, layout.quantityMin, layout.quantityMax);

        if (/^Este c[oó]digo es [uú]nico/i.test(row.text) ||
            /^En caso de da[ñn]o/i.test(row.text)) {
          finalize();
          break;
        }

        const startsHeader = /\\[\\s*DOM\\s*-/i.test(product);
        if (startsHeader) {
          finalize();
          totalHeaders += 1;
          current = {
            pagina: page.page,
            headerBuffer: product,
            headerResolved: false,
            descriptionParts: [],
            serials: [],
            cantidad: null,
            dominio: '',
            codigo_sap: ''
          };
          resolveHeader();
        } else if (current) {
          if (!current.headerResolved) {
            if (product) current.headerBuffer += ' ' + product;
            resolveHeader();
          } else if (product) {
            current.descriptionParts.push(product);
          }
        }
        if (!current) continue;

        if (qty && parseQuantityCell(qty) !== null) quantityRows += 1;
        if (current.cantidad === null && qty) {
          const cantidad = parseQuantityCell(qty);
          if (cantidad !== null) current.cantidad = cantidad;
          else errors.push('Cantidad ilegible en página ' + page.page + ': ' + qty);
        }
        if (serie) current.serials.push(...serialTokens(serie));
      }
    }
    finalize();

    if (items.length !== totalHeaders || quantityRows !== items.length) {
      errors.push('Lectura incompleta: ' + totalHeaders + ' encabezados, ' +
        quantityRows + ' cantidades y ' + items.length + ' materiales interpretados.');
    }

    const resolved = items.map(item => {
      const config = catalogMap.get(item.codigo_sap);
      return { ...item, topologia: config?.topologia || 'NO CONFIGURADO' };
    });
    return { items: resolved, errors };
  }

  function classify(items, cedula) {
    const serializados = [];
    const noSerialMap = new Map();
    const revisar = [];
    const serialWarnings = [];
    const seenSerials = new Set();

    items.forEach(item => {
      const topologia = normalizeTopology(item.topologia);
      if (topologia.includes('SIN PERFIL DE SERIE')) {
        if (item.serials.length) {
          serialWarnings.push(item.codigo_sap + ': tiene seriales en el PDF pero el catálogo indica SIN PERFIL DE SERIE.');
        }
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
        item.serials.forEach(serial => {
          if (seenSerials.has(serial)) {
            serialWarnings.push('Serial repetido en el despacho: ' + serial + '.');
          }
          seenSerials.add(serial);
          serializados.push({
            serial,
            codigo_sap: item.codigo_sap,
            dominio: item.dominio,
            cedula
          });
        });
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
    messages.push(...(classification.lecturaErrores || []));
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
      (currentClassification?.lecturaErrores?.length || 0) +
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
      const { text, pages } = await extractTextFromPdf(currentFile);
      const metadata = extractMetadata(text);
      const { items, errors } = extractItemsFromPages(pages);
      if (!items.length) throw new Error('No se detectaron materiales en el PDF.');

      const classification = classify(items, metadata.cedula);
      classification.lecturaErrores = errors;
      renderResults(metadata, classification);

      const warnings = [];
      if (!metadata.cedula) warnings.push('No se detectó la cédula del técnico.');
      warnings.push(...classification.lecturaErrores);
      warnings.push(...classification.serialWarnings);
      if (warnings.length) {
        processMessage.textContent = `Procesado con observaciones: ${warnings.join(' ')}`;
        processMessage.className = 'process-message error';
      } else {
        processMessage.textContent = `PDF procesado correctamente · ${items.length} materiales y ${classification.serializados.length} seriales detectados.`;
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