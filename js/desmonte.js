document.addEventListener('DOMContentLoaded', async () => {
  const supabase=window.sigloSupabase;
  if (window.pdfjsLib?.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const pdfTab=document.getElementById('pdfTab'),excelTab=document.getElementById('excelTab');
  const pdfPanel=document.getElementById('pdfPanel'),excelPanel=document.getElementById('excelPanel');
  const pdfInput=document.getElementById('pdfInput'),excelInput=document.getElementById('excelInput');
  const processPdfBtn=document.getElementById('processPdfBtn'),processExcelBtn=document.getElementById('processExcelBtn');
  const resultsSection=document.getElementById('resultsSection'),processMessage=document.getElementById('processMessage');
  const registerBtn=document.getElementById('registerBtn');
  let source='PDF',currentFile=null,currentPayload=null,currentValidation=null,registered=false;

  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
  const norm=v=>String(v??'').trim();
  const upper=v=>norm(v).toUpperCase();
  const parseNum=v=>{
    let s=String(v??'').replace(/\s+/g,'').trim();
    if(!s)return NaN;
    if(s.includes(',')&&s.includes('.')){
      if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replaceAll('.','').replace(',','.');
      else s=s.replaceAll(',','');
    }else if(s.includes(','))s=s.replace(',','.');
    return Number(s);
  };
  const todayStamp=()=>{
    const d=new Date();
    const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
  };

  function setSource(next){
    source=next;
    pdfTab.classList.toggle('active',next==='PDF');
    excelTab.classList.toggle('active',next==='EXCEL');
    pdfPanel.hidden=next!=='PDF';
    excelPanel.hidden=next!=='EXCEL';
    resetResults();
  }
  pdfTab.addEventListener('click',()=>setSource('PDF'));
  excelTab.addEventListener('click',()=>setSource('EXCEL'));

  function resetResults(){
    currentPayload=null;currentValidation=null;registered=false;
    resultsSection.hidden=true;
    processMessage.textContent='';processMessage.className='process-message';
  }

  function bindDrop(zone,input,setter){
    zone.addEventListener('click',e=>{if(!e.target.closest('button'))input.click();});
    zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
    ['dragenter','dragover'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.add('dragging');}));
    ['dragleave','drop'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.remove('dragging');}));
    zone.addEventListener('drop',e=>setter(e.dataTransfer?.files?.[0]));
  }

  function setPdf(file){
    if(!file)return;
    if(!/\.pdf$/i.test(file.name)){processMessage.textContent='Selecciona un PDF válido.';processMessage.className='process-message error';return;}
    currentFile=file;document.getElementById('pdfFileName').textContent=file.name;processPdfBtn.disabled=false;
    document.getElementById('pdfStatus').textContent='PDF listo para procesar';document.getElementById('pdfStatus').className='catalog-status ready';resetResults();
  }
  function setExcel(file){
    if(!file)return;
    if(!/\.(xlsx|xls)$/i.test(file.name)){processMessage.textContent='Selecciona un Excel válido.';processMessage.className='process-message error';return;}
    currentFile=file;document.getElementById('excelFileName').textContent=file.name;processExcelBtn.disabled=false;
    document.getElementById('excelStatus').textContent='Excel listo para procesar';document.getElementById('excelStatus').className='catalog-status ready';resetResults();
  }

  document.getElementById('selectPdfBtn').addEventListener('click',e=>{e.stopPropagation();pdfInput.click();});
  document.getElementById('selectExcelBtn').addEventListener('click',e=>{e.stopPropagation();excelInput.click();});
  pdfInput.addEventListener('change',()=>setPdf(pdfInput.files?.[0]));
  excelInput.addEventListener('change',()=>setExcel(excelInput.files?.[0]));
  bindDrop(document.getElementById('pdfDropZone'),pdfInput,setPdf);
  bindDrop(document.getElementById('excelDropZone'),excelInput,setExcel);

  document.getElementById('downloadExcelTemplateBtn').addEventListener('click',()=>{
    if(!window.XLSX)return;
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([['FECHA','CEDULA','SERIE','CODIGO']]);
    ws['!cols']=[{wch:18},{wch:18},{wch:24},{wch:14}];
    XLSX.utils.book_append_sheet(wb,ws,'DESMONTE');
    const ins=XLSX.utils.aoa_to_sheet([
      ['SIGLO · Plantilla Desmonte'],
      ['No cambies los encabezados FECHA, CEDULA, SERIE y CODIGO.'],
      ['El Excel admite únicamente equipos serializados.'],
      ['Nombre del técnico, descripción, topología y Dominion NOVALORADO se consultan en las Maestras.'],
      ['Formato sugerido de FECHA: DD-MM-YYYY HH:MM:SS.']
    ]);
    ins['!cols']=[{wch:95}];
    XLSX.utils.book_append_sheet(wb,ins,'INSTRUCCIONES');
    XLSX.writeFile(wb,'SIGLO_Plantilla_Desmonte.xlsx');
  });

  function pageToLines(items){
    const rows=[];
    for(const item of items){
      const text=String(item.str||'').trim();if(!text)continue;
      const x=item.transform?.[4]??0,y=item.transform?.[5]??0;
      let row=rows.find(r=>Math.abs(r.y-y)<=2.2);
      if(!row){row={y,items:[]};rows.push(row);}
      row.items.push({x,text});
    }
    return rows.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ')).join('\n');
  }
  async function extractPdfText(file){
    const data=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data}).promise;
    const pages=[];
    for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const c=await p.getTextContent();pages.push(pageToLines(c.items));}
    return pages.join('\n');
  }
  function pdfMeta(text){
    const documento=(text.match(/RHAC1\s*\/\s*ING\s*\/\s*[A-Z0-9-]+/i)?.[0]||'').replace(/\s/g,'');
    const trabajador=(text.match(/(?:^|\n)\s*Trabajador\s+([^\n]+)/i)?.[1]||'').replace(/\s+C\.\s*Bandeja.*$/i,'').replace(/\s+/g,' ').trim();
    const fecha=text.match(/Fecha\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i)?.[1]||'';
    const almacen=text.match(/Almac[eé]n\s+([^\n]+?)(?=\s+Fecha|$)/i)?.[1]?.trim()||'';
    const responsable=text.match(/Resp\.Almac[eé]n\s+([^\n]+)/i)?.[1]?.trim()||'';
    return {documento,trabajador,fecha,almacen,responsable};
  }
  function serialCandidates(prefix,quantity){
    const raw=prefix.match(/\b[A-Z0-9][A-Z0-9-]{4,30}\b/gi)||[];
    const candidates=raw.filter(t=>{const c=t.replace(/[^A-Z0-9]/gi,'');return c.length>=5&&/\d/.test(c);});
    const expected=Math.max(0,Math.round(quantity||0));
    return expected?candidates.slice(-expected):candidates.slice(-1);
  }
  function findQuantity(segment){
    const quantityFirst=/(\d+(?:[.,]\d+)?)\s+(?:Unidad|Unidades|Pieza|Piezas)\s+([\d,.]+(?:\.\d{2}|,\d{2}))/gi;
    let m=quantityFirst.exec(segment);
    if(m){
      const q=parseNum(m[1]);
      if(Number.isFinite(q)) return {cantidad:q,index:m.index};
    }

    const unitFirst=/(?:Unidad|Unidades|Pieza|Piezas)\s+(\d+(?:[.,]\d+)?)\s+([\d,.]+(?:\.\d{2}|,\d{2}))/gi;
    m=unitFirst.exec(segment);
    if(m){
      const q=parseNum(m[1]);
      if(Number.isFinite(q)) return {cantidad:q,index:m.index};
    }

    const genericUnitFirst=/\b[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+(\d+(?:[.,]\d+)?)\s+([\d,.]+(?:\.\d{2}|,\d{2}))/g;
    m=genericUnitFirst.exec(segment);
    if(m){
      const q=parseNum(m[1]);
      if(Number.isFinite(q)) return {cantidad:q,index:m.index};
    }
    return null;
  }
  function extractPdfItems(text){
    const headers=[...text.matchAll(/\[([^/\]]+)\/([^\]]+)\]/g)].map(m=>({index:m.index,end:m.index+m[0].length,dominio:m[1].trim(),sap:m[2].trim()}));
    const seriales=[],no_serializados=[],raw=[];
    headers.forEach((h,i)=>{
      const end=i+1<headers.length?headers[i+1].index:text.length;
      const seg=text.slice(h.end,end),q=findQuantity(seg);if(!q)return;
      const prefix=seg.slice(0,q.index).trim();
      const candidates=serialCandidates(prefix,q.cantidad);
      raw.push({codigo_sap:h.sap,dominio_documento:h.dominio,cantidad:q.cantidad,serials:candidates});
    });
    return {raw,seriales,no_serializados};
  }

  async function loadMasterMap(){
    const {data,error}=await supabase.rpc('consultar_maestra_codigos');
    if(error)throw error;
    const list=Array.isArray(data)?data:[];
    const bySap=new Map();
    list.forEach(r=>{const a=bySap.get(String(r.codigo_sap))||[];a.push(r);bySap.set(String(r.codigo_sap),a);});
    return bySap;
  }

  async function makePdfPayload(file){
    const [text,master]=await Promise.all([extractPdfText(file),loadMasterMap()]);
    const meta=pdfMeta(text);
    const parsed=extractPdfItems(text);
    if(!parsed.raw.length)throw new Error('No se detectaron materiales en el PDF.');
    const seriales=[],no_serializados=[];
    for(const item of parsed.raw){
      const options=master.get(String(item.codigo_sap))||[];
      const nv=options.find(x=>upper(x.lote)==='NOVALORADO');
      const top=upper(nv?.topologia||options[0]?.topologia||'');
      if(top==='SIN PERFIL DE SERIE'){
        no_serializados.push({codigo_sap:item.codigo_sap,dominio_documento:item.dominio_documento,cantidad:item.cantidad,fecha:meta.fecha,segmento_manual:''});
      }else{
        const expected=Math.round(item.cantidad||0);
        const detected=item.serials.slice(-expected);
        detected.forEach(serial=>seriales.push({serial,codigo_sap:item.codigo_sap,dominio_documento:item.dominio_documento,fecha:meta.fecha,segmento_manual:''}));
        for(let miss=detected.length;miss<expected;miss++){
          seriales.push({serial:'',codigo_sap:item.codigo_sap,dominio_documento:item.dominio_documento,fecha:meta.fecha,segmento_manual:''});
        }
      }
    }
    return {fuente:'PDF',documento:meta.documento,fecha_documento:meta.fecha,almacen_pdf:meta.almacen,responsable_almacen:meta.responsable,tecnico_pdf:meta.trabajador,archivo:file.name,seriales,no_serializados,_meta:meta};
  }

  function excelRows(wb){
    const first=wb.SheetNames.find(n=>upper(n)!=='INSTRUCCIONES')||wb.SheetNames[0];
    if(!first)throw new Error('El Excel no contiene hojas.');
    const raw=XLSX.utils.sheet_to_json(wb.Sheets[first],{defval:'',raw:false});
    const nh=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
    if(!raw.length)return [];
    const cols=Object.keys(raw[0]).reduce((o,k)=>(o[nh(k)]=k,o),{});
    for(const req of ['FECHA','CEDULA','SERIE','CODIGO'])if(!cols[req])throw new Error('Falta la columna '+req+'.');
    return raw.map(r=>({fecha:norm(r[cols.FECHA]),cedula:norm(r[cols.CEDULA]),serial:upper(r[cols.SERIE]),codigo_sap:norm(r[cols.CODIGO]),segmento_manual:''})).filter(r=>r.fecha||r.cedula||r.serial||r.codigo_sap);
  }
  async function makeExcelPayload(file){
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
    const rows=excelRows(wb);
    if(!rows.length)throw new Error('El Excel no contiene registros.');
    return {fuente:'EXCEL',documento:'DESMONTE/XLS/'+todayStamp(),fecha_documento:rows[0].fecha||'',archivo:file.name,seriales:rows,no_serializados:[],_meta:{fecha:rows[0].fecha||'',trabajador:'',almacen:'',responsable:''}};
  }

  async function validatePayload(payload){
    const {data,error}=await supabase.rpc('validar_desmonte',{p_payload:payload});
    if(error)throw error;
    currentPayload=payload;currentValidation=data;renderValidation();
  }

  function segmentSelect(row,index,type){
    if(row.resultado!=='REVISAR')return esc(row.segmento||'—');
    const opts=(currentValidation?.segmentos_disponibles||[]).map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
    return '<select class="segment-select" data-kind="'+type+'" data-index="'+index+'"><option value="">Seleccionar…</option>'+opts+'</select>';
  }
  function pill(result){
    const cls=result==='LISTO'?'ready':result==='REVISAR'?'review':'error';
    return '<span class="result-pill '+cls+'">'+esc(result)+'</span>';
  }
  function renderValidation(){
    const v=currentValidation||{},s=v.resumen||{};
    document.getElementById('countSerial').textContent=s.serializados||0;
    document.getElementById('countNoSerial').textContent=s.no_serializados||0;
    document.getElementById('countReview').textContent=s.revisar||0;
    document.getElementById('countErrors').textContent=s.errores||0;

    const sr=v.seriales||[];
    document.getElementById('serialBody').innerHTML=sr.length?sr.map((r,i)=>{
      const serialCell=r.serial?'<strong>'+esc(r.serial)+'</strong>':'<input class="manual-serial" data-index="'+i+'" type="text" placeholder="Ingresar serial">';
      return '<tr><td>'+serialCell+'</td><td>'+esc(r.codigo_sap)+'</td><td>'+esc(r.dominio||'—')+'</td><td>'+esc(r.descripcion||'—')+'</td><td>'+esc(r.tecnico||'—')+'</td><td>'+esc(r.cedula||'—')+'</td><td>'+segmentSelect(r,i,'serial')+'</td><td>'+pill(r.resultado)+'</td><td>'+esc(r.detalle)+'</td></tr>';
    }).join(''):'<tr class="empty-row"><td colspan="9">Sin registros</td></tr>';

    const nr=v.no_serializados||[];
    document.getElementById('noSerialBody').innerHTML=nr.length?nr.map((r,i)=>'<tr><td><strong>'+esc(r.codigo_sap)+'</strong></td><td>'+esc(r.dominio||'—')+'</td><td>'+esc(r.descripcion||'—')+'</td><td>'+esc(r.cantidad)+'</td><td>'+segmentSelect(r,i,'no')+'</td><td>'+pill(r.resultado)+'</td><td>'+esc(r.detalle)+'</td></tr>').join(''):'<tr class="empty-row"><td colspan="7">Sin registros</td></tr>';
    document.getElementById('noSerialCard').hidden=source==='EXCEL'&&!nr.length;

    const ge=v.errores_globales||[];
    const card=document.getElementById('globalErrorsCard');
    card.hidden=!ge.length;
    document.getElementById('globalErrors').innerHTML=ge.map(x=>'<div class="review-message">'+esc(x)+'</div>').join('');

    document.querySelectorAll('.manual-serial').forEach(input=>input.addEventListener('change',async e=>{
      const idx=Number(e.target.dataset.index);
      currentPayload.seriales[idx].serial=upper(e.target.value);
      processMessage.textContent='Revalidando serial…';processMessage.className='process-message';
      try{await validatePayload(currentPayload);processMessage.textContent='Serial validado.';processMessage.className='process-message success';}
      catch(err){processMessage.textContent=err.message||'No fue posible validar.';processMessage.className='process-message error';}
    }));
    document.querySelectorAll('.segment-select').forEach(sel=>sel.addEventListener('change',async e=>{
      const idx=Number(e.target.dataset.index),kind=e.target.dataset.kind,val=e.target.value;
      if(kind==='serial')currentPayload.seriales[idx].segmento_manual=val;
      else currentPayload.no_serializados[idx].segmento_manual=val;
      processMessage.textContent='Revalidando Segmento…';processMessage.className='process-message';
      try{await validatePayload(currentPayload);processMessage.textContent='Segmento validado.';processMessage.className='process-message success';}
      catch(err){processMessage.textContent=err.message||'No fue posible validar.';processMessage.className='process-message error';}
    }));

    const bar=document.querySelector('.register-bar'),title=document.getElementById('registerTitle'),help=document.getElementById('registerHelp');
    if(registered){registerBtn.disabled=true;bar.className='register-bar ready';title.textContent='Desmonte registrado';help.textContent='Inventario e historial actualizados correctamente.';}
    else if((s.errores||0)>0||(s.revisar||0)>0){registerBtn.disabled=true;bar.className='register-bar error';title.textContent='El Desmonte requiere revisión';help.textContent='Corrige los errores y completa todos los Segmentos pendientes.';}
    else{registerBtn.disabled=false;bar.className='register-bar ready';title.textContent='Desmonte listo para registrar';help.textContent='SIGLO aplicará A221 · '+(source==='PDF'?'QMINTIC':'QQ01Q1')+' · NOVALORADO · Stock 4 · DESMONTE · Inversa · Dañado.';}
    resultsSection.hidden=false;
  }

  async function ensureSession(){
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){window.location.replace('index.html');return false;}
    return true;
  }

  processPdfBtn.addEventListener('click',async()=>{
    if(!currentFile||source!=='PDF'||!await ensureSession())return;
    processPdfBtn.disabled=true;processPdfBtn.textContent='Procesando…';processMessage.textContent='Leyendo PDF y validando con las maestras…';processMessage.className='process-message';
    try{const payload=await makePdfPayload(currentFile);await validatePayload(payload);processMessage.textContent='PDF procesado. Revisa el resultado antes de registrar.';processMessage.className='process-message success';resultsSection.scrollIntoView({behavior:'smooth',block:'start'});}
    catch(e){processMessage.textContent=e.message||'No fue posible procesar el PDF.';processMessage.className='process-message error';resultsSection.hidden=true;}
    finally{processPdfBtn.textContent='Procesar PDF →';processPdfBtn.disabled=!currentFile;}
  });

  processExcelBtn.addEventListener('click',async()=>{
    if(!currentFile||source!=='EXCEL'||!await ensureSession())return;
    processExcelBtn.disabled=true;processExcelBtn.textContent='Procesando…';processMessage.textContent='Leyendo Excel y validando con las maestras…';processMessage.className='process-message';
    try{const payload=await makeExcelPayload(currentFile);await validatePayload(payload);processMessage.textContent='Excel procesado. Revisa el resultado antes de registrar.';processMessage.className='process-message success';resultsSection.scrollIntoView({behavior:'smooth',block:'start'});}
    catch(e){processMessage.textContent=e.message||'No fue posible procesar el Excel.';processMessage.className='process-message error';resultsSection.hidden=true;}
    finally{processExcelBtn.textContent='Procesar Excel →';processExcelBtn.disabled=!currentFile;}
  });

  registerBtn.addEventListener('click',async()=>{
    if(registerBtn.disabled||!currentPayload||!await ensureSession())return;
    const old=registerBtn.textContent;registerBtn.disabled=true;registerBtn.textContent='Registrando…';processMessage.textContent='Aplicando Desmonte de forma transaccional…';processMessage.className='process-message';
    const {data,error}=await supabase.rpc('registrar_desmonte',{p_payload:currentPayload});
    if(error){registerBtn.textContent=old;processMessage.textContent=error.message||'No fue posible registrar.';processMessage.className='process-message error';await validatePayload(currentPayload);return;}
    registered=true;registerBtn.textContent='Registrado ✓';processMessage.textContent='Desmonte '+(data?.documento||currentPayload.documento)+' registrado · '+(data?.movimientos||0)+' movimiento(s).';processMessage.className='process-message success';renderValidation();
  });

  document.getElementById('clearBtn').addEventListener('click',()=>{
    currentFile=null;pdfInput.value='';excelInput.value='';document.getElementById('pdfFileName').textContent='Ningún archivo seleccionado';document.getElementById('excelFileName').textContent='Ningún archivo seleccionado';processPdfBtn.disabled=true;processExcelBtn.disabled=true;document.getElementById('pdfStatus').textContent='Esperando PDF…';document.getElementById('excelStatus').textContent='Esperando Excel…';resetResults();window.scrollTo({top:0,behavior:'smooth'});
  });
});