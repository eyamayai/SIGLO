document.addEventListener('DOMContentLoaded', () => {
  const VERSION='20260922-2';
  const supabase=window.sigloSupabase;
  const pdfInput=document.getElementById('pdfInput');
  const selectPdfBtn=document.getElementById('selectPdfBtn');
  const processPdfBtn=document.getElementById('processPdfBtn');
  const dropZone=document.getElementById('dropZone');
  const selectedFile=document.getElementById('selectedFile');
  const catalogStatus=document.getElementById('catalogStatus');
  const processMessage=document.getElementById('processMessage');
  const resultsSection=document.getElementById('resultsSection');
  const clearBtn=document.getElementById('clearBtn');
  const registerBtn=document.getElementById('registerBtn');
  const destinationSelect=document.getElementById('destinationSelect');
  const destinationHint=document.getElementById('destinationHint');

  let currentFile=null;
  let catalog=[];
  let catalogMap=new Map();
  let currentPayload=null;
  let currentValidation=null;
  let currentMetadata=null;
  let currentClassification=null;
  let registered=false;

  if(window.pdfjsLib){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const esc=value=>String(value??'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
  const norm=value=>String(value??'').trim();
  const normCode=value=>norm(value);
  const normTopology=value=>norm(value).toUpperCase();

  async function loadCatalog(){
    try{
      if(supabase){
        const {data,error}=await supabase.rpc('consultar_catalogo_codigos');
        if(!error && Array.isArray(data) && data.length) catalog=data;
      }
      if(!catalog.length){
        const response=await fetch('data/CodigosSAP.json?v='+VERSION,{cache:'no-store'});
        if(!response.ok) throw new Error('HTTP '+response.status);
        catalog=await response.json();
      }
      catalogMap=new Map(catalog.map(item=>[normCode(item.codigo_sap),item]));
      catalogStatus.textContent='Catálogo listo · '+catalog.length+' códigos SAP cargados';
      catalogStatus.className='catalog-status ready';
      updateProcessButton();
    }catch(error){
      console.error(error);
      catalogStatus.textContent='No fue posible cargar el catálogo de SIGLO';
      catalogStatus.className='catalog-status error';
      processMessage.textContent='No fue posible consultar la Maestra Códigos SAP.';
      processMessage.className='process-message error';
    }
  }

  function updateProcessButton(){
    processPdfBtn.disabled=!(currentFile && catalogMap.size && window.pdfjsLib);
  }

  function setFile(file){
    if(!file) return;
    if(file.type!=='application/pdf' && !file.name.toLowerCase().endsWith('.pdf')){
      processMessage.textContent='Selecciona un archivo PDF válido.';
      processMessage.className='process-message error';
      return;
    }
    currentFile=file;
    selectedFile.textContent=file.name+' · '+(file.size/1024).toFixed(1)+' KB';
    processMessage.textContent='';
    processMessage.className='process-message';
    resultsSection.hidden=true;
    currentPayload=null;
    currentValidation=null;
    currentMetadata=null;
    currentClassification=null;
    destinationSelect.value='';
    updateDestinationHint();
    registered=false;
    updateProcessButton();
  }

  selectPdfBtn.addEventListener('click',e=>{e.stopPropagation();pdfInput.click();});
  dropZone.addEventListener('click',e=>{if(!e.target.closest('button'))pdfInput.click();});
  dropZone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pdfInput.click();}});
  pdfInput.addEventListener('change',()=>setFile(pdfInput.files?.[0]));
  ['dragenter','dragover'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.add('dragging');}));
  ['dragleave','drop'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.remove('dragging');}));
  dropZone.addEventListener('drop',e=>setFile(e.dataTransfer?.files?.[0]));

  function pageToLines(items){
    const rows=[];
    const serieHeader=items.find(item=>String(item.str||'').trim().toUpperCase()==='SERIE');
    const umedHeader=items.find(item=>String(item.str||'').trim().toUpperCase()==='UMED');
    const serieX=Number(serieHeader?.transform?.[4]);
    const serieY=Number(serieHeader?.transform?.[5]);
    const umedX=Number(umedHeader?.transform?.[4]);
    const hasSerieColumn=Number.isFinite(serieX)&&Number.isFinite(umedX)&&umedX>serieX;

    for(const item of items){
      let text=String(item.str||'').trim();
      if(!text) continue;
      const x=item.transform?.[4]??0;
      const y=item.transform?.[5]??0;

      if(hasSerieColumn && Number.isFinite(serieY) && y<serieY-2 && x>=serieX-4 && x<umedX-6){
        const joinedUnit=text.match(/^(.*?)(Unidad|Unidades|Unid\.?|Und|Pieza|Piezas)$/i);
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

  async function extractTextFromPdf(file){
    const data=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data}).promise;
    const pages=[];
    for(let n=1;n<=pdf.numPages;n+=1){
      const page=await pdf.getPage(n);
      const content=await page.getTextContent();
      pages.push(pageToLines(content.items));
    }
    return pages.join('\n');
  }

  function extractMetadata(text){
    const match=text.match(/RHAC1\s*\/\s*(SAL|INT)\s*\/\s*\d+/i);
    const documento=match?.[0]?.replace(/\s/g,'')||'';
    const subtipo=match?.[1]?.toUpperCase()||'';

    const envio=text.match(/Fecha\s+env[ií]o:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i)?.[1]||'';
    const interna=text.match(/\bFecha\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i)?.[1]||'';
    return {documento,subtipo,fecha:envio||interna};
  }

  function findQuantity(segment){
    const patterns=[
      {re:/(Unidad|Unidades|Und|UND|Pieza|Piezas)\s*(\d+(?:[.,]\d+)?)\s+([\d.,]+)/i,quantityGroup:2},
      {re:/(\d+(?:[.,]\d+)?)\s+(Unidad|Unidades|Und|UND|Pieza|Piezas)\s+([\d.,]+)/i,quantityGroup:1}
    ];
    for(const pattern of patterns){
      const match=pattern.re.exec(segment);
      if(!match) continue;
      const cantidad=Number(match[pattern.quantityGroup].replace(',','.'));
      if(Number.isFinite(cantidad)) return {cantidad,index:match.index,end:match.index+match[0].length};
    }
    return null;
  }

  function serialCandidates(prefix,quantity){
    const expected=Math.max(0,Math.round(quantity));
    if(!expected) return [];

    const pieces=[...prefix.matchAll(/\[\[SERIE:([^\]]+)\]\]/gi)]
      .flatMap(match=>String(match[1]||'').split(/[\s,;]+/))
      .map(token=>token.replace(/^[,;:]+|[,;:]+$/g,''))
      .filter(Boolean);

    const rebuilt=[];
    for(const piece of pieces){
      if(rebuilt.length && /-$/.test(rebuilt[rebuilt.length-1]) && /^[A-Z0-9]{2,30}$/i.test(piece)){
        rebuilt[rebuilt.length-1]+=piece;
      }else{
        rebuilt.push(piece);
      }
    }

    const positioned=rebuilt.filter(token=>{
      const compact=token.replace(/[^A-Z0-9]/gi,'');
      return compact.length>=5;
    });

    if(positioned.length>=expected) return positioned.slice(0,expected);

    // Respaldo para PDFs antiguos que no conserven bien la posición de columnas.
    const plain=prefix.replace(/\[\[SERIE:([^\]]+)\]\]/gi,' $1 ');
    const raw=plain.match(/\b[A-Z0-9][A-Z0-9-]{7,32}\b/gi)||[];
    const fallback=raw.filter(token=>{
      const compact=token.replaceAll('-','');
      const digits=(compact.match(/\d/g)||[]).length;
      const letters=(compact.match(/[A-Z]/gi)||[]).length;
      if(digits>=5) return true;
      return compact.length>=10 && digits>=2 && letters>=4;
    });

    const combined=[...positioned];
    fallback.forEach(token=>{if(!combined.includes(token)) combined.push(token);});
    return combined.slice(-expected);
  }

  function cleanDescription(prefix,serials){
    let value=prefix.replace(/\[\[SERIE:[^\]]+\]\]/gi,' ');
    serials.forEach(serial=>{value=value.replaceAll(serial,' ');});
    return value.replace(/\s+/g,' ').replace(/[,;]+\s*$/g,'').trim();
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
      const quantity=findQuantity(segment);
      if(!quantity) return;

      const config=catalogMap.get(normCode(header.codigo_sap));
      const topology=normTopology(config?.topologia);
      const isSerial=topology.includes('CON PERFIL DE SERIE') && !topology.includes('SIN PERFIL DE SERIE');
      const prefix=segment.slice(0,quantity.index).trim();
      const serials=isSerial?serialCandidates(prefix,quantity.cantidad):[];

      items.push({
        dominio:header.dominio,
        codigo_sap:normCode(header.codigo_sap),
        descripcion:cleanDescription(prefix,serials),
        cantidad:quantity.cantidad,
        topologia:config?.topologia||'NO CONFIGURADO',
        serials
      });
    });
    return items;
  }

  function classify(items){
    const serializados=[];
    const noSerialMap=new Map();
    const revisar=[];
    const warnings=[];

    items.forEach(item=>{
      const topology=normTopology(item.topologia);
      if(topology.includes('SIN PERFIL DE SERIE')){
        const key=item.codigo_sap+'|'+item.dominio;
        const current=noSerialMap.get(key)||{codigo_sap:item.codigo_sap,dominio:item.dominio,cantidad:0};
        current.cantidad+=item.cantidad;
        noSerialMap.set(key,current);
        return;
      }

      if(topology.includes('CON PERFIL DE SERIE')){
        item.serials.forEach(serial=>serializados.push({serial,codigo_sap:item.codigo_sap,dominio:item.dominio}));
        if(item.serials.length!==Math.round(item.cantidad)){
          warnings.push(item.codigo_sap+': se esperaban '+Math.round(item.cantidad)+' seriales y se detectaron '+item.serials.length+'.');
        }
        return;
      }

      revisar.push(item);
    });

    return {serializados,noSerializados:[...noSerialMap.values()],revisar,warnings};
  }

  function updateDestinationHint(){
    const value=destinationSelect.value;
    if(value==='DESMONTE'){
      destinationHint.textContent='El material pasará a DESMONTE · Dañado · Garantía y quedará disponible para Prealerta.';
      destinationHint.className='desmonte';
    }else if(value==='TRASLADO'){
      destinationHint.textContent='El material saldrá de LIBRE y quedará trazado como Trasladado.';
      destinationHint.className='traslado';
    }else{
      destinationHint.textContent='Selecciona un destino para completar la validación.';
      destinationHint.className='';
    }
  }

  async function revalidateCurrentSalida(){
    if(!currentPayload || !currentMetadata || !currentClassification) return;
    currentPayload.destino_operativo=destinationSelect.value;
    registered=false;
    processMessage.textContent='Actualizando validación según el destino seleccionado…';
    processMessage.className='process-message';

    const {data,error}=await supabase.rpc('validar_salida',{p_payload:currentPayload});
    if(error) throw error;

    currentValidation=data||{};
    renderValidation(currentMetadata,currentClassification,currentValidation);
    processMessage.textContent='Destino actualizado. Revisa la validación antes de registrar.';
    processMessage.className='process-message success';
  }

  function renderValidation(metadata,classification,validation){
    currentValidation=validation;
    document.getElementById('metaDocumento').textContent=metadata.documento||'No detectado';
    document.getElementById('metaSubtipo').textContent=metadata.subtipo||'No detectado';
    document.getElementById('metaFecha').textContent=metadata.fecha||'No detectada';

    const serialRows=validation?.seriales||[];
    const quantityRows=validation?.no_serializados||[];
    const parserErrors=[
      ...classification.warnings,
      ...classification.revisar.map(item=>'Código SAP '+item.codigo_sap+': no está configurado en la maestra.'),
      ...(!metadata.fecha?['No se detectó la fecha del documento.']:[])
    ];
    const globalErrors=[...(validation?.errores_globales||[]),...parserErrors];

    document.getElementById('countSerializados').textContent=serialRows.length;
    document.getElementById('countNoSerializados').textContent=quantityRows.length;
    document.getElementById('countErrores').textContent=(validation?.resumen?.errores||0)+parserErrors.length;

    document.getElementById('serialBody').innerHTML=serialRows.length
      ? serialRows.map(row=>'<tr>'+
          '<td><strong>'+esc(row.serial||'—')+'</strong></td>'+
          '<td>'+esc(row.codigo_sap||'—')+'</td>'+
          '<td>'+esc(row.dominio||'—')+'</td>'+
          '<td><span class="result-pill '+(row.resultado==='LISTO'?'ready':'error')+'">'+esc(row.resultado)+'</span></td>'+
          '<td>'+esc(row.detalle||'')+'</td>'+
        '</tr>').join('')
      : '<tr class="empty-row"><td colspan="5">Sin registros</td></tr>';

    document.getElementById('noSerialBody').innerHTML=quantityRows.length
      ? quantityRows.map(row=>'<tr>'+
          '<td><strong>'+esc(row.codigo_sap||'—')+'</strong></td>'+
          '<td>'+esc(row.dominio||'—')+'</td>'+
          '<td>'+esc(row.cantidad??0)+'</td>'+
          '<td>'+esc(row.disponible??0)+'</td>'+
          '<td><span class="result-pill '+(row.resultado==='LISTO'?'ready':'error')+'">'+esc(row.resultado)+'</span></td>'+
          '<td>'+esc(row.detalle||'')+'</td>'+
        '</tr>').join('')
      : '<tr class="empty-row"><td colspan="6">Sin registros</td></tr>';

    const review=document.getElementById('reviewCard');
    document.getElementById('reviewMessages').innerHTML=globalErrors.map(msg=>'<div class="review-message"><strong>Bloqueo:</strong> '+esc(msg)+'</div>').join('');
    review.hidden=globalErrors.length===0;

    const errors=(validation?.resumen?.errores||0)+parserErrors.length;
    registerBtn.disabled=errors>0 || registered;
    const bar=document.querySelector('.dispatch-register-bar');
    const title=document.getElementById('registerTitle');
    const help=document.getElementById('registerHelp');

    bar.classList.remove('ready','error');
    const destino=currentPayload?.destino_operativo||'';
    if(registered){
      bar.classList.add('ready');
      title.textContent=destino==='DESMONTE'?'Salida a Desmonte registrada':'Salida registrada';
      help.textContent=destino==='DESMONTE'
        ? 'El material salió de LIBRE e ingresó a DESMONTE como Garantía / Dañado.'
        : 'El material fue retirado del inventario disponible y quedó trazado como Trasladado.';
    }else if(errors>0){
      bar.classList.add('error');
      title.textContent='Salida bloqueada';
      help.textContent=destino
        ? 'Corrige los errores antes de registrar.'
        : 'Selecciona el destino operativo para completar la validación.';
    }else{
      bar.classList.add('ready');
      if(destino==='DESMONTE'){
        title.textContent='Salida a Desmonte lista para registrar';
        help.textContent='El material saldrá de LIBRE e ingresará a DESMONTE como Garantía / Dañado, quedando disponible para Prealerta.';
      }else{
        title.textContent='Salida lista para registrar';
        help.textContent='Al registrar, los serializados pasarán a Trasladado y los no serializados descontarán saldo LIBRE.';
      }
    }

    resultsSection.hidden=false;
    resultsSection.scrollIntoView({behavior:'smooth',block:'start'});
  }

  processPdfBtn.addEventListener('click',async()=>{
    if(!currentFile) return;
    processPdfBtn.disabled=true;
    processPdfBtn.textContent='Procesando…';
    processMessage.textContent='Leyendo PDF y validando contra el inventario…';
    processMessage.className='process-message';

    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){window.location.replace('index.html');return;}

      const text=await extractTextFromPdf(currentFile);
      const metadata=extractMetadata(text);
      const items=extractItems(text);
      const classification=classify(items);

      currentMetadata=metadata;
      currentClassification=classification;
      currentPayload={
        documento:metadata.documento,
        subtipo:metadata.subtipo,
        fecha:metadata.fecha,
        archivo:currentFile.name,
        destino_operativo:destinationSelect.value,
        seriales:classification.serializados,
        no_serializados:classification.noSerializados
      };

      const {data,error}=await supabase.rpc('validar_salida',{p_payload:currentPayload});
      if(error) throw error;

      registered=false;
      renderValidation(metadata,classification,data||{});
      processMessage.textContent='PDF procesado. Revisa la validación antes de registrar.';
      processMessage.className='process-message success';
    }catch(error){
      console.error('Error procesando salida',error);
      resultsSection.hidden=true;
      processMessage.textContent=error.message||'No fue posible procesar el PDF.';
      processMessage.className='process-message error';
    }finally{
      processPdfBtn.disabled=false;
      processPdfBtn.innerHTML='Procesar PDF <span>→</span>';
      updateProcessButton();
    }
  });

  registerBtn.addEventListener('click',async()=>{
    if(!currentPayload || registerBtn.disabled) return;
    registerBtn.disabled=true;
    const original=registerBtn.innerHTML;
    registerBtn.textContent='Registrando…';

    try{
      const {data,error}=await supabase.rpc('registrar_salida',{p_payload:currentPayload});
      if(error) throw error;
      registered=true;
      renderValidation(currentMetadata||{
        documento:currentPayload.documento,
        subtipo:currentPayload.subtipo,
        fecha:currentPayload.fecha
      },currentClassification||{warnings:[],revisar:[]},currentValidation||{});
      processMessage.textContent=(data?.destino_operativo==='DESMONTE'?'Salida a Desmonte ':'Salida ')+(data?.documento||currentPayload.documento)+' registrada · '+(data?.movimientos||0)+' movimiento(s).';
      processMessage.className='process-message success';
    }catch(error){
      console.error('Error registrando salida',error);
      processMessage.textContent=error.message||'No fue posible registrar la salida.';
      processMessage.className='process-message error';
      registerBtn.disabled=false;
    }finally{
      registerBtn.innerHTML=original;
    }
  });

  destinationSelect.addEventListener('change',async()=>{
    updateDestinationHint();
    if(!currentPayload) return;
    try{
      destinationSelect.disabled=true;
      await revalidateCurrentSalida();
    }catch(error){
      console.error('Error actualizando destino de salida',error);
      processMessage.textContent=error.message||'No fue posible actualizar la validación del destino.';
      processMessage.className='process-message error';
    }finally{
      destinationSelect.disabled=false;
    }
  });

  clearBtn.addEventListener('click',()=>{
    currentFile=null;
    currentPayload=null;
    currentValidation=null;
    currentMetadata=null;
    currentClassification=null;
    destinationSelect.value='';
    updateDestinationHint();
    registered=false;
    pdfInput.value='';
    selectedFile.textContent='Ningún archivo seleccionado';
    resultsSection.hidden=true;
    processMessage.textContent='';
    processMessage.className='process-message';
    updateProcessButton();
    window.scrollTo({top:0,behavior:'smooth'});
  });

  updateDestinationHint();
  loadCatalog();
});