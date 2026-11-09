import { handleTransfer } from '../../_lib/transfer.js';

// /api/transfer and /api/transfer/claim: see functions/_lib/transfer.js
export const onRequest = context => handleTransfer(context);
