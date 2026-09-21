document.addEventListener('DOMContentLoaded', () => {
  const VERSION = '20260921-3';
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
  const registerBtn = document.getElementById('registerReturnBtn');

  let currentFile = null;
  let catalogMap = new Map();
  let currentMetadata = {};
  let currentClassification = null;
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
    for (const item of items){
      const text=String(item.str||'').trim();
      if(!text) continue;
      const x=item.transform?.[4]??0, y=item.transform?.[5]??0;
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

  function serialCandidates(prefix,quantity){
    const raw=prefix.match(/\b[A-Z0-9][A-Z0-9-]{4,30}\b/gi)||[];
    const candidates=raw.filter(token => {
      const clean=token.replace(/[^A-Z0-9]/gi,'');
      return clean.length>=5 && /\d/.test(clean);
    });
    const expected=Math.max(0,Math.round(quantity||0));
    return expected ? candidates.slice(-expected) : candidates.slice(-1);
  }

  function cleanDescription(prefix,serials){
    let description=prefix;
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
      const quantityMatch=findQuantity(segment);
      if(!quantityMatch) return;
      const cantidad=quantityMatch.cantidad;
      const prefix=segment.slice(0,quantityMatch.index).trim();
      const config=catalogMap.get(normalizeCode(header.codigo_sap));
      const topologia=normalizeTopology(config?.topologia);
      const isSerial=topologia.includes('CON PERFIL DE SERIE')&&!topologia.includes('SIN PERFIL DE SERIE');
      const serials=isSerial?serialCandidates(prefix,cantidad):[];
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

  function renderResults(metadata,classification){
    currentMetadata={...metadata}; currentClassification=classification; devolucionRegistrada=false;
    destinationSelect.value='';
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

    const reviewCard=document.getElementById('reviewCard');
    document.getElementById('reviewMessages').innerHTML=messages.map(m=>`<div class="review-message"><strong>Bloqueo:</strong> ${escapeHtml(m)}</div>`).join('');
    document.getElementById('countReview').textContent=messages.length;
    reviewCard.hidden=messages.length===0;

    resultsSection.hidden=false;
    validateRegistration();
    resultsSection.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function updateDestinationEffect(){
    const value=destinationSelect.value;
    destinationEffect.className='destination-effect';
    if(value==='LIBRE'){
      desmonteLocationWrap.hidden=true;
      desmonteLocationSelect.value='';
      destinationEffect.classList.add('libre');
      destinationEffect.textContent='Libre: serializados → Disponible / Bueno. El material regresa a la ubicación de origen.';
    }else if(value==='DESMONTE'){
      desmonteLocationWrap.hidden=false;
      const ubicacion=desmonteLocationSelect.value;
      destinationEffect.classList.add('desmonte');
      destinationEffect.textContent=ubicacion
        ? 'Desmonte: material → Garantía / Dañado · Stock 4 · NOVALORADO · A221 · '+ubicacion+'. El saldo queda separado como DESMONTE.'
        : 'Desmonte: selecciona QMINTIC o QQ01Q1 para definir la ubicación de todo el PDF.';
    }else{
      desmonteLocationWrap.hidden=true;
      desmonteLocationSelect.value='';
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

    registerBtn.disabled=false;bar.classList.remove('error');bar.classList.add('ready');
    title.textContent='Devolución lista para registrar';
    help.textContent='SIGLO validará que todo el material tenga un despacho pendiente antes de modificar el inventario.';
  }

  destinationSelect?.addEventListener('change',()=>{updateDestinationEffect();validateRegistration();});
  desmonteLocationSelect?.addEventListener('change',()=>{updateDestinationEffect();validateRegistration();});

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
      renderResults(metadata,classification);
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
    processMessage.textContent=`Devolución ${data?.documento||payload.documento} registrada · destino ${data?.destino||payload.destino} · ${data?.movimientos||0} movimiento(s).`;
    processMessage.className='process-message success';
    validateRegistration();
  });

  clearBtn?.addEventListener('click',()=>{
    currentFile=null;pdfInput.value='';selectedFile.textContent='Ningún archivo seleccionado';
    processMessage.textContent='';processMessage.className='process-message';resultsSection.hidden=true;
    currentMetadata={};currentClassification=null;devolucionRegistrada=false;destinationSelect.value='';desmonteLocationSelect.value='';
    updateDestinationEffect();updateProcessButton();dropZone.scrollIntoView({behavior:'smooth',block:'center'});
  });

  loadCatalog();
});