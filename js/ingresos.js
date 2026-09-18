document.addEventListener('DOMContentLoaded', () => {
  const VERSION = '20260918-8';
  const pdfInput = document.getElementById('pdfInput');
  const selectPdfBtn = document.getElementById('selectPdfBtn');
  const processPdfBtn = document.getElementById('processPdfBtn');
  const dropZone = document.getElementById('dropZone');
  const selectedFile = document.getElementById('selectedFile');
  const catalogStatus = document.getElementById('catalogStatus');
  const processMessage = document.getElementById('processMessage');
  const resultsSection = document.getElementById('resultsSection');
  const clearBtn = document.getElementById('clearBtn');
  const registerBtn = document.getElementById('registerBtn');
  const allocationBody = document.getElementById('allocationBody');

  let currentFile = null;
  let catalog = [];
  let catalogMap = new Map();
  let locations = [];
  let locationMap = new Map();
  let currentRows = [];
  let blockingIssues = [];
  let currentAllocations = new Map();

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
  const isSerialTopology = (value) => {
    const top = normalizeTopology(value);
    return top.includes('CON PERFIL DE SERIE') && !top.includes('SIN PERFIL DE SERIE');
  };

  async function loadCatalog() {
    try {
      const [topologyResponse, locationResponse] = await Promise.all([
        fetch(`data/CodigosSAP.json?v=${VERSION}`, { cache: 'no-store' }),
        fetch(`data/Ubicaciones.json?v=${VERSION}`, { cache: 'no-store' })
      ]);

      if (!topologyResponse.ok) throw new Error(`CodigosSAP.json · HTTP ${topologyResponse.status}`);
      if (!locationResponse.ok) throw new Error(`Ubicaciones.json · HTTP ${locationResponse.status}`);

      catalog = await topologyResponse.json();
      locations = await locationResponse.json();

      catalogMap = new Map(catalog.map(item => [normalizeCode(item.codigo_sap), item]));
      locationMap = new Map(locations.map(item => [normalizeCode(item.ubicacion), String(item.segmento || '').trim()]));

      catalogStatus.textContent = `Catálogos listos · ${catalog.length} códigos SAP · ${locations.length} ubicaciones`;
      catalogStatus.className = 'catalog-status ready';
      updateProcessButton();
    } catch (error) {
      catalogStatus.textContent = 'No fue posible cargar los catálogos de SIGLO';
      catalogStatus.className = 'catalog-status error';
      processMessage.textContent = 'Verifica data/CodigosSAP.json y data/Ubicaciones.json.';
      processMessage.className = 'process-message error';
      console.error(error);
    }
  }

  function updateProcessButton() {
    processPdfBtn.disabled = !(currentFile && catalogMap.size && locationMap.size && window.pdfjsLib);
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

  function pageToRows(items) {
    const rows = [];
    for (const item of items) {
      const text = String(item.str || '').trim();
      if (!text) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      let row = rows.find(entry => Math.abs(entry.y - y) <= 2.2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, text });
    }

    return rows
      .sort((a, b) => b.y - a.y)
      .map(row => {
        row.items.sort((a, b) => a.x - b.x);
        return { ...row, text: row.items.map(item => item.text).join(' ') };
      });
  }

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error('No se pudo cargar el lector PDF del navegador.');
    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const rows = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      rows.push(...pageToRows(content.items));
    }
    return {
      rows,
      text: rows.map(row => row.text).join('\n')
    };
  }

  function extractMetadata(text) {
    const documento = text.match(/RHAC1\s*\/\s*ING\s*\/\s*\d+/i)?.[0]?.replace(/\s/g, '') || '';
    const fecha = text.match(/Fecha\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i)?.[1] || '';
    const almacenPdf = text.match(/Almac[eé]n\s+(.+?)\s+Fecha\s+/i)?.[1]?.trim() || '';
    const responsable = text.match(/Resp\.?Almac[eé]n\s+(.+?)(?:\n|Material\s+Serie)/i)?.[1]?.trim() || '';
    const observacion = text.match(/Observaciones\s+(.+?)\s+Resp\.?Almac[eé]n/i)?.[1]?.trim() || '';
    return { documento, fecha, almacenPdf, responsable, observacion };
  }

  function parseColombianNumber(value) {
    const raw = String(value || '').replace(/\s+/g, '').replaceAll('.', '').replace(',', '.');
    const number = Number(raw);
    return Number.isFinite(number) ? number : 0;
  }

  function cleanSerialValue(value) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/^[,;:]+|[,;:]+$/g, '');
  }

  function serialCharacterCount(value) {
    return (cleanSerialValue(value).match(/[A-Za-z0-9]/g) || []).length;
  }

  function isValidSerial(value) {
    const serial = cleanSerialValue(value);
    return serial !== '-' && serialCharacterCount(serial) >= 5;
  }

  function findColumnLayout(rows, startIndex) {
    for (let index = startIndex - 1; index >= Math.max(0, startIndex - 45); index -= 1) {
      const row = rows[index];
      const material = row.items.find(item => /^Material$/i.test(item.text));
      const serie = row.items.find(item => /^Serie$/i.test(item.text));
      const umed = row.items.find(item => /^UMed$/i.test(item.text));
      const cantidad = row.items.find(item => /^Cantidad$/i.test(item.text));

      if (material && serie && umed && cantidad) {
        const control = row.items.find(item => /^Control$/i.test(item.text));
        const valor = row.items.find(item => /^Valor$/i.test(item.text));
        const materialMax = (material.x + serie.x) / 2;
        const serieMax = (serie.x + umed.x) / 2;
        const unitMax = (umed.x + cantidad.x) / 2;
        const quantityMax = control
          ? (cantidad.x + control.x) / 2
          : (valor ? (cantidad.x + valor.x) / 2 : cantidad.x + 95);

        return {
          materialMax,
          serieMin: materialMax,
          serieMax,
          unitMin: serieMax,
          unitMax,
          quantityMin: unitMax,
          quantityMax
        };
      }
    }

    // Respaldo para PDFs antiguos con el mismo diseño.
    return {
      materialMax: 270,
      serieMin: 270,
      serieMax: 330,
      unitMin: 330,
      unitMax: 405,
      quantityMin: 405,
      quantityMax: 510
    };
  }

  function extractSerialsByRow(block, layout) {
    const candidates = [];

    block.forEach(row => {
      const fragments = row.items
        .filter(item => item.x >= layout.serieMin && item.x < layout.serieMax)
        .map(item => item.text)
        .filter(Boolean);

      if (!fragments.length) return;

      // Un PDF puede fragmentar visualmente un serial en varios trozos de texto.
      // Los reunimos por fila antes de validarlo.
      const serial = cleanSerialValue(fragments.join(''));
      if (isValidSerial(serial)) candidates.push(serial);
    });

    return candidates;
  }

  function extractProducts(rows) {
    const starts = [];
    const headerRegex = /\[([^/\]]+)\/([^\]]+)\]/;

    rows.forEach((row, index) => {
      const match = row.text.match(headerRegex);
      if (match) starts.push({ index, match });
    });

    const products = [];
    const issues = [];
    const notices = [];

    starts.forEach((start, position) => {
      const endIndex = position + 1 < starts.length ? starts[position + 1].index : rows.length;
      const rawBlock = rows.slice(start.index, endIndex);
      const footerIndex = rawBlock.findIndex(row =>
        /Firma Resp\.|Firma Técnico|DOMINION COLOMBIA SAS|Calle 94A|Bogot[aá]|NIT:|P[aá]gina:/i.test(row.text)
      );
      const block = footerIndex >= 0 ? rawBlock.slice(0, footerIndex) : rawBlock;
      if (!block.length) return;

      const first = block[0];
      const dominioPdf = start.match[1].trim();
      const codigoSap = normalizeCode(start.match[2]);
      const config = catalogMap.get(codigoSap);
      const topologia = config?.topologia || 'NO CONFIGURADO';

      const firstHeaderText = start.match[0];
      const layout = findColumnLayout(rows, start.index);
      const descriptionParts = [];
      const unitParts = [];
      const quantityParts = [];

      block.forEach((row, rowIndex) => {
        row.items.forEach(item => {
          if (item.x < layout.materialMax) {
            let part = item.text;
            if (rowIndex === 0) part = part.replace(firstHeaderText, '').trim();
            if (part && !/^(Material|Serie|UMed|Cantidad|Control|Valor)$/i.test(part)) descriptionParts.push(part);
          } else if (item.x >= layout.unitMin && item.x < layout.unitMax && rowIndex === 0) {
            unitParts.push(item.text);
          } else if (item.x >= layout.quantityMin && item.x < layout.quantityMax && rowIndex === 0) {
            quantityParts.push(item.text);
          }
        });
      });

      let descripcionPdf = descriptionParts.join(' ').replace(/\s+/g, ' ').trim();

      // El PDF define el lote: "(NO VALORADO)" se almacena como NOVALORADO.
      // Si no aparece esa marca, el material se almacena como VALORADO.
      const marcadoNoValorado = /\(\s*NO\s+VALORADO\s*\)/i.test(descripcionPdf);
      const lote = marcadoNoValorado ? 'NOVALORADO' : 'VALORADO';

      descripcionPdf = descripcionPdf
        .replace(/\(\s*NO\s+VALORADO\s*\)/ig, '')
        .replace(/\s+/g, ' ')
        .trim();

      const cantidad = parseColombianNumber(quantityParts.join(' '));
      const unidad = unitParts.join(' ').trim();
      const serials = extractSerialsByRow(block, layout);

      if (!config) {
        issues.push(`Código SAP ${codigoSap}: no existe en el catálogo de topologías.`);
      }

      // Dominion y descripción provienen del PDF. El JSON solo decide la Topología.
      const descripcion = descripcionPdf || 'SIN DESCRIPCIÓN';
      const serializado = isSerialTopology(topologia);

      if (serializado) {
        const expected = Math.max(1, Math.round(cantidad || serials.length || 1));

        if (serials.length > expected) {
          issues.push(`Código SAP ${codigoSap}: se esperaban ${expected} serial(es) y se detectaron ${serials.length}. Revisa el PDF.`);
        }

        serials.slice(0, expected).forEach((serial, serialIndex) => products.push({
          _rowId: `serial-${position}-${serialIndex}`,
          codigo_sap: codigoSap,
          dominio_pdf: dominioPdf,
          descripcion,
          topologia,
          serial,
          cantidad: 1,
          lote,
          unidad,
          stock: '1',
          tipo: 'LIBRE',
          estado: 'Bueno'
        }));

        const missing = Math.max(0, expected - serials.length);
        for (let missingIndex = 0; missingIndex < missing; missingIndex += 1) {
          products.push({
            _rowId: `serial-${position}-missing-${missingIndex}`,
            codigo_sap: codigoSap,
            dominio_pdf: dominioPdf,
            descripcion,
            topologia,
            serial: '',
            cantidad: 1,
            lote,
            unidad,
            stock: '1',
            tipo: 'LIBRE',
            estado: 'Bueno',
            serial_manual: true
          });
        }
      } else {
        products.push({
          codigo_sap: codigoSap,
          dominio_pdf: dominioPdf,
          descripcion,
          topologia,
          serial: '',
          cantidad,
          lote,
          unidad,
          stock: '1',
          tipo: 'LIBRE',
          estado: 'Bueno'
        });
      }
    });

    return { products, issues, notices };
  }

  function getAllocation(dominio) {
    return currentAllocations.get(normalizeCode(dominio)) || { almacen: '', ubicacion: '', segmento: '' };
  }

  function locationOptions() {
    return [
      '<option value="">Seleccionar</option>',
      ...locations.map(item => `<option value="${escapeHtml(item.ubicacion)}">${escapeHtml(item.ubicacion)}</option>`)
    ].join('');
  }

  function renderAllocations(rows) {
    const unique = new Map();

    rows.forEach(row => {
      const key = normalizeCode(row.dominio_pdf);
      if (!unique.has(key)) {
        unique.set(key, { row, cantidad: 0 });
      }
      const entry = unique.get(key);
      entry.cantidad += Number(row.cantidad || 0);
    });

    currentAllocations = new Map(
      [...unique.keys()].map(key => [key, { almacen: '', ubicacion: '', segmento: '' }])
    );

    const ubicacionOptions = locationOptions();

    allocationBody.innerHTML = [...unique.entries()].map(([dominio, entry]) => {
      const row = entry.row;
      const cantidad = Number.isInteger(entry.cantidad)
        ? entry.cantidad
        : Number(entry.cantidad || 0).toLocaleString('es-CO');

      return `
        <tr data-dominio="${escapeHtml(dominio)}">
          <td class="dominion-code">${escapeHtml(dominio)}</td>
          <td><strong>${escapeHtml(row.codigo_sap)}</strong></td>
          <td>${escapeHtml(row.descripcion)}</td>
          <td><span class="lote-pill">${escapeHtml(row.lote)}</span></td>
          <td class="allocation-quantity"><strong>${escapeHtml(cantidad)}</strong></td>
          <td>
            <select class="allocation-almacen" aria-label="Almacén para ${escapeHtml(dominio)}">
              <option value="">Seleccionar</option>
              <option value="A221">A221</option>
              <option value="U020">U020</option>
            </select>
          </td>
          <td>
            <select class="allocation-ubicacion" aria-label="Ubicación para ${escapeHtml(dominio)}">
              ${ubicacionOptions}
            </select>
          </td>
          <td class="allocation-segmento"><span class="segment-auto">—</span></td>
        </tr>`;
    }).join('');

    allocationBody.querySelectorAll('select').forEach(control => {
      control.addEventListener('change', handleAllocationChange);
    });
  }

  function handleAllocationChange(event) {
    const tr = event.target.closest('tr[data-dominio]');
    if (!tr) return;

    const dominio = tr.dataset.dominio;
    const almacen = tr.querySelector('.allocation-almacen')?.value || '';
    const ubicacion = tr.querySelector('.allocation-ubicacion')?.value || '';
    const segmento = ubicacion ? (locationMap.get(normalizeCode(ubicacion)) || '') : '';

    currentAllocations.set(dominio, { almacen, ubicacion, segmento });

    const segmentCell = tr.querySelector('.allocation-segmento');
    if (segmentCell) {
      segmentCell.innerHTML = `<span class="segment-auto${segmento ? ' ready' : ''}">${escapeHtml(segmento || '—')}</span>`;
    }

    validateRegistration();
  }

  function renderDetail(rows) {
    const body = document.getElementById('detailBody');
    body.innerHTML = rows.map(row => {
      const top = normalizeTopology(row.topologia);
      const topClass = top.includes('SIN PERFIL') ? 'saldo' : (top.includes('CON PERFIL') ? 'serial' : 'review');
      const cantidad = Number.isInteger(row.cantidad) ? row.cantidad : Number(row.cantidad || 0).toLocaleString('es-CO');
      return `
        <tr>
          <td class="dominion-code">${escapeHtml(row.dominio_pdf)}</td>
          <td><strong>${escapeHtml(row.codigo_sap)}</strong></td>
          <td>${escapeHtml(row.descripcion)}</td>
          <td><span class="topology-pill ${topClass}">${escapeHtml(row.topologia)}</span></td>
          <td>${escapeHtml(row.serial || '—')}</td>
          <td>${escapeHtml(cantidad)}</td>
        </tr>`;
    }).join('');
  }

  function unresolvedSerialRows() {
    return currentRows.filter(row => isSerialTopology(row.topologia) && !isValidSerial(row.serial));
  }

  function updateReviewCounter() {
    document.getElementById('countRevisar').textContent = blockingIssues.length + unresolvedSerialRows().length;
  }

  function renderReview(issues, notices) {
    blockingIssues = issues;
    const card = document.getElementById('reviewCard');
    const list = document.getElementById('reviewList');
    const missingRows = unresolvedSerialRows();
    const all = [
      ...issues.map(text => ({ text, blocking: true })),
      ...notices.map(text => ({ text, blocking: false }))
    ];

    if (!all.length && !missingRows.length) {
      card.hidden = true;
      list.innerHTML = '';
      updateReviewCounter();
      return;
    }

    const staticItems = all.map(item => `
      <div class="review-item">
        <strong>${item.blocking ? 'Bloqueo' : 'Aviso'}:</strong>
        ${escapeHtml(item.text)}
      </div>`).join('');

    const corrections = missingRows.length ? `
      <div class="serial-corrections">
        <div class="serial-corrections-title">
          <strong>Seriales pendientes de completar</strong>
          <span>El serial debe contener al menos 5 dígitos o caracteres.</span>
        </div>
        ${missingRows.map(row => `
          <div class="serial-correction-row" data-row-id="${escapeHtml(row._rowId || '')}">
            <div><span>Dominion</span><strong>${escapeHtml(row.dominio_pdf)}</strong></div>
            <div><span>Código SAP</span><strong>${escapeHtml(row.codigo_sap)}</strong></div>
            <div class="serial-correction-description"><span>Descripción</span><strong>${escapeHtml(row.descripcion)}</strong></div>
            <label>
              <span>Serial *</span>
              <input class="serial-fix-input invalid" type="text" autocomplete="off"
                placeholder="Ingresar serial" value="${escapeHtml(row.serial || '')}">
            </label>
          </div>`).join('')}
      </div>` : '';

    list.innerHTML = staticItems + corrections;
    card.hidden = false;
    updateReviewCounter();

    list.querySelectorAll('.serial-fix-input').forEach(input => {
      input.addEventListener('input', handleSerialCorrection);
      input.addEventListener('change', () => {
        if (isValidSerial(input.value)) renderReview(blockingIssues, notices);
      });
    });
  }

  function handleSerialCorrection(event) {
    const rowElement = event.target.closest('[data-row-id]');
    const row = currentRows.find(item => item._rowId === rowElement?.dataset.rowId);
    if (!row) return;

    row.serial = cleanSerialValue(event.target.value);
    const valid = isValidSerial(row.serial);
    event.target.classList.toggle('invalid', !valid);
    event.target.classList.toggle('corrected', valid);

    renderDetail(currentRows);
    updateReviewCounter();
    validateRegistration();
  }

  function renderResults(metadata, parsed) {
    document.getElementById('metaDocumento').textContent = metadata.documento || 'No detectado';
    document.getElementById('metaFecha').textContent = metadata.fecha || 'No detectada';
    document.getElementById('metaAlmacenPdf').textContent = metadata.almacenPdf || 'No detectado';
    document.getElementById('metaResponsable').textContent = metadata.responsable || 'No detectado';
    document.getElementById('metaObservacion').textContent = metadata.observacion || 'Sin observación';

    const serializados = parsed.products.filter(row => isSerialTopology(row.topologia)).length;
    const noSerializados = parsed.products.filter(row => normalizeTopology(row.topologia).includes('SIN PERFIL')).length;
    document.getElementById('countSerializados').textContent = serializados;
    document.getElementById('countNoSerializados').textContent = noSerializados;
    currentRows = parsed.products;
    document.getElementById('countRevisar').textContent =
      parsed.issues.length + currentRows.filter(row => isSerialTopology(row.topologia) && !isValidSerial(row.serial)).length;
    renderAllocations(currentRows);
    renderDetail(currentRows);
    renderReview(parsed.issues, parsed.notices);
    resultsSection.hidden = false;
    validateRegistration();
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateRegistration() {
    if (resultsSection.hidden) return;

    const bar = document.querySelector('.register-bar');
    const title = document.getElementById('registerTitle');
    const help = document.getElementById('registerHelp');

    let pending = 0;

    allocationBody.querySelectorAll('tr[data-dominio]').forEach(tr => {
      const almacenSelect = tr.querySelector('.allocation-almacen');
      const ubicacionSelect = tr.querySelector('.allocation-ubicacion');
      const missingAlmacen = !almacenSelect?.value;
      const missingUbicacion = !ubicacionSelect?.value;
      const allocation = getAllocation(tr.dataset.dominio);
      const missingSegmento = Boolean(ubicacionSelect?.value) && !allocation.segmento;

      almacenSelect?.classList.toggle('invalid', missingAlmacen);
      ubicacionSelect?.classList.toggle('invalid', missingUbicacion || missingSegmento);

      if (missingAlmacen) pending += 1;
      if (missingUbicacion || missingSegmento) pending += 1;
    });

    if (pending) {
      registerBtn.disabled = true;
      bar.classList.remove('ready');
      title.textContent = 'Faltan datos obligatorios';
      help.textContent = 'Completa el Almacén y la Ubicación de cada Código Dominion.';
      return;
    }

    const serialesPendientes = unresolvedSerialRows().length;
    if (blockingIssues.length || serialesPendientes) {
      registerBtn.disabled = true;
      bar.classList.remove('ready');
      title.textContent = 'El ingreso requiere revisión';
      help.textContent = serialesPendientes
        ? `Completa ${serialesPendientes} serial(es) pendiente(s) antes de registrar.`
        : 'Resuelve los bloqueos indicados antes de registrar.';
      return;
    }

    registerBtn.disabled = false;
    bar.classList.add('ready');
    title.textContent = 'Ingreso listo para registrar';
    help.textContent = 'Todos los destinos están completos y el PDF superó las validaciones.';
  }

  processPdfBtn?.addEventListener('click', async () => {
    if (!currentFile) return;
    processPdfBtn.disabled = true;
    processPdfBtn.textContent = 'Procesando…';
    processMessage.textContent = 'Leyendo PDF y validando la topología de cada Código SAP…';
    processMessage.className = 'process-message';

    try {
      const extracted = await extractPdf(currentFile);
      const metadata = extractMetadata(extracted.text);
      const parsed = extractProducts(extracted.rows);
      if (!parsed.products.length) throw new Error('No se detectaron materiales en el PDF.');

      renderResults(metadata, parsed);

      const serialesPendientes = parsed.products.filter(
        row => isSerialTopology(row.topologia) && !isValidSerial(row.serial)
      ).length;

      if (parsed.issues.length || serialesPendientes) {
        const partes = [];
        if (parsed.issues.length) partes.push(`${parsed.issues.length} bloqueo(s)`);
        if (serialesPendientes) partes.push(`${serialesPendientes} serial(es) pendiente(s)`);
        processMessage.textContent = `PDF procesado con ${partes.join(' y ')}. Corrige la revisión requerida antes de registrar.`;
        processMessage.className = 'process-message error';
      } else {
        processMessage.textContent = `PDF procesado correctamente · ${parsed.products.length} registro(s) preparados. Completa los datos obligatorios.`;
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

  registerBtn?.addEventListener('click', () => {
    validateRegistration();
    if (registerBtn.disabled) return;

    const payload = currentRows.map(row => {
      const destino = getAllocation(row.dominio_pdf);
      return {
        ...row,
        centro: 'C903',
        almacen: destino.almacen,
        ubicacion: destino.ubicacion,
        segmento: destino.segmento
      };
    });
    console.log('SIGLO · Ingreso validado (sin persistencia BD)', payload);

    processMessage.textContent = `Ingreso validado: ${payload.length} registro(s) listos. En esta etapa de SIGLO todavía no se almacena información en una BD.`;
    processMessage.className = 'process-message success';

    const oldText = registerBtn.innerHTML;
    registerBtn.innerHTML = 'Validado ✓';
    setTimeout(() => { registerBtn.innerHTML = oldText; }, 1800);
  });

  clearBtn?.addEventListener('click', () => {
    currentFile = null;
    currentRows = [];
    blockingIssues = [];
    pdfInput.value = '';
    selectedFile.textContent = 'Ningún archivo seleccionado';
    processMessage.textContent = '';
    processMessage.className = 'process-message';
    resultsSection.hidden = true;
    currentAllocations = new Map();
    if (allocationBody) allocationBody.innerHTML = '';
    updateProcessButton();
    dropZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  loadCatalog();
});