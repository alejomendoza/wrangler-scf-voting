import { Project } from './types/project';
import { response } from 'cfw-easy-utils';
const webflowApi = 'https://api.webflow.com';
const collectionId = '610418d70a84c9d77ceaaee3';

export class DurableProjects {
  projects: Map<string, Project> = new Map([]);
  state: DurableObjectState;
  env: Env;

  initializePromise: Promise<void> | undefined;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async initialize() {
    let stored = await this.state.storage.list<Project>();
    this.projects = stored;
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

    // Apply requested action.
    let url = new URL(request.url);
    let { pathname } = url;
    console.log('pathname: ', pathname);

    let currentProjects = this.projects;
    switch (pathname) {
      case '/approve':
        const approve = url.searchParams.get('approve');
        const projectId = url.searchParams.get('project_id');

        if (!projectId) {
          throw 'must send project_id as a search param';
        }

        let project = currentProjects.get(projectId);
        if (!project) {
          throw 'project does not exist';
        }
        currentProjects.set(projectId, {
          score: 0,
          approval_count: approve ? project.approval_count + 1 : project.approval_count,
          disapproval_count: approve ? project.disapproval_count : project.disapproval_count + 1,
          id: projectId as string,
          description: project.description,
          site: project.site,
          logoUrl: project.logoUrl,
          name: project.name,
        });

        break;
      case '/vote':
        const topProjectsIds = url.searchParams.get('top_projects');


        if (!topProjectsIds) {
          throw 'Must send top_projects in the boddy of the request';
        }

        let projectsIds: string[] = topProjectsIds.split(',');
        console.log('top projects:' , topProjectsIds);

        if (projectsIds.length !== 10) {
          throw 'SCF panelist can only send 10 projects in their ballot';
        }

        console.log('passed length check');

        // if (projectsIds.length === new Set(projectsIds).size){
        //   throw 'SCF panelist can not repeat projects in their ballot';
        // }

        console.log('passed checks');

        let projectsPromises = projectsIds.map(
          async ( id ): Promise<Project> => {
            return currentProjects.get(id) as Project;
          }
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

          return currentProjects.set(
            project.id,
            updatedProject
          );
        });

        await Promise.all(ballot);
        break;
      case '/sync':
        const res = await fetch(
          `${webflowApi}/collections/${collectionId}/items?access_token=${this.env.WEBFLOW_API_KEY}&api_version=1.0.0`
        );
        const results = await res.json();

        const { items }: { items: [] } = results;
        const indexItems = items.map(async (item: any) => {
          let projectId = item['_id'];
          let project = currentProjects.get(projectId);
          if (!project) {
            return currentProjects.set(projectId, {
              score: 0,
              approval_count: 0,
              disapproval_count: 0,
              id: projectId as string,
              description: item['quick-description'],
              name: item.name,
              site: item['customer-interface-if-featured'],
              logoUrl: item.logo.url,
            });
          }
          await currentProjects.set(projectId, {
            score: project.score,
            approval_count: project.approval_count,
            disapproval_count: project.disapproval_count,
            id: projectId as string,
            description: item['quick-description'],
            name: item.name,
            site: item['customer-interface-if-featured'],
            logoUrl: item.logo.url,
          });
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
      projects:Array.from(currentProjects)
          .map(([, project]) => project)
          .sort((a, b) => {
            return b.score - a.score;
          })
    });
  }
}

interface Env {
  WEBFLOW_API_KEY: string;
}
