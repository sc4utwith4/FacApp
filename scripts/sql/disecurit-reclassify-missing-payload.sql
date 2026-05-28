-- DISECURIT hardening remediation
-- Reclassifica imports inconsistentes (parse_status parsed/parse_partial sem parsed_payload)

-- 1) DRY-RUN
select id, empresa_id, parse_status, created_at
from operation_import_files
where source = 'disecurit'
  and parse_status in ('parsed', 'parse_partial')
  and parsed_payload is null
order by created_at desc;

-- 2) UPDATE + AUDIT
with broken as (
  select id, empresa_id, created_by
  from operation_import_files
  where source = 'disecurit'
    and parse_status in ('parsed', 'parse_partial')
    and parsed_payload is null
),
upd as (
  update operation_import_files o
     set parse_status = 'failed',
         error_message = coalesce(
           o.error_message,
           'Inconsistência corrigida: parse_status sem parsed_payload. Reprocessar.'
         ),
         updated_at = now()
   from broken b
  where o.id = b.id
  returning o.id, o.empresa_id, o.created_by
)
insert into integration_audit_log (
  import_file_id,
  empresa_id,
  source,
  event_type,
  status,
  message,
  details,
  created_by
)
select
  id,
  empresa_id,
  'disecurit',
  'payload_missing_reclassified',
  'failed',
  'Import reclassificado por inconsistência (parsed sem payload).',
  jsonb_build_object('action', 'reclassified_to_failed'),
  created_by
from upd;
