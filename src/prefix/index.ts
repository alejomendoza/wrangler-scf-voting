export const PROJECTS_PREFIX = 'projects:';
export const PANELISTS_PREFIX = 'panelists:';

export const projectKey = (id: string) => `${PROJECTS_PREFIX}${id}`;
export const panelistKey = (id: string) => `${PANELISTS_PREFIX}${id}`;
