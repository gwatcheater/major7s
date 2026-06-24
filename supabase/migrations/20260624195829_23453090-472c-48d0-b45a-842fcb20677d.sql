DELETE FROM public.email_send_log
WHERE template_name = 'admin-new-user'
  AND created_at > now() - interval '48 hours'
  AND (
    error_message ILIKE '%bpurkiss@tullib.com%' OR
    error_message ILIKE '%finlaysaunders@hotmail.com%' OR
    error_message ILIKE '%michael_miraglia@msn.com%' OR
    error_message ILIKE '%mary.thorp@jervislodge.com%' OR
    error_message ILIKE '%lholmes1481@gmail.com%' OR
    error_message ILIKE '%pridaym@gtlaw.com%'
  );

DELETE FROM public.email_send_log
WHERE template_name = 'migration-welcome'
  AND recipient_email = 'freddie@rjparker.co.uk'
  AND created_at > now() - interval '48 hours';