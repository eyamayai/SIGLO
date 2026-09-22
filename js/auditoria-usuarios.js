document.addEventListener('DOMContentLoaded',()=>{
  const supabase=window.sigloSupabase;
  const form=document.getElementById('userForm');
  const list=document.getElementById('usersList');
  const search=document.getElementById('userSearch');
  const message=document.getElementById('userMessage');
  const inviteBtn=document.getElementById('inviteUserBtn');
  const manualAccessBtn=document.getElementById('manualAccessBtn');
  const accessLinkPanel=document.getElementById('accessLinkPanel');
  const accessLinkValue=document.getElementById('accessLinkValue');
  const copyAccessLinkBtn=document.getElementById('copyAccessLinkBtn');
  const saveBtn=document.getElementById('saveUserBtn');

  let users=[];
  let selectedId=null;

  const permissionKeys=[
    'ingresos','despachos','salidas','devoluciones','desmonte','prealerta',
    'saldos','movimientos','informes',
    'auditoria_carga','auditoria_tecnicos','auditoria_codigos','auditoria_documentos'
  ];
  const operationalKeys=['ingresos','despachos','salidas','devoluciones','desmonte','prealerta','saldos','movimientos','informes'];

  const esc=value=>String(value??'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");

  function setMessage(text='',type=''){
    message.textContent=text;
    message.className='audit-message'+(type?' '+type:'');
  }

  function authClass(status){
    const s=String(status||'').toUpperCase();
    if(s==='ACTIVO') return 'active';
    if(s==='INVITADO'||s==='PENDIENTE CLAVE'||s==='REGISTRADO') return 'invited';
    return 'no-access';
  }

  function permissionInputs(){
    return [...document.querySelectorAll('[data-permission]')];
  }

  function collectPermissions(){
    const out={};
    permissionKeys.forEach(key=>{out[key]=Boolean(document.querySelector('[data-permission="'+key+'"]')?.checked);});
    return out;
  }

  function applyPermissions(perms={},disabled=false){
    permissionInputs().forEach(input=>{
      input.checked=Boolean(perms?.[input.dataset.permission]);
      input.disabled=disabled;
      input.closest('.permission-item')?.classList.toggle('disabled',disabled);
    });
    document.getElementById('toggleAllOperational').disabled=disabled;
  }

  function allPermissions(){
    return Object.fromEntries(permissionKeys.map(key=>[key,true]));
  }

  function clearEditor(){
    selectedId=null;
    form.reset();
    document.getElementById('userId').value='';
    document.getElementById('userRole').value='OPERATIVO';
    document.getElementById('userState').value='ACTIVO';
    document.getElementById('editorTitle').textContent='Nuevo usuario';
    document.getElementById('editorSubtitle').textContent='Define los datos del usuario y marca los módulos a los que tendrá acceso.';
    document.getElementById('authStatus').textContent='SIN ACCESO';
    document.getElementById('authStatus').className='auth-badge no-access';
    document.getElementById('userEmail').disabled=false;
    applyPermissions({},false);
    inviteBtn.hidden=true;
    manualAccessBtn.hidden=true;
    accessLinkPanel.hidden=true;
    accessLinkValue.value='';
    saveBtn.textContent='Guardar y enviar invitación';
    [...list.querySelectorAll('.user-row')].forEach(row=>row.classList.remove('active'));
    setMessage('');
  }

  function selectUser(user){
    selectedId=user.id;
    document.getElementById('userId').value=user.id;
    document.getElementById('fullName').value=user.nombre||'';
    document.getElementById('username').value=user.username||'';
    document.getElementById('userEmail').value=user.correo||'';
    document.getElementById('userRole').value=user.rol||'OPERATIVO';
    document.getElementById('userState').value=user.estado||'ACTIVO';
    document.getElementById('editorTitle').textContent=user.username||user.nombre||'Usuario';
    document.getElementById('editorSubtitle').textContent=user.correo||'';
    document.getElementById('authStatus').textContent=user.auth_estado||'SIN ACCESO';
    document.getElementById('authStatus').className='auth-badge '+authClass(user.auth_estado);
    document.getElementById('userEmail').disabled=Boolean(user.auth_user_id);

    const isAdmin=user.rol==='ADMINISTRADOR';
    applyPermissions(isAdmin?allPermissions():(user.permisos||{}),isAdmin);

    const accessReady=user.auth_estado==='ACTIVO';
    const hasAuth=Boolean(user.auth_user_id);
    inviteBtn.hidden=user.estado!=='ACTIVO' || accessReady || hasAuth;
    inviteBtn.textContent='Enviar invitación';
    manualAccessBtn.hidden=user.estado!=='ACTIVO' || accessReady;
    accessLinkPanel.hidden=true;
    accessLinkValue.value='';
    saveBtn.textContent='Guardar cambios';

    [...list.querySelectorAll('.user-row')].forEach(row=>row.classList.toggle('active',Number(row.dataset.id)===Number(user.id)));
    setMessage('');
  }

  function renderList(){
    const q=String(search.value||'').trim().toLowerCase();
    const filtered=users.filter(user=>[
      user.nombre,user.username,user.correo,user.rol,user.estado
    ].some(value=>String(value||'').toLowerCase().includes(q)));

    list.innerHTML=filtered.length?filtered.map(user=>
      '<div class="user-row" data-id="'+user.id+'">'+
        '<div class="user-row-top"><strong>'+esc(user.username||user.nombre)+'</strong><span class="auth-badge '+authClass(user.auth_estado)+'">'+esc(user.auth_estado||'SIN ACCESO')+'</span></div>'+
        '<small>'+esc(user.nombre||'')+'</small>'+
        '<small>'+esc(user.correo||'')+'</small>'+
        '<div class="user-row-meta">'+
          '<span class="mini-badge '+(user.rol==='ADMINISTRADOR'?'admin':'')+'">'+esc(user.rol||'OPERATIVO')+'</span>'+
          '<span class="mini-badge '+(user.estado==='ACTIVO'?'active':'inactive')+'">'+esc(user.estado||'')+'</span>'+
        '</div>'+
      '</div>'
    ).join(''):'<div class="users-empty">No se encontraron usuarios.</div>';

    list.querySelectorAll('.user-row').forEach(row=>{
      row.addEventListener('click',()=>{
        const user=users.find(item=>Number(item.id)===Number(row.dataset.id));
        if(user) selectUser(user);
      });
    });

    document.getElementById('statUsers').textContent=users.length;
    document.getElementById('statActive').textContent=users.filter(u=>u.estado==='ACTIVO').length;
    document.getElementById('statAccess').textContent=users.filter(u=>u.auth_estado==='ACTIVO').length;
  }

  async function loadUsers(selectAfter=null){
    const {data,error}=await supabase.rpc('consultar_usuarios_siglo');
    if(error) throw error;
    users=Array.isArray(data)?data:[];
    renderList();

    if(selectAfter){
      const user=users.find(u=>Number(u.id)===Number(selectAfter));
      if(user) selectUser(user);
    }else if(selectedId){
      const user=users.find(u=>Number(u.id)===Number(selectedId));
      if(user) selectUser(user);
      else clearEditor();
    }
  }

  async function invite(email){
    setMessage('Enviando invitación a '+email+'…');
    inviteBtn.disabled=true;
    try{
      const {data,error}=await supabase.functions.invoke('siglo-admin-users',{
        body:{action:'invite',email}
      });
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      setMessage(data?.message||'Invitación enviada correctamente.','success');
      await loadUsers(selectedId);
      return true;
    }catch(error){
      console.error('Error enviando invitación',error);
      let detail=error?.message||'No fue posible enviar la invitación.';
      let suggestManual=false;
      try{
        if(error?.context){
          const body=await error.context.json();
          if(body?.error) detail=body.error;
          suggestManual=Boolean(body?.suggest_manual);
        }
      }catch(_){}
      if(/rate limit/i.test(detail)) detail='Supabase alcanzó temporalmente el límite de correos. Genera un enlace de acceso y compártelo directamente con el usuario.';
      if(suggestManual || /límite de correos|rate limit/i.test(detail)) manualAccessBtn.hidden=false;
      setMessage(detail,'error');
      return false;
    }finally{
      inviteBtn.disabled=false;
    }
  }


  async function generateAccessLink(email){
    if(!email) return false;
    setMessage('Generando enlace seguro de acceso para '+email+'…');
    manualAccessBtn.disabled=true;
    try{
      const {data,error}=await supabase.functions.invoke('siglo-admin-users',{
        body:{action:'activation_link',email}
      });
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      if(!data?.activation_link) throw new Error('Supabase no devolvió el enlace de acceso.');

      accessLinkValue.value=data.activation_link;
      accessLinkPanel.hidden=false;
      setMessage('Enlace generado correctamente. Compártelo únicamente con este usuario.','success');
      await loadUsers(selectedId);
      accessLinkPanel.hidden=false;
      accessLinkValue.value=data.activation_link;
      return true;
    }catch(error){
      console.error('Error generando enlace de acceso',error);
      let detail=error?.message||'No fue posible generar el enlace de acceso.';
      try{
        if(error?.context){
          const body=await error.context.json();
          if(body?.error) detail=body.error;
        }
      }catch(_){}
      setMessage(detail,'error');
      return false;
    }finally{
      manualAccessBtn.disabled=false;
    }
  }

  manualAccessBtn.addEventListener('click',async()=>{
    const user=users.find(u=>Number(u.id)===Number(selectedId));
    if(!user) return;
    await generateAccessLink(user.correo);
  });

  copyAccessLinkBtn.addEventListener('click',async()=>{
    const link=accessLinkValue.value.trim();
    if(!link) return;
    try{
      await navigator.clipboard.writeText(link);
      setMessage('Enlace copiado. Envíalo únicamente al usuario correspondiente.','success');
    }catch(_){
      accessLinkValue.focus();
      accessLinkValue.select();
      document.execCommand('copy');
      setMessage('Enlace copiado. Envíalo únicamente al usuario correspondiente.','success');
    }
  });

  document.getElementById('newUserBtn').addEventListener('click',clearEditor);
  document.getElementById('cancelUserBtn').addEventListener('click',clearEditor);
  search.addEventListener('input',renderList);

  document.getElementById('userRole').addEventListener('change',e=>{
    const admin=e.target.value==='ADMINISTRADOR';
    applyPermissions(admin?allPermissions():collectPermissions(),admin);
    if(admin) setMessage('Los Administradores tienen acceso completo a SIGLO.','success');
    else setMessage('');
  });

  document.getElementById('toggleAllOperational').addEventListener('click',()=>{
    const inputs=operationalKeys.map(key=>document.querySelector('[data-permission="'+key+'"]')).filter(Boolean);
    const shouldCheck=inputs.some(input=>!input.checked);
    inputs.forEach(input=>{input.checked=shouldCheck;});
  });

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    setMessage('');

    const id=document.getElementById('userId').value;
    const payload={
      id:id||null,
      nombre:document.getElementById('fullName').value.trim(),
      username:document.getElementById('username').value.trim(),
      correo:document.getElementById('userEmail').value.trim().toLowerCase(),
      rol:document.getElementById('userRole').value,
      estado:document.getElementById('userState').value,
      permisos:collectPermissions()
    };

    if(!payload.nombre||!payload.username||!payload.correo){
      setMessage('Nombre, Username y Correo son obligatorios.','error');
      return;
    }

    saveBtn.disabled=true;
    const isNew=!id;
    saveBtn.textContent=isNew?'Creando…':'Guardando…';

    try{
      const {data,error}=await supabase.rpc('guardar_usuario_siglo',{p_payload:payload});
      if(error) throw error;
      selectedId=data?.id||Number(id)||null;
      setMessage(isNew?'Usuario creado correctamente.':'Cambios guardados correctamente.','success');
      await loadUsers(selectedId);

      if(isNew && payload.estado==='ACTIVO'){
        await invite(payload.correo);
      }
    }catch(error){
      console.error('Error guardando usuario',error);
      setMessage(error.message||'No fue posible guardar el usuario.','error');
    }finally{
      saveBtn.disabled=false;
      saveBtn.textContent=isNew?'Guardar y enviar invitación':'Guardar cambios';
    }
  });

  inviteBtn.addEventListener('click',async()=>{
    const user=users.find(u=>Number(u.id)===Number(selectedId));
    if(!user) return;
    await invite(user.correo);
  });

  document.addEventListener('siglo:user-ready',()=>loadUsers().catch(error=>{
    console.error(error);
    list.innerHTML='<div class="users-empty">No fue posible cargar los usuarios.</div>';
    setMessage(error.message||'No fue posible consultar Usuarios.','error');
  }),{once:true});

  if(document.body.dataset.sigloUserReady==='true'){
    loadUsers().catch(error=>{
      console.error(error);
      list.innerHTML='<div class="users-empty">No fue posible cargar los usuarios.</div>';
      setMessage(error.message||'No fue posible consultar Usuarios.','error');
    });
  }

  clearEditor();
});