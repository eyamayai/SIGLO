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

  function headerCell(ws,row,text,fill){
    ws.mergeCells(row,1,row,5);
    const cell=ws.getCell(row,1);
    cell.value=text;
    cell.font={name:'Calibri',size:15,bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};
    cell.alignment={vertical:'middle',horizontal:'center'};
    ws.getRow(row).height=32;
  }

  function sectionCell(ws,row,lote,count){
    ws.mergeCells(row,1,row,5);
    const cell=ws.getCell(row,1);
    cell.value=lote+'  |  '+num(count)+' RÓTULO'+(count===1?'':'S');
    cell.font={name:'Calibri',size:12,bold:true,color:{argb:'FF16354E'}};
    cell.fill={type:'pattern',pattern:'solid',
      fgColor:{argb:lote==='VALORADO'?'FFE7F3FE':'FFF1F3F6'}};
    cell.alignment={horizontal:'center',vertical:'middle'};
    ws.getRow(row).height=25;
  }

  function label(ws,col,start,item){
    const brand=ws.getCell(start,col);
    brand.value={richText:[
      {text:'DOMINION',font:{name:'Arial',size:12,bold:true,color:{argb:'FF2853A3'}}},
      {text:'   ',font:{name:'Calibri',size:12}},
      {text:'CLARO',font:{name:'Arial',size:25,bold:true,color:{argb:'FF111827'}}}
    ]};
    const description=ws.getCell(start+1,col);
    description.value=upper(item.description)||'MATERIAL SIN DESCRIPCIÓN';
    const length=description.value.length;
    description.font={name:'Arial',size:length>74?10:(length>48?12:14),
      bold:true,color:{argb:'FF101820'}};
    const lot=ws.getCell(start+2,col);
    lot.value=item.lote;
    lot.font={name:'Arial',size:14,bold:true,color:{argb:'FF101820'}};
    lot.fill={type:'pattern',pattern:'solid',fgColor:{argb:item.lote==='VALORADO'?'FFE7F3FE':'FFF2F3F5'}};
    const sap=ws.getCell(start+3,col);
    sap.value=String(item.codigo_sap);
    sap.numFmt='@';
    sap.font={name:'Arial',size:sap.value.length>9?37:46,bold:true,color:{argb:'FF050A0E'}};
    for(let i=0;i<4;i++){
      const cell=ws.getCell(start+i,col);
      cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
      cell.border={
        left:{style:'medium',color:{argb:'FF172633'}},
        right:{style:'medium',color:{argb:'FF172633'}},
        top:{style:i===0?'medium':'thin',color:{argb:'FF172633'}},
        bottom:{style:i===3?'medium':'thin',color:{argb:'FF172633'}}
      };
    }
  }

  function printGroup(ws,begin,items){
    let row=begin;
    for(let i=0;i<items.length;i+=3){
      ws.getRow(row).height=38;
      ws.getRow(row+1).height=54;
      ws.getRow(row+2).height=24;
      ws.getRow(row+3).height=69;
      ws.getRow(row+4).height=12;
      items.slice(i,i+3).forEach((item,index)=>label(ws,1+2*index,row,item));
      row+=5;
    }
    return row;
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

  async function buildWorkbook(groups,Excel){
    const wb=new Excel.Workbook();
    wb.creator='SIGLO - Sistema Integrado de Gestión de Logística y Operaciones';
    wb.created=new Date();
    wb.subject='Rótulos físicos por ubicación y lote';
    const used=new Set();
    const warehouseIsRequired=new Set(groups.map(g=>g.almacen)).size>1;

    for(const group of groups){
      const ws=wb.addWorksheet(makeSheetName(group,used,warehouseIsRequired),{
        pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
          margins:{left:.22,right:.22,top:.3,bottom:.3,header:0,footer:0},
          horizontalCentered:true}
      });
      ws.views=[{showGridLines:false}];
      ws.columns=[{width:38},{width:3},{width:38},{width:3},{width:38}];
      headerCell(ws,1,'RÓTULOS  ·  '+group.ubicacion+'  ·  ALMACÉN '+group.almacen,'FF173C5A');
      ws.mergeCells(2,1,2,5);
      const note=ws.getCell(2,1);
      note.value='SIGLO  |  '+(stock.value==='1'?'LIBRE / DISPONIBLE':'DESMONTE / INVERSA-GARANTÍA')+
        '  |  '+(snapshotAt?snapshotAt.toLocaleString('es-CO'):'')+'  |  Un rótulo por Código SAP y lote';
      note.alignment={horizontal:'center',vertical:'middle'};
      note.font={name:'Calibri',size:10,color:{argb:'FF5C7488'}};
      ws.getRow(2).height=23;
      ws.getRow(3).height=9;
      let row=4;
      for(const [lote,items] of [['VALORADO',group.valorado],['NOVALORADO',group.novalorado]]){
        if(!items.length)continue;
        sectionCell(ws,row++,lote,items.length);
        ws.getRow(row).height=9;
        row++;
        row=printGroup(ws,row,items);
        ws.getRow(row).height=9;
        row++;
      }
      ws.pageSetup.printArea='A1:E'+(row-1);
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
      const workbook=await buildWorkbook(prepared,window.ExcelJS);
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