document.addEventListener('DOMContentLoaded', () => {
  const supabase=window.sigloSupabase;
  const XLSX=window.XLSX;
  const fileInput=document.getElementById('paqueteMatriz');
  const editedInput=document.getElementById('paqueteEditado');
  const generate=document.getElementById('paqueteGenerar');
  const rebuild=document.getElementById('paqueteRegenerar');
  const status=document.getElementById('paqueteEstado');
  const stats=document.getElementById('paqueteEstadisticas');
  const clean=v=>String(v??'').trim().replace(/\s+/g,' ');
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const sap=v=>clean(v).replace(/\.0+$/,'');
  const num=v=>Number(v)||0;
  const today=()=>new Date().toISOString().slice(0,10);
  const dateCompact=()=>today().replaceAll('-','');
  const safeSheet=s=>norm(s).replace(/[\[\]:*?\/\\]/g,'').replace(/\s+/g,'-').slice(0,31);
  const escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
  const notify=(msg,kind='')=>{status.textContent=msg;status.className='report-message'+(kind?' '+kind:'');};

  // Los registros editables conservan la granularidad: uno por serial o por saldo sin serial.
  const baseKeys=['codigo_sap','descripcion','centro','almacen','ubicacion','segmento','lote','stock','cantidad','serial','serializado'];
  function cleanData(input){
    return (input||[]).map(item=>({
      codigo_sap:sap(item.codigo_sap),
      descripcion:clean(item.descripcion),
      centro:norm(item.centro),
      almacen:norm(item.almacen),
      ubicacion:norm(item.ubicacion),
      segmento:norm(item.segmento)||'SIN SEGMENTO',
      lote:norm(item.lote),
      stock:num(item.stock)||1,
      cantidad:num(item.cantidad),
      serial:clean(item.serial),
      serializado:item.serializado===true||item.serializado===1||item.serializado==='1'||norm(item.serializado)==='SI'?1:0
    })).filter(x=>x.codigo_sap&&x.cantidad>0&&x.almacen);
  }
  function readMatrix(workbook){
    const sheet=workbook.Sheets.DISTRIBUCION||workbook.Sheets.MATRIZ||workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet)throw Error('No se encontró la matriz del Cliente.');
    const data=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
    if(!data.length)throw Error('La matriz está vacía.');
    const cols=Object.keys(data[0]);
    const col=name=>cols.find(c=>norm(c)===name);
    const a=col('CODIGO SAP')||col('CODIGO')||col('SAP');
    const b=col('DESCRIPCION');
    const c=col('ANOTACION')||col('OBSERVACION');
    if(!a||!b||!c)throw Error('La matriz necesita CÓDIGO SAP, DESCRIPCIÓN y ANOTACIÓN.');
    const map=new Map();
    for(const row of data){
      const code=sap(row[a]);
      if(!code)continue;
      const annotation=norm(row[c]);
      if(!annotation)throw Error('Falta ANOTACIÓN para el código '+code+'.');
      const before=map.get(code);
      if(before&&norm(before.anotacion)!==annotation)
        throw Error('El SAP '+code+' tiene anotaciones contradictorias en la matriz del Cliente.');
      if(!before)map.set(code,{codigo_sap:code,descripcion:clean(row[b]),anotacion:clean(row[c])});
    }
    return [...map.values()];
  }
  function readEdited(fileBuffer){
    const book=XLSX.read(fileBuffer,{type:'array',cellDates:false});
    const ws=book.Sheets['BASE MAESTRA'];
    const mat=book.Sheets.MATRIZ;
    if(!ws||!mat)throw Error('Este Excel no es un Paquete Fiscal Dinámico de SIGLO.');
    const rows=XLSX.utils.sheet_to_json(ws,{range:4,defval:'',raw:false});
    const data=rows.map(r=>({
      codigo_sap:r['CODIGO SAP'],descripcion:r.DESCRIPCION,centro:r.CENTRO,
      almacen:r.ALMACEN,ubicacion:r.UBICACION,segmento:r.SEGMENTO,lote:r.LOTE,
      stock:r.STOCK,cantidad:r.CANTIDAD,serial:r.SERIAL,serializado:r.SERIALIZADO
    }));
    const matrix=XLSX.utils.sheet_to_json(mat,{range:4,defval:'',raw:false})
      .map(r=>({codigo_sap:sap(r['CODIGO SAP']),descripcion:clean(r.DESCRIPCION),anotacion:clean(r.ANOTACION)}))
      .filter(r=>r.codigo_sap);
    const dup=new Map();
    matrix.forEach(r=>{
      const old=dup.get(r.codigo_sap);
      if(old&&norm(old)!==norm(r.anotacion))throw Error('Matriz contradictoria: '+r.codigo_sap);
      dup.set(r.codigo_sap,r.anotacion);
    });
    return {data:cleanData(data),matrix};
  }
  function groupsFor(data,matrix){
    const annotations=new Map(matrix.map(x=>[x.codigo_sap,x.anotacion]));
    const segments=[...new Set(data.map(x=>x.segmento))].sort();
    const warehouses=[...new Set(data.map(x=>x.almacen))].sort();
    const active=new Map();
    for(const item of data){
      const annotation=annotations.has(item.codigo_sap)?norm(annotations.get(item.codigo_sap)):'CERTIFICADO';
      const key=[item.segmento,item.almacen,annotation].join('|');
      active.set(key,(active.get(key)||0)+1);
    }
    // Una pestaña por grupo fiscal con existencias al momento de exportar.
    // Un grupo completamente nuevo se incorpora mediante la regeneración local.
    const keys=[...active.keys()].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
    if(keys.length>120)throw Error('Demasiadas combinaciones potenciales de Actas ('+keys.length+').');
    return {keys,active,annotations,warehouses,segments};
  }
  function worksheet(book,name,head,rows,widths){
    const data=[head,...rows];
    const ws=XLSX.utils.aoa_to_sheet(data);
    ws['!cols']=(widths||head.map(()=>18)).map(wch=>({wch}));
    ws['!freeze']={xSplit:0,ySplit:1};
    if(head.length)ws['!autofilter']={ref:'A1:'+XLSX.utils.encode_col(head.length-1)+'1'};
    XLSX.utils.book_append_sheet(book,ws,name.slice(0,31));
    return ws;
  }
  function polished(book,name,header,row,body,columns,widths){
    const rows=[];
    for(let i=0;i<header.length;i++)rows.push(header[i]);
    rows.push(columns);
    if(body?.length)rows.push(...body);
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=widths.map(wch=>({wch}));
    ws['!freeze']={xSplit:0,ySplit:row-1};
    ws['!autofilter']={ref:'A'+row+':'+XLSX.utils.encode_col(columns.length-1)+row};
    XLSX.utils.book_append_sheet(book,ws,name.slice(0,31));
    return ws;
  }
  const modernFormula=f=>f.replace(/\b(FILTER|SORT|UNIQUE|CHOOSECOLS|LET|BYROW|LAMBDA|HSTACK)\(/g,(found,fn)=>{
    if(fn==='FILTER'||fn==='SORT')return '_xlfn._xlws.'+fn+'(';
    return '_xlfn.'+fn+'(';
  });
  const formula=(ws,addr,f)=>{ws[addr]={t:'n',f:modernFormula(f)};};
  function arrayFormula(ws,cell,f){
    // Metadatos D:true y rango de una celda: Excel determina la zona derramada.
    XLSX.utils.sheet_set_array_formula(ws,cell,modernFormula(f),true);
  }
  function titleRows(title,desc,comment){
    return [[title],[desc],[comment],[]];
  }
  function assignFormat(ws,headRow,widths){
    ws['!cols']=widths.map(w=>({wch:w}));
    ws['!autofilter']={ref:'A'+headRow+':'+XLSX.utils.encode_col(widths.length-1)+headRow};
    ws['!freeze']={xSplit:0,ySplit:headRow};
  }
  function sheetNamed(book,name,headers,widths,title,detail){
    const ws=XLSX.utils.aoa_to_sheet([[title],[detail],[],[],headers]);
    assignFormat(ws,5,widths);
    XLSX.utils.book_append_sheet(book,ws,name);
    return ws;
  }
  function exportWorkbook(dataIn,matrixIn,fileName){
    if(!XLSX)throw Error('No se ha cargado el motor de Excel.');
    const data=cleanData(dataIn);
    if(!data.length)throw Error('No se encontraron existencias fiscales para el paquete.');
    const matrix=matrixIn.slice().sort((a,b)=>a.codigo_sap.localeCompare(b.codigo_sap,'es',{numeric:true}));
    const groups=groupsFor(data,matrix);
    const book=XLSX.utils.book_new();
    const rowsLimit=data.length+1000+5;
    const matrixLimit=Math.max(matrix.length+5,6);
    const master="'BASE MAESTRA'!";
    const masterRange=master+'$A$6:$P$'+rowsLimit;
    const masterCodes=master+'$A$6:$A$'+rowsLimit;
    const groupRange=master+'$M$6:$M$'+rowsLimit;
    const qtyRange=master+'$I$6:$I$'+rowsLimit;
    const serialFlag=master+'$K$6:$K$'+rowsLimit;
    const fiscalKey=master+'$N$6:$N$'+rowsLimit;
    const modelKey=master+'$O$6:$O$'+rowsLimit;
    const headers=['CODIGO SAP','DESCRIPCION','CENTRO','ALMACEN','UBICACION','SEGMENTO','LOTE','STOCK','CANTIDAD','SERIAL','SERIALIZADO','ANOTACION','GRUPO ACTA','CLAVE FISCAL','CLAVE MODELO','PLANILLA'];
    const guide=worksheet(book,'LEEME',['PAQUETE FISCAL DINÁMICO','INSTRUCCIONES'],[
      ['Fuente','Exportación puntual de SIGLO. Este libro no escribe en Supabase.'],
      ['Edición','Modifica solo columnas A:K de BASE MAESTRA. No sobrescribas las columnas L:P.'],
      ['Recalcular','Excel de escritorio Microsoft 365: Fórmulas > Opciones de cálculo > Automático.'],
      ['Actualización','Los informes dependen de fórmulas dinámicas, se recalculan al editar BASE MAESTRA.'],
      ['Actas','Las pestañas previstas cubren segmentos, almacenes y anotaciones presentes.'],
      ['Grupo nuevo','Si agregas un nuevo almacén, segmento o anotación, vuelve a SIGLO y usa REGENERAR DESDE EXCEL.'],
      ['Preliminar Cliente','No se modifica ninguna información original del Cliente.'],
      ['Matriz','La hoja MATRIZ conserva las anotaciones del Cliente; SAP ausente se trata como CERTIFICADO.'],
      ['Histórico','Guarda una copia independiente cuando el inventario sea firmado o entregado.'],
      ['Versión','Motor Excel Microsoft 365; no incluye macros VBA ni depende de servicios externos.'],
      ['Fecha exportación',today()]
    ],[34,110]);
    guide['!rows']=[{hpt:28}];
    const matr=polished(book,'MATRIZ',titleRows('MATRIZ DEL CLIENTE','Fuente de clasificación para Actas y Modelo','No cambiar las anotaciones de Claro sin validación.'),5,matrix.map(x=>[x.codigo_sap,x.descripcion,x.anotacion]),['CODIGO SAP','DESCRIPCION','ANOTACION'],[19,58,38]);
    const masterData=data.map(x=>[x.codigo_sap,x.descripcion,x.centro,x.almacen,x.ubicacion,x.segmento,x.lote,x.stock,x.cantidad,x.serial,x.serializado,null,null,null,null,null]);
    const base=polished(book,'BASE MAESTRA',titleRows('BASE MAESTRA EDITABLE','Cambios exclusivos de este Excel. Columnas A:K editables.','Columnas L:P calculadas. No eliminar filas existentes: para retirar una existencia poner CANTIDAD=0.'),5,masterData,headers,[18,45,12,14,19,22,18,11,13,27,14,30,45,65,76,19]);
    for(let index=0;index<data.length+1000;index++){
      const r=index+6;
      // Fórmulas adicionales hasta mil registros para permitir ampliar la base sin perder cálculos.
      formula(base,'L'+r,'IF(A'+r+'="","",IFERROR(VLOOKUP(A'+r+',MATRIZ!$A$6:$C$'+matrixLimit+',3,FALSE),"CERTIFICADO"))');
      formula(base,'M'+r,'IF(A'+r+'="","",F'+r+'&"|"&D'+r+'&"|"&UPPER(L'+r+'))');
      formula(base,'N'+r,'IF(A'+r+'="","",A'+r+'&"|"&C'+r+'&"|"&D'+r+'&"|"&G'+r+'&"|"&E'+r+'&"|"&H'+r+')');
      formula(base,'O'+r,'IF(A'+r+'="","",P'+r+'&"|"&N'+r+')');
      formula(base,'P'+r,'IF(A'+r+'="","",IFERROR(VLOOKUP(M'+r+',PLANILLAS!$A$6:$B$'+(groups.keys.length+5)+',2,FALSE),"REGENERAR ACTAS"))');
    }
    const planRows=groups.keys.map(k=>[k,null,null]);
    const plan=polished(book,'PLANILLAS',titleRows('PLANILLAS Y GRUPOS','Las planillas se recalculan por grupos con existencias fiscales.','Un grupo nuevo que no figure en esta lista requiere REGENERAR DESDE EXCEL.'),5,planRows,['GRUPO ACTA','NRO PLANILLA','FILAS EN GRUPO'],[53,22,21]);
    groups.keys.forEach((key,i)=>{
      const r=6+i;
      formula(plan,'C'+r,'COUNTIF('+groupRange+',A'+r+')');
      formula(plan,'B'+r,'IF(C'+r+'=0,"",COUNTIF($C$6:C'+r+',">0"))');
    });

    const map=sheetNamed(book,'MAPA FISCAL',['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','STOCK','NOMBRE DEL EQUIPO','FECHA'],[18,14,14,18,22,12,48,16],'MAPA FISCAL','Una fila por llave fiscal única; se recalcula al editar BASE MAESTRA.');
    assignFormat(map,5,[18,14,14,18,22,12,48,16]);
    arrayFormula(map,'A6',
      'IFERROR(LET(k,SORT(UNIQUE(FILTER(CHOOSECOLS('+masterRange+',1,3,4,7,5,8),'+masterCodes+'<>""))),n,BYROW(k,LAMBDA(r,IFERROR(INDEX('+master+'$B$6:$B$'+rowsLimit+',MATCH(TEXTJOIN("|",FALSE,r),'+fiscalKey+',0)),""))),HSTACK(k,n)),"")',
      7,data.length+100);
    // Fecha de consulta: referencia fija de la exportación, sin modificar existencias.
    for(let r=6;r<=Math.min(rowsLimit,data.length+205);r++)formula(map,'H'+r,'IF(A'+r+'="","","'+today()+'")');

    const inv=sheetNamed(book,'INVENTARIO FISCAL',['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','STOCK','SALDO','FECHA'],[18,14,14,18,22,12,15,16],
      'INVENTARIO FISCAL','Agrupa por Código SAP, Centro, Almacén, Lote, Ubicación y Stock; SUMIF recalcula cantidades.');
    arrayFormula(inv,'A6',
      'IFERROR(SORT(UNIQUE(FILTER(CHOOSECOLS('+masterRange+',1,3,4,7,5,8),'+masterCodes+'<>""))),"")',
      6,data.length+100);
    const invKey='CHOOSECOLS(A6#,1)&"|"&CHOOSECOLS(A6#,2)&"|"&CHOOSECOLS(A6#,3)&"|"&CHOOSECOLS(A6#,4)&"|"&CHOOSECOLS(A6#,5)&"|"&CHOOSECOLS(A6#,6)';
    arrayFormula(inv,'G6','IFERROR(SUMIF('+fiscalKey+','+invKey+','+qtyRange+'),"")');
    for(let r=6;r<=Math.min(rowsLimit,data.length+205);r++)formula(inv,'H'+r,'IF(A'+r+'="","","'+today()+'")');

    const actSummary=sheetNamed(book,'ACTAS DE CONTEO',['GRUPO ACTA','NRO PLANILLA','REGISTROS','UNIDADES','SERIALIZADOS','HOJA ACTA'],[53,20,18,18,19,31],
      'ACTAS DE CONTEO','Separadas por Segmento + Almacén + Anotación. Solo grupos con existencias tienen planilla.');
    groups.keys.forEach((key,i)=>{
      const r=6+i;
      actSummary['A'+r]={t:'s',v:key};
      formula(actSummary,'B'+r,'IFERROR(VLOOKUP(A'+r+',PLANILLAS!$A$6:$B$'+(5+groups.keys.length)+',2,FALSE),"")');
      formula(actSummary,'C'+r,'COUNTIF('+groupRange+',A'+r+')');
      formula(actSummary,'D'+r,'SUMIF('+groupRange+',A'+r+','+qtyRange+')');
      formula(actSummary,'E'+r,'COUNTIFS('+groupRange+',A'+r+','+serialFlag+',1)');
      actSummary['F'+r]={t:'s',v:'ACTA_'+String(i+1).padStart(3,'0')};
    });

    groups.keys.forEach((key,i)=>{
      const short=String(i+1).padStart(3,'0');
      const mainName='ACTA_'+short;
      const serName='SER_'+short;
      const act=sheetNamed(book,mainName,['CODIGO SAP','DESCRIPCION','UBICACION','LOTE','CANTIDAD','OBSERVACION'],[18,48,22,17,15,25],
        'ACTA '+short+' · '+key,'Filtro dinámico sobre BASE MAESTRA. Editar exclusivamente allí.');
      act['B3']={t:'s',v:key};
      const sql='IFERROR(LET(t,FILTER(CHOOSECOLS('+masterRange+',1,2,5,7,6),'+groupRange+'=$B$3),u,UNIQUE(t),c,BYROW(u,LAMBDA(r,SUMIFS('+qtyRange+','+masterCodes+',INDEX(r,1,1),'+master+'$E$6:$E$'+rowsLimit+',INDEX(r,1,3),'+master+'$G$6:$G$'+rowsLimit+',INDEX(r,1,4),'+groupRange+',$B$3))),HSTACK(CHOOSECOLS(u,1,2,3,4),c,CHOOSECOLS(u,5)))),"")';
      arrayFormula(act,'A6',sql,6,data.length+100);
      const ser=sheetNamed(book,serName,['CODIGO SAP','DESCRIPCION','CANTIDAD','SERIAL','LOTE','UBICACION','OBSERVACIONES'],[18,46,14,29,18,22,24],
        'SERIALIZADOS '+short+' · '+key,'Anexo serializado vinculado a BASE MAESTRA.');
      ser['B3']={t:'s',v:key};
      arrayFormula(ser,'A6',
        'IFERROR(FILTER(CHOOSECOLS('+masterRange+',1,2,9,10,7,5,6),('+groupRange+'=$B$3)*('+serialFlag+'=1)),"")',
        7,data.length+100);
    });

    const model=sheetNamed(book,'MODELO ESTRUCTURA',['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','STOCK','NRO PLANILLA','CONTEO1','CONTEO2','FECHA'],[18,14,14,17,22,12,19,14,14,16],
      'MODELO ESTRUCTURA','Planillas ligadas a grupos de Actas. Las cantidades se consolidan por llave.');
    arrayFormula(model,'A6',
      'IFERROR(SORT(UNIQUE(FILTER(CHOOSECOLS('+masterRange+',1,3,4,7,5,8,16),'+masterCodes+'<>""))),"")',
      7,data.length+100);
    const mk='CHOOSECOLS(A6#,7)&"|"&CHOOSECOLS(A6#,1)&"|"&CHOOSECOLS(A6#,2)&"|"&CHOOSECOLS(A6#,3)&"|"&CHOOSECOLS(A6#,4)&"|"&CHOOSECOLS(A6#,5)&"|"&CHOOSECOLS(A6#,6)';
    arrayFormula(model,'H6','IFERROR(SUMIF('+modelKey+','+mk+','+qtyRange+'),"")');
    arrayFormula(model,'I6','IFERROR(H6#,"")');
    for(let r=6;r<=Math.min(rowsLimit,data.length+205);r++)formula(model,'J'+r,'IF(A'+r+'="","","'+dateCompact()+'")');

    const serialized=sheetNamed(book,'MODELO SERIALIZADOS',['CODIGO SAP','DESCRIPCION','SERIAL','CANTIDAD','LOTE','UBICACION','TIPO STOCK','SERIAL RR','NRO PLANILLA'],[18,46,30,13,18,20,17,30,18],
      'MODELO SERIALIZADOS','Anexo de todos los materiales serializados, vinculado a BASE MAESTRA.');
    arrayFormula(serialized,'A6',
      'IFERROR(FILTER(CHOOSECOLS('+masterRange+',1,2,10,9,7,5,8,10,16),('+serialFlag+'=1)*('+masterCodes+'<>"")),"")',
      9,data.length+100);

    book.Workbook=book.Workbook||{};
    book.Workbook.CalcPr={calcMode:'auto',fullCalcOnLoad:true};
    XLSX.writeFile(book,fileName||'SIGLO_Paquete_Fiscal_Dinamico_'+today()+'.xlsx',{compression:true,bookType:'xlsx'});
    return {records:data.length,groups:groups.keys.length,activeGroups:groups.active.size,
      serials:data.filter(x=>x.serializado).length,
      autoCertificate:[...new Set(data.filter(x=>!groups.annotations.has(x.codigo_sap)).map(x=>x.codigo_sap))].length};
  }

  fileInput.addEventListener('change',()=>{generate.disabled=!fileInput.files?.length;});
  editedInput.addEventListener('change',()=>{rebuild.disabled=!editedInput.files?.length;});

  generate.addEventListener('click',async()=>{
    const file=fileInput.files?.[0];
    if(!file)return;
    generate.disabled=true;notify('Leyendo la clasificación del Cliente y consultando la base fiscal de SIGLO…');
    try{
      if(!supabase||!XLSX)throw Error('No está disponible la conexión o el generador de Excel.');
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw Error('La sesión de SIGLO expiró.');
      const matrix=readMatrix(XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}));
      const {data,error}=await supabase.rpc('consultar_base_actas_conteo');
      if(error)throw error;
      if(!Array.isArray(data)||!data.length)throw Error('La base fiscal de SIGLO está vacía.');
      const out=exportWorkbook(data,matrix);
      stats.innerHTML='<strong>'+out.records+'</strong> registros · <strong>'+out.activeGroups+'</strong> actas con inventario · <strong>'+out.serials+'</strong> seriales · <strong>'+out.autoCertificate+'</strong> SAP certificados automáticamente.';
      notify('Paquete generado. Podrás corregir BASE MAESTRA en el Excel sin cambiar SIGLO.','success');
    }catch(err){console.error(err);notify(err.message||'No se pudo generar el paquete fiscal.','error');}
    finally{generate.disabled=false;}
  });

  rebuild.addEventListener('click',async()=>{
    const file=editedInput.files?.[0];
    if(!file)return;
    rebuild.disabled=true;notify('Regenerando las actas y cuatro informes únicamente desde el Excel editado…');
    try{
      if(!XLSX)throw Error('El motor de Excel no está disponible.');
      const {data,matrix}=readEdited(await file.arrayBuffer());
      const out=exportWorkbook(data,matrix,'SIGLO_Paquete_Fiscal_Reorganizado_'+today()+'.xlsx');
      stats.innerHTML='<strong>'+out.records+'</strong> registros · <strong>'+out.activeGroups+'</strong> actas con inventario · <strong>'+out.serials+'</strong> seriales.';
      notify('Paquete regenerado desde el Excel. No se leyó ni se modificó la base de datos de SIGLO.','success');
    }catch(err){console.error(err);notify(err.message||'No se pudo regenerar el archivo.','error');}
    finally{rebuild.disabled=false;}
  });
});
