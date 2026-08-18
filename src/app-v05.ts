import app from './app';
import type { Env } from './types';
import { renderPublicEventV05, validateRequiredFields } from './public-v05';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const eventPage = path.match(/^\/event\/([^/]+)$/);
    if (request.method === 'GET' && eventPage) {
      return renderPublicEventV05(env, eventPage[1]);
    }

    const registration = path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/);
    if (request.method === 'POST' && registration) {
      const invalid = await validateRequiredFields(env, registration[1], request);
      if (invalid) return invalid;
    }

    return app.fetch(request, env);
  },
};
