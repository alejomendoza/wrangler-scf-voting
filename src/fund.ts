import { response } from 'cfw-easy-utils';
import { bearer } from '@borderless/parse-authorization';
import { unparse } from 'papaparse';

import {
  panelistKey,
  PANELISTS_PREFIX,
  projectKey,
  PROJECTS_PREFIX,
} from './prefix';

import { parseError } from './utils';
import {
  role,
  fetchDiscordGuildMember,
  fetchDiscordUser,
} from './utils/discord';
import { getAllProjects } from './utils/webflow';

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

    try {
      const user = await fetchDiscordUser(token);
      const { id } = user;

      const guildMember = await fetchDiscordGuildMember(id, this.env.BOT_TOKEN);

      validateUser(user, guildMember);

      const PANELIST_KEY = panelistKey(id);

      let panelist = this.panelists.get(PANELIST_KEY);
      if (!panelist) panelist = await this.createPanelist(user, guildMember);

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
          return response.json(null);

        case 'POST /unapprove':
          if (!body.slug) throw 'Slug is missing.';
          if (panelist.voted) throw 'Panelist already voted.';

          this.unapproveProject(id, body.slug);
          return response.json(null);

        case 'POST /submit':
          if (panelist.voted) throw 'Panelist already voted.';

          const submittedProjects = this.submitVote(id);
          return response.json(submittedProjects);

        case 'POST /favorites':
          if (!body.favorites) throw 'Favorites are missing.';
          if (!Array.isArray(body.favorites))
            throw 'Favorites must be an array.';
          if (panelist.voted) throw 'Panelist already voted.';

          const slugs: string[] = body.favorites;

          const newFavorites = await this.updateFavorites(id, slugs);
          return response.json(newFavorites);

        case 'GET /panelists':
          if (!panelist.isAdmin) throw 'Must be admin to get panelists.';

          return response.json({
            panelists: Array.from(this.panelists.values()),
          });

        case 'GET /panelists/csv':
          if (!panelist.isAdmin) throw 'Must be admin to get panelists CSV.';

          const formattedPanelists = Array.from(this.panelists.values()).map(
            panelist => {
              const {
                id,
                username,
                email,
                voted,
                favorites,
                approved,
              } = panelist;

              const temp: any = {
                id,
                username,
                email,
                totalApproved: approved.length,
                voted,
              };

              for (let i = 0; i < 3; i++) {
                temp[`favorite-${i + 1}`] = favorites[i]?.name || '';
              }

              return temp;
            },
          );

          const panelistsCsv = unparse(formattedPanelists);

          return response.json({ csv: panelistsCsv });

        case 'POST /remove-panelist':
          if (!body.panelist) throw 'Panelist id is missing.';
          if (!panelist.isAdmin) throw 'Must be admin to delete panelist.';

          await this.deletePanelist(body.panelist);

          return response.json({
            panelists: Array.from(this.panelists.values()),
          });

        case 'GET /projects':
          if (!panelist.isAdmin) throw 'Must be admin to get projects.';

          return response.json({
            total: this.projects.size,
            projects: Array.from(this.projects.values()),
          });

        case 'GET /projects/sync':
          if (!panelist.isAdmin) throw 'Must be admin to sync projects.';

          await this.syncProjects();
          return response.json(null);

        case 'GET /projects/csv':
          if (!panelist.isAdmin) throw 'Must be admin to get CSV.';

          const projectsCsv = unparse(Array.from(this.projects.values()));

          return response.json({ csv: projectsCsv });

        default:
          return response.json({
            status: 404,
            message: 'Endpoint Not Found',
          });
      }
    } catch (e) {
      return parseError(e);
    }
  }

  async createPanelist(user: DiscordUser, discordMember: GuildMember) {
    const { roles } = discordMember;

    const admins = JSON.parse(this.env.ADMINS);
    const isAdmin = roles.includes(role.ADMIN) || admins.includes(user.id);

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

  async deletePanelist(userId: string) {
    const PANELIST_KEY = panelistKey(userId);
    const panelist = this.panelists.get(PANELIST_KEY);

    if (!panelist) throw 'Panelist does not exist.';

    this.panelists.delete(PANELIST_KEY);
    await this.state.storage.delete(PANELIST_KEY);

    return this.panelists;
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

    await this.state.storage.put(PANELIST_KEY, panelist);
    await this.state.storage.put(PROJECT_KEY, project);
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

      if (!project) throw `Project '${slug}' does not exist.`;

      return { slug, name: project.name };
    });

    panelist.favorites = favoriteProjects;

    await this.state.storage.put(PANELIST_KEY, panelist);

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

  async syncProjects() {
    const projects = await getAllProjects(this.env.WEBFLOW_API_KEY);

    const syncUpdates = projects.map(item => {
      const PROJECT_KEY = projectKey(item.slug);

      const project = this.projects.get(PROJECT_KEY);

      const syncedProject: Project = {
        id: item._id,
        name: item.name,
        slug: item.slug,
        score: 0,
        approved_count: 0,
        ...project,
      };

      this.projects.set(PROJECT_KEY, syncedProject);
      return this.state.storage.put(PROJECT_KEY, syncedProject);
    });

    await Promise.all(syncUpdates);
  }
}

interface Env {
  WEBFLOW_API_KEY: string;
  BOT_TOKEN: string;
  ADMINS: string;
}

const validateUser = (user: DiscordUser, guildMember: GuildMember) => {
  const { roles } = guildMember;
  const { id, verified } = user;

  if (!id) throw 'Your Discord email is unverified';

  if (!verified) throw 'Your Discord email is unverified.';

  if (!roles.includes(role.VERIFIED))
    throw 'The ability to log in to vote is only available for verified community members. To check if you’re eligible to become one, visit the SCF discord and apply.';

  if (!roles.includes(role.VOTER))
    throw 'The ability to vote is only available for verified community members with a voter role in the SCF discord.';

  if (roles.includes(role.SCF10))
    throw 'You are ineligible to vote because you have submitted a project for this round.';
};
