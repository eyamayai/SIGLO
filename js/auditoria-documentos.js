document.addEventListener('DOMContentLoaded', () => {
  const A=window.SigloAudit;
  const supabase=window.sigloSupabase;
  const excelInput=document.getElementById('excelInput');
  const fileName=document.getElementById('fileName');
  const validateBtn=document.getElementById('validateBtn');
  const message=document.getElementById('auditMessage');
  const previewSection=document.getElementById('previewSection');
  const previewBody=document.getElementById('previewBody');
  const statusFilter=document.getElementById('statusFilter');
  const exportPendingBtn=document.getElementById('exportPendingBtn');

  let currentFile=null;
  let resultRows=[];

  function setMessage(text='',type=''){
    message.textContent=text;
    message.className='audit-message'+(type?' '+type:'');
  }

  function downloadTemplate(){
    if(!window.XLSX){setMessage('No fue posible cargar el generador de Excel.','error');return;}
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([['DOCUMENTO','FECHA']]);
    ws['!cols']=[{wch:28},{wch:14}];
    XLSX.utils.book_append_sheet(wb,ws,'VALIDACION');
    const help=XLSX.utils.aoa_to_sheet([
      ['SIGLO · Validación de Documentos'],
      ['No cambies el nombre de la hoja VALIDACION ni los encabezados.'],
      ['SIGLO identifica automáticamente el tipo del documento cuando encuentra su número en la base de datos.'],
      ['Cada fila debe representar un documento generado por el sistema externo que quieras contrastar contra SIGLO.']
    ]);
    help['!cols']=[{wch:100}];
    XLSX.utils.book_append_sheet(wb,help,'INSTRUCCIONES');
    XLSX.writeFile(wb,'SIGLO_Plantilla_Validacion_Documentos.xlsx');
  }

  function render(){
    const filter=statusFilter.value;
    const rows=filter?resultRows.filter(row=>row.estado===filter):resultRows;

    previewBody.innerHTML=rows.length?rows.map(row=>{
      const cls=row.estado==='PROCESADO'?'processed':row.estado==='DUPLICADO'?'duplicate':'pending';
      return '<tr>'+
        '<td><strong>'+A.escapeHtml(row.documento||'—')+'</strong></td>'+
        '<td>'+A.escapeHtml(row.fecha||'—')+'</td>'+
        '<td><span class="result-pill '+cls+'">'+A.escapeHtml(row.estado||'—')+'</span></td>'+
        '<td>'+A.escapeHtml(row.fecha_siglo||'—')+'</td>'+
        '<td>'+A.escapeHtml(row.tipo_siglo||'—')+'</td>'+
        '<td>'+A.escapeHtml(row.detalle||'')+'</td>'+
      '</tr>';
    }).join(''):'<tr class="empty-row"><td colspan="6">No hay documentos para este filtro.</td></tr>';
  }

  document.getElementById('downloadTemplateBtn').addEventListener('click',downloadTemplate);

  excelInput.addEventListener('change',()=>{
    currentFile=excelInput.files?.[0]||null;
    fileName.textContent=currentFile?currentFile.name:'Seleccionar Excel';
    validateBtn.disabled=!currentFile;
    previewSection.hidden=true;
    resultRows=[];
    setMessage('');
  });

  statusFilter.addEventListener('change',render);

  validateBtn.addEventListener('click',async()=>{
    if(!currentFile)return;
    validateBtn.disabled=true;
    validateBtn.textContent='Validando…';
    setMessage('Leyendo el Excel y contrastando contra SIGLO…');

    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){window.location.replace('index.html');return;}

      const wb=await A.readWorkbook(currentFile);
      const rows=A.sheetRows(wb,'VALIDACION',{
        documento:['DOCUMENTO'],
        fecha:['FECHA']
      });
      if(!rows.length) throw new Error('La plantilla no contiene documentos para validar.');

      const payloadRows=rows.map((row,index)=>{
        if(!row.documento) throw new Error('Fila '+(index+2)+': falta DOCUMENTO.');
        if(!row.fecha) throw new Error('Fila '+(index+2)+': falta FECHA.');
        return {documento:row.documento,fecha:row.fecha};
      });

      const {data,error}=await supabase.rpc('validar_documentos_auditoria',{p_payload:{documentos:payloadRows}});
      if(error) throw error;

      const summary=data?.resumen||{};
      resultRows=data?.filas||[];
      document.getElementById('kpiTotal').textContent=summary.total||0;
      document.getElementById('kpiProcessed').textContent=summary.procesados||0;
      document.getElementById('kpiPending').textContent=summary.pendientes||0;
      document.getElementById('kpiCompliance').textContent=Number(summary.cumplimiento||0).toLocaleString('es-CO',{maximumFractionDigits:2})+'%';

      statusFilter.value='';
      render();
      previewSection.hidden=false;
      setMessage('Validación completada. '+(summary.procesados||0)+' procesado(s) y '+(summary.pendientes||0)+' pendiente(s).','success');
      previewSection.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){
      console.error('Error validando documentos',error);
      previewSection.hidden=true;
      setMessage(error.message||'No fue posible validar los documentos.','error');
    }finally{
      validateBtn.disabled=!currentFile;
      validateBtn.textContent='Validar documentos';
    }
  });

  exportPendingBtn.addEventListener('click',()=>{
    if(!window.XLSX)return;
    const pending=resultRows.filter(row=>row.estado==='PENDIENTE');
    if(!pending.length){setMessage('No hay documentos pendientes para exportar.','success');return;}
    const data=[
      ['DOCUMENTO','FECHA','ESTADO','DETALLE'],
      ...pending.map(row=>[row.documento,row.fecha,row.estado,row.detalle])
    ];
    const ws=XLSX.utils.aoa_to_sheet(data);
    ws['!cols']=[{wch:28},{wch:14},{wch:14},{wch:52}];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'PENDIENTES');
    XLSX.writeFile(wb,'SIGLO_Documentos_Pendientes.xlsx');
  });
});