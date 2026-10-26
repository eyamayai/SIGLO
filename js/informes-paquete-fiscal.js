document.addEventListener('DOMContentLoaded', () => {
  const supabase=window.sigloSupabase;
  const XLSX=window.XLSX;
  const fileInput=document.getElementById('paqueteMatriz');
  const editedInput=document.getElementById('paqueteEditado');
  const generate=document.getElementById('paqueteGenerar');
  const rebuild=document.getElementById('paqueteRegenerar');
  const status=document.getElementById('paqueteEstado');
  const stats=document.getElementById('paqueteEstadisticas');
  const macroFile=document.getElementById('paquetePlantillaMacros');
  const macroActivate=document.getElementById('paqueteActivarMacros');
  const macroStatus=document.getElementById('paqueteMacrosEstado');
  const macroEngine=window.SIGLOPaqueteMacro;
  function syncMacroStatus(){
    const ready=Boolean(macroEngine?.active());
    macroStatus.textContent=ready
      ? 'Automatización VBA activa en este navegador. Las descargas serán .xlsm con el botón ACTUALIZAR INFORMES.'
      : 'VBA sin activar. Las descargas continuarán en .xlsx hasta seleccionar tu plantilla validada.';
    macroStatus.className='report-message'+(ready?' success':'');
    generate.textContent=ready?'Consultar SIGLO y descargar .xlsm':'Consultar SIGLO y descargar .xlsx';
    rebuild.textContent=ready?'Regenerar y descargar .xlsm':'Regenerar y descargar .xlsx';
  }
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
    const names=[...workbook.SheetNames].sort((a,b)=>{
      const rank=name=>{
        const n=norm(name);
        return n==='DISTRIBUCION'?0:(n==='CODIGOS A CONTAR'?1:2);
      };
      return rank(a)-rank(b);
    });
    let selected=null;
    for(const name of names){
      const sheet=workbook.Sheets[name];
      if(!sheet)continue;
      const data=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
      if(!data.length)continue;
      const cols=Object.keys(data[0]);
      const col=key=>cols.find(c=>norm(c)===key);
      const a=col('CODIGO SAP')||col('CODIGO')||col('SAP');
      const b=col('DESCRIPCION');
      const c=col('ANOTACION')||col('OBSERVACION');
      if(a&&b&&c){selected={data,a,b,c};break;}
    }
    if(!selected)throw Error(
      'No se encontró una hoja con CÓDIGO SAP, DESCRIPCIÓN y ANOTACIÓN. Hojas revisadas: '+names.join(', ')+'.'
    );
    const map=new Map();
    for(const row of selected.data){
      const code=sap(row[selected.a]);
      if(!code)continue;
      const annotation=norm(row[selected.c]);
      if(!annotation)throw Error('Falta ANOTACIÓN para el código '+code+'.');
      const before=map.get(code);
      if(before&&norm(before.anotacion)!==annotation)
        throw Error('El SAP '+code+' tiene anotaciones contradictorias en la matriz del Cliente.');
      if(!before)map.set(code,{
        codigo_sap:code,descripcion:clean(row[selected.b]),anotacion:clean(row[selected.c])
      });
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
  const DEFAULT_CLASS='Conteo Aliado';
  const defaultGroupLabel='CONTEO ALIADO';
  // Inversa se separa de Libre, pero conserva la anotación de Claro.
  // Libre: Segmento + Almacén + Anotación; Inversa: Almacén + Anotación.
  const groupKeyFor=(item,annotations)=>{
    const label=annotations.get(item.codigo_sap);
    const annotation=label?clean(label).toUpperCase():defaultGroupLabel;
    const segment=Number(item.stock)===4?'INVERSA':item.segmento;
    return [segment,item.almacen,annotation].join('|');
  };
  function groupsFor(data,matrix){
    const annotations=new Map(matrix.map(x=>[x.codigo_sap,x.anotacion]));
    const active=new Map();
    for(const item of data){
      const key=groupKeyFor(item,annotations);
      active.set(key,(active.get(key)||0)+1);
    }
    const keys=[...active.keys()].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
    if(keys.length>120)throw Error('Demasiadas combinaciones potenciales de Actas ('+keys.length+').');
    return {keys,active,annotations};
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
  async function exportWorkbook(dataIn,matrixIn,fileName){
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
      ['Edición','Modifica solo columnas A:K de BASE MAESTRA. No sobrescribas las fórmulas de L:X.'],
      ['Recalcular','Excel de escritorio: Fórmulas > Opciones para el cálculo > Automático.'],
      ['Actualización','Los informes dependen de fórmulas dinámicas, se recalculan al editar BASE MAESTRA.'],
      ['Actas','Las filas de cada ACTA y SER se compactan al cambiar BASE MAESTRA. Un grupo completamente nuevo exige regenerar el paquete.'],
      ['Grupo nuevo','Si agregas un nuevo almacén, segmento o anotación, vuelve a SIGLO y usa REGENERAR DESDE EXCEL.'],
      ['Preliminar Cliente','No se modifica ninguna información original del Cliente.'],
      ['Matriz','La matriz conserva anotaciones de Claro. SAP ausente = Conteo Aliado; Inversa (stock 4) se separa por almacén y anotación.'],
      ['Histórico','Guarda una copia independiente cuando el inventario sea firmado o entregado.'],
      ['Versión','Fórmulas estándar de Excel de escritorio, sin funciones matriciales dinámicas ni macros VBA.'],
      ['Fecha exportación',today()]
    ],[34,110]);
    guide['!rows']=[{hpt:28}];
    const matr=polished(book,'MATRIZ',titleRows('MATRIZ DEL CLIENTE','Fuente de clasificación para Actas y Modelo','No cambiar las anotaciones de Claro sin validación.'),5,matrix.map(x=>[x.codigo_sap,x.descripcion,x.anotacion]),['CODIGO SAP','DESCRIPCION','ANOTACION'],[19,58,38]);
    const masterData=data.map(x=>[x.codigo_sap,x.descripcion,x.centro,x.almacen,x.ubicacion,x.segmento,x.lote,x.stock,x.cantidad,x.serial,x.serializado,null,null,null,null,null]);
    const base=polished(book,'BASE MAESTRA',titleRows('BASE MAESTRA EDITABLE','Cambios exclusivos de este Excel. Columnas A:K editables.','Columnas L:X calculadas. Para retirar una existencia poner CANTIDAD=0.'),5,masterData,headers,[18,45,12,14,19,22,18,11,13,27,14,30,45,65,76,19]);
    for(let index=0;index<data.length+1000;index++){
      const r=index+6;
      // Fórmulas adicionales hasta mil registros para permitir ampliar la base sin perder cálculos.
      formula(base,'L'+r,'IF(A'+r+'="","",IFERROR(VLOOKUP(A'+r+',MATRIZ!$A$6:$C$'+matrixLimit+',3,FALSE),"' + DEFAULT_CLASS + '"))');
      formula(base,'M'+r,'IF(OR(A'+r+'="",I'+r+'<=0),"",IF(H'+r+'=4,"INVERSA",F'+r+')&"|"&D'+r+'&"|"&UPPER(L'+r+'))');
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
    const fiscalTotals=new Map(),actaTotals=new Map(),modelTotals=new Map();
    data.forEach(d=>{
      const fiscal=[d.codigo_sap,d.centro,d.almacen,d.lote,d.ubicacion,d.stock].join('|');
      fiscalTotals.set(fiscal,(fiscalTotals.get(fiscal)||0)+d.cantidad);
      const group=groupKeyFor(d,groups.annotations);
      const acta=[group,d.codigo_sap,d.ubicacion,d.lote].join('|');
      actaTotals.set(acta,(actaTotals.get(acta)||0)+d.cantidad);
      const model=[groups.keys.indexOf(group)+1,fiscal].join('|');
      modelTotals.set(model,(modelTotals.get(model)||0)+d.cantidad);
    });
    const fiscalRaw=data.map((d,i)=>({
      i,key:[d.codigo_sap,d.centro,d.almacen,d.lote,d.ubicacion,d.stock].join('|')
    }));
    const modelRaw=data.map((d,i)=>({
      i,key:[groups.keys.indexOf(groupKeyFor(d,groups.annotations))+1,
        d.codigo_sap,d.centro,d.almacen,d.lote,d.ubicacion,d.stock].join('|')
    }));
    const partitionUnique=(entries)=>{const seen=new Set(),a=[],b=[];
      entries.forEach(item=>{if(seen.has(item.key))b.push(item.i);else{seen.add(item.key);a.push(item.i)}});
      return a.concat(b);
    };
    const fiscalIndices=partitionUnique(fiscalRaw);
    const modelIndices=partitionUnique(modelRaw);
    const flags=items=>{const seen=new Set(),out=new Map();items.forEach(({i,key})=>{
      out.set(i,!seen.has(key));seen.add(key);
    });return out;};
    const initialFiscal=flags(fiscalRaw),initialModel=flags(modelRaw);
    const actaRaw=data.map((d,i)=>{
      return {i,key:[groupKeyFor(d,groups.annotations),d.codigo_sap,d.ubicacion,d.lote].join('|')};
    });
    const initialActa=flags(actaRaw);
    // Columnas auxiliares: Q clave de Acta; R/S/T marcadores de primera
    // aparición de Acta, llave Fiscal y llave Modelo, respectivamente.
    base['Q5']={t:'s',v:'CLAVE ACTA'};
    base['R5']={t:'s',v:'PRIMERA ACTA'};
    base['S5']={t:'s',v:'PRIMERA FISCAL'};
    base['T5']={t:'s',v:'PRIMERA MODELO'};
    // Numeración consecutiva por grupo y claves de búsqueda para compactar
    // ACTAS y anexos SER sin fórmulas matriciales ni huecos intermedios.
    base['U5']={t:'s',v:'NRO FILA ACTA'};
    base['V5']={t:'s',v:'BUSQUEDA ACTA'};
    base['W5']={t:'s',v:'NRO FILA SERIAL'};
    base['X5']={t:'s',v:'BUSQUEDA SERIAL'};
    for(let index=0;index<data.length+1000;index++){
      const rr=index+6;
      formula(base,'Q'+rr,'IF(M'+rr+'="","",M'+rr+'&"|"&A'+rr+'&"|"&E'+rr+'&"|"&G'+rr+')');
      formula(base,'R'+rr,'IF(Q'+rr+'="","",IF(COUNTIF($Q$6:Q'+rr+',Q'+rr+')=1,1,0))');
      formula(base,'S'+rr,'IF(N'+rr+'="","",IF(COUNTIF($N$6:N'+rr+',N'+rr+')=1,1,0))');
      formula(base,'T'+rr,'IF(O'+rr+'="","",IF(COUNTIF($O$6:O'+rr+',O'+rr+')=1,1,0))');
      formula(base,'U'+rr,'IF(AND(M'+rr+'<>"",R'+rr+'=1),COUNTIFS($M$6:M'+rr+',M'+rr+',$R$6:R'+rr+',1),"")');
      formula(base,'V'+rr,'IF(U'+rr+'="","",M'+rr+'&"|"&U'+rr+')');
      formula(base,'W'+rr,'IF(AND(M'+rr+'<>"",K'+rr+'=1),COUNTIFS($M$6:M'+rr+',M'+rr+',$K$6:K'+rr+',1),"")');
      formula(base,'X'+rr,'IF(W'+rr+'="","",M'+rr+'&"|"&W'+rr+')');
    }
    base['!cols']=base['!cols'].concat([{wch:85},{wch:16},{wch:18},{wch:18},
      {wch:16},{wch:85},{wch:16},{wch:85}]);
    base['!ref']='A1:X'+rowsLimit;
    const makeView=(name,head,widths,heading,desc)=>{
      return sheetNamed(book,name,head,widths,heading,desc);
    };
    const initialVisibility=form=>{
      const match=String(form).match(/\$([RST])(\d+)=1/);
      if(!match)return true;
      const index=Number(match[2])-6;
      if(match[1]==='S')return initialFiscal.get(index)!==false;
      if(match[1]==='T')return initialModel.get(index)!==false;
      return initialActa.get(index)!==false;
    };
    const put=(ws,address,form,value)=>{
      const visible=initialVisibility(form);
      const cached=visible?(value==null?'':value):'';
      ws[address]={t:typeof cached==='number'?'n':'s',f:form,v:cached};
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
        fiscalTotals.get([source.codigo_sap,source.centro,source.almacen,source.lote,source.ubicacion,source.stock].join('|'))||0);
    });
    bookRow(inventario,'H',5+fiscalIndices.length);

    const report=makeView('ACTAS DE CONTEO',
      ['GRUPO ACTA','NRO PLANILLA','REGISTROS','UNIDADES','SERIALIZADOS','HOJA ACTA'],
      [62,18,15,15,18,22],'ACTAS DE CONTEO',
      'Libre: Segmento + Almacén + Anotación. Inversa: Almacén + Anotación. SAP ausente: CONTEO ALIADO.');
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

    // ACTAS compactas: una columna auxiliar identifica el n-ésimo registro
    // VIGENTE del grupo. Cambiar lote/almacén reordena las filas visibles,
    // incluso si una fila original desaparece o cambia de grupo.
    groups.keys.forEach((key,gi)=>{
      const short=String(gi+1).padStart(3,'0');
      const positions=data.map((x,i)=>({x,i})).filter(({x})=>{
        return groupKeyFor(x,groups.annotations)===key;
      });
      // En las actas se consolida por SAP + ubicación + lote dentro del grupo.
      const seen=new Set();
      const unique=positions.filter(({x})=>{
        const k=[key,x.codigo_sap,x.ubicacion,x.lote].join('|');
        if(seen.has(k))return false;
        seen.add(k);return true;
      });
      // Reservar capacidad para cambios de clasificación entre actas existentes.
      // Si surge un grupo nuevo sigue disponible "Regenerar" sin escribir en SIGLO.
      const actRows=Math.min(rowsLimit-5,Math.max(unique.length+40,Math.ceil(unique.length*1.2)));
      const a=makeView('ACTA_'+short,
        ['CODIGO SAP','DESCRIPCION','UBICACION','LOTE','CANTIDAD','OBSERVACION'],
        [18,47,22,17,16,23],
        'ACTA '+short+' · '+key,
        'Filas compactas: cambia BASE MAESTRA y las líneas se reacomodan sin espacios.');
      a['B3']={t:'s',v:key};
      a['G5']={t:'s',v:'INDICE BASE'};
      a['!cols'].push({wch:14,hidden:true});
      for(let j=0;j<actRows;j++){
        const br=j+6;
        const item=unique[j]||null;
        // MATCH recupera la fila cuya clave coincide con el orden 1, 2, 3…
        const finder='IFERROR(MATCH($B$3&"|"&'+(j+1)+','+baseRef+'$V$6:$V$'+last+',0),"")';
        put(a,'G'+br,finder,item?item.i+1:'');
        const idx='$G'+br;
        const col=(letter,initial)=>{
          const range=baseRef+'$'+letter+'$6:$'+letter+'$'+last;
          return {expr:'IF('+idx+'="","",INDEX('+range+','+idx+'))',value:initial};
        };
        const fields=[
          col('A',item?.x.codigo_sap||''),col('B',item?.x.descripcion||''),
          col('E',item?.x.ubicacion||''),col('G',item?.x.lote||''),
          {expr:'IF('+idx+'="","",SUMIF('+baseRef+'$Q$6:$Q$'+last+
            ',INDEX('+baseRef+'$Q$6:$Q$'+last+','+idx+'),'+qtyRange+'))',
           value:item?(actaTotals.get([key,item.x.codigo_sap,item.x.ubicacion,item.x.lote].join('|'))||0):''},
          col('F',item?.x.segmento||'')
        ];
        fields.forEach((field,k)=>put(a,XLSX.utils.encode_col(k)+br,field.expr,field.value));
      }
      bookRow(a,'G',5+actRows);

      const serialized=positions.filter(({x})=>x.serializado);
      const serRows=Math.min(rowsLimit-5,
        Math.max(serialized.length+30,Math.ceil(serialized.length*1.2)));
      const sr=makeView('SER_'+short,
        ['CODIGO SAP','DESCRIPCION','CANTIDAD','SERIAL','LOTE','UBICACION','OBSERVACIONES'],
        [18,47,12,28,17,22,25],
        'SERIALIZADOS '+short+' · '+key,
        'Anexo compacto con seriales del grupo actual. Regenerar si nace un grupo nuevo.');
      sr['B3']={t:'s',v:key};
      sr['H5']={t:'s',v:'INDICE BASE'};
      sr['!cols'].push({wch:14,hidden:true});
      for(let j=0;j<serRows;j++){
        const br=j+6,item=serialized[j]||null;
        put(sr,'H'+br,'IFERROR(MATCH($B$3&"|"&'+(j+1)+','+
          baseRef+'$X$6:$X$'+last+',0),"")',item?item.i+1:'');
        const idx='$H'+br;
        const cols=['A','B','I','J','G','E','F'];
        const vals=item?[
          item.x.codigo_sap,item.x.descripcion,item.x.cantidad,item.x.serial,
          item.x.lote,item.x.ubicacion,item.x.segmento
        ]:['','','','','','',''];
        cols.forEach((source,k)=>put(sr,XLSX.utils.encode_col(k)+br,
          'IF('+idx+'="","",INDEX('+baseRef+'$'+source+'$6:$'+source+'$'+last+
          ','+idx+'))',vals[k]));
      }
      bookRow(sr,'H',5+serRows);
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
      const initialModel=[groups.keys.indexOf(groupKeyFor(x,groups.annotations))+1,
        [x.codigo_sap,x.centro,x.almacen,x.lote,x.ubicacion,x.stock].join('|')].join('|');
      const modelTotal=modelTotals.get(initialModel)||0;
      put(me,'I'+br,amount,modelTotal);
      put(me,'J'+br,amount,modelTotal);
    });
    bookRow(me,'J',5+modelIndices.length);

    const ms=makeView('MODELO SERIALIZADOS',
      ['CODIGO SAP','DESCRIPCION','SERIAL','CANTIDAD','LOTE','UBICACION','TIPO STOCK','SERIAL RR','ESTADO RR','NRO PLANILLA'],
      [18,47,27,13,18,21,16,27,15,19],
      'MODELO SERIALIZADOS','Anexo serializado dinámico vinculado a BASE MAESTRA.');
    let countSerial=0;
    data.forEach((x,idx)=>{
      if(!x.serializado)return;
      countSerial++;
      const rr=idx+6,br=5+countSerial;
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
    const downloadName=fileName||'SIGLO_Paquete_Fiscal_Dinamico_'+today()+'.xlsx';
    const macroEnabled=Boolean(macroEngine?.active());
    if(macroEnabled){
      await macroEngine.download(book,downloadName);
    }else{
      XLSX.writeFile(book,downloadName,{compression:true,bookType:'xlsx'});
    }
    return {format:macroEnabled?'xlsm':'xlsx',records:data.length,groups:groups.keys.length,activeGroups:groups.active.size,
      serials:data.filter(x=>x.serializado).length,
      autoAllied:[...new Set(data.filter(x=>!groups.annotations.has(x.codigo_sap)).map(x=>x.codigo_sap))].length};
  }

  syncMacroStatus();
  if(macroFile&&macroActivate){
    macroFile.addEventListener('change',()=>{
      macroActivate.disabled=!macroFile.files?.length;
    });
    macroActivate.addEventListener('click',async()=>{
      const file=macroFile.files?.[0];
      if(!file)return;
      macroActivate.disabled=true;
      macroStatus.textContent='Validando el VBA y el botón ACTUALIZAR INFORMES…';
      try{
        const info=await macroEngine.install(file);
        syncMacroStatus();
        notify('Macros activadas correctamente ('+info.size+' bytes de proyecto VBA). Ya puedes descargar .xlsm.','success');
      }catch(err){
        console.error('VBA local',err);
        macroStatus.textContent=err.message||'No se pudo registrar la plantilla VBA.';
        macroStatus.className='report-message error';
      }finally{
        macroActivate.disabled=!macroFile.files?.length;
      }
    });
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
      const out=await exportWorkbook(data,matrix);
      stats.innerHTML='<strong>'+out.records+'</strong> registros · <strong>'+out.activeGroups+'</strong> actas con inventario · <strong>'+out.serials+'</strong> seriales · <strong>'+out.autoAllied+'</strong> SAP clasificados como Conteo Aliado.';
      notify('Paquete '+out.format+' generado. BASE MAESTRA puede corregirse sin cambiar SIGLO.','success');
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
      const out=await exportWorkbook(data,matrix,'SIGLO_Paquete_Fiscal_Reorganizado_'+today()+'.xlsx');
      stats.innerHTML='<strong>'+out.records+'</strong> registros · <strong>'+out.activeGroups+'</strong> actas con inventario · <strong>'+out.serials+'</strong> seriales.';
      notify('Paquete '+out.format+' regenerado desde el Excel, sin leer ni modificar la base de datos de SIGLO.','success');
    }catch(err){console.error(err);notify(err.message||'No se pudo regenerar el archivo.','error');}
    finally{rebuild.disabled=false;}
  });
});
