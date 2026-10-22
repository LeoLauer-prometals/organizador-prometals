# Organizador de Demandas · Prometals

App web para organizar demandas: **Lembretes**, **Demandas do dia**, **Demandas de terceiros** (pedidos entre colegas) e **Calendário** com o fechamento de cada dia.

- **Site:** arquivos estáticos hospedados no **GitHub Pages** (grátis).
- **Login, banco de dados e atualização em tempo real:** **Supabase** (plano grátis atende bem uma equipe).
- Cada pessoa tem a própria conta. Lembretes, demandas do dia e calendário são privados; os pedidos só são vistos por quem pediu e por quem recebeu.

```
organizador-prometals/
├── index.html        ← a página
├── styles.css        ← visual no padrão Prometals
├── app.js            ← funcionamento do app
├── config.js         ← ⚠️ você preenche com os dados do Supabase
└── supabase/
    └── schema.sql    ← cria as tabelas e as regras de acesso
```

---

## Parte 1 — Criar o banco no Supabase (10 min)

1. Entre em **https://supabase.com** e crie uma conta (pode usar o GitHub).
2. **New project**:
   - Nome: `organizador-prometals`
   - Senha do banco: gere uma e guarde num lugar seguro.
   - Região: **South America (São Paulo)**.
3. Espere o projeto ficar pronto (1–2 min).
4. No menu lateral, abra **SQL Editor → New query**.
5. Abra o arquivo `supabase/schema.sql`, copie **tudo**, cole no editor e clique em **Run**.
   Deve aparecer "Success". Em **Table Editor** vão aparecer as tabelas `perfis`, `pedidos` e `cards`.

## Parte 2 — Configurar o login (3 min)

Em **Authentication**:

1. **Sign In / Providers → Email**: deixe ligado.
2. **Confirm email**: recomendo **desligar** no começo.
   O servidor de e-mail grátis do Supabase manda só poucos e-mails por hora; com a confirmação ligada, cadastros podem travar. Se quiser a confirmação, configure depois o SMTP da empresa em **Authentication → Emails → SMTP Settings**.
3. A **URL Configuration** você preenche na Parte 4, quando tiver o endereço do site.

## Parte 3 — Colocar o site no GitHub Pages (10 min)

1. Entre em **https://github.com** e crie um repositório:
   - Nome: `organizador-prometals`
   - **Public** (no plano grátis o GitHub Pages só funciona em repositório público; o código fica visível, mas os **dados** ficam protegidos no Supabase).
2. Antes de subir, abra `config.js` e preencha:
   - `supabaseUrl`: Supabase → **Project Settings → API → Project URL**
   - `supabaseAnonKey`: Supabase → **Project Settings → API Keys → anon public**
     (se aparecerem duas abas, use a de **Legacy API keys → anon public**).
   - `dominioEmpresa`: opcional, ex. `"prometals.co"` para a tela de cadastro só aceitar e-mails da empresa.
3. No repositório, clique em **Add file → Upload files**, arraste **todos os arquivos e a pasta `supabase`**, e clique em **Commit changes**.
4. Vá em **Settings → Pages**:
   - **Source:** Deploy from a branch
   - **Branch:** `main` / `/ (root)` → **Save**
5. Em 1–2 minutos aparece o endereço, algo como
   `https://SEU-USUARIO.github.io/organizador-prometals/`

> A chave `anon public` pode ficar no código público. Quem protege os dados são as regras do `schema.sql` (cada pessoa só lê e altera o que é dela). **Nunca** coloque a chave `service_role` no `config.js`.

## Parte 4 — Ligar o endereço do site ao login (2 min)

Supabase → **Authentication → URL Configuration**:

- **Site URL:** o endereço do GitHub Pages (ex.: `https://SEU-USUARIO.github.io/organizador-prometals/`)
- **Redirect URLs:** adicione o mesmo endereço.

Sem isso, os links de "esqueci minha senha" e o login Microsoft não voltam para o app.

## Parte 5 — Testar

1. Abra o endereço do site → **Criar conta** com seu nome, e-mail e senha.
2. Num navegador anônimo (ou outro computador), crie uma segunda conta.
3. Na aba **Demandas de terceiros**, em **Pedir para um colega**, envie uma demanda para a outra conta.
4. Na outra conta, o pedido aparece sozinho, sem recarregar. Arraste para **Demandas do dia**, marque como feito, e veja o status mudar em **Enviadas por mim** na primeira conta.

Depois é só mandar o link para a equipe: cada um cria a própria conta.

---

## Opcional — Entrar com a conta Microsoft da empresa

Precisa de alguém com acesso de administrador ao **Microsoft Entra ID** (antigo Azure AD), normalmente o TI.

1. **Entra ID → App registrations → New registration**
   - Nome: `Organizador de Demandas`
   - Contas: *Accounts in this organizational directory only*
   - Redirect URI (Web): `https://SEU-PROJETO.supabase.co/auth/v1/callback`
2. Anote o **Application (client) ID** e o **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret** → copie o **Value**.
4. Supabase → **Authentication → Sign In / Providers → Azure**: ligue e preencha
   - Client ID, Secret
   - Azure Tenant URL: `https://login.microsoftonline.com/SEU-TENANT-ID`
5. No `config.js`, mude `loginMicrosoft: true` e suba o arquivo de novo no GitHub.

Aparece o botão **Entrar com Microsoft** na tela de entrada.

## Opcional — Só aceitar e-mails da empresa (no servidor)

O `dominioEmpresa` do `config.js` só avisa na tela. Para bloquear de verdade, no `schema.sql` há um trecho comentado **"(Opcional) Só aceitar e-mails da empresa"**: troque o domínio, tire os `--` do começo das linhas e rode **só esse trecho** no SQL Editor.

---

## Como atualizar o app

Edite o arquivo no GitHub (ou suba a versão nova por **Upload files**). O GitHub Pages republica sozinho em 1–2 minutos. Os dados no Supabase não são afetados.

Se o `schema.sql` mudar: **cuidado**, rodar o arquivo inteiro de novo **apaga as tabelas e os dados**. Para mudanças no banco depois de entrar em uso, rode só os comandos novos.

## Bom saber

- **Plano grátis do Supabase:** projetos sem nenhum acesso por 7 dias seguidos são pausados (é só entrar no painel e reativar; os dados ficam). Com uso diário, isso não acontece.
- **Backup:** no plano grátis não há backup automático. De vez em quando, exporte as tabelas em **Table Editor → Export → CSV**, ou passe para o plano Pro quando o app virar oficial.
- **LGPD:** os dados ficam no Supabase, na região de São Paulo. Vale registrar com o TI/jurídico onde os dados da equipe ficam guardados.
- **Tirar alguém do app:** Supabase → **Authentication → Users** → apague o usuário. Os pedidos e cards dele somem junto.
- Os itens de teste do protótipo feito no Claude **não** vêm para cá; o app começa vazio.
