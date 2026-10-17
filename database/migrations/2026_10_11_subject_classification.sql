-- ============================================================================
-- Migration: Add Major/Minor Subject Classification to Registrar Curriculum Subjects
-- Date: 2026-10-11
-- Description:
--   Adds `classification` ENUM('MAJOR', 'MINOR') NULL DEFAULT NULL to `subjects`.
--   Note: In AssistPay's schema, `subjects` is scoped per `curriculum_id`
--   (curriculum-subject level), so the same subject code across different
--   programs or curriculum versions can hold its own official classification.
--   Existing subjects remain NULL (Unclassified) until explicitly classified
--   by authorized Registrar personnel—no automatic guessing from subject codes
--   or descriptions is performed.
-- ============================================================================

ALTER TABLE `subjects`
    ADD COLUMN IF NOT EXISTS `classification` ENUM('MAJOR', 'MINOR') NULL DEFAULT NULL AFTER `units`;

