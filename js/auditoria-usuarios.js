document.addEventListener('DOMContentLoaded',()=>{
  const supabase=window.sigloSupabase;
  const form=document.getElementById('userForm');
  const list=document.getElementById('usersList');
  const search=document.getElementById('userSearch');
  const message=document.getElementById('userMessage');
  const resetAccessBtn=document.getElementById('resetAccessBtn');
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
    permissionKeys.forEach(key=>{
      out[key]=Boolean(document.querySelector('[data-permission="'+key+'"]')?.checked);
    });
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
    resetAccessBtn.hidden=true;
    saveBtn.textContent='Guardar usuario';
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

    resetAccessBtn.hidden=!(user.estado==='ACTIVO' && user.auth_estado==='ACTIVO');
    saveBtn.textContent='Guardar cambios';

    [...list.querySelectorAll('.user-row')].forEach(row=>{
      row.classList.toggle('active',Number(row.dataset.id)===Number(user.id));
    });
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
    const inputs=operationalKeys
      .map(key=>document.querySelector('[data-permission="'+key+'"]'))
      .filter(Boolean);
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
      await loadUsers(selectedId);

      if(isNew && payload.estado==='ACTIVO'){
        setMessage('Usuario creado. Ya puede usar “Crear acceso inicial” en el Login con su Correo y Username.','success');
      }else{
        setMessage('Cambios guardados correctamente.','success');
      }
    }catch(error){
      console.error('Error guardando usuario',error);
      setMessage(error.message||'No fue posible guardar el usuario.','error');
    }finally{
      saveBtn.disabled=false;
      saveBtn.textContent=isNew?'Guardar usuario':'Guardar cambios';
    }
  });

  resetAccessBtn.addEventListener('click',async()=>{
    const user=users.find(u=>Number(u.id)===Number(selectedId));
    if(!user) return;

    resetAccessBtn.disabled=true;
    setMessage('Reiniciando el acceso de '+user.username+'…');

    try{
      const {data,error}=await supabase.functions.invoke('siglo-admin-users',{
        body:{action:'reset_initial_access',email:user.correo}
      });
      if(error){
        let detail=error.message||'No fue posible reiniciar el acceso.';
        try{
          if(error.context){
            const body=await error.context.json();
            if(body?.error) detail=body.error;
          }
        }catch(_){}
        throw new Error(detail);
      }
      if(data?.error) throw new Error(data.error);

      await loadUsers(selectedId);
      setMessage('Acceso reiniciado. El usuario debe usar “Crear acceso inicial” para definir una nueva contraseña.','success');
    }catch(error){
      console.error('Error reiniciando acceso',error);
      setMessage(error.message||'No fue posible reiniciar el acceso.','error');
    }finally{
      resetAccessBtn.disabled=false;
    }
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