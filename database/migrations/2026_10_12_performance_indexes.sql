-- Performance Optimization Composite Indexes (2026-10-12)
ALTER TABLE `sa_profiles` ADD INDEX `idx_sa_status_arch_sem` (`sa_status`, `archived_at`, `semester_id`);
ALTER TABLE `sa_profiles` ADD INDEX `idx_sa_sup_status` (`supervisor_id`, `sa_status`, `archived_at`);
ALTER TABLE `sa_profiles` ADD INDEX `idx_sa_office_status` (`office_id`, `sa_status`, `archived_at`);
ALTER TABLE `schedule_assignments` ADD INDEX `idx_sa_assign_sem_source` (`semester_id`, `source`);
ALTER TABLE `schedule_assignments` ADD INDEX `idx_sa_assign_sem_loc` (`semester_id`, `location`);
ALTER TABLE `notifications` ADD INDEX `idx_notif_user_id_desc` (`user_id`, `id`);
ALTER TABLE `class_schedules` ADD INDEX `idx_cs_sem_arch_sa` (`semester_id`, `archived_at`, `sa_profile_id`);
ALTER TABLE `room_utilization` ADD INDEX `idx_ru_sem_room_day` (`semester_id`, `room_id`, `day_of_week`, `start_time`);
ALTER TABLE `room_requirements` ADD INDEX `idx_rr_sem_room` (`semester_id`, `room_id`);
ALTER TABLE `match_candidates` ADD INDEX `idx_mc_slot_rank` (`slot_id`, `rank_no`);
ALTER TABLE `match_candidates` ADD INDEX `idx_mc_sa_rank` (`sa_profile_id`, `rank_no`);
ALTER TABLE `sa_evaluations` ADD INDEX `idx_eval_sem_status` (`semester_id`, `status`);
ALTER TABLE `evaluation_action_history` ADD INDEX `idx_eah_eval_id` (`evaluation_id`, `id`);
ALTER TABLE `evaluation_notification_logs` ADD INDEX `idx_enl_eval_id` (`evaluation_id`, `id`);

