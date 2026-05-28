# ASSFAC - Sistema Financeiro Integrado

## Project info

**URL**: https://lovable.dev/projects/be48c1c6-16e3-4010-8a93-387c25499d2d

**Produção:** https://assfac-plataforma.vercel.app | **Projeto Vercel:** migra-fox-main

### Contexto para retomada de desenvolvimento

Antes de continuar o desenvolvimento, especialmente em novas sessões de chat, leia o documento de contexto completo:

👉 **[docs/CONTEXTO_PARA_PROXIMO_CHAT.md](docs/CONTEXTO_PARA_PROXIMO_CHAT.md)**

Ele contém: situação atual da produção, versão de referência, atenção com deploys e links para toda a documentação.

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/be48c1c6-16e3-4010-8a93-387c25499d2d) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## 🚀 Deploy Rápido

### Deploy na Vercel (Recomendado)

Para fazer deploy na Vercel em **menos de 10 minutos**, siga o guia completo:

👉 **[Guia Completo de Deploy (DEPLOY.md)](./DEPLOY.md)**

#### Resumo Rápido:

1. **Conecte o repositório na Vercel**
   - Acesse [vercel.com/new](https://vercel.com/new)
   - Importe este repositório

2. **Configure variáveis de ambiente**:
   ```
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sua_chave_publica
   NODE_ENV=production
   ```

3. **Deploy automático**
   - A Vercel detecta automaticamente o projeto Vite
   - Build e deploy acontecem automaticamente

4. **Pronto!** Sua aplicação estará online em `https://seu-projeto.vercel.app`

### Configuração de Autenticação e Segurança

Após o deploy, é necessário configurar as funcionalidades de autenticação e segurança no Supabase Dashboard:

👉 **[Guia Completo de Configuração (docs/CONFIGURACAO_SUPABASE_AUTH.md)](./docs/CONFIGURACAO_SUPABASE_AUTH.md)**

**Checklist rápido:**
- [ ] Email Confirmation habilitado
- [ ] Template de email atualizado (PKCE flow)
- [ ] Leaked Password Protection habilitado
- [ ] MFA configurado (opcional)

### Deploy via Lovable

Você também pode fazer deploy via Lovable:

Simply open [Lovable](https://lovable.dev/projects/be48c1c6-16e3-4010-8a93-387c25499d2d) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
