import base from './index';
import type { Env } from './types';
import { handleV04 } from './v04';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const v04 = await handleV04(request, env);
    if (v04) return v04;
    return base.fetch(request, env);
  },
};
