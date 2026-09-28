document.addEventListener('DOMContentLoaded',()=>{
  const A=window.SigloAudit, supabase=window.sigloSupabase;
  const input=document.getElementById('excelInput'), validateBtn=document.getElementById('validateBtn');
  const registerBtn=document.getElementById('registerBtn'), message=document.getElementById('auditMessage');
  const preview=document.getElementById('previewSection'), body=document.getElementById('previewBody');
  const resultFilter=document.getElementById('resultFilter'), exportIssuesBtn=document.getElementById('exportIssuesBtn');
  let file=null, payload=null, validation=null, registered=false, allRows=[];

  document.getElementById('downloadTemplateBtn').addEventListener('click',()=>A.downloadTemplate('carga-inicial'));
  input.addEventListener('change',()=>{
    file=input.files?.[0]||null; payload=null; validation=null; registered=false; allRows=[]; preview.hidden=true;
    resultFilter.value='TODOS'; exportIssuesBtn.disabled=true;
    document.getElementById('fileName').textContent=file?.name||'Seleccionar Excel';
    validateBtn.disabled=!file; message.textContent=''; message.className='audit-message';
  });

  function aliasesSerial(){return{
    serial:['Serial'],codigo_sap:['Código SAP','Codigo SAP'],dominio:['Dominion'],descripcion:['Descripción','Descripcion'],
    lote:['Lote'],almacen:['Almacén','Almacen'],ubicacion:['Ubicación','Ubicacion'],tipo:['Tipo']
  };}
  function aliasesSaldo(){return{
    codigo_sap:['Código SAP','Codigo SAP'],dominio:['Dominion'],descripcion:['Descripción','Descripcion'],
    lote:['Lote'],almacen:['Almacén','Almacen'],ubicacion:['Ubicación','Ubicacion'],tipo:['Tipo'],cantidad:['Cantidad']
  };}

  function rowsForFilter(){
    const filter=resultFilter.value||'TODOS';
    if(filter==='TODOS') return allRows;
    if(filter==='NOVEDADES') return allRows.filter(r=>['CONFLICTO','ERROR'].includes(String(r.resultado||'').toUpperCase()));
    return allRows.filter(r=>String(r.resultado||'').toUpperCase()===filter);
  }

  function renderRows(){
    const rows=rowsForFilter();
    document.getElementById('rowCount').textContent=rows.length===allRows.length
      ? `${rows.length} fila${rows.length===1?'':'s'}`
      : `${rows.length} de ${allRows.length} filas`;
    body.innerHTML=rows.length?rows.map(r=>`<tr>
      <td>${A.escapeHtml(r._grupo)}</td><td>${A.escapeHtml(r.serial||'—')}</td><td><strong>${A.escapeHtml(r.codigo_sap)}</strong></td>
      <td>${A.escapeHtml(r.dominio)}</td><td class="description">${A.escapeHtml(r.descripcion)}</td><td>${A.escapeHtml(r.lote)}</td>
      <td>${A.escapeHtml(r.almacen)}</td><td>${A.escapeHtml(r.ubicacion)}</td><td>${A.escapeHtml(r.tipo)}</td><td>${A.escapeHtml(r.cantidad||1)}</td>
      <td><span class="result-pill ${A.resultClass(r.resultado)}">${A.escapeHtml(r.resultado)}</span></td><td>${A.escapeHtml(r.detalle)}</td>
    </tr>`).join(''):'<tr class="empty-row"><td colspan="12">No hay filas para este filtro.</td></tr>';
  }

  function render(v){
    validation=v; const s=v.resumen||{};
    document.getElementById('kpiNew').textContent=s.nuevos||0;
    document.getElementById('kpiSame').textContent=s.coinciden||0;
    document.getElementById('kpiConflict').textContent=s.conflictos||0;
    document.getElementById('kpiError').textContent=s.errores||0;
    allRows=[
      ...(v.serializados||[]).map(r=>({...r,_grupo:'SERIALIZADO',cantidad:1})),
      ...(v.no_serializados||[]).map(r=>({...r,_grupo:'NO SERIALIZADO',serial:'—'}))
    ];
    const issues=allRows.filter(r=>['CONFLICTO','ERROR'].includes(String(r.resultado||'').toUpperCase()));
    exportIssuesBtn.disabled=issues.length===0;
    resultFilter.value=issues.length?'NOVEDADES':'TODOS';
    renderRows();
    preview.hidden=false; updateRegister();
  }

  function updateRegister(){
    if(!validation)return;
    const s=validation.resumen||{}, bar=document.querySelector('.audit-register-bar');
    const title=document.getElementById('registerTitle'), help=document.getElementById('registerHelp');
    if(registered){registerBtn.disabled=true;bar.classList.remove('error');bar.classList.add('ready');title.textContent='Carga inicial registrada';help.textContent='El inventario base y sus movimientos CARGA INICIAL fueron guardados.';return;}
    if((s.errores||0)||(s.conflictos||0)){registerBtn.disabled=true;bar.classList.remove('ready');bar.classList.add('error');title.textContent='La carga requiere revisión';help.textContent='Corrige todos los conflictos y errores. SIGLO no realizará cargas parciales.';return;}
    if(!(s.nuevos||0)){registerBtn.disabled=true;bar.classList.remove('ready','error');title.textContent='No hay registros nuevos';help.textContent='Todo el archivo ya coincide con SIGLO.';return;}
    registerBtn.disabled=false;bar.classList.remove('error');bar.classList.add('ready');title.textContent='Carga inicial lista para registrar';help.textContent=`Se incorporarán ${s.nuevos} registro(s) nuevo(s). Los que coinciden no se duplican.`;
  }

  validateBtn.addEventListener('click',async()=>{
    if(!file)return;
    validateBtn.disabled=true;validateBtn.textContent='Validando…';message.textContent='Leyendo Excel y comparando con el inventario actual…';message.className='audit-message';
    try{
      const wb=await A.readWorkbook(file);
      const serializados=A.sheetRows(wb,'SERIALIZADOS',aliasesSerial());
      const noSerializados=A.sheetRows(wb,'NO_SERIALIZADOS',aliasesSaldo()).map(r=>({...r,cantidad:Number(String(r.cantidad).replace(',','.'))}));
      if(!serializados.length&&!noSerializados.length)throw new Error('La plantilla no contiene registros.');
      payload={serializados,no_serializados:noSerializados};
      const {data,error}=await supabase.rpc('validar_carga_inicial',{p_payload:payload});
      if(error)throw error;
      render(data);message.textContent='Validación terminada.';message.className='audit-message success';
    }catch(e){console.error(e);message.textContent=e.message||'No fue posible validar la carga.';message.className='audit-message error';preview.hidden=true;}
    finally{validateBtn.disabled=false;validateBtn.textContent='Validar archivo';}
  });

  registerBtn.addEventListener('click',async()=>{
    updateRegister();if(registerBtn.disabled||!payload)return;
    const old=registerBtn.textContent;registerBtn.disabled=true;registerBtn.textContent='Registrando…';
    const {data,error}=await supabase.rpc('registrar_carga_inicial',{p_payload:payload});
    if(error){
      registerBtn.textContent=old;registered=false;updateRegister();
      const bar=document.querySelector('.audit-register-bar');bar.classList.remove('ready');bar.classList.add('error');
      document.getElementById('registerTitle').textContent='No se pudo registrar la carga inicial';
      document.getElementById('registerHelp').textContent=error.message||'Error de registro.';
      return;
    }
    registered=true;registerBtn.textContent='Registrado ✓';message.textContent=`Carga ${data?.documento||''} registrada · ${data?.nuevos||0} registro(s) nuevo(s).`;message.className='audit-message success';updateRegister();
  });

  resultFilter?.addEventListener('change',renderRows);

  exportIssuesBtn?.addEventListener('click',()=>{
    const issues=allRows.filter(r=>['CONFLICTO','ERROR'].includes(String(r.resultado||'').toUpperCase()));
    if(!issues.length) return;
    if(!window.XLSX){message.textContent='No se pudo cargar el generador de Excel.';message.className='audit-message error';return;}
    const data=issues.map(r=>({
      'Grupo':r._grupo,
      'Serial':r.serial==='—'?'':r.serial||'',
      'Código SAP':r.codigo_sap||'',
      'Dominion':r.dominio||'',
      'Descripción':r.descripcion||'',
      'Lote':r.lote||'',
      'Almacén':r.almacen||'',
      'Ubicación':r.ubicacion||'',
      'Tipo':r.tipo||'',
      'Cantidad':r.cantidad||1,
      'Resultado':r.resultado||'',
      'Detalle':r.detalle||''
    }));
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.json_to_sheet(data);
    ws['!cols']=[
      {wch:18},{wch:24},{wch:14},{wch:18},{wch:45},{wch:15},
      {wch:12},{wch:16},{wch:14},{wch:12},{wch:14},{wch:70}
    ];
    XLSX.utils.book_append_sheet(wb,ws,'NOVEDADES');
    const stamp=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date()).replaceAll('-','');
    XLSX.writeFile(wb,`SIGLO_Novedades_Carga_Inicial_${stamp}.xlsx`);
  });
});
