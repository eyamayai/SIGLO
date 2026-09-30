document.addEventListener('DOMContentLoaded', () => {
  const VERSION = '20260930-3';
  const pdfInput = document.getElementById('pdfInput');
  const selectPdfBtn = document.getElementById('selectPdfBtn');
  const processPdfBtn = document.getElementById('processPdfBtn');
  const dropZone = document.getElementById('dropZone');
  const selectedFile = document.getElementById('selectedFile');
  const catalogStatus = document.getElementById('catalogStatus');
  const processMessage = document.getElementById('processMessage');
  const resultsSection = document.getElementById('resultsSection');
  const clearBtn = document.getElementById('clearBtn');
  const destinationSelect = document.getElementById('returnDestination');
  const destinationEffect = document.getElementById('destinationEffect');
  const desmonteLocationWrap = document.getElementById('returnDesmonteLocationWrap');
  const desmonteLocationSelect = document.getElementById('returnDesmonteLocation');
  const desmonteSegmentWrap = document.getElementById('returnDesmonteSegmentWrap');
  const desmonteSegmentSelect = document.getElementById('returnDesmonteSegment');
  const librePlacementWrap = document.getElementById('returnLibrePlacementWrap');
  const libreWarehouseSelect = document.getElementById('returnLibreWarehouse');
  const libreLocationSelect = document.getElementById('returnLibreLocation');
  const libreSegment = document.getElementById('returnLibreSegment');
  const preSigloNotice = document.getElementById('preSigloNotice');
  const registerBtn = document.getElementById('registerReturnBtn');

  let currentFile = null;
  let catalogMap = new Map();
  let currentMetadata = {};
  let currentClassification = null;
  let currentAnalysis = {seriales_pre_siglo:0,unidades_pre_siglo:0,unidades_sin_responsable:0,requiere_ubicacion_libre:false,bloqueos:[],hallazgos:[]};
  let locationCatalog = [];
  let devolucionRegistrada = false;

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const normalizeCode = value => String(value ?? '').trim();
  const normalizeTopology = value => String(value ?? '').trim().toUpperCase();

  async function loadCatalog() {
    try {
      let catalog = [];
      const supabase = window.sigloSupabase;
      if (supabase) {
        const { data, error } = await supabase.rpc('consultar_catalogo_codigos');
        if (!error && Array.isArray(data) && data.length) catalog = data;
      }

      if (!catalog.length) {
        const response = await fetch(`data/CodigosSAP.json?v=${VERSION}`, { cache:'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        catalog = await response.json();
      }

      catalogMap = new Map(catalog.map(item => [normalizeCode(item.codigo_sap), item]));

      if (supabase) {
        const {data:locations,error:locationError}=await supabase.rpc('consultar_catalogo_ubicaciones');
        if(!locationError && Array.isArray(locations)) locationCatalog=locations;
      }
      libreLocationSelect.innerHTML='<option value="">Seleccionar…</option>'+locationCatalog
        .map(item=>`<option value="${escapeHtml(item.ubicacion)}">${escapeHtml(item.ubicacion)} · ${escapeHtml(item.segmento)}</option>`)
        .join('');
      const segmentos=[...new Set(locationCatalog.map(item=>String(item.segmento||'').trim()).filter(Boolean))].sort();
      desmonteSegmentSelect.innerHTML='<option value="">Automático</option>'+segmentos
        .map(seg=>`<option value="${escapeHtml(seg)}">${escapeHtml(seg)}</option>`).join('');

      catalogStatus.textContent = `Catálogo listo · ${catalog.length} códigos SAP cargados`;
      catalogStatus.className = 'catalog-status ready';
      updateProcessButton();
    } catch (error) {
      catalogStatus.textContent = 'No fue posible cargar el catálogo de SIGLO';
      catalogStatus.className = 'catalog-status error';
      processMessage.textContent = 'No fue posible consultar la Maestra Códigos SAP.';
      processMessage.className = 'process-message error';
    }
  }

  function updateProcessButton(){ processPdfBtn.disabled = !(currentFile && catalogMap.size && window.pdfjsLib); }

  function setFile(file){
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      processMessage.textContent='Selecciona un archivo PDF válido.';
      processMessage.className='process-message error';
      return;
    }
    currentFile=file;
    selectedFile.textContent=`${file.name} · ${(file.size/1024).toFixed(1)} KB`;
    processMessage.textContent='';
    processMessage.className='process-message';
    updateProcessButton();
  }

  selectPdfBtn?.addEventListener('click', e => { e.stopPropagation(); pdfInput.click(); });
  dropZone?.addEventListener('click', e => { if (!e.target.closest('button')) pdfInput.click(); });
  dropZone?.addEventListener('keydown', e => {
    if (e.key==='Enter' || e.key===' ') { e.preventDefault(); pdfInput.click(); }
  });
  pdfInput?.addEventListener('change', () => setFile(pdfInput.files?.[0]));
  ['dragenter','dragover'].forEach(type => dropZone?.addEventListener(type,e=>{e.preventDefault();dropZone.classList.add('dragging');}));
  ['dragleave','drop'].forEach(type => dropZone?.addEventListener(type,e=>{e.preventDefault();dropZone.classList.remove('dragging');}));
  dropZone?.addEventListener('drop',e=>setFile(e.dataTransfer?.files?.[0]));

  function pageToLines(items){
    const rows=[];
    const serieHeader=items.find(item=>String(item.str||'').trim().toUpperCase()==='SERIE');
    const umedHeader=items.find(item=>String(item.str||'').trim().toUpperCase()==='UMED');
    const serieX=Number(serieHeader?.transform?.[4]);
    const serieY=Number(serieHeader?.transform?.[5]);
    const umedX=Number(umedHeader?.transform?.[4]);
    const hasSerieColumn=Number.isFinite(serieX)&&Number.isFinite(umedX)&&umedX>serieX;

    for (const item of items){
      let text=String(item.str||'').trim();
      if(!text) continue;
      const x=item.transform?.[4]??0, y=item.transform?.[5]??0;

      if(hasSerieColumn && Number.isFinite(serieY) && y < serieY-2 && x>=serieX-4 && x<umedX-6){
        // Algunos PDF unen el final del serial con la palabra "Unidad".
        // Separamos ambos, pero conservamos la unidad para que la cantidad siga siendo detectable.
        const joinedUnit=text.match(/^(.*?)(Unidad|Unid\.?)$/i);
        if(joinedUnit && joinedUnit[1].trim()){
          text=`[[SERIE:${joinedUnit[1].trim()}]] ${joinedUnit[2]}`;
        }else{
          text=`[[SERIE:${text}]]`;
        }
      }

      let row=rows.find(r=>Math.abs(r.y-y)<=2.2);
      if(!row){row={y,items:[]};rows.push(row);}
      row.items.push({x,text});
    }
    return rows.sort((a,b)=>b.y-a.y)
      .map(row=>row.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' '))
      .join('\n');
  }

  async function extractText(file){
    const data=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data}).promise;
    const pages=[];
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n);
      const content=await page.getTextContent();
      pages.push(pageToLines(content.items));
    }
    return pages.join('\n');
  }

  function extractMetadata(text){
    const preferred=text.match(/RHAC1\s*\/\s*DEV[A-ZÁÉÍÓÚÑ]*\s*\/\s*[A-Z0-9-]+/i)?.[0];
    const candidates=[...text.matchAll(/RHAC1\s*\/\s*([A-ZÁÉÍÓÚÑ]{2,15})\s*\/\s*([A-Z0-9-]+)/gi)];
    const fallback=candidates.find(m=>!['ING','DES'].includes(String(m[1]).toUpperCase()))?.[0]||'';
    const documento=(preferred||fallback).replace(/\s/g,'');

    const trabajadorLinea=text.match(/(?:^|\n)\s*Trabajador\s+([^\n]+)/i)?.[1]||'';
    const trabajador=trabajadorLinea
      .replace(/\s+C\.\s*Bandeja.*$/i,'')
      .replace(/\s+/g,' ')
      .trim();

    const nombreMatch=text.match(
      /Nombre:\s*([\s\S]*?)(?=\s*(?:Bandeja:|Fecha\s+(?:env[ií]o|devoluci[oó]n|documento):|RHAC1\s*\/|DOMINION\s+COLOMBIA\s+SAS|$))/i
    );
    const nombre=trabajador || (nombreMatch?.[1]||'').replace(/\s+/g,' ').trim();

    const cedulaPdf=text.match(/(?:CC|C[eé]dula):\s*(\d+)/i)?.[1]||'';
    const fecha=text.match(/Fecha\s+(?:env[ií]o|devoluci[oó]n|documento):\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i)?.[1]
      || text.match(/Fecha\s*:?\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i)?.[1] || '';

    return {documento,cedula:'',cedulaPdf,nombre,fecha,cedulaLookupMessage:''};
  }

  async function resolveCedula(metadata){
    if(!metadata.nombre){
      metadata.cedula='';
      metadata.cedulaLookupMessage='No se detectó el nombre del técnico en el PDF.';
      return metadata;
    }

    const supabase=window.sigloSupabase;
    if(!supabase){
      metadata.cedula='';
      metadata.cedulaLookupMessage='No fue posible consultar la cédula del técnico en SIGLO.';
      return metadata;
    }

    const {data:{session}}=await supabase.auth.getSession();
    if(!session){
      window.location.replace('index.html');
      return metadata;
    }

    const {data,error}=await supabase.rpc('buscar_cedula_tecnico',{p_nombre:metadata.nombre});
    if(error){
      console.error('Error buscando cédula del técnico',error);
      metadata.cedula='';
      metadata.cedulaLookupMessage=error.message||'No fue posible consultar la cédula del técnico.';
      return metadata;
    }

    if(data?.encontrado && data?.cedula){
      metadata.cedula=String(data.cedula);
      metadata.cedulaLookupMessage='';
      return metadata;
    }

    metadata.cedula='';
    metadata.cedulaLookupMessage=data?.mensaje||`No se encontró cédula en SIGLO para el técnico ${metadata.nombre}.`;
    return metadata;
  }

  function parseNumber(raw){
    let value=String(raw||'').replace(/\s+/g,'').trim();
    if(!value) return NaN;
    if(value.includes(',') && value.includes('.')){
      if(value.lastIndexOf(',')>value.lastIndexOf('.')) value=value.replaceAll('.','').replace(',','.');
      else value=value.replaceAll(',','');
    } else if(value.includes(',')) value=value.replace(',','.');
    return Number(value);
  }

  function findQuantity(segment){
    const assignment=/(\d+(?:[.,]\d+)?)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+([\d,.]+\.\d{2})/g;
    let match;
    while((match=assignment.exec(segment))!==null){
      const q=parseNumber(match[1]);
      if(Number.isFinite(q)) return {cantidad:q,index:match.index};
    }

    const alternate=/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+(\d[\d\s.,]*?)\s+([\d,.]+(?:\.\d{2}|,\d{2}))/g;
    while((match=alternate.exec(segment))!==null){
      const q=parseNumber(match[2]);
      if(Number.isFinite(q)) return {cantidad:q,index:match.index};
    }
    return null;
  }

  function normalizeSerialBreaks(value){
    return String(value||'')
      .replace(/[\uFFFE\uFFFD\u00AD\u2010\u2011\u2012\u2013\u2212]/g,'-');
  }

  function materialDataRegion(segment){
    const markers=[
      /\n\s*Firma\s+Resp\./i,
      /\n\s*Firma\s+T[eé]cnico/i,
      /\n\s*DOMINION\s+COLOMBIA\s+SAS/i,
      /\n\s*Calle\s+94A/i,
      /\n\s*P[aá]gina:/i
    ];
    let end=segment.length;
    markers.forEach(re=>{
      const match=re.exec(segment);
      if(match&&match.index<end) end=match.index;
    });
    return segment.slice(0,end).trim();
  }

  function serialCandidates(materialRegion,quantity){
    const expected=Math.max(0,Math.round(quantity||0));
    const normalized=normalizeSerialBreaks(materialRegion);

    const pieces=[...normalized.matchAll(/\[\[SERIE:([^\]]+)\]\]/gi)]
      .map(m=>String(m[1]||'').trim())
      .filter(Boolean);

    const rebuilt=[];
    for(const pieceRaw of pieces){
      const piece=pieceRaw.replace(/(Unidad|Unid\.?)$/i,'').trim();
      if(!piece) continue;

      if(rebuilt.length && /-$/.test(rebuilt[rebuilt.length-1]) && /^[A-Z0-9]{2,30}$/i.test(piece)){
        rebuilt[rebuilt.length-1]+=piece;
      }else{
        rebuilt.push(piece);
      }
    }

    const positioned=rebuilt.filter(token=>{
      const clean=token.replace(/[^A-Z0-9]/gi,'');
      return clean.length>=5 && /\d/.test(clean);
    });

    if(positioned.length>=expected && expected>0) return positioned.slice(0,expected);

    // Respaldo para PDF donde no se logre conservar la columna Serie:
    // serial terminado en guion + Unidad/Cantidad/Valor + continuación en la línea siguiente.
    const splitAcrossColumns=normalized.match(
      /\b([A-Z0-9]{5,30}-)\s*(?:Unidad|Unid\.?)\s+\d+(?:[.,]\d+)?\s+[\d,.]+(?:\.\d{2}|,\d{2})[\s\S]{0,100}?\b([A-Z0-9]{2,30})\b/i
    );
    if(splitAcrossColumns){
      const rebuiltSerial=splitAcrossColumns[1]+splitAcrossColumns[2];
      if(!positioned.includes(rebuiltSerial)) positioned.unshift(rebuiltSerial);
      if(positioned.length>=expected && expected>0) return positioned.slice(0,expected);
    }

    const plain=normalized.replace(/\[\[SERIE:([^\]]+)\]\]/gi,' $1 ');
    const raw=plain.match(/\b[A-Z0-9][A-Z0-9-]{4,40}\b/gi)||[];
    const fallback=raw.filter(token=>{
      const clean=token.replace(/[^A-Z0-9]/gi,'');
      return clean.length>=5 && /\d/.test(clean);
    });

    const combined=[...positioned];
    fallback.forEach(token=>{if(!combined.includes(token)) combined.push(token);});
    return expected ? combined.slice(-expected) : combined.slice(-1);
  }

  function cleanDescription(prefix,serials){
    let description=normalizeSerialBreaks(prefix)
      .replace(/\[\[SERIE:[^\]]+\]\]/gi,' ');
    serials.forEach(serial=>{description=description.replaceAll(serial,' ');});
    return description.replace(/[,;]+\s*$/g,'').replace(/\s+/g,' ').trim();
  }

  function extractItems(text){
    const headerRegex=/\[([^/\]]+)\/([^\]]+)\]/g;
    const headers=[];
    let match;
    while((match=headerRegex.exec(text))!==null){
      headers.push({index:match.index,end:headerRegex.lastIndex,dominio:match[1].trim(),codigo_sap:match[2].trim()});
    }
    const items=[];
    headers.forEach((header,index)=>{
      const end=index+1<headers.length?headers[index+1].index:text.length;
      const segment=text.slice(header.end,end);
      const materialRegion=materialDataRegion(segment);
      const quantityMatch=findQuantity(materialRegion);
      if(!quantityMatch) return;
      const cantidad=quantityMatch.cantidad;
      const prefix=materialRegion.slice(0,quantityMatch.index).trim();
      const config=catalogMap.get(normalizeCode(header.codigo_sap));
      const topologia=normalizeTopology(config?.topologia);
      const isSerial=topologia.includes('CON PERFIL DE SERIE')&&!topologia.includes('SIN PERFIL DE SERIE');
      const serials=isSerial?serialCandidates(materialRegion,cantidad):[];
      items.push({
        dominio:header.dominio,
        codigo_sap:normalizeCode(header.codigo_sap),
        detalle:cleanDescription(prefix,serials),
        cantidad,
        topologia:config?.topologia||'NO CONFIGURADO',
        serials
      });
    });
    return items;
  }

  function classify(items){
    const serializados=[], noSerialMap=new Map(), revisar=[], serialWarnings=[];
    items.forEach(item=>{
      const topologia=normalizeTopology(item.topologia);
      if(topologia.includes('SIN PERFIL DE SERIE')){
        const key=`${item.codigo_sap}|${item.dominio}`;
        const current=noSerialMap.get(key)||{codigo_sap:item.codigo_sap,dominio:item.dominio,cantidad:0};
        current.cantidad+=item.cantidad;
        noSerialMap.set(key,current);
        return;
      }
      if(topologia.includes('CON PERFIL DE SERIE')){
        item.serials.forEach(serial=>serializados.push({serial,codigo_sap:item.codigo_sap,dominio:item.dominio}));
        if(item.serials.length!==Math.round(item.cantidad)){
          serialWarnings.push(`${item.codigo_sap}/${item.dominio}: se esperaban ${Math.round(item.cantidad)} seriales y se detectaron ${item.serials.length}.`);
        }
        return;
      }
      revisar.push(item);
    });
    return {serializados,noSerializados:[...noSerialMap.values()],revisar,serialWarnings};
  }

  function renderRows(bodyId,rows,columns,colspan){
    const body=document.getElementById(bodyId);
    if(!rows.length){body.innerHTML=`<tr class="empty-row"><td colspan="${colspan}">Sin registros</td></tr>`;return;}
    body.innerHTML=rows.map(row=>`<tr>${columns.map(key=>`<td>${escapeHtml(row[key])}</td>`).join('')}</tr>`).join('');
  }

  function renderResults(metadata,classification,analysis){
    currentMetadata={...metadata}; currentClassification=classification;
    currentAnalysis=analysis||{seriales_pre_siglo:0,unidades_pre_siglo:0,unidades_sin_responsable:0,requiere_ubicacion_libre:false,bloqueos:[],hallazgos:[]};
    devolucionRegistrada=false;
    destinationSelect.value=''; libreWarehouseSelect.value=''; libreLocationSelect.value=''; libreSegment.textContent='Segmento: —';
    updatePreSigloNotice();
    updateDestinationEffect();

    document.getElementById('metaDocumento').textContent=metadata.documento||'No detectado';
    document.getElementById('metaTecnico').textContent=metadata.nombre||'No detectado';
    document.getElementById('metaCedula').textContent=metadata.cedula||'No encontrada en BD';
    document.getElementById('metaFecha').textContent=metadata.fecha||'No detectada';
    document.getElementById('countSerializados').textContent=classification.serializados.length;
    document.getElementById('countNoSerializados').textContent=classification.noSerializados.length;

    renderRows('serialBody',classification.serializados,['serial','codigo_sap','dominio'],3);
    renderRows('noSerialBody',classification.noSerializados.map(r=>({...r,cantidad:Number.isInteger(r.cantidad)?r.cantidad:r.cantidad.toFixed(2)})),['codigo_sap','dominio','cantidad'],3);

    const messages=[];
    if(!metadata.documento) messages.push('No se detectó el número de documento de devolución.');
    if(!metadata.nombre) messages.push('No se detectó el nombre del técnico en el PDF.');
    if(!metadata.cedula) messages.push(metadata.cedulaLookupMessage||'No se encontró la cédula del técnico en la base de datos.');
    messages.push(...classification.serialWarnings);
    classification.revisar.forEach(item=>messages.push(`${item.codigo_sap}/${item.dominio}: Código SAP sin topología configurada.`));
    (currentAnalysis.bloqueos||[]).forEach(item=>messages.push(item.detalle||'Error de validación contra el inventario.'));

    const reviewCard=document.getElementById('reviewCard');
    document.getElementById('reviewMessages').innerHTML=messages.map(m=>`<div class="review-message"><strong>Bloqueo:</strong> ${escapeHtml(m)}</div>`).join('');
    document.getElementById('countReview').textContent=messages.length;
    reviewCard.hidden=messages.length===0;

    resultsSection.hidden=false;
    validateRegistration();
    resultsSection.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function updatePreSigloNotice(){
    const seriales=Number(currentAnalysis?.seriales_pre_siglo||0);
    const unidades=Number(currentAnalysis?.unidades_pre_siglo||0);
    const sinResponsable=Number(currentAnalysis?.unidades_sin_responsable||0);
    const parts=[];
    if(seriales>0) parts.push(`${seriales} serial(es) PRE-SIGLO`);
    if(unidades>0) parts.push(`${unidades} unidad(es) no serializada(s) PRE-SIGLO`);
    if(sinResponsable>0) parts.push(`${sinResponsable} unidad(es) sin responsable identificado`);
    preSigloNotice.hidden=parts.length===0;
    preSigloNotice.innerHTML=parts.length
      ? `<strong>Clasificación especial detectada:</strong> ${escapeHtml(parts.join(' · '))}`
      : '';
  }

  function updateLibreSegment(){
    const selected=locationCatalog.find(item=>String(item.ubicacion)===libreLocationSelect.value);
    libreSegment.textContent='Segmento: '+(selected?.segmento||'—');
  }

  function updateDestinationEffect(){
    const value=destinationSelect.value;
    const needsPlacement=Boolean(currentAnalysis?.requiere_ubicacion_libre);
    destinationEffect.className='destination-effect';
    if(value==='LIBRE'){
      desmonteLocationWrap.hidden=true;
      desmonteSegmentWrap.hidden=true;
      desmonteLocationSelect.value='';
      desmonteSegmentSelect.value='';
      librePlacementWrap.hidden=!needsPlacement;
      destinationEffect.classList.add('libre');
      destinationEffect.textContent=needsPlacement
        ? 'Libre: el material con historial regresa a su ubicación de origen; el material PRE-SIGLO usará el Almacén y Ubicación seleccionados.'
        : 'Libre: el material con historial regresa a su ubicación de origen.';
    }else if(value==='DESMONTE'){
      librePlacementWrap.hidden=true;
      desmonteLocationWrap.hidden=false;
      desmonteSegmentWrap.hidden=false;
      const ubicacion=desmonteLocationSelect.value;
      const segmentoManual=desmonteSegmentSelect.value;
      destinationEffect.classList.add('desmonte');
      destinationEffect.textContent=ubicacion
        ? 'Desmonte: material → Garantía / Dañado · Stock 4 · NOVALORADO · A221 · '+ubicacion+'. El Segmento se conserva/infiere'+(segmentoManual?' o usa manualmente '+segmentoManual:'')+'.'
        : 'Desmonte: selecciona QMINTIC o QQ01Q1. El Segmento se conserva o se infiere; usa el selector manual solo si hace falta.';
    }else{
      desmonteLocationWrap.hidden=true;
      desmonteSegmentWrap.hidden=true;
      librePlacementWrap.hidden=true;
      desmonteLocationSelect.value='';
      desmonteSegmentSelect.value='';
      destinationEffect.textContent='Selecciona Libre o Desmonte para ver el resultado.';
    }
  }

  function validateRegistration(){
    if(resultsSection.hidden) return;
    const bar=document.querySelector('.return-register-bar');
    const title=document.getElementById('returnRegisterTitle');
    const help=document.getElementById('returnRegisterHelp');

    if(devolucionRegistrada){
      registerBtn.disabled=true; bar.classList.remove('error'); bar.classList.add('ready');
      title.textContent='Devolución registrada';
      help.textContent='El inventario y el historial fueron actualizados correctamente.';
      return;
    }

    const material=(currentClassification?.serializados?.length||0)+(currentClassification?.noSerializados?.length||0);
    const blockers=(currentMetadata.documento?0:1)+(currentMetadata.nombre?0:1)+(currentMetadata.cedula?0:1)
      +(currentClassification?.serialWarnings?.length||0)+(currentClassification?.revisar?.length||0);
    const destino=destinationSelect.value;
    const ubicacionDesmonte=desmonteLocationSelect.value;
    const requiereLibre=Boolean(currentAnalysis?.requiere_ubicacion_libre);
    const almacenLibre=libreWarehouseSelect.value;
    const ubicacionLibre=libreLocationSelect.value;

    if(!material){
      registerBtn.disabled=true;bar.classList.remove('ready','error');
      title.textContent='No hay materiales para devolver';help.textContent='Procesa un PDF válido.';return;
    }
    if(blockers){
      registerBtn.disabled=true;bar.classList.remove('ready','error');
      title.textContent='La devolución requiere revisión';help.textContent='Resuelve los bloqueos indicados antes de registrar.';return;
    }
    if(!destino){
      registerBtn.disabled=true;bar.classList.remove('ready','error');
      title.textContent='Selecciona el destino de la devolución';help.textContent='Elige Libre o Desmonte. El destino aplica a todo el PDF.';return;
    }
    if(destino==='DESMONTE'&&!ubicacionDesmonte){
      registerBtn.disabled=true;bar.classList.remove('ready','error');
      title.textContent='Selecciona la ubicación de Desmonte';help.textContent='Elige QMINTIC o QQ01Q1. La ubicación aplica a todo el PDF.';return;
    }
    if(destino==='LIBRE'&&requiereLibre&&(!almacenLibre||!ubicacionLibre)){
      registerBtn.disabled=true;bar.classList.remove('ready','error');
      title.textContent='Ubica el material PRE-SIGLO';help.textContent='Selecciona Almacén y Ubicación para el material que entra por primera vez a SIGLO.';return;
    }

    registerBtn.disabled=false;bar.classList.remove('error');bar.classList.add('ready');
    title.textContent='Devolución lista para registrar';
    help.textContent='SIGLO cerrará el saldo reconocido y recibirá también cualquier excedente no serializado como devolución con responsable no identificado.';
  }

  destinationSelect?.addEventListener('change',()=>{updateDestinationEffect();validateRegistration();});
  desmonteLocationSelect?.addEventListener('change',()=>{updateDestinationEffect();validateRegistration();});
  desmonteSegmentSelect?.addEventListener('change',()=>{updateDestinationEffect();validateRegistration();});
  libreWarehouseSelect?.addEventListener('change',validateRegistration);
  libreLocationSelect?.addEventListener('change',()=>{updateLibreSegment();validateRegistration();});

  processPdfBtn?.addEventListener('click',async()=>{
    if(!currentFile)return;
    processPdfBtn.disabled=true;processPdfBtn.textContent='Procesando…';
    processMessage.textContent='Leyendo PDF y clasificando materiales…';processMessage.className='process-message';
    try{
      const text=await extractText(currentFile);
      const metadata=await resolveCedula(extractMetadata(text));
      const items=extractItems(text);
      if(!items.length) throw new Error('No se detectaron materiales en el PDF.');
      const classification=classify(items);
      const supabase=window.sigloSupabase;
      const analysisPayload={
        cedula:metadata.cedula||'',
        seriales:classification.serializados.map(row=>({serial:row.serial,codigo_sap:row.codigo_sap,dominio:row.dominio})),
        no_serializados:classification.noSerializados.map(row=>({codigo_sap:row.codigo_sap,dominio:row.dominio,cantidad:Number(row.cantidad||0)}))
      };
      const {data:analysis,error:analysisError}=await supabase.rpc('analizar_devolucion',{p_payload:analysisPayload});
      if(analysisError) throw analysisError;
      renderResults(metadata,classification,analysis);
      const warnings=[];
      if(!metadata.documento) warnings.push('documento no detectado');
      if(!metadata.nombre) warnings.push('técnico no detectado');
      if(!metadata.cedula) warnings.push(metadata.cedulaLookupMessage||'cédula no encontrada en BD');
      warnings.push(...classification.serialWarnings);
      if(warnings.length){
        processMessage.textContent=`PDF procesado con observaciones: ${warnings.join(' · ')}`;
        processMessage.className='process-message error';
      }else{
        processMessage.textContent=`PDF procesado correctamente · ${items.length} material(es) detectado(s).`;
        processMessage.className='process-message success';
      }
    }catch(error){
      console.error(error);processMessage.textContent=error?.message||'No fue posible procesar el PDF.';
      processMessage.className='process-message error';resultsSection.hidden=true;
    }finally{
      processPdfBtn.innerHTML='Procesar PDF <span>→</span>';updateProcessButton();
    }
  });

  registerBtn?.addEventListener('click',async()=>{
    validateRegistration();if(registerBtn.disabled)return;
    const supabase=window.sigloSupabase;
    if(!supabase){processMessage.textContent='No fue posible conectar con la base de datos.';processMessage.className='process-message error';return;}
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){window.location.replace('index.html');return;}

    const payload={
      documento:currentMetadata.documento||'',
      fecha:currentMetadata.fecha||null,
      tecnico:currentMetadata.nombre||null,
      cedula:currentMetadata.cedula||'',
      destino:destinationSelect.value,
      ubicacion_desmonte:destinationSelect.value==='DESMONTE'?desmonteLocationSelect.value:'',
      segmento_desmonte:destinationSelect.value==='DESMONTE'?desmonteSegmentSelect.value:'',
      almacen_libre:destinationSelect.value==='LIBRE'?libreWarehouseSelect.value:'',
      ubicacion_libre:destinationSelect.value==='LIBRE'?libreLocationSelect.value:'',
      seriales:currentClassification.serializados.map(row=>({serial:row.serial,codigo_sap:row.codigo_sap,dominio:row.dominio})),
      no_serializados:currentClassification.noSerializados.map(row=>({codigo_sap:row.codigo_sap,dominio:row.dominio,cantidad:Number(row.cantidad||0)}))
    };

    const oldText=registerBtn.innerHTML;
    registerBtn.disabled=true;registerBtn.innerHTML='Registrando…';
    processMessage.textContent='Validando despachos pendientes y aplicando la devolución…';processMessage.className='process-message';

    const {data,error}=await supabase.rpc('registrar_devolucion',{p_payload:payload});
    if(error){
      console.error('Error registrando devolución',error);
      const dbMessage=error.message||'No fue posible registrar la devolución.';
      const bar=document.querySelector('.return-register-bar');
      registerBtn.innerHTML=oldText;devolucionRegistrada=false;
      processMessage.textContent='';processMessage.className='process-message';
      validateRegistration();
      bar?.classList.remove('ready');bar?.classList.add('error');
      document.getElementById('returnRegisterTitle').textContent='No se pudo registrar la devolución';
      document.getElementById('returnRegisterHelp').textContent=dbMessage;
      bar?.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }

    devolucionRegistrada=true;registerBtn.innerHTML='Registrado ✓';
    const extras=[];
     if(Number(data?.regularizaciones_tecnico||0)>0) extras.push(`${data.regularizaciones_tecnico} regularización(es) de técnico`);
     if(Number(data?.seriales_pre_siglo||0)>0) extras.push(`${data.seriales_pre_siglo} serial(es) PRE-SIGLO`);
     if(Number(data?.unidades_pre_siglo||0)>0) extras.push(`${data.unidades_pre_siglo} unidad(es) PRE-SIGLO`);
     if(Number(data?.unidades_sin_responsable||0)>0) extras.push(`${data.unidades_sin_responsable} unidad(es) sin responsable identificado`);
     processMessage.textContent=`Devolución ${data?.documento||payload.documento} registrada · destino ${data?.destino||payload.destino} · ${data?.movimientos||0} movimiento(s)${extras.length?' · '+extras.join(' · '):''}.`;
    processMessage.className='process-message success';
    validateRegistration();
  });

  clearBtn?.addEventListener('click',()=>{
    currentFile=null;pdfInput.value='';selectedFile.textContent='Ningún archivo seleccionado';
    processMessage.textContent='';processMessage.className='process-message';resultsSection.hidden=true;
    currentMetadata={};currentClassification=null;
    currentAnalysis={seriales_pre_siglo:0,unidades_pre_siglo:0,unidades_sin_responsable:0,requiere_ubicacion_libre:false,bloqueos:[],hallazgos:[]};
    devolucionRegistrada=false;destinationSelect.value='';desmonteLocationSelect.value='';desmonteSegmentSelect.value='';libreWarehouseSelect.value='';libreLocationSelect.value='';libreSegment.textContent='Segmento: —';
    updatePreSigloNotice();updateDestinationEffect();updateProcessButton();dropZone.scrollIntoView({behavior:'smooth',block:'center'});
  });

  loadCatalog();
});