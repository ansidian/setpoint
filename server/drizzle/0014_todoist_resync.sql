-- SV-25: a full Todoist sync once, so the projects mirrored before 0013 get their colours; an
-- incremental poll returns a project only when it changes. Its completed-list cursor stays.
DELETE FROM `sync_cursors` WHERE `scope` = '' AND `source_id` IN (SELECT `id` FROM `sources` WHERE `provider` = 'todoist');
