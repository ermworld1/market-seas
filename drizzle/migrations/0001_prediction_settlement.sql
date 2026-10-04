ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS start_size numeric;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS start_mark numeric;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS end_mark numeric;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS end_size numeric;
CREATE INDEX IF NOT EXISTS predictions_unsettled_idx ON public.predictions (ends_at) WHERE settled_at IS NULL;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;