// Cliente Supabase de SIGLO.
// La publishable key está diseñada para uso en frontend; la seguridad real se controla
// con Supabase Auth, RLS y permisos de base de datos.
(() => {
  const url = 'https://wjqlcdjbfqhkfwbkifgv.supabase.co';
  const key = 'sb_publishable_s85_J0zBIfkRqSvcYTbNYg_AIxNSYyE';

  if (!window.supabase?.createClient) {
    console.error('No se pudo cargar Supabase JS.');
    return;
  }

  window.sigloSupabase = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
})();
