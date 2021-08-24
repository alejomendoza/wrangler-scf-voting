import { Project } from './types/project';
import { Panelist } from './types/panelist';
import { response } from 'cfw-easy-utils';
import {
  panelistKey,
  PANELISTS_PREFIX,
  projectKey,
  PROJECTS_PREFIX,
} from './prefix';
import { bearer } from '@borderless/parse-authorization';
import {
  adminRoleId,
  fetchDiscordGuildMember,
  fetchDiscordUser,
  verifiedRoleId,
} from './discord';

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

    if (projects) {
      this.projects = projects;
    }
    if (panelists) {
      this.panelists = panelists;
    }
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

    let currentProjects = this.projects;
    let currentPanelists = this.panelists;
    const headers = new Map(request.headers);
    const token = bearer(headers.get('authorization') || '');

    if (!token) {
      return response.json({
        status: 401,
        message: 'Missing Authorization header token',
      });
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
      id,
      this.env.BOT_TOKEN,
    );

    if (!id) {
      return response.json({
        status: 404,
        message: 'Failed to authenticate',
      });
    }

    if (!verified) {
      return response.json({
        status: 404,
        message: 'Discord user missing or the email is unverified',
      });
    }

    // if (!roles.includes(verifiedRoleId) || !roles.includes(adminRoleId)) {
    //   return response.json({
    //     status: 404,
    //     message: 'Discord user missing required roles',
    //   });
    // }

    console.log('user id: ', id);

    const PANELIST_KEY = panelistKey(id);
    let panelist = await currentPanelists.get(PANELIST_KEY);

    switch (pathname) {
      case '/auth':
        if (!panelist) {
          const newPanelist: Panelist = {
            id: id,
            email: email,
            voted: false,
            favorites: [],
            approved: [],
            avatar: avatar,
            username: username,
            discriminator: discriminator,
          };
          currentPanelists.set(PANELIST_KEY, newPanelist);
          await this.state.storage.put(PANELIST_KEY, newPanelist);
          return response.json(newPanelist);
        }

        return response.json(panelist);

      case '/unapprove':
        if (request.method !== 'POST') {
          return response.json({
            status: 404,
            message: 'must send a POST request',
          });
        }

        const removeVoteBody = await request.json();
        const removeSlug = removeVoteBody.slug;

        if (!panelist) {
          return response.json({
            status: 404,
            message: 'Authenticate as a panelist to vote',
          });
        }

        if (!removeSlug) {
          return response.json({
            status: 404,
            message: 'must send slug as a body param',
          });
        }

        const REMOVE_PROJECT_KEY = projectKey(removeSlug);
        let removedVoteProject = currentProjects.get(REMOVE_PROJECT_KEY);
        if (!removedVoteProject) {
          return response.json({
            status: 404,
            message: 'project does not exist',
          });
        }

        if (!panelist.approved.find(info => info.slug === removeSlug)) {
          return response.json({
            status: 403,
            message: 'You have not voted for this project',
          });
        }

        let removedVoteUpdate = {
          ...removedVoteProject,
          approved_count: removedVoteProject.approved_count - 1,
        };
        currentProjects.set(REMOVE_PROJECT_KEY, removedVoteUpdate);
        await this.state.storage.put(REMOVE_PROJECT_KEY, removedVoteUpdate);

        panelist.approved = panelist.approved.filter(
          vote => vote.slug !== removeSlug,
        );

        currentPanelists.set(PANELIST_KEY, panelist);
        await this.state.storage.put(PANELIST_KEY, panelist);
        return response.json(removedVoteUpdate);

      case '/approve':
        if (request.method !== 'POST') {
          return response.json({
            status: 404,
            message: 'must send a POST request',
          });
        }
        const addVoteBody = await request.json();
        const slug = addVoteBody.slug;

        if (!panelist) {
          return response.json({
            status: 404,
            message: 'Authenticate as a panelist to vote',
          });
        }

        if (!slug) {
          return response.json({
            status: 404,
            message: 'must send slug as a search param',
          });
        }

        const PROJECT_KEY = projectKey(slug);
        let project = currentProjects.get(PROJECT_KEY);
        if (!project) {
          return response.json({
            status: 404,
            message: 'project does not exist',
          });
        }

        if (panelist.approved.find(info => info.slug === slug)) {
          return response.json({
            status: 403,
            message: 'You already voted for this project',
          });
        }

        let updatedProject = {
          ...project,
          approved_count: project.approved_count + 1,
        };
        currentProjects.set(PROJECT_KEY, updatedProject);
        await this.state.storage.put(PROJECT_KEY, updatedProject);

        panelist.approved.push({
          slug: updatedProject.slug,
          name: updatedProject.name,
        });

        currentPanelists.set(PANELIST_KEY, panelist);
        await this.state.storage.put(PANELIST_KEY, panelist);
        return response.json(updatedProject);
      case '/favorites':
        if (request.method !== 'POST') {
          return response.json({
            status: 404,
            message: 'must send a POST request',
          });
        }
        const favoritesBody = await request.json();
        const slugs: string[] = favoritesBody.favorites;

        if (!panelist) {
          return response.json({
            status: 404,
            message: 'Authenticate as a panelist to vote',
          });
        }
        if (panelist.voted) {
          return response.json({
            status: 403,
            message: 'You already submitted your favorites',
          });
        }

        if (!slugs) {
          return response.json({
            status: 403,
            message: 'Must send favorites in the body of the request',
          });
        }

        if (slugs.length !== 3) {
          return response.json({
            status: 403,
            message: 'SCF panelist can only send 3 projects in their ballot',
          });
        }

        console.log('passed length check');

        if (slugs.length !== new Set(slugs).size) {
          return response.json({
            status: 403,
            message: 'SCF panelist can not repeat projects in their ballot',
          });
        }

        console.log('passed checks');

        let projectsPromises = slugs.map(
          async (projectId: string): Promise<Project> => {
            const PROJECT_KEY = projectKey(projectId);
            return currentProjects.get(PROJECT_KEY) as Project;
          },
        );

        let projects = await Promise.all(projectsPromises);

        let favorites = projects.reverse().map(async (project, index) => {
          let score = index + 1;
          let updatedProject: Project = {
            ...project,
            score: project.score + score,
          };

          const BALLOT_PROJECT_KEY = projectKey(project.slug);

          currentProjects.set(BALLOT_PROJECT_KEY, updatedProject);
          await this.state.storage.put(BALLOT_PROJECT_KEY, updatedProject);
        });

        await Promise.all(favorites);
        panelist.voted = true;
        panelist.favorites = projects.reverse().map(project => ({
          name: project.name,
          slug: project.slug,
        }));

        currentPanelists.set(PANELIST_KEY, panelist);
        await this.state.storage.put(PANELIST_KEY, panelist);
        break;
      case '/panelists':
        return response.json({
          panelists: Array.from(currentPanelists).map(([, value]) => value),
        });
      case '/sync-projects':
        const res = await fetch(
          `${webflowApi}/collections/${collectionId}/items?access_token=${this.env.WEBFLOW_API_KEY}&api_version=1.0.0`,
        );
        const results = await res.json();

        const { items }: { items: [] } = results;
        const indexItems = items.map(async (item: any) => {
          let projectId = item['_id'];
          const INDEX_PROJECT_KEY = projectKey(item.slug);

          let project = currentProjects.get(INDEX_PROJECT_KEY);
          if (!project) {
            let newProject = {
              score: 0,
              approved_count: 0,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
              slug: item.slug,
            };
            currentProjects.set(INDEX_PROJECT_KEY, newProject);
            await this.state.storage.put(INDEX_PROJECT_KEY, newProject);
          } else {
            let updatedProject = {
              score: project.score,
              approved_count: project.approved_count,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
              slug: item.slug,
            };
            await currentProjects.set(INDEX_PROJECT_KEY, updatedProject);
            await this.state.storage.put(INDEX_PROJECT_KEY, updatedProject);
          }
        });

        await Promise.all(indexItems);

      case '/projects':
        return response.json({
          projects: Array.from(currentProjects)
            .map(([, project]) => project)
            .sort((a, b) => {
              return b.approved_count - a.approved_count || b.score - a.score;
            }),
        });
      case '/':
        break;
      default:
        return response.json({
          status: 404,
          message: 'Not Found',
        });
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
          return b.approved_count - a.approved_count || b.score - a.score;
        }),
    });
  }
}

interface Env {
  WEBFLOW_API_KEY: string;
  BOT_TOKEN: string;
}
