window.SigloAudit = (() => {
  const normalizeHeader = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim().toUpperCase();

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  const text = value => String(value ?? '').trim();

  function buildSheet(headers, widths = []) {
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = headers.map((_,i) => ({ wch: widths[i] || 18 }));
    return ws;
  }

  function addInstructions(wb, lines) {
    const ws = XLSX.utils.aoa_to_sheet([
      ['SIGLO · Instrucciones'],
      ...lines.map(line => [line])
    ]);
    ws['!cols'] = [{ wch: 95 }];
    XLSX.utils.book_append_sheet(wb, ws, 'INSTRUCCIONES');
  }

  function downloadTemplate(kind) {
    if (!window.XLSX) throw new Error('No se pudo cargar el generador de Excel.');
    const wb = XLSX.utils.book_new();

    if (kind === 'carga-inicial') {
      const serialHeaders = ['Serial','Código SAP','Dominion','Descripción','Lote','Almacén','Ubicación','Tipo'];
      const saldoHeaders = ['Código SAP','Dominion','Descripción','Lote','Almacén','Ubicación','Tipo','Cantidad'];
      XLSX.utils.book_append_sheet(wb, buildSheet(serialHeaders,[24,14,18,42,14,12,18,14]), 'SERIALIZADOS');
      XLSX.utils.book_append_sheet(wb, buildSheet(saldoHeaders,[14,18,42,14,12,18,14,14]), 'NO_SERIALIZADOS');
      addInstructions(wb,[
        'No cambies los nombres de las hojas ni de las columnas.',
        'Lote: VALORADO o NOVALORADO.',
        'Almacén: A221 o U020.',
        'Tipo: LIBRE o DESMONTE.',
        'Serial debe tratarse como texto. Centro, Segmento, Estado y Topología los calcula SIGLO.',
        'En NO_SERIALIZADOS debe existir una sola fila por combinación SAP + Almacén + Lote + Ubicación + Tipo.'
      ]);
      XLSX.writeFile(wb,'SIGLO_Plantilla_Carga_Inicial.xlsx');
      return;
    }

    if (kind === 'tecnicos') {
      XLSX.utils.book_append_sheet(wb, buildSheet(['Cédula','Nombre completo','Estado'],[18,42,16]), 'TECNICOS');
      addInstructions(wb,[
        'No cambies el nombre de la hoja TECNICOS ni los encabezados.',
        'Estado permitido: ACTIVO o INACTIVO.',
        'La Cédula es la llave única del técnico. Los técnicos inactivos conservan todo su historial.'
      ]);
      XLSX.writeFile(wb,'SIGLO_Plantilla_Maestra_Tecnicos.xlsx');
      return;
    }

    if (kind === 'codigos') {
      XLSX.utils.book_append_sheet(wb, buildSheet(['Código SAP','Dominion','Descripción','Topología','Lote'],[16,18,46,26,16]), 'CODIGOS_SAP');
      addInstructions(wb,[
        'No cambies el nombre de la hoja CODIGOS_SAP ni los encabezados.',
        'Topología permitida: CON PERFIL DE SERIE o SIN PERFIL DE SERIE.',
        'Lote permitido: VALORADO o NOVALORADO.',
        'Un Código SAP puede tener más de un Dominion, pero solo uno por cada Lote y su Topología debe ser consistente.'
      ]);
      XLSX.writeFile(wb,'SIGLO_Plantilla_Maestra_Codigos_SAP.xlsx');
    }
  }

  async function readWorkbook(file) {
    if (!file) throw new Error('Selecciona un archivo Excel.');
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Selecciona un archivo Excel .xlsx o .xls.');
    const data = await file.arrayBuffer();
    return XLSX.read(data,{type:'array',cellDates:false});
  }

  function sheetRows(wb, sheetName, aliases) {
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`No se encontró la hoja "${sheetName}". Descarga y utiliza la plantilla de SIGLO.`);
    const raw = XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
    if (!raw.length) return [];

    const available = Object.keys(raw[0]).reduce((acc,key) => {
      acc[normalizeHeader(key)] = key;
      return acc;
    },{});

    const resolved = {};
    Object.entries(aliases).forEach(([field, names]) => {
      const match = names.map(normalizeHeader).find(name => available[name]);
      if (!match) throw new Error(`Falta la columna "${names[0]}" en la hoja ${sheetName}.`);
      resolved[field] = available[match];
    });

    return raw.map(row => {
      const out = {};
      Object.entries(resolved).forEach(([field,col]) => { out[field] = text(row[col]); });
      return out;
    }).filter(row => Object.values(row).some(Boolean));
  }

  function resultClass(result) {
    const v = String(result || '').toUpperCase();
    if (v === 'NUEVO') return 'new';
    if (v === 'COINCIDE') return 'same';
    if (v === 'ACTUALIZAR') return 'update';
    if (v === 'CONFLICTO') return 'conflict';
    return 'error';
  }

  return { normalizeHeader, escapeHtml, text, downloadTemplate, readWorkbook, sheetRows, resultClass };
})();