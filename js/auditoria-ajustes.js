document.addEventListener('DOMContentLoaded',()=>{
  const A=window.SigloAudit;
  const supabase=window.sigloSupabase;
  const serialInput=document.getElementById('serialInput');
  const searchBtn=document.getElementById('searchBtn');
  const message=document.getElementById('adjustMessage');
  const editorSection=document.getElementById('editorSection');
  const currentGrid=document.getElementById('currentGrid');
  const currentSerial=document.getElementById('currentSerial');
  const sapInput=document.getElementById('sapInput');
  const validateSapBtn=document.getElementById('validateSapBtn');
  const sapHelp=document.getElementById('sapHelp');
  const lotSelect=document.getElementById('lotSelect');
  const domainInput=document.getElementById('domainInput');
  const descriptionInput=document.getElementById('descriptionInput');
  const warehouseSelect=document.getElementById('warehouseSelect');
  const typeSelect=document.getElementById('typeSelect');
  const locationField=document.getElementById('locationField');
  const locationSelect=document.getElementById('locationSelect');
  const desmonteSegmentField=document.getElementById('desmonteSegmentField');
  const desmonteSegmentSelect=document.getElementById('desmonteSegmentSelect');
  const segmentInput=document.getElementById('segmentInput');
  const resultLocationInput=document.getElementById('resultLocationInput');
  const inventoryStateField=document.getElementById('inventoryStateField');
  const inventoryStateSelect=document.getElementById('inventoryStateSelect');
  const physicalStateInput=document.getElementById('physicalStateInput');
  const stockInput=document.getElementById('stockInput');
  const previewBtn=document.getElementById('previewBtn');
  const previewCard=document.getElementById('previewCard');
  const diffBody=document.getElementById('diffBody');
  const changeCount=document.getElementById('changeCount');
  const reasonSelect=document.getElementById('reasonSelect');
  const observationInput=document.getElementById('observationInput');
  const applyBtn=document.getElementById('applyBtn');
  const historyList=document.getElementById('historyList');
  const historyCount=document.getElementById('historyCount');
  const adminSapBadge=document.getElementById('adminSapBadge');

  let catalog=null;
  let current=null;
  let master=null;
  let proposal=null;

  const esc=value=>A.escapeHtml(value??'');
  const upper=value=>String(value??'').trim().toUpperCase();
  const text=value=>String(value??'').trim();
  const setMessage=(value='',type='')=>{
    message.textContent=value;
    message.className='audit-message'+(type?' '+type:'');
  };
  const fmtDate=value=>{
    if(!value)return '—';
    const d=new Date(value);
    return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(d);
  };
  const reasonLabels={
    CONCILIACION_PRELIMINAR:'Conciliación preliminar Cliente',
    CORRECCION_LOTE:'Corrección de lote',
    CORRECCION_ALMACEN:'Corrección de almacén',
    CORRECCION_UBICACION:'Corrección de ubicación',
    CORRECCION_CLASIFICACION:'Corrección Libre / Desmonte',
    ERROR_CARGA_INICIAL:'Error de carga inicial',
    OTRO:'Otro'
  };

  function currentItems(e){
    return [
      ['Serial',e.serial,true],['Código SAP',e.codigo_sap],['Dominion',e.dominio],['Descripción',e.descripcion,true],
      ['Topología',e.topologia,true],['Lote',e.lote],['Centro',e.centro],['Almacén',e.almacen],
      ['Ubicación',e.ubicacion],['Segmento',e.segmento],['Stock',e.stock],['Tipo',e.tipo],
      ['Estado físico',e.estado],['Estado inventario',e.estado_inventario]
    ];
  }

  function renderCurrent(){
    const e=current.equipo;
    currentSerial.textContent=e.serial;
    currentGrid.innerHTML=currentItems(e).map(([label,value,wide])=>
      '<div class="adjust-data-item'+(wide?' wide':'')+'"><span>'+esc(label)+'</span><strong>'+esc(value??'—')+'</strong></div>'
    ).join('');
  }

  function renderHistory(rows){
    const list=Array.isArray(rows)?rows:[];
    historyCount.textContent=list.length+' ajuste'+(list.length===1?'':'s');
    if(!list.length){
      historyList.innerHTML='<div class="adjust-empty">Este serial aún no tiene ajustes de Auditoría.</div>';
      return;
    }
    historyList.innerHTML=list.map(row=>{
      const before=row.valores_anteriores||{};
      const after=row.valores_nuevos||{};
      const fields=['codigo_sap','dominio','lote','almacen','ubicacion','segmento','tipo','estado','estado_inventario','stock'];
      const changes=fields.filter(key=>String(before[key]??'')!==String(after[key]??''))
        .map(key=>'<span>'+esc(key.replaceAll('_',' '))+': '+esc(before[key]??'—')+' → '+esc(after[key]??'—')+'</span>').join('');
      return '<div class="adjust-history-row">'+
        '<div class="adjust-history-top"><strong>'+esc(reasonLabels[row.motivo]||row.motivo)+'</strong><span>'+esc(fmtDate(row.creado_en))+' · '+esc(row.creado_por_nombre||'SIGLO')+'</span></div>'+
        (row.observacion?'<p>'+esc(row.observacion)+'</p>':'')+
        '<div class="adjust-history-changes">'+changes+'</div></div>';
    }).join('');
  }

  function fillLocations(){
    const locations=Array.isArray(catalog?.ubicaciones)?catalog.ubicaciones:[];
    locationSelect.innerHTML=locations.map(x=>'<option value="'+esc(x.ubicacion)+'" data-segment="'+esc(x.segmento)+'">'+esc(x.ubicacion)+' · '+esc(x.segmento)+'</option>').join('');
    desmonteSegmentSelect.innerHTML=(catalog?.segmentos||[]).map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
  }

  function masterRow(){
    const lot=upper(lotSelect.value);
    return (master?.lotes||[]).find(x=>upper(x.lote)===lot)||null;
  }

  function syncMaster(){
    const row=masterRow();
    domainInput.value=row?.dominio||'';
    descriptionInput.value=row?.descripcion||'';
  }

  function syncType(){
    const type=upper(typeSelect.value);
    const isDesmonte=type==='DESMONTE';
    locationField.hidden=isDesmonte;
    desmonteSegmentField.hidden=!isDesmonte;
    inventoryStateField.hidden=!isDesmonte;

    if(isDesmonte){
      const segment=upper(desmonteSegmentSelect.value||current?.equipo?.segmento||'');
      if(segment && [...desmonteSegmentSelect.options].some(o=>o.value===segment)) desmonteSegmentSelect.value=segment;
      segmentInput.value=desmonteSegmentSelect.value||segment;
      resultLocationInput.value=segmentInput.value==='MINTIC'?'QMINTIC':'QQ01Q1';
      physicalStateInput.value='Dañado';
      stockInput.value='4';
    }else{
      const option=locationSelect.selectedOptions[0];
      segmentInput.value=option?.dataset.segment||'';
      resultLocationInput.value=locationSelect.value||'';
      physicalStateInput.value='Bueno';
      stockInput.value='1';
    }
    proposal=null;
    previewCard.hidden=true;
    applyBtn.disabled=true;
  }

  async function loadMaster(codeValue,preferredLot=null){
    const code=text(codeValue);
    if(!code)throw new Error('Ingresa un Código SAP.');
    validateSapBtn.disabled=true;
    sapHelp.textContent='Validando Código SAP…';
    try{
      const {data,error}=await supabase.rpc('consultar_maestra_ajuste_inventario',{p_codigo_sap:code});
      if(error)throw error;
      master=data;
      sapInput.value=data.codigo_sap||code;
      const lots=Array.isArray(data.lotes)?data.lotes:[];
      if(!lots.length)throw new Error('El SAP no tiene lotes VALORADO/NOVALORADO disponibles.');
      lotSelect.innerHTML=lots.map(x=>'<option value="'+esc(x.lote)+'">'+esc(x.lote)+'</option>').join('');
      const desired=upper(preferredLot||current?.equipo?.lote||'');
      if([...lotSelect.options].some(o=>o.value===desired)) lotSelect.value=desired;
      syncMaster();
      sapHelp.textContent='SAP válido · Dominion y descripción provienen de la Maestra.';
      proposal=null;
      previewCard.hidden=true;
    }finally{
      validateSapBtn.disabled=!current?.puede_cambiar_sap;
    }
  }

  function populateEditor(){
    const e=current.equipo;
    sapInput.value=e.codigo_sap;
    sapInput.disabled=!current.puede_cambiar_sap;
    validateSapBtn.hidden=!current.puede_cambiar_sap;
    validateSapBtn.disabled=!current.puede_cambiar_sap;
    adminSapBadge.hidden=!current.puede_cambiar_sap;
    sapHelp.textContent=current.puede_cambiar_sap?'Administrador: puedes validar otro SAP.':'Código SAP bloqueado para este perfil.';
    warehouseSelect.value=e.almacen;
    typeSelect.value=e.tipo==='DESMONTE'?'DESMONTE':'LIBRE';

    if(e.tipo==='DESMONTE'){
      if([...desmonteSegmentSelect.options].some(o=>o.value===upper(e.segmento))) desmonteSegmentSelect.value=upper(e.segmento);
      inventoryStateSelect.value=e.estado_inventario==='Inversa'?'Inversa':'Garantía';
    }else{
      if([...locationSelect.options].some(o=>o.value===upper(e.ubicacion))) locationSelect.value=upper(e.ubicacion);
    }
    syncType();
  }

  async function searchSerial(){
    const serial=upper(serialInput.value);
    if(!serial){setMessage('Ingresa un serial.','error');return;}
    searchBtn.disabled=true;
    searchBtn.textContent='Consultando…';
    setMessage('Consultando el equipo y su Maestra SAP…');
    try{
      const {data,error}=await supabase.rpc('consultar_equipo_ajuste_inventario',{p_serial:serial});
      if(error)throw error;
      current=data;
      master=data.maestra;
      renderCurrent();
      renderHistory(data.historial);
      fillLocations();
      const lots=master?.lotes||[];
      lotSelect.innerHTML=lots.map(x=>'<option value="'+esc(x.lote)+'">'+esc(x.lote)+'</option>').join('');
      if([...lotSelect.options].some(o=>o.value===upper(data.equipo.lote))) lotSelect.value=upper(data.equipo.lote);
      syncMaster();
      populateEditor();
      proposal=null;
      previewCard.hidden=true;
      reasonSelect.value='';
      observationInput.value='';
      editorSection.hidden=false;
      setMessage('Equipo cargado. Modifica únicamente lo que necesites corregir.','success');
      editorSection.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){
      console.error(error);
      editorSection.hidden=true;
      current=null;
      setMessage(error.message||'No fue posible consultar el serial.','error');
    }finally{
      searchBtn.disabled=false;
      searchBtn.textContent='Consultar serial';
    }
  }

  function payload(){
    const isDesmonte=upper(typeSelect.value)==='DESMONTE';
    return {
      serial:current.equipo.serial,
      codigo_sap:text(sapInput.value),
      lote:upper(lotSelect.value),
      almacen:upper(warehouseSelect.value),
      tipo:upper(typeSelect.value),
      ubicacion:isDesmonte?'':upper(locationSelect.value),
      segmento_desmonte:isDesmonte?upper(desmonteSegmentSelect.value):'',
      estado_inventario:isDesmonte?inventoryStateSelect.value:'Disponible'
    };
  }

  function diffRows(before,after){
    const labels={
      codigo_sap:'Código SAP',dominio:'Dominion',descripcion:'Descripción',topologia:'Topología',
      lote:'Lote',centro:'Centro',almacen:'Almacén',ubicacion:'Ubicación',segmento:'Segmento',
      stock:'Stock',tipo:'Tipo',estado:'Estado físico',estado_inventario:'Estado inventario'
    };
    return Object.keys(labels).filter(key=>String(before[key]??'')!==String(after[key]??''))
      .map(key=>({key,label:labels[key],before:before[key],after:after[key]}));
  }

  function renderPreview(data){
    proposal=data;
    const changes=diffRows(data.antes||{},data.despues||{});
    changeCount.textContent=changes.length+' cambio'+(changes.length===1?'':'s');
    diffBody.innerHTML=changes.length?changes.map(row=>
      '<tr><td><strong>'+esc(row.label)+'</strong></td><td class="changed-before">'+esc(row.before??'—')+'</td><td class="changed-after">'+esc(row.after??'—')+'</td></tr>'
    ).join(''):'<tr class="empty-row"><td colspan="3">No hay cambios para aplicar.</td></tr>';
    previewCard.hidden=false;
    applyBtn.disabled=!changes.length||!reasonSelect.value;
    previewCard.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function preview(){
    if(!current)return;
    previewBtn.disabled=true;
    previewBtn.textContent='Validando…';
    setMessage('Validando la propuesta contra Maestra SAP y reglas de inventario…');
    try{
      const {data,error}=await supabase.rpc('previsualizar_ajuste_inventario',{p_payload:payload()});
      if(error)throw error;
      renderPreview(data);
      setMessage(data.hay_cambios?'Propuesta válida. Revisa el antes/después y documenta el motivo.':'No hay cambios frente al estado actual.','success');
    }catch(error){
      console.error(error);
      proposal=null;
      previewCard.hidden=true;
      setMessage(error.message||'No fue posible validar la propuesta.','error');
    }finally{
      previewBtn.disabled=false;
      previewBtn.textContent='Validar propuesta';
    }
  }

  async function apply(){
    if(!current||!proposal||!proposal.hay_cambios)return;
    if(!reasonSelect.value){setMessage('Selecciona el motivo del ajuste.','error');return;}
    if(reasonSelect.value==='OTRO'&&!text(observationInput.value)){setMessage('Escribe una observación para el motivo Otro.','error');return;}

    applyBtn.disabled=true;
    applyBtn.textContent='Aplicando…';
    setMessage('Aplicando el ajuste y registrando la trazabilidad…');
    try{
      const p={...payload(),motivo:reasonSelect.value,observacion:text(observationInput.value),version_actual:current.equipo.actualizado_en};
      const {data,error}=await supabase.rpc('registrar_ajuste_inventario',{p_payload:p});
      if(error)throw error;
      setMessage('Ajuste #'+data.ajuste_id+' aplicado correctamente al serial '+data.serial+'.','success');
      serialInput.value=data.serial;
      await searchSerial();
    }catch(error){
      console.error(error);
      setMessage(error.message||'No fue posible aplicar el ajuste.','error');
      applyBtn.disabled=false;
      applyBtn.textContent='Aplicar ajuste →';
    }
  }

  searchBtn.addEventListener('click',searchSerial);
  serialInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchSerial();}});
  validateSapBtn.addEventListener('click',()=>loadMaster(sapInput.value,lotSelect.value).catch(error=>setMessage(error.message,'error')));
  lotSelect.addEventListener('change',()=>{syncMaster();proposal=null;previewCard.hidden=true;});
  warehouseSelect.addEventListener('change',()=>{proposal=null;previewCard.hidden=true;});
  typeSelect.addEventListener('change',syncType);
  locationSelect.addEventListener('change',syncType);
  desmonteSegmentSelect.addEventListener('change',syncType);
  inventoryStateSelect.addEventListener('change',()=>{proposal=null;previewCard.hidden=true;});
  previewBtn.addEventListener('click',preview);
  reasonSelect.addEventListener('change',()=>{applyBtn.disabled=!(proposal?.hay_cambios&&reasonSelect.value);});
  observationInput.addEventListener('input',()=>{if(proposal?.hay_cambios)applyBtn.disabled=!reasonSelect.value;});
  applyBtn.addEventListener('click',apply);

  async function init(){
    try{
      const {data,error}=await supabase.rpc('consultar_catalogo_ajustes_inventario');
      if(error)throw error;
      catalog=data;
      fillLocations();
      const querySerial=upper(new URLSearchParams(window.location.search).get('serial'));
      if(querySerial){serialInput.value=querySerial;await searchSerial();}
    }catch(error){
      console.error(error);
      setMessage(error.message||'No fue posible cargar el catálogo de Ajustes.','error');
      searchBtn.disabled=true;
    }
  }

  document.addEventListener('siglo:user-ready',init,{once:true});
  if(document.body.dataset.sigloUserReady==='true')init();
});