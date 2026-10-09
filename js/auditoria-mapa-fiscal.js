document.addEventListener('DOMContentLoaded',()=>{
  const A=window.SigloAudit;
  const supabase=window.sigloSupabase;
  const excelInput=document.getElementById('excelInput');
  const fileName=document.getElementById('fileName');
  const processBtn=document.getElementById('processBtn');
  const message=document.getElementById('auditMessage');
  const resultSection=document.getElementById('resultSection');
  const historyList=document.getElementById('historyList');
  const historyCount=document.getElementById('historyCount');
  const resultHead=document.getElementById('resultHead');
  const resultBody=document.getElementById('resultBody');
  const resultFilter=document.getElementById('resultFilter');
  const resultSearch=document.getElementById('resultSearch');
  const visibleCount=document.getElementById('visibleCount');
  const tableNotice=document.getElementById('tableNotice');
  const exportBtn=document.getElementById('exportBtn');

  let currentFile=null;
  let currentAudit=null;
  let history=[];
  let activeView='seriales';
  const MAX_RENDER=500;

  const text=value=>String(value??'').trim();
  const upper=value=>text(value).toUpperCase();
  const code=value=>text(value).replace(/\.0+$/,'');
  const CLIENT_SERIAL_TRIM_SAPS=new Set(['4023065','4034050','4038682','4051593']);
  const clientSerial=(codigoSap,serial)=>{
    const c=code(codigoSap);
    const value=upper(serial);
    if(c==='4050259'){
      const base=value.length>8 ? value.slice(-9,-1) : value;
      return base.replace(/^0+/,'');
    }
    return CLIENT_SERIAL_TRIM_SAPS.has(c) && value.startsWith('00') ? value.slice(2) : value;
  };
  const clientSerialList=(codigoSap,value)=>String(value||'').split(',').map(item=>item.trim()).filter(Boolean).map(item=>clientSerial(codigoSap,item)).join(', ');
  const fmt=value=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(Number(value||0));
  const pct=value=>Number(value||0).toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
  const dateTime=value=>{
    if(!value)return '—';
    const d=new Date(value);
    return Number.isNaN(d.getTime())?text(value):new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(d);
  };
  const fileDate=()=>{
    const d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  };
  const setMessage=(value='',type='')=>{
    message.textContent=value;
    message.className='audit-message'+(type?' '+type:'');
  };
  const normalizeHeader=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();

  function sheetRows(wb,sheetName,aliases,raw){
    const ws=wb.Sheets[sheetName];
    if(!ws) throw new Error('No se encontró la hoja '+sheetName+'.');
    const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw});
    if(!rows.length) return [];
    const available=Object.keys(rows[0]).reduce((acc,key)=>{acc[normalizeHeader(key)]=key;return acc;},{});
    const resolved={};
    Object.entries(aliases).forEach(([field,names])=>{
      const match=names.map(normalizeHeader).find(name=>available[name]);
      if(!match) throw new Error('Falta la columna '+names[0]+' en la hoja '+sheetName+'.');
      resolved[field]=available[match];
    });
    return rows.map((row,index)=>{
      const out={_row:index+2};
      Object.entries(resolved).forEach(([field,col])=>{out[field]=row[col];});
      return out;
    });
  }

  function addQty(map,row,tipo,cantidad){
    const n=Number(cantidad||0);
    if(!Number.isFinite(n)||n<=0)return;
    const key=[code(row.codigo_sap),upper(row.centro),upper(row.almacen),upper(row.lote),tipo].join('|');
    const existing=map.get(key)||{
      codigo_sap:code(row.codigo_sap),centro:upper(row.centro),almacen:upper(row.almacen),
      lote:upper(row.lote),tipo:tipo,cantidad:0,descripcion:text(row.descripcion)
    };
    existing.cantidad+=n;
    if(!existing.descripcion) existing.descripcion=text(row.descripcion);
    map.set(key,existing);
  }

  async function parsePreliminar(file){
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:'array',cellDates:false});

    const summaryRows=sheetRows(wb,'NO SERIALIZADO',{
      codigo_sap:['MATERIAL','CODIGO SAP','CÓDIGO SAP'],
      descripcion:['TEXTO BREVE DE MATERIAL','DESCRIPCION','DESCRIPCIÓN'],
      centro:['CE.','CENTRO'],
      almacen:['ALM.','ALMACEN','ALMACÉN'],
      lote:['LOTE'],
      libre:['LIBRE'],
      inversa:['INVERSA'],
      perfil:['PERFIL DE SERIE','TOPOLOGIA','TOPOLOGÍA']
    },true);

    const qtyMap=new Map();
    const controlMap=new Map();

    summaryRows.forEach(row=>{
      if(!code(row.codigo_sap)) return;
      const perfil=upper(row.perfil);
      if(!['CON PERFIL DE SERIE','SIN PERFIL DE SERIE'].includes(perfil)){
        throw new Error('Fila '+row._row+' de NO SERIALIZADO: Perfil de serie no reconocido.');
      }
      const target=perfil==='SIN PERFIL DE SERIE'?qtyMap:controlMap;
      addQty(target,row,'LIBRE',row.libre);
      addQty(target,row,'INVERSA',row.inversa);
    });

    const serialRows=sheetRows(wb,'SERIALIZADO',{
      serial:['NUMERO DE SERIE','NÚMERO DE SERIE'],
      codigo_sap:['MATERIAL','CODIGO SAP','CÓDIGO SAP'],
      descripcion:['TEXTO BREVE DE MATERIAL','DESCRIPCION','DESCRIPCIÓN'],
      centro:['CE.','CENTRO'],
      almacen:['ALM.','ALMACEN','ALMACÉN'],
      lote:['LOTE'],
      sa:['SA']
    },false);

    const seriales=[];
    const seen=new Set();
    for(const row of serialRows){
      const codigoSap=code(row.codigo_sap);
      const serial=clientSerial(codigoSap,row.serial);
      if(!serial) continue;
      if(seen.has(serial)) throw new Error('El serial '+serial+' está duplicado en la hoja SERIALIZADO.');
      seen.add(serial);

      const sa=text(row.sa).replace(/\.0+$/,'');
      const tipo=sa==='1'?'LIBRE':(sa==='4'?'INVERSA':'');
      if(!tipo) throw new Error('Fila '+row._row+' de SERIALIZADO: SA debe ser 1 (Libre) o 4 (Inversa).');
      if(!code(row.codigo_sap)||!text(row.centro)||!text(row.almacen)||!text(row.lote)){
        throw new Error('Fila '+row._row+' de SERIALIZADO: faltan datos obligatorios.');
      }

      seriales.push({
        serial:serial,
        codigo_sap:codigoSap,
        centro:upper(row.centro),
        almacen:upper(row.almacen),
        lote:upper(row.lote),
        tipo:tipo,
        descripcion:text(row.descripcion)
      });
    }

    const cantidades=[...qtyMap.values()];
    const control_serializados=[...controlMap.values()].map(item=>({
      codigo_sap:item.codigo_sap,centro:item.centro,almacen:item.almacen,lote:item.lote,tipo:item.tipo,cantidad:item.cantidad
    }));

    if(!seriales.length&&!cantidades.length) throw new Error('El preliminar no contiene inventario para comparar.');

    return {nombre_archivo:file.name,seriales,cantidades,control_serializados};
  }

  function resultPill(value){
    const v=upper(value);
    const label=v==='COLISION_SIGLO'?'COLISIÓN SIGLO':v;
    return '<span class="mf-result-pill '+v.toLowerCase()+'">'+A.escapeHtml(label||'—')+'</span>';
  }

  function renderSummary(){
    const r=currentAudit?.resumen||{};
    document.getElementById('kpiGeneral').textContent=pct(r.porcentaje_acierto);
    document.getElementById('kpiSerialPct').textContent=pct(r.porcentaje_serial);
    document.getElementById('kpiQtyPct').textContent=pct(r.porcentaje_no_serial);
    document.getElementById('kpiInconsistencies').textContent=r.inconsistencias_siglo||0;
    document.getElementById('kpiClientControl').textContent=r.control_cliente||0;
    document.getElementById('kpiSerialCollisions').textContent=r.serial_colision_siglo||0;
    document.getElementById('kpiSerialInfo').textContent=(r.serial_conciliado||0)+' conciliados de '+(r.seriales_cliente||0)+' del Cliente';
    document.getElementById('kpiQtyInfo').textContent=(r.qty_conciliado||0)+' conciliadas de '+(r.qty_claves_total||0)+' llaves';
    document.getElementById('resultMeta').textContent=(currentAudit.nombre_archivo||'Auditoría')+' · '+dateTime(currentAudit.creado_en)+' · '+(currentAudit.creado_por_nombre||'SIGLO');
    resultSection.hidden=false;
  }

  const viewConfig={
    seriales:{
      headers:['Resultado','Cantidad seriales','SAP Cliente','SAP SIGLO','Lote Cliente','Lote SIGLO','Tipo Cliente','Tipo SIGLO','Ubicación SIGLO','Estado SIGLO','Seriales','Detalle'],
      rows:audit=>audit.seriales||[],
      values:r=>[
        resultPill(r.resultado),fmt(r.cantidad_seriales),r.cliente_codigo_sap||'—',r.siglo_codigo_sap||'—',
        r.cliente_lote||'—',r.siglo_lote||'—',r.cliente_tipo||'—',r.siglo_tipo||'—',
        r.ubicacion||'—',[r.tipo_siglo,r.estado,r.estado_inventario].filter(Boolean).join(' / ')||'—',
        clientSerialList(r.cliente_codigo_sap||r.siglo_codigo_sap,r.seriales),r.detalle||''
      ],
      classes:['','','','','','','','','','','serials-cell','detail-cell']
    },
    cantidades:{
      headers:['Resultado','Código SAP','Centro','Almacén','Lote','Tipo','Cliente','SIGLO','Diferencia','Descripción'],
      rows:audit=>audit.cantidades||[],
      values:r=>[resultPill(r.resultado),r.codigo_sap,r.centro,r.almacen,r.lote,r.tipo,fmt(r.cliente_cantidad),fmt(r.siglo_cantidad),fmt(r.diferencia),r.descripcion||''],
      classes:['','','','','','','','','','detail-cell']
    },
    inconsistencias_siglo:{
      headers:['Código SAP','Centro','Almacén','Lote','Segmento','Tipo','Ubicaciones distintas','Ubicaciones encontradas','Cantidad total'],
      rows:audit=>audit.inconsistencias_siglo||[],
      values:r=>[r.codigo_sap,r.centro,r.almacen,r.lote,r.segmento,r.tipo,r.ubicaciones_distintas,r.ubicaciones,fmt(r.cantidad_total)],
      classes:[]
    },
    control_cliente:{
      headers:['Código SAP','Centro','Almacén','Lote','Tipo','Resumen Cliente','Serializados Cliente','Diferencia','Observación'],
      rows:audit=>audit.control_cliente||[],
      values:r=>[r.codigo_sap,r.centro,r.almacen,r.lote,r.tipo,fmt(r.resumen_cliente),fmt(r.serializados_cliente),fmt(r.diferencia),r.observacion],
      classes:['','','','','','','','','detail-cell']
    }
  };

  function renderView(){
    if(!currentAudit)return;
    const cfg=viewConfig[activeView];
    const filter=upper(resultFilter.value);
    const q=upper(resultSearch.value);
    const all=cfg.rows(currentAudit);
    const filtered=all.filter(row=>{
      if(filter&&upper(row.resultado)!==filter)return false;
      if(q&&!upper(JSON.stringify(row)).includes(q))return false;
      return true;
    });
    const visible=filtered.slice(0,MAX_RENDER);

    resultHead.innerHTML='<tr>'+cfg.headers.map(h=>'<th>'+A.escapeHtml(h)+'</th>').join('')+'</tr>';
    resultBody.innerHTML=visible.length?visible.map(row=>{
      const vals=cfg.values(row);
      return '<tr>'+vals.map((value,index)=>{
        const cls=cfg.classes[index]?' class="'+cfg.classes[index]+'"':'';
        const html=index===0&&activeView!=='inconsistencias_siglo'&&activeView!=='control_cliente'?value:A.escapeHtml(value);
        return '<td'+cls+'>'+html+'</td>';
      }).join('')+'</tr>';
    }).join(''):'<tr class="empty-row"><td colspan="'+cfg.headers.length+'">No hay registros para este filtro.</td></tr>';

    visibleCount.textContent=filtered.length+' registro'+(filtered.length===1?'':'s');
    tableNotice.textContent=filtered.length>MAX_RENDER?'Se muestran los primeros '+MAX_RENDER+' registros. El Excel exporta el resultado completo.':'';
    resultFilter.disabled=activeView==='inconsistencias_siglo'||activeView==='control_cliente';
  }

  function renderAudit(audit){
    currentAudit=audit;
    renderSummary();
    resultFilter.value='';
    resultSearch.value='';
    activeView='seriales';
    document.querySelectorAll('.mf-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===activeView));
    renderView();
    resultSection.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function renderHistory(){
    historyCount.textContent=history.length+' auditoría'+(history.length===1?'':'s');
    if(!history.length){
      historyList.innerHTML='<div class="mf-history-empty">Aún no hay auditorías de Mapa Fiscal.</div>';
      return;
    }
    historyList.innerHTML=history.map((item,index)=>{
      const previous=history[index+1];
      const delta=previous?Number(item.porcentaje_acierto||0)-Number(previous.porcentaje_acierto||0):null;
      const deltaClass=delta===null?'flat':(delta>0.004?'up':(delta<-0.004?'down':'flat'));
      const deltaText=delta===null?'Primera referencia':((delta>0?'+':'')+delta.toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2})+' pts');
      return '<div class="mf-history-row">'+
        '<div class="mf-history-file"><strong>'+A.escapeHtml(item.nombre_archivo||'Auditoría')+'</strong><small>'+A.escapeHtml(dateTime(item.creado_en))+' · '+A.escapeHtml(item.creado_por_nombre||'SIGLO')+'</small></div>'+
        '<div class="mf-history-metric mf-history-main"><span>Acierto</span><strong>'+A.escapeHtml(pct(item.porcentaje_acierto))+'</strong><small class="mf-history-delta '+deltaClass+'">'+A.escapeHtml(deltaText)+'</small></div>'+
        '<div class="mf-history-metric"><span>Serial</span><strong>'+A.escapeHtml(pct(item.porcentaje_serial))+'</strong></div>'+
        '<div class="mf-history-metric"><span>No serial</span><strong>'+A.escapeHtml(pct(item.porcentaje_no_serial))+'</strong></div>'+
        '<button class="mf-open-btn" type="button" data-audit-id="'+item.id+'">Abrir</button>'+
      '</div>';
    }).join('');

    historyList.querySelectorAll('[data-audit-id]').forEach(btn=>btn.addEventListener('click',async()=>{
      btn.disabled=true;
      const old=btn.textContent;
      btn.textContent='Abriendo…';
      try{
        const {data,error}=await supabase.rpc('consultar_auditoria_mapa_fiscal',{p_id:Number(btn.dataset.auditId)});
        if(error)throw error;
        renderAudit(data);
        setMessage('Auditoría histórica cargada.','success');
      }catch(error){
        console.error(error);
        setMessage(error.message||'No fue posible abrir la auditoría.','error');
      }finally{
        btn.disabled=false;
        btn.textContent=old;
      }
    }));
  }

  async function loadHistory(){
    const {data,error}=await supabase.rpc('consultar_auditorias_mapa_fiscal');
    if(error)throw error;
    history=Array.isArray(data)?data:[];
    renderHistory();
  }

  function buildExport(){
    if(!currentAudit||!window.XLSX)return;
    const r=currentAudit.resumen||{};
    const wb=XLSX.utils.book_new();

    const summary=[
      ['SIGLO · CONCILIACIÓN MAPA FISCAL'],
      ['Archivo',currentAudit.nombre_archivo||''],
      ['Fecha auditoría',dateTime(currentAudit.creado_en)],
      ['Usuario',currentAudit.creado_por_nombre||''],
      [],
      ['INDICADOR','VALOR'],
      ['Acierto general',Number(r.porcentaje_acierto||0)/100],
      ['Acierto serializados',Number(r.porcentaje_serial||0)/100],
      ['Acierto no serializados',Number(r.porcentaje_no_serial||0)/100],
      ['Seriales Cliente',r.seriales_cliente||0],
      ['Seriales SIGLO fiscales',r.seriales_siglo_fiscales||0],
      ['Seriales conciliados',r.serial_conciliado||0],
      ['Seriales faltantes',r.serial_faltante||0],
      ['Seriales sobrantes',r.serial_sobrante||0],
      ['Seriales con diferencia',r.serial_diferencia||0],
      ['Seriales fuera del mapa',r.serial_fuera_mapa||0],
      ['Colisiones SIGLO',r.serial_colision_siglo||0],
      ['Llaves no serializadas',r.qty_claves_total||0],
      ['Llaves no serializadas conciliadas',r.qty_conciliado||0],
      ['Llaves faltantes',r.qty_faltante||0],
      ['Llaves sobrantes',r.qty_sobrante||0],
      ['Unidades Cliente',Number(r.unidades_cliente||0)],
      ['Unidades SIGLO',Number(r.unidades_siglo||0)],
      ['Unidades faltantes',Number(r.unidades_faltantes||0)],
      ['Unidades sobrantes',Number(r.unidades_sobrantes||0)],
      ['Inconsistencias SIGLO',r.inconsistencias_siglo||0],
      ['Controles Cliente',r.control_cliente||0]
    ];
    const wsSummary=XLSX.utils.aoa_to_sheet(summary);
    wsSummary['!cols']=[{wch:34},{wch:38}];
    ['B7','B8','B9'].forEach(cell=>{if(wsSummary[cell])wsSummary[cell].z='0.00%';});
    XLSX.utils.book_append_sheet(wb,wsSummary,'Resumen');

    const serialHeader=['Resultado','Serial','Cliente Código SAP','Cliente Almacén','Cliente Lote','Cliente Tipo','SIGLO Código SAP','SIGLO Almacén','SIGLO Lote','SIGLO Tipo','Segmento SIGLO','Ubicación SIGLO','Estado actual SIGLO','Descripción','Detalle'];
    const serialRows=[];
    (currentAudit.seriales||[]).forEach(g=>{
      const serialCode=g.cliente_codigo_sap||g.siglo_codigo_sap||'';
      const list=String(g.seriales||'').split(',').map(s=>clientSerial(serialCode,s)).filter(Boolean);
      list.forEach(serial=>serialRows.push([
        g.resultado,serial,g.cliente_codigo_sap||'',g.cliente_almacen||'',g.cliente_lote||'',g.cliente_tipo||'',
        g.siglo_codigo_sap||'',g.siglo_almacen||'',g.siglo_lote||'',g.siglo_tipo||'',g.segmento||'',g.ubicacion||'',
        [g.tipo_siglo,g.estado,g.estado_inventario].filter(Boolean).join(' / '),
        g.siglo_descripcion||g.cliente_descripcion||'',g.detalle||''
      ]));
    });
    const wsSerial=XLSX.utils.aoa_to_sheet([serialHeader,...serialRows]);
    wsSerial['!cols']=[{wch:20},{wch:24},{wch:18},{wch:16},{wch:15},{wch:14},{wch:18},{wch:16},{wch:15},{wch:14},{wch:18},{wch:18},{wch:28},{wch:46},{wch:58}];
    XLSX.utils.book_append_sheet(wb,wsSerial,'Serializados');

    const qtyHeader=['Resultado','Código SAP','Centro','Almacén','Lote','Tipo','Cantidad Cliente','Cantidad SIGLO','Diferencia SIGLO - Cliente','Descripción'];
    const qtyRows=(currentAudit.cantidades||[]).map(x=>[x.resultado,x.codigo_sap,x.centro,x.almacen,x.lote,x.tipo,Number(x.cliente_cantidad||0),Number(x.siglo_cantidad||0),Number(x.diferencia||0),x.descripcion||'']);
    const wsQty=XLSX.utils.aoa_to_sheet([qtyHeader,...qtyRows]);
    wsQty['!cols']=[{wch:18},{wch:16},{wch:10},{wch:12},{wch:15},{wch:14},{wch:18},{wch:18},{wch:24},{wch:48}];
    XLSX.utils.book_append_sheet(wb,wsQty,'No Serializados');

    const incHeader=['Código SAP','Centro','Almacén','Lote','Segmento','Tipo','Ubicaciones distintas','Ubicaciones encontradas','Cantidad total'];
    const incRows=(currentAudit.inconsistencias_siglo||[]).map(x=>[x.codigo_sap,x.centro,x.almacen,x.lote,x.segmento,x.tipo,x.ubicaciones_distintas,x.ubicaciones,Number(x.cantidad_total||0)]);
    const wsInc=XLSX.utils.aoa_to_sheet([incHeader,...incRows]);
    wsInc['!cols']=[{wch:16},{wch:10},{wch:12},{wch:15},{wch:18},{wch:14},{wch:21},{wch:34},{wch:16}];
    XLSX.utils.book_append_sheet(wb,wsInc,'Inconsistencias SIGLO');

    const ctrlHeader=['Código SAP','Centro','Almacén','Lote','Tipo','Resumen Cliente','Serializados Cliente','Diferencia','Observación'];
    const ctrlRows=(currentAudit.control_cliente||[]).map(x=>[x.codigo_sap,x.centro,x.almacen,x.lote,x.tipo,Number(x.resumen_cliente||0),Number(x.serializados_cliente||0),Number(x.diferencia||0),x.observacion||'']);
    const wsCtrl=XLSX.utils.aoa_to_sheet([ctrlHeader,...ctrlRows]);
    wsCtrl['!cols']=[{wch:16},{wch:10},{wch:12},{wch:15},{wch:14},{wch:18},{wch:20},{wch:14},{wch:56}];
    XLSX.utils.book_append_sheet(wb,wsCtrl,'Control Cliente');

    const methodology=[
      ['SIGLO · Metodología de conciliación'],
      ['Universo SIGLO','Libre: Disponible. Desmonte: Dañado con estado de inventario Inversa o Garantía.'],
      ['Serializados','Comparación principal por Serial; SAP, Centro, Almacén, Lote y Tipo son controles adicionales.'],
      ['No serializados','Consolidación por Código SAP + Centro + Almacén + Lote + Tipo.'],
      ['Segmento / Ubicación','No forman parte de la llave contra el Cliente; sí se usan para controles internos de SIGLO.'],
      ['FALTANTE','El Cliente reporta existencia que SIGLO no concilia.'],
      ['SOBRANTE','SIGLO tiene existencia fiscal que no aparece en el preliminar.'],
      ['DIFERENCIA','El serial existe en ambos, pero cambia SAP, almacén, lote o tipo.'],
      ['EXISTE_FUERA_MAPA','El serial existe en SIGLO, pero su estado actual no pertenece al universo fiscal.'],
      ['COLISIÓN SIGLO','Dos o más equipos de SIGLO se normalizan al mismo serial Cliente. Se reporta para revisión y no se concilia automáticamente.'],
      ['Acierto general','Promedio entre el porcentaje de conciliación serializada y no serializada cuando ambos universos existen.']
    ];
    const wsMethod=XLSX.utils.aoa_to_sheet(methodology);
    wsMethod['!cols']=[{wch:28},{wch:100}];
    XLSX.utils.book_append_sheet(wb,wsMethod,'Metodología');

    XLSX.writeFile(wb,'SIGLO_Conciliacion_Mapa_Fiscal_'+fileDate()+'.xlsx');
  }

  excelInput.addEventListener('change',()=>{
    currentFile=excelInput.files?.[0]||null;
    fileName.textContent=currentFile?currentFile.name:'Seleccionar preliminar';
    processBtn.disabled=!currentFile;
    setMessage('');
  });

  processBtn.addEventListener('click',async()=>{
    if(!currentFile)return;
    processBtn.disabled=true;
    processBtn.textContent='Procesando…';
    setMessage('Leyendo el preliminar y construyendo la conciliación contra el inventario fiscal vivo…');
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){window.location.replace('index.html');return;}
      const payload=await parsePreliminar(currentFile);
      setMessage('Archivo leído: '+payload.seriales.length+' seriales y '+payload.cantidades.length+' llaves no serializadas. Comparando con SIGLO…');
      const {data,error}=await supabase.rpc('procesar_auditoria_mapa_fiscal',{p_payload:payload});
      if(error)throw error;
      renderAudit(data);
      await loadHistory();
      setMessage('Auditoría guardada correctamente. Acierto general: '+pct(data?.resumen?.porcentaje_acierto)+'.','success');
    }catch(error){
      console.error('Error procesando auditoría Mapa Fiscal',error);
      setMessage(error.message||'No fue posible procesar la auditoría.','error');
    }finally{
      processBtn.disabled=!currentFile;
      processBtn.textContent='Procesar auditoría';
    }
  });

  document.querySelectorAll('.mf-tab').forEach(btn=>btn.addEventListener('click',()=>{
    activeView=btn.dataset.view;
    document.querySelectorAll('.mf-tab').forEach(x=>x.classList.toggle('active',x===btn));
    resultFilter.value='';
    resultSearch.value='';
    renderView();
  }));
  resultFilter.addEventListener('change',renderView);
  resultSearch.addEventListener('input',renderView);
  exportBtn.addEventListener('click',buildExport);

  loadHistory().catch(error=>{
    console.error('No fue posible cargar el historial Mapa Fiscal',error);
    historyList.innerHTML='<div class="mf-history-empty">No fue posible cargar el historial.</div>';
  });
});