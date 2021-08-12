import { Project } from './types/project';
import { Panelist } from './types/panelist';
import { response } from 'cfw-easy-utils';
import { fromPairs as loFromPairs } from 'lodash';
import { bearer } from '@borderless/parse-authorization';
import { fetchDiscordGuildMember, fetchDiscordUser } from './discord';

const webflowApi = 'https://api.webflow.com';
const collectionId = '610418d70a84c9d77ceaaee3';
const PROJECTS_PREFIX = 'projects:';
const PANELISTS_PREFIX = 'panelists:';

async function handleAuth(request: Request) {
  const headers = loFromPairs([...new Map(request.headers)]);
  const token = bearer(headers.authorization || '');
  if (!token) {
    throw { status: 401, message: 'Missing Authorization header token' };
  }
  const {
    id,
    email,
    verified,
    avatar,
    username,
    discriminator,
  } = await fetchDiscordUser(token);

  const { roles }: { roles: string[] } = await fetchDiscordGuildMember(
    token,
    id,
  );

  if (!id) {
    throw {
      status: 404,
      message: 'Failed to authenticate',
    };
  }

  if (!verified) {
    throw {
      status: 404,
      message: 'Discord user missing or the email is unverified',
    };
  }

  if (!roles.includes('panelist')) {
    throw {
      status: 404,
      message: 'Discord user missing panelist role',
    };
  }

  return {
    id,
    email,
    avatar,
    username,
    discriminator,
  };
}

export class Fund {
  projects: Map<string, Project> = new Map([]);
  panelists: Map<string, Panelist> = new Map([]);

  state: DurableObjectState;
  env: Env;

