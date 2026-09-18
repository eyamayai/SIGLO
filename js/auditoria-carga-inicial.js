document.addEventListener('DOMContentLoaded',()=>{
  const A=window.SigloAudit, supabase=window.sigloSupabase;
  const input=document.getElementById('excelInput'), validateBtn=document.getElementById('validateBtn');
  const registerBtn=document.getElementById('registerBtn'), message=document.getElementById('auditMessage');
  const preview=document.getElementById('previewSection'), body=document.getElementById('previewBody');
  let file=null, payload=null, validation=null, registered=false;

  document.getElementById('downloadTemplateBtn').addEventListener('click',()=>A.downloadTemplate('carga-inicial'));
  input.addEventListener('change',()=>{
    file=input.files?.[0]||null; payload=null; validation=null; registered=false; preview.hidden=true;
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

  function render(v){
    validation=v; const s=v.resumen||{};
    document.getElementById('kpiNew').textContent=s.nuevos||0;
    document.getElementById('kpiSame').textContent=s.coinciden||0;
    document.getElementById('kpiConflict').textContent=s.conflictos||0;
    document.getElementById('kpiError').textContent=s.errores||0;
    const rows=[
      ...(v.serializados||[]).map(r=>({...r,_grupo:'SERIALIZADO',cantidad:1})),
      ...(v.no_serializados||[]).map(r=>({...r,_grupo:'NO SERIALIZADO',serial:'—'}))
    ];
    document.getElementById('rowCount').textContent=`${rows.length} fila${rows.length===1?'':'s'}`;
    body.innerHTML=rows.length?rows.map(r=>`<tr>
      <td>${A.escapeHtml(r._grupo)}</td><td>${A.escapeHtml(r.serial||'—')}</td><td><strong>${A.escapeHtml(r.codigo_sap)}</strong></td>
      <td>${A.escapeHtml(r.dominio)}</td><td class="description">${A.escapeHtml(r.descripcion)}</td><td>${A.escapeHtml(r.lote)}</td>
      <td>${A.escapeHtml(r.almacen)}</td><td>${A.escapeHtml(r.ubicacion)}</td><td>${A.escapeHtml(r.tipo)}</td><td>${A.escapeHtml(r.cantidad||1)}</td>
      <td><span class="result-pill ${A.resultClass(r.resultado)}">${A.escapeHtml(r.resultado)}</span></td><td>${A.escapeHtml(r.detalle)}</td>
    </tr>`).join(''):'<tr class="empty-row"><td colspan="12">Sin filas para mostrar.</td></tr>';
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
});