document.addEventListener('DOMContentLoaded', () => {
  const supabase=window.sigloSupabase;
  const warehouse=document.getElementById('rotulosWarehouse');
  const stock=document.getElementById('rotulosStock');
  const location=document.getElementById('rotulosLocation');
  const prepare=document.getElementById('prepareRotulosBtn');
  const exportBtn=document.getElementById('exportRotulosBtn');
  const message=document.getElementById('rotulosMessage');
  const preview=document.getElementById('rotulosPreview');
  const previewBody=document.getElementById('rotulosPreviewBody');
  const summary=document.getElementById('rotulosSummary');
  let snapshot=null;
  let prepared=[];
  let snapshotAt=null;

  const clean=value=>String(value??'').trim().replace(/\s+/g,' ');
  const upper=value=>clean(value).toUpperCase();
  const natural=(a,b)=>String(a).localeCompare(String(b),'es',{numeric:true,sensitivity:'base'});
  const num=value=>new Intl.NumberFormat('es-CO').format(value);
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");

  function showMessage(value,kind=''){
    message.textContent=value;
    message.className='report-message'+(kind?' '+kind:'');
  }

  function groupLabels(source,options){
    const individual=new Map();
    for(const raw of (Array.isArray(source)?source:[])){
      const codigo_sap=clean(raw.codigo_sap);
      const almacen=upper(raw.almacen);
      const ubicacion=upper(raw.ubicacion);
      const lote=upper(raw.lote);
      const stockValue=Number(raw.stock);
      if(!codigo_sap||!ubicacion||!almacen) continue;
      if(lote!=='VALORADO'&&lote!=='NOVALORADO') continue;
      if(stockValue!==Number(options.stock)) continue;
      if(options.warehouse!=='TODOS'&&options.warehouse!==almacen) continue;
      if(options.location!=='TODAS'&&options.location!==ubicacion) continue;
      const key=[almacen,ubicacion,lote,codigo_sap].join('|');
      const description=clean(raw.nombre_equipo || raw.descripcion || '');
      const existing=individual.get(key);
      if(!existing||(!existing.description&&description)){
        individual.set(key,{codigo_sap,almacen,ubicacion,lote,description});
      }
    }
    const groups=new Map();
    for(const item of individual.values()){
      const key=item.almacen+'|'+item.ubicacion;
      if(!groups.has(key)){
        groups.set(key,{key,almacen:item.almacen,ubicacion:item.ubicacion,
          valorado:[],novalorado:[]});
      }
      groups.get(key)[item.lote==='VALORADO'?'valorado':'novalorado'].push(item);
    }
    return [...groups.values()]
      .map(group=>{
        group.valorado.sort((a,b)=>natural(a.codigo_sap,b.codigo_sap));
        group.novalorado.sort((a,b)=>natural(a.codigo_sap,b.codigo_sap));
        return group;
      })
      .sort((a,b)=>natural(a.almacen,b.almacen)||natural(a.ubicacion,b.ubicacion));
  }

  function updateLocations(){
    const selected=location.value||'TODAS';
    const list=[...new Set((snapshot||[]).filter(row=>
      Number(row.stock)===Number(stock.value)
      && (warehouse.value==='TODOS'||upper(row.almacen)===warehouse.value)
      && clean(row.ubicacion)
    ).map(row=>upper(row.ubicacion)))].sort(natural);
    location.innerHTML='<option value="TODAS">Todas las ubicaciones</option>'+
      list.map(value=>'<option value="'+escape(value)+'">'+escape(value)+'</option>').join('');
    location.value=list.includes(selected)?selected:'TODAS';
  }

  function displayPreview(){
    prepared=groupLabels(snapshot,{warehouse:warehouse.value,stock:stock.value,location:location.value});
    const valued=prepared.reduce((sum,group)=>sum+group.valorado.length,0);
    const reused=prepared.reduce((sum,group)=>sum+group.novalorado.length,0);
    summary.textContent=prepared.length+' ubicación(es) · '+num(valued)+' VALORADO · '+num(reused)+' NOVALORADO · '+num(valued+reused)+' rótulos';
    previewBody.innerHTML=prepared.length?prepared.map(group=>
      '<tr><td><strong>'+escape(group.ubicacion)+'</strong></td><td>'+escape(group.almacen)+
      '</td><td>'+num(group.valorado.length)+'</td><td>'+num(group.novalorado.length)+
      '</td><td><strong>'+num(group.valorado.length+group.novalorado.length)+'</strong></td></tr>'
    ).join(''):'<tr class="empty-row"><td colspan="5">No hay material disponible para estos filtros.</td></tr>';
    preview.hidden=false;
    exportBtn.disabled=prepared.length===0;
  }

  [warehouse,stock].forEach(control=>control.addEventListener('change',()=>{
    if(!snapshot)return;
    updateLocations();
    displayPreview();
  }));
  location.addEventListener('change',()=>{if(snapshot)displayPreview()});

  prepare.addEventListener('click',async()=>{
    prepare.disabled=true;
    preview.hidden=true;
    exportBtn.disabled=true;
    showMessage('Consultando saldos actuales de SIGLO…');
    try{
      if(!supabase)throw new Error('No hay conexión con Supabase.');
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const {data,error}=await supabase.rpc('consultar_informes_fiscales');
      if(error)throw error;
      if(!data||!Array.isArray(data.mapa_fiscal))throw new Error('La consulta fiscal no devolvió datos válidos.');
      snapshot=data.mapa_fiscal;
      snapshotAt=new Date();
      const wh=[...new Set(snapshot.map(row=>upper(row.almacen)).filter(Boolean))].sort(natural);
      const prev=warehouse.value||'A221';
      warehouse.innerHTML='<option value="TODOS">Todos los almacenes</option>'+
        wh.map(value=>'<option value="'+escape(value)+'">'+escape(value)+'</option>').join('');
      warehouse.value=wh.includes(prev)?prev:'TODOS';
      updateLocations();
      displayPreview();
      showMessage('Inventario consultado: '+prepared.length+' hojas listas. Los rótulos no modifican existencias.','success');
      preview.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(error){
      console.error('Error preparando rótulos',error);
      snapshot=null;
      prepared=[];
      showMessage(error.message||'No fue posible preparar los rótulos.','error');
    }finally{
      prepare.disabled=false;
    }
  });

  // Rótulo físico 3 x 3 por página, tres columnas de ancho 85.
  // Las dimensiones de filas se respetan en puntos (formato Excel).
  const LABEL_COLUMNS=[1,3,5];
  const LABEL_WIDTH=85;
  const ROW_HEIGHT={claro:95.25,descripcion:89.25,lote:36.75,sap:112.5,separacion:15.75};
  const LOGO_WIDTH_PX=4/2.54*96;
  const LOGO_HEIGHT_PX=2.81/2.54*96;

  function labelBorder(index){
    const edge={style:'medium',color:{argb:'FF101010'}};
    const thin={style:'thin',color:{argb:'FF101010'}};
    return {left:edge,right:edge,top:index===0?edge:thin,bottom:index===3?edge:thin};
  }

  function label(ws,column,row,item,logoId){
    const brand=ws.getCell(row,column);
    brand.value='CLARO';
    brand.font={name:'Calibri',size:100,bold:true,color:{argb:'FF000000'}};

    const description=ws.getCell(row+1,column);
    description.value=upper(item.description)||'MATERIAL SIN DESCRIPCIÓN';
    description.font={name:'Calibri',size:36,bold:true,color:{argb:'FF000000'}};

    const lot=ws.getCell(row+2,column);
    lot.value=item.lote;
    lot.font={name:'Calibri',size:40,bold:true,color:{argb:'FF000000'}};

    const sap=ws.getCell(row+3,column);
    sap.value=String(item.codigo_sap);
    sap.numFmt='@';
    sap.font={name:'Calibri',size:110,bold:true,color:{argb:'FF000000'}};

    for(let index=0;index<4;index++){
      const cell=ws.getCell(row+index,column);
      cell.alignment={
        horizontal:'center',
        vertical:'middle',
        wrapText:true,
        shrinkToFit:index===1||index===3
      };
      cell.border=labelBorder(index);
    }

    // El texto CLARO queda centrado. Logo DOMINION pegado a su derecha,
    // dentro de la celda (4 cm de ancho x 2,81 cm de alto).
    // Estas coordenadas son relativas a la columna Excel de ancho 85.
    ws.addImage(logoId,{
      tl:{col:column-1+0.745,row:row-1+0.07},
      ext:{width:LOGO_WIDTH_PX,height:LOGO_HEIGHT_PX},
      editAs:'oneCell'
    });
  }

  function makeSheetName(group,used,requiresWarehouse){
    let name=(requiresWarehouse?group.almacen+'_':'')+group.ubicacion;
    name=name.replace(/[\\\/\?\*\[\]\:]/g,'_').slice(0,31)||'UBICACION';
    const base=name;
    let suffix=2;
    while(used.has(name)){
      name=base.slice(0,31-String(suffix).length-1)+'_'+suffix;
      suffix++;
    }
    used.add(name);
    return name;
  }

  function printLot(ws,startRow,items,logoId){
    let row=startRow;
    // Cada lote comienza en su propia página. Máximo 9 rótulos por página.
    for(let first=0;first<items.length;first+=9){
      const page=items.slice(first,first+9);
      for(let offset=0;offset<page.length;offset+=3){
        ws.getRow(row).height=ROW_HEIGHT.claro;
        ws.getRow(row+1).height=ROW_HEIGHT.descripcion;
        ws.getRow(row+2).height=ROW_HEIGHT.lote;
        ws.getRow(row+3).height=ROW_HEIGHT.sap;
        ws.getRow(row+4).height=ROW_HEIGHT.separacion;
        page.slice(offset,offset+3).forEach((item,i)=>
          label(ws,LABEL_COLUMNS[i],row,item,logoId));
        row+=5;
      }
      // Salto explícito, incluso si el lote terminó antes de llenar 9 rótulos.
      ws.getRow(row-1).addPageBreak();
    }
    return row;
  }

  async function fetchDominionLogo(){
    const response=await fetch('assets/logo-dominion-rotulos.png?v=20261021-3',{cache:'no-store'});
    if(!response.ok)throw new Error('No se pudo cargar el logo DOMINION ('+response.status+').');
    const buffer=await response.arrayBuffer();
    if(!buffer || buffer.byteLength<100)throw new Error('El archivo PNG de DOMINION está vacío o incompleto.');
    return buffer;
  }

  async function buildWorkbook(groups,Excel,logoBuffer){
    if(!logoBuffer)throw new Error('Falta la imagen PNG de DOMINION.');
    const wb=new Excel.Workbook();
    wb.creator='SIGLO - Sistema Integrado de Gestión de Logística y Operaciones';
    wb.created=new Date();
    wb.subject='Rótulos físicos por ubicación y lote';
    const logoId=wb.addImage({buffer:logoBuffer,extension:'png'});
    const used=new Set();
    const warehouseIsRequired=new Set(groups.map(g=>g.almacen)).size>1;
    for(const group of groups){
      const ws=wb.addWorksheet(makeSheetName(group,used,warehouseIsRequired),{
        pageSetup:{
          paperSize:1, // Carta (Letter), 8.5 x 11 pulgadas.
          orientation:'landscape',
          fitToPage:false,
          scale:52, // Escala conservadora para 3 x 3 en Carta horizontal.
          margins:{left:0.18,right:0.18,top:0.18,bottom:0.18,header:0,footer:0},
          horizontalCentered:true
        }
      });
      ws.views=[{showGridLines:false}];
      ws.columns=[
        {width:LABEL_WIDTH},{width:2},
        {width:LABEL_WIDTH},{width:2},
        {width:LABEL_WIDTH}
      ];

      let row=1; // Sin títulos, fechas ni barras de lote al principio.
      for(const items of [group.valorado,group.novalorado]){
        if(items.length)row=printLot(ws,row,items,logoId);
      }
      // Los saltos de página limitan cada grupo a 9 rótulos y separan los lotes.
      ws.pageSetup.printArea='A1:E'+Math.max(1,row-1);
    }
    return wb;
  }

  exportBtn.addEventListener('click',async()=>{
    if(!prepared.length)return;
    if(!window.ExcelJS){
      showMessage('No se cargó el generador ExcelJS. Comprueba la conexión a internet y recarga la página.','error');
      return;
    }
    exportBtn.disabled=true;
    const previous=exportBtn.textContent;
    exportBtn.textContent='Generando Excel…';
    showMessage('Diseñando las '+prepared.length+' pestañas para impresión…');
    try{
      const logoBuffer=await fetchDominionLogo();
      const workbook=await buildWorkbook(prepared,window.ExcelJS,logoBuffer);
      const buffer=await workbook.xlsx.writeBuffer();
      const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download='SIGLO_Rotulos_'+new Date().toISOString().slice(0,10)+'.xlsx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      showMessage('Excel generado: '+prepared.length+' hojas y '+prepared.reduce((n,g)=>n+g.valorado.length+g.novalorado.length,0)+' rótulos.','success');
    }catch(error){
      console.error('Error exportando rótulos',error);
      showMessage(error.message||'No fue posible generar el Excel de rótulos.','error');
    }finally{
      exportBtn.disabled=false;
      exportBtn.textContent=previous;
    }
  });

  // Solo lectura: los rótulos se construyen a partir de consultar_informes_fiscales.
  // No se crean documentos, movimientos ni ajustes de inventario.
});