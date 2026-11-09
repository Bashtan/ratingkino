import { handleMe } from '../../_lib/account.js';

// /api/me: see functions/_lib/account.js
export const onRequest = context => handleMe(context);
