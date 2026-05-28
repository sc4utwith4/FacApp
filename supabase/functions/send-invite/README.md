# Edge Function: send-invite

## Descrição

Edge Function que envia convite por email para novos usuários. Utiliza `admin.inviteUserByEmail()` do Supabase Auth para enviar email automaticamente.

## Secrets Necessários

A função requer os seguintes secrets configurados no Supabase:

1. **`SUPABASE_SERVICE_ROLE_KEY`**
   - Onde obter: Supabase Dashboard → Settings → API → service_role key
   - Importante: NÃO use a anon key, use a service_role key (secret)

2. **`SUPABASE_URL`**
   - Onde obter: Supabase Dashboard → Settings → API → Project URL
   - Formato: `https://your-project.supabase.co`

3. **`INVITE_REDIRECT_URL`** (opcional)
   - Valor padrão: `${SUPABASE_URL}/accept-invite`
   - Valor recomendado: `https://migra-fox-main.vercel.app/accept-invite`
   - URL completa do frontend onde o usuário será redirecionado

## Como Configurar Secrets

### Via Supabase Dashboard

1. Acesse: Supabase Dashboard → Settings → Edge Functions → Secrets
2. Clique em "Add new secret"
3. Adicione cada secret:
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: [cole a service_role key]
   - Repita para os outros secrets

### Via CLI

```bash
# Fazer login
supabase login

# Linkar projeto
supabase link --project-ref your-project-ref

# Adicionar secrets
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set INVITE_REDIRECT_URL=https://migra-fox-main.vercel.app/accept-invite
```

## Como Testar

### Listar Secrets Configurados

```bash
supabase functions secrets list
```

### Testar Localmente

```bash
# 1. Servir função localmente
supabase functions serve send-invite

# 2. Testar via HTTP
curl -X POST http://localhost:54321/functions/v1/send-invite \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "empresa_id": "00000000-0000-0000-0000-000000000001",
    "perfil": "Operacional",
    "invited_by": "USER_ID"
  }'
```

### Testar em Produção

```bash
# 1. Obter anon key do Supabase Dashboard
# Settings → API → anon public key

# 2. Testar via HTTP
curl -X POST https://your-project.supabase.co/functions/v1/send-invite \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "empresa_id": "00000000-0000-0000-0000-000000000001",
    "perfil": "Operacional",
    "invited_by": "USER_ID"
  }'
```

### Verificar Logs

1. No Supabase Dashboard → Edge Functions → `send-invite`
2. Clique em "Logs" para ver execuções recentes
3. Verifique se há erros ou avisos

## Request Body

```json
{
  "email": "user@example.com",
  "empresa_id": "00000000-0000-0000-0000-000000000001",
  "perfil": "Operacional",
  "invited_by": "uuid-do-super-admin"
}
```

### Campos Obrigatórios

- `email`: Email do usuário a ser convidado
- `empresa_id`: UUID da empresa (FK para `empresas.id`)
- `invited_by`: UUID do usuário que está enviando o convite (FK para `profiles.id`)

### Campos Opcionais

- `perfil`: Perfil do usuário (padrão: "Operacional")

## Response

### Sucesso (200)

```json
{
  "success": true,
  "message": "Invite sent successfully",
  "invite": {
    "id": "uuid",
    "email": "user@example.com",
    "status": "pending",
    ...
  }
}
```

### Erro (400/500)

```json
{
  "error": "Error message",
  "details": "Error stack trace"
}
```

## Fluxo Completo

1. **Super Admin** envia convite via frontend (`Usuarios.tsx`)
2. **Frontend** chama Edge Function `send-invite`
3. **Edge Function**:
   - Valida dados
   - Verifica se email já está cadastrado
   - Verifica se já existe convite pendente
   - Chama `admin.inviteUserByEmail()` para enviar email
   - Cria registro na tabela `invites`
4. **Usuário** recebe email com link de convite
5. **Usuário** clica no link e é redirecionado para `/accept-invite`
6. **Frontend** valida convite e permite cadastro
7. **Trigger** `handle_new_user()` valida convite e cria perfil
8. **Trigger** marca convite como aceito

## Troubleshooting

### Erro: "SUPABASE_SERVICE_ROLE_KEY not found"

- Verifique se o secret foi configurado corretamente
- Use `supabase functions secrets list` para verificar

### Erro: "Email already registered"

- O email já está cadastrado em `auth.users`
- Não é possível enviar convite para email já cadastrado

### Erro: "Pending invite already exists"

- Já existe um convite pendente para este email
- Cancele o convite anterior ou aguarde expiração

### Email não é enviado

- Verifique se `admin.inviteUserByEmail()` está funcionando
- Verifique logs da Edge Function
- Verifique configurações de email no Supabase Dashboard

---

**Última atualização**: 2025-01-27
