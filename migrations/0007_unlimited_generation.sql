-- Legacy column retained for older clients. Zero denotes no app-level daily cap.
UPDATE generation_settings SET daily_limit=0;
-- Release only plans blocked by the retired cap; do not retry failed model calls.
UPDATE generation_plans SET state='cancelled'
WHERE state='failed' AND error='生成上限に達したか、前の作問がまだ進行中です。保存済み問題で続けられます。'
AND NOT EXISTS(SELECT 1 FROM generation_jobs j WHERE j.id=generation_plans.id);
