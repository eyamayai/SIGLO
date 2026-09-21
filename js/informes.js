document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.sigloSupabase;
  const buttons = [...document.querySelectorAll('.report-option')];
  const generateBtn = document.getElementById('generateReportBtn');
  const exportBtn = document.getElementById('exportReportBtn');
  const result = document.getElementById('reportResult');
  const message = document.getElementById('reportMessage');

  let selected = 'mapa_fiscal';
  let dataCache = null;
  let currentRows = [];

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

  function formatNumber(value){
    const n=Number(value);
    if(!Number.isFinite(n)) return value ?? '';
    return new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(n);
  }

  function setMessage(text='',type=''){
    message.textContent=text;
    message.className='report-message'+(type?' '+type:'');
  }

  function selectReport(key){
    selected=key;
    buttons.forEach(btn=>btn.classList.toggle('active',btn.dataset.report===key));
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
});