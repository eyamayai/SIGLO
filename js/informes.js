document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.sigloSupabase;
  const buttons = [...document.querySelectorAll('.report-option')];
  const generateBtn = document.getElementById('generateReportBtn');
  const exportBtn = document.getElementById('exportReportBtn');
  const result = document.getElementById('reportResult');
  const message = document.getElementById('reportMessage');
  const standardControls = document.getElementById('standardReportControls');

  const actasControls = document.getElementById('actasControls');
  const actasResult = document.getElementById('actasResult');
  const actasFileInput = document.getElementById('actasFileInput');
  const actasFileName = document.getElementById('actasFileName');
  const prepareActasBtn = document.getElementById('prepareActasBtn');
  const exportActasBtn = document.getElementById('exportActasBtn');
  const actasMessage = document.getElementById('actasMessage');

  let selected = 'mapa_fiscal';
  let dataCache = null;
  let currentRows = [];
  let actasFile = null;
  let preparedActas = null;

  const definitions = {
    mapa_fiscal: {
      title: 'Mapa Fiscal',
      help: 'Genera una fila única por combinación de material, almacén, lote, ubicación y stock.',
      headers: ['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','FECHA','STOCK','NOMBRE DEL EQUIPO'],
      map: row => [row.codigo_sap,row.centro,row.almacen,row.lote,row.ubicacion,today(),row.stock,row.nombre_equipo || '']
    },
    certificado_mensual: {
      title: 'Certificado Mensual',
      help: 'Consolida los saldos de Material Libre y Material Desmonte, sin distinguir la topología.',
      headers: ['TIPO','CODIGO SAP','DESCRIPCION','LOTE','ALMACEN','CENTRO','ALIADO','SALDO'],
      map: row => [row.tipo,row.codigo_sap,row.descripcion || '',row.lote,row.almacen,row.centro,row.aliado,row.saldo]
    },
    inventario_fiscal: {
      title: 'Inventario Fiscal',
      help: 'Consolida los saldos actuales por ubicación, almacén, lote y stock.',
      headers: ['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','FECHA','STOCK','SALDO'],
      map: row => [row.codigo_sap,row.centro,row.almacen,row.lote,row.ubicacion,today(),row.stock,row.saldo]
    }
  };

  function today(){
    const d=new Date();
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  }

  function fileDate(){
    const d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function escapeHtml(value){
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
  }

  function normalizeText(value){
    return String(value ?? '').trim().replace(/\s+/g,' ');
  }

  function normalizeHeader(value){
    return String(value ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .trim().toUpperCase();
  }

  function normalizeCode(value){
    return normalizeText(value).replace(/\.0+$/,'');
  }

  function formatNumber(value){
    const n=Number(value);
    if(!Number.isFinite(n)) return value ?? '';
    return new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(n);
  }

  function setMessage(text='',type=''){
    message.textContent=text;
    message.className='report-message'+(type?' '+type:'');
  }

  function setActasMessage(text='',type=''){
    actasMessage.textContent=text;
    actasMessage.className='report-message'+(type?' '+type:'');
  }

  function selectReport(key){
    selected=key;
    buttons.forEach(btn=>btn.classList.toggle('active',btn.dataset.report===key));

    if(key==='actas_conteo'){
      standardControls.hidden=true;
      result.hidden=true;
      actasControls.hidden=false;
      actasResult.hidden=!preparedActas;
      setMessage('');
      return;
    }

    actasControls.hidden=true;
    actasResult.hidden=true;
    standardControls.hidden=false;
    const def=definitions[key];
    document.getElementById('selectedReportTitle').textContent=def.title;
    document.getElementById('selectedReportHelp').textContent=def.help;
    result.hidden=true;
    currentRows=[];
    setMessage('');
  }

  buttons.forEach(btn=>btn.addEventListener('click',()=>selectReport(btn.dataset.report)));

  function render(){
    const def=definitions[selected];
    const rawRows=dataCache?.[selected] || [];
    currentRows=rawRows.map(def.map);

    document.getElementById('resultTitle').textContent=def.title;
    document.getElementById('resultCount').textContent=currentRows.length+' fila'+(currentRows.length===1?'':'s');
    document.getElementById('resultDate').textContent=today();

    document.getElementById('reportHead').innerHTML='<tr>'+def.headers.map(h=>'<th>'+escapeHtml(h)+'</th>').join('')+'</tr>';

    const descriptionIndex = selected==='mapa_fiscal' ? 7 : (selected==='certificado_mensual' ? 2 : -1);
    const numberIndex = selected==='certificado_mensual' ? 7 : (selected==='inventario_fiscal' ? 7 : -1);

    document.getElementById('reportBody').innerHTML=currentRows.length
      ? currentRows.map(row=>'<tr>'+row.map((cell,index)=>{
          const cls=index===descriptionIndex?' class="description-cell"':(index===numberIndex?' class="number-cell"':'');
          const value=index===numberIndex?formatNumber(cell):cell;
          return '<td'+cls+'>'+escapeHtml(value)+'</td>';
        }).join('')+'</tr>').join('')
      : '<tr class="empty-row"><td colspan="'+def.headers.length+'">No hay inventario físico para este informe.</td></tr>';

    result.hidden=false;
  }

  generateBtn.addEventListener('click',async()=>{
    generateBtn.disabled=true;
    generateBtn.textContent='Generando…';
    setMessage('Consultando el inventario físico actual…');

    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){window.location.replace('index.html');return;}

      const {data,error}=await supabase.rpc('consultar_informes_fiscales');
      if(error) throw error;
      dataCache=data || {};
      render();
      setMessage('Informe generado correctamente.','success');
      result.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){
      console.error('Error generando informe',error);
      setMessage(error.message || 'No fue posible generar el informe.','error');
      result.hidden=true;
    }finally{
      generateBtn.disabled=false;
      generateBtn.innerHTML='Generar informe <span>→</span>';
    }
  });

  exportBtn.addEventListener('click',()=>{
    if(!currentRows.length || !window.XLSX) return;
    const def=definitions[selected];
    const ws=XLSX.utils.aoa_to_sheet([def.headers,...currentRows]);
    ws['!cols']=def.headers.map((header,index)=>({
      wch: Math.max(header.length+2, selected==='mapa_fiscal' && index===7 ? 42 : selected==='certificado_mensual' && index===2 ? 42 : 14)
    }));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,def.title.slice(0,31));
    XLSX.writeFile(wb,def.title+' '+fileDate()+'.xlsx');
  });

  function downloadActasTemplate(){
    if(!window.XLSX){
      setActasMessage('No fue posible cargar el generador de Excel.','error');
      return;
    }
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([['CÓDIGO SAP','DESCRIPCIÓN','ANOTACIÓN']]);
    ws['!cols']=[{wch:18},{wch:52},{wch:28}];
    XLSX.utils.book_append_sheet(wb,ws,'DISTRIBUCION');

    const instructions=XLSX.utils.aoa_to_sheet([
      ['SIGLO · Actas de Conteo'],
      ['Pegue la distribución enviada por el cliente en la hoja DISTRIBUCION.'],
      ['Columnas obligatorias: CÓDIGO SAP, DESCRIPCIÓN y ANOTACIÓN.'],
      ['Un Código SAP puede repetirse solo si conserva exactamente la misma ANOTACIÓN.'],
      ['Si un Código SAP aparece con anotaciones diferentes, SIGLO bloqueará la generación hasta corregirlo.'],
      ['Los códigos con inventario físico que no aparezcan en esta matriz se exportarán en NO_CLASIFICADOS.']
    ]);
    instructions['!cols']=[{wch:105}];
    XLSX.utils.book_append_sheet(wb,instructions,'INSTRUCCIONES');
    XLSX.writeFile(wb,'SIGLO_Plantilla_Actas_de_Conteo.xlsx');
  }

  function parseClientMatrix(fileBuffer){
    const wb=XLSX.read(fileBuffer,{type:'array',cellDates:false});
    const sheet=wb.Sheets.DISTRIBUCION || wb.Sheets[wb.SheetNames[0]];
    if(!sheet) throw new Error('El Excel no contiene hojas para procesar.');

    const raw=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
    if(!raw.length) throw new Error('La matriz del cliente no contiene registros.');

    const available=Object.keys(raw[0]).reduce((acc,key)=>{
      acc[normalizeHeader(key)]=key;
      return acc;
    },{});

    const codeCol=available['CODIGO SAP'] || available['CODIGO'] || available['SAP'];
    const descriptionCol=available['DESCRIPCION'];
    const annotationCol=available['ANOTACION'] || available['OBSERVACION'];

    if(!codeCol) throw new Error('Falta la columna CÓDIGO SAP.');
    if(!descriptionCol) throw new Error('Falta la columna DESCRIPCIÓN.');
    if(!annotationCol) throw new Error('Falta la columna ANOTACIÓN.');

    return raw.map((row,index)=>({
      row:index+2,
      codigo_sap:normalizeCode(row[codeCol]),
      descripcion:normalizeText(row[descriptionCol]),
      anotacion:normalizeText(row[annotationCol])
    })).filter(row=>row.codigo_sap || row.descripcion || row.anotacion);
  }

  function compareSap(a,b){
    const sa=String(a), sb=String(b);
    const aNum=/^\d+$/.test(sa), bNum=/^\d+$/.test(sb);
    if(aNum && bNum) return Number(sa)-Number(sb);
    if(aNum) return -1;
    if(bNum) return 1;
    return sa.localeCompare(sb,'es',{numeric:true,sensitivity:'base'});
  }

  function lotOrder(lote){
    return lote==='VALORADO'?1:(lote==='NOVALORADO'?2:9);
  }

  function warehouseOrder(almacen){
    return almacen==='A221'?1:(almacen==='U020'?2:9);
  }

  function cleanSheetToken(value){
    return String(value ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toUpperCase()
      .replace(/^CONTEO\s+/,'')
      .replace(/\s*-\s*/g,'-')
      .replace(/\s+/g,'-')
      .replace(/[\[\]:*?/\\]/g,'')
      .replace(/_+/g,'_')
      .replace(/-+/g,'-')
      .replace(/^[-_]+|[-_]+$/g,'') || 'ACTA';
  }

  function reserveSheetPair(segmento,almacen,anotacion,hasSerial,used){
    const raw=[cleanSheetToken(segmento),cleanSheetToken(almacen),cleanSheetToken(anotacion)].join('_');
    let attempt=1;

    while(true){
      const suffix=attempt===1?'':'-'+attempt;
      const maxBase=hasSerial?27:31;
      const base=raw.slice(0,Math.max(1,maxBase-suffix.length))+suffix;
      const serialName=hasSerial?base.slice(0,27)+'_SER':null;
      if(!used.has(base) && (!serialName || !used.has(serialName))){
        used.add(base);
        if(serialName) used.add(serialName);
        return {main:base,serial:serialName};
      }
      attempt+=1;
    }
  }

  function aggregateActaRows(rows,includeWarehouse=false){
    const map=new Map();

    rows.forEach(row=>{
      const key=(includeWarehouse?[row.codigo_sap,row.almacen,row.ubicacion,row.lote]:[row.codigo_sap,row.ubicacion,row.lote]).join('|');
      const current=map.get(key)||{
        codigo_sap:row.codigo_sap,
        descripcion:row.descripcion||'',
        ubicacion:row.ubicacion||'',
        lote:row.lote||'',
        cantidad:0,
        segmento:row.segmento||'',
        almacen:row.almacen||'',
        serialCount:0,
        hasNonSerial:false
      };
      current.cantidad+=Number(row.cantidad||0);
      if(row.descripcion && !current.descripcion) current.descripcion=row.descripcion;
      if(row.serializado) current.serialCount+=1;
      else current.hasNonSerial=true;
      map.set(key,current);
    });

    return [...map.values()].sort((a,b)=>
      compareSap(a.codigo_sap,b.codigo_sap) ||
      lotOrder(a.lote)-lotOrder(b.lote) ||
      String(a.ubicacion).localeCompare(String(b.ubicacion),'es',{numeric:true,sensitivity:'base'})
    );
  }

  function serialRows(rows){
    return rows
      .filter(row=>row.serializado && row.serial)
      .slice()
      .sort((a,b)=>
        compareSap(a.codigo_sap,b.codigo_sap) ||
        lotOrder(a.lote)-lotOrder(b.lote) ||
        String(a.ubicacion).localeCompare(String(b.ubicacion),'es',{numeric:true,sensitivity:'base'}) ||
        String(a.serial).localeCompare(String(b.serial),'es',{numeric:true,sensitivity:'base'})
      );
  }

  function validateSerialReconciliation(mainRows,serials,includeWarehouse=false){
    const counts=new Map();
    serials.forEach(row=>{
      const key=(includeWarehouse?[row.codigo_sap,row.almacen,row.ubicacion,row.lote]:[row.codigo_sap,row.ubicacion,row.lote]).join('|');
      counts.set(key,(counts.get(key)||0)+1);
    });

    const errors=[];
    mainRows.forEach(row=>{
      if(row.hasNonSerial) return;
      const key=(includeWarehouse?[row.codigo_sap,row.almacen,row.ubicacion,row.lote]:[row.codigo_sap,row.ubicacion,row.lote]).join('|');
      const expected=Number(row.cantidad||0);
      const found=counts.get(key)||0;
      if(Math.abs(expected-found)>0.0001){
        errors.push(row.codigo_sap+' · '+row.ubicacion+' · '+row.lote+': cantidad '+expected+', seriales '+found+'.');
      }
    });
    return errors;
  }

  function buildActas(matrixRows,inventoryRows){
    const annotationSets=new Map();
    const displayAnnotation=new Map();

    matrixRows.forEach(row=>{
      if(!row.codigo_sap) throw new Error('Fila '+row.row+': falta CÓDIGO SAP.');
      if(!row.anotacion) throw new Error('Fila '+row.row+': falta ANOTACIÓN.');
      const code=row.codigo_sap;
      const normalized=normalizeHeader(row.anotacion);
      if(!annotationSets.has(code)) annotationSets.set(code,new Set());
      annotationSets.get(code).add(normalized);
      if(!displayAnnotation.has(code)) displayAnnotation.set(code,row.anotacion);
    });

    const conflicts=[...annotationSets.entries()]
      .filter(([,set])=>set.size>1)
      .map(([code,set])=>({codigo_sap:code,anotaciones:[...set]}))
      .sort((a,b)=>compareSap(a.codigo_sap,b.codigo_sap));

    const conflictedCodes=new Set(conflicts.map(x=>x.codigo_sap));
    const groupMap=new Map();
    const unclassified=[];
    const inventoryCodes=new Set();

    inventoryRows.forEach(raw=>{
      const row={
        ...raw,
        codigo_sap:normalizeCode(raw.codigo_sap),
        descripcion:normalizeText(raw.descripcion),
        almacen:normalizeText(raw.almacen),
        ubicacion:normalizeText(raw.ubicacion),
        segmento:normalizeText(raw.segmento)||'SIN SEGMENTO',
        lote:normalizeHeader(raw.lote),
        cantidad:Number(raw.cantidad||0),
        serial:normalizeText(raw.serial),
        serializado:Boolean(raw.serializado)
      };
      if(row.cantidad<=0) return;
      inventoryCodes.add(row.codigo_sap);

      if(!annotationSets.has(row.codigo_sap) || conflictedCodes.has(row.codigo_sap)){
        unclassified.push(row);
        return;
      }

      const annotation=displayAnnotation.get(row.codigo_sap);
      const key=[row.segmento,row.almacen,normalizeHeader(annotation)].join('|');
      if(!groupMap.has(key)){
        groupMap.set(key,{segmento:row.segmento,almacen:row.almacen,anotacion:annotation,rows:[]});
      }
      groupMap.get(key).rows.push(row);
    });

    const groups=[...groupMap.values()].sort((a,b)=>
      String(a.segmento).localeCompare(String(b.segmento),'es',{sensitivity:'base'}) ||
      warehouseOrder(a.almacen)-warehouseOrder(b.almacen) ||
      String(a.anotacion).localeCompare(String(b.anotacion),'es',{sensitivity:'base'})
    );

    const usedNames=new Set(['NO_CLASIFICADOS','NO_CLASIFICADOS_SER']);
    const serialMismatch=[];
    groups.forEach(group=>{
      group.mainRows=aggregateActaRows(group.rows);
      group.serialRows=serialRows(group.rows);
      const names=reserveSheetPair(group.segmento,group.almacen,group.anotacion,group.serialRows.length>0,usedNames);
      group.sheetName=names.main;
      group.serialSheetName=names.serial;
      validateSerialReconciliation(group.mainRows,group.serialRows).forEach(msg=>serialMismatch.push(group.sheetName+': '+msg));
    });

    const unclassifiedMain=aggregateActaRows(unclassified,true);
    const unclassifiedSerial=serialRows(unclassified);
    validateSerialReconciliation(unclassifiedMain,unclassifiedSerial,true).forEach(msg=>serialMismatch.push('NO_CLASIFICADOS: '+msg));

    const matrixWithoutStock=[...annotationSets.keys()].filter(code=>!inventoryCodes.has(code)).sort(compareSap);

    return {
      matrixCount:annotationSets.size,
      groups,
      conflicts,
      unclassified,
      unclassifiedMain,
      unclassifiedSerial,
      unclassifiedCodes:[...new Set(unclassified.map(x=>x.codigo_sap))].sort(compareSap),
      matrixWithoutStock,
      serialMismatch
    };
  }

  function renderActasPrepared(){
    if(!preparedActas) return;

    document.getElementById('actasMatrixCount').textContent=preparedActas.matrixCount;
    document.getElementById('actasCount').textContent=preparedActas.groups.length;
    document.getElementById('actasUnclassifiedCount').textContent=preparedActas.unclassifiedCodes.length;
    document.getElementById('actasConflictCount').textContent=preparedActas.conflicts.length;

    document.getElementById('actasPreviewBody').innerHTML=preparedActas.groups.length
      ? preparedActas.groups.map(group=>
          '<tr>'+
            '<td><strong>'+escapeHtml(group.sheetName)+'</strong></td>'+
            '<td>'+escapeHtml(group.segmento)+'</td>'+
            '<td>'+escapeHtml(group.almacen)+'</td>'+
            '<td>'+escapeHtml(group.anotacion)+'</td>'+
            '<td>'+group.mainRows.length+'</td>'+
            '<td>'+group.serialRows.length+'</td>'+
          '</tr>'
        ).join('')
      : '<tr class="empty-row"><td colspan="6">No se generaron grupos de Actas con la matriz cargada.</td></tr>';

    const issues=[];
    preparedActas.conflicts.forEach(item=>{
      issues.push('<div class="actas-issue error"><strong>Conflicto '+escapeHtml(item.codigo_sap)+':</strong> aparece con más de una anotación ('+escapeHtml(item.anotaciones.join(' / '))+'). Corrige la matriz antes de exportar.</div>');
    });
    if(preparedActas.unclassifiedCodes.length){
      issues.push('<div class="actas-issue"><strong>NO CLASIFICADOS:</strong> '+preparedActas.unclassifiedCodes.length+' Código(s) SAP con inventario no aparecen en la matriz del cliente. Se incluirán en una hoja de control separada.</div>');
    }
    if(preparedActas.matrixWithoutStock.length){
      issues.push('<div class="actas-issue"><strong>Sin existencia actual:</strong> '+preparedActas.matrixWithoutStock.length+' Código(s) SAP de la matriz no tienen inventario físico en SIGLO y no generan filas.</div>');
    }
    preparedActas.serialMismatch.forEach(item=>{
      issues.push('<div class="actas-issue error"><strong>Seriales:</strong> '+escapeHtml(item)+'</div>');
    });

    const issueBox=document.getElementById('actasIssues');
    issueBox.innerHTML=issues.join('');
    issueBox.hidden=issues.length===0;

    const blocked=preparedActas.conflicts.length>0 || preparedActas.serialMismatch.length>0;
    exportActasBtn.disabled=blocked || (preparedActas.groups.length===0 && preparedActas.unclassifiedMain.length===0);
    actasResult.hidden=false;

    if(blocked){
      setActasMessage('La matriz contiene conflictos o diferencias de seriales. Corrige los bloqueos antes de generar el Excel.','error');
    }else{
      setActasMessage('Distribución preparada correctamente. Revisa las actas y genera el Excel final.','success');
    }
  }

  function appendSheet(wb,name,headers,rows,widths){
    const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
    ws['!cols']=widths.map(wch=>({wch}));
    ws['!autofilter']={ref:'A1:'+XLSX.utils.encode_col(headers.length-1)+'1'};
    XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
  }

  function exportActasWorkbook(){
    if(!preparedActas || exportActasBtn.disabled || !window.XLSX) return;

    const wb=XLSX.utils.book_new();

    preparedActas.groups.forEach(group=>{
      appendSheet(
        wb,
        group.sheetName,
        ['CÓDIGO SAP','DESCRIPCIÓN','UBICACIÓN','LOTE','CANTIDAD','OBSERVACIÓN'],
        group.mainRows.map(row=>[row.codigo_sap,row.descripcion,row.ubicacion,row.lote,row.cantidad,row.segmento]),
        [16,48,18,16,12,20]
      );

      if(group.serialRows.length){
        appendSheet(
          wb,
          group.serialSheetName,
          ['CÓDIGO SAP','DESCRIPCIÓN','CANTIDAD','SERIAL','LOTE','UBICACIÓN','OBSERVACIONES'],
          group.serialRows.map(row=>[row.codigo_sap,row.descripcion,1,row.serial,row.lote,row.ubicacion,row.segmento]),
          [16,48,10,28,16,18,20]
        );
      }
    });

    if(preparedActas.unclassifiedMain.length){
      appendSheet(
        wb,
        'NO_CLASIFICADOS',
        ['CÓDIGO SAP','DESCRIPCIÓN','ALMACÉN','UBICACIÓN','LOTE','CANTIDAD','OBSERVACIÓN'],
        preparedActas.unclassifiedMain.map(row=>[row.codigo_sap,row.descripcion,row.almacen,row.ubicacion,row.lote,row.cantidad,row.segmento]),
        [16,48,14,18,16,12,20]
      );
    }

    if(preparedActas.unclassifiedSerial.length){
      appendSheet(
        wb,
        'NO_CLASIFICADOS_SER',
        ['CÓDIGO SAP','DESCRIPCIÓN','ALMACÉN','CANTIDAD','SERIAL','LOTE','UBICACIÓN','OBSERVACIONES'],
        preparedActas.unclassifiedSerial.map(row=>[row.codigo_sap,row.descripcion,row.almacen,1,row.serial,row.lote,row.ubicacion,row.segmento]),
        [16,48,14,10,28,16,18,20]
      );
    }

    XLSX.writeFile(wb,'SIGLO_Actas_de_Conteo_'+fileDate()+'.xlsx');
    setActasMessage('Excel de Actas de Conteo generado correctamente.','success');
  }

  document.getElementById('downloadActasTemplateBtn').addEventListener('click',downloadActasTemplate);

  actasFileInput.addEventListener('change',()=>{
    actasFile=actasFileInput.files?.[0]||null;
    actasFileName.textContent=actasFile?actasFile.name:'Seleccionar Excel';
    prepareActasBtn.disabled=!actasFile;
    preparedActas=null;
    actasResult.hidden=true;
    exportActasBtn.disabled=true;
    setActasMessage('');
  });

  prepareActasBtn.addEventListener('click',async()=>{
    if(!actasFile) return;

    prepareActasBtn.disabled=true;
    prepareActasBtn.textContent='Preparando…';
    setActasMessage('Leyendo la matriz del cliente y cruzando el inventario físico actual…');

    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){window.location.replace('index.html');return;}

      if(!/\.(xlsx|xls)$/i.test(actasFile.name)) throw new Error('Selecciona un archivo Excel .xlsx o .xls.');

      const matrixRows=parseClientMatrix(await actasFile.arrayBuffer());
      const {data:inventory,error}=await supabase.rpc('consultar_base_actas_conteo');
      if(error) throw error;
      if(!Array.isArray(inventory)) throw new Error('SIGLO no devolvió una base válida para Actas de Conteo.');

      preparedActas=buildActas(matrixRows,inventory);
      renderActasPrepared();
      actasResult.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){
      console.error('Error preparando Actas de Conteo',error);
      preparedActas=null;
      actasResult.hidden=true;
      exportActasBtn.disabled=true;
      setActasMessage(error.message||'No fue posible preparar las Actas de Conteo.','error');
    }finally{
      prepareActasBtn.disabled=!actasFile;
      prepareActasBtn.innerHTML='Preparar actas <span>→</span>';
    }
  });

  exportActasBtn.addEventListener('click',exportActasWorkbook);
});