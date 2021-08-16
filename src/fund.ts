import { Project } from './types/project';
import { Panelist } from './types/panelist';
import { response } from 'cfw-easy-utils';
import { handleAuth } from './auth';
import {
  panelistKey,
  PANELISTS_PREFIX,
  projectKey,
  PROJECTS_PREFIX,
} from './prefix';

const webflowApi = 'https://api.webflow.com';
const collectionId = '610418d70a84c9d77ceaaee3';

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

    const PANELIST_KEY = panelistKey(id);
    let panelist = await currentPanelists.get(PANELIST_KEY);

    switch (pathname) {
      case '/auth':
        if (!panelist) {
          const newPanelist: Panelist = {
            id: id,
            email: email,
            voted: false,
            ballot: [],
            votes: [],
            avatar: avatar,
            username: username,
            discriminator: discriminator,
          };
          currentPanelists.set(PANELIST_KEY, newPanelist);
          await this.state.storage.put(PANELIST_KEY, newPanelist);
          return response.json(newPanelist);
        }

        return response.json(panelist);

      case '/vote':
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

        const PROJECT_KEY = projectKey(projectId);
        let project = currentProjects.get(PROJECT_KEY);
        if (!project) {
          throw 'project does not exist';
        }

        if (panelist.votes.includes(projectId)) {
          throw {
            status: 403,
            message: 'You already voted for this project',
          };
        }

        let updatedProject = {
          score: project.score,
          vote_count: project.vote_count + 1,
          id: projectId as string,
          description: project.description,
          site: project.site,
          logoUrl: project.logoUrl,
          name: project.name,
        };
        currentProjects.set(PROJECT_KEY, updatedProject);
        await this.state.storage.put(PROJECT_KEY, updatedProject);

        panelist.votes.push(projectId);

        currentPanelists.set(PANELIST_KEY, panelist);
        await this.state.storage.put(PANELIST_KEY, panelist);
        break;
      case '/ballot':
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
          throw {
            status: 403,
            message: 'Must send top_projects in the boddy of the request',
          };
        }

        let projectsIds: string[] = topProjectsIds.split(',');
        console.log('top projects:', topProjectsIds);

        if (projectsIds.length !== 3) {
          throw {
            status: 403,
            message: 'SCF panelist can only send 10 projects in their ballot',
          };
        }

        console.log('passed length check');

        if (projectsIds.length === new Set(projectsIds).size) {
          throw {
            status: 403,
            message: 'SCF panelist can not repeat projects in their ballot',
          };
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
            vote_count: project.vote_count,
            id: project.id,
            description: project.description,
            site: project.site,
            logoUrl: project.logoUrl,
            name: project.name,
          };

          const BALLOT_PROJECT_KEY = projectKey(project.id);

          currentProjects.set(BALLOT_PROJECT_KEY, updatedProject);
          await this.state.storage.put(BALLOT_PROJECT_KEY, updatedProject);
        });

        await Promise.all(ballot);
        panelist.voted = true;
        panelist.ballot = projectsIds;

        currentPanelists.set(PANELIST_KEY, panelist);
        await this.state.storage.put(PANELIST_KEY, panelist);
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
          const INDEX_PROJECT_KEY = projectKey(projectId);

          let project = currentProjects.get(INDEX_PROJECT_KEY);
          if (!project) {
            let newProject = {
              score: 0,
              vote_count: 0,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
            };
            currentProjects.set(INDEX_PROJECT_KEY, newProject);
            await this.state.storage.put(INDEX_PROJECT_KEY, newProject);
          } else {
            let updatedProject = {
              score: project.score,
              vote_count: project.vote_count,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
            };
            await currentProjects.set(INDEX_PROJECT_KEY, updatedProject);
            await this.state.storage.put(INDEX_PROJECT_KEY, updatedProject);
          }
        });

        await Promise.all(indexItems);

      case '/':
        break;
      default:
        throw {
          status: 404,
          message: 'Not Found',
        };
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
