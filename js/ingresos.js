document.addEventListener('DOMContentLoaded', () => {
  const VERSION = '20260918-4';
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
  const segmentoInput = document.getElementById('segmentoInput');
  const allocationBody = document.getElementById('allocationBody');

  let currentFile = null;
  let catalog = [];
  let catalogMap = new Map();
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
      const response = await fetch(`data/CodigosSAP.json?v=${VERSION}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      catalog = await response.json();
      catalogMap = new Map(catalog.map(item => [normalizeCode(item.codigo_sap), item]));
      catalogStatus.textContent = `Catálogo de topologías listo · ${catalog.length} códigos SAP`;
      catalogStatus.className = 'catalog-status ready';
      updateProcessButton();
    } catch (error) {
      catalogStatus.textContent = 'No fue posible cargar CodigosSAP.json';
      catalogStatus.className = 'catalog-status error';
      processMessage.textContent = 'Verifica que el catálogo de topologías exista en data/CodigosSAP.json.';
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

  function splitSerials(value) {
    return String(value || '')
      .replace(/[;,]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token && token !== '-' && (token.match(/[0-9]/g) || []).length >= 5);
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
      const descriptionParts = [];
      const seriesParts = [];
      const unitParts = [];
      const quantityParts = [];

      block.forEach((row, rowIndex) => {
        row.items.forEach(item => {
          if (item.x < 270) {
            let part = item.text;
            if (rowIndex === 0) part = part.replace(firstHeaderText, '').trim();
            if (part && !/^(Material|Serie|UMed|Cantidad|Control|Valor)$/i.test(part)) descriptionParts.push(part);
          } else if (item.x >= 270 && item.x < 330) {
            seriesParts.push(item.text);
          } else if (item.x >= 330 && item.x < 405 && rowIndex === 0) {
            unitParts.push(item.text);
          } else if (item.x >= 405 && item.x < 510 && rowIndex === 0) {
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
      const serials = splitSerials(seriesParts.join(' '));

      if (!config) {
        issues.push(`Código SAP ${codigoSap}: no existe en el catálogo de topologías.`);
      }

      // Dominion y descripción provienen del PDF. El JSON solo decide la Topología.
      const descripcion = descripcionPdf || 'SIN DESCRIPCIÓN';
      const serializado = isSerialTopology(topologia);

      if (serializado) {
        const expected = Math.max(1, Math.round(cantidad || serials.length || 1));
        if (serials.length !== expected) {
          issues.push(`Código SAP ${codigoSap}: se esperaban ${expected} serial(es) y se detectaron ${serials.length}.`);
        }
        if (serials.length) {
          serials.forEach(serial => products.push({
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
        } else {
          products.push({
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
            estado: 'Bueno'
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
    return currentAllocations.get(normalizeCode(dominio)) || { almacen: '', ubicacion: '' };
  }

  function renderAllocations(rows) {
    const unique = new Map();
    rows.forEach(row => {
      const key = normalizeCode(row.dominio_pdf);
      if (!unique.has(key)) unique.set(key, row);
    });

    currentAllocations = new Map([...unique.keys()].map(key => [key, { almacen: '', ubicacion: '' }]));

    allocationBody.innerHTML = [...unique.entries()].map(([dominio, row]) => `
      <tr data-dominio="${escapeHtml(dominio)}">
        <td class="dominion-code">${escapeHtml(dominio)}</td>
        <td><strong>${escapeHtml(row.codigo_sap)}</strong></td>
        <td>${escapeHtml(row.descripcion)}</td>
        <td><span class="lote-pill">${escapeHtml(row.lote)}</span></td>
        <td>
          <select class="allocation-almacen" aria-label="Almacén para ${escapeHtml(dominio)}">
            <option value="">Seleccionar</option>
            <option value="A221">A221</option>
            <option value="U020">U020</option>
          </select>
        </td>
        <td>
          <input class="allocation-ubicacion" type="text" autocomplete="off" placeholder="Ubicación" aria-label="Ubicación para ${escapeHtml(dominio)}">
        </td>
      </tr>`).join('');

    allocationBody.querySelectorAll('select,input').forEach(control => {
      control.addEventListener('input', handleAllocationChange);
      control.addEventListener('change', handleAllocationChange);
    });
  }

  function handleAllocationChange(event) {
    const tr = event.target.closest('tr[data-dominio]');
    if (!tr) return;
    const dominio = tr.dataset.dominio;
    currentAllocations.set(dominio, {
      almacen: tr.querySelector('.allocation-almacen')?.value || '',
      ubicacion: tr.querySelector('.allocation-ubicacion')?.value.trim() || ''
    });
    validateRegistration();
    renderDetail(currentRows);
  }

  function renderDetail(rows) {
    const body = document.getElementById('detailBody');
    const segmento = segmentoInput?.value.trim() || '';
    body.innerHTML = rows.map(row => {
      const top = normalizeTopology(row.topologia);
      const topClass = top.includes('SIN PERFIL') ? 'saldo' : (top.includes('CON PERFIL') ? 'serial' : 'review');
      const cantidad = Number.isInteger(row.cantidad) ? row.cantidad : Number(row.cantidad || 0).toLocaleString('es-CO');
      const destino = getAllocation(row.dominio_pdf);
      return `
        <tr>
          <td class="dominion-code">${escapeHtml(row.dominio_pdf)}</td>
          <td><strong>${escapeHtml(row.codigo_sap)}</strong></td>
          <td>${escapeHtml(row.descripcion)}</td>
          <td><span class="topology-pill ${topClass}">${escapeHtml(row.topologia)}</span></td>
          <td>${escapeHtml(row.serial || '—')}</td>
          <td>${escapeHtml(cantidad)}</td>
          <td><span class="lote-pill">${escapeHtml(row.lote)}</span></td>
          <td>${escapeHtml(row.stock)}</td>
          <td>${escapeHtml(row.tipo)}</td>
          <td>${escapeHtml(row.estado)}</td>
          <td class="destination-preview">C903</td>
          <td class="destination-preview">${escapeHtml(destino.almacen || '—')}</td>
          <td class="destination-preview">${escapeHtml(destino.ubicacion || '—')}</td>
          <td class="destination-preview">${escapeHtml(segmento || '—')}</td>
        </tr>`;
    }).join('');
  }

  function renderReview(issues, notices) {
    blockingIssues = issues;
    const card = document.getElementById('reviewCard');
    const list = document.getElementById('reviewList');
    const all = [
      ...issues.map(text => ({ text, blocking: true })),
      ...notices.map(text => ({ text, blocking: false }))
    ];

    if (!all.length) {
      card.hidden = true;
      list.innerHTML = '';
      return;
    }

    list.innerHTML = all.map(item => `
      <div class="review-item">
        <strong>${item.blocking ? 'Bloqueo' : 'Aviso'}:</strong>
        ${escapeHtml(item.text)}
      </div>`).join('');
    card.hidden = false;
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
    document.getElementById('countRevisar').textContent = parsed.issues.length;

    currentRows = parsed.products;
    renderAllocations(currentRows);
    renderDetail(currentRows);
    renderReview(parsed.issues, parsed.notices);
    resultsSection.hidden = false;
    validateRegistration();
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateRegistration() {
    if (resultsSection.hidden) return;

    const status = document.getElementById('manualStatus');
    const bar = document.querySelector('.register-bar');
    const title = document.getElementById('registerTitle');
    const help = document.getElementById('registerHelp');
    const segmento = segmentoInput?.value.trim() || '';

    let pending = segmento ? 0 : 1;
    segmentoInput?.classList.toggle('invalid', !segmento);

    allocationBody.querySelectorAll('tr[data-dominio]').forEach(tr => {
      const select = tr.querySelector('.allocation-almacen');
      const input = tr.querySelector('.allocation-ubicacion');
      const missingAlmacen = !select?.value;
      const missingUbicacion = !input?.value.trim();
      select?.classList.toggle('invalid', missingAlmacen);
      input?.classList.toggle('invalid', missingUbicacion);
      if (missingAlmacen) pending += 1;
      if (missingUbicacion) pending += 1;
    });

    if (pending) {
      status.textContent = `${pending} pendiente${pending === 1 ? '' : 's'}`;
      status.className = 'status-chip pending';
      registerBtn.disabled = true;
      bar.classList.remove('ready');
      title.textContent = 'Faltan datos obligatorios';
      help.textContent = 'Completa el Segmento y el destino de cada Código Dominion.';
      return;
    }

    status.textContent = 'Datos completos';
    status.className = 'status-chip ready';

    if (blockingIssues.length) {
      registerBtn.disabled = true;
      bar.classList.remove('ready');
      title.textContent = 'El ingreso requiere revisión';
      help.textContent = 'Resuelve los bloqueos indicados antes de registrar.';
      return;
    }

    registerBtn.disabled = false;
    bar.classList.add('ready');
    title.textContent = 'Ingreso listo para registrar';
    help.textContent = 'Todos los destinos están completos y el PDF superó las validaciones.';
  }

  segmentoInput?.addEventListener('input', () => {
    validateRegistration();
    renderDetail(currentRows);
  });

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

      if (parsed.issues.length) {
        processMessage.textContent = `PDF procesado con ${parsed.issues.length} bloqueo(s). La información no puede registrarse todavía.`;
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

    const segmento = segmentoInput?.value.trim() || '';
    const payload = currentRows.map(row => {
      const destino = getAllocation(row.dominio_pdf);
      return {
        ...row,
        centro: 'C903',
        almacen: destino.almacen,
        ubicacion: destino.ubicacion,
        segmento
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
    if (segmentoInput) {
      segmentoInput.value = '';
      segmentoInput.classList.remove('invalid');
    }
    if (allocationBody) allocationBody.innerHTML = '';
    updateProcessButton();
    dropZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  loadCatalog();
});