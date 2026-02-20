-- Migration 002: Add approved and rejected values to task_status enum
-- Run in Supabase SQL Editor
--
-- Root cause: task_status enum was created without 'approved' and 'rejected'.
-- This caused gate.approve() and gate.reject() to silently fail on DB update,
-- and getCompleted() history query to crash (invalid enum in .in() filter).

ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'rejected';
