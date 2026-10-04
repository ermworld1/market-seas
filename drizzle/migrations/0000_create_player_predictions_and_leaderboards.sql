CREATE TABLE public.player_profiles (
  user_id uuid PRIMARY KEY,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 3 AND 20 AND nickname ~ '^[A-Za-z0-9 _-]+$'),
  side text NOT NULL CHECK (side IN ('buyers', 'sellers')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.player_profiles TO authenticated;
GRANT ALL ON public.player_profiles TO service_role;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Players can read own profile" ON public.player_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Players can create own profile" ON public.player_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Players can update own profile" ON public.player_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  round_key text NOT NULL,
  round_kind text NOT NULL CHECK (round_kind IN ('winner', 'flagship')),
  battle_id bigint NOT NULL,
  choice text NOT NULL CHECK (choice IN ('buyers', 'sellers', 'sunk', 'dive', 'hold')),
  side text CHECK (side IS NULL OR side IN ('bid', 'ask')),
  bucket integer,
  price numeric,
  starts_at timestamptz NOT NULL,
  locks_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  outcome text CHECK (outcome IS NULL OR outcome IN ('buyers', 'sellers', 'draw', 'sunk', 'dive', 'hold')),
  correct boolean,
  xp_awarded integer NOT NULL DEFAULT 0 CHECK (xp_awarded >= 0),
  settled_at timestamptz,
  UNIQUE (user_id, round_key)
);
GRANT SELECT, INSERT ON public.predictions TO authenticated;
GRANT ALL ON public.predictions TO service_role;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Players can read own predictions" ON public.predictions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Players can create own predictions" ON public.predictions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX predictions_user_submitted_idx ON public.predictions (user_id, submitted_at DESC);
CREATE INDEX predictions_period_idx ON public.predictions (settled_at DESC) WHERE settled_at IS NOT NULL;
CREATE INDEX predictions_unsettled_idx ON public.predictions (ends_at) WHERE settled_at IS NULL;

CREATE OR REPLACE FUNCTION public.leaderboard_snapshot(period_key text DEFAULT 'today')
RETURNS TABLE (nickname text, side text, xp bigint, correct bigint, settled bigint, accuracy numeric, best_streak integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT CASE period_key WHEN 'today' THEN date_trunc('day', now()) WHEN 'week' THEN date_trunc('week', now()) ELSE date_trunc('month', now()) END AS since
  ), scored AS (
    SELECT p.user_id, p.correct, p.xp_awarded, p.settled_at,
      row_number() OVER (PARTITION BY p.user_id ORDER BY p.settled_at) - row_number() OVER (PARTITION BY p.user_id, p.correct ORDER BY p.settled_at) AS grp
    FROM public.predictions p, bounds b WHERE p.settled_at >= b.since AND p.correct IS NOT NULL
  ), streaks AS (
    SELECT user_id, max(n)::integer AS best_streak FROM (SELECT user_id, grp, count(*) AS n FROM scored WHERE correct GROUP BY user_id, grp) s GROUP BY user_id
  )
  SELECT pr.nickname, pr.side, coalesce(sum(s.xp_awarded), 0)::bigint,
    count(*) FILTER (WHERE s.correct)::bigint, count(s.correct)::bigint,
    CASE WHEN count(s.correct) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE s.correct) / count(s.correct), 1) END,
    coalesce(st.best_streak, 0)
  FROM public.player_profiles pr LEFT JOIN scored s ON s.user_id = pr.user_id LEFT JOIN streaks st ON st.user_id = pr.user_id
  GROUP BY pr.user_id, pr.nickname, pr.side, st.best_streak HAVING count(s.correct) > 0
  ORDER BY 3 DESC, 6 DESC, 5 DESC LIMIT 100
$$;
GRANT EXECUTE ON FUNCTION public.leaderboard_snapshot(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.side_standings(period_key text DEFAULT 'today')
RETURNS TABLE (side text, accuracy numeric, settled bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT CASE period_key WHEN 'today' THEN date_trunc('day', now()) WHEN 'week' THEN date_trunc('week', now()) ELSE date_trunc('month', now()) END AS since
  )
  SELECT pr.side,
    CASE WHEN count(p.correct) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE p.correct) / count(p.correct), 1) END,
    count(p.correct)::bigint
  FROM public.player_profiles pr JOIN public.predictions p ON p.user_id = pr.user_id, bounds b
  WHERE p.settled_at >= b.since AND p.correct IS NOT NULL GROUP BY pr.side
$$;
GRANT EXECUTE ON FUNCTION public.side_standings(text) TO anon, authenticated, service_role;