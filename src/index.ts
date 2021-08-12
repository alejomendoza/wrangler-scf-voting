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
  let id = env.FUND.idFromName('A');
  let obj = env.FUND.get(id);
  let res = await obj.fetch(request.url);
  let results = await res.text();

  return new Response(results);
}

interface Env {
  FUND: DurableObjectNamespace;
}
