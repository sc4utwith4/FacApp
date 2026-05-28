-- Corrigir função update_invites_updated_at para ter search_path fixo
CREATE OR REPLACE FUNCTION public.update_invites_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;;
