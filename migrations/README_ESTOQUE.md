# Migration: Criar Tabelas de Estoque

## Como Aplicar

1. Acesse o Supabase Dashboard: https://app.supabase.com/project/nljaapgnuhjxiywzrknn
2. Vá para SQL Editor
3. Cole o conteúdo do arquivo `create_estoque_tables.sql`
4. Execute o script

## O que esta migration cria

- **estoques**: Tabela principal de estoques (SPPRO e SOI)
- **operacoes_estoque**: Tabela de operações de entrada/saída
- **movimentacoes_estoque**: Tabela de movimentações relacionadas

## Segurança

- RLS habilitado em todas as tabelas
- Políticas baseadas em empresa_id do usuário
- Função `get_user_empresa_id()` para segurança

## Performance

- Índices criados para consultas frequentes
- Triggers para atualização automática de `updated_at`














