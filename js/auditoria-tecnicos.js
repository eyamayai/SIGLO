document.addEventListener('DOMContentLoaded',async()=>{
 const A=window.SigloAudit,supabase=window.sigloSupabase,input=document.getElementById('excelInput'),validateBtn=document.getElementById('validateBtn'),registerBtn=document.getElementById('registerBtn'),message=document.getElementById('auditMessage');
 let file=null,rows=null,validation=null,registered=false,master=[];

 document.getElementById('downloadTemplateBtn').addEventListener('click',()=>A.downloadTemplate('tecnicos'));
 input.addEventListener('change',()=>{file=input.files?.[0]||null;rows=null;validation=null;registered=false;document.getElementById('previewSection').hidden=true;document.getElementById('fileName').textContent=file?.name||'Seleccionar Excel';validateBtn.disabled=!file;message.textContent='';});

 async function loadMaster(){
   const {data,error}=await supabase.rpc('consultar_maestra_tecnicos');
   if(error){document.getElementById('masterBody').innerHTML='<tr class="empty-row"><td colspan="4">No fue posible consultar la maestra.</td></tr>';return;}
   master=Array.isArray(data)?data:[];
   document.getElementById('masterCount').textContent=`${master.length} técnico${master.length===1?'':'s'} registrado(s)`;renderMaster();
 }
 function renderMaster(){
   const q=String(document.getElementById('masterSearch').value||'').toLowerCase();
   const list=master.filter(r=>!q||`${r.cedula} ${r.nombre} ${r.estado}`.toLowerCase().includes(q));
   document.getElementById('masterBody').innerHTML=list.length?list.map(r=>`<tr><td><strong>${A.escapeHtml(r.cedula)}</strong></td><td>${A.escapeHtml(r.nombre)}</td><td><span class="result-pill ${r.estado==='ACTIVO'?'new':'same'}">${A.escapeHtml(r.estado)}</span></td><td>${A.escapeHtml(r.actualizado_en?new Date(r.actualizado_en).toLocaleString('es-CO'):'—')}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="4">Sin coincidencias.</td></tr>';
 }
 document.getElementById('masterSearch').addEventListener('input',renderMaster);

 function render(v){
   validation=v;const s=v.resumen||{},list=v.filas||[];
   document.getElementById('kpiNew').textContent=s.nuevos||0;document.getElementById('kpiUpdate').textContent=s.actualizar||0;document.getElementById('kpiSame').textContent=s.coinciden||0;document.getElementById('kpiError').textContent=s.errores||0;
   document.getElementById('rowCount').textContent=`${list.length} fila${list.length===1?'':'s'}`;
   document.getElementById('previewBody').innerHTML=list.length?list.map(r=>`<tr><td><strong>${A.escapeHtml(r.cedula)}</strong></td><td>${A.escapeHtml(r.nombre)}</td><td>${A.escapeHtml(r.estado)}</td><td><span class="result-pill ${A.resultClass(r.resultado)}">${A.escapeHtml(r.resultado)}</span></td><td>${A.escapeHtml(r.detalle)}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="5">Sin filas.</td></tr>';
   document.getElementById('previewSection').hidden=false;updateRegister();
 }
 function updateRegister(){
   if(!validation)return;const s=validation.resumen||{},bar=document.querySelector('.audit-register-bar'),title=document.getElementById('registerTitle'),help=document.getElementById('registerHelp');
   if(registered){registerBtn.disabled=true;bar.classList.remove('error');bar.classList.add('ready');title.textContent='Maestra Técnicos actualizada';help.textContent='Los cambios ya están disponibles para Devoluciones y futuras consultas.';return;}
   if(s.errores){registerBtn.disabled=true;bar.classList.remove('ready');bar.classList.add('error');title.textContent='La maestra requiere revisión';help.textContent='Corrige los errores antes de registrar.';return;}
   if(!(s.nuevos||0)&&!(s.actualizar||0)){registerBtn.disabled=true;bar.classList.remove('ready','error');title.textContent='No hay cambios';help.textContent='Todos los registros ya coinciden con SIGLO.';return;}
   registerBtn.disabled=false;bar.classList.remove('error');bar.classList.add('ready');title.textContent='Maestra lista para actualizar';help.textContent=`Nuevos: ${s.nuevos||0} · Actualizar: ${s.actualizar||0}.`;
 }
 validateBtn.addEventListener('click',async()=>{
   validateBtn.disabled=true;validateBtn.textContent='Validando…';message.textContent='Comparando técnicos con la maestra actual…';message.className='audit-message';
   try{
     const wb=await A.readWorkbook(file);
     rows=A.sheetRows(wb,'TECNICOS',{cedula:['Cédula','Cedula'],nombre:['Nombre completo','Nombre'],estado:['Estado']}).map(r=>({...r,estado:String(r.estado).toUpperCase()}));
     if(!rows.length)throw new Error('La hoja TECNICOS está vacía.');
     const {data,error}=await supabase.rpc('validar_maestra_tecnicos',{p_rows:rows});if(error)throw error;render(data);message.textContent='Validación terminada.';message.className='audit-message success';
   }catch(e){message.textContent=e.message||'No fue posible validar.';message.className='audit-message error';document.getElementById('previewSection').hidden=true;}
   finally{validateBtn.disabled=false;validateBtn.textContent='Validar archivo';}
 });
 registerBtn.addEventListener('click',async()=>{
   updateRegister();if(registerBtn.disabled||!rows)return;const old=registerBtn.textContent;registerBtn.disabled=true;registerBtn.textContent='Actualizando…';
   const {error}=await supabase.rpc('registrar_maestra_tecnicos',{p_rows:rows});
   if(error){registerBtn.textContent=old;registered=false;updateRegister();const bar=document.querySelector('.audit-register-bar');bar.classList.remove('ready');bar.classList.add('error');document.getElementById('registerTitle').textContent='No se pudo actualizar la maestra';document.getElementById('registerHelp').textContent=error.message;return;}
   registered=true;registerBtn.textContent='Actualizado ✓';message.textContent='Maestra Técnicos actualizada correctamente.';message.className='audit-message success';updateRegister();await loadMaster();
 });
 await loadMaster();
});