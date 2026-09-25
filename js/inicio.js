document.addEventListener('DOMContentLoaded',()=>{
  const supabase=window.sigloSupabase;
  const activityList=document.getElementById('activityList');
  const alertList=document.getElementById('alertList');
  const periodButtons=[...document.querySelectorAll('.period-button')];
  const refreshLabel=document.getElementById('dashboardRefresh');
  let currentDays=7;

  const esc=value=>String(value??'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");

  function displayUser(value){
    const raw=String(value||'Usuario SIGLO').split('@')[0];
    return raw.replace(/[._-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());
  }

  function relativeTime(value){
    if(!value) return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    const diff=Math.max(0,Date.now()-date.getTime());
    const min=Math.floor(diff/60000);
    if(min<1) return 'ahora';
    if(min<60) return 'hace '+min+' min';
    const hours=Math.floor(min/60);
    if(hours<24) return 'hace '+hours+' h';
    const days=Math.floor(hours/24);
    return days===1?'ayer':'hace '+days+' días';
  }

  function activityMeta(row){
    const units=Number(row.unidades||0);
    const unitText=units===1?'1 elemento':new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(units)+' elementos';
    const type=String(row.tipo||'').toUpperCase();
    if(type==='DESPACHO' && row.tecnico) return unitText+' · Técnico: '+row.tecnico;
    if(type==='SALIDA'){
      const subtype=String(row.observacion||'').replace(/^Subtipo:\s*/i,'').trim();
      return unitText+(subtype?' · '+subtype:'');
    }
    if(type==='PREALERTA') return unitText+' recogidos';
    if(type==='CARGA INICIAL') return unitText+' cargados inicialmente';
    return unitText;
  }

  function activityVerb(type){
    const t=String(type||'').toUpperCase();
    const map={
      'INGRESO':['IN','registró el ingreso',''],
      'DESPACHO':['DES','registró el despacho','out'],
      'CONSUMO':['CON','registró consumos','return'],
      'SALIDA':['SAL','procesó la salida','out'],
      'DEVOLUCION':['DEV','registró la devolución','return'],
      'DESMONTE':['DSM','registró Desmonte','desmonte'],
      'PREALERTA':['PRE','registró la Prealerta','prealert'],
      'CARGA INICIAL':['CI','realizó Carga Inicial','initial']
    };
    return map[t]||['MOV','registró',''];
  }

  function renderActivity(rows){
    const visible=(Array.isArray(rows)?rows:[]).slice(0,6);
    if(!visible.length){
      activityList.innerHTML='<div class="empty-dashboard">No hay actividad registrada en este periodo.</div>';
      return;
    }

    activityList.innerHTML=visible.map(row=>{
      const [abbr,verb,cls]=activityVerb(row.tipo);
      return '<div class="activity-item">'+
        '<div class="activity-icon '+cls+'">'+esc(abbr)+'</div>'+
        '<div class="activity-copy">'+
          '<strong>'+esc(displayUser(row.usuario))+' '+esc(verb)+' '+esc(row.documento||'')+'</strong>'+
          '<span>'+esc(activityMeta(row))+'</span>'+
        '</div>'+
        '<div class="activity-time">'+esc(relativeTime(row.creado_en))+'</div>'+
      '</div>';
    }).join('');
  }

  function renderAlerts(rows){
    const visible=(Array.isArray(rows)?rows:[]).slice(0,4);
    document.getElementById('alertsBadge').textContent=visible.length+' activa'+(visible.length===1?'':'s');

    if(!visible.length){
      alertList.innerHTML='<div class="empty-dashboard">Sin alertas activas. El inventario no presenta agotados recientes.</div>';
      return;
    }

    alertList.innerHTML=visible.map(row=>
      '<div class="alert-item">'+
        '<div class="alert-dot">!</div>'+
        '<div class="alert-copy">'+
          '<strong>Material agotado · SAP '+esc(row.codigo_sap)+'</strong>'+
          '<span>'+esc(row.descripcion||'Sin descripción')+' · sin existencia LIBRE disponible.</span>'+
        '</div>'+
      '</div>'
    ).join('');
  }

  async function loadDashboard(days=currentDays){
    if(!supabase) return;
    refreshLabel.textContent='Actualizando…';

    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){window.location.replace('index.html');return;}

      const {data,error}=await supabase.rpc('consultar_inicio_dashboard',{p_dias:days});
      if(error) throw error;

      const k=data?.kpis||{};
      document.getElementById('kpiOperations').textContent=k.operaciones_hoy||0;
      document.getElementById('kpiEntries').textContent=k.ingresos_hoy||0;
      document.getElementById('kpiOuts').textContent=k.salidas_hoy||0;
      document.getElementById('kpiAlerts').textContent=k.alertas_activas||0;
      document.getElementById('activitySubtitle').textContent=days===1
        ? 'Operaciones procesadas hoy'
        : 'Operaciones procesadas en los últimos '+days+' días';

      renderActivity(data?.actividad||[]);
      renderAlerts(data?.alertas||[]);

      const now=new Date();
      refreshLabel.textContent='Actualizado '+now.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
    }catch(error){
      console.error('Error consultando inicio',error);
      activityList.innerHTML='<div class="empty-dashboard">No fue posible cargar la actividad reciente.</div>';
      alertList.innerHTML='<div class="empty-dashboard">No fue posible consultar las alertas.</div>';
      refreshLabel.textContent='Error de actualización';
    }
  }

  periodButtons.forEach(button=>{
    button.addEventListener('click',()=>{
      currentDays=Number(button.dataset.days||7);
      periodButtons.forEach(item=>item.classList.toggle('active',item===button));
      loadDashboard(currentDays);
    });
  });

  loadDashboard();
});