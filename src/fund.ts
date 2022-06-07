import { response } from 'cfw-easy-utils';
import {
  panelistKey,
  PANELISTS_PREFIX,
  projectKey,
  PROJECTS_PREFIX,
} from './prefix';
import { bearer } from '@borderless/parse-authorization';
import { parseError } from './parse/parse';
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
  state: DurableObjectState;
  env: Env;

  projects: Map<string, Project> = new Map([]);
  panelists: Map<string, Panelist> = new Map([]);

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }

  async initialize() {
    const [projects, panelists] = [
      await this.state.storage.list<Project>({
        prefix: PROJECTS_PREFIX,
      }),
      await this.state.storage.list<Panelist>({
        prefix: PANELISTS_PREFIX,
      }),
    ];

    if (projects) this.projects = projects;
    if (panelists) this.panelists = panelists;
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request) {
    let url = new URL(request.url);

    const currentProjects = this.projects;
    const currentPanelists = this.panelists;

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

    const { id } = await fetchDiscordUser(token);
    const guildMember = await fetchDiscordGuildMember(id, this.env.BOT_TOKEN);

    try {
      validateUser(guildMember);
    } catch (e) {
      return parseError(e);
    }

    const PANELIST_KEY = panelistKey(id);

    let panelist = currentPanelists.get(PANELIST_KEY);
    if (!panelist) panelist = await this.createPanelist(guildMember);

    let body: any = {};

    if (request.method === 'POST') {
      try {
        body = JSON.parse(await request.text());
      } catch (err) {
        body = {};
      }
    }

    switch (`${request.method} ${url.pathname}`) {
      case 'GET /auth':
        return response.json(panelist, {
          headers: { 'Cache-Control': 'no-store' },
        });

      case 'POST /approve':
        if (!body.slug) throw 'Slug is missing.';
        if (panelist.voted) throw 'Panelist already voted.';

        this.approveProject(id, body.slug);
        return response.json();

      case 'POST /unapprove':
        if (!body.slug) throw 'Slug is missing.';
        if (panelist.voted) throw 'Panelist already voted.';

        this.unapproveProject(id, body.slug);
        return response.json();

      case 'POST /submit':
        if (!body.favorites) throw 'Favorites are missing.';
        if (panelist.voted) throw 'Panelist already voted.';

        const submittedProjects = this.submitVote(id);
        return response.json(submittedProjects);

      case 'POST /favorites':
        if (!body.favorites) throw 'Favorites are missing.';
        if (panelist.voted) throw 'Panelist already voted.';

        const slugs: string[] = body.favorites;

        const newFavorites = this.updateFavorites(id, slugs);
        return response.json(newFavorites);

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

  async createPanelist(discordMember: GuildMember) {
    const { user, roles } = discordMember;

    if (!user) throw 'User not found.';

    const isAdmin = roles.includes(adminRoleId);

    const panelist: Panelist = {
      ...user,
      voted: false,
      favorites: [],
      approved: [],
      isAdmin,
    };

    const PANELIST_KEY = panelistKey(user.id);

    this.panelists.set(PANELIST_KEY, panelist);
    await this.state.storage.put(PANELIST_KEY, panelist);

    return panelist;
  }

  async approveProject(userId: string, slug: string) {
    const PROJECT_KEY = projectKey(slug);
    const project = this.projects.get(PROJECT_KEY);

    if (!project) throw 'Project does not exist.';

    const PANELIST_KEY = panelistKey(userId);
    const panelist = this.panelists.get(PANELIST_KEY);

    if (!panelist) throw 'Panelist does not exist.';

    panelist.approved = panelist.approved.filter(
      project => project.slug !== slug,
    );

    panelist.approved.push({ slug, name: project.name });

    project.approved_count++;
  }

  async unapproveProject(userId: string, slug: string) {
    const PROJECT_KEY = projectKey(slug);
    const project = this.projects.get(PROJECT_KEY);

    if (!project) throw 'Project does not exist.';

    const PANELIST_KEY = panelistKey(userId);
    const panelist = this.panelists.get(PANELIST_KEY);

    if (!panelist) throw 'Panelist does not exist.';

    panelist.approved = panelist.approved.filter(
      project => project.slug !== slug,
    );

    panelist.favorites = panelist.favorites.filter(
      project => project.slug !== slug,
    );

    project.approved_count--;

    await this.state.storage.put(PANELIST_KEY, panelist);
    await this.state.storage.put(PROJECT_KEY, project);
  }

  async updateFavorites(userId: string, slugs: string[]) {
    if (slugs.length !== new Set(slugs).size)
      throw 'SCF panelist cannot repeat projects in their ballot.';

    if (slugs.length > 3)
      throw 'SCF panelists cannot have more than 3 favorites.';

    const PANELIST_KEY = panelistKey(userId);
    const panelist = this.panelists.get(PANELIST_KEY);

    if (!panelist) throw 'Panelist does not exist.';

    const favoriteProjects = slugs.map(slug => {
      const PROJECT_KEY = projectKey(slug);
      const project = this.projects.get(PROJECT_KEY);

      if (!project) throw 'Project does not exist.';

      return { slug, name: project.name };
    });

    panelist.favorites = favoriteProjects;

    this.state.storage.put(PANELIST_KEY, panelist);

    return panelist.favorites;
  }

  async submitVote(userId: string) {
    const PANELIST_KEY = panelistKey(userId);
    const panelist = this.panelists.get(PANELIST_KEY);

    if (!panelist) throw 'Panelist does not exist.';

    const { favorites } = panelist;

    if (new Set(favorites).size !== 3) {
      throw 'SCF panelist must submit 3 unique projects in their ballot';
    }

    const votedProjects = favorites.map(({ slug }) => {
      const PROJECT_KEY = projectKey(slug);
      const project = this.projects.get(PROJECT_KEY);

      if (!project) throw 'Project does not exist.';

      return project;
    });

    const scoreUpdates = votedProjects.reverse().map((project, index) => {
      const score = index + 1;
      project.score += score;

      const PROJECT_KEY = projectKey(project.slug);
      return this.state.storage.put(PROJECT_KEY, project);
    });

    await Promise.all(scoreUpdates);

    panelist.voted = true;
    await this.state.storage.put(PANELIST_KEY, panelist);

    return panelist.favorites;
  }
}

interface Env {
  WEBFLOW_API_KEY: string;
  BOT_TOKEN: string;
}

const validateUser = (guildMember: GuildMember) => {
  const { user, roles } = guildMember;

  if (!user) throw 'User not found.';

  const { id, verified } = user;

  if (!id) throw 'Your Discord email is unverified';

  if (!verified) throw 'Your Discord email is unverified.';

  if (!roles.includes(verifiedRoleId))
    throw 'The ability to log in to vote is only available for verified community members. To check if you’re eligible to become one, visit the SCF discord and apply.';

  if (roles.includes(submitterRoleId))
    throw 'You are ineligible to vote because you have submitted a project for this round.';
};
