document.addEventListener('DOMContentLoaded',async()=>{
 const A=window.SigloAudit,supabase=window.sigloSupabase,input=document.getElementById('excelInput'),validateBtn=document.getElementById('validateBtn'),registerBtn=document.getElementById('registerBtn'),replaceBtn=document.getElementById('replaceMasterBtn'),message=document.getElementById('auditMessage');
 let file=null,rows=null,validation=null,registered=false,master=[];

 document.getElementById('downloadTemplateBtn').addEventListener('click',()=>A.downloadTemplate('codigos'));
 input.addEventListener('change',()=>{file=input.files?.[0]||null;rows=null;validation=null;registered=false;document.getElementById('previewSection').hidden=true;document.getElementById('fileName').textContent=file?.name||'Seleccionar Excel';validateBtn.disabled=!file;replaceBtn.disabled=!file;message.textContent='';});

 async function readRows(){
   const wb=await A.readWorkbook(file);
   const parsed=A.sheetRows(wb,'CODIGOS_SAP',{codigo_sap:['Código SAP','Codigo SAP'],dominio:['Dominion'],descripcion:['Descripción','Descripcion'],topologia:['Topología','Topologia'],lote:['Lote']}).map(r=>({...r,topologia:String(r.topologia).toUpperCase(),lote:String(r.lote).toUpperCase()}));
   if(!parsed.length)throw new Error('La hoja CODIGOS_SAP está vacía.');
   return parsed;
 }

 async function loadMaster(){
   const {data,error}=await supabase.rpc('consultar_maestra_codigos');
   if(error){document.getElementById('masterBody').innerHTML='<tr class="empty-row"><td colspan="6">No fue posible consultar la maestra.</td></tr>';return;}
   master=Array.isArray(data)?data:[];
   document.getElementById('masterCount').textContent=`${master.length} combinación${master.length===1?'':'es'} SAP/Dominion`;renderMaster();
 }
 function renderMaster(){
   const q=String(document.getElementById('masterSearch').value||'').toLowerCase();
   const list=master.filter(r=>!q||`${r.codigo_sap} ${r.dominio} ${r.descripcion||''} ${r.topologia} ${r.lote||''}`.toLowerCase().includes(q));
   document.getElementById('masterBody').innerHTML=list.length?list.map(r=>`<tr><td><strong>${A.escapeHtml(r.codigo_sap)}</strong></td><td>${A.escapeHtml(r.dominio)}</td><td class="description">${A.escapeHtml(r.descripcion||'—')}</td><td>${A.escapeHtml(r.topologia)}</td><td>${A.escapeHtml(r.lote||'—')}</td><td>${A.escapeHtml(r.actualizado_en?new Date(r.actualizado_en).toLocaleString('es-CO'):'—')}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="6">Sin coincidencias.</td></tr>';
 }
 document.getElementById('masterSearch').addEventListener('input',renderMaster);

 function render(v){
   validation=v;const s=v.resumen||{},list=v.filas||[];
   document.getElementById('kpiNew').textContent=s.nuevos||0;document.getElementById('kpiUpdate').textContent=s.actualizar||0;document.getElementById('kpiSame').textContent=s.coinciden||0;document.getElementById('kpiConflict').textContent=s.conflictos||0;document.getElementById('kpiError').textContent=s.errores||0;
   document.getElementById('rowCount').textContent=`${list.length} fila${list.length===1?'':'s'}`;
   document.getElementById('previewBody').innerHTML=list.length?list.map(r=>`<tr><td><strong>${A.escapeHtml(r.codigo_sap)}</strong></td><td>${A.escapeHtml(r.dominio)}</td><td class="description">${A.escapeHtml(r.descripcion)}</td><td>${A.escapeHtml(r.topologia)}</td><td>${A.escapeHtml(r.lote)}</td><td><span class="result-pill ${A.resultClass(r.resultado)}">${A.escapeHtml(r.resultado)}</span></td><td>${A.escapeHtml(r.detalle)}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="7">Sin filas.</td></tr>';
   document.getElementById('previewSection').hidden=false;updateRegister();
 }
 function updateRegister(){
   if(!validation)return;const s=validation.resumen||{},bar=document.querySelector('.audit-register-bar'),title=document.getElementById('registerTitle'),help=document.getElementById('registerHelp');
   if(registered){registerBtn.disabled=true;bar.classList.remove('error');bar.classList.add('ready');title.textContent='Maestra Códigos SAP actualizada';help.textContent='Ingresos, Despachos y Devoluciones ya consultan la maestra actualizada.';return;}
   if((s.errores||0)||(s.conflictos||0)){registerBtn.disabled=true;bar.classList.remove('ready');bar.classList.add('error');title.textContent='La maestra requiere revisión';help.textContent='Corrige todos los errores y conflictos antes de registrar.';return;}
   if(!(s.nuevos||0)&&!(s.actualizar||0)){registerBtn.disabled=true;bar.classList.remove('ready','error');title.textContent='No hay cambios';help.textContent='Todos los registros ya coinciden con SIGLO.';return;}
   registerBtn.disabled=false;bar.classList.remove('error');bar.classList.add('ready');title.textContent='Maestra lista para actualizar';help.textContent=`Nuevos: ${s.nuevos||0} · Actualizar: ${s.actualizar||0}.`;
 }
 validateBtn.addEventListener('click',async()=>{
   validateBtn.disabled=true;validateBtn.textContent='Validando…';message.textContent='Comparando códigos con la maestra actual…';message.className='audit-message';
   try{
     rows=await readRows();
     const {data,error}=await supabase.rpc('validar_maestra_codigos',{p_rows:rows});if(error)throw error;render(data);message.textContent='Validación terminada.';message.className='audit-message success';
   }catch(e){message.textContent=e.message||'No fue posible validar.';message.className='audit-message error';document.getElementById('previewSection').hidden=true;}
   finally{validateBtn.disabled=!file;validateBtn.textContent='Validar archivo';}
 });
 registerBtn.addEventListener('click',async()=>{
   updateRegister();if(registerBtn.disabled||!rows)return;const old=registerBtn.textContent;registerBtn.disabled=true;registerBtn.textContent='Actualizando…';
   const {error}=await supabase.rpc('registrar_maestra_codigos',{p_rows:rows});
   if(error){registerBtn.textContent=old;registered=false;updateRegister();const bar=document.querySelector('.audit-register-bar');bar.classList.remove('ready');bar.classList.add('error');document.getElementById('registerTitle').textContent='No se pudo actualizar la maestra';document.getElementById('registerHelp').textContent=error.message;return;}
   registered=true;registerBtn.textContent='Actualizado ✓';message.textContent='Maestra Códigos SAP actualizada correctamente.';message.className='audit-message success';updateRegister();await loadMaster();
 });

 replaceBtn.addEventListener('click',async()=>{
   if(!file)return;
   const oldText=replaceBtn.textContent;
   try{
     replaceBtn.disabled=true;validateBtn.disabled=true;registerBtn.disabled=true;
     message.textContent='Preparando reemplazo completo de la maestra…';message.className='audit-message';
     const replaceRows=await readRows();
     const currentCount=master.length;
     const ok=window.confirm(`Esta acción reemplazará completamente la Maestra de Códigos SAP actual (${currentCount} registros) por los ${replaceRows.length} registros del archivo seleccionado.\n\nInventarios, saldos y movimientos NO serán eliminados.\n\n¿Deseas continuar?`);
     if(!ok){message.textContent='Reemplazo cancelado. La maestra actual no fue modificada.';message.className='audit-message';return;}
     replaceBtn.textContent='Reemplazando…';
     const {data,error}=await supabase.rpc('reemplazar_maestra_codigos',{p_rows:replaceRows});
     if(error)throw error;
     rows=null;validation=null;registered=false;document.getElementById('previewSection').hidden=true;
     message.textContent=`Maestra reemplazada correctamente: ${data?.procesados||replaceRows.length} combinaciones, ${data?.saps||0} códigos SAP.`;message.className='audit-message success';
     await loadMaster();
   }catch(e){
     message.textContent=e.message||'No fue posible reemplazar la maestra. La información anterior se conserva.';message.className='audit-message error';
   }finally{
     replaceBtn.textContent=oldText;replaceBtn.disabled=!file;validateBtn.disabled=!file;
   }
 });

 await loadMaster();
});