import { parseError } from './parse/parse';

export { Fund } from './fund';

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      console.log('before parse error:', e);
      return parseError(e);
    }
  },
};

async function handleRequest(request: Request, env: Env) {
  let id = env.FUND.idFromName('C');
  let obj = env.FUND.get(id);
  let res = await obj.fetch(request);
  let results = await res.text();
  return new Response(results);
}

interface Env {
  FUND: DurableObjectNamespace;
}
