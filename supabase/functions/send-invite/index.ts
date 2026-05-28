import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Obter service_role key das secrets
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseServiceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not found');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not found');
    }

    // Criar cliente admin
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Obter dados do request
    const { email, empresa_id, perfil, invited_by } = await req.json();

    // Validar dados
    if (!email || !empresa_id || !invited_by) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, empresa_id, invited_by' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validar formato de email
    if (!email.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verificar se email já está cadastrado
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('Error listing users:', listError);
      // Continuar mesmo se falhar, pois pode ser problema de permissão
    } else {
      const userExists = existingUsers?.users?.some(u => u.email === email);
      if (userExists) {
        return new Response(
          JSON.stringify({ error: 'Email already registered' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Verificar se já existe convite pendente
    const { data: existingInvite } = await supabaseAdmin
      .from('invites')
      .select('id, status')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      return new Response(
        JSON.stringify({ error: 'Pending invite already exists for this email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Obter URL de redirecionamento
    const redirectUrl = Deno.env.get('INVITE_REDIRECT_URL') || 
      `${supabaseUrl.replace('/rest/v1', '')}/accept-invite`;

    // Enviar convite via Supabase Auth
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          empresa_id,
          perfil: perfil || 'Operacional',
        },
        redirectTo: `${redirectUrl}?type=invite&email=${encodeURIComponent(email)}`,
      }
    );

    if (inviteError) {
      console.error('Error inviting user:', inviteError);
      throw inviteError;
    }

    // Criar registro na tabela invites
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: inviteRecord, error: inviteRecordError } = await supabaseAdmin
      .from('invites')
      .insert({
        email,
        empresa_id,
        perfil: perfil || 'Operacional',
        invited_by,
        token: inviteData?.user?.id || null,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (inviteRecordError) {
      console.error('Error creating invite record:', inviteRecordError);
      // Não falhar se convite foi enviado mas registro falhou
      // Mas retornar aviso
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Invite sent successfully, but failed to create invite record',
          warning: inviteRecordError.message,
          invite: null,
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Invite sent successfully',
        invite: inviteRecord,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error sending invite:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : String(error),
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});


