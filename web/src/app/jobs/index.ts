// What the shell takes from Jobs's web folder (J5): the page, the sidebar's item (and the rail's
// slot), `4`, and ⌘K's Go to. Each file that imports this is a wiring point, listed in
// server/src/jobs/README.md and in the lint's JOBS_WIRING; nothing else outside the folder imports it.
export {JobsPage} from './JobsPage.tsx';
export {goToJobs, JobsNavItem, jobsCommands} from './Nav.tsx';
