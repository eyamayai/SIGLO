document.addEventListener('DOMContentLoaded', () => {
  const VERSION='20261010-1';
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
  let dominionMap=new Map();
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
  const normDominion=value=>norm(value).toUpperCase();

  function buildDominionMap(items){
    const owners=new Map();
    (items||[]).forEach(item=>{
      const sap=normCode(item.codigo_sap);
      (Array.isArray(item.dominios)?item.dominios:[]).forEach(rawDominion=>{
        const dominio=normDominion(rawDominion);
        if(!dominio) return;
        if(!owners.has(dominio)) owners.set(dominio,new Set());
        owners.get(dominio).add(sap);
      });
    });

    return new Map([...owners.entries()].map(([dominio,set])=>{
      const codigos=[...set].filter(Boolean).sort();
      return [dominio,{
        codigo_sap:codigos.length===1?codigos[0]:null,
        codigos,
        ambiguo:codigos.length>1
      }];
    }));
  }

  function resolveDocumentSap(rawSap,rawDominion){
    const original=normCode(rawSap);
    const dominio=normDominion(rawDominion);
    const match=dominionMap.get(dominio);

    if(!match) return {codigo_sap:original,original,dominio,normalizado:false,ambiguo:false};

    if(match.ambiguo){
      if(match.codigos.includes(original)){
        return {codigo_sap:original,original,dominio,normalizado:false,ambiguo:false};
      }
      return {codigo_sap:original,original,dominio,normalizado:false,ambiguo:true,codigos:match.codigos};
    }

    const resolved=match.codigo_sap||original;
    return {
      codigo_sap:resolved,
      original,
      dominio,
      normalizado:Boolean(resolved && original!==resolved),
      ambiguo:false
    };
  }

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
      dominionMap=buildDominionMap(catalog);
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
    document.getElementById('manualSerialCard').hidden=true;
    document.getElementById('manualSerialGroups').innerHTML='';
    updateProcessButton();
  }

  selectPdfBtn.addEventListener('click',e=>{e.stopPropagation();pdfInput.click();});
  dropZone.addEventListener('click',e=>{if(!e.target.closest('button'))pdfInput.click();});
  dropZone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pdfInput.click();}});
  pdfInput.addEventListener('change',()=>setFile(pdfInput.files?.[0]));
  ['dragenter','dragover'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.add('dragging');}));
  ['dragleave','drop'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.remove('dragging');}));
  dropZone.addEventListener('drop',e=>setFile(e.dataTransfer?.files?.[0]));

  function pageToRows(items){
    const rows=[];
    for(const item of items){
      const text=String(item.str||'').trim();
      if(!text) continue;
      const x=Number(item.transform?.[4]??0);
      const y=Number(item.transform?.[5]??0);
      let row=rows.find(r=>Math.abs(r.y-y)<=2.2);
      if(!row){row={y,items:[]};rows.push(row);}
      row.items.push({x,text});
    }
    return rows
      .sort((a,b)=>b.y-a.y)
      .map(row=>{
        row.items.sort((a,b)=>a.x-b.x);
        return {...row,text:row.items.map(i=>i.text).join(' ')};
      });
  }

  function findPageLayout(rows,previous=null){
    for(const row of rows){
      const labels=row.items.map(item=>({
        x:item.x,
        label:String(item.text||'').trim().toUpperCase()
      }));
      const product=labels.find(item=>item.label==='PRODUCTO'||item.label==='MATERIAL');
      const serie=labels.find(item=>item.label==='SERIE');
      const cantidad=labels.find(item=>item.label==='CANTIDAD');
      const unidad=labels.find(item=>['UNIDAD','UMED'].includes(item.label));
      if(!product||!serie||!cantidad||!unidad) continue;

      const starts=labels
        .filter(item=>['PRODUCTO','MATERIAL','SERIE','CANTIDAD','UNIDAD','UMED','CONTROL','VALOR','VALORIZADO'].includes(item.label))
        .map(item=>item.x)
        .sort((a,b)=>a-b);

      const nextStart=x=>{
        const next=starts.find(value=>value>x+1);
        return Number.isFinite(next)?next-6:x+110;
      };

      return {
        productMin:Math.max(0,product.x-20),
        productMax:serie.x-6,
        serieMin:serie.x-6,
        serieMax:nextStart(serie.x),
        quantityMin:cantidad.x-6,
        quantityMax:nextStart(cantidad.x)
      };
    }
    return previous||{
      productMin:0,
      productMax:117,
      serieMin:117,
      serieMax:419,
      quantityMin:419,
      quantityMax:466
    };
  }

  async function extractPdfData(file){
    const data=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data}).promise;
    const pages=[];
    const textPages=[];
    let inheritedLayout=null;

    for(let n=1;n<=pdf.numPages;n+=1){
      const page=await pdf.getPage(n);
      const content=await page.getTextContent();
      const rows=pageToRows(content.items);
      const layout=findPageLayout(rows,inheritedLayout);
      inheritedLayout=layout;
      pages.push({page:n,rows,layout});
      textPages.push(rows.map(row=>row.text).join('\n'));
      try{page.cleanup();}catch(_){}
    }

    try{await pdf.destroy();}catch(_){}
    return {pages,text:textPages.join('\n')};
  }

  function extractMetadata(text){
    const match=text.match(/RHAC1\s*\/\s*(SAL|INT)\s*\/\s*\d+/i);
    const documento=match?.[0]?.replace(/\s/g,'')||'';
    const subtipo=match?.[1]?.toUpperCase()||'';

    const envio=text.match(/Fecha\s+env[ií]o:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i)?.[1]||'';
    const interna=text.match(/\bFecha\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i)?.[1]||'';
    return {documento,subtipo,fecha:envio||interna};
  }

  function cellText(row,min,max){
    return row.items
      .filter(item=>item.x>=min&&item.x<max)
      .map(item=>item.text)
      .join(' ')
      .trim();
  }

  function cleanPdfText(value){
    return String(value||'')
      .replace(/[\u0000-\u001F\u007F-\u009F\uFFFE\uFFFF]/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }

  function parseQuantityCell(value){
    const match=String(value||'').match(/-?\d+(?:[.,]\d+)?/);
    if(!match) return null;
    const number=Number(match[0].replace(',','.'));
    return Number.isFinite(number)?number:null;
  }

  function serialTokens(value){
    const stopwords=new Set(['SERIE','PRODUCTO','MATERIAL','CANTIDAD','UNIDAD','UNIDADES','UNID','UND','PIEZA','PIEZAS','VALOR','VALORIZADO']);
    const pieces=String(value||'')
      .split(/[\s,;]+/)
      .map(token=>token.replace(/^[,;:]+|[,;:]+$/g,''))
      .filter(Boolean);

    const rebuilt=[];
    for(const piece of pieces){
      if(rebuilt.length&&/-$/.test(rebuilt[rebuilt.length-1])&&/^[A-Z0-9]{2,30}$/i.test(piece)){
        rebuilt[rebuilt.length-1]+=piece;
      }else{
        rebuilt.push(piece);
      }
    }

    return rebuilt.filter(token=>{
      const upperToken=token.toUpperCase();
      const compact=token.replace(/[^A-Z0-9]/gi,'');
      return compact.length>=5
        && /^[A-Z0-9-]+$/i.test(token)
        && !stopwords.has(upperToken);
    }).map(token=>token.toUpperCase());
  }

  function extractItemsFromPages(pages){
    const items=[];
    let current=null;
    let pendingHeader=false;

    const finalizeCurrent=()=>{
      if(!current) return;
      const unique=[];
      const seen=new Set();
      current.serials.forEach(serial=>{
        if(!seen.has(serial)){
          seen.add(serial);
          unique.push(serial);
        }
      });
      current.serials=unique;
      current.descripcion=current.descriptionParts.join(' ').replace(/\s+/g,' ').trim();
      delete current.descriptionParts;
      delete current.headerBuffer;
      delete current.headerResolved;
      items.push(current);
      current=null;
      pendingHeader=false;
    };

    const resolveHeader=()=>{
      if(!current||current.headerResolved) return;
      const match=current.headerBuffer.match(/\[DOM[-\s\uFFFE]*([0-9]+)\s*\/\s*([0-9]+)\s*\]/i);
      if(!match) return;
      current.dominio='DOM-'+match[1];
      current.codigo_sap=normCode(match[2]);
      const remainder=current.headerBuffer.slice((match.index||0)+match[0].length).trim();
      if(remainder) current.descriptionParts.push(remainder);
      current.headerResolved=true;
      pendingHeader=false;
    };

    for(const page of pages){
      const layout=page.layout;
      let stopPage=false;

      for(const row of page.rows){
        if(stopPage) break;
        const full=cleanPdfText(row.text);
        const upperFull=full.toUpperCase();

        if(/^EN CASO DE DAÑO/i.test(full)){
          finalizeCurrent();
          stopPage=true;
          break;
        }

        const isHeaderRow=
          upperFull.includes('SERIE')
          && upperFull.includes('CANTIDAD')
          && (upperFull.includes('PRODUCTO')||upperFull.includes('MATERIAL'));
        if(isHeaderRow) continue;

        if(
          /DOMINION COLOMBIA SAS/i.test(full)
          || /^CALLE 94A/i.test(full)
          || /^BOGOT[ÁA]$/i.test(full)
          || /^COLOMBIA$/i.test(full)
          || /NOREPLY@/i.test(full)
          || /^P[ÁA]GINA:/i.test(full)
        ) continue;

        const product=cleanPdfText(cellText(row,layout.productMin,layout.productMax));
        const series=cleanPdfText(cellText(row,layout.serieMin,layout.serieMax));
        const quantityText=cleanPdfText(cellText(row,layout.quantityMin,layout.quantityMax));

        const startsHeader=/\[DOM(?:-|\s|\uFFFE|\uFFFF)/i.test(product);
        if(startsHeader){
          finalizeCurrent();
          current={
            dominio:'',
            codigo_sap:'',
            descripcion:'',
            cantidad:null,
            topologia:'NO CONFIGURADO',
            serials:[],
            descriptionParts:[],
            headerBuffer:product,
            headerResolved:false
          };
          pendingHeader=true;
          resolveHeader();
        }else if(current&&pendingHeader&&product){
          current.headerBuffer+=' '+product;
          resolveHeader();
        }else if(current&&product){
          current.descriptionParts.push(product);
        }

        if(!current) continue;

        if(current.cantidad===null&&quantityText){
          const cantidad=parseQuantityCell(quantityText);
          if(cantidad!==null) current.cantidad=cantidad;
        }

        if(series){
          current.serials.push(...serialTokens(series));
        }
      }
    }

    finalizeCurrent();

    return items
      .filter(item=>item.codigo_sap || item.dominio)
      .map(item=>{
        const originalSap=normCode(item.codigo_sap);
        const resolution=resolveDocumentSap(originalSap,item.dominio);
        const codigoSap=resolution.codigo_sap;
        const config=resolution.ambiguo?null:catalogMap.get(codigoSap);
        return {
          ...item,
          codigo_sap:codigoSap,
          codigo_sap_pdf:originalSap,
          sap_normalizado:resolution.normalizado,
          sap_ambiguo:resolution.ambiguo,
          sap_codigos_posibles:resolution.codigos||[],
          cantidad:item.cantidad??item.serials.length,
          topologia:config?.topologia||'NO CONFIGURADO'
        };
      });
  }

  function classify(items){
    const serializados=[];
    const noSerialMap=new Map();
    const revisar=[];
    const warnings=[];
    const notices=[];
    const missingSerialGroups=[];

    items.forEach(item=>{
      if(item.sap_normalizado){
        notices.push('SAP normalizado por Dominion: '+item.codigo_sap_pdf+' → '+item.codigo_sap+' · '+item.dominio+'.');
      }
      if(item.sap_ambiguo){
        warnings.push('Dominion '+item.dominio+': está asociado a '+(item.sap_codigos_posibles||[]).join(' / ')+' y el SAP del documento '+item.codigo_sap_pdf+' no permite resolverlo de forma única.');
        return;
      }

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
        const expected=Math.max(0,Math.round(Number(item.cantidad)||0));
        const detected=item.serials.length;

        if(detected<expected){
          missingSerialGroups.push({
            key:item.codigo_sap+'|'+item.dominio,
            codigo_sap:item.codigo_sap,
            dominio:item.dominio,
            expected,
            detected,
            missing:expected-detected,
            manualSerials:Array(expected-detected).fill('')
          });
        }else if(detected>expected){
          warnings.push(item.codigo_sap+': se esperaban '+expected+' seriales y se detectaron '+detected+'.');
        }
        return;
      }

      revisar.push(item);
    });

    return {
      serializados,
      noSerializados:[...noSerialMap.values()],
      revisar,
      warnings,
      notices:[...new Set(notices)],
      missingSerialGroups,
      manualDirty:false
    };
  }

  const normalizeManualSerial=value=>String(value??'')
    .trim()
    .toUpperCase()
    .replace(/\s+/g,'')
    .replace(/^[,;:]+|[,;:]+$/g,'');

  function manualSerialEntries(){
    if(!currentClassification) return [];
    const out=[];
    (currentClassification.missingSerialGroups||[]).forEach(group=>{
      (group.manualSerials||[]).forEach((value,index)=>{
        const serial=normalizeManualSerial(value);
        if(serial){
          out.push({
            serial,
            codigo_sap:group.codigo_sap,
            dominio:group.dominio,
            manual:true,
            manual_key:group.key,
            manual_slot:index
          });
        }
      });
    });
    return out;
  }

  function unresolvedManualGroups(){
    if(!currentClassification) return [];
    return (currentClassification.missingSerialGroups||[])
      .map(group=>({
        ...group,
        unresolved:(group.manualSerials||[]).filter(value=>!normalizeManualSerial(value)).length
      }))
      .filter(group=>group.unresolved>0);
  }

  function buildSerialPayload(){
    return [
      ...(currentClassification?.serializados||[]),
      ...manualSerialEntries().map(({serial,codigo_sap,dominio})=>({serial,codigo_sap,dominio}))
    ];
  }

  function manualValidationMap(){
    const map=new Map();
    (currentValidation?.seriales||[]).forEach(row=>{
      const serial=normalizeManualSerial(row.serial);
      if(serial) map.set(serial,row);
    });
    return map;
  }

  function renderManualSerialCompletion(){
    const card=document.getElementById('manualSerialCard');
    const container=document.getElementById('manualSerialGroups');
    const groups=currentClassification?.missingSerialGroups||[];

    if(!groups.length){
      card.hidden=true;
      container.innerHTML='';
      return;
    }

    card.hidden=false;
    const validations=manualValidationMap();

    container.innerHTML=groups.map((group,gIndex)=>{
      const inputs=(group.manualSerials||[]).map((value,index)=>{
        const serial=normalizeManualSerial(value);
        const validation=serial?validations.get(serial):null;
        const state=validation
          ? (validation.resultado==='LISTO'?'ready':'error')
          : (serial?'pending':'empty');
        const detail=validation
          ? validation.detalle
          : (serial?'Pendiente de validar contra SIGLO.':'Escribe el serial faltante.');
        return '<label class="manual-serial-slot '+state+'">'+
          '<span>Serial '+(group.detected+index+1)+' de '+group.expected+'</span>'+
          '<input type="text" autocomplete="off" spellcheck="false" '+
            'data-manual-group="'+gIndex+'" data-manual-slot="'+index+'" value="'+esc(value||'')+'" '+
            'placeholder="Escribir serial">'+
          '<small>'+esc(detail)+'</small>'+
        '</label>';
      }).join('');

      const filled=(group.manualSerials||[]).filter(value=>normalizeManualSerial(value)).length;
      return '<div class="manual-serial-group">'+
        '<div class="manual-serial-group-head">'+
          '<div><strong>SAP '+esc(group.codigo_sap)+'</strong><span>'+esc(group.dominio)+'</span></div>'+
          '<span class="manual-serial-count">Detectados '+group.detected+' de '+group.expected+' · Completados '+filled+' de '+group.missing+'</span>'+
        '</div>'+
        '<div class="manual-serial-inputs">'+inputs+'</div>'+
      '</div>';
    }).join('');

    container.querySelectorAll('[data-manual-group]').forEach(input=>{
      input.addEventListener('input',()=>{
        const g=Number(input.dataset.manualGroup);
        const s=Number(input.dataset.manualSlot);
        const group=currentClassification.missingSerialGroups[g];
        if(!group) return;
        group.manualSerials[s]=input.value;
        currentClassification.manualDirty=true;
        if(currentPayload) currentPayload.seriales=buildSerialPayload();
        registerBtn.disabled=true;
        const slot=input.closest('.manual-serial-slot');
        slot?.classList.remove('ready','error');
        slot?.classList.add(normalizeManualSerial(input.value)?'pending':'empty');
        const small=slot?.querySelector('small');
        if(small) small.textContent=normalizeManualSerial(input.value)?'Pendiente de validar contra SIGLO.':'Escribe el serial faltante.';
      });

    });
  }

  async function validateManualSerials(silent=false){
    if(!currentPayload || !currentMetadata || !currentClassification) return;

    currentPayload.seriales=buildSerialPayload();
    registered=false;

    if(!silent){
      processMessage.textContent='Validando seriales ingresados manualmente…';
      processMessage.className='process-message';
    }

    const {data,error}=await supabase.rpc('validar_salida',{p_payload:currentPayload});
    if(error) throw error;

    currentClassification.manualDirty=false;
    currentValidation=data||{};
    renderValidation(currentMetadata,currentClassification,currentValidation);

    if(!silent){
      const pending=unresolvedManualGroups().reduce((sum,group)=>sum+group.unresolved,0);
      processMessage.textContent=pending
        ? 'Seriales validados. Aún faltan '+pending+' por completar.'
        : 'Seriales manuales validados. Revisa el resultado antes de registrar.';
      processMessage.className='process-message success';
    }
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
    currentPayload.seriales=buildSerialPayload();
    registered=false;
    processMessage.textContent='Actualizando validación según el destino seleccionado…';
    processMessage.className='process-message';

    const {data,error}=await supabase.rpc('validar_salida',{p_payload:currentPayload});
    if(error) throw error;

    currentValidation=data||{};
    currentClassification.manualDirty=false;
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
    const unresolvedManualErrors=unresolvedManualGroups().map(group=>
      group.codigo_sap+': faltan '+group.unresolved+' serial'+(group.unresolved===1?'':'es')+' por completar manualmente.'
    );
    const parserErrors=[
      ...classification.warnings,
      ...unresolvedManualErrors,
      ...classification.revisar.map(item=>'Código SAP '+item.codigo_sap+': no está configurado en la maestra.'),
      ...(!metadata.fecha?['No se detectó la fecha del documento.']:[])
    ];
    const hasManualPending=(classification.missingSerialGroups||[]).length>0;
    const backendGlobalErrors=(validation?.errores_globales||[]).filter(msg=>
      !(hasManualPending && msg==='No se detectaron materiales para registrar.')
    );
    const globalErrors=[...backendGlobalErrors,...parserErrors];
    const parserNotices=classification.notices||[];

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

    renderManualSerialCompletion();

    const review=document.getElementById('reviewCard');
    document.getElementById('reviewMessages').innerHTML=
      globalErrors.map(msg=>'<div class="review-message"><strong>Bloqueo:</strong> '+esc(msg)+'</div>').join('')+
      parserNotices.map(msg=>'<div class="review-message info"><strong>Aviso:</strong> '+esc(msg)+'</div>').join('');
    review.hidden=globalErrors.length===0 && parserNotices.length===0;

    const suppressedNoMaterial=(validation?.errores_globales||[]).filter(msg=>
      hasManualPending && msg==='No se detectaron materiales para registrar.'
    ).length;
    const errors=Math.max(0,(validation?.resumen?.errores||0)-suppressedNoMaterial)+parserErrors.length;
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

      const parsedPdf=await extractPdfData(currentFile);
      const metadata=extractMetadata(parsedPdf.text);
      const items=extractItemsFromPages(parsedPdf.pages);
      const classification=classify(items);

      currentMetadata=metadata;
      currentClassification=classification;
      currentPayload={
        documento:metadata.documento,
        subtipo:metadata.subtipo,
        fecha:metadata.fecha,
        archivo:currentFile.name,
        destino_operativo:destinationSelect.value,
        seriales:buildSerialPayload(),
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
    if(currentClassification?.manualDirty){
      processMessage.textContent='Valida los seriales manuales antes de registrar la salida.';
      processMessage.className='process-message error';
      registerBtn.disabled=true;
      return;
    }
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

  document.getElementById('manualValidateBtn').addEventListener('click',async()=>{
    try{
      const button=document.getElementById('manualValidateBtn');
      button.disabled=true;
      await validateManualSerials(false);
    }catch(error){
      console.error('Error validando seriales manuales',error);
      processMessage.textContent=error.message||'No fue posible validar los seriales manuales.';
      processMessage.className='process-message error';
    }finally{
      document.getElementById('manualValidateBtn').disabled=false;
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