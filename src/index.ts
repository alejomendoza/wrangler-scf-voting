export { Fund } from './fund';

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return new Response(e.message);
    }
  },
};

async function handleRequest(request: Request, env: Env) {
  let id = env.Fund.idFromName('A');
  let obj = env.Fund.get(id);
  let res = await obj.fetch(request.url);
  let results = await res.text();

  return new Response(results);
}

interface Env {
  Fund: DurableObjectNamespace;
}
