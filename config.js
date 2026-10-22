// ════════════════════════════════════════════════════════════════
//  Configuração do Organizador de Demandas
//  Preencha com os dados do seu projeto Supabase:
//  Supabase → Project Settings → API
// ════════════════════════════════════════════════════════════════
window.ORGANIZADOR_CONFIG = {
  supabaseUrl: "https://zekppyhnjytypehrjjzm.supabase.co",
  supabaseAnonKey: "sb_publishable_s2pgojjPbA7Kevulvbvg4w_BsBxnZ73",

  // Se preenchido (ex.: "prometals.co"), a tela de cadastro só aceita e-mails desse domínio.
  // Para bloquear de verdade no servidor, ligue também o trecho opcional no schema.sql.
  dominioEmpresa: "",

  // Mostra o botão "Entrar com Microsoft". Só ligue depois de configurar o
  // provedor Azure no Supabase (veja o README, parte 5).
  loginMicrosoft: false
};
