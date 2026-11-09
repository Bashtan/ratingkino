import { handleAuth } from '../../_lib/account.js';

// /api/auth/nonce, google, apple, logout: see functions/_lib/account.js
export const onRequest = context => handleAuth(context);
