// Only loaded by the startup regression test; never start background notifications.
require('node-cron').schedule = () => ({ stop() {} });
