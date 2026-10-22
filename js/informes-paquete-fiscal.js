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
      // Excel UPPER conserva tildes: usar exactamente la misma clave para las actas.
      const annotation=annotations.has(item.codigo_sap)?clean(annotations.get(item.codigo_sap)).toUpperCase():'CERTIFICADO';
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
    const validRows='('+masterCodes+'<>"")*('+qtyRange+'>0)';
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
      formula(base,'M'+r,'IF(OR(A'+r+'="",I'+r+'<=0),"",F'+r+'&"|"&D'+r+'&"|"&UPPER(L'+r+'))');
      formula(base,'N'+r,'IF(OR(A'+r+'="",I'+r+'<=0),"",A'+r+'&"|"&C'+r+'&"|"&D'+r+'&"|"&G'+r+'&"|"&E'+r+'&"|"&H'+r+')');
      formula(base,'O'+r,'IF(N'+r+'="","",P'+r+'&"|"&N'+r+')');
      formula(base,'P'+r,'IF(M'+r+'="","",IFERROR(VLOOKUP(M'+r+',PLANILLAS!$A$6:$B$'+(groups.keys.length+5)+',2,FALSE),"REGENERAR ACTAS"))');
    }
    base['!ref']='A1:P'+rowsLimit;
    const planRows=groups.keys.map(k=>[k,null,null]);
    const plan=polished(book,'PLANILLAS',titleRows('PLANILLAS Y GRUPOS','Las planillas se recalculan por grupos con existencias fiscales.','Un grupo nuevo que no figure en esta lista requiere REGENERAR DESDE EXCEL.'),5,planRows,['GRUPO ACTA','NRO PLANILLA','FILAS EN GRUPO'],[53,22,21]);
    groups.keys.forEach((key,i)=>{
      const r=6+i;
      formula(plan,'C'+r,'COUNTIF('+groupRange+',A'+r+')');
      formula(plan,'B'+r,'IF(C'+r+'=0,"",COUNTIF($C$6:C'+r+',">0"))');
    });


    // Fórmulas compatibles sin LAMBDA / LET / FILTER / desbordamientos matriciales.
    // Se reservan posiciones para registros que podrían convertirse en una nueva
    // llave fiscal tras corregir BASE MAESTRA. No se crea nada en Supabase.
    const last=rowsLimit;
    const baseRef="'BASE MAESTRA'!";
    const firstRef='$6';
    const fiscalRaw=data.map((d,i)=>({
      i,key:[d.codigo_sap,d.centro,d.almacen,d.lote,d.ubicacion,d.stock].join('|')
    }));
    const modelRaw=data.map((d,i)=>({
      i,key:[groups.keys.indexOf([d.segmento,d.almacen,(groups.annotations.get(d.codigo_sap)||'CERTIFICADO').toUpperCase()].join('|'))+1,
        d.codigo_sap,d.centro,d.almacen,d.lote,d.ubicacion,d.stock].join('|')
    }));
    const partitionUnique=(entries)=>{const seen=new Set(),a=[],b=[];
      entries.forEach(item=>{if(seen.has(item.key))b.push(item.i);else{seen.add(item.key);a.push(item.i)}});
      return a.concat(b);
    };
    const fiscalIndices=partitionUnique(fiscalRaw);
    const modelIndices=partitionUnique(modelRaw);
    const rowLink=(ws,outIndex,baseIndex,fields,visible)=>{
      const tr=outIndex+6,sr=baseIndex+6,checker=baseRef+'$'+visible+sr+'=1';
      fields.forEach((field,j)=>{
        const target=XLSX.utils.encode_col(j)+tr;
        const origin=field.from;
        let expression;
        if(origin){
          expression='IF('+checker+','+baseRef+origin+sr+',"")';
        }else if(field.formula){
          expression='IF('+checker+','+field.formula(sr)+',"")';
        }else{
          expression='IF('+checker+',"'+field.value+'","")';
        }
        const snapshot=field.snapshot?field.snapshot(data[baseIndex]):(origin?(data[baseIndex][field.key]??''):'');
        ws[target]={t:typeof snapshot==='number'?'n':'s',f:expression};
      });
    };
    // Columnas auxiliares: Q clave de Acta; R/S/T marcadores de primera
    // aparición de Acta, llave Fiscal y llave Modelo, respectivamente.
    base['Q5']={t:'s',v:'CLAVE ACTA'};
    base['R5']={t:'s',v:'PRIMERA ACTA'};
    base['S5']={t:'s',v:'PRIMERA FISCAL'};
    base['T5']={t:'s',v:'PRIMERA MODELO'};
    for(let index=0;index<data.length+1000;index++){
      const rr=index+6;
      formula(base,'Q'+rr,'IF(M'+rr+'="","",M'+rr+'&"|"&A'+rr+'&"|"&E'+rr+'&"|"&G'+rr+')');
      formula(base,'R'+rr,'IF(Q'+rr+'="","",IF(COUNTIF($Q$6:Q'+rr+',Q'+rr+')=1,1,0))');
      formula(base,'S'+rr,'IF(N'+rr+'="","",IF(COUNTIF($N$6:N'+rr+',N'+rr+')=1,1,0))');
      formula(base,'T'+rr,'IF(O'+rr+'="","",IF(COUNTIF($O$6:O'+rr+',O'+rr+')=1,1,0))');
    }
    base['!cols']=base['!cols'].concat([{wch:85},{wch:16},{wch:18},{wch:18}]);
    base['!ref']='A1:T'+rowsLimit;
    const makeView=(name,head,widths,heading,desc)=>{
      return sheetNamed(book,name,head,widths,heading,desc);
    };
    const put=(ws,address,form,value)=>{
      ws[address]={t:typeof value==='number'?'n':'s',f:form,v:value==null?'':value};
    };
    const copyIf=(ws,address,condition,origin,value)=>{
      put(ws,address,'IF('+condition+','+baseRef+origin+',"")',value);
    };
    const fillDate=(ws,address,condition)=>put(ws,address,
      'IF('+condition+',"'+dateCompact()+'","")',dateCompact());
    const bookRow=(ws,lastColumn,row)=>{ws['!ref']='A1:'+lastColumn+Math.max(6,row)};
    // MAPA FISCAL (una línea por llave, marcadores de duplicados y orden inicial compacto).
    const mapa=makeView('MAPA FISCAL',
      ['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','FECHA','STOCK','NOMBRE DEL EQUIPO'],
      [18,13,14,17,21,16,12,48],'MAPA FISCAL',
      'Modifica BASE MAESTRA. Las llaves repetidas se presentan una sola vez; filas liberadas aparecen al final.');
    const fiscalSeen=new Set();
    fiscalIndices.forEach((idx,j)=>{
      const rr=idx+6,br=j+6,source=data[idx],condition=baseRef+'$S'+rr+'=1';
      const cols=[['A',source.codigo_sap],['C',source.centro],['D',source.almacen],['G',source.lote],['E',source.ubicacion]];
      cols.forEach(([original,val],k)=>copyIf(mapa,XLSX.utils.encode_col(k)+br,condition,original+rr,val));
      fillDate(mapa,'F'+br,condition);
      copyIf(mapa,'G'+br,condition,'H'+rr,source.stock);
      copyIf(mapa,'H'+br,condition,'B'+rr,source.descripcion);
      fiscalSeen.add([source.codigo_sap,source.centro,source.almacen,source.lote,source.ubicacion,source.stock].join('|'));
    });
    bookRow(mapa,'H',5+fiscalIndices.length);

    // INVENTARIO FISCAL: primera aparición y suma actual por llave de BASE MAESTRA.
    const inventario=makeView('INVENTARIO FISCAL',
      ['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','FECHA','STOCK','SALDO'],
      [18,13,14,17,21,16,12,16],'INVENTARIO FISCAL',
      'Los saldos se recalculan mediante SUMIF sobre la llave fiscal editable.');
    fiscalIndices.forEach((idx,j)=>{
      const rr=idx+6,br=j+6,source=data[idx],cond=baseRef+'$S'+rr+'=1';
      [['A',source.codigo_sap],['C',source.centro],['D',source.almacen],['G',source.lote],['E',source.ubicacion]]
        .forEach(([letter,value],k)=>copyIf(inventario,XLSX.utils.encode_col(k)+br,cond,letter+rr,value));
      fillDate(inventario,'F'+br,cond);
      copyIf(inventario,'G'+br,cond,'H'+rr,source.stock);
      put(inventario,'H'+br,'IF('+cond+',SUMIF('+fiscalKey+','+baseRef+'N'+rr+','+qtyRange+'),"")',
        data.filter(a=>[a.codigo_sap,a.centro,a.almacen,a.lote,a.ubicacion,a.stock].join('|')===
          [source.codigo_sap,source.centro,source.almacen,source.lote,source.ubicacion,source.stock].join('|'))
          .reduce((sum,x)=>sum+x.cantidad,0));
    });
    bookRow(inventario,'H',5+fiscalIndices.length);

    const report=makeView('ACTAS DE CONTEO',
      ['GRUPO ACTA','NRO PLANILLA','REGISTROS','UNIDADES','SERIALIZADOS','HOJA ACTA'],
      [62,18,15,15,18,22],'ACTAS DE CONTEO',
      'Una planilla por Segmento + Almacén + Anotación; las clasificaciones ausentes son CERTIFICADO.');
    groups.keys.forEach((key,i)=>{
      const r=i+6;
      report['A'+r]={t:'s',v:key};
      formula(report,'B'+r,'IFERROR(VLOOKUP(A'+r+',PLANILLAS!$A$6:$B$'+(5+groups.keys.length)+',2,FALSE),"")');
      formula(report,'C'+r,'COUNTIF('+groupRange+',A'+r+')');
      formula(report,'D'+r,'SUMIF('+groupRange+',A'+r+','+qtyRange+')');
      formula(report,'E'+r,'COUNTIFS('+groupRange+',A'+r+','+serialFlag+',1)');
      report['F'+r]={t:'s',v:'ACTA_'+String(i+1).padStart(3,'0')};
    });
    bookRow(report,'F',5+groups.keys.length);

    // ACTAS: todas las líneas originales del grupo tienen una plaza.
    // Marcador R deduplica por SAP + ubicación + lote + grupo; una corrección
    // de lote en una línea antes duplicada crea una nueva línea visible.
    groups.keys.forEach((key,gi)=>{
      const short=String(gi+1).padStart(3,'0');
      const positions=data.map((x,i)=>({x,i})).filter(({x})=>{
        const annotation=(groups.annotations.get(x.codigo_sap)||'CERTIFICADO').toUpperCase();
        return [x.segmento,x.almacen,annotation].join('|')===key;
      });
      const sorted=partitionUnique(positions.map(({x,i})=>({
        i,key:[key,x.codigo_sap,x.ubicacion,x.lote].join('|')
      })));
      const a=makeView('ACTA_'+short,
        ['CODIGO SAP','DESCRIPCION','UBICACION','LOTE','CANTIDAD','OBSERVACION'],
        [18,47,22,17,16,23],'ACTA '+short+' · '+key,
        'Conteo dinámico por Grupo. Ajusta solamente BASE MAESTRA.');
      a['B3']={t:'s',v:key};
      sorted.forEach((idx,j)=>{
        const rr=idx+6,br=j+6,x=data[idx],cond='AND('+baseRef+'$M'+rr+'=$B$3,'+baseRef+'$R'+rr+'=1)';
        [['A',x.codigo_sap],['B',x.descripcion],['E',x.ubicacion],['G',x.lote]].forEach(([column,val],k)=>
          copyIf(a,XLSX.utils.encode_col(k)+br,cond,column+rr,val));
        put(a,'E'+br,'IF('+cond+',SUMIF('+baseRef+'$Q$6:$Q$'+last+','+baseRef+'Q'+rr+','+qtyRange+'),"")',x.cantidad);
        copyIf(a,'F'+br,cond,'F'+rr,x.segmento);
      });
      bookRow(a,'F',5+sorted.length);
      const serialized=positions.filter(({x})=>x.serializado).map(({i})=>i);
      const sr=makeView('SER_'+short,
        ['CODIGO SAP','DESCRIPCION','CANTIDAD','SERIAL','LOTE','UBICACION','OBSERVACIONES'],
        [18,47,12,28,17,22,25],'SERIALIZADOS '+short+' · '+key,
        'Solo serializados del Acta. Cambios de grupo: usar REGENERAR en SIGLO.');
      sr['B3']={t:'s',v:key};
      serialized.forEach((idx,j)=>{
        const rr=idx+6,br=j+6,x=data[idx],cond=baseRef+'$M'+rr+'=$B$3';
        [['A',x.codigo_sap],['B',x.descripcion],['I',x.cantidad],['J',x.serial],
          ['G',x.lote],['E',x.ubicacion],['F',x.segmento]]
          .forEach(([col,val],k)=>copyIf(sr,XLSX.utils.encode_col(k)+br,cond,col+rr,val));
      });
      bookRow(sr,'G',5+serialized.length);
    });

    // MODELO ESTRUCTURA: llave incluye la planilla asignada.
    const me=makeView('MODELO ESTRUCTURA',
      ['CODIGO SAP','CENTRO','ALMACEN','LOTE','UBICACION','FECHA','TIPO DE STOCK','NUMERO PLANILLA','CONTEO1','CONTEO2'],
      [18,13,14,17,22,16,16,19,15,15],
      'MODELO ESTRUCTURA','Estructura dinámica agrupada por Planilla + llave fiscal editable.');
    modelIndices.forEach((idx,j)=>{
      const rr=idx+6,br=j+6,x=data[idx],cond=baseRef+'$T'+rr+'=1';
      [['A',x.codigo_sap],['C',x.centro],['D',x.almacen],['G',x.lote],['E',x.ubicacion]]
       .forEach(([col,val],k)=>copyIf(me,XLSX.utils.encode_col(k)+br,cond,col+rr,val));
      fillDate(me,'F'+br,cond);
      copyIf(me,'G'+br,cond,'H'+rr,x.stock);
      copyIf(me,'H'+br,cond,'P'+rr,'');
      const amount='IF('+cond+',SUMIF('+modelKey+','+baseRef+'O'+rr+','+qtyRange+'),"")';
      put(me,'I'+br,amount,x.cantidad);
      put(me,'J'+br,amount,x.cantidad);
    });
    bookRow(me,'J',5+modelIndices.length);

    const ms=makeView('MODELO SERIALIZADOS',
      ['CODIGO SAP','DESCRIPCION','SERIAL','CANTIDAD','LOTE','UBICACION','TIPO STOCK','SERIAL RR','ESTADO RR','NRO PLANILLA'],
      [18,47,27,13,18,21,16,27,15,19],
      'MODELO SERIALIZADOS','Anexo serializado dinámico vinculado a BASE MAESTRA.');
    data.forEach((x,idx)=>{
      if(!x.serializado)return;
      const rr=idx+6,br=5+data.slice(0,idx+1).filter(y=>y.serializado).length;
      const cond=baseRef+'$M'+rr+'<>""';
      [['A',x.codigo_sap],['B',x.descripcion],['J',x.serial],['I',x.cantidad],['G',x.lote],
        ['E',x.ubicacion],['H',x.stock],['J',x.serial]]
        .forEach(([col,val],k)=>copyIf(ms,XLSX.utils.encode_col(k)+br,cond,col+rr,val));
      put(ms,'I'+br,'IF('+cond+',IF('+baseRef+'E'+rr+'="QMINTIC","","E272"),"")',
        x.ubicacion==='QMINTIC'?'':'E272');
      copyIf(ms,'J'+br,cond,'P'+rr,'');
    });
    bookRow(ms,'J',5+data.filter(x=>x.serializado).length);

    // El libro se construye con IF, VLOOKUP, COUNTIF y SUMIF:
    // no contiene fórmulas matriciales que Excel pueda eliminar al repararlo.
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
