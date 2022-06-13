declare global {
  const WEBFLOW_API_KEY: string;
  const BOT_TOKEN: string;
  const ENVIRONMENT: 'dev' | 'prod';
}

interface Env {
  FUND: DurableObjectNamespace;
  ENVIRONMENT: 'dev' | 'prod';
}
