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
  submitterRoleId,
} from './discord';

const webflowApi = 'https://api.webflow.com';
const collectionId = '6140c98a2150313e964bdfe1';
const roundId = '824970ac6f2a9e2c940b05ad07cef4ac';

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
      return response.json(
        {
          message: 'Missing Authorization header token',
        },
        { status: 401 },
      );
    }

    const {
      id,
      email,
      verified,
      avatar,
      username,
      discriminator,
    } = await fetchDiscordUser(token);

    let { roles }: { roles: string[] } = await fetchDiscordGuildMember(
      id,
      this.env.BOT_TOKEN,
    );

    if (!id) {
      return response.json(
        {
          message: 'Failed to authenticate',
        },
        { status: 404 },
      );
    }

    if (!verified) {
      return response.json(
        {
          message: 'Your Discord email is unverified',
        },
        { status: 404 },
      );
    }

    if (!roles.includes(verifiedRoleId)) {
      return response.json(
        {
          message:
            'The ability to log in to vote is only available for verified community members. To check if you’re eligible to become one, visit the SCF discord and apply.',
        },
        { status: 404 },
      );
    }

    if (roles.includes(submitterRoleId)) {
      return response.json(
        {
          message:
            'You are ineligible to vote because you have submitted a project for this round.',
        },
        { status: 404 },
      );
    }

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
            role: roles.includes(adminRoleId) ? 'admin' : 'verified',
          };
          currentPanelists.set(PANELIST_KEY, newPanelist);
          await this.state.storage.put(PANELIST_KEY, newPanelist);
          return response.json(newPanelist, {
            headers: { 'Cache-Control': 'no-store' },
          });
        }

        return response.json(panelist, {
          headers: { 'Cache-Control': 'no-store' },
        });

      case '/unapprove':
        if (request.method !== 'POST') {
          return response.json(
            {
              message: 'must send a POST request',
            },
            { status: 404 },
          );
        }

        const removeVoteBody = await request.json();
        const removeSlug = removeVoteBody.slug;

        if (!panelist) {
          return response.json(
            {
              message: 'Authenticate as a panelist to vote',
            },
            { status: 404 },
          );
        }

        if (!removeSlug) {
          return response.json(
            {
              message: 'must send slug as a body param',
            },
            { status: 404 },
          );
        }

        if (panelist.voted) {
          return response.json(
            {
              message: 'Votes can not be modified after ballot submission',
            },
            { status: 404 },
          );
        }

        const REMOVE_PROJECT_KEY = projectKey(removeSlug);
        let removedVoteProject = currentProjects.get(REMOVE_PROJECT_KEY);
        if (!removedVoteProject) {
          return response.json(
            {
              message: 'project does not exist',
            },
            { status: 404 },
          );
        }

        if (!panelist.approved.find(info => info.slug === removeSlug)) {
          return response.json(
            {
              message: 'You have not voted for this project',
            },
            { status: 403 },
          );
        }

        if (!!panelist.favorites.find(info => info.slug === removeSlug)) {
          panelist.favorites = panelist.favorites.filter(
            vote => vote.slug !== removeSlug,
          );
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
          return response.json(
            {
              message: 'must send a POST request',
            },
            { status: 404 },
          );
        }
        const addVoteBody = await request.json();
        const slug = addVoteBody.slug;

        if (!panelist) {
          return response.json(
            {
              message: 'Authenticate as a panelist to vote',
            },
            { status: 404 },
          );
        }

        if (panelist.voted) {
          return response.json(
            {
              message: 'Votes can not be modified after ballot submission',
            },
            { status: 404 },
          );
        }

        if (!slug) {
          return response.json(
            {
              message: 'must send slug as a search param',
            },
            { status: 404 },
          );
        }

        const PROJECT_KEY = projectKey(slug);
        let project = currentProjects.get(PROJECT_KEY);
        if (!project) {
          return response.json(
            {
              message: 'project does not exist',
            },
            { status: 404 },
          );
        }

        if (panelist.approved.find(info => info.slug === slug)) {
          return response.json(
            {
              message: 'You already voted for this project',
            },
            { status: 403 },
          );
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
          return response.json(
            {
              message: 'must send a POST request',
            },
            { status: 404 },
          );
        }
        const favoritesBody = await request.json();
        const slugs: string[] = favoritesBody.favorites;
        const submitting: boolean = !!favoritesBody.submitting;

        if (!panelist) {
          return response.json(
            {
              message: 'Authenticate as a panelist to vote',
            },
            { status: 404 },
          );
        }
        if (panelist.voted) {
          return response.json(
            {
              message: 'You already submitted your favorites',
            },
            { status: 403 },
          );
        }

        if (!slugs) {
          return response.json(
            {
              message: 'Must send favorites in the body of the request',
            },
            { status: 403 },
          );
        }

        if (slugs.length !== 3 && submitting) {
          return response.json(
            {
              message: 'SCF panelist can only send 3 projects in their ballot',
            },
            { status: 403 },
          );
        }

        console.log('passed length check');

        if (slugs.length !== new Set(slugs).size) {
          return response.json(
            {
              message: 'SCF panelist can not repeat projects in their ballot',
            },
            { status: 403 },
          );
        }

        console.log('passed checks');

        let projectsPromises = slugs.map(
          async (projectId: string): Promise<Project> => {
            const PROJECT_KEY = projectKey(projectId);
            return currentProjects.get(PROJECT_KEY) as Project;
          },
        );

        let projects = await Promise.all(projectsPromises);

        if (submitting) {
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
        } else {
          panelist.favorites = projects.map(project => ({
            name: project.name,
            slug: project.slug,
          }));
        }

        currentPanelists.set(PANELIST_KEY, panelist);
        await this.state.storage.put(PANELIST_KEY, panelist);
        return response.json(panelist.favorites);

      case '/panelists':
        return response.json({
          panelists: Array.from(currentPanelists).map(([, value]) => value),
        });
      case '/remove-panelist':
        if (request.method !== 'POST') {
          return response.json(
            {
              message: 'must send a POST request',
            },
            { status: 404 },
          );
        }
        const removePanelistBody = await request.json();
        const removePanelistId: string = removePanelistBody.panelist;
        const REMOVE_PANELIST_KEY = panelistKey(removePanelistId);
        currentPanelists.delete(REMOVE_PANELIST_KEY);
        await this.state.storage.delete(REMOVE_PANELIST_KEY);
        return response.json({
          panelists: Array.from(currentPanelists).map(([, value]) => value),
        });
      case '/sync-projects':
        let res: any;
        try {
          res = await fetch(
            `${webflowApi}/collections/${collectionId}/items?access_token=${this.env.WEBFLOW_API_KEY}&api_version=1.0.0`,
          );
        } catch (e) {
          console.log('error', e);
        }
        const results = await res.json();

        const { items }: { items: [] } = results;
        const indexItems = items
          .filter((result: any) => result.round === roundId)
          .map(async (item: any) => {
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
                logoUrl: item.logo ? item.logo.url : '',
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
