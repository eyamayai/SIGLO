document.addEventListener('DOMContentLoaded',()=>{
  const supabase=window.sigloSupabase;
  const input=document.getElementById('excelInput');
  const validateBtn=document.getElementById('validateBtn');
  const registerBtn=document.getElementById('registerBtn');
  const message=document.getElementById('processMessage');
  let file=null,payload=null,validation=null,registered=false;

  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
  const normalizeHeader=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  const today=()=>{
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=t=>p.find(x=>x.type===t)?.value||'';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  function normalizeDate(value){
    if(value instanceof Date&&!Number.isNaN(value.getTime())){
      return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
    }
    const raw=String(value??'').trim();
    if(!raw) return today();
    let m=raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    m=raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    const d=new Date(raw);
    if(!Number.isNaN(d.getTime())) return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    return raw;
  }
  function resolveRows(wb,sheetName,aliases){
    const ws=wb.Sheets[sheetName];
    if(!ws) throw new Error(`No se encontró la hoja "${sheetName}". Usa la plantilla de SIGLO.`);
    const raw=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});
    if(!raw.length) return [];
    const available=Object.keys(raw[0]).reduce((a,k)=>(a[normalizeHeader(k)]=k,a),{});
    const cols={};
    Object.entries(aliases).forEach(([field,names])=>{
      const key=names.map(normalizeHeader).find(n=>available[n]);
      if(!key) throw new Error(`Falta la columna "${names[0]}" en la hoja ${sheetName}.`);
      cols[field]=available[key];
    });
    return raw.map(r=>{
      const o={};
      Object.entries(cols).forEach(([f,c])=>o[f]=r[c]);
      return o;
    }).filter(r=>Object.values(r).some(v=>String(v??'').trim()!==''));
  }
  async function readPayload(){
    if(!file) throw new Error('Selecciona un archivo Excel.');
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:'array',cellDates:true});
    const serial=resolveRows(wb,'SERIALIZADOS',{serial:['Serial'],fecha:['Fecha']}).map(r=>({
      serial:String(r.serial??'').trim(),fecha:normalizeDate(r.fecha)
    }));
    const noSerial=resolveRows(wb,'NO_SERIALIZADOS',{cedula:['Cédula','Cedula'],codigo_sap:['Código SAP','Codigo SAP'],cantidad:['Cantidad'],fecha:['Fecha']}).map(r=>({
      cedula:String(r.cedula??'').trim(),codigo_sap:String(r.codigo_sap??'').trim(),cantidad:String(r.cantidad??'').replace(',','.'),fecha:normalizeDate(r.fecha)
    }));
    if(!serial.length&&!noSerial.length) throw new Error('Las dos hojas están vacías.');
    return {serializados:serial,no_serializados:noSerial};
  }
  function buildTemplate(){
    const wb=XLSX.utils.book_new();
    const ws1=XLSX.utils.aoa_to_sheet([['Serial','Fecha']]);
    ws1['!cols']=[{wch:26},{wch:16}];
    const ws2=XLSX.utils.aoa_to_sheet([['Cédula','Código SAP','Cantidad','Fecha']]);
    ws2['!cols']=[{wch:18},{wch:16},{wch:14},{wch:16}];
    const inst=XLSX.utils.aoa_to_sheet([
      ['SIGLO · Plantilla de Consumos'],
      ['SERIALIZADOS: Serial + Fecha. El serial debe existir y estar Despachado.'],
      ['NO_SERIALIZADOS: Cédula + Código SAP + Cantidad + Fecha.'],
      ['La Fecha puede dejarse vacía; SIGLO usará la fecha actual de Colombia.'],
      ['Para no serializados SIGLO consume primero VALORADO, luego NOVALORADO, desde el despacho más antiguo.'],
      ['No cambies los nombres de las hojas ni los encabezados. Trata Serial y Cédula como texto.']
    ]);
    inst['!cols']=[{wch:110}];
    XLSX.utils.book_append_sheet(wb,ws1,'SERIALIZADOS');
    XLSX.utils.book_append_sheet(wb,ws2,'NO_SERIALIZADOS');
    XLSX.utils.book_append_sheet(wb,inst,'INSTRUCCIONES');
    XLSX.writeFile(wb,'SIGLO_Plantilla_Consumos.xlsx');
  }
  function setMessage(text='',type=''){message.textContent=text;message.className='process-message'+(type?' '+type:'');}
  function render(){
    const serial=validation?.serializados||[],noSerial=validation?.no_serializados||[],s=validation?.resumen||{};
    document.getElementById('countSerial').textContent=serial.length;
    document.getElementById('countNoSerial').textContent=noSerial.length;
    document.getElementById('countReady').textContent=s.listos||0;
    document.getElementById('countErrors').textContent=s.errores||0;
    document.getElementById('serialBody').innerHTML=serial.length?serial.map(r=>`<tr><td><strong>${esc(r.serial)}</strong></td><td>${esc(r.codigo_sap||'—')}</td><td>${esc(r.tecnico||'—')}</td><td>${esc(r.cedula||'—')}</td><td>${esc(r.documento_despacho||'—')}</td><td>${esc(r.fecha||'—')}</td><td><span class="result-pill ${r.resultado==='OK'?'ok':'error'}">${esc(r.resultado)}</span></td><td>${esc(r.detalle||'')}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="8">Sin registros</td></tr>';
    document.getElementById('noSerialBody').innerHTML=noSerial.length?noSerial.map(r=>`<tr><td><strong>${esc(r.cedula)}</strong></td><td>${esc(r.tecnico||'—')}</td><td>${esc(r.codigo_sap)}</td><td>${esc(r.cantidad)}</td><td>${esc(r.disponible??'—')}</td><td>${esc(r.fecha||'—')}</td><td><span class="result-pill ${r.resultado==='OK'?'ok':'error'}">${esc(r.resultado)}</span></td><td>${esc(r.detalle||'')}</td></tr>`).join(''):'<tr class="empty-row"><td colspan="8">Sin registros</td></tr>';
    document.getElementById('resultsSection').hidden=false;
    const bar=document.querySelector('.register-bar'),title=document.getElementById('registerTitle'),help=document.getElementById('registerHelp');
    if(registered){bar.className='register-bar ready';title.textContent='Consumos registrados';help.textContent='Los serializados quedaron Instalados y los no serializados fueron descontados del pendiente del técnico.';registerBtn.disabled=true;return;}
    if((s.errores||0)>0){bar.className='register-bar error';title.textContent='La carga requiere corrección';help.textContent='Corrige los errores indicados y vuelve a validar el archivo.';registerBtn.disabled=true;return;}
    bar.className='register-bar ready';title.textContent='Consumos listos para registrar';help.textContent=`${s.listos||0} fila${Number(s.listos||0)===1?'':'s'} lista${Number(s.listos||0)===1?'':'s'}.`;registerBtn.disabled=!(s.listos>0);
  }

  document.getElementById('downloadTemplateBtn').addEventListener('click',buildTemplate);
  input.addEventListener('change',()=>{
    file=input.files?.[0]||null;payload=null;validation=null;registered=false;
    document.getElementById('fileName').textContent=file?.name||'Seleccionar Excel';
    validateBtn.disabled=!file;registerBtn.disabled=true;document.getElementById('resultsSection').hidden=true;setMessage('');
  });
  validateBtn.addEventListener('click',async()=>{
    validateBtn.disabled=true;validateBtn.textContent='Validando…';setMessage('Revisando consumos contra los despachos pendientes de SIGLO…');
    try{
      payload=await readPayload();
      const {data,error}=await supabase.rpc('validar_consumos',{p_payload:payload});
      if(error) throw error;
      validation=data;registered=false;render();setMessage('Validación terminada.','success');
    }catch(e){console.error(e);validation=null;document.getElementById('resultsSection').hidden=true;setMessage(e.message||'No fue posible validar el archivo.','error');}
    finally{validateBtn.disabled=!file;validateBtn.innerHTML='Validar archivo <span>→</span>';}
  });
  registerBtn.addEventListener('click',async()=>{
    if(!payload||!validation||Number(validation?.resumen?.errores||0)>0)return;
    const original=registerBtn.innerHTML;registerBtn.disabled=true;registerBtn.textContent='Registrando…';setMessage('Registrando consumos…');
    try{
      const {data,error}=await supabase.rpc('registrar_consumos',{p_payload:payload});
      if(error) throw error;
      registered=true;render();setMessage(`Consumos registrados correctamente · ${data?.documento||'CONSUMO'} · ${data?.movimientos||0} movimiento${Number(data?.movimientos||0)===1?'':'s'}.`,'success');
      registerBtn.textContent='Registrado ✓';
    }catch(e){console.error(e);registerBtn.innerHTML=original;registerBtn.disabled=false;setMessage(e.message||'No fue posible registrar los consumos.','error');}
  });
});