-- manifest: marca modelos descontinuados pelo provedor (gemini-2.0-flash e gemini-3.1-pro-preview) com deprecated_at em ai_models para que não apareçam nos seletores de modelo.
update public.ai_models
   set deprecated_at = coalesce(deprecated_at, now())
 where provider = 'google'
   and model_id in ('gemini-2.0-flash', 'gemini-3.1-pro-preview');
