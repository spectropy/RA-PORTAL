-- Recalculate class, school, and all-school ranks using the agreed cohort scopes.
-- RANK() gives equal percentages the same rank and leaves gaps after ties.

CREATE OR REPLACE FUNCTION public.recalculate_class_school_ranks_for(
  p_school_id text,
  p_program text,
  p_exam_pattern text,
  p_class text,
  p_section text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  WITH class_ranked AS (
    SELECT
      e.id,
      RANK() OVER (
        PARTITION BY e.school_id, e.program, e.exam_pattern, e.class, e.section
        ORDER BY e.percentage::numeric DESC NULLS LAST
      ) AS class_rank_value
    FROM public.exams AS e
    WHERE e.school_id::text IS NOT DISTINCT FROM p_school_id
      AND e.program::text IS NOT DISTINCT FROM p_program
      AND e.exam_pattern::text IS NOT DISTINCT FROM p_exam_pattern
      AND e.class::text IS NOT DISTINCT FROM p_class
      AND e.section::text IS NOT DISTINCT FROM p_section
  ),
  school_ranked AS (
    SELECT
      e.id,
      RANK() OVER (
        PARTITION BY e.school_id, e.program, e.exam_pattern, e.class
        ORDER BY e.percentage::numeric DESC NULLS LAST
      ) AS school_rank_value
    FROM public.exams AS e
    WHERE e.school_id::text IS NOT DISTINCT FROM p_school_id
      AND e.program::text IS NOT DISTINCT FROM p_program
      AND e.exam_pattern::text IS NOT DISTINCT FROM p_exam_pattern
      AND e.class::text IS NOT DISTINCT FROM p_class
  )
  UPDATE public.exams AS e
  SET
    class_rank = COALESCE(class_ranked.class_rank_value::text, e.class_rank),
    school_rank = school_ranked.school_rank_value::text
  FROM school_ranked
  LEFT JOIN class_ranked ON class_ranked.id = school_ranked.id
  WHERE e.id = school_ranked.id;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_all_india_ranks_for(
  p_exam_pattern text,
  p_class text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  WITH ranked AS (
    SELECT
      e.id,
      RANK() OVER (
        PARTITION BY e.exam_pattern, e.class
        ORDER BY e.percentage::numeric DESC NULLS LAST
      ) AS all_india_rank_value
    FROM public.exams AS e
    WHERE e.exam_pattern::text IS NOT DISTINCT FROM p_exam_pattern
      AND e.class::text IS NOT DISTINCT FROM p_class
  )
  UPDATE public.exams AS e
  SET all_schools_rank = ranked.all_india_rank_value::text
  FROM ranked
  WHERE e.id = ranked.id;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

-- Recalculate batch-level ranks from the stored total exam averages.
-- School batch rank spans sections and dates within a school/program/pattern/class.
-- All-schools batch rank spans schools and programs within a pattern/class.
CREATE OR REPLACE FUNCTION public.recalculate_batch_grade_ranks_for(
  p_exam_pattern text,
  p_class text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  WITH batch_scores AS (
    SELECT
      e.school_id,
      e.program,
      e.exam_pattern,
      e.class,
      e.section,
      e.exam_date,
      MAX(e.total_exam_per_avg) AS batch_average
    FROM public.exams AS e
    WHERE e.exam_pattern::text IS NOT DISTINCT FROM p_exam_pattern
      AND e.class::text IS NOT DISTINCT FROM p_class
      AND e.student_id IS NOT NULL
      AND e.total_exam_per_avg IS NOT NULL
    GROUP BY
      e.school_id,
      e.program,
      e.exam_pattern,
      e.class,
      e.section,
      e.exam_date
  ),
  ranked_batches AS (
    SELECT
      b.*,
      DENSE_RANK() OVER (
        PARTITION BY b.school_id, b.program, b.exam_pattern, b.class
        ORDER BY b.batch_average DESC
      )::integer AS school_grade_rank_value,
      DENSE_RANK() OVER (
        PARTITION BY b.exam_pattern, b.class
        ORDER BY b.batch_average DESC
      )::integer AS all_schools_grade_rank_value
    FROM batch_scores AS b
  )
  UPDATE public.exams AS e
  SET
    school_grade_rank = ranked_batches.school_grade_rank_value,
    all_schools_grade_rank = ranked_batches.all_schools_grade_rank_value
  FROM ranked_batches
  WHERE e.school_id = ranked_batches.school_id
    AND e.program = ranked_batches.program
    AND e.exam_pattern = ranked_batches.exam_pattern
    AND e.class = ranked_batches.class
    AND e.section = ranked_batches.section
    AND e.exam_date IS NOT DISTINCT FROM ranked_batches.exam_date;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_class_school_ranks_for(text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_all_india_ranks_for(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_batch_grade_ranks_for(text, text)
  TO service_role;

-- Backfill every existing cohort so stored ranks match the new scopes immediately.
DO $$
DECLARE
  cohort record;
BEGIN
  FOR cohort IN
    SELECT DISTINCT school_id::text AS school_id, program::text AS program,
      exam_pattern::text AS exam_pattern, class::text AS class, section::text AS section
    FROM public.exams
  LOOP
    PERFORM public.recalculate_class_school_ranks_for(
      cohort.school_id, cohort.program, cohort.exam_pattern, cohort.class, cohort.section
    );
  END LOOP;

  FOR cohort IN
    SELECT DISTINCT exam_pattern::text AS exam_pattern, class::text AS class
    FROM public.exams
  LOOP
    PERFORM public.recalculate_all_india_ranks_for(
      cohort.exam_pattern, cohort.class
    );
    PERFORM public.recalculate_batch_grade_ranks_for(
      cohort.exam_pattern, cohort.class
    );
  END LOOP;
END;
$$;
