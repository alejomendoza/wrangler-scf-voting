
// In order for the workers runtime to find the class that implements
// our Durable Object namespace, we must export it from the root module.
export { DurableProjects } from './projects'

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env)
    } catch (e) {
      return new Response(e.message)
    }
  },
}

async function handleRequest(request: Request, env: Env) {
  let id = env.PROJECTS.idFromName('A')
  let obj = env.PROJECTS.get(id)
  let resp = await obj.fetch(request.url)
  let projects = await resp.text();

  return new Response(projects);
}

interface Env {
  PROJECTS: DurableObjectNamespace
}
