import { parseError } from './utils';

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
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Authorization, Origin, Content-Type, Accept',
        'Access-Control-Allow-Methods':
          'GET, PUT, POST, DELETE, PATCH, OPTIONS',
        'Cache-Control': 'public, max-age=2419200',
      },
    });

  let id = env.FUND.idFromName('ROUND9A');
  let obj = env.FUND.get(id);
  let res = await obj.fetch(request);
  return res;
}

interface Env {
  FUND: DurableObjectNamespace;
}
