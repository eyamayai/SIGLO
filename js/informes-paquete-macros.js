/* SIGLO | Plantilla VBA local del Paquete Fiscal Dinámico.
 * Solo se conserva el proyecto VBA y el dibujo del botón en el navegador.
 * Nunca se guarda la BASE MAESTRA ni se envían archivos a Supabase.
 */
(function(){
  'use strict';
  const KEY='siglo_paquete_fiscal_vba_v15';

  const encode=(bytes)=>{
    const step=16384;let binary='';
    for(let i=0;i<bytes.length;i+=step){
      binary+=String.fromCharCode(...bytes.subarray(i,i+step));
    }
    return btoa(binary);
  };
  const decode=(value)=>{
    const str=atob(value),out=new Uint8Array(str.length);
    for(let i=0;i<str.length;i++)out[i]=str.charCodeAt(i);
    return out;
  };
  const requireZip=()=>{
    if(!window.JSZip)throw new Error('No se cargó el motor de archivos comprimidos (JSZip).');
    return window.JSZip;
  };
  const saved=()=>{
    try{
      const value=JSON.parse(localStorage.getItem(KEY)||'null');
      return value&&value.version===4&&value.vba&&value.drawing?value:null;
    }catch(_){return null;}
  };

  async function install(file){
    if(!file||!/\.xlsm$/i.test(file.name))throw new Error('Selecciona tu archivo .xlsm validado.');
    const bytes=await file.arrayBuffer();
    // No permitir que el módulo VBA anterior rehaga las actas con la regla obsoleta.
    if(!window.XLSX)throw new Error('No se cargó el motor de Excel.');
    const excel=window.XLSX.read(bytes,{type:'array',cellFormula:false});
    if(String(excel.Sheets?.LEEME?.D12?.v||'').trim()!=='SIGLO-FISCAL-1.5'){
      throw new Error('Esta plantilla todavía utiliza VBA anterior. Importa la versión 1.5, ejecuta ConfigurarPaqueteFiscal, guarda el .xlsm y vuelve a activarlo.');
    }
    const ZIP=requireZip(),zip=await ZIP.loadAsync(bytes);
    const bin=zip.file('xl/vbaProject.bin');
    const xml=zip.file('xl/drawings/drawing1.xml');
    const workbook=zip.file('xl/workbook.xml');
    if(!bin||!xml||!workbook){
      throw new Error('El archivo no conserva el proyecto VBA o el botón ACTUALIZAR INFORMES.');
    }
    const [project,drawing,workbookXml]=await Promise.all([
      bin.async('uint8array'),xml.async('string'),workbook.async('string')
    ]);
    if(project.length<10000||
      !/macro="\[0\]!ActualizarInformes"/.test(drawing)||
      !/name="BASE MAESTRA"/.test(workbookXml)||
      !/name="MATRIZ"/.test(workbookXml)||
      !/name="LEEME"/.test(workbookXml)){
      throw new Error('Esta plantilla no corresponde al Paquete Fiscal SIGLO con la macro validada.');
    }
    const payload={version:4,vba:encode(project),drawing};
    try{
      localStorage.setItem(KEY,JSON.stringify(payload));
    }catch(_){
      throw new Error('El navegador no permitió guardar la plantilla VBA. Revisa el almacenamiento del sitio.');
    }
    return {size:project.length};
  }

  function nextRelationshipId(rels){
    const used=new Set([...rels.matchAll(/\bId="(rId\d+)"/g)].map(m=>m[1]));
    let i=1;while(used.has('rId'+i))i++;
    return 'rId'+i;
  }

  async function attachButton(zip,drawing){
    const sheetName='xl/worksheets/sheet1.xml';
    const relPath='xl/worksheets/_rels/sheet1.xml.rels';
    const contentPath='[Content_Types].xml';
    const srcSheet=zip.file(sheetName);
    const types=zip.file(contentPath);
    if(!srcSheet||!types)throw new Error('El Excel generado carece de los componentes básicos.');

    let rels=zip.file(relPath)?await zip.file(relPath).async('string'):
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const relationId=nextRelationshipId(rels);
    if(!rels.includes('</Relationships>')){
      rels=rels.replace(/<Relationships([^>]*)\/>/,
        '<Relationships$1></Relationships>');
    }
    if(!rels.includes('</Relationships>'))throw new Error('No se pudo generar la relación del botón.');
    rels=rels.replace('</Relationships>',
      '<Relationship Id="'+relationId+'" Type="'+
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" '+
      'Target="../drawings/drawing1.xml"/></Relationships>');

    let sheet=await srcSheet.async('string');
    if(/<drawing\b/.test(sheet))throw new Error('La portada ya incluye un dibujo que requiere revisión.');
    if(!/xmlns:r=/.test(sheet)){
      sheet=sheet.replace(/<worksheet\b/,
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    }
    if(!sheet.includes('</worksheet>'))throw new Error('El XML de portada no es válido.');
    sheet=sheet.replace('</worksheet>','<drawing r:id="'+relationId+'"/></worksheet>');

    let typeXml=await types.async('string');
    if(!typeXml.includes('/xl/drawings/drawing1.xml')){
      typeXml=typeXml.replace('</Types>',
        '<Override PartName="/xl/drawings/drawing1.xml" '+
        'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
    }
    zip.file(relPath,rels);
    zip.file(sheetName,sheet);
    zip.file(contentPath,typeXml);
    zip.file('xl/drawings/drawing1.xml',drawing);
  }

  async function download(book,name){
    const template=saved();
    if(!template)throw new Error('Primero activa la plantilla .xlsm validada en este navegador.');
    if(!window.XLSX)throw new Error('No se cargó el motor Excel.');
    const ZIP=requireZip();
    book.vbaraw=decode(template.vba);
    book.Workbook=book.Workbook||{};
    book.Workbook.WBProps=book.Workbook.WBProps||{};
    book.Workbook.WBProps.CodeName='ThisWorkbook';
    const buffer=window.XLSX.write(book,{type:'array',compression:true,bookType:'xlsm'});
    const zip=await ZIP.loadAsync(buffer);
    const vba=zip.file('xl/vbaProject.bin');
    const [types,rels]=await Promise.all([
      zip.file('[Content_Types].xml')?.async('string'),
      zip.file('xl/_rels/workbook.xml.rels')?.async('string')
    ]);
    if(!vba||!types?.includes('macroEnabled.main+xml')||!rels?.includes('vbaProject')){
      throw new Error('El motor Excel no conservó las macros. No se descargará un archivo inválido.');
    }
    await attachButton(zip,template.drawing);
    const blob=await zip.generateAsync({
      type:'blob',compression:'DEFLATE',compressionOptions:{level:6}
    });
    const fileName=(name||'SIGLO_Paquete_Fiscal_Dinamico.xlsx').replace(/\.xlsx$/i,'.xlsm');
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=fileName;a.style.display='none';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return fileName;
  }

  window.SIGLOPaqueteMacro={
    active:()=>Boolean(saved()),
    install,download
  };
})();