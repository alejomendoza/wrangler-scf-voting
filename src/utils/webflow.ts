import { handleResponse } from '.';

const webflowApi = 'https://api.webflow.com';
const collectionId = '629e269eb4ffa3312c44af8e';
const projectTag = '629e269eb4ffa3824144aff2';

export const getProjects = async (
  authToken: string,
  offset?: number,
): Promise<WebflowCollection> => {
  const url = new URL(`${webflowApi}/collections/${collectionId}/items`);

  if (offset) url.searchParams.append('offset', offset.toString());

  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Accept-Version': '1.0.0',
    },
  }).then(handleResponse);
};

export const getAllProjects = async (authToken: string) => {
  const response = await getProjects(authToken);

  let { count, offset, total, items: projects } = response;

  while (count + offset < total) {
    offset += count;
    const paginatedProjects = await getProjects(authToken, offset);
    projects = projects.concat(paginatedProjects.items);
    count = paginatedProjects.count;
  }

  const filteredProjects = projects.filter(project =>
    project['candidate-rounds']?.includes(projectTag),
  );

  return filteredProjects;
};
