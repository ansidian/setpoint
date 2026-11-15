// What the shell takes from Jobs's web folder: the page, the sidebar's item (and the rail's
// slot), `4`, and ⌘K's Go to; what fills mail's slots (the JD chip, Applied before); and Settings
// › Jobs with Settings › AI's Jobs group. Each file that imports this is a wiring point, listed in
// server/src/jobs/README.md and in the lint's JOBS_WIRING; nothing else outside the folder imports it.
export {JobsPage} from './JobsPage.tsx';
export {goToJobs, JobsNavItem, jobsCommands} from './Nav.tsx';
export {jobsMailSlots} from './InMail.tsx';
export {JOBS_SETTINGS_PATHS, JobsAiGroup, JobsSettingsPage, JobsUsageRow, useJobsSpend} from './JobsSettings.tsx';