  initializePromise: Promise<void> | undefined;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async initialize() {
    let [projects, panelists] = [
      await this.state.storage.list<Project>({ prefix: PROJECTS_PREFIX }),
      await this.state.storage.list<Panelist>({ prefix: PANELISTS_PREFIX }),
    ];
    this.projects = projects;
    this.panelists = panelists;
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    // Make sure we're fully initialized from storage.
    if (!this.initializePromise) {
      this.initializePromise = this.initialize().catch(err => {
        // If anything throws during initialization then we need to be
        // sure sure that a future request will retry initialize().
        // Note that the concurrency involved in resetting this shared
        // promise on an error can be tricky to get right -- we don't
        // recommend customizing it.
        this.initializePromise = undefined;
        throw err;
      });
    }
    await this.initializePromise;

    let url = new URL(request.url);
    let { pathname } = url;
    console.log('pathname: ', pathname);

    let currentProjects = this.projects;
    let currentPanelists = this.panelists;

    const { id, email, avatar, username, discriminator } = await handleAuth(
      request,
    );

    let panelist = await currentPanelists.get(`${PANELISTS_PREFIX}${id}`);

    switch (pathname) {
      case '/auth':
        if (!panelist) {
          const newPanelist: Panelist = {
            id: id,
            email: email,
            voted: false,
            ballot: [],
            approved: [],
            disapproved: [],
            avatar: avatar,
            username: username,
            discriminator: discriminator,
          };
          currentPanelists.set(`${PANELISTS_PREFIX}${id}`, newPanelist);
          await this.state.storage.put(`${PANELISTS_PREFIX}${id}`, newPanelist);
          return response.json(newPanelist);
        }

        return response.json(panelist);

      case '/approve':
        const approve = url.searchParams.get('approve');
        const projectId = url.searchParams.get('project_id');

        if (!panelist) {
          throw {
            status: 404,
            message: 'Authenticate as a panelist to vote',
          };
        }

        if (!projectId) {
          throw 'must send project_id as a search param';
        }

        let project = currentProjects.get(projectId);
        if (!project) {
          throw 'project does not exist';
        }

        if (
          panelist.approved.includes(projectId) ||
          panelist.disapproved.includes(projectId)
        ) {
          throw {
            status: 403,
            message: 'You already voted for this project',
          };
        }

        let updatedProject = {
          score: project.score,
          approval_count: approve
            ? project.approval_count + 1
            : project.approval_count,
          disapproval_count: approve
            ? project.disapproval_count
            : project.disapproval_count + 1,
          id: projectId as string,
          description: project.description,
          site: project.site,
          logoUrl: project.logoUrl,
          name: project.name,
        };
        currentProjects.set(`${PROJECTS_PREFIX}${projectId}`, updatedProject);
        await this.state.storage.put(
          `${PROJECTS_PREFIX}${projectId}`,
          updatedProject,
        );

        if (approve) {
          panelist.approved.push(projectId);
        } else {
          panelist.disapproved.push(projectId);
        }

        currentPanelists.set(`${PANELISTS_PREFIX}${id}`, panelist);
        await this.state.storage.put(`${PANELISTS_PREFIX}${id}`, panelist);
        break;
      case '/vote':
        if (!panelist) {
          throw {
            status: 404,
            message: 'Authenticate as a panelist to vote',
          };
        }
        if (panelist.voted) {
          throw {
            status: 403,
            message: 'You already submitted your ballot',
          };
        }
        const topProjectsIds = url.searchParams.get('top_projects');

        if (!topProjectsIds) {
          throw 'Must send top_projects in the boddy of the request';
        }

        let projectsIds: string[] = topProjectsIds.split(',');
        console.log('top projects:', topProjectsIds);

        if (projectsIds.length !== 10) {
          throw 'SCF panelist can only send 10 projects in their ballot';
        }

        console.log('passed length check');

        if (projectsIds.length === new Set(projectsIds).size) {
          throw 'SCF panelist can not repeat projects in their ballot';
        }

        console.log('passed checks');

        let projectsPromises = projectsIds.map(
          async (projectId): Promise<Project> => {
            return currentProjects.get(projectId) as Project;
          },
        );

        let projects = await Promise.all(projectsPromises);

        let ballot = projects.reverse().map(async (project, index) => {
          let score = index + 1;
          let updatedProject: Project = {
            score: project.score + score,
            approval_count: project.approval_count,
            disapproval_count: project.disapproval_count,
            id: project.id,
            description: project.description,
            site: project.site,
            logoUrl: project.logoUrl,
            name: project.name,
          };

          currentProjects.set(project.id, updatedProject);
          await this.state.storage.put(project.id, updatedProject);
        });

        await Promise.all(ballot);
        panelist.voted = true;
        panelist.ballot = projectsIds;

        currentPanelists.set(`${PANELISTS_PREFIX}${id}`, panelist);
        await this.state.storage.put(`${PANELISTS_PREFIX}${id}`, panelist);
        break;
      case '/panelists':
        return response.json({
          panelists: Array.from(currentPanelists).map(([, value]) => value),
        });
      case '/sync':
        const res = await fetch(
          `${webflowApi}/collections/${collectionId}/items?access_token=${this.env.WEBFLOW_API_KEY}&api_version=1.0.0`,
        );
        const results = await res.json();

        const { items }: { items: [] } = results;
        const indexItems = items.map(async (item: any) => {
          let projectId = item['_id'];
          let project = currentProjects.get(projectId);
          if (!project) {
            let newProject = {
              score: 0,
              approval_count: 0,
              disapproval_count: 0,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
            };
            currentProjects.set(projectId, newProject);
            await this.state.storage.put(projectId, newProject);
          } else {
            let updatedProject = {
              score: project.score,
              approval_count: project.approval_count,
              disapproval_count: project.disapproval_count,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
            };
            await currentProjects.set(projectId, updatedProject);
            await this.state.storage.put(projectId, updatedProject);
          }
        });

        await Promise.all(indexItems);

      case '/':
        break;
      default:
        return new Response('Not found', { status: 404 });
    }

    // Return `currentValue`. Note that `this.value` may have been
    // incremented or decremented by a concurrent request when we
    // yielded the event loop to `await` the `storage.put` above!
    // That's why we stored the counter value created by this
    // request in `currentValue` before we used `await`.
    return response.json({
      projects: Array.from(currentProjects)
        .map(([, project]) => project)
        .sort((a, b) => {
          return b.score - a.score;
        }),
    });
  }
}

interface Env {
  WEBFLOW_API_KEY: string;
}
